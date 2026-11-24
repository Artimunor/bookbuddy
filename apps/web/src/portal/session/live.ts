import { createApiClient, createLiveSubscription } from "@bookbuddy/api-client";
import type { LiveTopicKey } from "@bookbuddy/api-contract";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useSession } from "./index";

const liveClient = createApiClient({ baseUrl: "/api/v1", getSession: () => null, getLocale: () => "en" });

export function useLiveHints(topic: LiveTopicKey | null, onHint: (signal: AbortSignal) => void): () => void {
  const { activeContext, bootstrap, status } = useSession();
  const sessionId = status === "authenticated" ? bootstrap?.sessionId : null;
  const contextId = activeContext?.contextId;
  const kind = topic?.kind, opaqueId = topic?.opaqueId;
  const callback = useRef({ contextId, sessionId, kind, opaqueId, onHint });
  useLayoutEffect(() => { callback.current = { contextId, sessionId, kind, opaqueId, onHint }; });
  const retry = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!sessionId || !contextId || !kind || !opaqueId) return;
    const key = { kind, opaqueId };
    const lifetime = new AbortController();
    const subscription = createLiveSubscription(key,
      (signal) => liveClient.openLiveSocket(key, { signal, origin: window.location.origin, connect: (url) => new WebSocket(url) }),
      () => {
        const current = callback.current;
        return !lifetime.signal.aborted && document.visibilityState === "visible" &&
          current.sessionId === sessionId && current.contextId === contextId && current.kind === kind && current.opaqueId === opaqueId;
      },
      () => ({ onHint: () => callback.current.onHint(lifetime.signal) }));
    const open = () => { subscription.connect(); };
    const change = () => { if (document.visibilityState === "visible") open(); else subscription.disconnect(); };
    retry.current = () => { subscription.connect(false); };
    document.addEventListener("visibilitychange", change);
    change();
    return () => {
      lifetime.abort();
      retry.current = null;
      subscription.disconnect();
      document.removeEventListener("visibilitychange", change);
    };
  }, [sessionId, contextId, kind, opaqueId]);

  return useCallback(() => retry.current?.(), []);
}
