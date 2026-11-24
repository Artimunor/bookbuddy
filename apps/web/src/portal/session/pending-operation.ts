import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "./index";
import { clearPendingOperation, pendingOperationKey, pendingOperationScopeIsCurrent, readPendingOperation, savePendingOperation } from "./pending-storage";

type Operation = { operationId: string };
type State = "idle" | "sending" | "checking" | "failed";
export type PendingOperation<P> = { state: State; pending: P | null; start: (input: P) => void; check: () => void };
type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; delivery?: string } };

export function usePendingOperation<P extends Operation, R>(
  intentKey: string,
  routeId: string | ((input: P) => string),
  send: (input: P) => Promise<Result<R>>,
  onSuccess?: (value: R, input: P) => void,
  onFailure?: (code: string) => void,
): PendingOperation<P> {
  const { bootstrap, markUnauthenticated } = useSession();
  const identity = bootstrap ? `${bootstrap.sessionId}:${bootstrap.activeContext?.contextId ?? ""}` : null;
  const storage = useMemo(() => pendingOperationKey(identity, intentKey), [identity, intentKey]);
  const current = useRef(storage);
  current.current = storage;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const busy = useRef<object | null>(null);
  const [display, setDisplay] = useState<{ storage: typeof storage; state: State } | null>(null);

  function route(input: P) { return typeof routeId === "string" ? routeId : routeId(input); }
  function read(): P | null {
    if (!storage) return null;
    const saved = readPendingOperation(storage);
    if (!saved) return null;
    const input = { ...saved.input, operationId: saved.operationId } as P;
    return saved.routeId === route(input) ? input : null;
  }
  const pending = read();
  const state = display?.storage === storage && display.state === "sending" ? "sending"
    : pending ? "checking" : display?.storage === storage && display.state === "failed" ? "failed" : "idle";

  async function attempt(input: P, checking: boolean) {
    if (!storage || busy.current === storage || !pendingOperationScopeIsCurrent(storage)) return;
    busy.current = storage;
    setDisplay({ storage, state: "sending" });
    let result: Result<R>;
    try { result = await send(input); }
    catch { result = { ok: false, error: { code: "NETWORK_ERROR", delivery: "unknown" } }; }
    if (busy.current === storage) busy.current = null;
    if (!pendingOperationScopeIsCurrent(storage)) return;
    if (!result.ok && result.error.code === "UNAUTHENTICATED") { markUnauthenticated(); return; }
    // A failed retry that never reached the service does not resolve the first attempt.
    const uncertain = !result.ok && (result.error.delivery === "unknown" || result.error.code === "INTERNAL_ERROR" ||
      checking && (result.error.delivery === "not_sent" || result.error.code === "UNAVAILABLE"));
    if (!uncertain) clearPendingOperation(storage, input.operationId);
    if (!mounted.current || current.current !== storage) return;
    if (result.ok) { setDisplay({ storage, state: "idle" }); onSuccess?.(result.data, input); }
    else if (uncertain) setDisplay({ storage, state: "checking" });
    else { setDisplay({ storage, state: "failed" }); onFailure?.(result.error.code); }
  }

  function start(input: P) {
    if (!storage || busy.current === storage || read()) return;
    const { operationId, ...body } = input;
    if (!savePendingOperation(storage, { operationId, routeId: route(input), input: body })) {
      setDisplay({ storage, state: "failed" });
      return;
    }
    void attempt(input, false);
  }

  function check() {
    const input = read();
    if (input) void attempt(input, true);
    else if (pending && storage && pendingOperationScopeIsCurrent(storage)) {
      // An earlier attempt can settle after navigation but before this click.
      const { operationId, ...body } = pending;
      if (savePendingOperation(storage, { operationId, routeId: route(pending), input: body })) void attempt(pending, true);
    }
  }
  return { state, pending, start, check };
}
