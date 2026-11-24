import { getHomeRoute, getJobRoute, notificationsRoute } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { draftExpiresAfter, draftWarnAfter, snapshotWindow } from "./cache";
import { cacheRemoteResponse, remoteReadKey } from "./remote-cache";
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
    await repository.saveDraft("request:authored", { text: "Keep me" });
    const operationId = await repository.enqueueOperation(operation());
    await repository.applySyncPage(page("after", { mode: "reset",
      removals: [{ kind: "scope", resourceId: context.contextId }], upserts: [notification("replace", 975)],
    }), 995);
    expect(await repository.listProjections("notification")).toMatchObject({ data: [{ id: "replace", readAt: 975 }] });
    expect(await repository.getDraft("request:authored")).not.toBeNull();
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
    await repository.saveDraft("request:expiring", true);
    expect(await repository.getDraft("request:expiring")).toMatchObject({ warnAt: clock.now + draftWarnAfter, expiresAt: clock.now + draftExpiresAfter });
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

test("stores only allowlisted GET fields and rejects a detail route as a cache source", async () => {
  const { database, repository } = await testRepository();
  try {
    const input = { query: { placeId: "place1", address: "drop-address" } };
    expect(remoteReadKey("home", getJobRoute, input)).toBeNull();
    const key = remoteReadKey("home", getHomeRoute, input)!;
    expect(key).not.toContain("drop-address");
    await repository.saveCachedRead("home", key, { audience: "customer", unreadCount: 1,
      place: { placeId: "place1", alias: "drop-address", siteZone: "Europe/Lisbon" },
      upcoming: [], liveVisits: [], recent: [], decisions: [],
      paymentInstructions: "drop-iban", receivedMedia: [{ url: "drop-media" }],
    }, 990, repository.visibilityGeneration);
    expect(await repository.getCachedRead("home", key)).toMatchObject({
      confirmedAt: 990, data: { audience: "customer", place: { placeId: "place1", siteZone: "Europe/Lisbon" } },
    });
    const saved = database.query<{ value: string }, []>("SELECT value FROM projection").get()!.value;
    expect(saved).not.toContain("drop-");
    expect(saved).not.toContain("alias");
  } finally { database.close(); }
});

test("keeps offline cover identifiers without storing offer addresses or giving ordinary offers a gap", () => {
  const siteZone = "Europe/Lisbon";
  const window = { startsAt: 1_500, endsAt: 2_000 };
  const detail = { task: "not-cached", address: "not-cached", replyBy: 1_200 };
  const homeOffer = { ...detail, town: "Lisbon", skill: "plumbing", briefingLanguage: "pt-PT",
    siteZone, window, awaitingConfirmationUntil: null };
  const home = cacheRemoteResponse("home", {
    audience: "worker", unreadCount: 0, businessName: "Provider", siteZone, assignment: null, openToCoverUntil: null,
    offers: [
      { ...homeOffer, kind: "ordinary", offerId: "offer-1", gapId: "ignore" },
      { ...homeOffer, kind: "cover", offerId: "offer-2", gapId: "gap-1" },
    ],
  });
  const safeHomeOffer = { town: "Lisbon", skill: "plumbing", briefingLanguage: "pt-PT", siteZone, window,
    replyBy: 1_200, awaitingConfirmationUntil: null };
  expect(home).toMatchObject({ audience: "worker" });
  expect(home && "offers" in home ? home.offers : null).toEqual([
    { ...safeHomeOffer, kind: "ordinary", offerId: "offer-1" },
    { ...safeHomeOffer, kind: "cover", offerId: "offer-2", gapId: "gap-1" },
  ]);

  const agendaRow = { kind: "offer", state: "offered", ...window, siteZone, areaName: "Lisbon", ...detail };
  const agenda = cacheRemoteResponse("shift_agenda", { segment: "offers", cursor: null, hasMore: false, rows: [
    { ...agendaRow, id: "offer-1", source: "ordinary", gapId: "ignore" },
    { ...agendaRow, id: "offer-2", source: "cover", gapId: "gap-1" },
  ] });
  const safeAgendaRow = { kind: "offer", state: "offered", ...window, siteZone, areaName: "Lisbon", replyBy: 1_200 };
  expect(agenda).toEqual({ segment: "offers", cursor: null, hasMore: false, rows: [
    { ...safeAgendaRow, id: "offer-1", source: "ordinary" },
    { ...safeAgendaRow, id: "offer-2", source: "cover", gapId: "gap-1" },
  ] });
});

test("cached GET expiry and scope barriers cannot be bypassed by late old replies", async () => {
  const { database, repository, mobile, clock } = await testRepository();
  try {
    const key = remoteReadKey("notification", notificationsRoute, { query: { contextId: context.contextId } })!;
    const value = { items: [{ id: "note", kind: "offer", createdAt: 980, readAt: null, linkToken: null }],
      page: { cursor: null, hasMore: false } };
    const initial = repository.visibilityGeneration;
    await repository.saveCachedRead("notification", key, value, 990, initial);
    expect(await mobile.openScope({ accountId, contextId: "different" }).getCachedRead("notification", key)).toBeNull();
    expect(await repository.getCachedRead("notification", key)).toMatchObject({ confirmedAt: 990,
      data: { items: [{ id: "note", kind: "offer", createdAt: 980, readAt: null }] } });
    clock.now += snapshotWindow;
    await repository.applySyncPage(page("fresh-sync"), clock.now);
    expect(await repository.getCachedRead("notification", key)).toBeNull();
    await repository.applySyncPage(page("reset", { mode: "reset", removals: [{ kind: "scope", resourceId: context.contextId }],
      upserts: [notification("safe", null)] }), clock.now);
    await repository.saveCachedRead("notification", key, value, clock.now, initial);
    expect(database.query("SELECT * FROM projection WHERE kind = 'read:notification'").all()).toHaveLength(0);
    await repository.saveCachedRead("notification", key, value, clock.now, repository.visibilityGeneration);
    expect(await repository.getCachedRead("notification", key)).not.toBeNull();
    await repository.recordSyncFailure([], true);
    expect(await repository.getCachedRead("notification", key)).toBeNull();
  } finally { database.close(); }
});

test("migrates only the active context's legacy draft once, preserving age and newest-first summaries", async () => {
  const { database, repository, mobile, clock } = await testRepository();
  try {
    const sameAccount = mobile.openScope({ accountId, contextId: "other-role" });
    const insert = database.query("INSERT INTO drafts(account_id, context_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)");
    const legacyValue = { step: "place", description: "  Fix the tap  " };
    insert.run(accountId, context.contextId, "request:new", JSON.stringify(legacyValue), 900);
    insert.run(accountId, "other-role", "request:new", "true", 950);
    insert.run(accountId, context.contextId, "request:expired", "true", clock.now - draftExpiresAfter);
    await repository.saveDraft("request:second", { description: "Second request" });
    await repository.saveDraft("request_revision:edit", true);
    expect(await repository.countPendingDrafts()).toBe(3);
    expect(await repository.countPendingDrafts(true)).toBe(4);
    const [first, concurrent] = await Promise.all([repository.listPendingDrafts("request"), repository.listPendingDrafts("request")]);
    expect(concurrent).toEqual(first);
    expect(first).toEqual([
      { draftId: "second", updatedAt: 1000, summary: "Second request" },
      { draftId: "op-1", updatedAt: 900, summary: "Fix the tap" },
    ]);
    expect(await repository.getDraft("request:new")).toBeNull();
    expect(await repository.getDraft("request:op-1")).toEqual({
      value: legacyValue, updatedAt: 900, warnAt: 900 + draftWarnAfter, expiresAt: 900 + draftExpiresAfter,
    });
    expect(await sameAccount.getDraft("request:op-1")).toBeNull();
    expect(await sameAccount.listPendingDrafts("request")).toEqual([{ draftId: "op-2", updatedAt: 950 }]);
    await expect(repository.saveDraft("request:new", true)).rejects.toThrow("stable");
    clock.now = 900 + draftExpiresAfter;
    expect(await repository.listPendingDrafts("request")).toEqual([{ draftId: "second", updatedAt: 1000, summary: "Second request" }]);
  } finally { database.close(); }
});

test("bootstrap restores identity and role labels without retaining a credential and wipes with its account", async () => {
  const { database, mobile } = await testRepository();
  try {
    const bootstrap = {
      sessionId: "session", expiresAt: 100_000, setup: "complete", account: { id: accountId, email: "test@example.test", displayName: "Test Profile" },
      preferences: { uiLocale: "pt-PT", readingLocale: null, revision: 2, theme: "system", fieldMode: null, twoClock: false },
      activeContext: { contextId: "staff", role: "foreman", businessId: "business", businessName: "Test Provider" },
      contexts: [{ contextId: "staff", role: "foreman", businessId: "business", businessName: "Test Provider" }],
      capabilities: { sessions: { businessId: "business" } },
      credential: "discard-me",
    } as const;
    await mobile.saveSessionBootstrap(bootstrap);
    const restored = await mobile.getSessionBootstrap(accountId);
    expect(restored?.account.displayName).toBe("Test Profile");
    expect(restored?.activeContext?.businessName).toBe("Test Provider");
    expect(restored?.capabilities).toEqual({ sessions: { businessId: "business" } });
    expect(restored?.preferences.uiLocale).toBe("pt-PT");
    expect(await mobile.getSessionBootstrap("another-account")).toBeNull();
    expect(database.query<{ value: string }, []>("SELECT value FROM local_settings").get()!.value).not.toContain("discard-me");
    await mobile.wipeAccount(accountId, async () => { throw new Error("No staged files to remove"); });
    expect(await mobile.getSessionBootstrap(accountId)).toBeNull();
  } finally { database.close(); }
});
