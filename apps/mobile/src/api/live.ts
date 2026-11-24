import { createLiveSubscription } from "@bookbuddy/api-client";
import type { LiveThreadCatchUp, LiveTopicKey } from "@bookbuddy/api-contract";
import { useFocusEffect } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { AppState, Platform } from "react-native";
import { useRepository, useVisibilityGeneration } from "../repository/hooks";
import { useApiAccess } from "./provider";

type Options = { onCatchUp?: (frame: LiveThreadCatchUp) => void; onUnavailable?: () => void; onScopeClosed?: () => void };
type BrowserEnvironment = {
  document?: {
    visibilityState: string;
    addEventListener(type: "visibilitychange", listener: () => void): void;
    removeEventListener(type: "visibilitychange", listener: () => void): void;
  };
  location?: { origin: string };
};

export function useLiveHints(topic: LiveTopicKey | null, onHint: () => void, options?: Options): () => boolean {
  const { client, isOffline, requests } = useApiAccess();
  const repo = useRepository();
  const visibility = useVisibilityGeneration(repo);
  const kind = topic?.kind, opaqueId = topic?.opaqueId;
  const scope = useMemo(() => ({ opened: false }), [client, kind, opaqueId, repo, requests, visibility]);
  const callbacks = useRef({ scope, onHint, ...options });
  useLayoutEffect(() => { callbacks.current = { scope, onHint, ...options }; });
  const retry = useRef<(() => boolean) | null>(null);

  useFocusEffect(useCallback(() => {
    if (!client || !kind || !opaqueId || !repo) return;
    const key = { kind, opaqueId };
    const browser = Platform.OS === "web";
    const { document: page, location } = globalThis as BrowserEnvironment;
    if (browser && (!page || !location)) return;
    const isForeground = () => browser ? page?.visibilityState === "visible" : AppState.currentState === "active";
    let foreground = isForeground();
    const subscription = createLiveSubscription(key, (signal) => browser
      ? client.openLiveSocket(key, { signal, origin: location?.origin, connect: (url) => new WebSocket(url) })
      : client.openLiveSocket(key, { signal, connect: (url, headers) => new WebSocket(url, [], { headers: headers ?? {} }) }),
    () => foreground && isForeground() && callbacks.current.scope === scope &&
      !isOffline() && requests.allows("context", repo) && repo.visibilityGeneration === visibility,
    () => callbacks.current, scope);
    const open = () => subscription.connect();
    const update = (next: boolean) => {
      if (foreground === next) return;
      foreground = next;
      if (next) open();
      else subscription.disconnect();
    };
    const onVisibility = () => update(isForeground());
    const listener = browser ? null : AppState.addEventListener("change", (state) => update(state === "active"));
    if (browser) page?.addEventListener("visibilitychange", onVisibility);
    retry.current = () => subscription.connect(false);
    if (foreground) open();
    return () => {
      foreground = false;
      retry.current = null;
      subscription.disconnect();
      listener?.remove();
      if (browser) page?.removeEventListener("visibilitychange", onVisibility);
    };
  }, [client, isOffline, kind, opaqueId, repo, requests, scope, visibility]));

  return useCallback(() => retry.current?.() ?? false, []);
}
