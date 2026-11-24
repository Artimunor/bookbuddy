import { expect, test } from "bun:test";
import { draftExpiresAfter, draftWarnAfter, snapshotWindow } from "./cache";
import { accountId, context, notification, page, testRepository } from "./sqlite.test-kit";

const read = { kind: "notification_read_mark", payload: { ids: ["notice"] } } as const;

function operation() { return { kind: read.kind, payload: { ids: [...read.payload.ids] } }; }

test("rolls back removals, upserts and acknowledgements if the cursor cannot be written", async () => {
  const { database, repository } = await testRepository();
  try {
    await repository.applySyncPage(page("before", { upserts: [notification("old", null)] }), 935);
    const operationId = await repository.enqueueOperation(operation());
    database.exec("CREATE TRIGGER reject_cursor BEFORE UPDATE ON sync_state BEGIN SELECT RAISE(ABORT, 'corrupt cursor'); END");
    await expect(repository.applySyncPage(page("after", {
      removals: [{ kind: "notification", resourceId: "old" }], upserts: [notification("new", 990)],
      outcomes: [{ operationId, status: "committed", resultRef: "receipt" }],
    }), 995)).rejects.toThrow("corrupt cursor");
    expect((await repository.getProjection("notification", "old"))?.data.id).toBe("old");
    expect(await repository.getProjection("notification", "new")).toBeNull();
    expect((await repository.getLastConfirmed())?.confirmedAt).toBe(935);
    expect(await repository.prepareSyncBatch()).toMatchObject({ cursor: "before", operations: [{ operationId }] });
  } finally { database.close(); }
});

test("applies individual removals and whole-scope barriers before same-page upserts", async () => {
  const { database, repository } = await testRepository();
  try {
    await repository.applySyncPage(page("before", { upserts: [notification("replace", null), notification("remove", null)] }), 935);
    await repository.applySyncPage(page("next", {
      removals: [{ kind: "notification", resourceId: "replace" }], upserts: [notification("replace", 950)],
    }), 955);
    expect((await repository.getProjection("notification", "replace"))?.data.readAt).toBe(950);
    await repository.saveDraft("authored", { text: "Keep me" });
    const operationId = await repository.enqueueOperation(operation());
    await repository.applySyncPage(page("after", { mode: "reset",
      removals: [{ kind: "scope", resourceId: context.contextId }], upserts: [notification("replace", 975)],
    }), 995);
    expect(await repository.listProjections("notification")).toMatchObject({ data: [{ id: "replace", readAt: 975 }] });
    expect(await repository.getDraft("authored")).not.toBeNull();
    expect(await repository.listOutbox()).toMatchObject([{ operation: { operationId } }]);
  } finally { database.close(); }
});

test("acknowledgements are idempotent and conflicts do not enter the next send", async () => {
  const { database, repository } = await testRepository();
  try {
    const accepted = await repository.enqueueOperation(operation());
    const unresolved = await repository.enqueueOperation(operation());
    const conflict = await repository.enqueueOperation(operation());
    const ack = { operationId: accepted, status: "replayed", resultRef: "receipt" } as const;
    await repository.applySyncPage(page("cursor-1", { outcomes: [ack, ack, {
      operationId: conflict, status: "rejected", error: { code: "STALE_REVISION", current: { kind: "revision", revision: 2 } },
    }] }), 900);
    await repository.applySyncPage(page("cursor-2", { outcomes: [ack] }), 910);
    expect(await repository.listOutbox()).toMatchObject([
      { operation: { operationId: unresolved }, status: "queued" },
      { operation: { operationId: conflict }, status: "conflict", error: { code: "STALE_REVISION" } },
    ]);
    expect(await repository.prepareSyncBatch()).toMatchObject({ cursor: "cursor-2", operations: [{ operationId: unresolved }] });
  } finally { database.close(); }
});

test("stores only the allowlisted fields, with independent account and context partitions", async () => {
  const { database, repository, mobile, clock } = await testRepository();
  try {
    const other = mobile.openScope({ accountId, contextId: "other-context" });
    const separatelySignedIn = mobile.openScope({ accountId: "other-account", contextId: context.contextId });
    await repository.applySyncPage(page("before", { upserts: [notification("notice", null), {
      kind: "bill", resourceId: "payment", value: { payTo: "do-not-cache" },
    }] }), 935);
    await separatelySignedIn.applySyncPage(page("different", { upserts: [notification("notice", 980)] }), 995);
    const rows = database.query<{ value: string }, []>("SELECT value FROM projection ORDER BY account_id").all();
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[0]!.value)).toEqual({ id: "notice", kind: "offer", createdAt: 789, readAt: null });
    expect(await other.getProjection("notification", "notice")).toBeNull();
    await mobile.saveLocalePreferences(accountId, { uiLocale: "pt-PT", readingLocale: null });
    expect(await mobile.getLocalePreferences("other-account")).toBeNull();
    await repository.saveDraft("expiring", true);
    expect(await repository.getDraft("expiring")).toMatchObject({ warnAt: clock.now + draftWarnAfter, expiresAt: clock.now + draftExpiresAfter });
    clock.now += snapshotWindow;
    expect(await repository.getProjection("notification", "notice")).toBeNull();
    clock.now += draftExpiresAfter - snapshotWindow;
    await repository.expireDrafts();
    expect(database.query("SELECT * FROM drafts").all()).toHaveLength(0);
    repository.close();
    await mobile.wipeAccount(accountId, async () => { throw new Error("No staged files to remove"); });
    expect(await mobile.getLocalePreferences(accountId)).toBeNull();
    expect(database.query("SELECT * FROM projection").all()).toHaveLength(1);
  } finally { database.close(); }
});

test("a known scope denial hides cached values even if the purge rolls back", async () => {
  const { database, repository } = await testRepository();
  try {
    await repository.applySyncPage(page("before", { upserts: [notification("notice", null)] }), 955);
    database.exec("CREATE TRIGGER reject_purge BEFORE DELETE ON projection BEGIN SELECT RAISE(ABORT, 'failed purge'); END");
    await expect(repository.recordSyncFailure([], true)).rejects.toThrow("failed purge");
    expect(await repository.getProjection("notification", "notice")).toBeNull();
    expect(await repository.getLastConfirmed()).toBeNull();
  } finally { database.close(); }
});
