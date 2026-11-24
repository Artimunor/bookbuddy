import { expect, spyOn, test } from "bun:test";
import { getBusinessOverviewRoute, getHomeRoute, getJobRoute, getJobsRoute, resultSchema, syncRoute } from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential } from "../src/modules/auth/session";
import { createTestD1 } from "./d1";

const now = Date.UTC(2026, 10, 24, 23, 45);
const minute = 60_000;
const old = now - 60 * minute;
const expiry = now + 30 * minute;
const base = "https://bookbuddy.test/api/v1";
const execution = { waitUntil() {}, passThroughOnException() {} };
const noAccess = { ok: false, error: { code: "NOT_FOUND" } };

type User = "owner" | "other" | "viewer" | "foreman" | "recipient" | "admin" | "worker";

async function fixture() {
  const db = await createTestD1();
  const app = createApp();
  const env = { DB: db, SYNC_CURSOR_HMAC_KEY: "test-job-sync-cursor-key-more-than-32-chars" } as unknown as Bindings;
  const credentials = new Map<User, string>();
  try {
    const users = ["owner", "other", "viewer", "foreman", "recipient", "admin", "worker"] as const;
    await db.batch([
      db.prepare("INSERT INTO operating_areas(id,name,site_zone,polygon) VALUES ('area','Coarse area','Europe/Madrid','[0]')"),
      db.prepare(`INSERT INTO businesses(id,legal_name,public_name,verified_work_contact,catchment_id,state) VALUES
        ('business','Provider Ltd','Provider','provider@example.test','area','approved'),
        ('outside','Outside Ltd','Outside','outside@example.test','area','approved')`),
      ...users.map((id) => db.prepare(`INSERT INTO accounts(id,email_normalized,display_name,verified_at,state)
        VALUES (?,?,?,1,'active')`).bind(id, `${id}@example.test`, id)),
      ...users.map((id) => db.prepare("INSERT INTO account_contexts(id,account_id,role) VALUES (?,?,'customer')").bind(`${id}-customer`, id)),
      ...([['foreman', 'foreman'], ['recipient', 'foreman'], ['admin', 'provider_admin'], ['worker', 'worker']] as const).flatMap(([id, role]) => [
        db.prepare("INSERT INTO memberships VALUES (?,'business',?,'active')").bind(`${id}-member`, id),
        db.prepare(`INSERT INTO membership_roles(id,membership_id,business_id,account_id,role,granted_at)
          VALUES (?,?,'business',?,?,1)`).bind(`${id}-role`, `${id}-member`, id, role),
        db.prepare("INSERT INTO account_contexts VALUES (?,?,?,'business',?)").bind(`${id}-staff`, id, role, `${id}-role`),
      ]),
      ...await Promise.all(users.map(async (id) => {
        const credential = randomToken();
        credentials.set(id, credential);
        const contextId = ["owner", "other", "viewer"].includes(id) ? `${id}-customer` : `${id}-staff`;
        return db.prepare(`INSERT INTO sessions(id,account_id,secret_hash,active_context_id,device_id,issued_at,expires_at)
          VALUES (?,?,?,?,'device',1,?)`).bind(`${id}-session`, id, await hashSessionCredential(credential), contextId, now + 24 * 60 * minute);
      })),
      db.prepare(`INSERT INTO places(id,owner_id,alias,normalized_address,state) VALUES
        ('place','owner','Private alias','121 Private Street','pending_verification'),
        ('elsewhere','other','Elsewhere','99 Other Street','pending_verification')`),
      db.prepare(`INSERT INTO place_people(place_id,account_id,verified_from,history_from) VALUES
        ('place','owner',1,1),('elsewhere','other',1,1),('place','viewer',?,?)`).bind(old + 1, old + 1),
      db.prepare(`UPDATE places SET state='in_area', area_id='area', site_zone='Europe/Madrid',
        named_approver_id=owner_id, pin='{"latitude":0,"longitude":0}'`),
      db.prepare(`INSERT INTO place_grants(id,place_id,account_id,capability,issuer_id,valid_from) VALUES
        ('owner-approve','place','owner','approve','owner',1), ('viewer-view','place','viewer','view','owner',1)`),
      db.prepare(`INSERT INTO jobs(id,reference,business_id,place_id,requester_id,accountable_foreman_membership_id,origin,state) VALUES
        ('mine','BB-1','business','place','owner','foreman-member','bookbuddy','open'),
        ('unassigned','BB-2','business','place','owner',NULL,'bookbuddy','open'),
        ('not-mine','BB-3','business','elsewhere','other','recipient-member','bookbuddy','open'),
        ('other-provider','BB-4','outside','elsewhere','other',NULL,'bookbuddy','open')`),
      db.prepare(`INSERT INTO requests(job_id,original_text,original_language,arrival_arrangement,safe_note,submitted_at) VALUES
        ('mine','Door needs repair','en','requester','Private arrival note',?),
        ('unassigned','A new repair','en','to_be_arranged',NULL,?), ('not-mine','Elsewhere request','en','requester',NULL,?)`).bind(old, old + 2, old),
      db.prepare(`INSERT INTO job_handoffs(id,job_id,business_id,recipient_id,issuer_id,policy,offered_at,expires_at,state)
        VALUES ('offer','unassigned','business','recipient-member','admin','standard',?,?,'offered')`).bind(old + 3, expiry),
      db.prepare(`INSERT INTO job_grants(job_id,context_id,capability,valid_from,valid_until)
        VALUES ('unassigned','recipient-staff','intake',?,?)`).bind(old + 3, expiry),
      db.prepare(`INSERT INTO visits(id,job_id,kind,state) VALUES ('visit','mine','assessment','booked')`),
      db.prepare(`INSERT INTO visit_windows(id,visit_id,starts_at,ends_at,expires_at,provider_authorized,proposed_at,proposed_by,
        confirmed_at,confirmed_by,state) VALUES ('window','visit',?,?,?,1,?,'foreman',?,'owner','confirmed')`).bind(
        now + 5 * minute, now + 45 * minute, now + minute, old + minute, old + 2 * minute,
      ),
      db.prepare(`INSERT INTO terms_versions VALUES ('terms','business',1,'Provider Ltd','Terms','en','Consent','hash')`),
      db.prepare(`INSERT INTO quotes VALUES ('quote','unassigned')`),
      db.prepare(`INSERT INTO quote_versions(id,quote_id,job_id,business_id,no,author_id,terms_id,original_locale,scope,exclusions,
        net_minor,tax_minor,total_minor,currency,state) VALUES
        ('issued','quote','unassigned','business',1,'foreman','terms','en','Scope','',100,20,120,'EUR','draft'),
        ('internal','quote','unassigned','business',2,'foreman','terms','en','Private draft','',200,40,240,'EUR','draft')`),
      db.prepare(`UPDATE quote_versions SET state='issued', publisher_id='admin', issued_at=?, expires_at=? WHERE id='issued'`).bind(old + 5, expiry),
      db.prepare(`UPDATE quote_versions SET state='in_review' WHERE id='internal'`),
      db.prepare(`INSERT INTO commercial_reviews(id,quote_version_id,reviewer_id,backup_id,submitted_at,due_at,state)
        VALUES ('review','internal','admin','recipient',?,?,'pending')`).bind(old + 6, expiry),
      db.prepare(`INSERT INTO business_grants(id,business_id,membership_id,capability,issuer_id,valid_from) VALUES
        ('review-right','business','admin-member','review_commercial','foreman',1)`),
    ]);
  } catch (error) { db.close(); throw error; }

  async function request(path: string, user: User, body?: unknown) {
    const { batch, query } = db.calls;
    const response = await app.request(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${credentials.get(user)}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env, execution);
    expect(db.calls.batch - batch).toBe(1);
    expect(db.calls.query - query).toBe(0);
    if (body === undefined) expect(response.headers.get("cache-control")).toBe("private, no-store");
    return { status: response.status, body: await response.json() as unknown };
  }
  return { db, request };
}

test("customer pages honor current place access and history, publish only issued facts, and use site day in one D1 call", async () => {
  const date = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    const home = await f.request("/home?placeId=place", "owner");
    expect(resultSchema(getHomeRoute.output).parse(home.body)).toMatchObject({ data: { audience: "customer", liveVisits: [],
      upcoming: [{ jobId: "mine", journey: { step: "booked" } }], decisions: [{ jobId: "unassigned", kind: "review_quote", recordId: "issued" }] } });
    expect(JSON.stringify(home.body)).not.toMatch(/internal|Private draft|Private Street|Private arrival note/);
    const jobs = await f.request("/jobs", "owner");
    expect(resultSchema(getJobsRoute.output).parse(jobs.body)).toMatchObject({ data: { activeCount: 2,
      items: [{ jobId: "mine" }, { jobId: "unassigned" }] } });
    const detail = await f.request("/jobs/unassigned", "owner");
    expect(resultSchema(getJobRoute.output).parse(detail.body)).toMatchObject({ data: { job: { view: "whole", quote: { versionId: "issued" } } } });
    expect(JSON.stringify(detail.body)).not.toMatch(/internal|Private draft/);
    expect(resultSchema(getJobRoute.output).parse((await f.request("/jobs/mine?view=today", "owner")).body)).toMatchObject({ data: {
      job: { view: "today", visit: { status: "confirmed", step: null }, crewNames: [] },
    } });
    expect(await f.request("/jobs/not-mine", "owner")).toMatchObject({ status: 404, body: noAccess });
    expect(await f.request("/home?placeId=elsewhere", "owner")).toMatchObject({ status: 404, body: noAccess });
    expect(await f.request("/jobs/mine", "viewer")).toMatchObject({ status: 404, body: noAccess });
    expect((await f.request("/home", "viewer")).body).toMatchObject({ data: { decisions: [], recent: expect.arrayContaining([{ jobId: "unassigned", recordId: "issued", kind: "quote_issued", at: old + 5, by: "admin" }]) } });
    await f.db.prepare("UPDATE place_grants SET revoked_at = ? WHERE id = 'viewer-view'").bind(now).run();
    expect(await f.request("/jobs/unassigned", "viewer")).toMatchObject({ status: 404, body: noAccess });
    date.mockReturnValue(expiry);
    expect((await f.request("/home", "owner")).body).toMatchObject({ data: { decisions: [], liveVisits: [{ jobId: "mine" }] } });
  } finally { f.db.close(); date.mockRestore(); }
});

test("staff reads separate accountability, active intake, business oversight, and absent worker assignment", async () => {
  const date = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    const foreman = await f.request("/jobs", "foreman");
    expect(resultSchema(getJobsRoute.output).parse(foreman.body)).toMatchObject({ data: { audience: "foreman", activeCount: 1,
      list: { segment: "active", items: [{ jobId: "mine" }] } } });
    expect((await f.request("/home", "foreman")).body).toMatchObject({ data: { gaps: [], laterVisits: [{ jobId: "mine" }] } });
    expect(await f.request("/jobs/not-mine", "foreman")).toMatchObject({ status: 404, body: noAccess });
    expect(await f.request("/jobs/unassigned?view=intake", "foreman")).toMatchObject({ status: 404, body: noAccess });
    expect((await f.request("/jobs?segment=incoming", "recipient")).body).toMatchObject({ data: { incomingCount: 1,
      list: { segment: "incoming", items: [{ jobId: "unassigned", town: "Coarse area" }] } } });
    expect(await f.request("/jobs/unassigned", "recipient")).toMatchObject({ status: 404, body: noAccess });
    const intake = await f.request("/jobs/unassigned?view=intake", "recipient");
    expect(resultSchema(getJobRoute.output).parse(intake.body)).toMatchObject({ data: { job: { reply: "available", request: { originalText: "A new repair" } } } });
    expect(JSON.stringify(intake.body)).not.toMatch(/Private alias|Private Street|Private arrival note/);
    const admin = await f.request("/jobs", "admin");
    expect(resultSchema(getJobsRoute.output).parse(admin.body)).toMatchObject({ data: { audience: "provider_admin", activeCount: 3 } });
    expect((await f.request("/jobs?segment=needs_you", "admin")).body).toMatchObject({ data: { needsYouCount: 1, items: [{ jobId: "unassigned" }] } });
    expect((await f.request("/jobs/unassigned", "admin")).body).toMatchObject({ data: { job: { commercialReview: { versionId: "internal" }, accountableForeman: null } } });
    expect((await f.request("/home", "admin")).body).toMatchObject({ data: { overview: { handoffs: { offeredCount: 1, nextReplyAt: expiry },
      bills: { openCount: 0 }, nextVisit: { jobId: "mine" } } } });
    const overview = await f.request("/businesses/business/overview", "admin");
    expect(resultSchema(getBusinessOverviewRoute.output).parse(overview.body)).toMatchObject({ data: {
      unassignedCount: 1, commercialReviewCount: 1, handoffs: { offeredCount: 1, nextReplyAt: expiry },
    } });
    expect(await f.request("/businesses/business/overview", "foreman")).toMatchObject({ status: 404, body: noAccess });
    expect(await f.request("/businesses/outside/overview", "admin")).toMatchObject({ status: 404, body: noAccess });
    expect(await f.request("/jobs/other-provider", "admin")).toMatchObject({ status: 404, body: noAccess });
    expect((await f.request("/jobs", "worker")).body).toMatchObject({ data: { audience: "worker", items: [] } });
    expect(await f.request("/jobs/mine", "worker")).toMatchObject({ status: 404, body: noAccess });
    date.mockReturnValue(expiry);
    expect(await f.request("/jobs/unassigned?view=intake", "recipient")).toMatchObject({ status: 404, body: noAccess });
    expect((await f.request("/home", "admin")).body).toMatchObject({ data: { overview: { handoffs: { offeredCount: 0,
      stuck: [{ jobId: "unassigned", since: expiry, offeredTo: "recipient" }] } } } });
  } finally { f.db.close(); date.mockRestore(); }
});

test("job sync snapshots and deltas use the same live role predicates without exposing intake details", async () => {
  const date = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    const opening = await f.request("/sync", "recipient", { contextId: "recipient-staff", cursor: null, operations: [] });
    const result = resultSchema(syncRoute.output).parse(opening.body);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.data.upserts.map(({ kind, resourceId }) => [kind, resourceId])).toEqual([["job", "not-mine"], ["job_handoff", "offer"]]);
    expect(JSON.stringify(result.data.upserts)).not.toMatch(/Private alias|Private Street|A new repair|Private arrival note/);
    await f.db.prepare(`INSERT INTO sync_changes(kind,resource_id,partition_key,op,at) VALUES
      ('job','mine','recipient-staff','upsert',?),('job_handoff','offer','recipient-staff','upsert',?)`).bind(expiry, expiry).run();
    date.mockReturnValue(expiry);
    const delta = await f.request("/sync", "recipient", { contextId: "recipient-staff", cursor: result.data.cursor, operations: [] });
    expect(resultSchema(syncRoute.output).parse(delta.body)).toMatchObject({ data: { upserts: [], removals: [
      { kind: "job", resourceId: "mine" }, { kind: "job_handoff", resourceId: "offer" },
    ] } });
  } finally { f.db.close(); date.mockRestore(); }
});

test("bookings cursor advances within scope without dropping the live capsule", async () => {
  const date = spyOn(Date, "now").mockReturnValue(now + 10 * minute);
  const f = await fixture();
  try {
    await f.db.prepare(`WITH RECURSIVE seq(n) AS (VALUES (1) UNION ALL SELECT n + 1 FROM seq WHERE n < 50)
      INSERT INTO jobs(id, reference, business_id, place_id, requester_id, origin, state)
      SELECT 'queued-' || n, 'BB-Q' || n, 'business', 'place', 'owner', 'bookbuddy', 'open' FROM seq`).run();
    const first = resultSchema(getJobsRoute.output).parse((await f.request("/jobs", "owner")).body);
    if (!first.ok || first.data.audience !== "customer" || !first.data.page.cursor) throw new Error("Missing first page");
    expect(first.data.activeCount).toBe(52);
    expect(first.data.items).toHaveLength(50);
    expect(first.data.live?.jobId).toBe("mine");
    const second = resultSchema(getJobsRoute.output).parse((await f.request(`/jobs?cursor=${first.data.page.cursor}`, "owner")).body);
    if (!second.ok || second.data.audience !== "customer") throw new Error("Missing next page");
    expect(second.data.page).toEqual({ cursor: null, hasMore: false });
    expect(second.data.live?.jobId).toBe("mine");
    expect(new Set([...first.data.items, ...second.data.items].map((job) => job.jobId)).size).toBe(52);
  } finally { f.db.close(); date.mockRestore(); }
});
