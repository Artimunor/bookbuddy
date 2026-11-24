import type { ApiResult } from "@bookbuddy/api-client";
import type { SyncPage, SyncRequest } from "@bookbuddy/api-contract";
import type { AttachmentId } from "../media/types";
import type { ScopedRepository } from "../repository/repository";

export type SyncTransport = (request: SyncRequest, signal: AbortSignal) => Promise<ApiResult<SyncPage>>;
export type SyncResult = { status: "confirmed" } | { status: "closed" } | {
  status: "unsent" | "checking" | "blocked" | "failed";
  code: string;
};

export async function retryOutboxOperation(
  scope: ScopedRepository | null, operationId: string, refresh: () => Promise<SyncResult>,
  retryMedia?: (attachmentId: AttachmentId) => Promise<void>,
): Promise<SyncResult | null> {
  const plan = await scope?.getOutboxRetry(operationId);
  if (!plan || !scope?.isActive) return null;
  if (plan.kind === "sync") return refresh();
  if (retryMedia && plan.attachmentIds.length) await Promise.all(plan.attachmentIds.map(retryMedia));
  return null;
}

interface Flight { run: Promise<SyncResult>; abort: AbortController; scope: ScopedRepository }
type MediaWake = { ids: Set<AttachmentId>; run: Promise<boolean> };

export class SyncRunner {
  private readonly flights = new Map<string, Flight>();
  private readonly mediaWakes = new WeakMap<ScopedRepository, MediaWake>();

  constructor(private readonly send: SyncTransport) {}

  // A ready burst waits for the current sync and checks again: the current
  // flight may already have drained these IDs, or prepared while they waited.
  refreshReadyProgress(
    scope: ScopedRepository, ids: ReadonlySet<AttachmentId>, permitted: () => boolean,
    refresh = () => this.refresh(scope),
  ): Promise<boolean> {
    const pending = this.mediaWakes.get(scope);
    if (pending) {
      for (const id of ids) pending.ids.add(id);
      return pending.run;
    }
    const key = JSON.stringify([scope.scope.accountId, scope.scope.contextId]);
    const run = Promise.resolve().then(async () => {
      try {
        while (wake.ids.size) {
          if (!scope.isActive || !permitted()) return false;
          const flight = this.flights.get(key);
          if (flight) {
            if ((await flight.run).status !== "confirmed") return true;
            continue;
          }
          const ready = wake.ids;
          wake.ids = new Set();
          if (!await scope.hasReadyProgress(ready)) continue;
          if (!scope.isActive || !permitted()) return false;
          if (this.flights.has(key)) {
            for (const id of ready) wake.ids.add(id);
            continue;
          }
          if ((await refresh()).status !== "confirmed") return true;
        }
        return true;
      } finally {
        this.mediaWakes.delete(scope);
      }
    });
    const wake: MediaWake = { ids: new Set(ids), run };
    this.mediaWakes.set(scope, wake);
    return run;
  }

  refresh(scope: ScopedRepository): Promise<SyncResult> {
    if (!scope.isActive) return Promise.resolve({ status: "closed" });
    const key = JSON.stringify([scope.scope.accountId, scope.scope.contextId]);
    const previous = this.flights.get(key);
    if (previous) return previous.scope === scope ? previous.run : previous.run.then(() => this.refresh(scope));
    const abort = new AbortController();
    const run = this.drain(scope, abort.signal).finally(() => { this.flights.delete(key); });
    this.flights.set(key, { run, abort, scope });
    return run;
  }

  cancel(scope: ScopedRepository) {
    const flight = this.flights.get(JSON.stringify([scope.scope.accountId, scope.scope.contextId]));
    if (flight?.scope === scope) flight.abort.abort();
  }

  private async drain(scope: ScopedRepository, signal: AbortSignal): Promise<SyncResult> {
    const closed = () => signal.aborted || !scope.isActive;
    let mayHaveSent = false;
    try {
      while (!closed()) {
        const batch = await scope.prepareSyncBatch();
        if (closed()) {
          if (scope.isActive) await scope.recordSyncFailure(batch.newlyChecking, false);
          break;
        }
        mayHaveSent = batch.operations.length > 0;
        const result = await this.send({ contextId: scope.scope.contextId, cursor: batch.cursor, operations: batch.operations }, signal);
        if (closed()) break;
        if (!result.ok) {
          const { code } = result.error;
          const blocked = code === "NOT_FOUND" || code === "UNAUTHENTICATED";
          const notSent = ("delivery" in result.error && result.error.delivery === "not_sent") || blocked ||
            code === "VALIDATION_FAILED" || code === "RATE_LIMITED";
          await scope.recordSyncFailure(notSent ? batch.newlyChecking : [], blocked);
          return { status: blocked ? "blocked" : notSent ? "unsent" : mayHaveSent ? "checking" : "failed", code };
        }
        const remaining = new Set(batch.operations.map(({ operationId }) => operationId));
        for (const { operationId } of result.data.outcomes) remaining.delete(operationId);
        if (remaining.size || result.data.outcomes.some(({ operationId }) => !batch.operations.some((op) => op.operationId === operationId)) ||
          (result.data.hasMore && result.data.cursor === batch.cursor)) {
          return { status: mayHaveSent ? "checking" : "failed", code: "INVALID_SYNC_PAGE" };
        }
        await scope.applySyncPage(result.data, result.meta.serverTime);
        mayHaveSent = false;
        if (!result.data.hasMore && !batch.hasMoreOperations) return { status: "confirmed" };
      }
    } catch {
      if (!closed()) return { status: mayHaveSent ? "checking" : "failed", code: "SYNC_FAILED" };
    }
    return { status: "closed" };
  }
}
