import type { Bindings } from "../bindings";

const utf8 = new TextEncoder();
const algorithm = "AWS4-HMAC-SHA256";
const region = "auto";
const service = "s3";
const end = "aws4_request";
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

const importKey = (key: ArrayBuffer | Uint8Array<ArrayBuffer>) =>
  crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const mac = (key: CryptoKey, value: string) => crypto.subtle.sign("HMAC", key, utf8.encode(value));

async function derive(secret: string, date: string): Promise<CryptoKey> {
  // TextEncoder creates a new, non-shared ArrayBuffer.
  let key = await importKey(utf8.encode(`AWS4${secret}`).buffer as ArrayBuffer);
  for (const part of [date, region, service, end]) key = await importKey(await mac(key, part));
  return key;
}

interface PresignInput {
  method: "GET" | "PUT";
  key: string;
  signedAt: number;
  expiresAt: number;
  headers?: Readonly<Record<string, string>>;
  query?: Readonly<Record<string, string>>;
}

export type R2Presigner = (input: PresignInput) => Promise<string>;
type R2SigningBindings = Pick<Bindings, "R2_ACCOUNT_ID" | "R2_EVIDENCE_BUCKET" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY">;

export function createR2Presigner(env: R2SigningBindings): R2Presigner | null {
  const { R2_ACCOUNT_ID: account, R2_EVIDENCE_BUCKET: bucket, R2_ACCESS_KEY_ID: access, R2_SECRET_ACCESS_KEY: secret } = env;
  if (!account || !/^[a-f0-9]{32}$/.test(account) || !bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)
    || !access || !/^[A-Za-z0-9]+$/.test(access) || !secret) return null;

  const host = `${account}.r2.cloudflarestorage.com`;
  let signingKey: { date: string; key: Promise<CryptoKey> } | undefined;
  return async ({ method, key, signedAt, expiresAt, headers, query }: PresignInput): Promise<string> => {
    const expires = Math.floor(expiresAt / 1_000) - Math.floor(signedAt / 1_000);
    if (expires < 1 || expires > 604_800) throw new RangeError("Invalid R2 grant lifetime");
    const time = new Date(signedAt).toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = time.slice(0, 8);
    const scope = `${date}/${region}/${service}/${end}`;
    const path = `/${bucket}/${key.split("/").map(encode).join("/")}`;
    const canonicalHeaders = Object.entries({ ...headers, host }).map(([name, value]) =>
      [name.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const).sort(([a], [b]) => compare(a, b));
    const signedHeaders = canonicalHeaders.map(([name]) => name).join(";");
    const canonicalQuery = Object.entries({
      ...query,
      "X-Amz-Algorithm": algorithm,
      "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD",
      "X-Amz-Credential": `${access}/${scope}`,
      "X-Amz-Date": time,
      "X-Amz-Expires": String(expires),
      "X-Amz-SignedHeaders": signedHeaders,
    }).map(([name, value]) => [encode(name), encode(value)] as const).sort(([an, av], [bn, bv]) => compare(an, bn) || compare(av, bv))
      .map(([name, value]) => `${name}=${value}`).join("&");
    const canonical = [method, path, canonicalQuery, canonicalHeaders.map(([name, value]) => `${name}:${value}\n`).join(""),
      signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
    if (signingKey?.date !== date) signingKey = { date, key: derive(secret, date) };
    const hash = await crypto.subtle.digest("SHA-256", utf8.encode(canonical));
    const signature = hex(await mac(await signingKey.key, `${algorithm}\n${time}\n${scope}\n${hex(hash)}`));
    return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  };
}
