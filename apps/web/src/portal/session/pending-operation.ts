import { getOperationRoute, type OperationStatus } from "@bookbuddy/api-contract";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSession } from "./index";
import { attemptPendingOperation, type CommandResult, type PendingInput } from "./pending-attempt";
import {
  anonymousSupportScope, clearPendingOperation, pendingOperationKey, pendingOperationScopeIsCurrent,
  preparePendingRetry, readPendingOperation, savePendingOperation, settleMissingPendingOperation, type StorageKey, type StoredOperation,
} from "./pending-storage";

export type PendingOperationState = "idle" | "sending" | "checking" | "failed" | "unknown" | "committed";
export type PendingOperation<P> = {
  state: PendingOperationState;
  pending: StoredOperation | null;
  canResend: boolean;
  replacement: { confirm: () => void; dismiss: () => void } | null;
  start: (input: P) => void;
  check: () => void;
  resend: (input: P) => void;
};
type Display<P> = {
  storage: StorageKey;
  state: PendingOperationState;
  replacement?: { operationId: string; confirmedInput: () => P };
};

export function usePendingOperation<P extends PendingInput, R>(
  intentKey: string,
  send: (input: P) => Promise<CommandResult<R>>,
  onSuccess: ((value: R, input: P) => void) | undefined,
  onFailure: ((code: string) => void) | undefined,
  recovery: {
    onCommitted?: (receipt: OperationStatus) => void;
    allowAnonymous?: true;
    includeResource?: true;
    replay?: true;
    placeId?: (input: P) => string;
  },
): PendingOperation<P> {
  const { api, bootstrap, markUnauthenticated, status } = useSession();
  const identity = bootstrap ? `${bootstrap.sessionId}:${bootstrap.activeContext?.contextId ?? ""}`
    : recovery.allowAnonymous && status === "unauthenticated" ? anonymousSupportScope : null;
  const key = pendingOperationKey(identity, intentKey);
  const storage = useMemo(() => key, [key?.key, key?.generation]);
  const current = useRef(storage);
  current.current = storage;
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const busy = useRef<StorageKey | null>(null);
  const attemptTime = useRef<{ storage: StorageKey; operationId: string; at: number } | null>(null);
  const [display, setDisplay] = useState<Display<P> | null>(null);
  const pending = storage ? readPendingOperation(storage) : null;
  const canResend = pending !== null && !!recovery.replay && (!recovery.placeId || pending.expectedRevision !== undefined);
  const visible = display?.storage === storage ? display : null;
  const state = visible?.state === "sending" || visible?.state === "failed" ? visible.state
    : pending ? canResend ? "unknown" : "checking" : visible?.state ?? "idle";

  function viewIsCurrent() {
    return !!storage && mounted.current && current.current === storage && pendingOperationScopeIsCurrent(storage);
  }

  function release() { if (busy.current === storage) busy.current = null; }

  function submit(input: P, replaces?: string) {
    if (!storage || busy.current === storage || !viewIsCurrent()) return;
    if (readPendingOperation(storage)?.operationId !== replaces) return;
    if (!savePendingOperation(storage, { operationId: input.operationId,
      expectedRevision: recovery.replay ? input.expectedRevision : undefined, placeId: recovery.placeId?.(input),
    })) {
      setDisplay({ storage, state: "failed" });
      return;
    }
    if (!recovery.replay) attemptTime.current = { storage, operationId: input.operationId, at: Date.now() };
    void attempt(input);
  }

  function resend(input: P) {
    if (!storage || busy.current === storage || !viewIsCurrent() || !canResend || !pending) return;
    const previous = preparePendingRetry(storage, pending.operationId, recovery.placeId?.(input), input.expectedRevision);
    if (previous) void attempt(input, previous);
    else if (pending.reviewPlace) setDisplay({ storage, state: "failed" });
  }

  async function attempt(input: P, previous?: StoredOperation) {
    if (!storage) return;
    const operationId = previous?.operationId ?? input.operationId;
    busy.current = storage;
    setDisplay({ storage, state: "sending" });
    const result = await attemptPendingOperation(send, input, previous, recovery.replay ? recovery.placeId : undefined);
    release();
    if (!pendingOperationScopeIsCurrent(storage)) return;
    if (result.kind === "rejected" && result.code === "UNAUTHENTICATED" && bootstrap) {
      markUnauthenticated();
      return;
    }
    if (!viewIsCurrent() || readPendingOperation(storage)?.operationId !== operationId) return;
    if (result.kind === "committed") {
      clearPendingOperation(storage, operationId);
      setDisplay({ storage, state: "idle" });
      onSuccess?.(result.data, result.input);
    } else if (result.kind === "changed") {
      setDisplay({ storage, state: "unknown", replacement: { operationId, confirmedInput: result.replacement } });
    } else if (result.kind === "uncertain") {
      setDisplay({ storage, state: "checking" });
    } else if (result.kind === "stale") {
      const saved = savePendingOperation(storage, result.operation);
      setDisplay({ storage, state: saved ? "unknown" : "failed" });
    } else {
      if (!previous) clearPendingOperation(storage, operationId);
      setDisplay({ storage, state: "failed" });
      onFailure?.(result.code);
    }
  }

  async function check() {
    if (!storage || !recovery.onCommitted || busy.current === storage || !viewIsCurrent()) return;
    const operation = readPendingOperation(storage);
    if (!operation) return;
    const checkedAt = Date.now();
    const clock = attemptTime.current;
    if (!recovery.replay && (clock?.storage !== storage || clock.operationId !== operation.operationId)) {
      attemptTime.current = { storage, operationId: operation.operationId, at: checkedAt };
    }
    busy.current = storage;
    setDisplay({ storage, state: "sending" });
    const result = await api.request(getOperationRoute, { params: { id: operation.operationId },
      ...(recovery.includeResource ? { query: { resource: "1" } } : {}) });
    release();
    if (!pendingOperationScopeIsCurrent(storage)) return;
    if (!result.ok && result.error.code === "UNAUTHENTICATED") { markUnauthenticated(); return; }
    if (!viewIsCurrent() || readPendingOperation(storage)?.operationId !== operation.operationId) return;
    if (result.ok && result.data.operationId === operation.operationId) {
      clearPendingOperation(storage, operation.operationId);
      setDisplay({ storage, state: "committed" });
      recovery.onCommitted(result.data);
    } else if (!result.ok && result.error.code === "NOT_FOUND" && !recovery.replay &&
      settleMissingPendingOperation(storage, operation.operationId, attemptTime.current?.at ?? checkedAt, checkedAt)) {
      setDisplay({ storage, state: "unknown" });
    } else setDisplay({ storage, state: "checking" });
  }

  const changed = visible?.replacement;
  const replacement = storage && changed && pending?.operationId === changed.operationId ? {
    confirm: () => submit(changed.confirmedInput(), changed.operationId),
    dismiss: () => setDisplay({ storage, state: "unknown" }),
  } : null;
  return { state, pending, canResend, replacement, start: submit, check: () => { void check(); }, resend };
}
