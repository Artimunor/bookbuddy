import type { RequestSchema, ResponseSchema, RouteDefinition, RouteRequest, RouteResponse } from "@bookbuddy/api-contract";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useRepository } from "../repository/hooks";
import { useApiAccess } from "./provider";
import { idleRead, invalidRequest, offlineRead, requestKey, requestNotSent } from "./requests";
import type { ReadSnapshot } from "./requests";

export type RemoteAccess<Data> = ReadSnapshot<Data> & { refresh: () => Promise<void> };

export function useRemote<Input extends RequestSchema, Output extends ResponseSchema>(
  route: RouteDefinition<Input, Output> & { method: "GET" },
  input: NoInfer<RouteRequest<Input>>,
  { enabled = true }: { enabled?: boolean } = {},
): RemoteAccess<RouteResponse<Output>> {
  const { client, requests, offline, isOffline } = useApiAccess();
  const repo = useRepository();
  const allowed = enabled && !!client && requests.allows(route.auth, repo);
  const key = allowed ? requestKey(input) : null;
  const entry = useMemo(() => key !== null ? requests.read<RouteResponse<Output>>(repo ?? requests, route, key) : null,
    [requests, repo, route, key, client]);
  const subscribe = useCallback((listener: () => void) => entry?.subscribe(listener) ?? (() => {}), [entry]);
  const snapshot = useCallback(() => entry?.getSnapshot() ?? idleRead, [entry]);
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);

  const read = useCallback((refresh: boolean) => {
    if (!entry || !client || !requests.allows(route.auth, repo)) return Promise.resolve();
    return entry.load(() => requests.allows(route.auth, repo)
      ? client.request(route, input)
      : Promise.resolve(requestNotSent), { refresh, isOffline });
    // `entry` changes with the canonical input, not with a freshly allocated equivalent object.
  }, [entry, client, requests, repo, route, isOffline]);
  useEffect(() => { void read(false); }, [read]);
  const refresh = useCallback(() => read(true), [read]);
  if (allowed && offline) return { ...offlineRead, refresh };
  if (allowed && key === null) return { status: "error", data: null, error: invalidRequest.error, refresh };
  return { ...current, refresh };
}
