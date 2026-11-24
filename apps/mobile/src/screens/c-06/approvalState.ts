import { useSyncExternalStore } from "react";

type ApprovalState = "idle" | "checking";
const pending = new Set<string>();
const listeners = new Set<() => void>();
const key = (jobId: string, versionId: string) => JSON.stringify([jobId, versionId]);

export function setApprovalChecking(jobId: string, versionId: string, checking: boolean) {
  const id = key(jobId, versionId);
  if (checking ? pending.has(id) : !pending.has(id)) return;
  if (checking) pending.add(id); else pending.delete(id);
  listeners.forEach(listener => listener());
}

export function useApprovalState(jobId: string, versionId: string): ApprovalState {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => pending.has(key(jobId, versionId)) ? "checking" : "idle",
    () => "idle",
  );
}
