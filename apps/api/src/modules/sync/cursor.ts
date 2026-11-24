import { syncCursorClaimsSchema } from "@bookbuddy/api-contract";
import type { SyncCursor } from "@bookbuddy/api-contract";

export type CursorPosition =
  | { phase: "delta"; seq: number; through?: number }
  | { phase: "snapshot"; anchor: number; kind: string; id: string }
  | { phase: "revoked" };

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const TTL = 7 * 24 * 60 * 60 * 1000;

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(encoded: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")), (ch) => ch.charCodeAt(0));
}

export async function createCursorCodec(secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return {
    async read(token: string): Promise<SyncCursor | null> {
      const [body, signature, extra] = token.split(".");
      if (!body || !signature || extra !== undefined || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(signature)) return null;
      try {
        if (!await crypto.subtle.verify("HMAC", key, decode(signature), encoder.encode(body))) return null;
        const result = syncCursorClaimsSchema.safeParse(JSON.parse(decoder.decode(decode(body))));
        return result.success ? result.data : null;
      } catch {
        return null;
      }
    },
    async issue(base: Pick<SyncCursor, "accountId" | "context" | "epoch" | "nextExpiry">, position: CursorPosition, now: number): Promise<string> {
      const body = encode(encoder.encode(JSON.stringify({ version: 1, ...base, ...position, expiresAt: now + TTL })));
      return `${body}.${encode(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body))))}`;
    },
  };
}
