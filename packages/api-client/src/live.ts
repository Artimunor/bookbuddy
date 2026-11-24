import { parseLiveFrame } from "@bookbuddy/api-contract";
import type { LiveThreadCatchUp, LiveTopicKey } from "@bookbuddy/api-contract";

type LiveCallbacks = {
  onHint: () => void;
  onCatchUp?: (frame: LiveThreadCatchUp) => void;
  onUnavailable?: () => void;
  onScopeClosed?: () => void;
};

export function createLiveSubscription(
  topic: LiveTopicKey,
  open: (signal: AbortSignal) => Promise<WebSocket | null>,
  canReceive: () => boolean,
  callbacks: () => LiveCallbacks,
  resume = { opened: false },
) {
  let pending: AbortController | null = null;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearHint() {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  }

  function queueHint() {
    clearHint();
    timer = setTimeout(() => {
      timer = undefined;
      if (canReceive()) callbacks().onHint();
    }, 300);
  }

  function connect(reconcile: boolean | "always" = true) {
    if (!canReceive() || pending || socket) return false;
    const attempt = pending = new AbortController();
    void openSocket(attempt, reconcile);
    return true;
  }

  async function openSocket(attempt: AbortController, reconcile: boolean | "always") {
    let next: WebSocket | null = null;
    try { next = await open(attempt.signal); }
    catch { /* WebSocket setup can fail before a close event is possible. */ }
    if (pending === attempt) pending = null;
    if (attempt.signal.aborted || !canReceive()) { next?.close(); return; }
    if (!next) { callbacks().onUnavailable?.(); return; }
    const connected = socket = next;
    let ready = false;
    connected.onmessage = ({ data }) => {
      if (socket !== connected || !canReceive()) return;
      const frame = parseLiveFrame(data);
      if (!ready) {
        if (topic.kind === "thread" && frame?.kind === "thread_catch_up" && frame.page.threadId === topic.opaqueId
          && frame.details.id === topic.opaqueId && frame.details.audience === frame.page.audience) {
          ready = true;
          callbacks().onCatchUp?.(frame);
        } else if (topic.kind !== "thread" && frame?.kind === "ready") {
          ready = true;
          if (reconcile === "always" || (reconcile && resume.opened)) queueHint();
        } else {
          connected.close();
          return;
        }
        resume.opened = true;
      } else if (frame?.kind === "invalidate") {
        queueHint();
      }
    };
    connected.onerror = () => {
      if (socket !== connected || ready) return;
      // An upgrade denial may surface as an error before an abnormal close.
      disconnect();
      if (canReceive()) callbacks().onUnavailable?.();
    };
    connected.onclose = ({ code }) => {
      if (socket !== connected) return;
      socket = null;
      if (!canReceive()) return;
      if (!ready) callbacks().onUnavailable?.();
      else if (code === 1008) {
        clearHint();
        const current = callbacks();
        (current.onScopeClosed ?? current.onHint)(); // Reauthorize immediately.
      }
    };
  }

  function disconnect() {
    clearHint();
    pending?.abort();
    pending = null;
    const connected = socket;
    if (!connected) return;
    socket = null;
    connected.onmessage = null;
    connected.onclose = null;
    connected.onerror = null;
    connected.close();
  }

  return { connect, disconnect };
}
