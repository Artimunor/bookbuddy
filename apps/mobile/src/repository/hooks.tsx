import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { AttachmentId } from "../media/types";
import { useSync } from "../sync/provider";
import { retryOutboxOperation } from "../sync/runner";
import type { SyncResult } from "../sync/runner";
import type { AttendanceStatus } from "./attendance";
import { draftExpiresAfter, snapshotWindow } from "./cache";
import type { CachedProjections, ProjectionKind } from "./cache";
import type { RemoteCacheKind } from "./remote-cache";
import type { Draft, DraftKey, DraftValue, NewOperation, OutboxEntry, PendingDraft, ProgressReceipt, ProjectionQuery, RepositoryTopic, Scope, ScopedRepository } from "./repository";

const RepositoryContext = createContext<ScopedRepository | null>(null);
const empty: readonly never[] = [];

export function RepositoryProvider({ children, repository }: { children: ReactNode; repository: ScopedRepository | null }) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): ScopedRepository | null { return useContext(RepositoryContext); }

export function useVisibilityGeneration(repo: ScopedRepository | null): number {
  const subscribe = useCallback((listener: () => void) => repo?.subscribe("projection", listener) ?? (() => {}), [repo]);
  const snapshot = useCallback(() => repo?.visibilityGeneration ?? 0, [repo]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function useRead<T>(topic: RepositoryTopic, read: (repo: ScopedRepository) => Promise<T>) {
  const repo = useRepository();
  const subscribe = useCallback((listener: () => void) => repo?.subscribe(topic, listener) ?? (() => {}), [repo, topic]);
  const snapshot = useCallback(() => repo?.revision(topic) ?? 0, [repo, topic]);
  const revision = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [result, setResult] = useState<{ repo: ScopedRepository; revision: number; read: typeof read } & (
    { ok: true; value: T } | { ok: false; error: unknown }
  )>();
  useEffect(() => {
    if (!repo?.isActive) return;
    let live = true;
    void read(repo).then(
      (value) => { if (live) setResult({ repo, revision, read, ok: true, value }); },
      (error: unknown) => { if (live) setResult({ repo, revision, read, ok: false, error }); },
    );
    return () => { live = false; };
  }, [repo, revision, read]);
  if (!repo?.isActive || result?.repo !== repo || result.revision !== revision || result.read !== read) return null;
  if (!result.ok) throw result.error;
  return result.value;
}

function useDeadline(at: number | undefined, now: () => number) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (at === undefined || at <= now()) return;
    let timeout: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining = at - now();
      if (remaining <= 0) tick((revision) => revision + 1);
      else timeout = setTimeout(check, remaining);
    };
    check();
    return () => { clearTimeout(timeout); };
  }, [at, now]);
}

function useSnapshotVisible(expiresAt: number | undefined) {
  useDeadline(expiresAt, Date.now);
  const now = Date.now();
  return expiresAt !== undefined && now >= expiresAt - snapshotWindow && now < expiresAt;
}

export function useCachedRead<Kind extends RemoteCacheKind>(kind: Kind | undefined, key: string | null) {
  const cached = useRead("projection", useCallback((repo: ScopedRepository) => kind && key !== null
    ? repo.getCachedRead(kind, key).catch(() => null)
    : Promise.resolve(null), [kind, key]));
  return useSnapshotVisible(cached?.expiresAt) ? cached : null;
}

export function useProjection<Kind extends ProjectionKind>(kind: Kind, id: string): CachedProjections[Kind] | null {
  const result = useRead("projection", useCallback((repo: ScopedRepository) => repo.getProjection(kind, id), [kind, id]));
  return useSnapshotVisible(result?.expiresAt) ? result?.data ?? null : null;
}

export function useProjectionList<Kind extends ProjectionKind>(kind: Kind, { afterId, limit }: ProjectionQuery = {}): readonly CachedProjections[Kind][] {
  const result = useRead("projection", useCallback((repo: ScopedRepository) => repo.listProjections(kind, { afterId, limit }), [kind, afterId, limit]));
  return useSnapshotVisible(result?.expiresAt) ? result?.data ?? empty : empty;
}

export function useLastConfirmed(scope?: Scope): number | null {
  const accountId = scope?.accountId, contextId = scope?.contextId;
  const result = useRead("projection", useCallback((repo: ScopedRepository) => {
    if ((accountId !== undefined && accountId !== repo.scope.accountId) || (contextId !== undefined && contextId !== repo.scope.contextId)) {
      return Promise.resolve(null);
    }
    return repo.getLastConfirmed();
  }, [accountId, contextId]));
  return useSnapshotVisible(result?.expiresAt) ? result?.confirmedAt ?? null : null;
}

export function useOutbox({ retryMedia }: { retryMedia?: (attachmentId: AttachmentId) => Promise<void> } = {}): {
  entries: readonly OutboxEntry[];
  enqueueOperation: (operation: NewOperation) => Promise<string>;
  remove: (operationId: string) => Promise<boolean>;
  retry: (operationId: string) => Promise<SyncResult | null>;
} {
  const repo = useRepository();
  const { refresh } = useSync();
  const entries = useRead("outbox", useCallback((repo: ScopedRepository) => repo.listOutbox(), [])) ?? empty;
  const enqueueOperation = useCallback(async (op: NewOperation) => {
    if (!repo) throw new Error("An active local scope is required");
    return repo.enqueueOperation(op);
  }, [repo]);
  const remove = useCallback((id: string) => repo?.removeUnsentOperation(id) ?? Promise.resolve(false), [repo]);
  const retry = useCallback((id: string) => retryOutboxOperation(repo, id, refresh, retryMedia), [repo, refresh, retryMedia]);
  return { entries, enqueueOperation, remove, retry };
}

const emptyAttendance: AttendanceStatus = { arrival: null, departure: null, lastConfirmedAt: null };

export function useAttendanceStatus(assignmentId: string | null | undefined): AttendanceStatus {
  const result = useRead("attendance", useCallback((repo: ScopedRepository) => assignmentId
    ? repo.getAttendanceStatus(assignmentId) : Promise.resolve(null), [assignmentId]));
  const visible = useSnapshotVisible(result?.expiresAt ?? undefined);
  if (!result) return emptyAttendance;
  return visible
    ? { arrival: result.arrival, departure: result.departure, lastConfirmedAt: result.lastConfirmedAt }
    : { ...result.local, lastConfirmedAt: null };
}

export function useProgressReceipts(assignmentId: string | null | undefined): readonly ProgressReceipt[] {
  return useRead<readonly ProgressReceipt[]>("progress", useCallback((repo: ScopedRepository) => assignmentId
    ? repo.listProgressReceipts(assignmentId) : Promise.resolve(empty), [assignmentId])) ?? empty;
}

export function usePendingDrafts(kind: string): readonly PendingDraft[];
export function usePendingDrafts(allRoles?: boolean): number | null;
export function usePendingDrafts(kindOrAllRoles?: string | boolean): readonly PendingDraft[] | number | null {
  const result = useRead<PendingDraft[] | number>("drafts", useCallback((repo: ScopedRepository) => typeof kindOrAllRoles === "string"
    ? repo.listPendingDrafts(kindOrAllRoles) : repo.countPendingDrafts(kindOrAllRoles), [kindOrAllRoles]));
  const rows = Array.isArray(result) ? result : empty;
  const cutoff = Date.now() - draftExpiresAfter;
  let oldest: number | undefined;
  let expired = false;
  for (const row of rows) {
    if (row.reconciling) continue;
    if (row.updatedAt <= cutoff) expired = true;
    else oldest = row.updatedAt;
  }
  useDeadline(oldest === undefined ? undefined : oldest + draftExpiresAfter, Date.now);
  if (typeof kindOrAllRoles === "string") return expired ? rows.filter((row) => row.reconciling || row.updatedAt > cutoff) : rows;
  return typeof result === "number" ? result : null;
}

export function usePendingSends() {
  return useRead("outbox", useCallback((repo: ScopedRepository) => repo.countPendingSends(), []));
}

export function useStagedMediaCount() {
  return useRead("media", useCallback((repo: ScopedRepository) => repo.countStagedMedia(), []));
}

export function useDraft<Value extends DraftValue = DraftValue>(key: DraftKey | null): {
  draft: Draft<Value> | null; loaded: boolean; warn: boolean; save: (value: Value) => Promise<void>; remove: () => Promise<void>;
} {
  const repo = useRepository();
  const read = useRead("drafts", useCallback(async (repo: ScopedRepository) => ({ draft: key ? await repo.getDraft<Value>(key) : null }), [key]));
  const result = read?.draft ?? null;
  useDeadline(result?.warnAt ?? undefined, Date.now);
  useDeadline(result?.expiresAt ?? undefined, Date.now);
  const expired = result?.expiresAt != null && Date.now() >= result.expiresAt;
  useEffect(() => {
    if (expired && repo?.isActive) void repo.expireDrafts().catch(() => undefined);
  }, [expired, repo]);
  const save = useCallback(async (value: Value) => {
    if (!repo || !key) throw new Error("An active draft key is required");
    await repo.saveDraft(key, value);
  }, [repo, key]);
  const remove = useCallback(async () => {
    if (!repo || !key) throw new Error("An active draft key is required");
    await repo.removeDraft(key);
  }, [repo, key]);
  const draft = expired ? null : result;
  return { draft, loaded: read !== null, warn: draft?.warnAt != null && Date.now() >= draft.warnAt, save, remove };
}
