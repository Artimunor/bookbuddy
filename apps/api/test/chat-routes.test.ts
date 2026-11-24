import { expect, test } from "bun:test";
import {
  appendThreadEntriesRoute, getSessionBookingRoute, getThreadEntriesRoute, getThreadRoute, listThreadsRoute, markThreadReadRoute,
  openLinkRoute, operationIdHeader, reportTranslationRoute, requestTranslationRoute, syncRoute,
} from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { runEffectBatch } from "../src/effects";
import { randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential } from "../src/modules/auth/session";
import { readThreadList } from "../src/modules/chat/read";
import type { ExpoFetch, ExpoMessage } from "../src/providers/expo-push";
import type { TranslationFetch } from "../src/providers/translate";
import { createTestD1 } from "./d1";

const people = ["customer", "foreman", "worker", "admin", "viewer"] as const;
type Person = typeof people[number];
const base = "https://bookbuddy.test/api/v1";
const job = "chat-job";
const noAccess = { ok: false, error: { code: "NOT_FOUND" } };

async function fixture() {
  const db = await createTestD1();
  const now = Date.now();
  const app = createApp();
  app.onError((error) => { throw error; });
  const wakes: string[][] = [], hints: string[] = [], pending: Promise<unknown>[] = [];
  const env = {
    DB: db, SYNC_CURSOR_HMAC_KEY: "isolated-chat-tests-cursor-key-over-32-chars",
    CHAT_TRANSLATION_PAIRS: '[["en","pt-PT"],["en","es"],["en","en-GB"]]',
    GOOGLE_TRANSLATION_PROJECT: "isolated-chat-project", GOOGLE_TRANSLATION_CREDENTIAL: "fake-bearer-token",
    EFFECTS: { async send({ workKeys }: { workKeys: string[] }) { wakes.push(workKeys); } },
    LIVE: { getByName() { return { async publishInvalidation(name: string) { hints.push(name); } }; } },
  } as unknown as Bindings;
  const ctx = { waitUntil(task: Promise<unknown>) { pending.push(task); }, passThroughOnException() {} };
  const credentials = new Map<Person, string>();
  try {
    await db.batch([
      db.prepare("INSERT INTO operating_areas(id,name,site_zone,polygon) VALUES ('chat-area','Coarse area','Europe/Madrid','[0]')"),
      db.prepare(`INSERT INTO businesses(id,legal_name,public_name,verified_work_contact,catchment_id,state)
        VALUES ('chat-business','Test provider Ltd','Test provider','provider@example.test','chat-area','approved')`),
      ...people.map((id) => db.prepare(`INSERT INTO accounts(id,email_normalized,display_name,verified_at,state)
        VALUES (?,?,?,1,'active')`).bind(id, `${id}@example.test`, ({ customer: "Claire Martin", foreman: "Mateo Ruiz", worker: "Diego Torres", admin: "Ana Silva", viewer: "Vera Lou" })[id])),
      ...([ ["foreman", "foreman"], ["worker", "worker"], ["admin", "provider_admin"] ] as const).flatMap(([id, role]) => [
        db.prepare("INSERT INTO memberships VALUES (?,'chat-business',?,'active')").bind(`${id}-member`, id),
        db.prepare(`INSERT INTO membership_roles (id,membership_id,business_id,account_id,role,granted_at)
          VALUES (?,?,'chat-business',?,?,1)`).bind(`${id}-role`, `${id}-member`, id, role),
        db.prepare("INSERT INTO account_contexts VALUES (?,?,?,'chat-business',?)").bind(`${id}-ctx`, id, role, `${id}-role`),
      ]),
      db.prepare("INSERT INTO account_contexts (id,account_id,role) VALUES ('customer-ctx','customer','customer'),('viewer-ctx','viewer','customer')"),
      db.prepare(`INSERT INTO account_preferences (account_id,reading_locale) VALUES
        ('customer','pt-PT'),('foreman','en-GB'),('worker','pt-PT'),('admin','es'),('viewer','es')`),
      ...await Promise.all(people.map(async (id) => {
        const token = randomToken();
        credentials.set(id, token);
        return db.prepare(`INSERT INTO sessions (id,account_id,secret_hash,active_context_id,device_id,issued_at,expires_at)
          VALUES (?,?,?,?,'device',1,?)`).bind(`${id}-session`, id, await hashSessionCredential(token), `${id}-ctx`, now + 24 * 3600_000);
      })),
      db.prepare(`INSERT INTO places (id,owner_id,alias,normalized_address,state)
        VALUES ('chat-place','customer','Private site','10 Example Road','pending_verification')`),
      db.prepare(`INSERT INTO place_people (place_id,account_id,verified_from,history_from)
        VALUES ('chat-place','customer',1,1),('chat-place','viewer',1,1)`),
      db.prepare(`UPDATE places SET state='in_area',area_id='chat-area',site_zone='Europe/Madrid',
        named_approver_id='customer',pin='{"latitude":0,"longitude":0}' WHERE id='chat-place'`),
      db.prepare(`INSERT INTO place_grants (id,place_id,account_id,capability,issuer_id,valid_from) VALUES
        ('chat-message','chat-place','customer','message','customer',1),('chat-view','chat-place','viewer','view','customer',1)`),
      db.prepare(`INSERT INTO jobs (id,reference,business_id,place_id,requester_id,accountable_foreman_membership_id,trade,origin,state)
        VALUES (?,'BB-CHAT1','chat-business','chat-place','customer','foreman-member','carpentry','bookbuddy','open')`).bind(job),
      db.prepare(`INSERT INTO visits (id,job_id,kind,state) VALUES ('chat-visit',?,'work','booked')`).bind(job),
      db.prepare(`INSERT INTO shifts VALUES ('chat-shift','chat-visit',?,?,'carpentry','en','active')`).bind(now - 1000, now + 7200_000),
      db.prepare(`INSERT INTO shift_slots(id,shift_id,number,is_lead) VALUES ('chat-slot','chat-shift',1,1)`),
      db.prepare(`INSERT INTO assignments (id,slot_id,worker_membership_id,source,state,confirmed_by,confirmed_at,starts_at,ends_at)
        VALUES ('chat-assignment','chat-slot','worker-member','ordinary','confirmed','foreman',?,?,?)`).bind(now - 5000, now - 1000, now + 7200_000),
    ]);
  } catch (error) { db.close(); throw error; }

  async function request(path: string, person: Person, body?: unknown, operationId?: string) {
    const before = { ...db.calls };
    const response = await app.request(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${credentials.get(person)}`, ...(operationId ? { [operationIdHeader]: operationId } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env, ctx);
    await Promise.all(pending.splice(0));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(db.calls.batch - before.batch + db.calls.query - before.query).toBe(1);
    if (body !== undefined) expect(db.calls.batch - before.batch).toBe(1);
    return { status: response.status, body: await response.json() as unknown };
  }
  async function threads() {
    const { threads: rows } = data(listThreadsRoute.output, await request("/threads", "foreman"));
    expect(rows).toHaveLength(2);
    return { jobThread: rows.find(({ audience }) => audience === "job")!.id, crew: rows.find(({ audience }) => audience === "crew")!.id };
  }
  async function grant(threadId: string, person: Person, canSend = 1, visibleFrom = 1) {
    await db.prepare("INSERT INTO chat_members (thread_id,context_id,can_send,visible_from) VALUES (?,?,?,?)")
      .bind(threadId, `${person}-ctx`, canSend, visibleFrom).run();
  }
  async function consume(keys: string[], fetcher: TranslationFetch, expectsResult = true) {
    const { batch, query } = db.calls;
    await runEffectBatch(env, keys, Date.now(), undefined, fetcher);
    expect(db.calls.batch - batch).toBe(expectsResult ? 2 : 1);
    expect(db.calls.query - query).toBe(0);
  }
  return { db, env, request, threads, grant, consume, wakes, hints };
}

function data<T>(schema: { parse(value: unknown): T }, response: { status: number; body: unknown }): T {
  expect(response).toMatchObject({ status: 200, body: { ok: true } });
  const { body } = response;
  if (!body || typeof body !== "object" || !("data" in body)) throw new TypeError("Expected a success envelope");
  return schema.parse(body.data);
}
const entry = (id: string, originalText: string, sourceLanguage = "en", correctsId?: string) =>
  ({ operationId: `${id}-op`, payload: { id, originalText, sourceLanguage, correctsId } });

const details = (id: string) => `/threads/${id}`;
const entries = (id: string) => `/threads/${id}/entries`;
const report = (id: string) => `/entries/${id}/report-translation`;
const retry = (id: string) => `/entries/${id}/request-translation`;
const command = <T>(operationId: string, payload: T) => ({ operationId, payload });

test("lazily provisions distinct Job/Crew threads and rechecks every role, message grant and assignment", async () => {
  const f = await fixture();
  try {
    const { jobThread, crew } = await f.threads();
    expect(f.wakes).toEqual([]);
    expect(data(listThreadsRoute.output, await f.request("/threads", "customer")).threads.map(({ id }) => id)).toEqual([jobThread]);
    expect(data(listThreadsRoute.output, await f.request("/threads", "worker")).threads.map(({ id }) => id)).toEqual([crew]);
    expect(data(listThreadsRoute.output, await f.request("/threads", "viewer")).threads).toEqual([]);
    expect(await f.request(details(jobThread), "admin")).toMatchObject({ status: 404, body: noAccess });
    expect(await f.request(details(jobThread), "worker")).toMatchObject({ status: 404, body: noAccess });
    expect(await f.request(entries(crew), "customer")).toMatchObject({ status: 404, body: noAccess });
    await f.grant(jobThread, "worker", 0);
    await f.grant(jobThread, "admin");
    await f.grant(crew, "customer"); // A materialized row never grants Customer access to Crew.
    const view = data(getThreadRoute.output, await f.request(details(jobThread), "worker"));
    expect(view).toMatchObject({ canSend: false, readOnlyReason: "read_only_grant", readingLocale: "pt-PT" });
    expect(view.members.map(({ role }) => role).sort()).toEqual(["customer", "foreman", "provider_admin", "worker"]);
    expect(view.members.find(({ isContact }) => isContact)?.displayName).toBe("Mateo Ruiz");
    expect(await f.request(details(crew), "customer")).toMatchObject({ status: 404, body: noAccess });
    await f.db.prepare("UPDATE assignments SET state='released' WHERE id='chat-assignment'").run();
    expect(await f.request(details(crew), "worker")).toMatchObject({ status: 404, body: noAccess });
    expect(await f.request(details(jobThread), "worker")).toMatchObject({ status: 404, body: noAccess });
    await f.db.prepare("UPDATE place_grants SET revoked_at=? WHERE id='chat-message'").bind(Date.now()).run();
    expect(await f.request(details(jobThread), "customer")).toMatchObject({ status: 404, body: noAccess });
  } finally { f.db.close(); }
});

test("the inbox scopes tenant keys before materializing either page", async () => {
  const f = await fixture();
  try {
    const ids = "WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM ids WHERE n < 100)";
    await f.db.batch([
      f.db.prepare(`INSERT INTO businesses (id,legal_name,public_name,verified_work_contact,catchment_id,state)
        VALUES ('elsewhere','Other Ltd','Other','elsewhere@example.test','chat-area','approved')`),
      f.db.prepare(`INSERT INTO places (id,owner_id,alias,normalized_address,state)
        VALUES ('other-place','viewer','Other site','900 Other Road','pending_verification')`),
      f.db.prepare("INSERT INTO place_people (place_id,account_id,verified_from,history_from) VALUES ('other-place','viewer',1,1)"),
      f.db.prepare(`${ids} INSERT INTO jobs (id,reference,business_id,place_id,requester_id,origin,state)
        SELECT printf('a-hidden-%03d', n), printf('BB-H%03d', n), 'elsewhere', 'other-place', 'viewer', 'bookbuddy', 'open' FROM ids
        UNION ALL SELECT printf('z-visible-%03d', n), printf('BB-V%03d', n), 'chat-business', 'chat-place', 'customer', 'bookbuddy', 'open' FROM ids`),
      f.db.prepare(`INSERT INTO chat_threads (id, job_id, audience, write_state)
        SELECT 'thread-' || j.id, j.id, 'job', 'open' FROM jobs j WHERE j.business_id = 'elsewhere'`),
    ]);
    const first = data(listThreadsRoute.output, await f.request("/threads", "customer"));
    expect(first.threads).toHaveLength(100);
    expect(first.page).toEqual({ hasMore: true, cursor: "z-visible-099~job" });
    const second = data(listThreadsRoute.output, await f.request(`/threads?cursor=${first.page.cursor}`, "customer"));
    expect(second.threads).toMatchObject([{ job: { id: "z-visible-100" } }]);
    expect(second.page).toEqual({ hasMore: false, cursor: null });
    expect(JSON.stringify({ first, second })).not.toContain("a-hidden-");
    const access = { sql: `WITH acting_session AS (SELECT 'customer' AS account_id), live_scope AS (
      SELECT account_id, id AS context_id, role, business_id FROM account_contexts WHERE id = 'customer-ctx')`, params: [] };
    const query = readThreadList(access, Date.now(), ["", ""], []);
    const plan = await f.db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).bind(...query.params ?? []).all<{ detail: string }>();
    expect(plan.results.map(({ detail }) => detail).join("\n")).toMatch(/SEARCH j USING INDEX jobs_place_state \(place_id=\?/);
  } finally { f.db.close(); }
});

test("append, replay, correction and pair-batched effects keep immutable originals and exact target provenance", async () => {
  const f = await fixture();
  try {
    const { jobThread } = await f.threads();
    await f.grant(jobThread, "worker");
    await f.grant(jobThread, "admin");
    const original = entry("first", "Mateo will bring the replacement handle");
    const correction = entry("next", "The replacement handle is on the way", "en", "first");
    const sameLanguage = entry("matching", "A peça chega cedo", "pt-PT");
    const batch = { operations: [original, correction, sameLanguage] };
    const sent = data(appendThreadEntriesRoute.output, await f.request(entries(jobThread), "foreman", batch));
    expect(sent.outcomes).toMatchObject([
      { status: "committed", receipt: { id: "first", rootId: "first", revision: 1, position: 1, readingLocales: ["es", "pt-PT"] } },
      { status: "committed", receipt: { id: "next", rootId: "first", revision: 2, position: 2 } },
      { status: "committed", receipt: { id: "matching", rootId: "matching", revision: 1, position: 3 } },
    ]);
    expect(f.wakes).toHaveLength(1);
    expect(f.wakes[0]).toHaveLength(4);
    expect(f.hints).toEqual([`thread:${jobThread}`]);
    const rows = await f.db.prepare("SELECT root_id, revision, target_locale, state FROM message_translations ORDER BY revision,target_locale").all();
    expect(rows.results).toEqual([1, 2].flatMap((revision) => ["es", "pt-PT"].map((target_locale) =>
      ({ root_id: "first", revision, target_locale, state: "pending" }))));

    const replay = data(appendThreadEntriesRoute.output, await f.request(entries(jobThread), "foreman", {
      operations: [original, { ...original, operationId: "client-message-replay" }, { ...original, operationId: "edited", payload: { ...original.payload, originalText: "Changed" } }],
    }));
    expect(replay.outcomes).toMatchObject([{ status: "replayed", receipt: { id: "first", position: 1 } },
      { status: "replayed", receipt: { id: "first", position: 1 } }, { status: "rejected", error: { code: "CONFLICT" } }]);
    expect(f.wakes).toHaveLength(1);
    expect(f.hints).toHaveLength(1);

    const before = data(getThreadEntriesRoute.output, await f.request(entries(jobThread), "customer"));
    expect(before.entries.find(({ id }) => id === "first")).toMatchObject({ originalText: original.payload.originalText,
      preferredTranslation: { state: "pending", targetLocale: "pt-PT" } });
    expect(before.entries[0]).toMatchObject({ id: "matching", preferredTranslation: null });

    const calls: { target: string; texts: string[] }[] = [];
    const fetcher: TranslationFetch = async (url, init) => {
      expect(String(url)).toBe("https://translate-eu.googleapis.com/v3/projects/isolated-chat-project/locations/eu:translateText");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fake-bearer-token");
      const { contents, sourceLanguageCode, targetLanguageCode } = JSON.parse(String(init?.body)) as {
        contents: string[]; sourceLanguageCode: string; targetLanguageCode: string;
      };
      expect(sourceLanguageCode).toBe("en");
      expect(contents.join(" ")).not.toContain("Mateo");
      calls.push({ target: targetLanguageCode, texts: contents });
      return Response.json({ translations: contents.map((text) => ({ translatedText: `${targetLanguageCode}: ${text}` })) });
    };
    await f.consume(f.wakes[0]!, fetcher);
    expect(calls.map(({ target, texts }) => [target, texts.length]).sort()).toEqual([["es", 2], ["pt-PT", 2]]);
    expect(f.hints).toEqual([`thread:${jobThread}`, `thread:${jobThread}`]);
    await f.consume(f.wakes[0]!, fetcher, false);
    expect(calls).toHaveLength(2);
    const reading = data(getThreadEntriesRoute.output, await f.request(entries(jobThread), "customer"));
    expect(reading.entries.find(({ id }) => id === "first")).toMatchObject({ originalText: original.payload.originalText,
      preferredTranslation: { state: "ready", targetLocale: "pt-PT", text: "pt-PT: … will bring the replacement handle" } });
    expect(reading.entries.find(({ id }) => id === "next")).toMatchObject({ correctsId: "first", revision: 2 });
    expect((await f.db.prepare("SELECT DISTINCT state,provider,model,produced_at IS NOT NULL AS dated FROM message_translations").all()).results)
      .toEqual([{ state: "ready", provider: "google", model: "nmt", dated: 1 }]);
    const inbox = data(listThreadsRoute.output, await f.request("/threads", "customer"));
    expect(inbox.threads[0]).toMatchObject({ unreadCount: 3, latest: { originalText: sameLanguage.payload.originalText } });
    const flags = command("poor-translation", { targetLocale: "pt-PT" });
    const flagged = data(reportTranslationRoute.output, await f.request(report("first"), "customer", flags, flags.operationId));
    expect(data(reportTranslationRoute.output, await f.request(report("first"), "customer", flags, flags.operationId))).toEqual(flagged);
    const mark = `${details(jobThread)}/read-position`;
    expect(data(markThreadReadRoute.output, await f.request(mark, "customer", command("read-all", { position: 3 }), "read-all")).position).toBe(3);
    expect(data(markThreadReadRoute.output, await f.request(mark, "customer", command("read-old", { position: 1 }), "read-old")).position).toBe(3);
    expect(f.wakes).toHaveLength(1);
  } finally { f.db.close(); }
});

test("sync shares append identity, authority and durable effects without exposing message text in the feed", async () => {
  const f = await fixture();
  try {
    const { jobThread } = await f.threads();
    const queued = entry("offline", "The painted frame is drying");
    const operations = [queued, ...Array.from({ length: 7 }, (_, index) => entry(`offline-${index}`, "The site is tidy"))];
    const sync = await f.request("/sync", "foreman", { contextId: "foreman-ctx", cursor: null, operations: operations.map((op) => ({
      ...op, kind: "chat_append", payload: { ...op.payload, threadId: jobThread },
    })) });
    const page = data(syncRoute.output, sync);
    expect(page.outcomes).toEqual(operations.map(({ operationId, payload }) => ({ operationId, status: "committed", resultRef: payload.id })));
    expect(page.upserts).toContainEqual({ kind: "chat_thread", resourceId: jobThread,
      value: { threadId: jobThread, audience: "job", lastPosition: 8, readPosition: 0 } });
    expect(JSON.stringify(page)).not.toContain(queued.payload.originalText);
    expect(f.wakes).toHaveLength(1);
    expect(f.wakes[0]).toHaveLength(8);
    expect(data(appendThreadEntriesRoute.output, await f.request(entries(jobThread), "foreman", { operations: [queued] })).outcomes)
      .toMatchObject([{ status: "replayed", receipt: { id: "offline", position: 1 } }]);
    expect(f.wakes).toHaveLength(1);
  } finally { f.db.close(); }
});

test("chat keeps ordinary numbers in originals but rejects labelled credentials", async () => {
  const f = await fixture();
  try {
    const { jobThread } = await f.threads();
    const note = "The frame was installed in 2024.";
    const sent = data(appendThreadEntriesRoute.output, await f.request(entries(jobThread), "foreman", { operations: [
      entry("year", note), entry("private-credential", "Gate code: Cedar-Blue"),
    ] }));
    expect(sent.outcomes).toMatchObject([
      { status: "committed", receipt: { id: "year" } },
      { status: "rejected", error: { code: "VALIDATION_FAILED" } },
    ]);
    expect(data(getThreadEntriesRoute.output, await f.request(entries(jobThread), "customer")).entries)
      .toMatchObject([{ id: "year", originalText: note }]);
  } finally { f.db.close(); }
});

test("only a definitely uncharged attempt can retry; an expired or ambiguous claim is never resent", async () => {
  const f = await fixture();
  try {
    const { jobThread } = await f.threads();
    data(appendThreadEntriesRoute.output, await f.request(entries(jobThread), "foreman", { operations: [entry("failure", "The hinges need checking")] }));
    let calls = 0;
    const rejected: TranslationFetch = async () => { calls++; return new Response(null, { status: 403 }); };
    await f.consume(f.wakes[0]!, rejected);
    expect(data(getThreadEntriesRoute.output, await f.request(entries(jobThread), "customer")).entries[0]?.preferredTranslation)
      .toEqual({ state: "unavailable", targetLocale: "pt-PT", canRetry: true });
    const request = command("retry-unpaid", { targetLocale: "pt-PT" });
    expect(data(requestTranslationRoute.output, await f.request(retry("failure"), "customer", request, request.operationId)))
      .toMatchObject({ preferredTranslation: { state: "pending" } });
    data(requestTranslationRoute.output, await f.request(retry("failure"), "customer", request, request.operationId));
    expect(f.wakes).toHaveLength(2);
    const ambiguous: TranslationFetch = async () => { calls++; throw new Error("transport ended without a result"); };
    await f.consume(f.wakes[1]!, ambiguous);
    const latest = data(getThreadEntriesRoute.output, await f.request(entries(jobThread), "customer")).entries[0];
    expect(latest?.preferredTranslation).toEqual({ state: "unavailable", targetLocale: "pt-PT", canRetry: false });
    expect(await f.request(retry("failure"), "customer", command("retry-unknown", { targetLocale: "pt-PT" }), "retry-unknown"))
      .toMatchObject({ status: 409 });
    await f.consume(f.wakes[1]!, ambiguous, false);
    expect(calls).toBe(2);

    data(appendThreadEntriesRoute.output, await f.request(entries(jobThread), "foreman", { operations: [entry("leased", "I will check the finish")] }));
    const expired = f.wakes[2]![0]!;
    await f.db.batch([
      f.db.prepare("UPDATE effect_outbox SET state='claimed' WHERE id=?").bind(expired),
      f.db.prepare("INSERT INTO effect_claims (effect_id,attempt,claim_id,fence,claimed_at,lease_until) VALUES (?,1,'dead-process',1,1,2)").bind(expired),
    ]);
    await f.consume([expired], ambiguous, false);
    expect(calls).toBe(2);
    expect(data(getThreadEntriesRoute.output, await f.request(entries(jobThread), "customer")).entries[0]?.preferredTranslation)
      .toEqual({ state: "unavailable", targetLocale: "pt-PT", canRetry: false });
  } finally { f.db.close(); }
});

test("media is linked only from the author's exact thread; restricted text and revoked readers do not reach Google", async () => {
  const f = await fixture();
  try {
    const { jobThread, crew } = await f.threads();
    const now = Date.now();
    await f.db.batch([
      f.db.prepare(`INSERT INTO media_stages (id,context_id,caller,parent_scope_id,created_at,expires_at) VALUES
        ('job-stage','foreman-ctx','chat',?,?,?),('crew-stage','foreman-ctx','chat',?,?,?)`)
        .bind(jobThread, now, now + 60_000, crew, now, now + 60_000),
      f.db.prepare(`INSERT INTO attachments (id,stage_id,object_key,mime,bytes,state,etag,retention_class,delete_after) VALUES
        ('job-photo','job-stage','job-object','image/jpeg',15,'ready','job-etag','unlinked',?),
        ('crew-photo','crew-stage','crew-object','image/jpeg',15,'ready','crew-etag','unlinked',?)`).bind(now + 60_000, now + 60_000),
    ]);
    const sent = data(appendThreadEntriesRoute.output, await f.request(entries(jobThread), "foreman", { operations: [
      command("wrong-parent", { id: "wrong-parent", sourceLanguage: "en", attachmentIds: ["crew-photo"] }),
      command("shared-photo", { id: "shared-photo", sourceLanguage: "en", attachmentIds: ["job-photo"] }),
      entry("private-text", "Payment instructions are ready"),
      entry("eligible-text", "The frame is ready"),
    ] }));
    expect(sent.outcomes.map(({ status }) => status)).toEqual(["rejected", "committed", "committed", "committed"]);
    expect(f.wakes).toHaveLength(1);
    expect(f.wakes[0]).toHaveLength(1);
    const page = data(getThreadEntriesRoute.output, await f.request(entries(jobThread), "customer"));
    expect(page.entries.find(({ id }) => id === "shared-photo")).toMatchObject({
      originalText: null, preferredTranslation: null, attachments: [{ attachmentId: "job-photo", kind: "photo", availability: "available" }],
    });
    expect(page.entries.find(({ id }) => id === "private-text")?.preferredTranslation).toEqual({
      state: "unavailable", targetLocale: "pt-PT", canRetry: false,
    });
    expect(await f.db.prepare("SELECT retention_class, delete_after FROM attachments WHERE id='job-photo'").first())
      .toEqual({ retention_class: "ordinary", delete_after: null });
    await f.db.prepare("UPDATE place_grants SET revoked_at=? WHERE id='chat-message'").bind(Date.now()).run();
    let calls = 0;
    await f.consume(f.wakes[0]!, async () => { calls++; return new Response(null, { status: 503 }); }, false);
    expect(calls).toBe(0);
    expect(await f.db.prepare("SELECT state FROM message_translations WHERE root_id='eligible-text'").first())
      .toEqual({ state: "unavailable" });
  } finally { f.db.close(); }
});

test("one initial read returns permissions and the live Crew hold without adding it to Job or older pages", async () => {
  const f = await fixture();
  try {
    const { jobThread, crew } = await f.threads();
    await f.grant(jobThread, "worker", 0);
    await f.db.prepare(`INSERT INTO safety_holds (id, assignment_id, kind, state)
      VALUES ('hold', 'chat-assignment', 'work_rule', 'active')`).run();
    const jobPage = data(getThreadEntriesRoute.output, await f.request(entries(jobThread), "worker"));
    expect(jobPage.thread).toMatchObject({ id: jobThread, audience: "job", writeState: "open",
      canSend: false, readOnlyReason: "read_only_grant" });
    expect(jobPage.thread?.members.map(({ role, isViewer }) => [role, isViewer])).toEqual([
      ["foreman", false], ["customer", false], ["worker", true],
    ]);
    expect(jobPage.thread).not.toHaveProperty("safetyHold");
    const held = data(getThreadEntriesRoute.output, await f.request(entries(crew), "worker"));
    expect(held.thread).toMatchObject({ id: crew, audience: "crew", canSend: true, safetyHold: true });
    const older = data(getThreadEntriesRoute.output, await f.request(`${entries(crew)}?cursor=before~1`, "worker"));
    expect(older.thread).toBeUndefined();
    await f.db.prepare("UPDATE safety_holds SET state='cleared', cleared_at=? WHERE id='hold'").bind(Date.now()).run();
    expect(data(getThreadEntriesRoute.output, await f.request(entries(crew), "worker")).thread).toMatchObject({ safetyHold: false });
  } finally { f.db.close(); }
});

test("chat append atomically creates recipient-scoped notices, reuses links, and reauthorizes opens and push", async () => {
  const f = await fixture();
  try {
    const { crew } = await f.threads();
    const origin = "https://bookbuddy.test";
    f.env.PUBLIC_APP_ORIGIN = origin;
    await f.db.prepare(`INSERT INTO push_installations (id, account_id, device_id, session_id, token, token_epoch, platform, state, updated_at)
      VALUES ('worker-device','worker','device','worker-session','ExpoPushToken[chat-worker]',1,'ios','active',?)`).bind(Date.now()).run();
    const text = "A peça chegou";
    const first = entry("crew-alert", text, "pt-PT");
    const second = entry("crew-update", "A peça está pronta", "pt-PT");
    for (const op of [first, second, first]) {
      data(appendThreadEntriesRoute.output, await f.request(entries(crew), "foreman", { operations: [op] }));
    }
    expect(f.wakes.map(keys => keys.length)).toEqual([1, 1]);
    expect(f.hints).toEqual([`thread:${crew}`, `thread:${crew}`]);
    const { results: notices } = await f.db.prepare(`SELECT n.kind, n.context_id, n.link_token
      FROM notifications n ORDER BY n.event_key`).all<{ kind: string; context_id: string; link_token: string }>();
    const token = notices[0]!.link_token;
    expect(notices).toEqual(Array.from({ length: 2 }, () => ({ kind: "chat_message", context_id: "worker-ctx", link_token: token })));
    expect(data(openLinkRoute.output, await f.request(`/links/${token}`, "worker"))).toEqual({
      kind: "thread", threadId: crew, audience: "crew",
    });
    expect(data(openLinkRoute.output, await f.request(`/links/${token}`, "customer"))).toMatchObject({ kind: "unavailable" });
    const delivered: ExpoMessage[] = [];
    const expo: ExpoFetch = async (_url, init) => {
      const messages = JSON.parse(String(init.body)) as ExpoMessage[];
      delivered.push(...messages);
      return Response.json({ data: messages.map(() => ({ status: "ok", id: "chat-ticket" })) });
    };
    await runEffectBatch(f.env, f.wakes[0]!, Date.now(), expo);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.data).toEqual({ url: `${origin}/l/${token}` });
    expect(JSON.stringify(delivered)).not.toContain(text);
    await f.db.prepare("UPDATE assignments SET state='released' WHERE id='chat-assignment'").run();
    expect(data(openLinkRoute.output, await f.request(`/links/${token}`, "worker"))).toMatchObject({
      kind: "unavailable", reason: "removed",
    });
    await runEffectBatch(f.env, f.wakes[1]!, Date.now(), expo);
    expect(delivered).toHaveLength(1);
  } finally { f.db.close(); }
});

test("booking creates the inbox thread before detail opens; chat fences flags, hosts and links", async () => {
  const f = await fixture();
  try {
    const now = Date.now();
    const start = now + 60 * 60_000;
    await f.db.batch([
      f.db.prepare(`INSERT INTO venues (id,business_id,area_id,site_zone,name,locality,address,access_note,arrival_note,state,approved_at)
        VALUES ('studio','chat-business','chat-area','Europe/Madrid','Studio','Coast','Exact studio address','Step-free','Reception','approved',1)`),
      f.db.prepare("INSERT INTO session_listings (id,business_id,category) VALUES ('session-listing','chat-business','pilates')"),
      f.db.prepare(`INSERT INTO session_listing_versions (id,listing_id,business_id,no,venue_id,title,description,original_locale,
        language,format,duration_ms,price_minor,currency,price_basis,terms_text,terms_locale,terms_hash,cancellation_notice_ms,created_by_id,created_at)
        VALUES ('session-version','session-listing','chat-business',1,'studio','Mat Pilates','Small group class','en','en','group',2700000,
          1600,'EUR','per_person','Pay in person','en','session-terms',0,'foreman',1)`),
      f.db.prepare(`INSERT INTO session_slots (id,listing_id,listing_version_id,business_id,starts_at,ends_at,capacity,hosts_required,
        coordinator_membership_id,state,updated_at)
        VALUES ('session-slot','session-listing','session-version','chat-business',?,?,2,1,'foreman-member','published',1)`).bind(start, start + 2700000),
      f.db.prepare(`INSERT INTO session_host_assignments (id,slot_id,business_id,membership_id,position,role_label,language,state,changed_at,changed_by_id,confirmed_at)
        VALUES ('session-host','session-slot','chat-business','worker-member',1,'Instructor','en','confirmed',1,'foreman',1)`),
      ...["customer", "viewer"].flatMap((booker, index) => [
        f.db.prepare(`INSERT INTO session_holds (id,slot_id,listing_id,listing_version_id,terms_hash,booker_id,places,held_at,expires_at,state)
          VALUES (?,'session-slot','session-listing','session-version','session-terms',?,1,?,?,'held')`)
          .bind(`${booker}-hold`, booker, now - 3000, start),
        f.db.prepare(`INSERT INTO session_bookings (id,reference,booker_id,listing_id,original_hold_id,original_slot_id,original_listing_version_id,
          original_terms_hash,slot_id,listing_version_id,terms_hash,places,state,booked_at)
          VALUES (?,?,?,'session-listing',?,'session-slot','session-version','session-terms',
          'session-slot','session-version','session-terms',1,'booked',?)`)
          .bind(`${booker}-booking`, `BB-SESSION${index}`, booker, `${booker}-hold`, now - 2000),
      ]),
      f.db.prepare("INSERT INTO feature_flags VALUES ('sessions','chat-area:pilates',1,1), ('sessions','chat-business',1,1)"),
    ]);
    const booking = data(getSessionBookingRoute.output, await f.request("/session-bookings/customer-booking", "customer"));
    const threadId = booking.threadId;
    const otherThread = data(getSessionBookingRoute.output, await f.request("/session-bookings/viewer-booking", "viewer")).threadId;
    expect(threadId).toMatch(/^session-[a-f0-9]{32}$/);
    expect(otherThread).not.toBe(threadId);
    expect(await f.request(entries(threadId), "viewer")).toMatchObject({ status: 404, body: noAccess });
    expect(await f.db.prepare("SELECT count(*) AS total FROM chat_threads WHERE audience='session'").first("total")).toBe(2);
    const initialSync = data(syncRoute.output, await f.request("/sync", "foreman", {
      contextId: "foreman-ctx", cursor: null, operations: [],
    }));
    expect(initialSync.upserts).toContainEqual(expect.objectContaining({ kind: "chat_thread", resourceId: threadId }));
    await f.db.prepare("UPDATE feature_flags SET enabled=0 WHERE key='sessions' AND scope_key='chat-business'").run();
    expect(await f.request(entries(threadId), "customer")).toMatchObject({ status: 404, body: noAccess });
    const hidden = data(syncRoute.output, await f.request("/sync", "foreman", {
      contextId: "foreman-ctx", cursor: initialSync.cursor, operations: [],
    }));
    expect(hidden).toMatchObject({ mode: "reset", removals: [{ kind: "scope", resourceId: "foreman-ctx" }] });
    expect(hidden.upserts).not.toContainEqual(expect.objectContaining({ kind: "chat_thread", resourceId: threadId }));
    await f.db.prepare("UPDATE feature_flags SET enabled=1 WHERE key='sessions'").run();

    expect(data(listThreadsRoute.output, await f.request("/threads", "foreman")).threads)
      .toContainEqual(expect.objectContaining({ id: threadId, audience: "session" }));
    const sent = data(appendThreadEntriesRoute.output, await f.request(entries(threadId), "worker",
      { operations: [entry("session-entry", "We have a mat ready for you")] }));
    expect(sent.outcomes).toMatchObject([{ status: "committed", receipt: { id: "session-entry", position: 1 } }]);
    const opened = data(getThreadEntriesRoute.output, await f.request(entries(threadId), "customer"));
    expect(opened).toMatchObject({ audience: "session", stamps: [], thread: { id: threadId, canSend: true,
      session: { id: "customer-booking", title: "Mat Pilates", siteZone: "Europe/Madrid" } } });
    expect(opened.entries[0]).toMatchObject({ originalText: "We have a mat ready for you", preferredTranslation: { state: "pending" } });
    expect(opened.thread?.members.find((member) => member.isContact)?.displayName).toBe("Mateo Ruiz");
    const providerView = data(getThreadRoute.output, await f.request(details(threadId), "admin"));
    expect(providerView.members.map(({ role }) => role).sort()).toEqual(["customer", "foreman", "provider_admin", "worker"]);
    expect(JSON.stringify(providerView)).not.toMatch(/Vera Lou|Exact studio address/);
    const token = await f.db.prepare("SELECT link_token FROM notifications WHERE context_id='customer-ctx' AND event_key='chat_message:session-entry'")
      .first<string>("link_token");
    expect(data(openLinkRoute.output, await f.request(`/links/${token}`, "customer"))).toEqual({ kind: "thread", threadId, audience: "session" });
    expect(data(openLinkRoute.output, await f.request(`/links/${token}`, "viewer"))).toMatchObject({ kind: "unavailable" });

    await f.db.prepare("UPDATE place_grants SET revoked_at=? WHERE id='chat-view'").bind(now).run();
    expect(await f.request(entries(otherThread), "viewer")).toMatchObject({ status: 404, body: noAccess });
    expect(data(listThreadsRoute.output, await f.request("/threads", "viewer")).threads)
      .not.toContainEqual(expect.objectContaining({ id: otherThread, audience: "session" }));

    await f.db.prepare("UPDATE session_host_assignments SET state='released' WHERE id='session-host'").run();
    expect(await f.request(entries(threadId), "worker")).toMatchObject({ status: 404, body: noAccess });
    await f.db.prepare("UPDATE feature_flags SET enabled=0 WHERE key='sessions'").run();
    expect(await f.request(entries(threadId), "customer", { operations: [entry("flag-disabled-message", "Hello")] }))
      .toMatchObject({ status: 404, body: noAccess });
    expect(data(openLinkRoute.output, await f.request(`/links/${token}`, "customer"))).toMatchObject({ kind: "unavailable" });
  } finally { f.db.close(); }
});
