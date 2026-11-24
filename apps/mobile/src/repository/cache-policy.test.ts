import { sessionBootstrapSchema } from "@bookbuddy/api-contract";
import type { SyncPage } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { offlineWindow, projectOfflineBootstrap } from "../session/offline-bootstrap";
import { cachePolicy } from "./cache-policy";
import { createMemoryExecutor } from "./memory";
import { MobileRepository } from "./repository";
import { localSettings, projection, requestReconciliations, syncState } from "./schema";

const accountId = "account";
const bootstrap = sessionBootstrapSchema.parse({
  sessionId: "session", expiresAt: 2_000, setup: "complete", account: { id: accountId, email: "private@example.test", displayName: "Casey" },
  preferences: { uiLocale: "pt-PT", readingLocale: "de", displayZone: "Europe/Lisbon", revision: 6, theme: "dark", fieldMode: null, twoClock: true },
  activeContext: { contextId: "staff", role: "worker", businessId: "private-business", businessName: "Test Provider", membershipId: "private-membership" },
  contexts: [{ contextId: "customer", role: "customer", businessId: null }], capabilities: { sessions: { businessId: "private-business" } },
  revocationProof: `r1.${"Q".repeat(42)}A`,
});
const customer = { ...bootstrap, activeContext: bootstrap.contexts[0]! };
const erase = async () => {};

function page(context: SyncPage["context"], updates: Partial<SyncPage> = {}): SyncPage {
  return { mode: "snapshot", context, upserts: [{ kind: "notification", resourceId: "notice", value: {
    id: "notice", kind: "offer", createdAt: 950, readAt: null,
  } }], outcomes: [], removals: [], cursor: "cursor", hasMore: false, snapshotComplete: true, ...updates };
}

test("offline bootstrap persists only allowlisted fields and expires independently of the bearer", async () => {
  const disk = createMemoryExecutor();
  let now = 1_000;
  const mobile = new MobileRepository(disk, () => "id", () => now, erase, true);
  const projected = projectOfflineBootstrap(bootstrap, now)!;
  expect(projected).toEqual({ sessionId: "session", authorizedAt: 1_000, account: { displayName: "Casey" },
    activeContext: { contextId: "staff", role: "worker", businessName: "Test Provider" },
    preferences: { uiLocale: "pt-PT", readingLocale: "de", displayZone: "Europe/Lisbon", theme: "dark", fieldMode: null, twoClock: true } });
  await mobile.saveOfflineBootstrap(accountId, projected);
  const [row] = await disk.read((db) => db.select(localSettings, { account_id: accountId }));
  expect(JSON.parse(row!.value)).toEqual(projected);
  expect(await mobile.getOfflineBootstrap("another-account", "session", "staff")).toBeNull();
  expect(await mobile.getOfflineBootstrap(accountId, "different-session", "staff")).toBeNull();
  expect(await mobile.getOfflineBootstrap(accountId, "session", "customer")).toBeNull();
  now = 999;
  expect(await mobile.getOfflineBootstrap(accountId, "session", "staff")).toBeNull();
  now = 1_000 + offlineWindow - 1;
  expect(await mobile.getOfflineBootstrap(accountId, "session", "staff")).toEqual(projected);
  now++;
  expect(await mobile.getOfflineBootstrap(accountId, "session", "staff")).toBeNull();
});

test("customer job projections stay volatile; eligible staff projections and authored work persist", async () => {
  const disk = createMemoryExecutor();
  const mobile = new MobileRepository(disk, () => "operation", () => 1_000, erase, true);
  const staffRepo = mobile.openScope({ accountId, contextId: "staff" }, "worker");
  const customerRepo = mobile.openScope({ accountId, contextId: "customer" }, "customer");
  await staffRepo.applySyncPage(page(bootstrap.activeContext!), 1_000);
  await customerRepo.applySyncPage(page(customer.activeContext), 1_000);
  await customerRepo.saveDraft("request:pending", true);
  await mobile.saveOfflineBootstrap(accountId, projectOfflineBootstrap(customer, 1_000)!);
  expect(await customerRepo.getProjection("notification", "notice")).not.toBeNull();
  expect((await disk.read((db) => db.select(projection, {}))).map((row) => row.context_id)).toEqual(["staff"]);
  expect((await disk.read((db) => db.select(syncState, {}))).map((row) => row.context_id)).toEqual(["staff"]);
  expect(await disk.read((db) => db.count(localSettings, {}))).toBe(0);
  const reopened = new MobileRepository(disk, () => "operation", () => 1_000, erase, true);
  expect(await reopened.openScope(staffRepo.scope, "worker").getProjection("notification", "notice")).not.toBeNull();
  const reopenedCustomer = reopened.openScope(customerRepo.scope, "customer");
  expect(await reopenedCustomer.getProjection("notification", "notice")).toBeNull();
  expect(await reopenedCustomer.getDraft("request:pending")).not.toBeNull();
  for (const role of ["worker", "foreman", "provider_admin"] as const) {
    expect(cachePolicy(role, true)).toBe("persistent");
    expect(cachePolicy(role, false)).toBe("memory");
  }
  expect(cachePolicy("customer", true)).toBe("memory");
  expect(cachePolicy(undefined, true)).toBe("memory");
});

test("sign-out counts uncertain receipts once and keeps or discards only the originating account's work", async () => {
  const disk = createMemoryExecutor();
  const mobile = new MobileRepository(disk, () => "outbox-id", () => 1_000, erase, true);
  const repo = mobile.openScope({ accountId, contextId: "staff" }, "worker");
  const other = mobile.openScope({ accountId: "other", contextId: "staff" }, "worker");
  await other.saveDraft("request:other", true);
  await repo.applySyncPage(page(bootstrap.activeContext!), 1_000);
  await repo.saveDraft("request:draft", true);
  await repo.enqueueOperation({ kind: "notification_read_mark", payload: { ids: ["notice"] } });
  await repo.claimOnlineReceipt("POST /requests", "resource", "checking-id");
  await disk.transaction((db) => db.put(requestReconciliations, { account_id: accountId, context_id: "staff",
    updated_at: 1_000, key: "request:submitted", operation_id: "checking-id", expected_revision: 0, body: null, value: "true" }));
  await repo.saveStagedMedia({ attachmentId: "photo", fileUri: "file:///photo.jpg", caller: "request", mime: "image/jpeg", bytes: 100 });
  const pending = { drafts: 1, waiting: 1, checking: 1, media: 1 };
  expect(await mobile.pendingWork(accountId)).toEqual(pending);
  repo.close();
  await mobile.sealAccount(accountId);
  expect(await repo.getDraft("request:draft")).toBeNull();
  expect(await mobile.pendingWork(accountId)).toEqual(pending);
  expect(await other.getDraft("request:draft")).toBeNull();
  const restored = mobile.openScope(repo.scope, "worker");
  expect(await restored.getProjection("notification", "notice")).toBeNull();
  expect(await restored.getDraft("request:draft")).not.toBeNull();
  restored.close();
  let files: readonly string[] = [];
  await mobile.wipeAccount(accountId, async (uris) => { files = uris; });
  expect(files).toEqual(["file:///photo.jpg"]);
  expect(await mobile.pendingWork(accountId)).toEqual({ drafts: 0, waiting: 0, checking: 0, media: 0 });
  expect(await other.getDraft("request:other")).not.toBeNull();
});

test("only definitive sync removal, completed absence or denial is journaled for a card", async () => {
  const mobile = new MobileRepository(createMemoryExecutor(), () => "id", () => 1_000, erase);
  const stops: string[] = [];
  let target = "shift";
  const repo = mobile.openScope({ accountId, contextId: "staff" }, "worker", async (removed) => {
    if (await removed("worker_field_shift", target)) stops.push(target);
  });
  await repo.applySyncPage(page(bootstrap.activeContext!, { mode: "reset", hasMore: true, snapshotComplete: false,
    removals: [{ kind: "scope", resourceId: "staff" }] }), 1_000);
  expect(stops).toEqual([]);
  await repo.applySyncPage(page(bootstrap.activeContext!, { mode: "delta", snapshotComplete: false, upserts: [],
    removals: [{ kind: "worker_field_shift", resourceId: "unrelated" }] }), 1_000);
  expect(stops).toEqual([]);
  await repo.applySyncPage(page(bootstrap.activeContext!, { mode: "delta", snapshotComplete: false, upserts: [],
    removals: [{ kind: "worker_field_shift", resourceId: "shift" }] }), 1_000);
  expect(stops).toEqual(["shift"]);
  target = "absent";
  await repo.applySyncPage(page(bootstrap.activeContext!, { mode: "reset", upserts: [] }), 1_000);
  expect(stops).toEqual(["shift", "absent"]);
  target = "another";
  await repo.recordSyncFailure([], true);
  expect(stops).toEqual(["shift", "absent", "another"]);
});

test("a paged reset journals an absent card on the final snapshot page before delta catch-up", async () => {
  const mobile = new MobileRepository(createMemoryExecutor(), () => "id", () => 1_000, erase);
  const stops: string[] = [];
  const context = bootstrap.activeContext!;
  const repo = mobile.openScope({ accountId, contextId: context.contextId }, "worker", async (removed) => {
    if (await removed("worker_field_shift", "revoked-shift")) stops.push("revoked-shift");
  });
  await repo.applySyncPage(page(context, {
    mode: "reset", cursor: "snapshot-1", snapshotComplete: false, hasMore: true,
    removals: [{ kind: "scope", resourceId: context.contextId }],
  }), 1_000);
  expect(stops).toEqual([]);
  await repo.applySyncPage(page(context, {
    cursor: "snapshot-end", snapshotComplete: true, hasMore: true, upserts: [],
  }), 1_001);
  expect(stops).toEqual(["revoked-shift"]);
  await repo.applySyncPage(page(context, {
    mode: "delta", cursor: "delta-end", snapshotComplete: false, upserts: [],
  }), 1_002);
  expect(stops).toEqual(["revoked-shift"]);
  expect((await repo.prepareSyncBatch()).cursor).toBe("delta-end");
});

test("a sync cursor cannot advance past a removal that has not been journaled", async () => {
  const mobile = new MobileRepository(createMemoryExecutor(), () => "id", () => 1_000, erase);
  const repo = mobile.openScope({ accountId, contextId: "staff" }, "worker", async (removed) => {
    if (await removed("worker_field_shift", "shift")) throw new Error("Stop marker not saved");
  });
  await repo.applySyncPage(page(bootstrap.activeContext!, { mode: "delta", snapshotComplete: false, cursor: "before" }), 1_000);
  await expect(repo.applySyncPage(page(bootstrap.activeContext!, { mode: "delta", snapshotComplete: false, cursor: "after",
    removals: [{ kind: "worker_field_shift", resourceId: "shift" }] }), 1_000)).rejects.toThrow("Stop marker not saved");
  expect((await repo.prepareSyncBatch()).cursor).toBe("before");
});
