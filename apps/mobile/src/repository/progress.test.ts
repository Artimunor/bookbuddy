import { attachmentIdSchema, operationIdSchema, scopeHeaderSchema } from "@bookbuddy/api-contract";
import type { OpOutcome, SyncRequest } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { MediaQueue } from "../media/queue";
import type { AttachmentId, MediaTransferState } from "../media/types";
import { retryOutboxOperation, SyncRunner } from "../sync/runner";
import type { NewOperation, ScopedRepository } from "./repository";
import { context, page, testRepository } from "./sqlite.test-kit";

const worker = scopeHeaderSchema.parse({ contextId: context.contextId, role: "worker", businessId: "business" });
const assignmentId = "assignment";
const photoFile = { kind: "photo", mime: "image/jpeg", bytes: 1_200 } as const;
const successfulPhoto = { activityId: "event-1", status: "committed", receivedAt: 870 } as const;
const rejectedPhoto = { activityId: "event-2", status: "rejected", error: { code: "VALIDATION_FAILED" } } as const;

function link(attachmentIds: readonly string[], assignment = assignmentId): NewOperation {
  return { kind: "attachment_link", payload: { assignmentId: assignment, photos: attachmentIds.map((attachmentId, i) => ({
    activityId: `event-${i + 1}`, attachmentId, capturedAt: 830 + i,
    caption: { language: "en", text: "do-not-copy-to-receipt" },
  })) } };
}

async function stage(repo: ScopedRepository, id: string, state: MediaTransferState, assignment = assignmentId): Promise<AttachmentId> {
  const attachmentId = attachmentIdSchema.parse(id);
  await repo.createMediaTransfer({ attachmentId, operationId: operationIdSchema.parse(`transfer-${id}`),
    caller: "progress", parentScopeId: assignment, file: photoFile, fileUri: `file:///staged/${id}.jpg` }, () => {});
  await repo.updateMediaTransfer(attachmentId, () => ({ state, selected: true, started: state !== "queued" }));
  return attachmentId;
}

test("settles per-photo progress evidence atomically and retains the first receipt across scope reopen", async () => {
  const { database, repository, mobile } = await testRepository();
  try {
    const operationId = await repository.enqueueOperation(link(["first", "second"]));
    const rejectedId = await repository.enqueueOperation(link(["another"]));
    const mixed: OpOutcome = { operationId, status: "committed", resultRef: operationId, photoOutcomes: [successfulPhoto, rejectedPhoto] };
    const rejected: OpOutcome = { operationId: rejectedId, status: "rejected", error: { code: "VALIDATION_FAILED" },
      photoOutcomes: [{ ...rejectedPhoto, activityId: "event-1" }] };
    await repository.applySyncPage(page("recorded", { context: worker, outcomes: [mixed, rejected] }), 902);
    await repository.applySyncPage(page("duplicate", { context: worker, outcomes: [mixed, rejected] }), 990);
    expect(await repository.listOutbox()).toMatchObject([{ operation: { operationId: rejectedId }, status: "rejected" }]);
    const expected = [
      { operationId, state: "recorded", confirmedAt: 902, activityIds: ["event-1"], photoOutcomes: [successfulPhoto, rejectedPhoto] },
      { operationId: rejectedId, state: "rejected", confirmedAt: 902, activityIds: [], photoOutcomes: rejected.photoOutcomes },
    ];
    const rows = () => database.query("SELECT * FROM progress_receipts").all();
    expect(rows()).toHaveLength(2);
    expect(JSON.stringify(rows())).not.toContain("do-not-copy-to-receipt");
    repository.close();
    expect(await repository.listProgressReceipts(assignmentId)).toEqual([]);
    const reopened = mobile.openScope(repository.scope);
    expect(await reopened.listProgressReceipts(assignmentId)).toEqual(expected);
    expect(await reopened.listProgressReceipts("another-assignment")).toEqual([]);
    expect(await mobile.openScope({ ...repository.scope, accountId: "another-account" }).listProgressReceipts(assignmentId)).toEqual([]);
    await mobile.wipeAccount(repository.scope.accountId, async () => {});
    expect(await reopened.listProgressReceipts(assignmentId)).toEqual([]);
  } finally { database.close(); }
});

test("mismatched photo evidence or a cursor failure cannot consume the queued operation", async () => {
  const { database, repository } = await testRepository();
  try {
    await repository.applySyncPage(page("before", { context: worker }), 890);
    const photo = await stage(repository, "staged", "ready");
    const operationId = await repository.enqueueOperation(link([photo]));
    await repository.prepareSyncBatch();
    const after = (activityId: string) => page("after", { context: worker, outcomes: [{
      status: "replayed", operationId, resultRef: operationId,
      photoOutcomes: [{ status: "replayed", activityId, receivedAt: 875 }],
    }] });
    await expect(repository.applySyncPage(after("wrong-event"), 900)).rejects.toThrow("Wrong progress photo outcomes");
    database.exec("CREATE TRIGGER fail_progress_cursor BEFORE UPDATE ON sync_state BEGIN SELECT RAISE(ABORT,'cursor failed'); END");
    await expect(repository.applySyncPage(after("event-1"), 900)).rejects.toThrow("cursor failed");
    expect(await repository.listProgressReceipts(assignmentId)).toEqual([]);
    expect(await repository.prepareSyncBatch()).toMatchObject({ cursor: "before", operations: [{ operationId }] });
  } finally { database.close(); }
});

test("media failures stay removable and retrying a ready burst wakes only one scoped sync", async () => {
  const { database, repository } = await testRepository();
  try {
    const wrong = await stage(repository, "wrong-parent", "ready", "another-assignment");
    const first = await stage(repository, "photo-a", "failed");
    const second = await stage(repository, "photo-b", "failed");
    const blocked = await Promise.all(Array.from({ length: 10 }, () => repository.enqueueOperation(link([wrong]))));
    const operationId = await repository.enqueueOperation(link([first, second]));
    const notification = await repository.enqueueOperation({ kind: "notification_read_mark", payload: { ids: ["notice"] } });
    const sending = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const sent: SyncRequest[] = [];
    const runner = new SyncRunner(async (request) => {
      sent.push(request);
      if (sent.length === 1) { sending.resolve(); await release.promise; }
      return { ok: true, data: page(`cursor-${sent.length}`, { context: worker, outcomes: request.operations.map((op): OpOutcome => ({
        operationId: operationIdSchema.parse(op.operationId), status: "unchanged", ...(op.kind === "attachment_link" && {
          photoOutcomes: op.payload.photos.map(({ activityId }) => ({ activityId, status: "replayed", receivedAt: 940 })),
        }),
      })) }), meta: { requestId: "response", serverTime: 970 } };
    });
    const refresh = () => runner.refresh(repository);
    expect((await repository.listOutbox()).find((entry) => entry.operation.operationId === operationId)?.status).toBe("failed");
    expect(await repository.removeUnsentOperation(blocked[0]!)).toBe(true);
    expect(await retryOutboxOperation(repository, blocked[1]!, refresh)).toBeNull();
    expect(sent).toHaveLength(0);
    const running = refresh();
    await sending.promise;
    expect(sent[0]?.operations.map((op) => op.operationId)).toEqual([notification]);
    await repository.updateMediaTransfer(first, () => ({ state: "ready" }));
    expect(await runner.refreshReadyProgress(repository, new Set([first]), () => false)).toBe(false);
    expect(await repository.hasReadyProgress(new Set([first]))).toBe(false);

    const wakes: { ids: AttachmentId[]; done: Promise<boolean> }[] = [];
    const unsubscribe = repository.subscribeProgressReady((ids) => {
      wakes.push({ ids: [...ids], done: runner.refreshReadyProgress(repository, ids, () => true) });
    });
    const media = new MediaQueue(repository, {
      async createGrants({ stageId, files }) { return { ok: true, data: { stageId, grants: files.map(({ attachmentId }) => ({
        attachmentId, state: "ready", uploadGeneration: 1,
      })) }, meta: { requestId: "grant", serverTime: 940 } }; },
      async recover() { throw new Error("Unexpected storage recovery"); },
      async settle() { throw new Error("Unexpected storage settlement"); },
    }, { size: () => photoFile.bytes, async erase() {}, async put() { throw new Error("Unexpected upload"); } }, () => true);
    const retried: AttachmentId[] = [];
    expect(await retryOutboxOperation(repository, operationId, refresh, async (id) => {
      retried.push(id); await media.retry(id);
    })).toBeNull();
    expect(retried).toEqual([second]);
    expect(wakes.map(({ ids }) => ids)).toEqual([[second]]);
    expect(sent).toHaveLength(1);
    const coalesced = runner.refreshReadyProgress(repository, new Set([first, second]), () => true);
    expect(coalesced).toBe(wakes[0]?.done);
    release.resolve();
    await running;
    await coalesced;
    expect(sent).toHaveLength(2);
    expect(sent[1]?.operations.map((op) => op.operationId)).toEqual([operationId]);
    expect(await repository.listProgressReceipts(assignmentId)).toMatchObject([{ operationId, state: "recorded", activityIds: ["event-1", "event-2"] }]);
    unsubscribe();
  } finally { database.close(); }
});
