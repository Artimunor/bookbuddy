import { operationIdSchema } from "@bookbuddy/api-contract";

const prefix = "bookbuddy.pending-operation.v1:";
const scopeKey = `${prefix}scope`;
let scope: string | null = null;
let generation = 0;

export function activatePendingOperations(next: string | null) {
  if (next === null || next !== scope) generation++;
  scope = next;
  try {
    if (next !== null && sessionStorage.getItem(scopeKey) === next) return;
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key && (key.startsWith(prefix) || key.startsWith("bookbuddy.quote-decision.v1:") || /^bb\.(change|manage|window|withdrawal):/.test(key))) sessionStorage.removeItem(key);
    }
    if (next !== null) sessionStorage.setItem(scopeKey, next);
  } catch { /* Storage can be disabled; mutations require a saved replay entry. */ }
}

type StorageKey = { key: string; generation: number };
export function pendingOperationKey(identity: string | null, intent: string): StorageKey | null {
  return identity !== null && identity === scope ? { key: `${prefix}entry:${JSON.stringify([identity, intent])}`, generation } : null;
}

export function pendingOperationScopeIsCurrent(key: StorageKey) { return key.generation === generation; }

type StoredOperation = { operationId: string; routeId: string; input: Record<string, unknown> };
export function readPendingOperation(key: StorageKey): StoredOperation | null {
  if (!pendingOperationScopeIsCurrent(key)) return null;
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key.key) ?? "null");
    if (!value || typeof value !== "object" || !("operationId" in value) || !("routeId" in value) || !("input" in value)) return null;
    if (typeof value.operationId !== "string" || !operationIdSchema.safeParse(value.operationId).success || typeof value.routeId !== "string" || !value.input || typeof value.input !== "object" || Array.isArray(value.input)) return null;
    return { operationId: value.operationId, routeId: value.routeId, input: value.input as Record<string, unknown> };
  } catch { return null; }
}

export function savePendingOperation(key: StorageKey, operation: StoredOperation) {
  if (!pendingOperationScopeIsCurrent(key)) return false;
  try { sessionStorage.setItem(key.key, JSON.stringify(operation)); return true; }
  catch { return false; }
}

export function clearPendingOperation(key: StorageKey, operationId: string) {
  if (readPendingOperation(key)?.operationId !== operationId) return;
  try { sessionStorage.removeItem(key.key); } catch { /* Storage can be disabled. */ }
}
