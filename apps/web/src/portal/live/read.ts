import type { ApiClient } from "@bookbuddy/api-client";
import { getVisitLiveRoute, type CustomerLiveVisit } from "@bookbuddy/api-contract";
import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";

export async function readCustomerLiveVisit(api: ApiClient, jobId: string, visitId: string, signal: AbortSignal, cursor?: string) {
  const result = await api.request(getVisitLiveRoute, { params: { id: visitId }, ...(cursor ? { query: { cursor } } : {}) }, { signal });
  return result.ok && "moments" in result.data && result.data.visitId === visitId && result.data.job.id === jobId ? result.data : null;
}

type LiveReadState = {
  visit: CustomerLiveVisit | null;
  failed: boolean;
  loading: boolean;
  canSubscribe: boolean;
};

const empty: LiveReadState = { visit: null, failed: false, loading: false, canSubscribe: false };

export function createLiveVisitRead(api: ApiClient, jobId: string, visitId: string | null) {
  let state = empty;
  let active: { controller: AbortController; authorization: boolean } | null = null;
  let reconcile = false;
  const listeners = new Set<() => void>();

  function publish(next: LiveReadState) {
    if (state === next) return;
    state = next;
    for (const listener of listeners) listener();
  }

  async function load(cursor?: string, authorization = false) {
    if (!visitId || active) return;
    const request = active = { controller: new AbortController(), authorization };
    publish({ ...state, visit: authorization ? null : state.visit, failed: false, loading: true });
    const page = await readCustomerLiveVisit(api, jobId, visitId, request.controller.signal, cursor);
    if (active !== request) return;
    active = null;
    const queued = reconcile;
    reconcile = false;
    // A page's summary is also current, even though its moments precede the cursor.
    const visit = cursor && state.visit && page ? { ...page, moments: [...state.visit.moments, ...page.moments] } : page;
    publish({ visit, failed: !visit, loading: false, canSubscribe: !!visit });
    if (queued && visit) void load();
  }

  function cancel() {
    const request = active;
    active = null;
    reconcile = false;
    request?.controller.abort();
  }

  function reauthorize() {
    if (active?.authorization) return;
    cancel();
    void load(undefined, true);
  }

  function hint() {
    if (active) reconcile = true;
    else if (state.visit) void load();
  }

  function reset() {
    cancel();
    publish(empty);
  }

  function watchVisibility(page: EventTarget & { readonly visibilityState: DocumentVisibilityState }) {
    let visible: boolean | undefined;
    function change() {
      const next = page.visibilityState === "visible";
      if (next === visible) return;
      visible = next;
      if (next) reauthorize();
      else reset();
    }
    page.addEventListener("visibilitychange", change);
    change();
    return () => {
      page.removeEventListener("visibilitychange", change);
      reset();
    };
  }

  return {
    load, hint, reauthorize, watchVisibility,
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export function useLiveVisitRead(api: ApiClient, jobId: string, visitId: string | null) {
  const read = useMemo(() => createLiveVisitRead(api, jobId, visitId), [api, jobId, visitId]);
  const state = useSyncExternalStore(read.subscribe, read.snapshot, () => empty);
  useLayoutEffect(() => read.watchVisibility(document), [read]);
  return [state, read] as const;
}
