/// <reference types="bun" />
/// <reference lib="es2024.promise" />
import type { ApiResult } from "@bookbuddy/api-client";
import type { MediaUploadGrant } from "@bookbuddy/api-contract";
import { attachmentIdSchema, mediaStageIdSchema, operationIdSchema } from "@bookbuddy/api-contract";
import type { MediaFile } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { pendingHoldAfter } from "../repository/pending-work";
import type { ScopedRepository } from "../repository/repository";
import { testRepository } from "../repository/sqlite.test-kit";
import { MediaQueue } from "./queue";
import type { TransferFiles } from "./queue";
import { isSentDraft, photoResizeTarget } from "./types";

const stageId = mediaStageIdSchema.parse("media-stage-test");
const photo = { kind: "photo", mime: "image/jpeg", bytes: 1_800 } as const;
const multipartPhoto = { ...photo, bytes: 4 * 1024 * 1024 + 1 } as const;
const signed = "https://storage.example.test/object";
const single = { kind: "single", method: "PUT", url: signed, expiresAt: 4_000,
  headers: { "If-None-Match": "*", "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } } as const;
const unknown = { ok: false, error: { code: "NETWORK_ERROR", delivery: "unknown" } } as const;
const ready = { state: "ready" } as const;

test("photo normalization scales only the long edge and never enlarges a capture", () => {
  expect(photoResizeTarget(3072, 2048)).toEqual({ width: 2048 });
  expect(photoResizeTarget(1080, 2400)).toEqual({ height: 2048 });
  expect(photoResizeTarget(2048, 2048)).toBeUndefined();
  expect(photoResizeTarget(1600, 900)).toBeUndefined();
});

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, meta: { requestId: "media-test", serverTime: 1_000 }, data };
}

async function staged(repo: ScopedRepository, name: string, file: MediaFile = photo, selected = true) {
  const attachmentId = attachmentIdSchema.parse(name);
  await repo.createMediaTransfer({ attachmentId, stageId, caller: "request", parentScopeId: "place",
    operationId: operationIdSchema.parse(`operation-${name}`), file, fileUri: `file:///staged/${name}.jpg` }, () => {});
  if (selected) await repo.updateMediaTransfer(attachmentId, () => ({ selected: true }));
  return attachmentId;
}

test("grants and settles a same-stage batch once, deleting files only after ready commits", async () => {
  const { repository: repo, database } = await testRepository();
  const first = await staged(repo, "photo-one");
  const second = await staged(repo, "photo-two");
  await staged(repo, "not-selected", photo, false);
  const calls: string[] = [];
  const queue = new MediaQueue(repo, {
    async createGrants(body) {
      calls.push("grant");
      expect(body.scope).toEqual({ caller: "request", parentScopeId: "place" });
      expect(body.files.map(({ attachmentId }) => attachmentId)).toEqual([first, second]);
      return ok({ stageId, grants: body.files.map(({ attachmentId }) => ({ attachmentId, uploadGeneration: 1, state: "uploading" as const, grant: single })) });
    },
    async recover() { throw new Error("No recovery for acknowledged uploads"); },
    async settle(body) {
      calls.push("settle");
      expect(body.files).toEqual([first, second].map((attachmentId) => ({ attachmentId, uploadGeneration: 1, kind: "single" })));
      return ok({ stageId, acknowledgements: body.files.map(({ attachmentId, uploadGeneration }) => ({ attachmentId, uploadGeneration, ...ready })) });
    },
  }, {
    size: () => photo.bytes,
    async put(_uri, request) {
      calls.push("put");
      expect(request.headers).toEqual(single.headers);
      return { status: 200 };
    },
    async erase(uri) {
      calls.push("erase");
      const item = (await repo.listMediaTransfers()).find(({ fileUri }) => fileUri === uri);
      expect(item?.state).toBe("ready");
      expect(isSentDraft(item!)).toBe(false);
    },
  }, () => true, () => 1_000);
  await queue.kick();
  await queue.kick();
  expect(calls).toEqual(["grant", "put", "put", "settle", "erase", "erase"]);
  expect((await repo.listMediaTransfers()).filter(isSentDraft).map(({ attachmentId }) => attachmentId)).toEqual([first, second]);
  expect(await repo.countStagedMedia()).toBe(1);
  database.close();
});

test("an unknown PUT survives a new runner and recovers the same stage and generation before sending bytes", async () => {
  const { mobile, repository: repo, database, clock } = await testRepository();
  const id = await staged(repo, "unknown-photo");
  const capturedAt = clock.now;
  clock.now += 750;
  const events: string[] = [];
  const files: TransferFiles = {
    size: () => photo.bytes,
    async put() { events.push("put:unknown"); throw new Error("connection dropped"); },
    async erase() { events.push("erase"); },
  };
  const initial = new MediaQueue(repo, {
    async createGrants() { events.push("grant"); return ok({ stageId, grants: [{ attachmentId: id, state: "uploading", uploadGeneration: 2, grant: single }] }); },
    async settle() { throw new Error("unacknowledged PUT"); },
    async recover() { throw new Error("no self-retry"); },
  }, files, () => true, () => 1_000);
  await initial.kick();
  expect((await repo.listMediaTransfers())[0]).toMatchObject({ state: "verifying", generation: 2, probe: "put", operationId: "operation-unknown-photo" });
  initial.stop();
  repo.close();
  const restored = mobile.openScope(repo.scope);
  const resumed = new MediaQueue(restored, {
    async createGrants() { throw new Error("no duplicate grant"); },
    async settle() { throw new Error("already ready in recover"); },
    async recover(body) {
      events.push("recover");
      expect(body).toEqual({ stageId, files: [{ attachmentId: id, uploadGeneration: 2, unknown: "put" }] });
      return ok({ stageId, files: [{ attachmentId: id, uploadGeneration: 2, ...ready }] });
    },
  }, files, () => true, () => 1_000);
  await resumed.kick();
  expect(events).toEqual(["grant", "put:unknown", "recover", "erase"]);
  expect((await restored.listMediaTransfers())[0]).toMatchObject({ state: "ready", fileUri: null, capturedAt });
  database.close();
});

test("retry after an ambiguous PUT reuses the live grant only if recovery proves the object missing", async () => {
  const { repository: repo, database } = await testRepository();
  const id = await staged(repo, "retry-photo");
  const events: string[] = [];
  const queue = new MediaQueue(repo, {
    async createGrants() { events.push("grant"); return ok({ stageId, grants: [{ attachmentId: id, state: "uploading", uploadGeneration: 1, grant: single }] }); },
    async recover() {
      events.push("recover");
      return ok({ stageId, files: [{ attachmentId: id, state: "uploading", uploadGeneration: 1, transfer: { kind: "single", object: "missing" } }] });
    },
    async settle() { events.push("settle"); return ok({ stageId, acknowledgements: [{ attachmentId: id, uploadGeneration: 1, ...ready }] }); },
  }, {
    size: () => photo.bytes,
    async put() { events.push("put"); return { status: events.includes("recover") ? 200 : 412 }; },
    async erase() {},
  }, () => true, () => 1_000);
  await queue.kick();
  await queue.retry(id);
  expect(events).toEqual(["grant", "put", "recover", "put", "settle"]);
  expect((await repo.listMediaTransfers())[0]?.state).toBe("ready");
  database.close();
});

test("multipart completion keeps a durable receipt and probes once instead of repeating an unknown completion", async () => {
  const { repository: repo, database } = await testRepository();
  const id = await staged(repo, "multipart-photo", multipartPhoto);
  const events: string[] = [];
  const queue = new MediaQueue(repo, {
    async createGrants() {
      events.push("grant");
      return ok({ stageId, grants: [{ attachmentId: id, state: "uploading", uploadGeneration: 1,
        grant: { kind: "multipart", method: "PUT", expiresAt: 4_000, parts: [{ partNumber: 1, url: signed, offset: 0, bytes: multipartPhoto.bytes }] } }] });
    },
    async settle(body) {
      events.push("settle");
      expect(body.files).toEqual([{ attachmentId: id, uploadGeneration: 1, kind: "multipart", parts: [{ partNumber: 1, etag: '"part-etag"' }] }]);
      return unknown;
    },
    async recover(body) {
      events.push("recover");
      expect(body.files).toEqual([{ attachmentId: id, uploadGeneration: 1, unknown: "completion" }]);
      return ok({ stageId, files: [{ attachmentId: id, uploadGeneration: 1, ...ready }] });
    },
  }, {
    size: () => multipartPhoto.bytes,
    async put(_uri, { offset, bytes }) {
      events.push("put-part");
      expect([offset, bytes]).toEqual([0, multipartPhoto.bytes]);
      return { status: 200, etag: '"part-etag"' };
    },
    async erase() {},
  }, () => true, () => 1_000);
  await queue.kick();
  expect((await repo.listMediaTransfers())[0]).toMatchObject({ state: "verifying", probe: "completion", completedParts: [{ partNumber: 1, etag: '"part-etag"' }] });
  await queue.kick();
  expect(events).toEqual(["grant", "put-part", "settle", "recover"]);
  database.close();
});

test("unstarted media can be removed offline and definite failures wait for explicit retry", async () => {
  const { repository: repo, database } = await testRepository();
  const removable = await staged(repo, "remove-me");
  const retryable = await staged(repo, "failed-upload");
  const calls: string[] = [];
  let allowed = false;
  const queue = new MediaQueue(repo, {
    async createGrants(body) {
      calls.push("grant");
      expect(body.files.map(({ attachmentId }) => attachmentId)).toEqual([retryable]);
      return ok({ stageId, grants: [{ attachmentId: retryable, state: "uploading", uploadGeneration: 1, grant: single }] });
    },
    async recover() { throw new Error("HTTP 403 is not an ambiguous PUT"); },
    async settle() { calls.push("settle"); return ok({ stageId, acknowledgements: [{ attachmentId: retryable, uploadGeneration: 1, ...ready }] }); },
  }, {
    size: () => photo.bytes,
    async put() { calls.push("put"); return { status: calls.filter((x) => x === "put").length === 1 ? 403 : 200 }; },
    async erase(uri) { calls.push(uri); },
  }, () => allowed, () => 1_000);
  await queue.kick();
  expect(calls).toEqual([]);
  expect(await queue.remove(removable)).toBe(true);
  allowed = true;
  await queue.kick();
  expect((await repo.listMediaTransfers())[0]).toMatchObject({ state: "failed", probe: null });
  await queue.kick();
  expect(calls).toEqual(["file:///staged/remove-me.jpg", "grant", "put"]);
  await queue.retry(retryable);
  expect(calls).toEqual(["file:///staged/remove-me.jpg", "grant", "put", "grant", "put", "settle", "file:///staged/failed-upload.jpg"]);
  database.close();
});

test("removal while a grant is in flight fences off the first PUT", async () => {
  const { repository: repo, database } = await testRepository();
  const id = await staged(repo, "cancel-before-put");
  const calls: string[] = [];
  const grant = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const queue = new MediaQueue(repo, {
    async createGrants() {
      calls.push("grant");
      entered.resolve();
      await grant.promise;
      return ok({ stageId, grants: [{ attachmentId: id, state: "uploading", uploadGeneration: 1, grant: single }] });
    },
    async recover() { throw new Error("No PUT was issued"); },
    async settle() { throw new Error("No PUT was issued"); },
  }, {
    size: () => photo.bytes,
    async put() { calls.push("put"); return { status: 200 }; },
    async erase() { calls.push("erase"); },
  }, () => true, () => 1_000);
  try {
    const draining = queue.kick();
    await entered.promise;
    expect(await queue.remove(id)).toBeTrue();
    grant.resolve();
    await draining;
    expect(calls).toEqual(["grant", "erase"]);
    expect(await repo.listMediaTransfers()).toEqual([]);
  } finally { grant.resolve(); queue.stop(); database.close(); }
});

test("durable cancellation during a PUT erases bytes before recovery, even if recovery is denied", async () => {
  const { repository: repo, mobile, database } = await testRepository();
  const id = await staged(repo, "cancel-during-put");
  const events: string[] = [];
  const put = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const files: TransferFiles = {
    size: () => photo.bytes,
    async put() { events.push("put"); entered.resolve(); await put.promise; return { status: 200 }; },
    async erase() { events.push("erase"); },
  };
  const queue = new MediaQueue(repo, {
    async createGrants() {
      events.push("grant");
      return ok({ stageId, grants: [{ attachmentId: id, state: "uploading", uploadGeneration: 3, grant: single }] });
    },
    async recover() { throw new Error("The runner is stopped before recovery"); },
    async settle() { throw new Error("Never settle a cancelled PUT"); },
  }, files, () => true, () => 1_000);
  try {
    const draining = queue.kick();
    await entered.promise;
    expect(await queue.remove(id)).toBeTrue();
    expect(await repo.listMediaTransfers()).toEqual([]);
    const receipt = { attachmentId: id, stageId, generation: 3, probe: "put" };
    expect(await repo.listMediaTransfers({}, true)).toEqual([]);
    expect(await repo.listMediaCancellations()).toEqual([receipt]);
    expect(database.query("SELECT * FROM media_transfers").all()).toEqual([]);
    expect(events).toEqual(["grant", "put", "erase"]);
    queue.stop();
    put.resolve();
    await draining;
    repo.close();
    const reopened = mobile.openScope(repo.scope);
    let mayRecover = false;
    const restored = new MediaQueue(reopened, {
      async createGrants() { throw new Error("Never grant a cancelled item"); },
      async settle() { throw new Error("Never settle a cancelled item"); },
      async recover(body) {
        events.push("recover");
        expect(body).toEqual({ stageId, files: [{ attachmentId: id, uploadGeneration: 3, unknown: "put" }] });
        if (!mayRecover) return { ok: false, error: { code: "NOT_FOUND" } };
        return ok({ stageId, files: [{ attachmentId: id, uploadGeneration: 3, state: "uploading",
          transfer: { kind: "single", object: "missing" } }] });
      },
    }, files, () => true, () => 1_000);
    await restored.kick();
    expect(events).toEqual(["grant", "put", "erase", "recover"]);
    expect(await reopened.countStagedMedia()).toBe(0);
    expect(await reopened.listMediaCancellations()).toEqual([receipt]);
    expect(await mobile.openScope({ ...repo.scope, accountId: "different-account" }).listMediaCancellations()).toEqual([]);
    mayRecover = true;
    await restored.kick();
    expect(events).toEqual(["grant", "put", "erase", "recover", "recover"]);
    expect(await reopened.listMediaCancellations()).toEqual([]);
  } finally { put.resolve(); queue.stop(); database.close(); }
});

test("a grant that arrives at day thirty cannot start a PUT before explicit approval", async () => {
  const { repository: repo, clock, database } = await testRepository();
  const id = await staged(repo, "expired-before-put");
  clock.now += pendingHoldAfter - 1;
  const events: string[] = [];
  const queue = new MediaQueue(repo, {
    async createGrants() {
      events.push("grant");
      const grant: MediaUploadGrant = { ...single, expiresAt: clock.now + 5_000 };
      clock.now++;
      return ok({ stageId, grants: [{ attachmentId: id, state: "uploading", uploadGeneration: 1, grant }] });
    },
    async recover() { throw new Error("Not an uncertain PUT"); },
    async settle() {
      events.push("settle");
      return ok({ stageId, acknowledgements: [{ attachmentId: id, uploadGeneration: 1, ...ready }] });
    },
  }, {
    size: () => photo.bytes,
    async put() { events.push("put"); return { status: 200 }; },
    async erase() { events.push("erase"); },
  }, () => true, () => clock.now);
  try {
    await queue.kick();
    await queue.retry(id);
    expect(events).toEqual(["grant"]);
    expect(await queue.sendHeld(id)).toBeTrue();
    expect(events).toEqual(["grant", "put", "settle", "erase"]);
  } finally { queue.stop(); database.close(); }
});

test("account wipe erases held files and does not read or wipe other accounts' media", async () => {
  const { repository: repo, mobile, database } = await testRepository();
  const other = mobile.openScope({ accountId: "another-account", contextId: repo.scope.contextId });
  await staged(repo, "held", photo, false);
  await staged(other, "unrelated", photo, false);
  expect((await repo.listMediaTransfers()).map(({ attachmentId }) => attachmentId)).toEqual(["held"]);
  let erased: readonly string[] = [];
  await mobile.wipeAccount(repo.scope.accountId, async (uris) => { erased = uris; });
  expect(erased).toEqual(["file:///staged/held.jpg"]);
  expect(await repo.listMediaTransfers()).toEqual([]);
  expect(await other.countStagedMedia()).toBe(1);
  database.close();
});
