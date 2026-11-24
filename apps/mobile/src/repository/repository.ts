import { errorBodySchema, mediaLimits, mediaStageIdSchema, operationIdSchema, submitRequestRoute, syncLimits, syncOperationSchema } from "@bookbuddy/api-contract";
import type { ActiveContext, ErrorBody, LocalePreferences, OpOutcome, OperationId, ProgressPhotoOutcome, SessionBootstrap, SubmitRequest, SyncOp, SyncPage } from "@bookbuddy/api-contract";
import { fitsDraft } from "../media/types";
import type { AttachmentId, MediaCancellation, MediaTransfer, NewMediaTransfer, RecoveryProbe, TransferProgress, TransferQuery } from "../media/types";
import { offlineBootstrapIsFresh, offlineBootstrapSchema } from "../session/offline-bootstrap";
import type { OfflineBootstrap } from "../session/offline-bootstrap";
import { attendanceProgress } from "./attendance";
import type { AttendanceCapture, AttendanceEventKind, AttendanceOperation, AttendanceSnapshot, LocalAttendance } from "./attendance";
import { cacheableValue, draftExpiresAfter, draftWarnAfter, snapshotWindow } from "./cache";
import type { CachedProjections, CachedWorkerFieldShift, ProjectionKind } from "./cache";
import { cachePolicy, withVolatileCache } from "./cache-policy";
import { legacyRequestMarker, mediaOmittedFromDraft, ownedMediaStages } from "./draft-media";
import type { Executor, Rows } from "./executor";
import { decodeTransfer, encodeTransfer } from "./media-transfers";
import { createMemoryExecutor } from "./memory";
import { pendingAge, pendingHoldAfter, pendingReviewAfter } from "./pending-work";
import { cacheRemoteResponse, decodeRemoteSnapshot } from "./remote-cache";
import type { CachedRead, RemoteCacheKind } from "./remote-cache";
import { attendanceReceipts, drafts, localSettings, mediaCancellations, mediaTransfers, outbox, pendingOnlineReceipts, progressReceipts, projection, stagedMedia, syncState } from "./schema";
import { requestReconciliations } from "./schema";
import type { OutboxStatus, ProgressReceiptState } from "./schema";

export type DevicePreferences = LocalePreferences & Partial<Pick<SessionBootstrap["preferences"], "theme" | "fieldMode" | "twoClock" | "shareDisplayZone">>;

export type Scope = { accountId: string; contextId: string };
export type PendingWork = { drafts: number; waiting: number; checking: number; media: number };
export type DraftKey = `${string}:${string}`;
const draftKeyPattern = /^[a-z][a-z0-9_-]*:[A-Za-z0-9_-]+$/;
const legacyRequestDraft = "request:new";
export type DraftValue = null | boolean | number | string | DraftValue[] | { [key: string]: DraftValue };
export type RequestReconciliation = { operationId: OperationId; expectedRevision: number; body: SubmitRequest | null };
export type Draft<Value extends DraftValue = DraftValue> = { value: Value; updatedAt: number } & (
  { warnAt: number; expiresAt: number; reconciliation?: never } |
  { warnAt: null; expiresAt: null; reconciliation: RequestReconciliation }
);
export type PendingDraft = { draftId: string; updatedAt: number; summary?: string; reconciling?: true };
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
type EraseMedia = (uri: string) => Promise<void>;
type StagingResult = { status: "staged"; item: MediaTransfer } | { status: "draftLimit" | "storageFull" };
export type PendingReviewItem = { createdAt: number; held: boolean } & (
  { kind: "outbox"; id: string; operation: SyncOp["kind"]; checking: boolean } |
  { kind: "media"; id: AttachmentId; file: "photo" | "voice"; canSend: boolean }
);
export type PendingReview = { items: PendingReviewItem[]; nextAt: number | undefined };

function unresolvedMedia(item: MediaTransfer): RecoveryProbe | null {
  if (item.probe) return item.probe;
  if (item.settlement) return item.settlement.kind === "single" ? "put" : "parts";
  return item.completedParts.length > 0 ? "parts" : null;
}

function cancelMedia(item: MediaTransfer): MediaTransfer {
  return { ...item, cancelled: true, selected: false, probe: unresolvedMedia(item) };
}

function cancellationReceipt({ stageId, generation, probe }: MediaTransfer) {
  return probe && generation !== null ? { stage_id: stageId, generation, probe } : null;
}

function transferFor(media: ProgressMedia, assignmentId: string, attachmentId: AttachmentId) {
  const row = media.get(attachmentId);
  return row?.parent_scope_id === assignmentId ? row : undefined;
}

function progressReady({ payload: { assignmentId, photos } }: ProgressOperation, media: ProgressMedia) {
  return photos.every(({ attachmentId }) => {
    const row = transferFor(media, assignmentId, attachmentId);
    return row?.state === "ready" && row.selected === 1;
  });
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
type CardProjectionKind = "worker_field_shift" | "session_booking";
/** Null kind denotes a card backed by an online-only record, not a sync projection. */
export type ReportCardRemoval = (removed: (kind: CardProjectionKind | null, id: string) => boolean | Promise<boolean>) => Promise<void>;
export interface SyncBatch {
  cursor: string | null;
  operations: SyncOp[];
  newlyChecking: OperationId[];
  hasMoreOperations: boolean;
}

export type RepositoryTopic = "projection" | "drafts" | "outbox" | "media" | "receipts" | "attendance" | "progress";
interface RepositoryEvent { revision: number; listeners: Set<() => void> }

const offlineBootstrapKey = "offline-bootstrap";
async function clearCachedAccount(db: Rows, account: { account_id: string }) {
  await db.remove(projection, account);
  await db.remove(syncState, account);
  await db.remove(localSettings, account);
}

export class MobileRepository {
  private volatileCache: Executor | undefined;
  private split: Executor | undefined;

  constructor(private readonly db: Executor, private readonly newId: () => string, readonly now = Date.now,
    private readonly eraseMedia: EraseMedia, readonly persistentAuthoring = false) {}

  openScope(scope: Scope, role?: ActiveContext["role"], reportCardRemoval?: ReportCardRemoval) {
    const db = this.persistentAuthoring && cachePolicy(role, true) === "memory"
      ? (this.split ??= withVolatileCache(this.db, this.volatileCache ??= createMemoryExecutor())) : this.db;
    return new ScopedRepository(db, { ...scope }, this.newId, this.now, this.eraseMedia, this.persistentAuthoring, reportCardRemoval);
  }

  async reconcileStagedFiles(list: () => readonly string[], erase: (uris: readonly string[]) => Promise<void>): Promise<void> {
    // Only run before this store is exposed. Every account's journal owns paths
    // in the same private directory; a different account's files aren't orphans.
    await this.db.transaction(async (db) => {
      const referenced = new Set<string>();
      const interrupted: { account_id: string; context_id: string; attachment_id: AttachmentId }[] = [];
      const omitted = new Map<string, Set<string>>();
      const requestKeys = { key: { op: "prefix", value: "request:" } } as const;
      const authored = await db.select(drafts, requestKeys);
      const checking = await db.select(requestReconciliations, requestKeys);
      for (const rows of [authored, checking]) {
        for (const draft of rows) {
          const ids = mediaOmittedFromDraft(JSON.parse(draft.value) as DraftValue);
          if (!ids.length) continue;
          const partitionKey = JSON.stringify([draft.account_id, draft.context_id]);
          const known = omitted.get(partitionKey) ?? new Set<string>();
          for (const id of ids) known.add(id);
          omitted.set(partitionKey, known);
        }
      }
      for (const { value } of await db.select(stagedMedia, {})) referenced.add((JSON.parse(value) as StagedMedia).fileUri);
      for (const row of await db.select(mediaTransfers, {})) {
        const key = { account_id: row.account_id, context_id: row.context_id, attachment_id: row.attachment_id };
        let item = decodeTransfer(row);
        if (item.caller === "request" && !item.cancelled && omitted.get(JSON.stringify([row.account_id, row.context_id]))?.has(row.attachment_id)) {
          item = cancelMedia(item);
        }
        if (item.staging || item.cancelled) {
          const receipt = item.cancelled && cancellationReceipt(item);
          if (receipt) await db.put(mediaCancellations, { ...key, ...receipt });
          interrupted.push(key);
        } else if (item.fileUri) referenced.add(item.fileUri);
      }
      const orphaned = list().filter((uri) => !referenced.has(uri));
      if (orphaned.length) await erase(orphaned);
      for (const key of interrupted) await db.remove(mediaTransfers, key);
    });
  }

  async getOfflineBootstrap(accountId: string, sessionId: string, contextId: string): Promise<OfflineBootstrap | null> {
    if (!this.persistentAuthoring) return null;
    const [row] = await this.db.read((db) => db.select(localSettings, { account_id: accountId, key: offlineBootstrapKey }));
    if (!row) return null;
    try {
      const cached = offlineBootstrapSchema.safeParse(JSON.parse(row.value));
      return cached.success && cached.data.sessionId === sessionId && cached.data.activeContext.contextId === contextId
        && cachePolicy(cached.data.activeContext.role, true) === "persistent" && offlineBootstrapIsFresh(cached.data, this.now())
        ? cached.data : null;
    } catch { return null; }
  }

  async saveOfflineBootstrap(accountId: string, bootstrap: OfflineBootstrap): Promise<void> {
    if (cachePolicy(bootstrap.activeContext.role, this.persistentAuthoring) !== "persistent") return;
    await this.db.transaction((db) => db.put(localSettings, {
      account_id: accountId, key: offlineBootstrapKey, value: JSON.stringify(offlineBootstrapSchema.parse(bootstrap)),
    }));
  }

  pendingWork(accountId: string): Promise<PendingWork> {
    const account = { account_id: accountId };
    return this.db.read(async (db) => {
      const checking = new Set<string>();
      let waiting = 0;
      for (const row of await db.select(outbox, account)) {
        if (row.status === "checking") checking.add(`${row.context_id}\0${row.operation_id}`);
        else waiting++;
      }
      for (const row of await db.select(pendingOnlineReceipts, account)) checking.add(`${row.context_id}\0${row.operation_id}`);
      for (const row of await db.select(requestReconciliations, account)) checking.add(`${row.context_id}\0${row.operation_id}`);
      const draftsCount = await db.count(drafts, account);
      const older = await db.count(stagedMedia, account);
      const transfers = await db.count(mediaTransfers, { ...account, file_uri: { op: ">", value: "" } });
      return { drafts: draftsCount, waiting, checking: checking.size, media: older + transfers };
    });
  }

  async sealAccount(accountId: string): Promise<void> {
    const account = { account_id: accountId };
    await this.db.transaction((db) => clearCachedAccount(db, account));
    await this.volatileCache?.transaction((db) => clearCachedAccount(db, account));
  }

  async wipeAccount(accountId: string, eraseFiles: (uris: readonly string[]) => Promise<void>): Promise<void> {
    const account = { account_id: accountId };
    await this.db.transaction(async (db) => {
      const files = (await db.select(stagedMedia, account)).map(({ value }) => (JSON.parse(value) as StagedMedia).fileUri);
      for (const { file_uri } of await db.select(mediaTransfers, account)) {
        if (file_uri) files.push(file_uri);
      }
      if (files.length) await eraseFiles(files);
      await clearCachedAccount(db, account);
      await db.remove(drafts, account);
      await db.remove(outbox, account);
      await db.remove(attendanceReceipts, account);
      await db.remove(progressReceipts, account);
      await db.remove(stagedMedia, account);
      await db.remove(mediaTransfers, account);
      await db.remove(mediaCancellations, account);
      await db.remove(pendingOnlineReceipts, account);
      await db.remove(requestReconciliations, account);
    });
    await this.volatileCache?.transaction((db) => clearCachedAccount(db, account));
  }
}

export class ScopedRepository {
  private active = true;
  private snapshotHidden = false;
  private visibility = 0;
  private readonly events = new Map<RepositoryTopic, RepositoryEvent>();
  private readonly progressReadyListeners = new Set<(ids: ReadonlySet<AttachmentId>) => void>();
  private readonly partition: { account_id: string; context_id: string };

  constructor(private readonly db: Executor, readonly scope: Scope, private readonly newId: () => string, readonly now: () => number,
    private readonly eraseMedia: EraseMedia, readonly persistentAuthoring: boolean, private readonly reportCardRemoval?: ReportCardRemoval) {
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
    const where = { ...this.partition, key };
    const result = await this.db.read(async (db) => {
      const [draft] = await db.select(drafts, where);
      if (draft) return { kind: "draft" as const, row: draft };
      if (!key.startsWith("request:")) return null;
      const [checking] = await db.select(requestReconciliations, where);
      return checking ? { kind: "checking" as const, row: checking } : null;
    });
    if (!this.active || !result) return null;
    if (key === legacyRequestDraft) {
      await this.migrateRequestDraft();
      return null;
    }
    const { row } = result;
    const value = JSON.parse(row.value) as Value;
    if (result.kind === "checking") {
      const checking = result.row;
      return { value, updatedAt: row.updated_at, warnAt: null, expiresAt: null, reconciliation: {
        operationId: operationIdSchema.parse(checking.operation_id), expectedRevision: checking.expected_revision,
        body: checking.body === null ? null : JSON.parse(checking.body) as SubmitRequest,
      } };
    }
    const marker = key.startsWith("request:") && legacyRequestMarker(value);
    if (marker) return { value, updatedAt: row.updated_at, warnAt: null, expiresAt: null, reconciliation: { ...marker, body: null } };
    if (this.now() >= row.updated_at + draftExpiresAfter) return null;
    return { value, updatedAt: row.updated_at, warnAt: row.updated_at + draftWarnAfter, expiresAt: row.updated_at + draftExpiresAfter };
  }

  private async migrateRequestDraft() {
    const where = { ...this.partition, key: legacyRequestDraft };
    const moved = await this.write(async (db) => {
      const [legacy] = await db.select(drafts, where);
      if (!legacy) return false;
      const marker = legacyRequestMarker(JSON.parse(legacy.value) as DraftValue);
      if (!marker && this.now() >= legacy.updated_at + draftExpiresAfter) return false;
      const key = `request:${this.newId()}`;
      const target = { ...this.partition, key };
      if (!draftKeyPattern.test(key) || key === legacyRequestDraft || await db.count(drafts, target) || await db.count(requestReconciliations, target)) {
        throw new Error("Invalid or duplicate generated request draft ID");
      }
      if (marker) {
        await db.put(requestReconciliations, { ...legacy, key, operation_id: marker.operationId, expected_revision: marker.expectedRevision, body: null });
      } else await db.put(drafts, { ...legacy, key });
      await db.remove(drafts, where);
      return true;
    });
    if (moved) this.notify("drafts");
  }

  async listPendingDrafts(kind: string): Promise<PendingDraft[]> {
    const cutoff = this.now() - draftExpiresAfter;
    const request = kind === "request";
    const where = { ...this.partition, key: { op: "prefix", value: `${kind}:` } } as const;
    const read = () => this.db.read(async (db) => {
      const rows = await db.select(drafts, request ? where : { ...where, updated_at: { op: ">", value: cutoff } });
      return request ? [...rows, ...await db.select(requestReconciliations, where)] : rows;
    });
    if (!this.active) return [];
    let rows = await read();
    if (this.active && kind === "request" && rows.some(({ key }) => key === legacyRequestDraft)) {
      await this.migrateRequestDraft();
      rows = await read();
    }
    if (!this.active) return [];
    const currentCutoff = this.now() - draftExpiresAfter;
    rows.sort((a, b) => b.updated_at - a.updated_at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const result: PendingDraft[] = [];
    for (const row of rows) {
      const value = request ? JSON.parse(row.value) as DraftValue : null;
      const reconciling = "operation_id" in row || (request && legacyRequestMarker(value));
      if (row.key === legacyRequestDraft || (!reconciling && row.updated_at <= currentCutoff)) continue;
      const draft: PendingDraft = { draftId: row.key.slice(kind.length + 1), updatedAt: row.updated_at, ...(reconciling && { reconciling: true }) };
      const summary = value && typeof value === "object" && !Array.isArray(value) && typeof value.description === "string"
        ? value.description.trim().slice(0, 160) : "";
      if (summary) draft.summary = summary;
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
      if (key.startsWith("request:") && (row ? legacyRequestMarker(JSON.parse(row.value) as DraftValue) : await db.count(requestReconciliations, where))) {
        throw new Error("Submitted requests cannot be edited while checking");
      }
      await db.put(drafts, { ...where, value: text, updated_at: this.now() });
      return true;
    });
    if (changed) this.notify("drafts");
  }

  async beginRequestReconciliation(key: `request:${string}`, input: SubmitRequest): Promise<{ body: SubmitRequest; created: boolean }> {
    if (!draftKeyPattern.test(key) || key === legacyRequestDraft) throw new Error("A stable request draft is required");
    const { body } = submitRequestRoute.input.parse({ body: input });
    const where = { ...this.partition, key };
    const next = await this.write(async (db) => {
      const [existing] = await db.select(requestReconciliations, where);
      if (existing?.body) return { body: JSON.parse(existing.body) as SubmitRequest, created: false };
      const [draft] = await db.select(drafts, where);
      if (!draft) throw new Error("The request draft is no longer available");
      if (existing || legacyRequestMarker(JSON.parse(draft.value) as DraftValue)) {
        throw new Error("The original request operation must be reconciled");
      }
      if (this.now() >= draft.updated_at + draftExpiresAfter) throw new Error("The request draft has expired");
      await db.put(requestReconciliations, {
        ...where, updated_at: this.now(), value: draft.value, operation_id: body.operationId,
        expected_revision: body.expectedRevision, body: JSON.stringify(body),
      });
      await db.remove(drafts, where);
      return { body, created: true };
    });
    if (next.created) this.notify("drafts");
    return next;
  }

  async finishRequestReconciliation(key: `request:${string}`, operationId: OperationId, restore?: DraftValue) {
    const keyInScope = { ...this.partition, key };
    const finished = await this.write(async (db) => {
      const [row] = await db.select(requestReconciliations, keyInScope);
      if (row && row.operation_id !== operationId) return false;
      const legacy = !row || row.body === null;
      if (!row) {
        const [draft] = await db.select(drafts, keyInScope);
        if (!draft || legacyRequestMarker(JSON.parse(draft.value) as DraftValue)?.operationId !== operationId) return false;
        await db.remove(drafts, keyInScope);
      }
      if (restore !== undefined) await db.put(drafts, { ...keyInScope, value: JSON.stringify(restore), updated_at: this.now() });
      if (row) await db.remove(requestReconciliations, keyInScope);
      if (legacy) {
        await db.remove(pendingOnlineReceipts, { ...this.partition, operation_id: operationId,
          resource_id: key.slice("request:".length), kind: `${submitRequestRoute.method} ${submitRequestRoute.path}` });
      }
      return { legacy };
    });
    if (finished) this.notify("drafts", ...(finished.legacy ? ["receipts" as const] : []));
  }

  async removeDraft(key: DraftKey) {
    await this.write((db) => db.remove(drafts, { ...this.partition, key }));
    this.notify("drafts");
  }

  async expireDrafts() {
    const expiry = await this.write(async (db) => {
      const where = { ...this.partition, updated_at: { op: "<=", value: this.now() - draftExpiresAfter } } as const;
      const expired = await db.select(drafts, where);
      if (!expired.length) return null;
      const ownedStages = new Set<string>();
      for (const row of expired) {
        const value = JSON.parse(row.value) as DraftValue;
        const marker = row.key.startsWith("request:") && legacyRequestMarker(value);
        if (marker) {
          // Old clients kept the operation marker in the editable draft.
          const key = row.key === legacyRequestDraft ? `request:${this.newId()}` : row.key;
          await db.put(requestReconciliations, { ...row, key, operation_id: marker.operationId, expected_revision: marker.expectedRevision, body: null });
          continue;
        }
        const owned = ownedMediaStages(row.key, value);
        if (owned) for (const stage of owned.stages) ownedStages.add(`${owned.caller}:${stage}`);
      }
      const cancelled: AttachmentId[] = [];
      if (ownedStages.size) {
        const rows = await db.select(mediaTransfers, this.partition);
        const owned = rows.filter((row) => ownedStages.has(`${row.caller}:${row.stage_id}`));
        const submitted = new Set<string>();
        if (owned.some((row) => row.caller === "progress" || row.caller === "chat")) {
          for (const row of await db.select(outbox, this.partition)) {
            const operation = JSON.parse(row.value) as SyncOp;
            if (operation.kind === "attachment_link") {
              for (const photo of operation.payload.photos) submitted.add(photo.attachmentId);
            } else if (operation.kind === "chat_append") {
              for (const id of operation.payload.attachmentIds ?? []) submitted.add(id);
            }
          }
        }
        for (const row of owned) {
          const item = decodeTransfer(row);
          if (item.cancelled || item.state === "ready" || unresolvedMedia(item) || submitted.has(item.attachmentId)) continue;
          const { selected, value } = encodeTransfer(cancelMedia(item));
          await db.update(mediaTransfers, { ...this.partition, attachment_id: item.attachmentId }, { selected, value });
          cancelled.push(item.attachmentId);
        }
      }
      await db.remove(drafts, where);
      return cancelled;
    });
    if (!expiry) return;
    this.notify("drafts", ...(expiry.length ? ["media" as const] : []));
    for (const id of expiry) await this.finishMediaCancellation(id, this.eraseMedia).catch(() => undefined);
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
      await db.put(outbox, { ...key, value, status: "queued", created_at: this.now(), error: null, send_reviewed: 0 });
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

  listPendingReview(): Promise<PendingReview> {
    return this.db.read(async (db) => {
      const items: PendingReviewItem[] = [];
      if (!this.active) return { items, nextAt: undefined };
      let nextAt: number | undefined;
      const now = this.now();
      const age = (createdAt: number) => {
        const state = pendingAge(createdAt, now);
        const next = state === "current" ? createdAt + pendingReviewAfter : state === "review" ? createdAt + pendingHoldAfter : undefined;
        if (next !== undefined && (nextAt === undefined || next < nextAt)) nextAt = next;
        return state;
      };
      for (const row of await db.select(outbox, {
        ...this.partition, send_reviewed: 0, status: { op: "in", value: ["queued", "checking"] },
      })) {
        const state = age(row.created_at);
        if (state === "current") continue;
        const operation = JSON.parse(row.value) as SyncOp;
        items.push({ kind: "outbox", id: row.operation_id, operation: operation.kind, createdAt: row.created_at,
          held: state === "held", checking: row.status === "checking" });
      }
      for (const row of await db.select(mediaTransfers, { ...this.partition, selected: 1, file_uri: { op: ">", value: "" } })) {
        const item = decodeTransfer(row);
        if (item.staging || item.cancelled || item.state === "ready" || item.sendReviewed) continue;
        const state = age(row.created_at);
        if (state !== "current") items.push({ kind: "media", id: item.attachmentId, file: item.file.kind, createdAt: row.created_at,
          held: state === "held", canSend: !item.terminal });
      }
      items.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      return this.active ? { items, nextAt } : { items: [], nextAt: undefined };
    });
  }

  async decidePendingOperation(operationId: string, send: boolean): Promise<"discarded" | "sync" | "media" | null> {
    const action = await this.write(async (db) => {
      const key = { ...this.partition, operation_id: operationId };
      const [row] = await db.select(outbox, { ...key, status: { op: "in", value: ["queued", "checking"] } });
      if (!row || pendingAge(row.created_at, this.now(), row.send_reviewed === 1) !== "held") return null;
      if (!send) {
        await db.remove(outbox, key);
        return "discarded" as const;
      }
      const operation = JSON.parse(row.value) as SyncOp;
      let needsMedia = false;
      if (operation.kind === "attachment_link") {
        const { photos, assignmentId } = operation.payload;
        const media = await this.readProgressMedia(db, photos.map(({ attachmentId }) => attachmentId));
        const transfers: MediaTransfer[] = [];
        for (const { attachmentId } of photos) {
          const source = transferFor(media, assignmentId, attachmentId);
          if (!source?.selected) return null;
          if (source.state === "ready") continue;
          const item = decodeTransfer(source);
          if (!item.fileUri || item.terminal || item.cancelled || item.staging) return null;
          transfers.push(item);
        }
        for (const item of transfers) {
          const state = item.state === "failed" ? item.probe || item.settlement ? "verifying" : item.started ? "uploading" : "queued" : item.state;
          if (item.sendReviewed && state === item.state) continue;
          const { value } = encodeTransfer({ ...item, state, sendReviewed: true });
          await db.update(mediaTransfers, { ...this.partition, attachment_id: item.attachmentId }, { value, state });
        }
        needsMedia = transfers.length !== 0;
      }
      await db.update(outbox, key, { send_reviewed: 1 });
      return needsMedia ? "media" as const : "sync" as const;
    });
    if (action) this.notify("outbox", "attendance", ...(action === "media" ? ["media" as const] : []));
    return action;
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
      if (!row || !this.active || pendingAge(row.created_at, this.now(), row.send_reviewed === 1) === "held") return null;
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
      const now = this.now();
      for (const row of await db.select(outbox, { ...this.partition, status: "queued" })) {
        if (pendingAge(row.created_at, now, row.send_reviewed === 1) === "held") continue;
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
            return !transfer?.selected || transfer.state === "failed";
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
      const now = this.now();
      for (const candidate of candidates) {
        if (pendingAge(candidate.created_at, now, candidate.send_reviewed === 1) === "held") continue;
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
        await this.reportCardRemoval?.(() => true);
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
    // A signed revocation is an empty, terminal reset; a paged reset is not absence.
    const mayBeRevoked = barrier && page.mode === "reset" && !page.snapshotComplete && page.upserts.length === 0 && !page.hasMore;
    if (barrier) {
      this.snapshotHidden = true;
      this.visibility++;
      this.notify("projection", "attendance");
    }
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
      if (this.reportCardRemoval && (mayBeRevoked || page.snapshotComplete ||
          page.removals.some(({ kind }) => kind === "worker_field_shift" || kind === "session_booking"))) {
        // Journal an authoritative stop before publishing a cursor that can no
        // longer deliver the removal, including when the projection is volatile.
        await this.reportCardRemoval(async (kind, id) => mayBeRevoked || (kind !== null &&
          (page.removals.some((row) => row.kind === kind && row.resourceId === id) ||
            (page.snapshotComplete && !await db.count(projection, { ...this.partition, kind, id })))));
      }
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

  async createMediaTransfer(item: NewMediaTransfer, copy: () => void | Promise<void>): Promise<StagingResult> {
    const { caller, parentScopeId, stageId: existingStage } = item;
    const key = { ...this.partition, attachment_id: item.attachmentId };
    const reserved = await this.write(async (db): Promise<StagingResult> => {
      const rows = await db.select(mediaTransfers, { ...this.partition, caller, parent_scope_id: parentScopeId,
        ...(existingStage && { stage_id: existingStage }) }, { order: ["created_at", "attachment_id"] });
      const stageId = existingStage ?? rows.at(-1)?.stage_id ?? mediaStageIdSchema.parse(this.newId());
      const files = rows.filter((row) => row.stage_id === stageId).map(decodeTransfer).filter((row) => !row.cancelled).map(({ file }) => file);
      if (!fitsDraft(caller, files, item.file)) return { status: "draftLimit" };
      if (await db.count(mediaTransfers, key) || await db.count(mediaCancellations, key)) throw new Error("An attachment ID cannot be used twice");
      const account = { account_id: this.scope.accountId };
      let bytes = item.file.bytes;
      for (const row of await db.select(mediaTransfers, { ...account, file_uri: { op: ">", value: "" } })) {
        bytes += decodeTransfer(row).file.bytes;
        if (bytes > mediaLimits.pendingBytes) return { status: "storageFull" };
      }
      for (const { value } of await db.select(stagedMedia, account)) {
        bytes += (JSON.parse(value) as StagedMedia).bytes;
        if (bytes > mediaLimits.pendingBytes) return { status: "storageFull" };
      }
      const capturedAt = this.now();
      const next: MediaTransfer = {
        ...item, stageId, capturedAt, state: "queued", selected: false, started: false, generation: null,
        probe: null, settlement: null, completedParts: [], terminal: false, staging: true,
      };
      await db.put(mediaTransfers, { ...this.partition, ...encodeTransfer(next), created_at: capturedAt });
      return { status: "staged", item: next };
    });
    if (reserved.status !== "staged") return reserved;
    const completed = { ...reserved.item, staging: false };
    try {
      // The committed locator above survives a crash. The local copy and the
      // ready-to-select update serialize against expiry and account disposal.
      await this.write(async (db) => {
        const [row] = await db.select(mediaTransfers, key);
        const journal = row && decodeTransfer(row);
        if (!journal?.staging || journal.cancelled) throw new Error("The media reservation has been removed");
        await copy();
        await db.update(mediaTransfers, key, { value: encodeTransfer(completed).value });
      });
    } catch (error) {
      // There is no transfer to retain for a failed copy. This exact journal
      // can be cleaned even if its scope closed while the picker was open.
      await this.db.transaction(async (db) => {
        const [row] = await db.select(mediaTransfers, key);
        if (!row || row.file_uri !== item.fileUri || !decodeTransfer(row).staging) return;
        await this.eraseMedia(item.fileUri);
        await db.remove(mediaTransfers, key);
      }).catch(() => undefined);
      throw error;
    }
    this.notify("media");
    return { status: "staged", item: completed };
  }

  listMediaTransfers({ attachmentId, caller, parentScopeId, stageId }: TransferQuery = {}, workOnly = false): Promise<MediaTransfer[]> {
    return this.db.read(async (db) => {
      if (!this.active) return [];
      const rows = await db.select(mediaTransfers, {
        ...this.partition, ...(attachmentId && { attachment_id: attachmentId }), ...(caller && { caller }),
        ...(parentScopeId && { parent_scope_id: parentScopeId }), ...(stageId && { stage_id: stageId }),
        ...(workOnly && { file_uri: { op: ">", value: "" } }),
      }, { order: ["created_at", "attachment_id"] });
      if (!this.active) return [];
      return rows.map(decodeTransfer).filter((item) => workOnly
        ? item.cancelled || (!item.staging && item.selected && item.state !== "failed")
        : !item.staging && !item.cancelled);
    });
  }

  async updateMediaTransfer(attachmentId: AttachmentId, change: (item: MediaTransfer) => Partial<TransferProgress> | null) {
    const next = await this.write(async (db) => {
      const key = { ...this.partition, attachment_id: attachmentId };
      const [row] = await db.select(mediaTransfers, key);
      if (!row) return null;
      const item = decodeTransfer(row);
      if (item.staging || item.cancelled) return null;
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

  async removeMediaTransfer(attachmentId: AttachmentId, erase: EraseMedia): Promise<boolean> {
    const cancelled = await this.write(async (db) => {
      const key = { ...this.partition, attachment_id: attachmentId };
      const [row] = await db.select(mediaTransfers, key);
      if (!row) return null;
      const item = decodeTransfer(row);
      if (item.cancelled) return item;
      const next = cancelMedia(item);
      const { selected, value } = encodeTransfer(next);
      await db.update(mediaTransfers, key, { selected, value });
      return next;
    });
    if (!cancelled) return false;
    this.notify("media", ...(cancelled.caller === "progress" ? ["outbox" as const] : []));
    await this.finishMediaCancellation(attachmentId, erase);
    return true;
  }

  async finishMediaCancellation(attachmentId: AttachmentId, erase: EraseMedia) {
    const changed = await this.write(async (db) => {
      const key = { ...this.partition, attachment_id: attachmentId };
      const [row] = await db.select(mediaTransfers, key);
      if (!row) return false;
      const item = decodeTransfer(row);
      if (!item.cancelled) return false;
      // The locator still owns bytes if local deletion fails. Never make
      // deletion or release of this reservation depend on remote authority.
      if (row.file_uri) {
        try { await erase(row.file_uri); } catch { return false; }
      }
      const receipt = cancellationReceipt(item);
      if (receipt) await db.put(mediaCancellations, { ...key, ...receipt });
      await db.remove(mediaTransfers, key);
      return true;
    });
    if (changed) this.notify("media");
    return changed;
  }

  listMediaCancellations(): Promise<MediaCancellation[]> {
    return this.db.read(async (db) => {
      if (!this.active) return [];
      const rows = await db.select(mediaCancellations, this.partition);
      return this.active ? rows.map(({ attachment_id, stage_id, generation, probe }) =>
        ({ attachmentId: attachment_id, stageId: stage_id, generation, probe })) : [];
    });
  }

  acknowledgeMediaCancellation({ attachmentId, stageId, generation, probe }: MediaCancellation) {
    return this.write((db) => db.remove(mediaCancellations, {
      ...this.partition, attachment_id: attachmentId, stage_id: stageId, generation, probe,
    }));
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
