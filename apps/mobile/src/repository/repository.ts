import { errorBodySchema, localePreferencesSchema, operationIdSchema, syncLimits, syncOperationSchema } from "@bookbuddy/api-contract";
import type { ErrorBody, LocalePreferences, OperationId, SyncOp, SyncPage } from "@bookbuddy/api-contract";
import { cacheableValue, draftExpiresAfter, draftWarnAfter, snapshotWindow } from "./cache";
import type { CachedProjections, ProjectionKind } from "./cache";
import type { Executor, Rows } from "./executor";
import { drafts, localSettings, outbox, pendingOnlineReceipts, projection, stagedMedia, syncState } from "./schema";
import type { OutboxStatus } from "./schema";

export type Scope = { accountId: string; contextId: string };
export type DraftValue = null | boolean | number | string | DraftValue[] | { [key: string]: DraftValue };
export type Draft<Value extends DraftValue = DraftValue> = { value: Value; updatedAt: number; warnAt: number; expiresAt: number };
export type ProjectionQuery = { afterId?: string; limit?: number };
type WithOptionalId<Op> = Op extends SyncOp ? Omit<Op, "operationId"> & { operationId?: string } : never;
export type NewOperation = WithOptionalId<SyncOp>;
export interface OutboxEntry { operation: SyncOp; status: OutboxStatus; createdAt: number; error: ErrorBody | null }
export interface StagedMedia {
  attachmentId: string;
  fileUri: string;
  caller: string;
  mime: string;
  bytes: number;
  stageId?: string;
  generation?: number;
  transferId?: string;
  parts?: { partNumber: number; etag: string }[];
}
export interface OnlineReceipt { operationId: string; kind: string; resourceId: string; createdAt: number }
export interface Confirmation { confirmedAt: number; expiresAt: number }
export interface SyncBatch {
  cursor: string | null;
  operations: SyncOp[];
  newlyChecking: OperationId[];
  hasMoreOperations: boolean;
}

export type RepositoryTopic = "projection" | "drafts" | "outbox" | "media" | "receipts";
interface RepositoryEvent { revision: number; listeners: Set<() => void> }

export class MobileRepository {
  constructor(private readonly db: Executor, private readonly newId: () => string, readonly now = Date.now) {}

  openScope(scope: Scope) {
    return new ScopedRepository(this.db, { ...scope }, this.newId, this.now);
  }

  async getLocalePreferences(accountId: string): Promise<LocalePreferences | null> {
    const [row] = await this.db.read((db) => db.select(localSettings, { account_id: accountId, key: "locale" }));
    return row ? localePreferencesSchema.parse(JSON.parse(row.value)) : null;
  }

  async saveLocalePreferences(accountId: string, value: LocalePreferences) {
    const { uiLocale, readingLocale } = localePreferencesSchema.parse(value);
    await this.db.transaction((db) => db.put(localSettings, {
      account_id: accountId, key: "locale", value: JSON.stringify({ uiLocale, readingLocale }),
    }));
  }

  async wipeAccount(accountId: string, eraseFiles: (uris: readonly string[]) => Promise<void>): Promise<void> {
    const account = { account_id: accountId };
    await this.db.transaction(async (db) => {
      const files = (await db.select(stagedMedia, account)).map(({ value }) => (JSON.parse(value) as StagedMedia).fileUri);
      if (files.length) await eraseFiles(files);
      await db.remove(projection, account);
      await db.remove(syncState, account);
      await db.remove(drafts, account);
      await db.remove(outbox, account);
      await db.remove(stagedMedia, account);
      await db.remove(pendingOnlineReceipts, account);
      await db.remove(localSettings, account);
    });
  }
}

export class ScopedRepository {
  private active = true;
  private snapshotHidden = false;
  private readonly events = new Map<RepositoryTopic, RepositoryEvent>();
  private readonly partition: { account_id: string; context_id: string };

  constructor(private readonly db: Executor, readonly scope: Scope, private readonly newId: () => string, readonly now: () => number) {
    this.partition = { account_id: scope.accountId, context_id: scope.contextId };
  }

  get isActive() { return this.active; }

  private event(topic: RepositoryTopic): RepositoryEvent {
    let event = this.events.get(topic);
    if (!event) this.events.set(topic, event = { revision: 0, listeners: new Set() });
    return event;
  }

  private notify(...topics: RepositoryTopic[]) {
    for (const topic of topics) {
      const event = this.event(topic);
      event.revision += 1;
      for (const listener of event.listeners) listener();
    }
  }

  subscribe(topic: RepositoryTopic, listener: () => void) {
    const { listeners } = this.event(topic);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  revision(topic: RepositoryTopic) { return this.event(topic).revision; }

  close() {
    this.active = false;
    this.notify(...this.events.keys());
  }

  private write<T>(work: (db: Rows) => Promise<T>) {
    return this.db.transaction((db) => {
      if (!this.active) throw new Error("Local scope is closed");
      return work(db);
    });
  }

  private async confirmation(db: Pick<Rows, "select">): Promise<Confirmation | null> {
    if (!this.active || this.snapshotHidden) return null;
    const [state] = await db.select(syncState, this.partition);
    const now = this.now();
    if (!this.active || this.snapshotHidden || !state || state.authorized_at === null || state.confirmed_at === null || now < state.authorized_at) return null;
    const expiresAt = state.authorized_at + snapshotWindow;
    return now < expiresAt ? { confirmedAt: state.confirmed_at, expiresAt } : null;
  }

  getLastConfirmed(): Promise<Confirmation | null> {
    return this.db.read((db) => this.confirmation(db));
  }

  getProjection<Kind extends ProjectionKind>(kind: Kind, id: string): Promise<{ data: CachedProjections[Kind]; expiresAt: number } | null> {
    return this.db.read(async (db) => {
      const confirmation = await this.confirmation(db);
      if (!confirmation) return null;
      const [row] = await db.select(projection, { ...this.partition, kind, id });
      return row && this.active && !this.snapshotHidden ? { data: JSON.parse(row.value) as CachedProjections[Kind], expiresAt: confirmation.expiresAt } : null;
    });
  }

  listProjections<Kind extends ProjectionKind>(kind: Kind, { afterId, limit = 50 }: ProjectionQuery = {}): Promise<{
    data: CachedProjections[Kind][]; expiresAt: number;
  } | null> {
    return this.db.read(async (db) => {
      const confirmation = await this.confirmation(db);
      if (!confirmation) return null;
      const rows = await db.select(projection, { ...this.partition, kind, ...(afterId && { id: { op: ">", value: afterId } }) },
        { order: ["id"], limit: Math.min(Math.max(Math.trunc(limit) || 0, 0), syncLimits.changes) });
      return this.active && !this.snapshotHidden ? { data: rows.map(({ value }) => JSON.parse(value) as CachedProjections[Kind]), expiresAt: confirmation.expiresAt } : null;
    });
  }

  getDraft<Value extends DraftValue = DraftValue>(key: string): Promise<Draft<Value> | null> {
    return this.db.read(async (db) => {
      const [row] = await db.select(drafts, { ...this.partition, key });
      if (!this.active || !row || this.now() >= row.updated_at + draftExpiresAfter) return null;
      return { value: JSON.parse(row.value) as Value, updatedAt: row.updated_at, warnAt: row.updated_at + draftWarnAfter, expiresAt: row.updated_at + draftExpiresAfter };
    });
  }

  async saveDraft(key: string, value: DraftValue) {
    const where = { ...this.partition, key };
    const text = JSON.stringify(value);
    const changed = await this.write(async (db) => {
      const [row] = await db.select(drafts, where);
      if (row?.value === text && this.now() < row.updated_at + draftExpiresAfter) return false;
      await db.put(drafts, { ...where, value: text, updated_at: this.now() });
      return true;
    });
    if (changed) this.notify("drafts");
  }

  async removeDraft(key: string) {
    await this.write((db) => db.remove(drafts, { ...this.partition, key }));
    this.notify("drafts");
  }

  async expireDrafts() {
    await this.write((db) => db.remove(drafts, { ...this.partition, updated_at: { op: "<=", value: this.now() - draftExpiresAfter } }));
    this.notify("drafts");
  }

  async enqueueOperation(input: NewOperation): Promise<OperationId> {
    const operation = syncOperationSchema.parse({ ...input, operationId: input.operationId ?? this.newId() });
    const value = JSON.stringify(operation);
    const operationId = operation.operationId;
    const changed = await this.write(async (db) => {
      const key = { ...this.partition, operation_id: operationId };
      const [previous] = await db.select(outbox, key);
      if (previous) {
        if (previous.value !== value) throw new Error("An operation ID cannot be reused with different input");
        return false;
      }
      await db.put(outbox, { ...key, value, status: "queued", created_at: this.now(), error: null });
      return true;
    });
    if (changed) this.notify("outbox");
    return operationId;
  }

  listOutbox(): Promise<OutboxEntry[]> {
    return this.db.read(async (db) => {
      const rows = await db.select(outbox, this.partition, { order: ["created_at", "operation_id"] });
      return this.active ? rows.map((row) => ({
        operation: syncOperationSchema.parse(JSON.parse(row.value)), status: row.status, createdAt: row.created_at,
        error: row.error === null ? null : errorBodySchema.parse(JSON.parse(row.error)),
      })) : [];
    });
  }

  async prepareSyncBatch(): Promise<SyncBatch> {
    const batch = await this.write(async (db) => {
      const [state] = await db.select(syncState, this.partition);
      // A hidden snapshot was physically purged; only a fresh snapshot can fill it again.
      const cursor = state?.authorized_at == null ? null : state.cursor;
      const candidates = await db.select(outbox, { ...this.partition, status: { op: "in", value: ["queued", "checking"] } },
        { order: ["created_at", "operation_id"], limit: syncLimits.operations + 1 });
      const operations: SyncOp[] = [];
      const newlyChecking: OperationId[] = [];
      let bytes = (cursor?.length ?? 0) + this.scope.contextId.length + 100;
      for (const candidate of candidates) {
        // A UTF-16 code unit contributes at most three UTF-8 bytes to the already-encoded JSON.
        bytes += candidate.value.length * 3 + 1;
        if (operations.length === syncLimits.operations || bytes > syncLimits.requestBytes) break;
        const op = syncOperationSchema.parse(JSON.parse(candidate.value));
        operations.push(op);
        if (candidate.status === "queued") newlyChecking.push(op.operationId);
      }
      if (candidates.length && !operations.length) throw new Error("Queued operation exceeds the sync request budget");
      if (newlyChecking.length) await db.update(outbox, { ...this.partition, operation_id: { op: "in", value: newlyChecking } }, { status: "checking" });
      return { cursor, operations, newlyChecking, hasMoreOperations: candidates.length > operations.length };
    });
    if (batch.newlyChecking.length) this.notify("outbox");
    return batch;
  }

  async recordSyncFailure(newlyChecking: readonly OperationId[], hideSnapshot: boolean) {
    if (!newlyChecking.length && !hideSnapshot) return;
    // A known denial must hide the old snapshot even when the disk write fails.
    if (hideSnapshot && !this.snapshotHidden) {
      this.snapshotHidden = true;
      this.notify("projection");
    }
    await this.write(async (db) => {
      if (newlyChecking.length) await db.update(outbox, {
        ...this.partition, operation_id: { op: "in", value: newlyChecking }, status: "checking",
      }, { status: "queued" });
      if (hideSnapshot) {
        await db.remove(projection, this.partition);
        await db.update(syncState, this.partition, { authorized_at: null, confirmed_at: null });
      }
    });
    if (newlyChecking.length) this.notify("outbox");
  }

  async applySyncPage(page: SyncPage, confirmedAt: number) {
    if (page.context.contextId !== this.scope.contextId) throw new Error("Wrong sync scope");
    const barrier = page.removals.some((row) => row.kind === "scope");
    if (page.removals.some((row) => row.kind === "scope" && row.resourceId !== this.scope.contextId)) throw new Error("Wrong scope removal");
    if (barrier && !this.snapshotHidden) {
      this.snapshotHidden = true;
      this.notify("projection");
    }
    // A signed revocation is an empty, terminal reset; do not renew visibility.
    const mayBeRevoked = barrier && page.mode === "reset" && page.upserts.length === 0 && !page.hasMore;
    await this.write(async (db) => {
      if (barrier) await db.remove(projection, this.partition);
      else for (const removal of page.removals) {
        await db.remove(projection, { ...this.partition, kind: removal.kind, id: removal.resourceId });
      }
      for (const row of page.upserts) {
        const value = cacheableValue(row);
        if (value) await db.put(projection, { ...this.partition, kind: row.kind, id: row.resourceId, value: JSON.stringify(value) });
        else if (row.kind === "notification") await db.remove(projection, { ...this.partition, kind: row.kind, id: row.resourceId });
      }
      for (const outcome of page.outcomes) {
        const key = { ...this.partition, operation_id: outcome.operationId };
        if (outcome.status !== "rejected") await db.remove(outbox, key);
        else {
          const error = errorBodySchema.parse(outcome.error);
          const conflict = error.code === "CONFLICT" || error.code === "STALE_REVISION" || error.code === "OPERATION_ID_REUSED";
          await db.update(outbox, key, { status: conflict ? "conflict" : "rejected", error: JSON.stringify(error) });
        }
      }
      await db.put(syncState, {
        ...this.partition, cursor: page.cursor, confirmed_at: mayBeRevoked ? null : confirmedAt,
        authorized_at: mayBeRevoked ? null : this.now(),
      });
    });
    this.snapshotHidden = mayBeRevoked;
    this.notify("projection", ...(page.outcomes.length ? ["outbox" as const] : []));
  }

  async saveStagedMedia(item: StagedMedia) {
    const { attachmentId, fileUri, caller, mime, bytes, stageId, generation, transferId, parts } = item;
    const value = JSON.stringify({ attachmentId, fileUri, caller, mime, bytes, stageId, generation, transferId,
      parts: parts?.map(({ partNumber, etag }) => ({ partNumber, etag })) });
    await this.write((db) => db.put(stagedMedia, { ...this.partition, attachment_id: attachmentId, value, updated_at: this.now() }));
    this.notify("media");
  }

  listStagedMedia(): Promise<StagedMedia[]> {
    return this.db.read(async (db) => {
      const rows = await db.select(stagedMedia, this.partition, { order: ["attachment_id"] });
      return this.active ? rows.map(({ value }) => JSON.parse(value) as StagedMedia) : [];
    });
  }

  async removeStagedMedia(attachmentId: string) {
    await this.write((db) => db.remove(stagedMedia, { ...this.partition, attachment_id: attachmentId }));
    this.notify("media");
  }

  async saveOnlineReceipt({ operationId, kind, resourceId, createdAt }: OnlineReceipt) {
    await this.write((db) => db.put(pendingOnlineReceipts, {
      ...this.partition, operation_id: operationIdSchema.parse(operationId), kind, resource_id: resourceId, created_at: createdAt,
    }));
    this.notify("receipts");
  }

  listOnlineReceipts(): Promise<OnlineReceipt[]> {
    return this.db.read(async (db) => {
      const rows = await db.select(pendingOnlineReceipts, this.partition, { order: ["created_at", "operation_id"] });
      return this.active ? rows.map((row) => ({ operationId: row.operation_id, kind: row.kind, resourceId: row.resource_id, createdAt: row.created_at })) : [];
    });
  }

  async removeOnlineReceipt(operationId: string) {
    await this.write((db) => db.remove(pendingOnlineReceipts, { ...this.partition, operation_id: operationId }));
    this.notify("receipts");
  }
}
