import { createApiClient, createLiveSubscription } from "@bookbuddy/api-client";
import type { LiveTopicKey } from "@bookbuddy/api-contract";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useSession } from "./index";

const liveClient = createApiClient({ baseUrl: "/api/v1", getSession: () => null, getLocale: () => "en" });

export function useLiveHints(topic: LiveTopicKey | null, onHint: () => void, onUnavailable: () => void) {
  const { activeContext, bootstrap, status } = useSession();
  const sessionId = status === "authenticated" ? bootstrap?.sessionId : null;
  const contextId = activeContext?.contextId;
  const kind = topic?.kind, opaqueId = topic?.opaqueId;
  const callback = useRef({ contextId, sessionId, kind, opaqueId, onHint, onUnavailable });
  useLayoutEffect(() => { callback.current = { contextId, sessionId, kind, opaqueId, onHint, onUnavailable }; });

  useEffect(() => {
    if (!sessionId || !contextId || !kind || !opaqueId) return;
    const key = { kind, opaqueId };
    const subscription = createLiveSubscription(key,
      (signal) => liveClient.openLiveSocket(key, { signal, origin: window.location.origin, connect: (url) => new WebSocket(url) }),
      () => {
        const current = callback.current;
        return document.visibilityState === "visible" &&
          current.sessionId === sessionId && current.contextId === contextId && current.kind === kind && current.opaqueId === opaqueId;
      },
      () => ({
        onHint: callback.current.onHint,
        onUnavailable: callback.current.onUnavailable,
        onScopeClosed: callback.current.onUnavailable,
      }));
    // A change may have been published between the exact visit read and socket attachment.
    subscription.connect("always");
    return () => subscription.disconnect();
  }, [sessionId, contextId, kind, opaqueId]);
}
