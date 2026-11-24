import { getOperationRoute, type OperationStatus } from "@bookbuddy/api-contract";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSession } from "./index";
import { clearPendingOperation, pendingOperationKey, pendingOperationScopeIsCurrent, readPendingOperation, savePendingOperation, type StoredOperation } from "./pending-storage";

type Operation = { operationId: string };
export type PendingOperationState = "idle" | "sending" | "checking" | "failed" | "unknown" | "committed";
export type PendingOperation<P> = { state: PendingOperationState; pending: StoredOperation | null; start: (input: P) => void; check: () => void };
type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; delivery?: string } };

export function usePendingOperation<P extends Operation, R>(
  intentKey: string,
  routeId: string | ((input: P) => string),
  send: (input: P) => Promise<Result<R>>,
  onSuccess: ((value: R, input: P) => void) | undefined,
  onFailure: ((code: string) => void) | undefined,
  recovery: { onCommitted: (receipt: OperationStatus, operation: StoredOperation) => void; resourceIds?: (input: P) => readonly string[]; includeResource?: true },
): PendingOperation<P> {
  const { api, bootstrap, markUnauthenticated } = useSession();
  const identity = bootstrap ? `${bootstrap.sessionId}:${bootstrap.activeContext?.contextId ?? ""}` : null;
  const storage = useMemo(() => pendingOperationKey(identity, intentKey), [identity, intentKey]);
  const current = useRef(storage);
  current.current = storage;
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const busy = useRef<object | null>(null);
  const [display, setDisplay] = useState<{ storage: typeof storage; state: PendingOperationState } | null>(null);

  function read(): StoredOperation | null {
    if (!storage) return null;
    const saved = readPendingOperation(storage);
    return saved && (typeof routeId !== "string" || saved.routeId === routeId) ? saved : null;
  }
  const pending = read();
  const state = display?.storage === storage && display.state === "sending" ? "sending"
    : pending ? "checking" : display?.storage === storage ? display.state : "idle";

  function start(input: P) {
    if (!storage || busy.current === storage || read()) return;
    if (!savePendingOperation(storage, { operationId: input.operationId,
      routeId: typeof routeId === "string" ? routeId : routeId(input), resourceIds: recovery.resourceIds?.(input),
    })) {
      if (pendingOperationScopeIsCurrent(storage)) setDisplay({ storage, state: "failed" });
      return;
    }
    void attempt(input);
  }

  async function attempt(input: P) {
    if (!storage) return;
    busy.current = storage;
    setDisplay({ storage, state: "sending" });
    let result: Result<R>;
    try { result = await send(input); }
    catch { result = { ok: false, error: { code: "NETWORK_ERROR", delivery: "unknown" } }; }
    if (busy.current === storage) busy.current = null;
    if (!pendingOperationScopeIsCurrent(storage)) return;
    if (!result.ok && result.error.code === "UNAUTHENTICATED") { markUnauthenticated(); return; }
    if (!mounted.current || current.current !== storage) return;
    const uncertain = !result.ok && (result.error.delivery === "unknown" || result.error.code === "INTERNAL_ERROR");
    if (!uncertain) clearPendingOperation(storage, input.operationId);
    if (result.ok) { setDisplay({ storage, state: "idle" }); onSuccess?.(result.data, input); }
    else if (uncertain) setDisplay({ storage, state: "checking" });
    else { setDisplay({ storage, state: "failed" }); onFailure?.(result.error.code); }
  }

  async function check() {
    if (!storage || busy.current === storage || !pendingOperationScopeIsCurrent(storage)) return;
    const operation = read();
    if (!operation) return;
    busy.current = storage;
    setDisplay({ storage, state: "sending" });
    const result = await api.request(getOperationRoute, { params: { id: operation.operationId },
      ...(recovery.includeResource ? { query: { resource: "1" } } : {}) });
    if (busy.current === storage) busy.current = null;
    if (!pendingOperationScopeIsCurrent(storage)) return;
    if (!result.ok && result.error.code === "UNAUTHENTICATED") { markUnauthenticated(); return; }
    if (!mounted.current || current.current !== storage) return;
    if (result.ok && result.data.operationId === operation.operationId) {
      clearPendingOperation(storage, operation.operationId);
      setDisplay({ storage, state: "committed" });
      recovery.onCommitted(result.data, operation);
    } else if (!result.ok && result.error.code === "NOT_FOUND") {
      clearPendingOperation(storage, operation.operationId);
      setDisplay({ storage, state: "unknown" });
    } else setDisplay({ storage, state: "checking" });
  }
  return { state, pending, start, check: () => { void check(); } };
}
