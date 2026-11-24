import { accountSettingsSchema, errorBodySchema, mediaStageIdSchema, operationIdSchema, sessionBootstrapSchema, syncLimits, syncOperationSchema } from "@bookbuddy/api-contract";
import type { ErrorBody, LocalePreferences, OpOutcome, OperationId, ProgressPhotoOutcome, SessionBootstrap, SyncOp, SyncPage } from "@bookbuddy/api-contract";
import { fitsDraft } from "../media/types";
import type { AttachmentId, MediaTransfer, NewMediaTransfer, TransferProgress, TransferQuery } from "../media/types";
import { attendanceProgress } from "./attendance";
import type { AttendanceCapture, AttendanceEventKind, AttendanceOperation, AttendanceSnapshot, LocalAttendance } from "./attendance";
import { cacheableValue, draftExpiresAfter, draftWarnAfter, snapshotWindow } from "./cache";
import type { CachedProjections, CachedWorkerFieldShift, ProjectionKind } from "./cache";
import type { Executor, Rows } from "./executor";
import { decodeTransfer, encodeTransfer } from "./media-transfers";
import { cacheRemoteResponse, decodeRemoteSnapshot } from "./remote-cache";
import type { CachedRead, RemoteCacheKind } from "./remote-cache";
import { attendanceReceipts, drafts, localSettings, mediaTransfers, outbox, pendingOnlineReceipts, progressReceipts, projection, stagedMedia, syncState } from "./schema";
import type { OutboxStatus, ProgressReceiptState } from "./schema";

const devicePreferencesSchema = accountSettingsSchema.omit({ revision: true }).partial({
  theme: true, fieldMode: true, twoClock: true,
});
export type DevicePreferences = LocalePreferences & Partial<Pick<SessionBootstrap["preferences"], "theme" | "fieldMode" | "twoClock">>;

export type Scope = { accountId: string; contextId: string };
export type DraftKey = `${string}:${string}`;
const draftKeyPattern = /^[a-z][a-z0-9_-]*:[A-Za-z0-9_-]+$/;
const legacyRequestDraft = "request:new";
export type DraftValue = null | boolean | number | string | DraftValue[] | { [key: string]: DraftValue };
export type Draft<Value extends DraftValue = DraftValue> = { value: Value; updatedAt: number; warnAt: number; expiresAt: number };
export type PendingDraft = { draftId: string; updatedAt: number; summary?: string };
export type ProjectionQuery = { afterId?: string; limit?: number };
type WithOptionalId<Op> = Op extends SyncOp ? Omit<Op, "operationId"> & { operationId?: string } : never;
export type NewOperation = WithOptionalId<SyncOp> | AttendanceCapture;
export interface OutboxEntry { operation: SyncOp; status: OutboxStatus | "failed"; createdAt: number; error: ErrorBody | null }
export type ProgressReceipt = {
  operationId: string; activityIds: readonly string[]; state: ProgressReceiptState; confirmedAt: number;
  photoOutcomes: readonly ProgressPhotoOutcome[];
};
type ProgressOperation = Extract<SyncOp, { kind: "attachment_link" }>;
type ProgressMedia = Map<AttachmentId, Parameters<typeof decodeTransfer>[0]>;
type OutboxRetry = { kind: "sync" } | { kind: "media"; attachmentIds: AttachmentId[] };

function transferFor(media: ProgressMedia, assignmentId: string, attachmentId: AttachmentId) {
  const row = media.get(attachmentId);
  return row?.parent_scope_id === assignmentId ? row : undefined;
}

function progressReady({ payload: { assignmentId, photos } }: ProgressOperation, media: ProgressMedia) {
  return photos.every(({ attachmentId }) => transferFor(media, assignmentId, attachmentId)?.state === "ready");
}

function progressReceipt(operation: ProgressOperation, outcome: OpOutcome): { photos: ProgressPhotoOutcome[]; state: ProgressReceiptState } {
  const photos = outcome.photoOutcomes;
  if (!photos) return { photos: [], state: outcome.status === "rejected" ? "rejected" : "sent" };
  if (photos.length !== operation.payload.photos.length ||
    photos.some(({ activityId }, index) => activityId !== operation.payload.photos[index]?.activityId)) {
    throw new Error("Wrong progress photo outcomes");
  }
  const recorded = photos.some(({ status }) => status !== "rejected");
  return { state: recorded ? "recorded" : "rejected", photos: photos.map((photo) => photo.status === "rejected"
    ? { activityId: photo.activityId, status: "rejected", error: errorBodySchema.parse(photo.error) }
    : { activityId: photo.activityId, status: photo.status, receivedAt: photo.receivedAt }) };
}
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
export type CachedRemoteSnapshot<Kind extends RemoteCacheKind> = Confirmation & { data: CachedRead<Kind> };
export interface SyncBatch {
  cursor: string | null;
  operations: SyncOp[];
  newlyChecking: OperationId[];
  hasMoreOperations: boolean;
}

export type RepositoryTopic = "projection" | "drafts" | "outbox" | "media" | "receipts" | "attendance" | "progress";
interface RepositoryEvent { revision: number; listeners: Set<() => void> }

export class MobileRepository {
  constructor(private readonly db: Executor, private readonly newId: () => string, readonly now = Date.now) {}

  openScope(scope: Scope) {
    return new ScopedRepository(this.db, { ...scope }, this.newId, this.now);
  }

  async getLocalePreferences(accountId: string): Promise<DevicePreferences | null> {
    const [row] = await this.db.read((db) => db.select(localSettings, { account_id: accountId, key: "locale" }));
    return row ? devicePreferencesSchema.parse(JSON.parse(row.value)) : null;
  }

  async saveLocalePreferences(accountId: string, value: DevicePreferences) {
    const preferences = devicePreferencesSchema.parse(value);
    await this.db.transaction((db) => db.put(localSettings, {
      account_id: accountId, key: "locale", value: JSON.stringify(preferences),
    }));
  }

  async getSessionBootstrap(accountId: string): Promise<SessionBootstrap | null> {
    const [row] = await this.db.read((db) => db.select(localSettings, { account_id: accountId, key: "bootstrap" }));
    const cached = row && sessionBootstrapSchema.safeParse(JSON.parse(row.value));
    return cached?.success && cached.data.account.id === accountId ? cached.data : null;
  }

  async saveSessionBootstrap(bootstrap: SessionBootstrap): Promise<SessionBootstrap> {
    const cached = sessionBootstrapSchema.parse(bootstrap);
    await this.db.transaction((db) => db.put(localSettings, {
      account_id: cached.account.id, key: "bootstrap", value: JSON.stringify(cached),
    }));
    return cached;
  }

  async wipeAccount(accountId: string, eraseFiles: (uris: readonly string[]) => Promise<void>): Promise<void> {
    const account = { account_id: accountId };
    await this.db.transaction(async (db) => {
      const files = (await db.select(stagedMedia, account)).map(({ value }) => (JSON.parse(value) as StagedMedia).fileUri);
      for (const { file_uri } of await db.select(mediaTransfers, account)) {
        if (file_uri) files.push(file_uri);
      }
      if (files.length) await eraseFiles(files);
      await db.remove(projection, account);
      await db.remove(syncState, account);
      await db.remove(drafts, account);
      await db.remove(outbox, account);
      await db.remove(attendanceReceipts, account);
      await db.remove(progressReceipts, account);
      await db.remove(stagedMedia, account);
      await db.remove(mediaTransfers, account);
      await db.remove(pendingOnlineReceipts, account);
      await db.remove(localSettings, account);
    });
  }
}

export class ScopedRepository {
  private active = true;
  private snapshotHidden = false;
  private visibility = 0;
  private readonly events = new Map<RepositoryTopic, RepositoryEvent>();
  private readonly progressReadyListeners = new Set<(ids: ReadonlySet<AttachmentId>) => void>();
  private readonly partition: { account_id: string; context_id: string };

  constructor(private readonly db: Executor, readonly scope: Scope, private readonly newId: () => string, readonly now: () => number) {
    this.partition = { account_id: scope.accountId, context_id: scope.contextId };
  }

  get isActive() { return this.active; }
  get visibilityGeneration() { return this.visibility; }

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

  subscribeProgressReady(listener: (ids: ReadonlySet<AttachmentId>) => void) {
    this.progressReadyListeners.add(listener);
    return () => { this.progressReadyListeners.delete(listener); };
  }

  notifyProgressReady(ids: ReadonlySet<AttachmentId>) {
    if (this.active) for (const listener of this.progressReadyListeners) listener(ids);
  }

  revision(topic: RepositoryTopic) { return this.event(topic).revision; }

  close() {
    this.active = false;
    this.progressReadyListeners.clear();
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

  getCachedRead<Kind extends RemoteCacheKind>(kind: Kind, id: string): Promise<CachedRemoteSnapshot<Kind> | null> {
    return this.db.read(async (db) => {
      if (!this.active || this.snapshotHidden) return null;
      const generation = this.visibility;
      const [row] = await db.select(projection, { ...this.partition, kind: `read:${kind}`, id });
      if (!row || !this.active || this.snapshotHidden || generation !== this.visibility) return null;
      const saved = JSON.parse(row.value) as { data: unknown; authorizedAt: number; confirmedAt: number };
      const now = this.now();
      const expiresAt = saved.authorizedAt + snapshotWindow;
      return Number.isSafeInteger(saved.confirmedAt) && Number.isSafeInteger(saved.authorizedAt) && now >= saved.authorizedAt && now < expiresAt
        ? { data: decodeRemoteSnapshot(kind, saved.data), confirmedAt: saved.confirmedAt, expiresAt } : null;
    });
  }

  async saveCachedRead(kind: RemoteCacheKind, id: string, value: unknown, confirmedAt: number, generation: number) {
    if (!this.active || this.snapshotHidden || generation !== this.visibility) return;
    const data = cacheRemoteResponse(kind, value);
    if (!data) return;
    const saved = JSON.stringify({ data, confirmedAt, authorizedAt: this.now() });
    await this.write(async (db) => {
      if (!this.snapshotHidden && generation === this.visibility) {
        await db.put(projection, { ...this.partition, kind: `read:${kind}`, id, value: saved });
      }
    });
    this.notify("projection");
  }

  async removeCachedRead(kind: RemoteCacheKind, id: string) {
    await this.write((db) => db.remove(projection, { ...this.partition, kind: `read:${kind}`, id }));
    this.notify("projection");
  }

  async getDraft<Value extends DraftValue = DraftValue>(key: DraftKey): Promise<Draft<Value> | null> {
    const [row] = await this.db.read((db) => db.select(drafts, { ...this.partition, key }));
    if (!this.active || !row || this.now() >= row.updated_at + draftExpiresAfter) return null;
    if (key === legacyRequestDraft) {
      await this.migrateRequestDraft();
      return null;
    }
    return { value: JSON.parse(row.value) as Value, updatedAt: row.updated_at, warnAt: row.updated_at + draftWarnAfter, expiresAt: row.updated_at + draftExpiresAfter };
  }

  private async migrateRequestDraft() {
    const where = { ...this.partition, key: legacyRequestDraft };
    const moved = await this.write(async (db) => {
      const [legacy] = await db.select(drafts, where);
      if (!legacy || this.now() >= legacy.updated_at + draftExpiresAfter) return false;
      const key = `request:${this.newId()}`;
      if (!draftKeyPattern.test(key) || key === legacyRequestDraft || (await db.count(drafts, { ...this.partition, key })) > 0) {
        throw new Error("Invalid or duplicate generated request draft ID");
      }
      await db.put(drafts, { ...legacy, key });
      await db.remove(drafts, where);
      return true;
    });
    if (moved) this.notify("drafts");
  }

  async listPendingDrafts(kind: string): Promise<PendingDraft[]> {
    const read = () => this.db.read((db) => db.select(drafts, {
      ...this.partition, key: { op: "prefix", value: `${kind}:` },
      updated_at: { op: ">", value: this.now() - draftExpiresAfter },
    }));
    if (!this.active) return [];
    let rows = await read();
    if (this.active && kind === "request" && rows.some(({ key }) => key === legacyRequestDraft)) {
      await this.migrateRequestDraft();
      rows = await read();
    }
    if (!this.active) return [];
    const cutoff = this.now() - draftExpiresAfter;
    rows.sort((a, b) => b.updated_at - a.updated_at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const result: PendingDraft[] = [];
    for (const row of rows) {
      if (row.updated_at <= cutoff) break;
      const draft: PendingDraft = { draftId: row.key.slice(kind.length + 1), updatedAt: row.updated_at };
      if (kind === "request") {
        const value = JSON.parse(row.value) as DraftValue;
        const summary = value && typeof value === "object" && !Array.isArray(value) && typeof value.description === "string"
          ? value.description.trim().slice(0, 160) : "";
        if (summary) draft.summary = summary;
      }
      result.push(draft);
    }
    return result;
  }

  countPendingDrafts(allRoles = false): Promise<number> {
    return this.db.read(async (db) => {
      if (!this.active) return 0;
      const partition = allRoles ? { account_id: this.scope.accountId } : this.partition;
      const count = await db.count(drafts, { ...partition, updated_at: { op: ">", value: this.now() - draftExpiresAfter } });
      return this.active ? count : 0;
    });
  }

  countPendingSends(): Promise<{ waiting: number; checking: number }> {
    return this.db.read(async (db) => {
      const counts = { waiting: 0, checking: 0 };
      if (!this.active) return counts;
      const rows = await db.select(outbox, { account_id: this.scope.accountId });
      if (!this.active) return counts;
      for (const row of rows) {
        if (row.status === "checking") counts.checking += 1;
        else counts.waiting += 1;
      }
      return counts;
    });
  }

  countStagedMedia(): Promise<number> {
    return this.db.read(async (db) => {
      if (!this.active) return 0;
      const account_id = this.scope.accountId;
      const older = await db.count(stagedMedia, { account_id });
      const transfers = await db.count(mediaTransfers, { account_id, file_uri: { op: ">", value: "" } });
      return this.active ? older + transfers : 0;
    });
  }

  async saveDraft(key: DraftKey, value: DraftValue) {
    if (!draftKeyPattern.test(key) || key === legacyRequestDraft) throw new Error("Draft keys require a stable kind:id");
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

  async removeDraft(key: DraftKey) {
    await this.write((db) => db.remove(drafts, { ...this.partition, key }));
    this.notify("drafts");
  }

  async expireDrafts() {
    await this.write((db) => db.remove(drafts, { ...this.partition, updated_at: { op: "<=", value: this.now() - draftExpiresAfter } }));
    this.notify("drafts");
  }

  async enqueueOperation(input: NewOperation): Promise<OperationId> {
    const operationId = input.operationId ?? this.newId();
    const operation = syncOperationSchema.parse(input.kind === "attendance" && "event" in input
      ? { kind: "attendance", operationId, payload: {
        id: operationId, assignmentId: input.assignmentId, kind: input.event, actualAt: input.actualAt, capturedAt: input.capturedAt,
      } }
      : { ...input, operationId });
    const value = JSON.stringify(operation);
    const parsedId = operation.operationId;
    const changed = await this.write(async (db) => {
      const key = { ...this.partition, operation_id: parsedId };
      const [pending] = await db.select(outbox, key);
      const previous = pending ?? (operation.kind === "attendance" ? (await db.select(attendanceReceipts, key))[0] : undefined);
      if (previous) {
        if (previous.value !== value) throw new Error("An operation ID cannot be reused with different input");
        return false;
      }
      await db.put(outbox, { ...key, value, status: "queued", created_at: this.now(), error: null });
      return true;
    });
    if (changed) this.notify("outbox", ...(operation.kind === "attendance" ? ["attendance" as const] : []));
    return parsedId;
  }

  async removeUnsentOperation(operationId: string): Promise<boolean> {
    if (!this.active) return false;
    const removed = await this.write(async (db) => {
      const where = { ...this.partition, operation_id: operationId, status: "queued" as const };
      if (!(await db.count(outbox, where))) return false;
      await db.remove(outbox, where);
      return true;
    });
    if (removed) this.notify("outbox", "attendance");
    return removed;
  }

  private async readProgressMedia(db: Pick<Rows, "select">, attachmentIds?: readonly AttachmentId[]): Promise<ProgressMedia> {
    const rows = await db.select(mediaTransfers, { ...this.partition, caller: "progress",
      ...(attachmentIds && { attachment_id: { op: "in", value: attachmentIds } }) });
    return new Map(rows.map((row) => [row.attachment_id, row]));
  }

  getOutboxRetry(operationId: string): Promise<OutboxRetry | null> {
    return this.db.read(async (db) => {
      if (!this.active) return null;
      const [row] = await db.select(outbox, {
        ...this.partition, operation_id: operationId, status: { op: "in", value: ["queued", "checking"] },
      });
      if (!row || !this.active) return null;
      const operation = JSON.parse(row.value) as SyncOp;
      if (operation.kind !== "attachment_link") return { kind: "sync" };
      const { assignmentId, photos } = operation.payload;
      const media = await this.readProgressMedia(db, photos.map(({ attachmentId }) => attachmentId));
      if (!this.active) return null;
      if (progressReady(operation, media)) return { kind: "sync" };
      const attachmentIds: AttachmentId[] = [];
      for (const { attachmentId } of photos) {
        const transfer = transferFor(media, assignmentId, attachmentId);
        if (transfer?.state === "failed" && transfer.selected && !decodeTransfer(transfer).terminal) attachmentIds.push(attachmentId);
      }
      return { kind: "media", attachmentIds };
    });
  }

  hasReadyProgress(ids: ReadonlySet<AttachmentId>): Promise<boolean> {
    return this.db.read(async (db) => {
      if (!this.active || !ids.size) return false;
      let media: ProgressMedia | undefined;
      for (const row of await db.select(outbox, { ...this.partition, status: "queued" })) {
        const op = JSON.parse(row.value) as SyncOp;
        if (op.kind !== "attachment_link" || !op.payload.photos.some(({ attachmentId }) => ids.has(attachmentId))) continue;
        media ??= await this.readProgressMedia(db);
        if (progressReady(op, media)) return this.active;
      }
      return false;
    });
  }

  listOutbox(): Promise<OutboxEntry[]> {
    return this.db.read(async (db) => {
      if (!this.active) return [];
      const entries: OutboxEntry[] = [];
      let media: ProgressMedia | undefined;
      for (const row of await db.select(outbox, this.partition, { order: ["created_at", "operation_id"] })) {
        const operation = syncOperationSchema.parse(JSON.parse(row.value));
        let status: OutboxEntry["status"] = row.status;
        if (status === "queued" && operation.kind === "attachment_link") {
          const transfers = media ??= await this.readProgressMedia(db);
          const { assignmentId, photos } = operation.payload;
          if (photos.some(({ attachmentId }) => {
            const transfer = transferFor(transfers, assignmentId, attachmentId);
            return !transfer || transfer.state === "failed";
          })) status = "failed";
        }
        entries.push({ operation, status, createdAt: row.created_at,
          error: row.error === null ? null : errorBodySchema.parse(JSON.parse(row.error)) });
      }
      return this.active ? entries : [];
    });
  }

  listProgressReceipts(assignmentId: string): Promise<ProgressReceipt[]> {
    return this.db.read(async (db) => {
      if (!this.active) return [];
      const rows = await db.select(progressReceipts, { ...this.partition, assignment_id: assignmentId },
        { order: ["confirmed_at", "operation_id"] });
      return this.active ? rows.map(({ operation_id, state, confirmed_at, photos }) => {
        const photoOutcomes = JSON.parse(photos) as ProgressPhotoOutcome[];
        const activityIds = photoOutcomes.flatMap((photo) => photo.status === "rejected" ? [] : [photo.activityId]);
        return { operationId: operation_id, state, confirmedAt: confirmed_at, activityIds, photoOutcomes };
      }) : [];
    });
  }

  getAttendanceStatus(assignmentId: string): Promise<AttendanceSnapshot> {
    return this.db.read(async (db) => {
      const confirmation = await this.confirmation(db);
      const [projectionRow] = confirmation && await db.select(projection, { ...this.partition, kind: "worker_field_shift", id: assignmentId }) || [];
      const confirmed = projectionRow && this.active && !this.snapshotHidden
        ? (JSON.parse(projectionRow.value) as CachedWorkerFieldShift).attendance : undefined;
      const latest: Partial<Record<AttendanceEventKind, LocalAttendance>> = {};
      const remember = (capture: LocalAttendance) => {
        const kind = capture.operation.payload.kind;
        const earlier = latest[kind];
        if (!earlier || capture.createdAt > earlier.createdAt || (capture.createdAt === earlier.createdAt &&
          capture.operation.operationId > earlier.operation.operationId)) latest[kind] = capture;
      };
      const receipts = await db.select(attendanceReceipts, { ...this.partition, assignment_id: assignmentId });
      for (const row of receipts) {
        remember({ operation: JSON.parse(row.value) as AttendanceOperation, createdAt: row.created_at, status: "sent", resultRef: row.result_ref });
      }
      for (const row of await db.select(outbox, this.partition)) {
        const operation = JSON.parse(row.value) as SyncOp;
        if (operation.kind !== "attendance" || operation.payload.assignmentId !== assignmentId) continue;
        remember({ operation, createdAt: row.created_at, status: row.status,
          error: row.error === null ? null : errorBodySchema.parse(JSON.parse(row.error)) });
      }
      const visible = this.active && !this.snapshotHidden ? confirmed : undefined;
      const arrival = this.active ? latest.arrival : undefined;
      const departure = this.active ? latest.departure : undefined;
      return {
        arrival: attendanceProgress("arrival", arrival, visible), departure: attendanceProgress("departure", departure, visible),
        lastConfirmedAt: visible ? confirmation?.confirmedAt ?? null : null, expiresAt: visible ? confirmation?.expiresAt ?? null : null,
        local: { arrival: attendanceProgress("arrival", arrival), departure: attendanceProgress("departure", departure) },
      };
    });
  }

  async prepareSyncBatch(): Promise<SyncBatch> {
    const batch = await this.write(async (db) => {
      const [state] = await db.select(syncState, this.partition);
      // A hidden snapshot was physically purged; only a fresh snapshot can fill it again.
      const cursor = state?.authorized_at == null ? null : state.cursor;
      const candidates = await db.select(outbox, { ...this.partition, status: { op: "in", value: ["queued", "checking"] } },
        { order: ["created_at", "operation_id"] });
      const operations: SyncOp[] = [];
      const newlyChecking: OperationId[] = [];
      let media: ProgressMedia | undefined;
      let hasMoreOperations = false;
      let bytes = (cursor?.length ?? 0) + this.scope.contextId.length + 100;
      for (const candidate of candidates) {
        const op = syncOperationSchema.parse(JSON.parse(candidate.value));
        if (op.kind === "attachment_link") {
          media ??= await this.readProgressMedia(db);
          if (!progressReady(op, media)) continue;
        }
        // A UTF-16 code unit contributes at most three UTF-8 bytes to the already-encoded JSON.
        bytes += candidate.value.length * 3 + 1;
        if (operations.length === syncLimits.operations || bytes > syncLimits.requestBytes) {
          if (!operations.length) throw new Error("Queued operation exceeds the sync request budget");
          hasMoreOperations = true;
          break;
        }
        operations.push(op);
        if (candidate.status === "queued") newlyChecking.push(op.operationId);
      }
      if (newlyChecking.length) await db.update(outbox, { ...this.partition, operation_id: { op: "in", value: newlyChecking } }, { status: "checking" });
      return { cursor, operations, newlyChecking, hasMoreOperations };
    });
    if (batch.newlyChecking.length) this.notify("outbox", "attendance");
    return batch;
  }

  async recordSyncFailure(newlyChecking: readonly OperationId[], hideSnapshot: boolean) {
    if (!newlyChecking.length && !hideSnapshot) return;
    // A known denial must hide the old snapshot even when the disk write fails.
    if (hideSnapshot) {
      this.snapshotHidden = true;
      this.visibility++;
      this.notify("projection", "attendance");
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
    if (newlyChecking.length) this.notify("outbox", "attendance");
  }

  async applySyncPage(page: SyncPage, confirmedAt: number) {
    if (page.context.contextId !== this.scope.contextId) throw new Error("Wrong sync scope");
    const barrier = page.removals.some((row) => row.kind === "scope");
    if (page.removals.some((row) => row.kind === "scope" && row.resourceId !== this.scope.contextId)) throw new Error("Wrong scope removal");
    if (barrier) {
      this.snapshotHidden = true;
      this.visibility++;
      this.notify("projection", "attendance");
    }
    // A signed revocation is an empty, terminal reset; do not renew visibility.
    const mayBeRevoked = barrier && page.mode === "reset" && page.upserts.length === 0 && !page.hasMore;
    const progressChanged = await this.write(async (db) => {
      if (barrier) await db.remove(projection, this.partition);
      else for (const removal of page.removals) {
        await db.remove(projection, { ...this.partition, kind: removal.kind, id: removal.resourceId });
      }
      for (const row of page.upserts) {
        const workerOnly = row.kind === "worker_field_shift" || row.kind === "assignment_briefing";
        const booking = row.kind === "session_booking";
        if (!workerOnly && !booking && row.kind !== "notification") continue;
        const allowed = workerOnly ? page.context.role === "worker" : !booking || page.context.role === "customer";
        const value = allowed ? cacheableValue(row) : null;
        const key = { ...this.partition, kind: row.kind, id: row.resourceId };
        if (value) await db.put(projection, { ...key, value: JSON.stringify(value) });
        else await db.remove(projection, key);
      }
      let progressChanged = false;
      const pending = page.outcomes.length ? await db.select(outbox, {
        ...this.partition, operation_id: { op: "in", value: page.outcomes.map(({ operationId }) => operationId) },
      }) : [];
      const byId = new Map(pending.map((row) => [row.operation_id, row]));
      for (const outcome of page.outcomes) {
        const key = { ...this.partition, operation_id: outcome.operationId };
        const row = byId.get(outcome.operationId);
        if (!row) continue; // A duplicate acknowledgement cannot replace a saved receipt.
        byId.delete(outcome.operationId);
        const operation = JSON.parse(row.value) as SyncOp;
        if (operation.kind === "attachment_link") {
          if (row.status === "rejected" || row.status === "conflict") continue;
          const { photos, state } = progressReceipt(operation, outcome);
          await db.put(progressReceipts, { ...key, assignment_id: operation.payload.assignmentId,
            state, confirmed_at: confirmedAt, photos: JSON.stringify(photos) });
          progressChanged = true;
        }
        if (outcome.status !== "rejected") {
          if (operation.kind === "attendance") await db.put(attendanceReceipts, {
            ...key, assignment_id: operation.payload.assignmentId, created_at: row.created_at, value: row.value,
            result_ref: outcome.status === "unchanged" ? null : outcome.resultRef,
          });
          await db.remove(outbox, key);
        }
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
      return progressChanged;
    });
    this.snapshotHidden = mayBeRevoked;
    const shiftChanged = barrier || page.upserts.some(({ kind }) => kind === "worker_field_shift") ||
      page.removals.some(({ kind }) => kind === "worker_field_shift");
    this.notify("projection", ...(page.outcomes.length ? ["outbox", "attendance"] as const : shiftChanged ? ["attendance"] as const : []));
    if (progressChanged) this.notify("progress");
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

  async createMediaTransfer(item: NewMediaTransfer): Promise<MediaTransfer | null> {
    const { caller, parentScopeId, stageId: existingStage } = item;
    const transfer = await this.write(async (db) => {
      const rows = await db.select(mediaTransfers, { ...this.partition, caller, parent_scope_id: parentScopeId,
        ...(existingStage && { stage_id: existingStage }) }, { order: ["created_at", "attachment_id"] });
      const stageId = existingStage ?? rows.at(-1)?.stage_id ?? mediaStageIdSchema.parse(this.newId());
      if (!fitsDraft(caller, rows.filter((row) => row.stage_id === stageId).map((row) => decodeTransfer(row).file), item.file)) return null;
      const capturedAt = this.now();
      const next: MediaTransfer = {
        ...item, stageId, capturedAt, state: "queued", selected: false, started: false, generation: null,
        probe: null, settlement: null, completedParts: [], terminal: false,
      };
      await db.put(mediaTransfers, { ...this.partition, ...encodeTransfer(next), created_at: capturedAt });
      return next;
    });
    if (transfer) this.notify("media");
    return transfer;
  }

  listMediaTransfers({ attachmentId, caller, parentScopeId, stageId }: TransferQuery = {}, workOnly = false): Promise<MediaTransfer[]> {
    return this.db.read(async (db) => {
      if (!this.active) return [];
      const rows = await db.select(mediaTransfers, {
        ...this.partition, ...(attachmentId && { attachment_id: attachmentId }), ...(caller && { caller }),
        ...(parentScopeId && { parent_scope_id: parentScopeId }), ...(stageId && { stage_id: stageId }),
        ...(workOnly && { selected: 1, file_uri: { op: ">", value: "" },
          state: { op: "in", value: ["queued", "uploading", "verifying", "ready"] } }),
      }, { order: ["created_at", "attachment_id"] });
      return this.active ? rows.map(decodeTransfer) : [];
    });
  }

  async updateMediaTransfer(attachmentId: AttachmentId, change: (item: MediaTransfer) => Partial<TransferProgress> | null) {
    const next = await this.write(async (db) => {
      const key = { ...this.partition, attachment_id: attachmentId };
      const [row] = await db.select(mediaTransfers, key);
      if (!row) return null;
      const item = decodeTransfer(row);
      const patch = change(item);
      if (!patch) return null;
      const updated = { ...item, ...patch };
      const { state, selected, file_uri, value } = encodeTransfer(updated);
      await db.update(mediaTransfers, key, { state, selected, file_uri, value });
      return { updated, failedChanged: item.caller === "progress" && (item.state === "failed") !== (updated.state === "failed") };
    });
    if (next) this.notify("media", ...(next.failedChanged ? ["outbox" as const] : []));
    return next?.updated ?? null;
  }

  async removeMediaTransfer(attachmentId: AttachmentId, erase: (uri: string) => Promise<void>): Promise<boolean> {
    const removed = await this.write(async (db) => {
      const key = { ...this.partition, attachment_id: attachmentId };
      const [row] = await db.select(mediaTransfers, key);
      if (!row || decodeTransfer(row).started) return null;
      if (row.file_uri) await erase(row.file_uri);
      await db.remove(mediaTransfers, key);
      return row.caller;
    });
    if (removed) this.notify("media", ...(removed === "progress" ? ["outbox" as const] : []));
    return removed !== null;
  }

  getOnlineReceipt(kind: string, resourceId: string): Promise<OnlineReceipt | null> {
    return this.db.read(async (db) => {
      if (!this.active) return null;
      const [row] = await db.select(pendingOnlineReceipts, { ...this.partition, kind, resource_id: resourceId }, { limit: 1 });
      return row && this.active ? { operationId: row.operation_id, kind, resourceId, createdAt: row.created_at } : null;
    });
  }

  async claimOnlineReceipt(kind: string, resourceId: string, operationId: string): Promise<{ receipt: OnlineReceipt; existing: boolean }> {
    const claimed = await this.write(async (db) => {
      const where = { ...this.partition, kind, resource_id: resourceId };
      const [row] = await db.select(pendingOnlineReceipts, where, { limit: 1 });
      if (row) return { receipt: { operationId: row.operation_id, kind, resourceId, createdAt: row.created_at }, existing: true };
      const id = operationIdSchema.parse(operationId);
      if (await db.count(pendingOnlineReceipts, { ...this.partition, operation_id: id })) {
        throw new Error("An operation ID belongs to another pending command");
      }
      const createdAt = this.now();
      await db.put(pendingOnlineReceipts, { ...where, operation_id: id, created_at: createdAt });
      return { receipt: { operationId: id, kind, resourceId, createdAt }, existing: false };
    });
    if (!claimed.existing) this.notify("receipts");
    return claimed;
  }

  async removeOnlineReceipt({ operationId, kind, resourceId, createdAt }: OnlineReceipt) {
    // An already-started command can definitively settle after its scope closes.
    // Only erase that exact claim; never recreate anything in a closed scope.
    await this.db.transaction((db) => db.remove(pendingOnlineReceipts, {
      ...this.partition, kind, resource_id: resourceId, operation_id: operationId, created_at: createdAt,
    }));
    if (this.active) this.notify("receipts");
  }
}
