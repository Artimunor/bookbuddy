import type { StoredOperation } from "./pending-storage";

export type PendingInput = { operationId: string; expectedRevision?: number };
export type CommandResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; delivery?: string } };
type Attempt<P, R> = { kind: "committed"; data: R; input: P } | { kind: "uncertain" } |
  { kind: "changed"; replacement: () => P } | { kind: "rejected"; code: string };

export async function attemptPendingOperation<P extends PendingInput, R>(
  send: (input: P) => Promise<CommandResult<R>>, current: P, previous?: StoredOperation,
): Promise<Attempt<P, R>> {
  const input = previous ? { ...current, operationId: previous.operationId, expectedRevision: previous.expectedRevision } : current;
  let result: CommandResult<R>;
  try { result = await send(input); }
  catch { return { kind: "uncertain" }; }
  if (result.ok) return { kind: "committed", data: result.data, input };
  const { code, delivery } = result.error;
  if (delivery === "unknown" || code === "INTERNAL_ERROR") return { kind: "uncertain" };
  if (previous && code === "OPERATION_ID_REUSED") {
    // Only a stored-input conflict permits a fresh ID, and only on confirmation.
    return { kind: "changed", replacement: () => ({ ...current, operationId: crypto.randomUUID() }) };
  }
  return { kind: "rejected", code };
}
