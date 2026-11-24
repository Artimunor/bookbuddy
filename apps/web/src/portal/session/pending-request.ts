import type { StoredOperation } from "./pending-storage";

type RequestPayload = { payload?: unknown; expectedRevision?: number };

async function fingerprint(operationId: string, payload: unknown): Promise<string> {
  // The operation ID separates fingerprints across attempts. No request fields are stored.
  const encoded = new TextEncoder().encode(JSON.stringify([operationId, payload], (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
      : value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function requestAttempt(operationId: string, input: RequestPayload): Promise<NonNullable<StoredOperation["request"]>> {
  if (input.expectedRevision === undefined || input.payload === undefined) throw new TypeError("Missing request input");
  return { expectedRevision: input.expectedRevision, fingerprint: await fingerprint(operationId, input.payload) };
}

export async function requestReplay<P extends RequestPayload & { operationId: string }>(operation: StoredOperation, input: P): Promise<P | null> {
  if (!operation.retryReady || !operation.request ||
    operation.request.fingerprint !== await fingerprint(operation.operationId, input.payload)) return null;
  return { ...input, operationId: operation.operationId, expectedRevision: operation.request.expectedRevision };
}
