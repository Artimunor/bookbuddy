import { attachmentIdSchema, mediaLimits, mediaStageIdSchema, operationIdSchema } from "@bookbuddy/api-contract";
import type { SubmitRequest } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import type { NewMediaTransfer } from "../media/types";
import { draftExpiresAfter } from "./cache";
import { pendingHoldAfter, pendingReviewAfter } from "./pending-work";
import { testRepository } from "./sqlite.test-kit";

function photo(name: string, stage = name, bytes: number = mediaLimits.photoBytes): NewMediaTransfer {
  return { attachmentId: attachmentIdSchema.parse(name), stageId: mediaStageIdSchema.parse(stage), caller: "request", parentScopeId: "place-test",
    file: { kind: "photo", mime: "image/jpeg", bytes }, fileUri: `file:///staged/${name}.jpg`, operationId: operationIdSchema.parse(`op-${name}`) };
}

const request: SubmitRequest = {
  operationId: operationIdSchema.parse("request-operation"), expectedRevision: 2,
  payload: { placeId: "place-test" as SubmitRequest["payload"]["placeId"], originalText: "A tap needs repair", arrivalArrangement: "requester" },
};

test("freezes the exact request before sending; only editable drafts and their unsubmitted media expire", async () => {
  const deleted: string[] = [];
  const { repository: repo, mobile, database, clock } = await testRepository(async (uri) => { deleted.push(uri); });
  try {
    await repo.saveDraft("request:submitted", { description: request.payload.originalText!, step: "review", mediaStages: ["submitted"] });
    await repo.saveDraft("request:unsent", { description: "Unsent", mediaStages: ["unsent"] });
    const submitted = photo("pending-file", "submitted");
    const unselected = photo("abandoned", "unsent");
    const uncertain = photo("uncertain", "unsent");
    const other = photo("unrelated");
    for (const item of [submitted, unselected, uncertain, other]) await repo.createMediaTransfer(item, () => {});
    await repo.updateMediaTransfer(uncertain.attachmentId, () => ({ selected: true, started: true, state: "verifying", probe: "parts", generation: 2 }));
    expect(await repo.beginRequestReconciliation("request:submitted", request)).toEqual({ body: request, created: true });
    expect(database.query("SELECT * FROM drafts WHERE key = 'request:submitted'").get()).toBeNull();
    expect((await repo.getDraft("request:submitted"))?.reconciliation?.body).toEqual(request);
    await expect(repo.saveDraft("request:submitted", { description: "Edited after transmission" })).rejects.toThrow("cannot be edited");
    const secondAttempt = { ...request, operationId: operationIdSchema.parse("another-operation"), payload: { ...request.payload, originalText: "Other text" } };
    expect(await repo.beginRequestReconciliation("request:submitted", secondAttempt)).toEqual({ body: request, created: false });

    clock.now += draftExpiresAfter;
    await repo.expireDrafts();
    expect(deleted).toEqual([unselected.fileUri]);
    expect(await repo.getDraft("request:unsent")).toBeNull();
    expect(await repo.listMediaTransfers()).toMatchObject([
      { attachmentId: submitted.attachmentId }, { attachmentId: uncertain.attachmentId, probe: "parts" }, { attachmentId: other.attachmentId },
    ].sort((a, b) => a.attachmentId.localeCompare(b.attachmentId)));
    repo.close();
    const reopened = mobile.openScope(repo.scope);
    expect(await reopened.listPendingDrafts("request")).toEqual([
      { draftId: "submitted", updatedAt: 1_000, summary: request.payload.originalText, reconciling: true },
    ]);
    expect((await reopened.getDraft("request:submitted"))?.reconciliation?.body).toEqual(request);
    await reopened.finishRequestReconciliation("request:submitted", secondAttempt.operationId);
    expect(await reopened.getDraft("request:submitted")).not.toBeNull();
    await reopened.finishRequestReconciliation("request:submitted", request.operationId);
    expect(await reopened.getDraft("request:submitted")).toBeNull();
  } finally { database.close(); }
});

test("upgrades an expired legacy marker without guessing its payload or dropping its receipt", async () => {
  const { repository: repo, database, clock } = await testRepository();
  try {
    const pendingOperation = { id: request.operationId, revision: request.expectedRevision };
    await repo.saveDraft("request:legacy", { step: "review", description: "Legacy request", pendingOperation });
    await repo.claimOnlineReceipt("POST /requests", "legacy", request.operationId);
    clock.now += draftExpiresAfter;
    await repo.expireDrafts();
    expect(database.query("SELECT * FROM drafts").all()).toEqual([]);
    expect(await repo.getDraft("request:legacy")).toMatchObject({ expiresAt: null, reconciliation: {
      operationId: request.operationId, expectedRevision: request.expectedRevision, body: null,
    } });
    await expect(repo.beginRequestReconciliation("request:legacy", request)).rejects.toThrow();
    await repo.finishRequestReconciliation("request:legacy", request.operationId);
    expect(await repo.getDraft("request:legacy")).toBeNull();
    expect(await repo.getOnlineReceipt("POST /requests", "legacy")).toBeNull();
  } finally { database.close(); }
});

test("surfaces outbox and media at day seven and holds queued and checking outbox items at day thirty", async () => {
  const { repository: repo, database, clock } = await testRepository();
  try {
    const arrival = await repo.enqueueOperation({ kind: "attendance", event: "arrival", assignmentId: "shift-test", actualAt: clock.now, capturedAt: clock.now });
    expect((await repo.prepareSyncBatch()).newlyChecking).toEqual([arrival]);
    const departure = await repo.enqueueOperation({ kind: "attendance", event: "departure", assignmentId: "shift-test", actualAt: clock.now, capturedAt: clock.now });
    const image = photo("selected");
    await repo.createMediaTransfer(image, () => {});
    await repo.updateMediaTransfer(image.attachmentId, () => ({ selected: true }));
    const startsAt = clock.now;
    clock.now = startsAt + pendingReviewAfter - 1;
    expect(await repo.listPendingReview()).toEqual({ items: [], nextAt: startsAt + pendingReviewAfter });
    clock.now++;
    expect(await repo.listPendingReview()).toMatchObject({ nextAt: startsAt + pendingHoldAfter, items: [
      { id: arrival, held: false, checking: true }, { id: departure, held: false, checking: false }, { id: image.attachmentId, held: false },
    ] });
    clock.now = startsAt + pendingHoldAfter - 1;
    expect((await repo.prepareSyncBatch()).operations.map(({ operationId }) => operationId)).toEqual([arrival, departure]);
    await repo.recordSyncFailure([departure], false);
    clock.now++;
    expect((await repo.prepareSyncBatch()).operations).toEqual([]);
    expect(await repo.getOutboxRetry(arrival)).toBeNull();
    expect((await repo.listPendingReview()).items.every((item) => item.held)).toBeTrue();
    expect(await repo.decidePendingOperation(arrival, false)).toBe("discarded");
    expect(await repo.decidePendingOperation(departure, true)).toBe("sync");
    expect((await repo.prepareSyncBatch()).operations.map(({ operationId }) => operationId)).toEqual([departure]);
    expect((await repo.listPendingReview()).items).toMatchObject([{ kind: "media", held: true }]);
  } finally { database.close(); }
});

test("reserves account bytes before copying across contexts and frees them only after deletion", async () => {
  const { repository: repo, mobile, database } = await testRepository();
  try {
    const sibling = mobile.openScope({ ...repo.scope, contextId: "another-context" });
    const other = mobile.openScope({ ...repo.scope, accountId: "other-account" });
    const first = photo("asset-0");
    const checkJournal = database.query<{ value: string }, [string]>("SELECT value FROM media_transfers WHERE attachment_id = ?");
    expect(await repo.createMediaTransfer(first, () => {
      expect(JSON.parse(checkJournal.get(first.attachmentId)!.value)).toMatchObject({ staging: true });
    })).toMatchObject({ status: "staged", item: { staging: false } });
    for (let i = 1; i < mediaLimits.pendingBytes / mediaLimits.photoBytes - 1; i++) {
      expect((await (i % 2 ? sibling : repo).createMediaTransfer(photo(`asset-${i}`), () => {})).status).toBe("staged");
    }
    let copies = 0;
    const copy = () => { copies++; };
    const final = await Promise.all([repo.createMediaTransfer(photo("racer-a"), copy), sibling.createMediaTransfer(photo("racer-b"), copy)]);
    expect(final.map(({ status }) => status).sort()).toEqual(["staged", "storageFull"]);
    expect(copies).toBe(1);
    expect((await other.createMediaTransfer(photo("other-account-asset"), copy)).status).toBe("staged");
    await repo.updateMediaTransfer(first.attachmentId, () => ({ selected: true, started: true, state: "verifying", generation: 1, probe: "put" }));
    await repo.removeMediaTransfer(first.attachmentId, async () => { throw new Error("Staged file is busy"); });
    expect((await sibling.createMediaTransfer(photo("still-full"), copy)).status).toBe("storageFull");
    expect(await repo.finishMediaCancellation(first.attachmentId, async () => {})).toBeTrue();
    expect(await repo.listMediaCancellations()).toMatchObject([{ attachmentId: first.attachmentId, generation: 1, probe: "put" }]);
    expect((await sibling.createMediaTransfer(photo("space-freed"), copy)).status).toBe("staged");
    expect(copies).toBe(3);
  } finally { database.close(); }
});

test("startup erases orphaned and interrupted copies without touching other accounts or uncertain files", async () => {
  const { repository: repo, mobile, database } = await testRepository();
  try {
    const other = mobile.openScope({ ...repo.scope, accountId: "other-account" });
    const foreign = photo("foreign");
    const unknown = photo("unknown");
    const partial = photo("partial");
    const discarded = photo("discarded");
    const orphan = "file:///staged/orphan.jpg";
    await other.createMediaTransfer(foreign, () => {});
    for (const item of [unknown, partial, discarded]) await repo.createMediaTransfer(item, () => {});
    await repo.updateMediaTransfer(unknown.attachmentId, () => ({ selected: true, started: true, state: "verifying", generation: 5, probe: "put" }));
    await repo.updateMediaTransfer(discarded.attachmentId, () => ({ selected: true, started: true, state: "verifying", generation: 6, probe: "put" }));
    await repo.saveDraft("request:abandoned", { omittedMedia: [discarded.attachmentId] });
    database.query("UPDATE media_transfers SET value = json_set(value, '$.staging', json('true')) WHERE attachment_id = ?").run(partial.attachmentId);
    const files = new Set([orphan, unknown.fileUri, foreign.fileUri, partial.fileUri, discarded.fileUri]);
    await mobile.reconcileStagedFiles(() => [...files], async (paths) => { for (const uri of paths) files.delete(uri); });
    expect([...files]).toEqual([unknown.fileUri, foreign.fileUri]);
    expect(await repo.listMediaTransfers({}, true)).toMatchObject([{ attachmentId: unknown.attachmentId, probe: "put", generation: 5 }]);
    expect(await repo.listMediaCancellations()).toMatchObject([{ attachmentId: discarded.attachmentId, generation: 6, probe: "put" }]);
    expect(await other.countStagedMedia()).toBe(1);
    expect(await repo.countStagedMedia()).toBe(1);
  } finally { database.close(); }
});
