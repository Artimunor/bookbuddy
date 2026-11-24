import { getOperationRoute, type OperationStatus } from "@bookbuddy/api-contract";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSession } from "./index";
import { requestReplay } from "./pending-request";
import {
  clearPendingOperation, pendingOperationKey, pendingOperationScopeIsCurrent, readPendingOperation,
  savePendingOperation, settleMissingPendingOperation, type StoredOperation,
} from "./pending-storage";

type Operation = { operationId: string; expectedRevision?: number; payload?: unknown };
export type PendingOperationState = "idle" | "sending" | "checking" | "failed" | "unknown" | "committed";
export type PendingOperation<P> = {
  state: PendingOperationState;
  pending: StoredOperation | null;
  start: (input: P) => void;
  check: () => void;
  resend: (input: P) => (() => void) | undefined;
};
type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; delivery?: string } };

export function usePendingOperation<P extends Operation, R>(
  intentKey: string,
  routeId: string | ((input: P) => string),
  send: (input: P) => Promise<Result<R>>,
  onSuccess: ((value: R, input: P) => void) | undefined,
  onFailure: ((code: string) => void) | undefined,
  recovery: {
    onCommitted: (receipt: OperationStatus, operation: StoredOperation) => void;
    resourceIds?: (input: P) => readonly string[];
    includeResource?: true;
    sameRequestIntent?: (attempted: P, input: P) => boolean;
  },
): PendingOperation<P> {
  const { api, bootstrap, markUnauthenticated } = useSession();
  const identity = bootstrap ? `${bootstrap.sessionId}:${bootstrap.activeContext?.contextId ?? ""}` : null;
  const storage = useMemo(() => pendingOperationKey(identity, intentKey), [identity, intentKey]);
  const current = useRef(storage);
  current.current = storage;
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const busy = useRef<object | null>(null);
  const attemptedRequest = useRef<{ storage: NonNullable<typeof storage>; input: P } | null>(null);
  const [display, setDisplay] = useState<{ storage: typeof storage; state: PendingOperationState } | null>(null);

  function read(): StoredOperation | null {
    if (!storage) return null;
    const saved = readPendingOperation(storage);
    return saved && (typeof routeId !== "string" || saved.routeId === routeId) ? saved : null;
  }
  const pending = read();
  const visibleState = display?.storage === storage ? display.state : "idle";
  const state = visibleState === "sending" || (pending?.retryReady && visibleState === "failed") ? visibleState
    : pending ? pending.retryReady ? "unknown" : "checking" : visibleState;

  function viewIsCurrent() {
    return !!storage && mounted.current && current.current === storage && pendingOperationScopeIsCurrent(storage);
  }

  function release() { if (busy.current === storage) busy.current = null; }

  function submit(input: P, replaces?: string) {
    if (!storage || busy.current === storage || !viewIsCurrent()) return;
    const saved = read();
    if (replaces ? !saved?.retryReady || saved.operationId !== replaces : saved !== null) return;
    busy.current = storage;
    setDisplay({ storage, state: "sending" });
    if (!savePendingOperation(storage, { operationId: input.operationId,
      routeId: typeof routeId === "string" ? routeId : routeId(input), resourceIds: recovery.resourceIds?.(input),
      attemptedAt: Date.now(), expectedRevision: recovery.sameRequestIntent ? input.expectedRevision : undefined,
    })) {
      release();
      setDisplay({ storage, state: "failed" });
      return;
    }
    if (recovery.sameRequestIntent) attemptedRequest.current = { storage, input };
    void attempt(input);
  }

  function resend(input: P) {
    if (!recovery.sameRequestIntent || !storage || busy.current === storage || !viewIsCurrent()) return;
    const saved = read();
    if (!saved?.retryReady) return;
    const attempted = attemptedRequest.current;
    const replay = requestReplay(saved, attempted?.storage === storage ? attempted.input : undefined, input, recovery.sameRequestIntent);
    if (replay) { submit(replay, saved.operationId); return; }
    // The review dialog is the only caller of this continuation.
    return () => { void submit({ ...input, operationId: crypto.randomUUID() }, saved.operationId); };
  }

  async function attempt(input: P) {
    if (!storage) return;
    let result: Result<R>;
    try { result = await send(input); }
    catch { result = { ok: false, error: { code: "NETWORK_ERROR", delivery: "unknown" } }; }
    release();
    if (!pendingOperationScopeIsCurrent(storage)) return;
    if (!result.ok && result.error.code === "UNAUTHENTICATED") { markUnauthenticated(); return; }
    if (!viewIsCurrent()) return;
    const uncertain = !result.ok && (result.error.delivery === "unknown" || result.error.code === "INTERNAL_ERROR" ||
      (recovery.sameRequestIntent && result.error.code === "OPERATION_ID_REUSED"));
    if (!uncertain) {
      clearPendingOperation(storage, input.operationId);
      attemptedRequest.current = null;
    }
    if (result.ok) { setDisplay({ storage, state: "idle" }); onSuccess?.(result.data, input); }
    else if (uncertain) setDisplay({ storage, state: "checking" });
    else { setDisplay({ storage, state: "failed" }); onFailure?.(result.error.code); }
  }

  async function check() {
    if (!storage || busy.current === storage || !viewIsCurrent()) return;
    let operation = read();
    if (!operation) return;
    const checkedAt = Date.now();
    // Older metadata predates attempt timestamps. Give it a full window from its first lookup.
    if (operation.attemptedAt === undefined) {
      const dated = { ...operation, attemptedAt: checkedAt };
      if (savePendingOperation(storage, dated)) operation = dated;
    }
    busy.current = storage;
    setDisplay({ storage, state: "sending" });
    const result = await api.request(getOperationRoute, { params: { id: operation.operationId },
      ...(recovery.includeResource ? { query: { resource: "1" } } : {}) });
    release();
    if (!pendingOperationScopeIsCurrent(storage)) return;
    if (!result.ok && result.error.code === "UNAUTHENTICATED") { markUnauthenticated(); return; }
    if (!viewIsCurrent()) return;
    if (result.ok && result.data.operationId === operation.operationId) {
      clearPendingOperation(storage, operation.operationId);
      attemptedRequest.current = null;
      setDisplay({ storage, state: "committed" });
      recovery.onCommitted(result.data, operation);
    } else if (!result.ok && result.error.code === "NOT_FOUND" &&
      (operation.retryReady || settleMissingPendingOperation(storage, operation, checkedAt, !!recovery.sameRequestIntent))) {
      setDisplay({ storage, state: "unknown" });
    } else setDisplay({ storage, state: "checking" });
  }
  return { state, pending, start: submit, check: () => { void check(); }, resend };
}
