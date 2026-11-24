import { expect, spyOn, test } from "bun:test";
import { getBusinessOverviewRoute, getHandoffRoute, getHomeRoute, getJobRoute, getJobsRoute, getVisitLiveRoute, resultSchema, syncRoute } from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential } from "../src/modules/auth/session";
import { createCursorCodec } from "../src/modules/sync/cursor";
import { createTestD1 } from "./d1";
import type { TestD1 } from "./d1";

const now = Date.UTC(2026, 10, 24, 23, 45);
const minute = 60_000;
const old = now - 60 * minute;
const expiry = now + 30 * minute;
const base = "https://bookbuddy.test/api/v1";
const execution = { waitUntil() {}, passThroughOnException() {} };
const noAccess = { ok: false, error: { code: "NOT_FOUND" } };
const syncSecret = "test-job-sync-cursor-key-more-than-32-chars";

const users = ["owner", "other", "viewer", "foreman", "recipient", "admin", "backup", "worker", "helper"] as const;
type User = typeof users[number];

async function fixture() {
  const db = await createTestD1();
  const app = createApp().onError((error) => { throw error; });
  const env = { DB: db, SYNC_CURSOR_HMAC_KEY: syncSecret } as unknown as Bindings;
  const credentials = new Map<User, string>();
  try {
    await db.batch([
      db.prepare("INSERT INTO operating_areas(id,name,site_zone,polygon) VALUES ('area','Coarse area','Europe/Madrid','[0]')"),
      db.prepare(`INSERT INTO businesses(id,legal_name,public_name,verified_work_contact,catchment_id,state) VALUES
        ('business','Provider Ltd','Provider','provider@example.test','area','approved'),
        ('outside','Outside Ltd','Outside','outside@example.test','area','approved')`),
      ...users.map((id) => db.prepare(`INSERT INTO accounts(id,email_normalized,display_name,verified_at,state)
        VALUES (?,?,?,1,'active')`).bind(id, `${id}@example.test`, id)),
      ...users.map((id) => db.prepare("INSERT INTO account_contexts(id,account_id,role) VALUES (?,?,'customer')").bind(`${id}-customer`, id)),
      ...([
        ["foreman", "foreman"], ["recipient", "foreman"], ["admin", "provider_admin"], ["backup", "provider_admin"], ["worker", "worker"],
        ["helper", "worker"],
      ] as const).flatMap(([id, role]) => [
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
        VALUES ('review','internal','admin','backup',?,?,'pending')`).bind(old + 6, expiry),
      db.prepare(`INSERT INTO business_grants(id,business_id,membership_id,capability,issuer_id,valid_from) VALUES
        ('review-right','business','admin-member','review_commercial','foreman',1),
        ('backup-right','business','backup-member','review_commercial','foreman',1)`),
      db.prepare(`INSERT INTO job_grants(job_id,context_id,capability,valid_from,valid_until) VALUES
        ('unassigned','admin-staff','reviewer',?,?), ('unassigned','backup-staff','backup',?,?)`)
        .bind(old, expiry + minute, old, expiry + minute),
    ]);
  } catch (error) { db.close(); throw error; }

  async function request(path: string, user: User, body?: unknown) {
    const { batch, query } = db.calls;
    const response = await app.request(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${credentials.get(user)}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env, execution);
    const exactLiveRead = body === undefined && path.startsWith("/visits/");
    expect(db.calls.batch - batch).toBe(exactLiveRead ? 0 : 1);
    expect(db.calls.query - query).toBe(exactLiveRead ? 1 : 0);
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

test("implicit customer home prioritizes only readable booked visits without changing explicit place scope", async () => {
  const date = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    await f.db.batch([
      f.db.prepare(`INSERT INTO places(id,owner_id,alias,normalized_address,state) VALUES
        ('a-idle','owner','Alternate','Alternate Street','pending_verification'),
        ('b-history','owner','History cutoff','History Street','pending_verification')`),
      f.db.prepare(`INSERT INTO place_people(place_id,account_id,verified_from,history_from) VALUES
        ('a-idle','owner',1,1), ('b-history','owner',1,?), ('b-history','other',1,1)`).bind(now - minute),
      f.db.prepare(`UPDATE places SET state='in_area', area_id='area', site_zone='Europe/Madrid',
        named_approver_id=owner_id, pin='{"latitude":0,"longitude":0}' WHERE id IN ('a-idle','b-history')`),
      f.db.prepare(`INSERT INTO jobs(id,reference,business_id,place_id,requester_id,origin,state) VALUES
        ('alternate','BB-5','business','a-idle','owner','bookbuddy','open'),
        ('before-access','BB-6','business','b-history','other','bookbuddy','open')`),
      f.db.prepare(`INSERT INTO requests(job_id,original_text,original_language,arrival_arrangement,submitted_at) VALUES
        ('alternate','Later visit','en','requester',?), ('before-access','Earlier requester','en','requester',?)`).bind(old, old),
      f.db.prepare(`INSERT INTO visits(id,job_id,kind,state) VALUES
        ('alt-visit','alternate','assessment','booked'), ('old-visit','before-access','assessment','booked'),
        ('outside-visit','not-mine','assessment','booked')`),
      f.db.prepare(`INSERT INTO visit_windows(id,visit_id,starts_at,ends_at,expires_at,provider_authorized,proposed_at,proposed_by,
        confirmed_at,confirmed_by,state) VALUES
        ('alt-window','alt-visit',?,?,?,1,?,'foreman',?,'owner','confirmed'),
        ('old-window','old-visit',?,?,?,1,?,'foreman',?,'owner','confirmed'),
        ('outside-window','outside-visit',?,?,?,1,?,'foreman',?,'other','confirmed')`).bind(
        now + 10 * minute, now + 30 * minute, now, old + minute, old + 2 * minute,
        now - minute, now + minute, now - minute, old + minute, old + 2 * minute,
        now - minute, now + minute, now - minute, old + minute, old + 2 * minute,
      ),
    ]);
    const home = async (path = "/home") => resultSchema(getHomeRoute.output).parse((await f.request(path, "owner")).body);
    expect(await home()).toMatchObject({ data: {
      place: { placeId: "place" }, liveVisits: [], upcoming: [{ jobId: "mine" }],
    } });
    expect(await home("/home?placeId=a-idle")).toMatchObject({ data: { place: { placeId: "a-idle" }, upcoming: [{ jobId: "alternate" }] } });
    expect(await home("/home?placeId=b-history")).toMatchObject({ data: { place: { placeId: "b-history" }, liveVisits: [], upcoming: [], recent: [] } });
    expect(await f.request("/home?placeId=elsewhere", "owner")).toMatchObject({ status: 404, body: noAccess });
    date.mockReturnValue(now + 6 * minute);
    expect(await home()).toMatchObject({ data: { place: { placeId: "place" }, liveVisits: [{ jobId: "mine" }] } });
    date.mockReturnValue(now + 11 * minute);
    expect(await home()).toMatchObject({ data: { place: { placeId: "a-idle" }, liveVisits: [{ jobId: "alternate" }] } });
    date.mockReturnValue(now + 46 * minute);
    expect(await home()).toMatchObject({ data: { place: { placeId: "a-idle" }, liveVisits: [], upcoming: [] } });
  } finally { f.db.close(); date.mockRestore(); }
});

test("whole-job visit summary selects the site-day visit and is only visible to its requester", async () => {
  const date = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    const start = now + 5 * minute, end = now + 15 * minute;
    await f.db.batch([
      f.db.prepare("UPDATE place_people SET history_from = ? WHERE place_id = 'place' AND account_id = 'viewer'").bind(old),
      f.db.prepare(`INSERT INTO customer_updates (id, visit_id, actor_id, kind, band_start, band_end, recorded_at)
        VALUES ('travel', 'visit', 'foreman', 'on_the_way', ?, ?, ?)`).bind(start, end, now),
    ]);
    const summary = { visitId: "visit", status: "on_the_way", step: "on_the_way", arrivalWindow: { start, end, siteZone: "Europe/Madrid" },
      source: { at: now, sharedByName: "foreman" } };
    const mine = await f.request("/jobs/mine", "owner");
    expect(mine.body).toMatchObject({ data: { audience: "customer", job: { view: "whole", hasTodayView: true, visit: summary } } });
    expect(resultSchema(getJobRoute.output).parse(mine.body)).toMatchObject({ data: { job: { visit: summary } } });
    const viewer = await f.request("/jobs/mine", "viewer");
    expect(viewer.body).toMatchObject({ data: { audience: "customer", job: { view: "whole", hasTodayView: true, todayVisitId: "visit" } } });
    expect(viewer.body).not.toHaveProperty("data.job.visit");
    const staff = await f.request("/jobs/mine", "foreman");
    expect(staff.body).toMatchObject({ data: { audience: "foreman", job: { view: "whole" } } });
    expect(staff.body).not.toHaveProperty("data.job.visit");
    date.mockReturnValue(end);
    expect((await f.request("/jobs/mine", "owner")).body).toMatchObject({ data: { job: {
      visit: { status: null, step: null, arrivalWindow: null, source: summary.source },
    } } });
    date.mockReturnValue(now - 2 * 60 * minute);
    const earlier = await f.request("/jobs/mine", "owner");
    expect(earlier.body).toMatchObject({ data: { job: { hasTodayView: false } } });
    expect(earlier.body).not.toHaveProperty("data.job.visit");
    expect(earlier.body).not.toHaveProperty("data.job.todayVisitId");
  } finally { f.db.close(); date.mockRestore(); }
});

test("Now identifies the selected visit even when an earlier same-day visit is still unfinished", async () => {
  const midday = Date.UTC(2026, 10, 25, 11);
  const laterStart = midday + 120 * minute, laterEnd = laterStart + 60 * minute;
  const clock = spyOn(Date, "now").mockReturnValue(midday);
  const f = await fixture();
  try {
    await f.db.batch([
      f.db.prepare("UPDATE visit_windows SET starts_at = ?, ends_at = ? WHERE id = 'window'").bind(laterStart, laterEnd),
      f.db.prepare("INSERT INTO visits (id, job_id, kind, state) VALUES ('morning', 'mine', 'work', 'booked')"),
      f.db.prepare(`INSERT INTO visit_windows (id, visit_id, starts_at, ends_at, expires_at, provider_authorized, proposed_at,
        proposed_by, confirmed_at, confirmed_by, state) VALUES ('morning-window', 'morning', ?, ?, ?, 1, ?, 'foreman', ?, 'owner', 'confirmed')`)
        .bind(midday - 180 * minute, midday - 120 * minute, now + minute, old + minute, old + 2 * minute),
    ]);
    const home = async () => resultSchema(getHomeRoute.output).parse((await f.request("/home?placeId=place", "owner")).body);
    expect(await home()).toMatchObject({ data: { liveVisits: [], upcoming: [{
      jobId: "mine", nextVisit: { visitId: "visit", window: { startsAt: laterStart, endsAt: laterEnd } },
    }] } });
    expect((await f.request("/jobs/mine", "owner")).body).toMatchObject({ data: { job: {
      nextVisit: { visitId: "visit" }, todayVisitId: "morning", visit: { visitId: "morning" },
    } } });
    const exact = await f.request("/visits/visit/live", "owner");
    expect(resultSchema(getVisitLiveRoute.output).parse(exact.body)).toMatchObject({ data: {
      visitId: "visit", window: { startsAt: laterStart, endsAt: laterEnd },
    } });
    expect(await f.request("/visits/visit/live", "other")).toMatchObject({ status: 404, body: noAccess });
    clock.mockReturnValue(laterStart);
    expect(await home()).toMatchObject({ data: { upcoming: [], liveVisits: [{ jobId: "mine", visit: { visitId: "visit" } }] } });
  } finally { f.db.close(); clock.mockRestore(); }
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
    const byHandoff = await f.request("/handoffs/offer", "recipient");
    expect(byHandoff.status).toBe(200);
    const direct = resultSchema(getHandoffRoute.output).parse(byHandoff.body);
    const legacy = resultSchema(getJobRoute.output).parse(intake.body);
    if (!direct.ok || !legacy.ok) throw new Error("Expected both intake views");
    expect(direct.data).toEqual(legacy.data);
    for (const reader of ["foreman", "admin", "owner", "worker"] as const) {
      expect(await f.request("/handoffs/offer", reader)).toMatchObject({ status: 404, body: noAccess });
    }
    expect(await f.request("/handoffs/unknown", "recipient")).toMatchObject({ status: 404, body: noAccess });
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
    expect(await f.request("/handoffs/offer", "recipient")).toMatchObject({ status: 404, body: noAccess });
    expect((await f.request("/home", "admin")).body).toMatchObject({ data: { overview: { handoffs: { offeredCount: 0,
      stuck: [{ jobId: "unassigned", since: expiry, offeredTo: "recipient" }] } } } });
  } finally { f.db.close(); date.mockRestore(); }
});

test("private review detail and counts recheck the exact job grant and backup deadline", async () => {
  const date = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    await f.db.prepare(`UPDATE job_grants SET revoked_at = ?
      WHERE job_id = 'unassigned' AND context_id = 'admin-staff' AND capability = 'reviewer'`).bind(now).run();
    for (const reader of ["admin", "backup"] as const) {
      expect((await f.request("/jobs/unassigned", reader)).body).toMatchObject({ data: { job: { commercialReview: null } } });
      expect((await f.request("/businesses/business/overview", reader)).body).toMatchObject({ data: { commercialReviewCount: 0 } });
    }
    date.mockReturnValue(expiry);
    expect((await f.request("/jobs/unassigned", "backup")).body).toMatchObject({ data: { job: { commercialReview: { versionId: "internal" } } } });
    expect((await f.request("/businesses/business/overview", "backup")).body).toMatchObject({ data: { commercialReviewCount: 1 } });
    date.mockReturnValue(expiry + minute);
    expect((await f.request("/jobs/unassigned", "backup")).body).toMatchObject({ data: { job: { commercialReview: null } } });
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
    await f.db.batch([
      f.db.prepare("UPDATE job_grants SET revoked_at = ? WHERE context_id = 'recipient-staff' AND capability = 'intake'").bind(now + 1),
      f.db.prepare(`INSERT INTO sync_changes(kind,resource_id,partition_key,op,at) VALUES
        ('job','mine','recipient-staff','upsert',?),('job_handoff','offer','recipient-staff','upsert',?)`).bind(now + 1, now + 1),
    ]);
    date.mockReturnValue(now + 1);
    const delta = await f.request("/sync", "recipient", { contextId: "recipient-staff", cursor: result.data.cursor, operations: [] });
    expect(resultSchema(syncRoute.output).parse(delta.body)).toMatchObject({ data: { upserts: [], removals: [
      { kind: "job", resourceId: "mine" }, { kind: "job_handoff", resourceId: "offer" },
    ] } });
  } finally { f.db.close(); date.mockRestore(); }
});

test("a clean delta resets the scope exactly when a backup foreman's grant expires", async () => {
  const date = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  const deadline = now + minute;
  try {
    await f.db.batch([
      f.db.prepare(`INSERT INTO job_grants(job_id,context_id,capability,valid_from,valid_until)
        VALUES ('mine','recipient-staff','backup',1,?)`).bind(deadline + minute),
      f.db.prepare(`INSERT INTO business_grants(id,business_id,membership_id,capability,issuer_id,valid_from,valid_until)
        VALUES ('timed-backup','business','recipient-member','backup_foreman','admin',1,?)`).bind(deadline),
    ]);
    async function sync(cursor: string | null) {
      const response = await f.request("/sync", "recipient", { contextId: "recipient-staff", cursor, operations: [] });
      const envelope = resultSchema(syncRoute.output).parse(response.body);
      if (!envelope.ok) throw new Error(`Sync failed: ${envelope.error.code}`);
      return envelope.data;
    }
    const initial = await sync(null);
    expect(initial.upserts).toContainEqual(expect.objectContaining({ kind: "job", resourceId: "mine" }));
    const codec = await createCursorCodec(syncSecret);
    expect(await codec.read(initial.cursor)).toMatchObject({ phase: "delta", nextExpiry: deadline });
    date.mockReturnValue(deadline - 1);
    const clean = await sync(initial.cursor);
    expect(clean).toMatchObject({ mode: "delta", upserts: [], removals: [] });
    date.mockReturnValue(deadline);
    const reset = await sync(clean.cursor);
    expect(reset).toMatchObject({ mode: "reset", removals: [{ kind: "scope", resourceId: "recipient-staff" }] });
    expect(reset.upserts.filter(({ kind }) => kind === "job").map(({ resourceId }) => resourceId)).toEqual(["not-mine"]);
    expect(await codec.read(reset.cursor)).toMatchObject({ nextExpiry: deadline + minute });
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

test("handoff lookup permits the accountable foreman without granting a reply belonging to the recipient", async () => {
  const date = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    await f.db.batch([
      f.db.prepare(`INSERT INTO job_handoffs(id,job_id,business_id,incumbent_id,recipient_id,issuer_id,policy,offered_at,expires_at,state)
        VALUES ('transfer','mine','business','foreman-member','recipient-member','admin','standard',?,?,'offered')`).bind(old, expiry),
      f.db.prepare(`INSERT INTO job_grants(job_id,context_id,capability,valid_from,valid_until)
        VALUES ('mine','recipient-staff','intake',?,?)`).bind(old, expiry),
      f.db.prepare(`INSERT INTO link_targets(token,kind,resource_id,required_scope,expires_at)
        VALUES ('transfer-token','job_handoff','transfer','recipient-staff',?)`).bind(expiry),
    ]);
    const incumbent = await f.request("/handoffs/transfer", "foreman");
    expect(incumbent).toMatchObject({ status: 200, body: { data: { job: { jobId: "mine", reply: "closed_elsewhere",
      handoff: { handoffId: "transfer", state: "offered" }, request: { originalText: "Door needs repair" } } } } });
    expect(JSON.stringify(incumbent.body)).not.toMatch(/Private alias|Private Street|Private arrival note/);
    expect((await f.request("/handoffs/transfer", "recipient")).body).toMatchObject({ data: { job: { reply: "available" } } });
    expect((await f.request("/links/transfer-token", "recipient")).body).toMatchObject({
      data: { kind: "job", record: { job: { reply: "available" } } },
    });
    await f.db.prepare("UPDATE job_grants SET revoked_at = ? WHERE job_id = 'mine' AND capability = 'intake'").bind(now).run();
    expect(await f.request("/handoffs/transfer", "recipient")).toMatchObject({ status: 404, body: noAccess });
    await f.db.batch([
      f.db.prepare("UPDATE job_handoffs SET state = 'accepted', ended_at = ? WHERE id = 'transfer'").bind(now),
      f.db.prepare("UPDATE jobs SET accountable_foreman_membership_id = 'recipient-member' WHERE id = 'mine'"),
    ]);
    expect(await f.request("/handoffs/transfer", "foreman")).toMatchObject({ status: 404, body: noAccess });
    expect((await f.request("/handoffs/transfer", "recipient")).body).toMatchObject({
      data: { job: { reply: "closed", handoff: { state: "accepted" } } },
    });
    expect((await f.request("/links/transfer-token", "recipient")).body).toMatchObject({
      data: { kind: "unavailable", reason: "removed" },
    });
  } finally { f.db.close(); date.mockRestore(); }
});

async function approveMine(db: TestD1) {
  await db.batch([
    db.prepare("INSERT INTO quotes VALUES ('mine-quote','mine')"),
    db.prepare(`INSERT INTO quote_versions(id,quote_id,job_id,business_id,no,author_id,terms_id,original_locale,scope,exclusions,
      net_minor,tax_minor,total_minor,currency,state) VALUES
      ('mine-base','mine-quote','mine','business',1,'foreman','terms','en','Scope','',100,20,120,'EUR','draft')`),
    db.prepare(`UPDATE quote_versions SET state='issued', publisher_id='admin', issued_at=?, expires_at=? WHERE id='mine-base'`)
      .bind(old + 4, expiry),
    db.prepare(`INSERT INTO approvals(id,quote_version_id,account_id,grant_id,terms_hash,decision,at)
      VALUES ('mine-approval','mine-base','owner','owner-approve','hash','approve',?)`).bind(old + 5),
    db.prepare("UPDATE quote_versions SET state='approved' WHERE id='mine-base'"),
  ]);
}

test("whole job exposes attributed decisions and only confirmed crew facts to the customer", async () => {
  const date = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    await approveMine(f.db);
    const start = now + 5 * minute, end = now + 45 * minute;
    await f.db.batch([
      f.db.prepare(`INSERT INTO shifts(id,visit_id,starts_at,ends_at,skill,briefing_language,state)
        VALUES ('shift','visit',?,?,'door repair','en','planned')`).bind(start, end),
      f.db.prepare(`INSERT INTO shift_slots(id,shift_id,number,is_lead)
        VALUES ('lead-slot','shift',1,1), ('helper-slot','shift',2,0)`),
      f.db.prepare(`INSERT INTO assignment_offers(id,slot_id,recipient_id,issued_by,issued_at,expires_at,state)
        VALUES ('lead-offer','lead-slot','worker-member','foreman',?,?,'offered')`).bind(old, start),
      f.db.prepare(`INSERT INTO change_proposals VALUES ('change','mine','mine-base')`),
      f.db.prepare(`INSERT INTO change_versions(id,proposal_id,job_id,business_id,no,author_id,terms_id,original_locale,original_text,
        delta_minor,total_minor,timing,affected_items,created_at,state) VALUES
        ('private-change','change','mine','business',1,'foreman','terms','en','Private revision',10,130,'Same visit','Door',?,'draft')`).bind(old + 7),
      f.db.prepare("UPDATE change_versions SET state = 'in_review' WHERE id = 'private-change'"),
      f.db.prepare(`INSERT INTO commercial_reviews(id,change_version_id,reviewer_id,backup_id,submitted_at,due_at,state)
        VALUES ('change-review','private-change','admin','backup',?,?,'pending')`).bind(old + 8, expiry),
    ]);
    const before = await f.request("/jobs/mine", "owner");
    expect(before.body).toMatchObject({ data: { job: { crew: null, foremanName: null, cancellation: null, change: null,
      quote: { versionId: "mine-base", state: "approved", sent: { at: old + 4, by: "admin" }, approved: { at: old + 5, by: "owner" } },
    } } });
    expect(JSON.stringify(before.body)).not.toMatch(/worker|helper|private-change|Private revision|lead-slot|change_in_review|crew_gap|vacantSlotId/);
    const shifts = [{ shiftId: "shift", slotIds: ["lead-slot", "helper-slot"] }];
    expect((await f.request("/jobs/mine", "foreman")).body).toMatchObject({ data: { job: {
      visits: [{ visitId: "visit", shifts, vacantSlotId: "helper-slot" }], nextStep: { kind: "assign_crew", recordId: "shift" }, flags: ["crew_gap"],
      quote: { versionId: "mine-base", no: 1, state: "approved" }, change: { versionId: "private-change", no: 1, state: "in_review" },
      bill: { state: "none", total: null }, history: { items: expect.arrayContaining([
        { jobId: "mine", recordId: "private-change", kind: "change_in_review", at: old + 8, by: "foreman" },
      ]) },
    } } });
    expect((await f.request("/jobs/mine?view=today", "foreman")).body).toMatchObject({ data: { job: {
      visit: { visitId: "visit", shifts, vacantSlotId: "helper-slot" }, nextStep: { kind: "assign_crew", recordId: "shift" },
    } } });
    await f.db.batch([
      f.db.prepare(`INSERT INTO assignments(id,slot_id,worker_membership_id,source,state,confirmed_by,confirmed_at,starts_at,ends_at)
        VALUES ('lead-assignment','lead-slot','worker-member','ordinary','confirmed','worker',?,?,?),
          ('helper-assignment','helper-slot','helper-member','ordinary','confirmed','helper',?,?,?)`).bind(now, start, end, now, start, end),
      f.db.prepare(`UPDATE assignment_offers SET state = 'confirmed', assignment_id = 'lead-assignment', resolved_at = ? WHERE id = 'lead-offer'`).bind(now),
    ]);
    const confirmed = await f.request("/jobs/mine", "owner");
    expect(confirmed.body).toMatchObject({ data: { job: { crew: { leadName: "worker", count: 2 } } } });
    expect(JSON.stringify(confirmed.body)).not.toMatch(/helper|lead-slot|lead-assignment|private-change/);
    expect((await f.request("/jobs/mine", "foreman")).body).toMatchObject({ data: { job: {
      nextStep: { kind: "visit", recordId: "visit" }, visits: [{ vacantSlotId: null }], flags: [],
    } } });
    await f.db.batch([
      f.db.prepare(`UPDATE assignments SET state = 'dropped', dropped_at = ?, dropout_source = 'self',
        dropout_reported_by = 'helper' WHERE id = 'helper-assignment'`).bind(now),
      f.db.prepare(`INSERT INTO cover_gaps (id, slot_id, prior_assignment_id, safe_cutoff, state)
        VALUES ('cover', 'helper-slot', 'helper-assignment', ?, 'open')`).bind(start),
    ]);
    expect((await f.request("/jobs", "foreman")).body).toMatchObject({ data: { list: { items: [{ jobId: "mine", flags: ["crew_gap"] }] } } });
    await f.db.prepare(`UPDATE cover_gaps SET state = 'closed', closed_at = ? WHERE id = 'cover'`).bind(now).run();
    expect((await f.request("/jobs/mine", "foreman")).body).toMatchObject({ data: { job: {
      visits: [{ vacantSlotId: null }], nextStep: { kind: "visit" }, flags: ["crew_gap"],
    } } });
    date.mockReturnValue(end);
    expect((await f.request("/jobs/mine", "foreman")).body).toMatchObject({ data: { job: { flags: [] } } });
  } finally { f.db.close(); date.mockRestore(); }
});

test("foreman job cards flag only active problem cases with a live viewer grant", async () => {
  const date = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    await f.db.prepare(`INSERT INTO problem_cases (id, job_id, reference, reporter_id, case_owner_id, category, provider_audience,
      state, opened_at, acknowledge_by, first_update_by, next_update_at) VALUES
      ('private-case', 'mine', 'BB-PC1', 'owner', 'other', 'timing', NULL, 'open', 1, 2, 3, 2),
      ('crew-case', 'mine', 'BB-PC2', 'owner', 'other', 'quality', 'provider_rectification', 'open', 1, 2, 3, 2)`).run();
    expect((await f.request("/jobs/mine", "foreman")).body).toMatchObject({ data: { job: { flags: [] } } });
    await f.db.prepare(`INSERT INTO case_grants (case_id, context_id, capability, valid_from, valid_until)
      VALUES ('crew-case', 'foreman-staff', 'provider_rectification', 1, ?)`).bind(expiry).run();
    const card = { jobId: "mine", flags: ["open_problem"] };
    expect((await f.request("/jobs", "foreman")).body).toMatchObject({ data: { list: { items: [card] } } });
    expect((await f.request("/home", "foreman")).body).toMatchObject({ data: { laterVisits: [card] } });
    expect((await f.request("/jobs/mine", "foreman")).body).toMatchObject({ data: { job: card } });
    expect(JSON.stringify((await f.request("/jobs/mine", "owner")).body)).not.toMatch(/open_problem|crew-case|private-case/);
    await f.db.prepare(`UPDATE problem_cases SET state = 'awaiting_plan' WHERE id = 'crew-case'`).run();
    expect((await f.request("/jobs/mine", "foreman")).body).toMatchObject({ data: { job: card } });
    date.mockReturnValue(expiry);
    expect((await f.request("/jobs/mine", "foreman")).body).toMatchObject({ data: { job: { flags: [] } } });
  } finally { f.db.close(); date.mockRestore(); }
});

test("whole-job history uses a stable cursor at tied timestamps for customers and foremen", async () => {
  const date = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    await f.db.prepare(`WITH RECURSIVE seq(n) AS (VALUES (1) UNION ALL SELECT n + 1 FROM seq WHERE n < 51)
      INSERT INTO visits(id,job_id,kind,state,cancelled_at,cancelled_by)
      SELECT 'cancel-' || n, 'mine', 'assessment', 'cancelled', ?, 'owner' FROM seq`).bind(now - 1).run();
    for (const actor of ["owner", "foreman"] as const) {
      const first = resultSchema(getJobRoute.output).parse((await f.request("/jobs/mine", actor)).body);
      if (!first.ok || first.data.audience === "worker" || first.data.audience === "provider_admin"
        || first.data.job.view !== "whole" || !first.data.job.history?.page.cursor) throw new Error("Missing job history cursor");
      const history = first.data.job.history;
      expect(history.items).toHaveLength(50);
      expect(history.page.hasMore).toBe(true);
      expect(history.items[0]).toMatchObject({ kind: "cancelled", at: now - 1, by: "owner" });
      if (first.data.audience === "customer") expect(first.data.job).toMatchObject({ cancellation: { at: now - 1, by: "owner" } });
      const second = resultSchema(getJobRoute.output).parse((await f.request(`/jobs/mine?cursor=${history.page.cursor}`, actor)).body);
      if (!second.ok || second.data.audience === "worker" || second.data.audience === "provider_admin"
        || second.data.job.view !== "whole" || !second.data.job.history) throw new Error("Missing remaining job history");
      expect(second.data.job.history.page).toEqual({ hasMore: false, cursor: null });
      const all = [...history.items, ...second.data.job.history.items];
      expect(new Set(all.map(({ kind, recordId }) => `${kind}:${recordId}`)).size).toBe(53);
      expect(all).toHaveLength(53);
    }
  } finally { f.db.close(); date.mockRestore(); }
});

test("foreman bill status follows the current invoice and attributed payment corrections", async () => {
  const date = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    await approveMine(f.db);
    const total = { minor: 120, currency: "EUR" };
    await f.db.prepare(`INSERT INTO completions(id,job_id,base_quote_version_id,no,submitter_id,finished_at,submitted_at,bill_reference_hint,bill_amount_minor,bill_hint_by,state)
      VALUES ('wrap','mine','mine-base',1,'foreman',?,?,'Private bill draft reference',120,'foreman','submitted')`).bind(old + 6, old + 7).run();
    expect((await f.request("/jobs/mine", "foreman")).body).toMatchObject({ data: { job: { bill: { state: "draft", total } } } });
    await f.db.batch([
      f.db.prepare(`INSERT INTO bills(id,job_id,business_id,number,version,net_minor,tax_minor,total_minor,currency,provider_document_ref,
        payment_instructions,line_items,issued_at,due_at,state) VALUES ('bill','mine','business','INV-1',1,100,20,120,'EUR','private-document',
        '{"instructions":"private-transfer"}','[{"originalLabel":"Door","originalLanguage":"en","netMinor":100,"taxMinor":20}]',?,?,'issued')`).bind(old + 8, expiry),
      f.db.prepare(`INSERT INTO business_grants(id,business_id,membership_id,capability,issuer_id,valid_from)
        VALUES ('records-payment','business','admin-member','record_paid','admin',1)`),
    ]);
    expect((await f.request("/jobs/mine", "foreman")).body).toMatchObject({ data: { job: { bill: { state: "sent", total }, flags: ["unpaid_bill"] } } });
    expect((await f.request("/jobs", "foreman")).body).toMatchObject({ data: { list: { items: [{ flags: ["unpaid_bill"] }] } } });
    await f.db.prepare(`INSERT INTO paid_records(id,bill_id,actor_id,kind,amount_minor,verified_reference,at)
      VALUES ('matched','bill','admin','matched',120,'private-bank-reference',?)`).bind(old + 9).run();
    const paid = await f.request("/jobs/mine", "foreman");
    expect(paid.body).toMatchObject({ data: { job: { bill: { state: "paid_recorded", total }, flags: [], history: { items: expect.arrayContaining([
      { jobId: "mine", recordId: "matched", kind: "paid", at: old + 9, by: "admin" },
    ]) } } } });
    expect(JSON.stringify(paid.body)).not.toMatch(/Private bill draft reference|private-document|private-transfer|private-bank-reference/);
    await f.db.prepare(`INSERT INTO paid_records(id,bill_id,actor_id,kind,prior_id,reason,at)
      VALUES ('correction','bill','admin','corrected','matched','Wrong transfer',?)`).bind(old + 10).run();
    expect((await f.request("/jobs/mine", "foreman")).body).toMatchObject({ data: { job: { bill: { state: "sent", total },
      history: { items: expect.arrayContaining([{ jobId: "mine", recordId: "correction", kind: "payment_corrected", at: old + 10, by: "admin" }]) },
    } } });
    const publicJob = await f.request("/jobs/mine", "owner");
    expect(publicJob.body).toMatchObject({ data: { job: { bill: null } } });
    expect(JSON.stringify(publicJob.body)).not.toMatch(/private-bank-reference|private-transfer|payment_corrected|bill_issued/);
  } finally { f.db.close(); date.mockRestore(); }
});
