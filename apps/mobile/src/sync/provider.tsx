import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";
import type { NetworkState } from "expo-network";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import type { AttachmentId } from "../media/types";
import type { ScopedRepository } from "../repository/repository";
import type { SyncResult, SyncRunner } from "./runner";

const foregroundStaleAfter = 60_000;
export interface SyncAccess {
  busy: boolean;
  lastResult: SyncResult | null;
  refresh: () => Promise<SyncResult>;
}
const SyncContext = createContext<SyncAccess | null>(null);

export function SyncProvider({ children, runner, repository }: { children: ReactNode; runner: SyncRunner | null; repository: ScopedRepository | null }) {
  const [attempt, setAttempt] = useState<{ repository: ScopedRepository; busy: boolean; lastResult: SyncResult | null }>();
  const lastConfirmed = useRef<{ repository: ScopedRepository; at: number } | null>(null);
  const refresh = useCallback(async (): Promise<SyncResult> => {
    if (!repository?.isActive) return { status: "closed" };
    if (!runner) return { status: "unsent", code: "API_NOT_CONFIGURED" };
    setAttempt({ repository, busy: true, lastResult: null });
    const result = await runner.refresh(repository);
    if (repository.isActive) {
      if (result.status === "confirmed") lastConfirmed.current = { repository, at: Date.now() };
      setAttempt({ repository, busy: false, lastResult: result });
    }
    return result;
  }, [repository, runner]);

  useEffect(() => {
    if (!repository) return;
    let foreground = AppState.currentState !== "background" && AppState.currentState !== "inactive";
    let online: boolean | undefined;
    let resumedConnection = false;
    let live = true;
    let progressReady = new Set<AttachmentId>();
    const permitted = () => live && foreground && online !== false && repository.isActive;
    const flushProgress = () => {
      if (!runner || !permitted() || !progressReady.size) return;
      const ids = progressReady;
      progressReady = new Set();
      void runner.refreshReadyProgress(repository, ids, permitted, refresh).then((handled) => {
        if (handled || !live || !repository.isActive) return;
        for (const id of ids) progressReady.add(id);
        flushProgress();
      }, () => {});
    };
    const progress = runner ? repository.subscribeProgressReady((ids) => {
      for (const id of ids) progressReady.add(id);
      flushProgress();
    }) : null;
    const expire = () => { void repository.expireDrafts().catch(() => undefined); };
    const initial = () => { if (live && foreground && online !== false && runner) void refresh(); };
    const onNetwork = (state: NetworkState) => {
      const previous = online;
      online = state.isConnected !== false && state.isInternetReachable !== false;
      if (previous === false && online) {
        if (foreground) { initial(); flushProgress(); }
        else resumedConnection = true;
      }
    };
    const app = AppState.addEventListener("change", (state) => {
      const wasForeground = foreground;
      foreground = state === "active";
      if (!foreground || wasForeground) return;
      expire();
      const latest = lastConfirmed.current;
      if (resumedConnection || latest?.repository !== repository || Date.now() - latest.at >= foregroundStaleAfter) initial();
      resumedConnection = false;
      flushProgress();
    });
    expire();
    const network = runner ? addNetworkStateListener(onNetwork) : null;
    if (runner) void getNetworkStateAsync().then((state) => {
      if (live && online === undefined) onNetwork(state);
      initial();
    }, initial);
    return () => {
      live = false;
      app.remove();
      network?.remove();
      progress?.();
    };
  }, [repository, runner, refresh]);

  const current = attempt?.repository === repository ? attempt : null;
  const value = useMemo<SyncAccess>(() => ({ busy: current?.busy ?? false, lastResult: current?.lastResult ?? null, refresh }), [current, refresh]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncAccess {
  const context = useContext(SyncContext);
  if (!context) throw new Error("SessionProvider is required");
  return context;
}
