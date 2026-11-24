import { idSchema, operationIdSchema } from "@bookbuddy/api-contract";

const prefixes = ["bookbuddy.pending-operation.v3:", "bookbuddy.pending-operation.v2:", "bookbuddy.pending-operation.v1:"] as const;
const [prefix] = prefixes;
const scopeKey = `${prefix}scope`;
const obsolete = /^(bookbuddy\.quote-decision\.v1:|bb\.(change|manage|window|withdrawal):)/;
export const anonymousSupportScope = "anonymous";
export const supportIntent = "support-intake";
let scope: string | null = null;
let generation = 0;

const entryKey = (identity: string, intent: string) => `${prefix}entry:${JSON.stringify([identity, intent])}`;
const validIntent = (identity: string, intent: string) => identity === anonymousSupportScope
  ? intent === supportIntent : intent.split(":").every(part => idSchema.safeParse(part).success);

function storedScope(): string | null {
  for (const version of prefixes) {
    const saved = sessionStorage.getItem(`${version}scope`);
    if (saved !== null) return saved === anonymousSupportScope || /^[A-Za-z0-9_-]{1,256}:[A-Za-z0-9_-]{0,256}$/.test(saved)
      ? saved : null;
  }
  return null;
}

function rewritePendingStorage(previous: string | null, next: string | null) {
  const keep = next !== null && previous === next;
  const migrated = new Map<string, { version: number; metadata: string }>();
  let hasScope = false;
  for (let index = sessionStorage.length - 1; index >= 0; index--) {
    const key = sessionStorage.key(index);
    if (!key) continue;
    const version = prefixes.findIndex(candidate => key.startsWith(candidate));
    if (version === -1 && !obsolete.test(key)) continue;
    if (keep && key === scopeKey) { hasScope = true; continue; }
    const entry = version === -1 ? null : `${prefixes[version]}entry:`;
    if (keep && entry && key.startsWith(entry)) {
      try {
        const parts: unknown = JSON.parse(key.slice(entry.length));
        if (Array.isArray(parts) && parts.length === 2 && parts[0] === next &&
          typeof parts[1] === "string" && validIntent(next, parts[1])) {
          const raw = sessionStorage.getItem(key);
          const value: unknown = JSON.parse(raw ?? "null");
          const intent = parts[1];
          const metadata = operationMetadata(value, version !== 0 && (intent === "submit-request" || intent.startsWith("place:")));
          if (metadata) {
            // A decline needs no invitation read after recovering its receipt.
            const decline = version !== 0 && intent.startsWith("invitation:") && value && typeof value === "object" &&
              "routeId" in value && value.routeId === "POST /invitations/:id/decline";
            const target = entryKey(next, decline ? `invitation-decline:${intent.slice("invitation:".length)}` : intent);
            const clean = JSON.stringify(metadata);
            if (version === 0 && target === key && clean === raw) continue;
            const duplicate = migrated.get(target);
            if (!duplicate || version < duplicate.version) migrated.set(target, { version, metadata: clean });
          }
        }
      } catch { /* Remove malformed entries without copying them. */ }
    }
    sessionStorage.removeItem(key);
  }
  if (next !== null && !hasScope) sessionStorage.setItem(scopeKey, next);
  for (const [key, { metadata }] of migrated) {
    if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, metadata);
  }
}

export function migrateLegacyPendingOperations() {
  try {
    const previous = storedScope();
    rewritePendingStorage(previous, previous);
  } catch { /* Storage may be disabled. */ }
}

export function suspendPendingOperations() {
  generation++;
  scope = null;
}

export function activatePendingOperations(next: string | null) {
  if (next === null || next !== scope) generation++;
  scope = next;
  try { rewritePendingStorage(storedScope(), next); }
  catch { /* Storage can be disabled; mutations require a saved receipt ID. */ }
}

export function clearPendingOperationsForSession(sessionId: string) {
  try {
    if (storedScope()?.startsWith(`${sessionId}:`)) activatePendingOperations(null);
  } catch { /* Storage may be disabled. */ }
}

export type StorageKey = { key: string; generation: number };
export function pendingOperationKey(identity: string | null, intent: string): StorageKey | null {
  return identity !== null && identity === scope && validIntent(identity, intent)
    ? { key: entryKey(identity, intent), generation } : null;
}

export function pendingOperationScopeIsCurrent(key: StorageKey) { return key.generation === generation; }

export type StoredOperation = {
  operationId: string;
  expectedRevision?: number;
  placeId?: string;
};

function operationMetadata(value: unknown, legacyPlace = false): StoredOperation | null {
  if (!value || typeof value !== "object" || !("operationId" in value)) return null;
  const operationId = operationIdSchema.safeParse(value.operationId);
  if (!operationId.success) return null;
  const metadata: StoredOperation = { operationId: operationId.data };
  if ("expectedRevision" in value && typeof value.expectedRevision === "number" &&
    Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0) {
    metadata.expectedRevision = value.expectedRevision;
  }
  const placeId = "placeId" in value ? value.placeId
    : legacyPlace && "resourceIds" in value && Array.isArray(value.resourceIds) ? value.resourceIds[0] : undefined;
  const place = idSchema.safeParse(placeId);
  if (place.success) metadata.placeId = place.data;
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
  if (readPendingOperation(key)?.operationId !== operationId) return false;
  try { sessionStorage.removeItem(key.key); return true; }
  catch { return false; }
}

const settleMs = 2 * 60_000;

export function settleMissingPendingOperation(
  key: StorageKey, operationId: string, attemptedAt: number, checkedAt: number,
): boolean {
  return checkedAt - attemptedAt >= settleMs && clearPendingOperation(key, operationId);
}
