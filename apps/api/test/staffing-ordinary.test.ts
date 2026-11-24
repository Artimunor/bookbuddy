import { expect, spyOn, test } from "bun:test";
import { operationIdHeader } from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential } from "../src/modules/auth/session";
import { createTestD1 } from "./d1";

const origin = "https://bookbuddy.test";
const minute = 60_000;
const base = Date.UTC(2026, 10, 24, 8);
const start = base + 60 * minute;
const end = start + 60 * minute;
const roles = { customer: "customer", foreman: "foreman", admin: "provider_admin", rival: "foreman",
  worker: "worker", second: "worker", expiring: "worker", foreign: "worker" } as const;
type Actor = keyof typeof roles;

async function fixture() {
  const db = await createTestD1();
  const app = createApp().onError((error) => { throw error; });
  const actors = await Promise.all((Object.keys(roles) as Actor[]).map(async (actor) => {
    const token = randomToken();
    return { actor, token, hash: await hashSessionCredential(token) };
  }));
  const wakeKeys: string[][] = [];
  const env = { DB: db, EFFECTS: { async send({ workKeys }: { workKeys: string[] }) { wakeKeys.push(workKeys); } } } as unknown as Bindings;
  const execution = { waitUntil() {}, passThroughOnException() {} };
  try {
    await db.batch([
      db.prepare("INSERT INTO operating_areas (id, name, site_zone, polygon) VALUES ('area', 'Coarse town', 'Europe/Madrid', '[0]')"),
      db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state) VALUES
        ('provider', 'Provider LLC', 'Provider', 'provider@example.test', 'area', 'approved'),
        ('other', 'Other LLC', 'Other', 'other@example.test', 'area', 'approved')`),
      ...actors.flatMap(({ actor, hash }) => {
        const role = roles[actor], business = actor === "foreign" ? "other" : "provider";
        return [
          db.prepare("INSERT INTO accounts (id, email_normalized, display_name, verified_at, state) VALUES (?, ?, ?, 1, 'active')")
            .bind(actor, `${actor}@example.test`, `${actor} name`),
          ...role === "customer" ? [db.prepare("INSERT INTO account_contexts (id, account_id, role) VALUES ('customer-context', 'customer', 'customer')")]
            : [db.prepare("INSERT INTO memberships VALUES (?, ?, ?, 'active')").bind(`${actor}-member`, business, actor),
              db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at)
                VALUES (?, ?, ?, ?, ?, 1)`).bind(`${actor}-role`, `${actor}-member`, business, actor, role),
              db.prepare("INSERT INTO account_contexts VALUES (?, ?, ?, ?, ?)")
                .bind(`${actor}-context`, actor, role, business, `${actor}-role`)],
          db.prepare(`INSERT INTO sessions (id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
            VALUES (?, ?, ?, ?, 'device', 1, ?)`).bind(`${actor}-session`, actor, hash, `${actor}-context`, end + 60 * minute),
        ];
      }),
      db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state)
        VALUES ('place', 'customer', 'Private alias', 'Private address', 'pending_verification')`),
      db.prepare("INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES ('place', 'customer', 1, 1)"),
      db.prepare(`UPDATE places SET state = 'in_area', named_approver_id = 'customer', area_id = 'area', site_zone = 'Europe/Madrid',
        pin = '{"latitude":0,"longitude":0}' WHERE id = 'place'`),
      db.prepare(`INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, valid_from)
        VALUES ('approve', 'place', 'customer', 'approve', 'customer', 1)`),
      db.prepare(`INSERT INTO jobs (id, reference, business_id, place_id, requester_id, accountable_foreman_membership_id, trade, origin, state)
        VALUES ('job', 'BB-ABC', 'provider', 'place', 'customer', 'foreman-member', 'carpentry', 'provider', 'open')`),
      db.prepare("INSERT INTO requests (job_id, original_text, arrival_arrangement, submitted_at) VALUES ('job', 'Private scope', 'requester', 1)"),
      db.prepare("INSERT INTO terms_versions VALUES ('terms', 'provider', 1, 'Provider', 'Terms', 'en', 'Consent', 'hash')"),
      db.prepare("INSERT INTO quotes VALUES ('quote', 'job')"),
      db.prepare(`INSERT INTO quote_versions (id, quote_id, job_id, business_id, no, author_id, terms_id, original_locale,
        scope, exclusions, net_minor, tax_minor, total_minor, currency, state)
        VALUES ('version', 'quote', 'job', 'provider', 1, 'foreman', 'terms', 'en', 'Private scope', 'None', 200, 40, 240, 'EUR', 'draft')`),
      db.prepare("UPDATE quote_versions SET publisher_id = 'admin', issued_at = 2, expires_at = ?, state = 'issued' WHERE id = 'version'").bind(end),
      db.prepare(`INSERT INTO approvals (id, quote_version_id, account_id, grant_id, terms_hash, decision, at)
        VALUES ('approval', 'version', 'customer', 'approve', 'hash', 'approve', 3)`),
      db.prepare("UPDATE quote_versions SET state = 'approved' WHERE id = 'version'"),
      db.prepare("INSERT INTO visits (id, job_id, kind, state) VALUES ('visit', 'job', 'work', 'booked')"),
      db.prepare(`INSERT INTO visit_windows (id, visit_id, starts_at, ends_at, expires_at, provider_authorized, proposed_at, proposed_by,
        confirmed_at, confirmed_by, state) VALUES ('booked', 'visit', ?, ?, ?, 1, 3, 'foreman', 4, 'customer', 'confirmed')`).bind(start, end, start),
      db.prepare(`INSERT INTO shifts (id, visit_id, starts_at, ends_at, skill, briefing_language, state)
        VALUES ('shift', 'visit', ?, ?, 'carpentry', 'es', 'planned')`).bind(start, end),
      db.prepare("INSERT INTO shift_slots (id, shift_id, number, is_lead) VALUES ('slot', 'shift', 1, 1), ('other-slot', 'shift', 2, 0)"),
      ...(["worker", "second", "expiring", "foreign"] as const).flatMap((actor) => [
        db.prepare("INSERT INTO member_skills VALUES (?, 'carpentry')").bind(`${actor}-member`),
        db.prepare("INSERT INTO member_languages VALUES (?, 'es')").bind(`${actor}-member`),
        db.prepare(`INSERT INTO eligibility_checks (id, business_id, membership_id, trade, work_language, scope, state, checked_by, checked_at, valid_until)
          VALUES (?, ?, ?, 'carpentry', 'es', 'internal', 'approved', 'admin', 5, ?)`)
          .bind(`${actor}-check`, actor === "foreign" ? "other" : "provider", `${actor}-member`, actor === "expiring" ? end - 1 : end),
        db.prepare(`INSERT INTO availability_intervals (id, membership_id, week_day_or_date, starts_at, ends_at, kind, source,
          open_to_cover, recorded_by, recorded_at) VALUES (?, ?, '2026-11-24', ?, ?, 'available', 'worker', 1, ?, 6)`)
          .bind(`${actor}-hours`, `${actor}-member`, base - minute, end + minute, actor),
      ]),
    ]);
  } catch (error) {
    db.close();
    throw error;
  }
  let clock = base;
  const now = spyOn(Date, "now").mockImplementation(() => clock);
  async function call(actor: Actor, path: string, operationId?: string, payload = {}) {
    const { batch, query } = db.calls;
    const response = await app.request(`${origin}/api/v1${path}`, {
      method: operationId ? "POST" : "GET",
      headers: { Authorization: `Bearer ${actors.find((a) => a.actor === actor)!.token}`,
        ...(operationId ? { "Content-Type": "application/json", [operationIdHeader]: operationId } : {}) },
      body: operationId && JSON.stringify({ operationId, payload }),
    }, env, execution);
    const batches = db.calls.batch - batch;
    const reads = db.calls.query - query;
    expect(batches + reads).toBe(1);
    if (operationId) expect(batches).toBe(1);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    return { status: response.status, body: await response.json() };
  }
  function offer(id = "offer", recipientMembershipId = "worker-member", replyBy?: number, slot = "slot") {
    return call("foreman", `/slots/${slot}/offers`, `issue-${id}`, { offerId: id, recipientMembershipId, replyBy });
  }
  return { db, call, offer, wakeKeys, advance: (minutes: number) => { clock = base + minutes * minute; }, close() { now.mockRestore(); db.close(); } };
}

test("named offer is private and accepts atomically once; replays do not add a hold, push or assignment", async () => {
  const f = await fixture();
  try {
    const issued = await f.offer();
    expect(issued).toMatchObject({ status: 200, body: { data: { offerId: "offer", state: "offered", replyBy: start } } });
    expect((await f.offer()).body.data).toEqual(issued.body.data);
    expect((await f.offer("competing", "second-member")).status).toBe(409);
    const candidates = await f.call("foreman", "/shifts/shift/candidates");
    expect(candidates.body.data.slots[0]).toMatchObject({ availability: "offered", pendingOffer: { offerId: "offer" } });
    const opening = await f.call("worker", "/offers/offer");
    expect(opening).toMatchObject({ status: 200, body: { data: { state: "offered", town: "Coarse town", availability: { state: "free" } } } });
    expect(JSON.stringify(opening.body)).not.toMatch(/Private alias|Private address|Private scope|second name/);
    expect((await f.call("second", "/offers/offer")).status).toBe(404);
    expect((await f.call("second", "/offers/offer/accept", "interfere")).status).toBe(404);
    const token = await f.db.prepare("SELECT token FROM link_targets WHERE kind = 'assignment_offer'").first<string>("token");
    expect(token).toBeTruthy();
    expect((await f.call("worker", `/links/${token}`)).body.data).toMatchObject({ kind: "assignment_offer", offer: { offerId: "offer" } });
    expect((await f.call("second", `/links/${token}`)).body.data).toMatchObject({ kind: "unavailable" });
    const agenda = await f.call("worker", "/shifts?segment=offers");
    expect(agenda.body.data.rows).toMatchObject([{ id: "offer", state: "offered" }]);
    expect((await f.call("second", "/shifts?segment=offers")).body.data.rows).toEqual([]);
    f.advance(1);
    const accepted = await f.call("worker", "/offers/offer/accept", "accept");
    expect(accepted).toMatchObject({ status: 200, body: { data: { offerId: "offer", state: "confirmed", shiftId: "shift" } } });
    expect((await f.call("worker", "/offers/offer/accept", "accept")).body.data).toEqual(accepted.body.data);
    expect((await f.call("worker", "/offers/offer/accept", "accept-again")).status).toBe(409);
    expect(await f.db.prepare(`SELECT (SELECT count(*) FROM assignments) AS assignments,
      (SELECT count(*) FROM safety_holds WHERE state = 'active') AS holds,
      (SELECT count(*) FROM operation_receipts) AS receipts,
      (SELECT count(*) FROM effect_outbox) AS effects`).first()).toEqual({ assignments: 1, holds: 1, receipts: 2, effects: 2 });
    expect((await f.db.prepare(`SELECT resource_id, partition_key, op FROM sync_changes
      WHERE kind = 'worker_field_shift'`).all()).results).toEqual([
      { resource_id: accepted.body.data.assignmentId, partition_key: "worker-context", op: "upsert" },
    ]);
    expect(f.wakeKeys.map((keys) => keys.length)).toEqual([1, 1]);
  } finally { f.close(); }
});

test("roster and fit are provider-scoped; cutoff and a new overlap reject issue or acceptance", async () => {
  const f = await fixture();
  try {
    const roster = await f.call("foreman", "/crew?search=carpentry&filter=free_now");
    expect(roster).toMatchObject({ status: 200, body: { data: { date: "2026-11-24", total: 3, businessId: "provider" } } });
    expect(roster.body.data.members).toContainEqual(expect.objectContaining({ membershipId: "worker-member",
      eligibility: { state: "expiring", validUntil: end }, status: { state: "free", until: end + minute } }));
    expect((await f.call("admin", "/crew/worker-member")).body.data).toMatchObject({ member: { skills: ["carpentry"], workingLanguages: ["es"] },
      eligibility: { state: "expiring", validUntil: end } });
    expect((await f.call("foreman", "/crew/worker-member?shiftId=shift&weekOf=2026-11-24")).body.data).toMatchObject({
      shiftFit: { fit: { result: "available", eligibility: { validUntil: end } } } });
    expect((await f.call("foreman", "/crew/foreign-member")).status).toBe(404);
    expect((await f.call("worker", "/crew/second-member")).status).toBe(404);
    expect((await f.call("rival", "/crew")).status).toBe(404);
    expect((await f.call("admin", "/shifts/shift/candidates")).status).toBe(404);
    const fit = (await f.call("foreman", "/shifts/shift/candidates")).body.data.candidates;
    expect(fit).toHaveLength(3);
    expect(fit.find((m: { membershipId: string }) => m.membershipId === "expiring-member")).toMatchObject({
      fit: { result: "not_eligible", eligibility: { validUntil: end - 1 }, skillMatches: true, briefingLanguageMatches: true },
    });
    expect((await f.offer("foreign-offer", "foreign-member")).status).toBe(409);
    expect((await f.offer("short-eligibility", "expiring-member")).status).toBe(409);
    expect((await f.offer()).status).toBe(200);
    await f.db.prepare(`INSERT INTO assignments (id, slot_id, worker_membership_id, source, state, confirmed_by, confirmed_at, starts_at, ends_at)
      VALUES ('busy', 'other-slot', 'worker-member', 'ordinary', 'confirmed', 'worker', ?, ?, ?)`).bind(base, start, end).run();
    const detail = await f.call("foreman", "/crew/worker-member?shiftId=shift");
    expect(detail.body.data.shiftFit.fit).toMatchObject({ result: "conflict", availability: { state: "busy", window: { startsAt: start, endsAt: end } } });
    const workerView = await f.call("worker", "/offers/offer");
    expect(workerView.body.data.availability).toEqual({ state: "busy", window: { startsAt: start, endsAt: end } });
    expect((await f.call("worker", "/offers/offer/accept", "overlap")).status).toBe(409);
    expect(await f.db.prepare("SELECT count(*) AS count FROM assignments").first("count")).toBe(1);
  } finally { f.close(); }
});

test("expiry, rejection, withdrawal and decline leave slots unassigned and may be followed by a fresh offer", async () => {
  const f = await fixture();
  try {
    expect((await f.offer("expiring-offer", "worker-member", base + minute)).status).toBe(200);
    f.advance(1);
    expect((await f.call("worker", "/offers/expiring-offer")).body.data).toMatchObject({ state: "expired", endedAt: base + minute });
    expect((await f.call("worker", "/offers/expiring-offer/accept", "late")).status).toBe(409);
    expect((await f.offer("replacement")).status).toBe(200);
    expect(await f.db.prepare("SELECT state FROM assignment_offers WHERE id = 'expiring-offer'").first("state")).toBe("expired");
    expect((await f.call("worker", "/offers/replacement/withdraw", "not-issuer")).status).toBe(404);
    expect((await f.call("foreman", "/offers/replacement/withdraw", "issuer")).body.data).toMatchObject({ state: "withdrawn" });
    expect((await f.call("worker", "/offers/replacement")).body.data).toMatchObject({ state: "withdrawn" });
    expect((await f.offer("decline-me", "second-member")).status).toBe(200);
    expect((await f.call("second", "/offers/decline-me/decline", "decline", { reason: "busy_then" })).body.data).toMatchObject({ state: "declined" });
    expect(await f.db.prepare("SELECT count(*) AS count FROM assignments").first("count")).toBe(0);
  } finally { f.close(); }
});

test("availability and eligibility are checked afresh after issuance", async () => {
  const f = await fixture();
  try {
    expect((await f.offer()).status).toBe(200);
    await f.db.prepare(`INSERT INTO availability_intervals (id, membership_id, week_day_or_date, starts_at, ends_at, kind, source, recorded_by, recorded_at)
      VALUES ('rest', 'worker-member', '2026-11-24', ?, ?, 'unavailable', 'employer', 'foreman', ?)`).bind(start, end, base).run();
    expect((await f.call("worker", "/offers/offer/accept", "rest-conflict")).status).toBe(409);
    await f.db.batch([
      f.db.prepare("DELETE FROM availability_intervals WHERE id = 'rest'"),
      f.db.prepare(`INSERT INTO eligibility_checks (id, business_id, membership_id, trade, work_language, scope, state, checked_by, checked_at)
        VALUES ('suspension', 'provider', 'worker-member', 'carpentry', 'es', 'internal', 'suspended', 'admin', ?)`).bind(base),
    ]);
    expect((await f.call("worker", "/offers/offer/accept", "no-longer-eligible")).status).toBe(409);
    expect(await f.db.prepare("SELECT count(*) AS count FROM assignments").first("count")).toBe(0);
  } finally { f.close(); }
});

test("worker dropout opens one private gap and phone reports are attributed to the foreman", async () => {
  const f = await fixture();
  try {
    expect((await f.offer()).status).toBe(200);
    const first = (await f.call("worker", "/offers/offer/accept", "accept-first")).body.data.assignmentId;
    expect((await f.call("second", `/assignments/${first}/dropout`, "not-mine", { source: "self" })).status).toBe(404);
    expect((await f.call("worker", `/assignments/${first}/dropout`, "not-phone", { source: "phone_report" })).status).toBe(404);
    const dropped = await f.call("worker", `/assignments/${first}/dropout`, "drop", { source: "self", reason: "transport" });
    expect(dropped).toMatchObject({ status: 200, body: { data: { audience: "worker", state: "dropped" } } });
    expect(dropped.body.data.gapId).toBeUndefined();
    expect((await f.call("worker", `/assignments/${first}/dropout`, "drop", { source: "self", reason: "transport" })).body.data).toEqual(dropped.body.data);
    expect((await f.call("worker", `/assignments/${first}/dropout`, "drop-again", { source: "self" })).status).toBe(409);
    expect(await f.db.prepare("SELECT prior_assignment_id, state FROM cover_gaps").all()).toMatchObject({ results: [
      { prior_assignment_id: first, state: "open" },
    ] });
    expect((await f.db.prepare(`SELECT partition_key, op FROM sync_changes
      WHERE kind = 'worker_field_shift' AND resource_id = ? ORDER BY seq`).bind(first).all()).results).toEqual([
      { partition_key: "worker-context", op: "upsert" }, { partition_key: "worker-context", op: "upsert" },
    ]);
    expect((await f.offer("try-bypass-cover", "second-member")).status).toBe(409);
    expect((await f.offer("phone-offer", "second-member", undefined, "other-slot")).status).toBe(200);
    const second = (await f.call("second", "/offers/phone-offer/accept", "accept-second")).body.data.assignmentId;
    const reported = await f.call("foreman", `/assignments/${second}/dropout`, "phone", { source: "phone_report" });
    expect(reported.body.data).toMatchObject({ audience: "foreman", gapId: expect.any(String) });
    expect(await f.db.prepare("SELECT dropout_reported_by, dropout_source FROM assignments WHERE id = ?").bind(second).first())
      .toEqual({ dropout_reported_by: "foreman", dropout_source: "phone_report" });
    expect(await f.db.prepare("SELECT count(*) AS count FROM customer_updates").first("count")).toBe(0);
  } finally { f.close(); }
});

test("an accepted arrival blocks dropout, including a phone report", async () => {
  const f = await fixture();
  try {
    expect((await f.offer()).status).toBe(200);
    const assignment = (await f.call("worker", "/offers/offer/accept", "accept")).body.data.assignmentId;
    f.advance(55);
    const at = base + 55 * minute;
    await f.db.prepare(`INSERT INTO attendance_events (id, assignment_id, actor_id, kind, source, actual_at, captured_at, received_at, review_state)
      VALUES ('arrival', ?, 'worker', 'arrival', 'self', ?, ?, ?, 'accepted')`).bind(assignment, at, at, at).run();
    expect((await f.call("foreman", `/assignments/${assignment}/dropout`, "phone-after-arrival", { source: "phone_report" })).status).toBe(409);
    expect(await f.db.prepare("SELECT count(*) AS count FROM cover_gaps").first("count")).toBe(0);
  } finally { f.close(); }
});
