import { authTokenPattern } from "@bookbuddy/api-contract";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64url(value: string) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
}

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function randomOtp(exclude?: string): string {
  let code: string;
  const sample = new Uint32Array(1);
  do {
    // Reject the incomplete final million to avoid modulo bias.
    do crypto.getRandomValues(sample); while (sample[0]! >= 4_294_000_000);
    code = String(sample[0]! % 1_000_000).padStart(6, "0");
  } while (code === exclude);
  return code;
}

export async function loadOtpKey(secret?: string): Promise<CryptoKey | null> {
  if (!secret || secret.length < 32) return null;
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

// Domain-separated, unambiguous inputs; do not share MACs between lookup,
// authentication, retry proofs, and credential derivation.
export async function mac(key: CryptoKey, purpose: string, ...values: (string | number)[]): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(JSON.stringify([purpose, ...values])))));
}

export async function loadDeliveryKey(secret?: string): Promise<CryptoKey | null> {
  if (!secret || !authTokenPattern.test(secret)) return null;
  return crypto.subtle.importKey("raw", fromBase64url(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealDelivery(key: CryptoKey, effectId: string, message: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(effectId) }, key, encoder.encode(message));
  return `${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
}

export async function openDelivery(key: CryptoKey, effectId: string, sealed: string): Promise<unknown> {
  const [iv, ciphertext] = sealed.split(".");
  if (!iv || !ciphertext) throw new TypeError("Invalid delivery envelope");
  const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64url(iv), additionalData: encoder.encode(effectId) }, key, fromBase64url(ciphertext));
  return JSON.parse(decoder.decode(data));
}
