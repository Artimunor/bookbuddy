import { expect, test } from "bun:test";
import { accountIdSchema, contextIdSchema, operationIdHeader, operationIdSchema, resultSchema, syncRoute } from "@bookbuddy/api-contract";
import type { SyncOp } from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { commitCommand, prepareCommand } from "../src/db/commit";
import { planOperation } from "../src/db/operations";
import { hashSessionCredential, resolveSession } from "../src/modules/auth/session";
import { createCursorCodec } from "../src/modules/sync/cursor";
import { createTestD1 } from "./d1";

const secret = "insecure-test-only-cursor-key-with-enough-bytes";
const credential = "A".repeat(43); // canonical base64url for 32 zero bytes

async function fixture(staff = false) {
  const db = await createTestD1();
  const app = createApp();
  const hints: string[] = [];
  const env = { DB: db, SYNC_CURSOR_HMAC_KEY: secret, LIVE: { getByName: (name: string) => ({
    publishInvalidation: async () => { hints.push(name); },
  }) } } as unknown as Bindings;
  const execution = { props: {}, waitUntil() {}, passThroughOnException() {} };
  const contextId = staff ? "staff-context" : "customer-context";
  const hash = await hashSessionCredential(credential);
  await db.batch([
    db.prepare("INSERT INTO accounts (id, email_normalized, verified_at, state) VALUES ('actor', 'actor@example.invalid', 1, 'active')"),
    db.prepare("INSERT INTO account_contexts (id, account_id, role) VALUES ('customer-context', 'actor', 'customer')"),
    ...(staff ? [
      db.prepare(`INSERT INTO operating_areas (id, name, site_zone, polygon) VALUES ('area', 'Area', 'Europe/Lisbon', '[0]')`),
      db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
        VALUES ('business', 'Business', 'Business', 'test', 'area', 'approved')`),
      db.prepare("INSERT INTO memberships (id, business_id, account_id, state) VALUES ('member', 'business', 'actor', 'active')"),
      db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at)
        VALUES ('grant', 'member', 'business', 'actor', 'worker', 1)`),
      db.prepare(`INSERT INTO account_contexts (id, account_id, role, business_id, role_grant_id)
        VALUES (?, 'actor', 'worker', 'business', 'grant')`).bind(contextId),
    ] : []),
    db.prepare(`INSERT INTO sessions (id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
      VALUES ('session', 'actor', ?, ?, 'device', 1, ?)`).bind(hash, contextId, Date.now() + 60_000),
    db.prepare(`INSERT INTO notifications (id, context_id, event_key, kind, created_at)
      VALUES ('notice-a', ?, 'event-a', 'test_update', 1), ('notice-b', ?, 'event-b', 'test_update', 2)`).bind(contextId, contextId),
  ]);
  let apiCalls = 0;
  async function request(path: string, method: string, body?: unknown, opId?: string) {
    apiCalls++;
    return app.request(`https://bookbuddy.test/api/v1${path}`, {
      method, headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json", ...(opId ? { [operationIdHeader]: opId } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env, execution);
  }
  async function sync(cursor: string | null, operations: readonly unknown[] = []) {
    const response = await request("/sync", "POST", { contextId, cursor, operations });
    const envelope = resultSchema(syncRoute.output).parse(await response.json());
    if (!envelope.ok) throw new Error(`Sync failed: ${response.status} ${envelope.error.code}`);
    return envelope.data;
  }
  return { db, contextId, hints, request, sync, get apiCalls() { return apiCalls; } };
}

const readMark = (id: string) => ({ kind: "notification_read_mark", operationId: "mark-once", payload: { ids: [id] } }) satisfies {
  kind: SyncOp["kind"]; operationId: string; payload: object;
};

test("empty outbox reads current delta projections in one API request and one D1 batch", async () => {
  const f = await fixture();
  try {
    const first = await f.sync(null);
    expect(first.mode).toBe("snapshot");
    await f.db.batch([
      f.db.prepare("UPDATE notifications SET read_at = 3 WHERE id = 'notice-a'"),
      f.db.prepare(`INSERT INTO sync_changes (kind, resource_id, partition_key, op, at)
        VALUES ('notification', 'notice-a', ?, 'upsert', 2), ('notification', 'notice-a', ?, 'upsert', 3)`).bind(f.contextId, f.contextId),
    ]);
    const before = { ...f.db.calls, api: f.apiCalls };
    const page = await f.sync(first.cursor);
    expect(page.mode).toBe("delta");
    expect(page.upserts).toHaveLength(1);
    expect(page.upserts[0]).toMatchObject({ resourceId: "notice-a", value: { readAt: 3 } });
    expect(page.outcomes).toEqual([]);
    expect(f.apiCalls - before.api).toBe(1);
    expect(f.db.calls.batch - before.batch).toBe(1);
    expect(f.db.calls.query - before.query).toBe(0);
    expect(f.db.calls.prepare - before.prepare).toBe(1);
  } finally { f.db.close(); }
});

test("same operation replays within/across batches and changed input conflicts without any new write", async () => {
  const f = await fixture();
  try {
    const initial = await f.sync(null);
    const command = readMark("notice-a");
    const committed = await f.sync(initial.cursor, [command, command]);
    expect(committed.outcomes.map((result) => result.status)).toEqual(["committed", "replayed"]);
    expect(f.hints).toHaveLength(1);
    const replayed = await f.sync(committed.cursor, [command, readMark("notice-b")]);
    expect(replayed.outcomes).toMatchObject([
      { status: "replayed", resultRef: command.operationId },
      { status: "rejected", error: { code: "OPERATION_ID_REUSED" } },
    ]);
    expect(replayed.upserts).toEqual([]);
    expect(f.hints).toHaveLength(1);
    const counts = await f.db.prepare(`SELECT (SELECT count(*) FROM sync_changes) AS changes,
      (SELECT count(*) FROM operation_receipts) AS receipts,
      (SELECT read_at FROM notifications WHERE id = 'notice-b') AS other_read_at`).first();
    expect(counts).toEqual({ changes: 1, receipts: 1, other_read_at: null });
  } finally { f.db.close(); }
});

test("expired cursor starts a scoped snapshot with a first-page discard barrier", async () => {
  const f = await fixture();
  try {
    const codec = await createCursorCodec(secret);
    const cursor = await codec.issue({ accountId: accountIdSchema.parse("actor"), epoch: 0,
      context: { contextId: contextIdSchema.parse(f.contextId), role: "customer", businessId: null } },
    { phase: "delta", seq: 0 }, Date.now() - 8 * 86_400_000);
    const page = await f.sync(cursor);
    expect(page.mode).toBe("snapshot");
    expect(page.removals).toEqual([{ kind: "scope", resourceId: f.contextId }]);
    expect(page.upserts.map((upsert) => upsert.resourceId)).toEqual(["notice-a", "notice-b"]);
  } finally { f.db.close(); }
});

test("tombstones, epoch reset, and live revocation drop old scope data before rendering", async () => {
  const f = await fixture(true);
  try {
    const initial = await f.sync(null);
    await f.db.batch([
      f.db.prepare("DELETE FROM notifications WHERE id = 'notice-a'"),
      f.db.prepare(`INSERT INTO sync_changes (kind, resource_id, partition_key, op, at)
        VALUES ('notification', 'notice-a', ?, 'remove', 3)`).bind(f.contextId),
    ]);
    const tombstone = await f.sync(initial.cursor);
    expect(tombstone.removals).toEqual([{ kind: "notification", resourceId: "notice-a" }]);
    await f.db.prepare("INSERT INTO sync_scope_state (context_id, visibility_epoch) VALUES (?, 1)").bind(f.contextId).run();
    const reset = await f.sync(tombstone.cursor);
    expect(reset.mode).toBe("reset");
    expect(reset.removals).toEqual([{ kind: "scope", resourceId: f.contextId }]);
    expect(reset.upserts.map(({ kind, resourceId }) => ({ kind, resourceId }))).toEqual([
      { kind: "crew_availability", resourceId: "member" },
      { kind: "notification", resourceId: "notice-b" },
      { kind: "shift_agenda", resourceId: "member" },
    ]);
    await f.db.prepare("UPDATE membership_roles SET revoked_at = 2, revoked_by = 'actor' WHERE id = 'grant'").run();
    const revoked = await f.sync(reset.cursor, [readMark("notice-b")]);
    expect(revoked).toMatchObject({ mode: "reset", upserts: [], removals: [{ kind: "scope", resourceId: f.contextId }], hasMore: false,
      outcomes: [{ status: "rejected", error: { code: "NOT_FOUND" } }] });
    const unproven = await f.request("/sync", "POST", { contextId: f.contextId, cursor: null, operations: [] });
    expect(unproven.status).toBe(404);
  } finally { f.db.close(); }
});

test("snapshot anchor catches an insert behind its keyset and never returns over 100 changes", async () => {
  const f = await fixture();
  try {
    await f.db.prepare(`WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n < 100)
      INSERT INTO notifications (id, context_id, event_key, kind, created_at)
      SELECT printf('x-%03d', n), ?, printf('event-%03d', n), 'test_update', n FROM ids`).bind(f.contextId).run();
    const first = await f.sync(null);
    expect(first.upserts).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    await f.db.batch([
      f.db.prepare(`INSERT INTO notifications (id, context_id, event_key, kind, created_at)
        VALUES ('a-late', ?, 'late', 'test_update', 5)`).bind(f.contextId),
      f.db.prepare(`INSERT INTO sync_changes (kind, resource_id, partition_key, op, at)
        VALUES ('notification', 'a-late', ?, 'upsert', 5)`).bind(f.contextId),
    ]);
    const last = await f.sync(first.cursor);
    expect(last.upserts).toHaveLength(2);
    expect(last.hasMore).toBe(true);
    const delta = await f.sync(last.cursor);
    expect(delta.upserts.map((upsert) => upsert.resourceId)).toEqual(["a-late"]);
  } finally { f.db.close(); }
});

test("invalid and foreign cursors and oversized requests cannot commit an operation", async () => {
  const f = await fixture();
  try {
    const initial = await f.sync(null);
    const tampered = (initial.cursor[0] === "A" ? "B" : "A") + initial.cursor.slice(1);
    const request = (cursor: string, operations: unknown[]) => f.request("/sync", "POST", { contextId: f.contextId, cursor, operations });
    const before = f.db.calls.batch;
    expect((await request(tampered, [readMark("notice-a")])).status).toBe(422);
    expect((await request(initial.cursor, [...Array(9)].map(() => readMark("notice-a")))).status).toBe(422);
    expect((await request(initial.cursor, [{ ...readMark("notice-a"), overLimit: "x".repeat(256 * 1024) }])).status).toBe(422);
    expect(f.db.calls.batch).toBe(before);
    const codec = await createCursorCodec(secret);
    const foreign = await codec.issue({ accountId: accountIdSchema.parse("different-actor"), epoch: 0,
      context: { contextId: contextIdSchema.parse(f.contextId), role: "customer", businessId: null } },
    { phase: "delta", seq: 0 }, Date.now());
    expect((await request(foreign, [readMark("notice-a")])).status).toBe(404);
    expect(f.db.calls.batch - before).toBe(1);
    expect(await f.db.prepare("SELECT count(*) AS receipts FROM operation_receipts").first()).toEqual({ receipts: 0 });
  } finally { f.db.close(); }
});

test("inbox mark all uses the displayed cutoff; push registration is account-owned across role revocation", async () => {
  const f = await fixture(true);
  try {
    const inbox = await f.request(`/notifications?contextId=${f.contextId}`, "GET");
    expect(inbox.status).toBe(200);
    expect((await inbox.json()).data.items.map((item: { id: string }) => item.id)).toEqual(["notice-b", "notice-a"]);
    const mark = await f.request("/notifications/read", "POST", { contextId: f.contextId, operationId: "mark-all",
      payload: { mode: "all", through: { id: "notice-a", createdAt: 1 } } }, "mark-all");
    expect(mark.status).toBe(200);
    expect((await f.db.prepare("SELECT id FROM notifications WHERE read_at IS NOT NULL").all()).results).toEqual([{ id: "notice-a" }]);
    const path = "/push/installations/device";
    const payload = { token: "ExpoPushToken[test_token]", platform: "ios" };
    const put = await f.request(path, "PUT", { operationId: "register", expectedRevision: 0, payload }, "register");
    expect(put.status).toBe(200);
    expect((await put.json()).data).toMatchObject({ tokenEpoch: 1, status: "committed" });
    const noop = await f.request(path, "PUT", { operationId: "noop", expectedRevision: 1, payload }, "noop");
    expect((await noop.json()).data).toMatchObject({ tokenEpoch: 1, status: "unchanged" });
    await f.db.prepare("UPDATE memberships SET state = 'revoked' WHERE id = 'member'").run();
    const del = await f.request(path, "DELETE", { operationId: "revoke", expectedRevision: 1, payload: {} }, "revoke");
    expect((await del.json()).data).toMatchObject({ tokenEpoch: 2, state: "revoked", status: "committed" });
    const stale = await f.request(path, "PUT", { operationId: "out-of-order", expectedRevision: 1, payload }, "out-of-order");
    expect(stale.status).toBe(409);
  } finally { f.db.close(); }
});

test("guarded effects return new work keys, never wake work again on command replay", async () => {
  const f = await fixture();
  try {
    const now = Date.now();
    const access = await resolveSession(new Request("https://bookbuddy.test/api/v1/test", {
      headers: { Authorization: `Bearer ${credential}` },
    }), f.contextId, now);
    if (!access) throw new Error("Expected test session");
    const ctx = { binding: f.db, now };
    const plan = await planOperation(ctx, {
      access, operationId: operationIdSchema.parse("publish-notice"), command: "publish_test_notice",
      input: { id: "notice-c" }, resultRef: "notice-c",
      eligible: { sql: "NOT EXISTS (SELECT 1 FROM notifications WHERE id = 'notice-c')" },
      writes: (guard) => ({
        statements: [{ sql: `INSERT INTO notifications (id, context_id, event_key, kind, created_at)
          SELECT 'notice-c', ?, 'event-c', 'test_update', ? WHERE ${guard.sql}`,
          params: [f.contextId, now, ...guard.params ?? []] }],
        changes: { sql: "SELECT 'notification' kind, 'notice-c' resource_id, ? partition_key, 'upsert' op, ? at",
          params: [f.contextId, now] },
        effects: { sql: "SELECT 'wake-c' id, 'push' kind, 'notice-c' dedupe_key, 'notice-c' resource_ref, ? due_at, ? expires_at",
          params: [now, now + 60_000] },
      }),
    });
    const first = await commitCommand(ctx, prepareCommand(ctx, plan));
    expect(first).toMatchObject({ outcome: { status: "committed" }, workKeys: ["wake-c"] });
    const replay = await commitCommand(ctx, prepareCommand(ctx, plan));
    expect(replay).toMatchObject({ outcome: { status: "replayed" }, workKeys: [] });
    expect(await f.db.prepare("SELECT id, state FROM effect_outbox").first()).toEqual({ id: "wake-c", state: "pending" });
  } finally { f.db.close(); }
});
