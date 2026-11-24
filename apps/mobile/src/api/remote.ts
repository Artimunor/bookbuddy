import type { RequestSchema, ResponseSchema, RouteDefinition, RouteRequest, RouteResponse } from "@bookbuddy/api-contract";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useCachedRead, useRepository, useVisibilityGeneration } from "../repository/hooks";
import { remoteReadKey } from "../repository/remote-cache";
import type { CachedRead, RemoteCacheKind } from "../repository/remote-cache";
import { useApiAccess } from "./provider";
import { idleRead, invalidRequest, offlineRead, requestKey, requestNotSent } from "./requests";
import type { ReadSnapshot } from "./requests";

export type RemoteAccess<Data, Cached = never> = (Exclude<ReadSnapshot<Data>, { status: "offline" }> | {
  status: "offline"; data: Cached | null; error: null; lastConfirmedAt: number | null;
}) & { refresh: () => Promise<void>; seed: (data: Data, serverTime: number) => void };

export function useRemote<Input extends RequestSchema, Output extends ResponseSchema, Kind extends RemoteCacheKind = never>(
  route: RouteDefinition<Input, Output> & { method: "GET" },
  input: NoInfer<RouteRequest<Input>>,
  { enabled = true, cache, loadOnMount = true }: { enabled?: boolean; cache?: { kind: Kind }; loadOnMount?: boolean } = {},
): RemoteAccess<RouteResponse<Output>, CachedRead<Kind>> {
  const { client, requests, connection, getConnection } = useApiAccess();
  const repo = useRepository();
  const allowed = enabled && requests.allows(route.auth, repo);
  const key = allowed && client ? requestKey(input) : null;
  const kind = cache?.kind;
  const cacheKey = useMemo(() => kind && key !== null ? remoteReadKey(kind, route, input) : null, [kind, route, key]);
  const cached = useCachedRead(kind, allowed && connection.offline ? cacheKey : null);
  const visibility = useVisibilityGeneration(repo);
  const getFence = useCallback(() => ({ ...getConnection(), visibility: repo?.visibilityGeneration ?? 0 }), [getConnection, repo]);
  const entry = useMemo(() => key !== null ? requests.read<RouteResponse<Output>>(repo ?? requests, route, `${kind ?? ""}:${key}`) : null,
    [requests, repo, route, key, client, kind]);
  const subscribe = useCallback((listener: () => void) => entry?.subscribe(listener) ?? (() => {}), [entry]);
  const snapshot = useCallback(() => entry?.getSnapshot({ ...connection, visibility }) ?? idleRead, [entry, connection, visibility]);
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);

  const read = useCallback((refresh: boolean) => {
    if (!entry || !client || !requests.allows(route.auth, repo)) return Promise.resolve();
    return entry.load(async (signal) => {
      if (!requests.allows(route.auth, repo)) return requestNotSent;
      const started = getFence();
      const result = await client.request(route, input, { signal });
      const now = getFence();
      if (repo && kind && cacheKey !== null && requests.allows(route.auth, repo) &&
        !signal.aborted && now.generation === started.generation && now.visibility === started.visibility) {
        if (result.ok) await repo.saveCachedRead(kind, cacheKey, result.data, result.meta.serverTime, started.visibility).catch(() => undefined);
        else if (result.error.code === "NOT_FOUND" || result.error.code === "UNAUTHENTICATED") {
          await repo.removeCachedRead(kind, cacheKey).catch(() => undefined);
        }
      }
      return result;
    }, { refresh, getConnection: getFence });
    // `entry` changes with the canonical input, not with a freshly allocated equivalent object.
  }, [entry, client, requests, repo, route, getFence, kind, cacheKey]);
  useEffect(() => { if (loadOnMount) void read(false); }, [read, loadOnMount]);
  const refresh = useCallback(() => read(true), [read]);
  const seed = useCallback((data: RouteResponse<Output>, serverTime: number) => {
    if (requests.allows(route.auth, repo)) entry?.seed(data, serverTime, getFence());
  }, [entry, requests, route, repo, getFence]);
  if (allowed && connection.offline) {
    return { ...offlineRead, data: cached?.data ?? null, lastConfirmedAt: cached?.confirmedAt ?? null, refresh, seed };
  }
  if (allowed && client && key === null) return { status: "error", data: null, error: invalidRequest.error, lastConfirmedAt: null, refresh, seed };
  return { ...current, refresh, seed };
}
