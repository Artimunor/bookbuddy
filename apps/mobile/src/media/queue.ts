import type { ApiResult, RequestOptions } from "@bookbuddy/api-client";
import { mediaLimits } from "@bookbuddy/api-contract";
import type { AttachmentState, MediaSettlement, MediaUploadGrant, RouteRequest, RouteResponse, createMediaGrantsRoute, recoverMediaRoute, settleMediaRoute } from "@bookbuddy/api-contract";
import type { ScopedRepository } from "../repository/repository";
import type { AttachmentId, MediaStageId, MediaTransfer, TransferProgress } from "./types";

type GrantsRequest = RouteRequest<typeof createMediaGrantsRoute.input>["body"];
type RecoverRequest = RouteRequest<typeof recoverMediaRoute.input>["body"];
type SettleRequest = RouteRequest<typeof settleMediaRoute.input>["body"];
type GrantReply = RouteResponse<typeof createMediaGrantsRoute.output>;
type RecoverReply = RouteResponse<typeof recoverMediaRoute.output>;
type SettleReply = RouteResponse<typeof settleMediaRoute.output>;

type TransferApi = {
  createGrants: (body: GrantsRequest, options?: RequestOptions) => Promise<ApiResult<GrantReply>>;
  recover: (body: RecoverRequest, options?: RequestOptions) => Promise<ApiResult<RecoverReply>>;
  settle: (body: SettleRequest, options?: RequestOptions) => Promise<ApiResult<SettleReply>>;
};
export type SignedPut = { url: string; headers?: Record<string, string>; offset: number; bytes: number; signal: AbortSignal };
export type PutReceipt = { status: number; etag?: string };
export type TransferFiles = {
  size: (uri: string) => number | null;
  erase: (uri: string) => Promise<void>;
  put: (uri: string, request: SignedPut) => Promise<PutReceipt>;
};
type TransferStore = Pick<ScopedRepository, "isActive" | "listMediaTransfers" | "updateMediaTransfer" | "removeMediaTransfer" | "notifyProgressReady">;
type Grant = { generation: number; value: MediaUploadGrant };
const isRejected = (state: AttachmentState) => state === "rejected" || state === "expired";
const serverDenied = (code: string) => code === "UNAUTHENTICATED" || code === "NOT_FOUND" || code === "CONFLICT" || code === "VALIDATION_FAILED" || code === "INVALID_INPUT";
const definitelyNotPut = (status: number) => [400, 401, 403, 404, 405, 411, 413, 415, 416].includes(status);

function settlementFor(item: MediaTransfer, kind: MediaSettlement["kind"], generation: number): MediaSettlement {
  const reservation = { attachmentId: item.attachmentId, uploadGeneration: generation };
  return kind === "single" ? { ...reservation, kind } : { ...reservation, kind, parts: item.completedParts };
}

export class MediaQueue {
  private readonly abort = new AbortController();
  private readonly grants = new Map<AttachmentId, Grant>();
  private running: Promise<void> | null = null;
  private requested = false;
  private readyProgress: Set<AttachmentId> | null = null;

  constructor(
    private readonly store: TransferStore,
    private readonly api: TransferApi,
    private readonly files: TransferFiles,
    private readonly permitted: () => boolean,
    private readonly now = Date.now,
  ) {}

  stop() {
    this.abort.abort();
    this.grants.clear();
    this.requested = false;
  }

  private get canRun() { return !this.abort.signal.aborted && this.store.isActive && this.permitted(); }

  // Only a lifecycle event or explicit action requests a pass. Requests arriving
  // during a pass coalesce; a stalled/unknown row cannot schedule its own retry.
  kick(): Promise<void> {
    if (!this.canRun) return Promise.resolve();
    this.requested = true;
    if (!this.running) this.running = this.drain().finally(() => {
      this.running = null;
      const ready = this.readyProgress;
      this.readyProgress = null;
      if (ready) this.store.notifyProgressReady(ready);
    });
    return this.running;
  }

  async retry(attachmentId: AttachmentId) {
    await this.store.updateMediaTransfer(attachmentId, (item) => item.selected && item.state === "failed" && !item.terminal
      ? { state: item.settlement || item.probe ? "verifying" : item.started ? "uploading" : "queued" }
      : null);
    return this.kick();
  }

  remove(attachmentId: AttachmentId) { return this.store.removeMediaTransfer(attachmentId, this.files.erase); }

  private async drain() {
    while (this.requested && this.canRun) {
      this.requested = false;
      const stages = new Map<MediaStageId, MediaTransfer[]>();
      for (const item of await this.store.listMediaTransfers({}, true)) {
        if (item.state === "ready") {
          await this.eraseReady(item);
          continue;
        }
        const stage = stages.get(item.stageId);
        if (stage) stage.push(item);
        else stages.set(item.stageId, [item]);
      }
      for (const [stageId, rows] of stages) {
        for (let start = 0; start < rows.length && this.canRun; start += mediaLimits.batch) {
          await this.advance(stageId, rows.slice(start, start + mediaLimits.batch));
        }
      }
    }
  }

  private update(item: MediaTransfer, patch: Partial<TransferProgress>) {
    return this.store.isActive && !this.abort.signal.aborted
      ? this.store.updateMediaTransfer(item.attachmentId, () => patch)
      : Promise.resolve(null);
  }

  private async failed(item: MediaTransfer, terminal = false, patch?: Partial<TransferProgress>) {
    this.grants.delete(item.attachmentId);
    await this.update(item, { state: "failed", terminal, ...patch });
  }

  private async ready(item: MediaTransfer, generation: number) {
    this.grants.delete(item.attachmentId);
    const committed = await this.update(item, { state: "ready", generation, probe: null, settlement: null, completedParts: [] });
    if (!committed) return;
    if (committed.caller === "progress") (this.readyProgress ??= new Set()).add(committed.attachmentId);
    await this.eraseReady(committed);
  }

  private async eraseReady(item: MediaTransfer) {
    if (!item.fileUri || !this.store.isActive || this.abort.signal.aborted) return;
    // Don't clear the locator until deletion succeeds; after a crash this is safe to repeat.
    try { await this.files.erase(item.fileUri); } catch { return; }
    await this.update(item, { fileUri: null });
  }

  private async advance(stageId: MediaStageId, batch: MediaTransfer[]) {
    const options = { signal: this.abort.signal };
    const unknown = batch.flatMap(({ attachmentId, probe, generation }) => probe && generation !== null
      ? [{ attachmentId, uploadGeneration: generation, unknown: probe }] : []);
    const remaining = batch.filter(({ probe }) => !probe);
    const missing = new Map<AttachmentId, number[]>();
    if (unknown.length && this.canRun) {
      const recovery = await this.api.recover({ stageId, files: unknown }, options);
      if (recovery.ok && recovery.data.stageId === stageId) {
        const results = new Map(recovery.data.files.map((file) => [file.attachmentId, file]));
        for (const item of batch) {
          if (!item.probe) continue;
          const result = results.get(item.attachmentId);
          if (!result || result.uploadGeneration !== item.generation) continue;
          if (result.state === "ready") await this.ready(item, result.uploadGeneration);
          else if (isRejected(result.state)) await this.failed(item, true, { probe: null });
          else if (result.state === "uploading") {
            const transfer = result.transfer;
            const parts = transfer.kind === "multipart" ? transfer.completedParts : [];
            const complete = transfer.kind === "multipart" && transfer.missingPartNumbers.length === 0;
            const settlement = complete ? settlementFor({ ...item, completedParts: parts }, "multipart", result.uploadGeneration) : null;
            const next = await this.update(item, { probe: null, completedParts: parts, settlement, state: complete ? "verifying" : "uploading" });
            if (next) remaining.push(next);
            if (transfer.kind === "multipart" && !complete) missing.set(item.attachmentId, transfer.missingPartNumbers);
          }
        }
      } else if (!recovery.ok && serverDenied(recovery.error.code)) {
        for (const item of batch) if (item.probe) await this.failed(item);
      }
    }

    const toGrant: MediaTransfer[] = [];
    const toUpload: { item: MediaTransfer; grant: Grant }[] = [];
    const toSettle = remaining.filter(({ settlement }) => settlement);
    for (const item of remaining) {
      if (item.settlement || !item.fileUri || !this.canRun) continue;
      if (this.files.size(item.fileUri) !== item.file.bytes) {
        await this.failed(item, true);
        continue;
      }
      const active = item.started ? item : await this.store.updateMediaTransfer(item.attachmentId, (current) =>
        current.selected && current.state === "queued" ? { started: true, state: "uploading" } : null);
      if (!active) continue; // Removed while waiting to claim.
      const grant = this.grants.get(active.attachmentId);
      if (grant?.generation === active.generation && grant.value.expiresAt > this.now()) toUpload.push({ item: active, grant });
      else {
        this.grants.delete(active.attachmentId);
        toGrant.push(active);
      }
    }

    if (toGrant.length && this.canRun) {
      const { caller, parentScopeId } = toGrant[0]!;
      const response = await this.api.createGrants({ stageId, scope: { caller, parentScopeId }, files: toGrant.map(({ attachmentId, file, generation }) => {
        const missingPartNumbers = missing.get(attachmentId);
        return { attachmentId, file, ...(generation !== null && { refresh: { uploadGeneration: generation, missingPartNumbers } }) };
      }) }, options);
      if (response.ok && response.data.stageId === stageId) {
        const grants = new Map(response.data.grants.map((grant) => [grant.attachmentId, grant]));
        for (const item of toGrant) {
          const result = grants.get(item.attachmentId);
          if (!result) continue;
          const generation = result.uploadGeneration;
          if (result.state === "ready") await this.ready(item, generation);
          else if (isRejected(result.state)) await this.failed(item, true, { generation });
          else if (result.state === "uploading") {
            const next = await this.update(item, { generation, ...(generation !== item.generation && { completedParts: [] }) });
            if (!next) continue;
            const grant = { generation, value: result.grant };
            this.grants.set(item.attachmentId, grant);
            toUpload.push({ item: next, grant });
          } else {
            const probe = result.state === "verifying" ? (item.file.bytes > 4 * 1024 * 1024 ? "completion" : "put") : null;
            await this.update(item, { generation, probe, state: probe ? "verifying" : "uploading" });
          }
        }
      } else if (!response.ok && serverDenied(response.error.code)) {
        for (const item of toGrant) await this.failed(item);
      }
    }

    if (this.canRun) {
      const uploaded = await Promise.all(toUpload.map(({ item, grant }) => this.upload(item, grant)));
      for (const item of uploaded) if (item?.settlement) toSettle.push(item);
    }

    if (toSettle.length && this.canRun) await this.settle(stageId, toSettle);
  }

  private async upload(item: MediaTransfer, { generation, value }: Grant) {
    if (!item.fileUri || !this.canRun || value.expiresAt <= this.now()) return null;
    const fileUri = item.fileUri;
    const probe = value.kind === "single" ? "put" : "parts";
    if (!await this.update(item, { state: "uploading", probe })) return null;
    if (!this.canRun || value.expiresAt <= this.now()) return this.update(item, { probe: null });

    const completedParts = [...item.completedParts];
    const requests = value.kind === "single" ? [{ url: value.url, headers: value.headers, offset: 0, bytes: item.file.bytes }]
      : value.parts.filter((part) => !completedParts.some(({ partNumber }) => part.partNumber === partNumber));
    for (const request of requests) {
      let receipt: PutReceipt;
      try { receipt = await this.files.put(fileUri, { ...request, signal: this.abort.signal }); }
      catch { return this.update(item, { state: "verifying", completedParts }); }
      if (receipt.status < 200 || receipt.status >= 300) {
        if (definitelyNotPut(receipt.status)) {
          await this.failed(item, false, { probe: null, completedParts });
          return null;
        }
        // A conditional 412 may be a previously committed object. Check it rather than overwrite it.
        return this.update(item, { state: "verifying", completedParts });
      }
      if ("partNumber" in request) {
        if (!receipt.etag || !/^[\x21-\x7e]{1,128}$/.test(receipt.etag)) return this.update(item, { state: "verifying", completedParts });
        completedParts.push({ partNumber: request.partNumber, etag: receipt.etag });
      }
    }
    this.grants.delete(item.attachmentId);
    return this.update(item, { state: "verifying", probe: null, completedParts,
      settlement: settlementFor({ ...item, completedParts }, value.kind, generation) });
  }

  private async settle(stageId: MediaStageId, items: MediaTransfer[]) {
    const marked: MediaTransfer[] = [];
    for (const item of items) {
      if (!item.settlement) continue;
      const next = await this.update(item, { probe: item.settlement.kind === "single" ? "put" : "completion" });
      if (next) marked.push(next);
    }
    if (!marked.length) return;
    if (!this.canRun) {
      for (const item of marked) await this.update(item, { probe: null });
      return;
    }
    const result = await this.api.settle({ stageId, files: marked.map(({ settlement }) => settlement!) }, { signal: this.abort.signal });
    if (!result.ok || result.data.stageId !== stageId) return;
    const records = new Map(result.data.acknowledgements.map((ack) => [ack.attachmentId, ack]));
    for (const item of marked) {
      const ack = records.get(item.attachmentId);
      if (!ack || ack.uploadGeneration !== item.generation) continue;
      if (ack.state === "ready") await this.ready(item, ack.uploadGeneration);
      else if (isRejected(ack.state)) await this.failed(item, true, { probe: null });
      // An unacknowledged completion stays unknown until a later permitted pass.
    }
  }
}
