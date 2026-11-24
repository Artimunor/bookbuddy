import { createMediaClient } from "@bookbuddy/api-client";
import { attachmentIdSchema, mediaScopeSchema } from "@bookbuddy/api-contract";
import type { MediaFile, MediaReadGrant } from "@bookbuddy/api-contract";
import { useIsFocused, useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { useApiAccess } from "../api/provider";
import { useRepository, useVisibilityGeneration } from "../repository/hooks";
import { useTransferRows } from "./attach";
import { useMediaAccess } from "./provider";
import type { MediaPreviewDetails } from "./provider";
import { rememberBatchedPhotoPreview, takeBatchedPhotoPreview } from "./read-batch";
import { isSentDraft } from "./types";
import type { AttachmentId, MediaScope, MediaTransfer } from "./types";

type ReadGrant = Extract<MediaReadGrant, { state: "ready" }>;
type ReadResult = { status: "ready"; uri: string; file: MediaFile; draft: MediaTransfer | null }
  | { status: "sent"; kind: MediaFile["kind"] }
  | { status: "loading" | "unavailable" | "error" | "offline" };
type RemoteResult = { status: "ready"; grant: ReadGrant } | { status: "loading" | "unavailable" | "error" };

export function useMediaRead(attachmentId: string | undefined, scope?: MediaScope | null) {
  const repository = useRepository();
  const visibility = useVisibilityGeneration(repository);
  const { client, connection, getConnection, requests } = useApiAccess();
  const focused = useIsFocused();
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => { setAttempt((value) => value + 1); }, []);
  const id = useMemo(() => attachmentIdSchema.safeParse(attachmentId).data, [attachmentId]);
  const caller = scope?.caller;
  const parentScopeId = scope?.parentScopeId;
  const remote = useMemo(() => id && mediaScopeSchema.safeParse({ caller, parentScopeId }).data, [id, caller, parentScopeId]);
  const draftQuery = useMemo(() => scope === undefined && id ? { attachmentId: id } : null, [scope === undefined, id, attempt]);
  const { rows: drafts, failed: draftFailed } = useTransferRows(draftQuery);
  const active = !!repository?.isActive && focused && requests.active;
  const identity = useMemo(() => ({ id, remote, repository, visibility, connection, requests, client, attempt }),
    [id, remote, repository, visibility, connection, requests, client, attempt]);
  const [snapshot, setSnapshot] = useState<{ identity: typeof identity; result: RemoteResult }>();

  useEffect(() => {
    if (!active || !id || !remote || !client || connection.offline) return;
    const { createReadGrants } = createMediaClient(client);
    const abort = new AbortController();
    let foreground = AppState.currentState !== "background" && AppState.currentState !== "inactive";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    let attempted = false;
    let validUntil: number | null = null;
    const current = () => !abort.signal.aborted && repository?.isActive && repository.visibilityGeneration === visibility &&
      requests.active && !getConnection().offline && getConnection().generation === connection.generation;
    const publish = (result: RemoteResult) => { if (current()) setSnapshot({ identity, result }); };
    async function load() {
      if (pending || !foreground || !current()) return;
      if (attempted && (validUntil === null || validUntil > Date.now())) return;
      pending = true;
      attempted = true;
      validUntil = null;
      publish({ status: "loading" });
      try {
        const shared = repository && takeBatchedPhotoPreview(repository, remote!, id!);
        const cached = shared && shared.expiresAt > Date.now() ? shared : undefined;
        const reply = cached ? undefined : await createReadGrants({ scope: remote!, attachmentIds: [id!] }, { signal: abort.signal });
        if (!current()) return;
        const grant = cached ?? (reply?.ok && reply.data.grants.find((entry) => entry.attachmentId === id));
        if (grant && grant.state === "ready" && (cached || grant.expiresAt > Date.now())) {
          validUntil = grant.expiresAt;
          publish({ status: "ready", grant });
          timer = setTimeout(() => {
            if (!foreground) publish({ status: "loading" });
            void load();
          }, grant.expiresAt - Date.now());
        } else {
          const unavailable = !reply || reply.ok || reply.error.code === "NOT_FOUND" || reply.error.code === "UNAUTHENTICATED";
          publish({ status: unavailable ? "unavailable" : "error" });
        }
      } catch { publish({ status: "error" }); }
      finally { pending = false; }
    }
    const app = AppState.addEventListener("change", (state) => {
      foreground = state === "active";
      if (foreground) void load();
    });
    const unsubscribe = repository?.subscribe("projection", () => { if (!current()) abort.abort(); });
    void load();
    return () => { abort.abort(); clearTimeout(timer); app.remove(); unsubscribe?.(); };
  }, [active, identity, id, remote, repository, client, connection, getConnection, requests, visibility]);

  let result: ReadResult;
  if (!id || (!draftQuery && !remote) || !active) result = { status: "unavailable" };
  else if (draftQuery) {
    const item = drafts?.[0];
    result = item?.fileUri ? { status: "ready", uri: item.fileUri, file: item.file, draft: item }
      : item && isSentDraft(item) ? { status: "sent", kind: item.file.kind }
      : { status: draftFailed ? "error" : drafts === null ? "loading" : "unavailable" };
  } else if (connection.offline) result = { status: "offline" };
  else if (!client) result = { status: "error" };
  else if (snapshot?.identity !== identity) result = { status: "loading" };
  else if (snapshot.result.status !== "ready") result = { status: snapshot.result.status };
  else {
    const { grant } = snapshot.result;
    result = grant.expiresAt > Date.now() ? { status: "ready", uri: grant.url, file: grant.file, draft: null } : { status: "loading" };
  }
  return { result, refresh };
}

// Captions and transcript text are projections from the caller, not URL parameters.
export function useOpenMediaPreview() {
  const router = useRouter();
  const repository = useRepository();
  const { showPreview } = useMediaAccess();
  return (attachmentId: AttachmentId, scope: MediaScope, details?: MediaPreviewDetails) => {
    if (!repository?.isActive) return;
    rememberBatchedPhotoPreview(repository, scope, attachmentId);
    showPreview(details ? { attachmentId, ...scope, details, repository } : null);
    router.push({ pathname: "/media/[attachmentId]", params: { attachmentId, ...scope } } as Href);
  };
}

export function useMediaPreviewDetails(attachmentId: string | undefined, scope: MediaScope | null) {
  const repository = useRepository();
  const { preview, showPreview } = useMediaAccess();
  const matched = repository?.isActive && scope && preview?.repository === repository && preview.attachmentId === attachmentId &&
    preview.caller === scope.caller && preview.parentScopeId === scope.parentScopeId ? preview : null;
  useEffect(() => () => {
    if (matched) showPreview((current) => current === matched ? null : current);
  }, [matched, showPreview]);
  return matched?.details;
}
