import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { snapshotWindow } from "./cache";
import type { CachedProjections, ProjectionKind } from "./cache";
import type { Draft, DraftValue, NewOperation, OutboxEntry, ProjectionQuery, RepositoryTopic, Scope, ScopedRepository } from "./repository";

const RepositoryContext = createContext<ScopedRepository | null>(null);
const empty: readonly never[] = [];

export function RepositoryProvider({ children, repository }: { children: ReactNode; repository: ScopedRepository | null }) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): ScopedRepository | null { return useContext(RepositoryContext); }

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

export function useOutbox(): { entries: readonly OutboxEntry[]; enqueueOperation: (operation: NewOperation) => Promise<string> } {
  const repo = useRepository();
  const entries = useRead("outbox", useCallback((repo: ScopedRepository) => repo.listOutbox(), [])) ?? empty;
  const enqueueOperation = useCallback(async (op: NewOperation) => {
    if (!repo) throw new Error("An active local scope is required");
    return repo.enqueueOperation(op);
  }, [repo]);
  return { entries, enqueueOperation };
}

export function useDraft<Value extends DraftValue = DraftValue>(key: string): {
  draft: Draft<Value> | null; warn: boolean; save: (value: Value) => Promise<void>; remove: () => Promise<void>;
} {
  const repo = useRepository();
  const result = useRead("drafts", useCallback((repo: ScopedRepository) => repo.getDraft<Value>(key), [key]));
  useDeadline(result?.warnAt, Date.now);
  useDeadline(result?.expiresAt, Date.now);
  const expired = !!result && Date.now() >= result.expiresAt;
  useEffect(() => {
    if (expired && repo?.isActive) void repo.expireDrafts().catch(() => undefined);
  }, [expired, repo]);
  const save = useCallback(async (value: Value) => {
    if (!repo) throw new Error("An active local scope is required");
    await repo.saveDraft(key, value);
  }, [repo, key]);
  const remove = useCallback(async () => {
    if (!repo) throw new Error("An active local scope is required");
    await repo.removeDraft(key);
  }, [repo, key]);
  const draft = expired ? null : result;
  return { draft, warn: !!draft && Date.now() >= draft.warnAt, save, remove };
}
