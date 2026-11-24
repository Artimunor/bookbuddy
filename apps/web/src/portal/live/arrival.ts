import { useCallback, useSyncExternalStore } from "react";

const maxTimerDelay = 2_147_483_647;
const unsubscribe = () => {};

export function subscribeArrivalExpiry(end: number, onExpiry: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  function clearTimer() {
    clearTimeout(timer);
    timer = undefined;
  }
  function check() {
    clearTimer();
    const remaining = end - Date.now();
    if (remaining > 0) timer = setTimeout(check, Math.min(remaining, maxTimerDelay));
    else {
      document.removeEventListener("visibilitychange", onVisibility);
      onExpiry();
    }
  }
  function onVisibility() {
    if (document.visibilityState === "visible") check();
  }
  document.addEventListener("visibilitychange", onVisibility);
  check();
  return () => {
    clearTimer();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

export function useArrivalExpired(end: number | undefined) {
  const snapshot = useCallback(() => end !== undefined && Date.now() >= end, [end]);
  const subscribe = useCallback((changed: () => void) => end === undefined ? unsubscribe : subscribeArrivalExpiry(end, changed), [end]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
