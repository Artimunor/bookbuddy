import { idSchema, operationIdSchema } from "@bookbuddy/api-contract";

const prefix = "bookbuddy.pending-operation.v2:";
const scopeKey = `${prefix}scope`;
const legacyPrefix = "bookbuddy.pending-operation.v1:";
const legacy = /^(bookbuddy\.(pending-operation|quote-decision)\.v1:|bb\.(change|manage|window|withdrawal):)/;
const routePattern = /^(POST|PATCH|PUT|DELETE) \/(?:[a-z0-9_-]+|:[a-zA-Z][a-zA-Z0-9]*)(?:\/(?:[a-z0-9_-]+|:[a-zA-Z][a-zA-Z0-9]*))*$/;
let scope: string | null = null;
let generation = 0;

function removeEntries(matches: (key: string) => boolean) {
  for (let index = sessionStorage.length - 1; index >= 0; index--) {
    const key = sessionStorage.key(index);
    if (key && matches(key)) sessionStorage.removeItem(key);
  }
}

export function migrateLegacyPendingOperations() {
  try {
    const previousScope = sessionStorage.getItem(`${legacyPrefix}scope`);
    const currentScope = sessionStorage.getItem(scopeKey);
    const validScope = previousScope && /^[A-Za-z0-9_-]{1,256}:[A-Za-z0-9_-]{0,256}$/.test(previousScope) &&
      (currentScope === null || currentScope === previousScope);
    const sanitized: [string, StoredOperation][] = [];
    const entryPrefix = `${legacyPrefix}entry:`;
    removeEntries(key => {
      if (!legacy.test(key)) return false;
      if (validScope && key.startsWith(entryPrefix)) {
        try {
          const parts: unknown = JSON.parse(key.slice(entryPrefix.length));
          if (Array.isArray(parts) && parts.length === 2 && parts[0] === previousScope &&
            typeof parts[1] === "string" && validIntent(parts[1])) {
            const metadata = operationMetadata(JSON.parse(sessionStorage.getItem(key) ?? "null"));
            if (metadata) sanitized.push([`${prefix}entry:${JSON.stringify(parts)}`, metadata]);
          }
        } catch { /* Remove malformed entries without copying them. */ }
      }
      return true;
    });
    if (previousScope && sanitized.length) {
      sessionStorage.setItem(scopeKey, previousScope);
      for (const [key, metadata] of sanitized) if (sessionStorage.getItem(key) === null) {
        sessionStorage.setItem(key, JSON.stringify(metadata));
      }
    }
  } catch { /* Storage may be disabled. */ }
}

export function suspendPendingOperations() {
  generation++;
  scope = null;
}

export function activatePendingOperations(next: string | null) {
  if (next === null || next !== scope) generation++;
  scope = next;
  try {
    if (next !== null && sessionStorage.getItem(scopeKey) === next) return;
    removeEntries(key => key.startsWith(prefix) || legacy.test(key));
    if (next !== null) sessionStorage.setItem(scopeKey, next);
  } catch { /* Storage can be disabled; mutations require a saved receipt ID. */ }
}

export function clearPendingOperationsForSession(sessionId: string) {
  try {
    if (sessionStorage.getItem(scopeKey)?.startsWith(`${sessionId}:`)) activatePendingOperations(null);
  } catch { /* Storage may be disabled. */ }
}

const validIntent = (intent: string) => intent.split(":").every(part => idSchema.safeParse(part).success);
type StorageKey = { key: string; generation: number };
export function pendingOperationKey(identity: string | null, intent: string): StorageKey | null {
  return identity !== null && identity === scope && validIntent(intent)
    ? { key: `${prefix}entry:${JSON.stringify([identity, intent])}`, generation } : null;
}

export function pendingOperationScopeIsCurrent(key: StorageKey) { return key.generation === generation; }

export type StoredOperation = {
  operationId: string;
  routeId: string;
  resourceIds?: readonly string[];
  attemptedAt?: number;
  retryReady?: true;
  request?: { expectedRevision: number; fingerprint: string };
};

function operationMetadata(value: unknown): StoredOperation | null {
  if (!value || typeof value !== "object" || !("operationId" in value) || !("routeId" in value)) return null;
  const { operationId, routeId } = value;
  if (typeof operationId !== "string" || !operationIdSchema.safeParse(operationId).success ||
    typeof routeId !== "string" || !routePattern.test(routeId)) return null;
  const metadata: StoredOperation = { operationId, routeId };
  if ("resourceIds" in value && value.resourceIds !== undefined) {
    const ids: unknown = value.resourceIds;
    if (!Array.isArray(ids) || ids.length > 8 || ids.some(id => !idSchema.safeParse(id).success)) return null;
    metadata.resourceIds = ids as string[];
  }
  if ("attemptedAt" in value && typeof value.attemptedAt === "number" &&
    Number.isSafeInteger(value.attemptedAt) && value.attemptedAt >= 0) {
    metadata.attemptedAt = value.attemptedAt;
    if ("retryReady" in value && value.retryReady === true && routeId === "POST /requests") metadata.retryReady = true;
  }
  if (routeId === "POST /requests" && "request" in value && value.request &&
    typeof value.request === "object" && "expectedRevision" in value.request && "fingerprint" in value.request) {
    const { expectedRevision, fingerprint } = value.request;
    if (typeof expectedRevision === "number" && Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 &&
      typeof fingerprint === "string" && /^[a-f0-9]{64}$/.test(fingerprint)) {
      metadata.request = { expectedRevision, fingerprint };
    }
  }
  return metadata;
}
export function readPendingOperation(key: StorageKey): StoredOperation | null {
  if (!pendingOperationScopeIsCurrent(key)) return null;
  try {
    return operationMetadata(JSON.parse(sessionStorage.getItem(key.key) ?? "null"));
  } catch { return null; }
}

export function savePendingOperation(key: StorageKey, operation: StoredOperation) {
  if (!pendingOperationScopeIsCurrent(key)) return false;
  const metadata = operationMetadata(operation);
  if (!metadata) return false;
  try { sessionStorage.setItem(key.key, JSON.stringify(metadata)); return true; }
  catch { return false; }
}

export function clearPendingOperation(key: StorageKey, operationId: string) {
  if (readPendingOperation(key)?.operationId !== operationId) return;
  try { sessionStorage.removeItem(key.key); } catch { /* Storage can be disabled. */ }
}

const settleMs = 2 * 60_000;

export function settleMissingPendingOperation(
  key: StorageKey, operation: StoredOperation, checkedAt: number, retainForRetry: boolean,
): boolean {
  if (operation.attemptedAt === undefined || checkedAt - operation.attemptedAt < settleMs) return false;
  const current = readPendingOperation(key);
  if (current?.operationId !== operation.operationId || current.attemptedAt !== operation.attemptedAt) return false;
  if (retainForRetry) return savePendingOperation(key, { ...current, retryReady: true });
  clearPendingOperation(key, operation.operationId);
  return true;
}
