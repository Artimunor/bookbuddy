import { createMediaClient } from "@bookbuddy/api-client";
import { attachmentIdSchema, mediaLimits, mediaScopeSchema, type MediaReadGrant } from "@bookbuddy/api-contract";
import { useIsFocused } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useApiAccess } from "../api/provider";
import { useRepository, useVisibilityGeneration } from "../repository/hooks";
import type { ScopedRepository } from "../repository/repository";
import type { AttachmentId, MediaScope } from "./types";

type ReadyGrant = Extract<MediaReadGrant, { state: "ready" }>;
type PreviewGrant = { grant: ReadyGrant; scope: MediaScope; authorized: () => boolean };
type Lookup = (id: AttachmentId, scope: MediaScope) => PreviewGrant | undefined;
const lookups = new WeakMap<ScopedRepository, Set<Lookup>>();
const previewGrants = new WeakMap<ScopedRepository, PreviewGrant>();
const noIds: ReadonlySet<AttachmentId> = new Set();
const noUrls: ReadonlyMap<string, string> = new Map();

function sameScope(left: MediaScope, right: MediaScope) {
  return left.caller === right.caller && left.parentScopeId === right.parentScopeId;
}

/** Only a tap on the existing preview opener can hand a batch grant to S-15. */
export function rememberBatchedPhotoPreview(repository: ScopedRepository, scope: MediaScope, id: AttachmentId) {
  previewGrants.delete(repository);
  for (const lookup of lookups.get(repository) ?? []) {
    const preview = lookup(id, scope);
    if (preview) {
      previewGrants.set(repository, preview);
      return;
    }
  }
}

export function takeBatchedPhotoPreview(repository: ScopedRepository, scope: MediaScope, id: AttachmentId) {
  const preview = previewGrants.get(repository);
  if (!preview) return undefined;
  previewGrants.delete(repository);
  return preview.grant.attachmentId === id && sameScope(preview.scope, scope) &&
    preview.grant.expiresAt > Date.now() && preview.authorized() ? preview.grant : undefined;
}

/** Preview linked photos with one grant request per authorization scope, up to the wire batch cap. */
export function useMediaReadBatch(ids: readonly string[], scope: MediaScope | null | undefined): ReadonlyMap<string, string> {
  const repository = useRepository();
  const visibility = useVisibilityGeneration(repository);
  const { client, connection, getConnection, requests } = useApiAccess();
  const focused = useIsFocused();
  const caller = scope?.caller;
  const parentScopeId = scope?.parentScopeId;
  const remote = useMemo(() => mediaScopeSchema.safeParse({ caller, parentScopeId }).data, [caller, parentScopeId]);
  const idsKey = JSON.stringify(ids);
  const photoIds = useMemo(() => {
    const parsed = new Set<AttachmentId>();
    for (const value of JSON.parse(idsKey) as string[]) {
      const id = attachmentIdSchema.safeParse(value).data;
      if (id) parsed.add(id);
    }
    return parsed;
  }, [idsKey]);
  const active = focused && !!repository?.isActive && requests.active && !connection.offline;
  const identity = useMemo(() => ({ remote, repository, visibility, connection, requests, client }),
    [remote, repository, visibility, connection, requests, client]);
  const updateInput = useRef<((ids: ReadonlySet<AttachmentId>, focused: boolean) => void) | null>(null);
  const [snapshot, setSnapshot] = useState<{ identity: typeof identity; grants: ReadonlyMap<AttachmentId, ReadyGrant> }>();

  useEffect(() => {
    if (!repository?.isActive || !client || !remote || !requests.active || connection.offline) return;
    const grants = new Map<AttachmentId, ReadyGrant | null>();
    let requested = noIds;
    let visible = false;
    const { createReadGrants } = createMediaClient(client);
    const abort = new AbortController();
    let foreground = AppState.currentState !== "background" && AppState.currentState !== "inactive";
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const authorized = () => {
      const live = getConnection();
      return repository.isActive && repository.visibilityGeneration === visibility && requests.active &&
        !live.offline && live.generation === connection.generation;
    };
    const current = () => !abort.signal.aborted && authorized();
    const bucket = lookups.get(repository) ?? new Set<Lookup>();
    lookups.set(repository, bucket);
    const lookup: Lookup = (id, previewScope) => {
      const grant = visible && grants.get(id);
      return grant && current() && sameScope(remote, previewScope) && grant.expiresAt > Date.now()
        ? { grant, scope: remote, authorized } : undefined;
    };
    bucket.add(lookup);

    function update() {
      if (!current()) return;
      clearTimeout(timer);
      const now = Date.now();
      let expiresAt = Infinity;
      const ready = new Map<AttachmentId, ReadyGrant>();
      for (const [id, grant] of grants) {
        if (!grant) continue;
        if (grant.expiresAt <= now) grants.delete(id);
        else {
          ready.set(id, grant);
          expiresAt = Math.min(expiresAt, grant.expiresAt);
        }
      }
      setSnapshot({ identity, grants: ready });
      if (expiresAt !== Infinity) timer = setTimeout(() => { update(); void load(); }, Math.max(0, expiresAt - Date.now()));
    }
    async function load() {
      if (pending || !visible || !foreground || !current()) return;
      const missing = [...requested].filter(id => !grants.has(id));
      if (!missing.length) return;
      pending = true;
      try {
        await Promise.all(Array.from({ length: Math.ceil(missing.length / mediaLimits.batch) }, async (_, i) => {
          const batch = missing.slice(i * mediaLimits.batch, (i + 1) * mediaLimits.batch);
          let reply;
          try { reply = await createReadGrants({ scope: remote!, attachmentIds: batch }, { signal: abort.signal }); }
          catch { /* A failed preview request leaves the existing attachment opener available. */ }
          if (!current()) return;
          const now = Date.now();
          for (const id of batch) if (requested.has(id)) grants.set(id, null);
          if (reply?.ok) {
            for (const grant of reply.data.grants) {
              if (grant.state === "ready" && grant.file.kind === "photo" && grant.expiresAt > now &&
                requested.has(grant.attachmentId) && batch.includes(grant.attachmentId)) {
                grants.set(grant.attachmentId, grant);
              }
            }
          }
        }));
      } finally {
        pending = false;
        update();
        // A previous grant can expire while another batch is in flight.
        void load();
      }
    }
    const app = AppState.addEventListener("change", state => {
      foreground = state === "active";
      if (foreground) { update(); void load(); }
    });
    const unsubscribe = repository.subscribe("projection", () => { if (!authorized()) abort.abort(); });
    updateInput.current = (next, focused) => {
      requested = next;
      visible = focused;
      for (const id of grants.keys()) if (!requested.has(id)) grants.delete(id);
      update();
      void load();
    };
    return () => {
      updateInput.current = null;
      abort.abort();
      bucket.delete(lookup);
      unsubscribe();
      clearTimeout(timer);
      app.remove();
    };
  }, [client, connection, getConnection, identity, remote, repository, requests, visibility]);

  useEffect(() => {
    updateInput.current?.(photoIds, active);
  }, [active, identity, photoIds]);

  if (!active || snapshot?.identity !== identity || !photoIds.size || !snapshot.grants.size) return noUrls;
  const urls = new Map<string, string>();
  const now = Date.now();
  for (const [id, grant] of snapshot.grants) {
    if (photoIds.has(id) && grant.expiresAt > now) urls.set(id, grant.url);
  }
  return urls;
}
