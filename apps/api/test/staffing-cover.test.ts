import { expect, spyOn, test } from "bun:test";
import {
  acceptCoverRoute, closeCoverRoute, confirmCoverRoute, declineCoverRoute, getCoverRoute, getHomeRoute, issueCoverRoute,
  listShiftsRoute, operationIdHeader, releaseCoverRoute, resultSchema, withdrawCoverRoute,
} from "@bookbuddy/api-contract";
import type { ResponseSchema } from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential } from "../src/modules/auth/session";
import { openGapStatements } from "../src/modules/staffing/cover";
import { createTestD1 } from "./d1";

const origin = "https://bookbuddy.test";
const minute = 60_000;
const base = Date.UTC(2026, 10, 24, 8);
const start = base + 60 * minute;
const end = start + 60 * minute;
const actors = ["customer", "foreman", "first", "second", "third", "prior", "foreign", "noncrew"] as const;
type Actor = typeof actors[number];
type TestCommand = { operationId: string; expectedRevision: number; expectedRoundNo: number | null; payload: object };

function command(operationId: string, expectedRevision: number, expectedRoundNo: number | null, payload: object = {}): TestCommand {
  return { operationId, expectedRevision, expectedRoundNo, payload };
}

async function fixture() {
  const db = await createTestD1();
  const app = createApp().onError((error) => { throw error; });
  const keyByActor = new Map<Actor, string>(actors.map((actor) => [actor, randomToken()]));
  const hashes = await Promise.all([...keyByActor].map(async ([actor, token]) => [actor, await hashSessionCredential(token)] as const));
  const wakes: string[][] = [];
  const env = { DB: db, EFFECTS: { async send({ workKeys }: { workKeys: string[] }) { wakes.push(workKeys); } } } as unknown as Bindings;
  const execution = { waitUntil() {}, passThroughOnException() {} };
  const batchWriteCounts: number[] = [];
  const originalBatch = db.batch.bind(db);
  db.batch = async <T,>(statements: D1PreparedStatement[]) => {
    const results = await originalBatch<T>(statements);
    batchWriteCounts.push(results.reduce((n, { meta }) => n + meta.changes, 0));
    return results;
  };
  try {
    await db.batch([
      db.prepare(`INSERT INTO operating_areas (id, name, site_zone, polygon) VALUES ('area', 'Coarse town', 'Europe/Madrid', '[0]')`),
      db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state) VALUES
        ('provider', 'Provider LLC', 'Provider', 'provider@example.test', 'area', 'approved'),
        ('another', 'Other LLC', 'Other', 'other@example.test', 'area', 'approved')`),
      ...hashes.flatMap(([actor, hash]) => {
        const business = actor === "foreign" ? "another" : "provider";
        const role = actor === "foreman" ? "foreman" : actor === "noncrew" ? "provider_admin" : "worker";
        return [
          db.prepare(`INSERT INTO accounts (id, email_normalized, display_name, verified_at, state)
            VALUES (?, ?, ?, 1, 'active')`).bind(actor, `${actor}@example.test`, `${actor} name`),
          ...actor === "customer" ? [
            db.prepare(`INSERT INTO account_contexts (id, account_id, role) VALUES ('customer-context', 'customer', 'customer')`),
          ] : [
            db.prepare(`INSERT INTO memberships (id, business_id, account_id, state) VALUES (?, ?, ?, 'active')`)
              .bind(`${actor}-member`, business, actor),
            db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at)
              VALUES (?, ?, ?, ?, ?, 1)`).bind(`${actor}-role`, `${actor}-member`, business, actor, role),
            db.prepare(`INSERT INTO account_contexts (id, account_id, role, business_id, role_grant_id) VALUES (?, ?, ?, ?, ?)`)
              .bind(`${actor}-context`, actor, role, business, `${actor}-role`),
          ],
          db.prepare(`INSERT INTO sessions (id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
            VALUES (?, ?, ?, ?, 'device', 1, ?)`).bind(`${actor}-session`, actor, hash, `${actor}-context`, base + 7 * 24 * 60 * minute),
        ];
      }),
      db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state) VALUES
        ('place', 'customer', 'Private alias', 'Private address', 'pending_verification')`),
      db.prepare(`INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES ('place', 'customer', 1, 1)`),
      db.prepare(`UPDATE places SET state = 'in_area', named_approver_id = 'customer', area_id = 'area', site_zone = 'Europe/Madrid',
        pin = '{"latitude":0,"longitude":0}' WHERE id = 'place'`),
      db.prepare(`INSERT INTO jobs (id, reference, business_id, place_id, requester_id, accountable_foreman_membership_id, trade, origin, state)
        VALUES ('job', 'BB-ABC', 'provider', 'place', 'customer', 'foreman-member', 'carpentry', 'provider', 'open')`),
      db.prepare(`INSERT INTO visits (id, job_id, kind, state) VALUES ('visit', 'job', 'work', 'booked')`),
      db.prepare(`INSERT INTO visit_windows (id, visit_id, starts_at, ends_at, expires_at, provider_authorized, proposed_at, proposed_by,
        confirmed_at, confirmed_by, state) VALUES ('booked', 'visit', ?, ?, ?, 1, 1, 'foreman', 2, 'customer', 'confirmed')`)
        .bind(start, end, start),
      db.prepare(`INSERT INTO shifts (id, visit_id, starts_at, ends_at, skill, briefing_language, state)
        VALUES ('shift', 'visit', ?, ?, 'carpentry', 'es', 'planned')`).bind(start, end),
      db.prepare(`INSERT INTO shift_slots (id, shift_id, number) VALUES ('slot', 'shift', 1)`),
      ...(["first", "second", "third", "foreign", "noncrew"] as const).flatMap((actor) => [
        db.prepare(`INSERT INTO member_skills (membership_id, tag) VALUES (?, 'carpentry')`).bind(`${actor}-member`),
        db.prepare(`INSERT INTO member_languages (membership_id, tag) VALUES (?, 'es')`).bind(`${actor}-member`),
        db.prepare(`INSERT INTO eligibility_checks (id, business_id, membership_id, trade, work_language, scope, state, checked_by, checked_at, valid_until)
          VALUES (?, ?, ?, 'carpentry', 'es', 'internal', 'approved', 'foreman', 1, ?)`)
          .bind(`${actor}-check`, actor === "foreign" ? "another" : "provider", `${actor}-member`, end + minute),
        db.prepare(`INSERT INTO availability_intervals
          (id, membership_id, week_day_or_date, starts_at, ends_at, kind, source, recorded_by, recorded_at)
          VALUES (?, ?, '2026-11-24', ?, ?, 'duty', 'employer', 'foreman', 1)`)
          .bind(`${actor}-duty`, `${actor}-member`, base - minute, end + minute),
      ]),
      db.prepare(`INSERT INTO assignments (id, slot_id, worker_membership_id, source, state, confirmed_by, confirmed_at, starts_at, ends_at,
        dropped_at, dropout_reported_by, dropout_source)
        VALUES ('prior-assignment', 'slot', 'prior-member', 'ordinary', 'dropped', 'foreman', 1, ?, ?, ?, 'prior', 'self')`).bind(start, end, base),
      ...openGapStatements({ sql: "1" }, { assignmentId: "prior-assignment", gapId: "gap", droppedAt: base })
        .map(({ sql, params = [] }) => db.prepare(sql).bind(...params)),
    ]);
  } catch (error) {
    db.close();
    throw error;
  }
  let clock = base;
  const now = spyOn(Date, "now").mockImplementation(() => clock);

  async function call<Output extends ResponseSchema>(actor: Actor,
    route: { method: string; path: string; output: Output }, body?: TestCommand, racing = false) {
    const { batch, query } = db.calls;
    const response = await app.request(`${origin}/api/v1${route.path.replace(":g", "gap")}`, {
      method: route.method, headers: { Authorization: `Bearer ${keyByActor.get(actor)}`, "Content-Type": "application/json",
        ...(body ? { [operationIdHeader]: body.operationId } : {}) }, body: body ? JSON.stringify(body) : undefined,
    }, env, execution);
    if (!racing) {
      const batched = route.method === "POST" || route.path === getHomeRoute.path;
      expect(db.calls.batch - batch).toBe(batched ? 1 : 0);
      expect(db.calls.query - query).toBe(batched ? 0 : 1);
    }
    return resultSchema(route.output).parse(await response.json());
  }
  async function issue(members = ["first-member", "second-member"], revision = 0, round: number | null = null, operation = "issue") {
    const cover = data(await call("foreman", issueCoverRoute, command(operation, revision, round, { recipientMembershipIds: members })));
    expect(cover.status.state).toBe("offers_out");
    return cover;
  }
  async function offer(actor: Actor) {
    const view = data(await call(actor, getCoverRoute));
    if (view.audience !== "worker" || view.offer.state !== "offered") throw new Error("Expected the worker's open offer");
    return view.offer;
  }
  return { db, call, issue, offer, wakes, batchWriteCounts, advance: (minutes: number) => { clock = base + minutes * minute; },
    close() { now.mockRestore(); db.close(); } };
}

function data<T>(result: { ok: true; data: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(`Unexpected command error: ${result.error.code}`);
  return result.data;
}

test("one worker wins the epoch, the rival and replay do not write, and confirmation assigns exactly once", async () => {
  const f = await fixture();
  try {
    const gap = data(await f.call("foreman", getCoverRoute));
    expect(gap).toMatchObject({ audience: "foreman", safeCutoff: start - 20 * minute, currentRoundNo: null,
      status: { state: "gap" }, customerUpdate: { state: "not_shared" } });
    expect(await f.call("first", getCoverRoute)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    const issued = await f.issue();
    expect(issued).toMatchObject({ revision: 1, currentRoundNo: 1, dispatchesUsed: 1,
      customerUpdate: { state: "published", kind: "cover_arranging" }, status: { replyBy: base + 15 * minute } });
    expect(f.wakes.map((keys) => keys.length)).toEqual([2]);
    const [first, second] = await Promise.all([f.call("first", getCoverRoute, undefined, true), f.call("second", getCoverRoute, undefined, true)]);
    const reads = [data(first), data(second)];
    expect(reads.every((r) => r.audience === "worker" && r.offer.state === "offered")).toBe(true);
    expect(JSON.stringify(reads)).not.toMatch(/Private alias|Private address|customer name|candidates/);
    expect(await f.call("customer", getCoverRoute)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    const firstOffer = await f.offer("first");
    const secondOffer = await f.offer("second");
    expect(firstOffer.offerId).not.toBe(secondOffer.offerId);
    expect(await f.call("first", acceptCoverRoute, command("steal", 1, 1, { offerId: secondOffer.offerId })))
      .toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(f.batchWriteCounts.at(-1)).toBe(0);

    const actors = ["first", "second"] as const;
    const replies = [firstOffer, secondOffer].map((offer, i) => command(`take-${i}`, 1, 1, { offerId: offer.offerId }));
    f.advance(1);
    const before = { ...f.db.calls };
    const writeAt = f.batchWriteCounts.length;
    const results = await Promise.all(actors.map((actor, i) => f.call(actor, acceptCoverRoute, replies[i]!, true)));
    expect(f.db.calls.batch - before.batch).toBe(2);
    expect(f.db.calls.query - before.query).toBe(0);
    expect(f.batchWriteCounts.slice(writeAt).filter((writes) => writes === 0)).toHaveLength(1);
    const winner = results.findIndex((r) => r.ok);
    expect(winner).toBeGreaterThanOrEqual(0);
    const loser = 1 - winner;
    const held = data(results[winner]!);
    expect(held).toMatchObject({ state: "accepted_pending_confirmation", revision: 2, roundNo: 1,
      acceptedAt: base + minute, confirmBy: base + 6 * minute });
    expect(results[loser]).toMatchObject({ ok: false, error: { code: "CONFLICT", current: { kind: "cover", status: "accepted_pending_confirmation" } } });
    expect(await f.db.prepare(`SELECT count(*) AS count FROM assignments WHERE state = 'confirmed'`).first("count")).toBe(0);
    expect(await f.db.prepare(`SELECT count(*) AS count FROM safety_holds`).first("count")).toBe(0);
    expect(await f.db.prepare(`SELECT count(*) AS count FROM customer_updates WHERE kind = 'crew_updated'`).first("count")).toBe(0);
    expect(f.wakes.map((keys) => keys.length)).toEqual([2, 1]);
    expect(await f.db.prepare(`SELECT count(*) AS count FROM effect_outbox e JOIN notifications n ON n.id = e.resource_ref
      JOIN link_targets l ON l.token = n.link_token AND l.required_scope = n.context_id WHERE e.kind = 'notification_push'`).first("count")).toBe(3);
    expect(data(await f.call(actors[loser]!, getCoverRoute))).toMatchObject({ audience: "worker", offer: { state: "on_hold" } });
    expect(data(await f.call(actors[winner]!, acceptCoverRoute, replies[winner]!))).toEqual(held);
    expect(f.batchWriteCounts.at(-1)).toBe(0);
    expect(await f.db.prepare(`SELECT count(*) AS count FROM sync_changes WHERE kind = 'worker_field_shift'`).first("count")).toBe(0);

    f.advance(2);
    const reserved = command("confirm", 2, 1);
    const confirmed = data(await f.call("foreman", confirmCoverRoute, reserved));
    expect(confirmed).toMatchObject({ outcome: "confirmed", cover: { revision: 3,
      status: { state: "confirmed", worker: { membershipId: `${actors[winner]}-member` } }, customerUpdate: { kind: "crew_updated" } } });
    expect(data(await f.call("foreman", confirmCoverRoute, reserved))).toEqual(confirmed);
    expect(f.batchWriteCounts.at(-1)).toBe(0);
    expect(data(await f.call("foreman", confirmCoverRoute, command("second-confirm", 2, 1))).outcome).toBe("already_filled");
    expect(f.batchWriteCounts.at(-1)).toBe(0);
    expect(data(await f.call(actors[winner]!, acceptCoverRoute, replies[winner]!))).toEqual(held);
    expect(f.batchWriteCounts.at(-1)).toBe(0);
    expect(await f.call(actors[loser]!, acceptCoverRoute, replies[loser]!))
      .toMatchObject({ ok: false, error: { current: { kind: "cover", status: "filled" } } });
    expect(f.batchWriteCounts.at(-1)).toBe(0);
    expect(await f.db.prepare(`SELECT count(*) AS count FROM assignments a JOIN safety_holds h ON h.assignment_id = a.id
      WHERE a.cover_gap_id = 'gap' AND a.state = 'confirmed' AND h.kind = 'briefing' AND h.state = 'active'`).first("count")).toBe(1);
    const fieldChange = await f.db.prepare(`SELECT kind, partition_key, op FROM sync_changes s
      JOIN assignments a ON a.id = s.resource_id WHERE s.kind IN ('assignment_briefing', 'worker_field_shift') AND a.cover_gap_id = 'gap'
      ORDER BY kind`).all();
    expect(fieldChange.results).toEqual([
      { kind: "assignment_briefing", partition_key: `${actors[winner]}-context`, op: "upsert" },
      { kind: "worker_field_shift", partition_key: `${actors[winner]}-context`, op: "upsert" },
    ]);
    expect(await f.db.prepare(`SELECT count(*) AS count FROM cover_offers WHERE gap_id = 'gap' AND state = 'offered'`).first("count")).toBe(2);
    const sibling = data(await f.call(actors[loser]!, getCoverRoute));
    expect(sibling).toMatchObject({ audience: "worker", offer: { state: "filled_elsewhere" } });
    expect(JSON.stringify(sibling)).not.toContain(`${actors[winner]} name`);
  } finally { f.close(); }
});

test("expired and ineligible holds do not confirm; an eligible sibling has to accept a fresh round", async () => {
  const f = await fixture();
  try {
    await f.issue();
    const first = await f.offer("first");
    const second = await f.offer("second");
    const take = command("first-accept", 1, 1, { offerId: first.offerId });
    data(await f.call("first", acceptCoverRoute, take));
    f.advance(5);
    const expired = data(await f.call("foreman", confirmCoverRoute, command("expired-confirm", 2, 1)));
    expect(expired).toMatchObject({ outcome: "not_confirmed", cover: { revision: 3, currentRoundNo: 2,
      dispatchesUsed: 1, status: { state: "offers_out" }, customerUpdate: { kind: "cover_arranging" } } });
    expect(await f.db.prepare(`SELECT count(*) AS count FROM assignments WHERE cover_gap_id = 'gap'`).first("count")).toBe(0);
    expect(data(await f.call("first", getCoverRoute))).toMatchObject({ audience: "worker", offer: { state: "not_confirmed", endedAt: base + 5 * minute } });
    const current = await f.offer("second");
    expect(current).toMatchObject({ offerId: second.offerId, roundNo: 2, revision: 3 });
    expect(await f.call("second", acceptCoverRoute, command("stale-tap", 1, 1, { offerId: second.offerId }))).toMatchObject({ ok: false });
    expect(f.batchWriteCounts.at(-1)).toBe(0);
    data(await f.call("second", acceptCoverRoute, command("fresh-tap", 3, 2, { offerId: second.offerId })));
    await f.db.prepare(`INSERT INTO availability_intervals
      (id, membership_id, week_day_or_date, starts_at, ends_at, kind, source, recorded_by, recorded_at)
      VALUES ('rest', 'second-member', '2026-11-24', ?, ?, 'unavailable', 'employer', 'foreman', ?)`).bind(start, end, base + 5 * minute).run();
    const failed = data(await f.call("foreman", confirmCoverRoute, command("recheck-confirm", 4, 2)));
    expect(failed).toMatchObject({ outcome: "not_confirmed", cover: { revision: 5, status: { state: "gap" } } });
    expect(f.wakes.map((keys) => keys.length)).toEqual([2, 1, 1]); // A new acceptance notifies F; reopening never re-broadcasts sibling offers.
    expect(await f.db.prepare(`SELECT count(*) AS count FROM assignments WHERE cover_gap_id = 'gap'`).first("count")).toBe(0);
  } finally { f.close(); }
});

test("issue rejects noncrew, foreign, and off-duty workers atomically; close can link only a proposed replacement", async () => {
  const f = await fixture();
  try {
    for (const [i, membership] of ["foreign-member", "noncrew-member"].entries()) {
      expect(await f.call("foreman", issueCoverRoute, command(`invalid-${i}`, 0, null,
        { recipientMembershipIds: ["first-member", membership] }))).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(f.batchWriteCounts.at(-1)).toBe(0);
    }
    await f.db.prepare(`UPDATE availability_intervals SET kind = 'available', open_to_cover = 1 WHERE id = 'third-duty'`).run();
    expect(await f.call("foreman", issueCoverRoute, command("off-duty", 0, null, { recipientMembershipIds: ["third-member"] })))
      .toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(f.batchWriteCounts.at(-1)).toBe(0);
    expect(f.wakes).toHaveLength(0);

    await f.issue(["first-member"]);
    const first = await f.offer("first");
    expect(data(await f.call("first", declineCoverRoute, command("decline", 1, 1, { offerId: first.offerId, reason: "busy_then" }))))
      .toMatchObject({ state: "declined" });
    await f.issue(["second-member"], 1, 1, "second-dispatch");
    const second = await f.offer("second");
    data(await f.call("second", acceptCoverRoute, command("take", 2, 2, { offerId: second.offerId })));
    expect(await f.call("foreman", closeCoverRoute, command("displace", 3, 2, { reason: "safety" }))).toMatchObject({ ok: false });
    expect(f.batchWriteCounts.at(-1)).toBe(0);
    expect(data(await f.call("second", withdrawCoverRoute, command("withdraw", 3, 2, { offerId: second.offerId }))))
      .toMatchObject({ state: "withdrawn" });
    expect(await f.call("foreman", issueCoverRoute, command("third-dispatch", 4, 2, { recipientMembershipIds: ["first-member"] })))
      .toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(f.batchWriteCounts.at(-1)).toBe(0);
    expect(data(await f.call("foreman", closeCoverRoute, command("no-cover", 4, 2, { reason: "exhausted" }))).status.state).toBe("no_cover");
    expect(await f.call("foreman", closeCoverRoute, command("wrong-window", 5, 2, { reason: "revised_visit", revisedWindowId: "booked" })))
      .toMatchObject({ ok: false });
    await f.db.prepare(`INSERT INTO visit_windows (id, visit_id, replaces_window_id, starts_at, ends_at, expires_at,
      provider_authorized, proposed_at, proposed_by, state) VALUES ('proposal', 'visit', 'booked', ?, ?, ?, 1, ?, 'foreman', 'proposed')`)
      .bind(start + 24 * 60 * minute, end + 24 * 60 * minute, start, base).run();
    const proposed = data(await f.call("foreman", closeCoverRoute, command("revised", 5, 2, { reason: "revised_visit", revisedWindowId: "proposal" })));
    expect(proposed.status).toMatchObject({ state: "new_visit_proposed", windowId: "proposal" });
    expect(await f.db.prepare(`SELECT id FROM visit_windows WHERE state = 'confirmed'`).first("id")).toBe("booked");
  } finally { f.close(); }
});

test("foreman release keeps the original winner and lets a sibling answer without a second dispatch", async () => {
  const f = await fixture();
  try {
    await f.issue();
    const first = await f.offer("first");
    await f.db.batch([
      f.db.prepare(`INSERT INTO shift_slots (id, shift_id, number) VALUES ('ordinary-slot', 'shift', 2)`),
      f.db.prepare(`INSERT INTO assignment_offers (id, slot_id, recipient_id, issued_by, issued_at, expires_at, state)
        VALUES ('ordinary-offer', 'ordinary-slot', 'first-member', 'foreman', ?, ?, 'offered')`).bind(base, base + 20 * minute),
    ]);
    const home = data(await f.call("first", getHomeRoute));
    if (home.audience !== "worker") throw new Error("Expected worker home");
    expect(home.offers).toMatchObject([
      { kind: "cover", gapId: "gap", offerId: first.offerId, awaitingConfirmationUntil: null },
      { kind: "ordinary", offerId: "ordinary-offer" },
    ]);
    expect(home.offers[1]).not.toHaveProperty("gapId");
    const agenda = data(await f.call("first", { ...listShiftsRoute, path: "/shifts?segment=offers" }));
    expect(agenda.rows).toMatchObject([
      { kind: "offer", source: "cover", gapId: "gap", id: first.offerId },
      { kind: "offer", source: "ordinary", id: "ordinary-offer" },
    ]);
    expect(agenda.rows[1]).not.toHaveProperty("gapId");
    const otherHome = data(await f.call("third", getHomeRoute));
    expect(otherHome).toMatchObject({ audience: "worker", offers: [] });
    data(await f.call("first", acceptCoverRoute, command("take", 1, 1, { offerId: first.offerId })));
    expect(data(await f.call("first", getHomeRoute))).toMatchObject({ offers: [
      { kind: "cover", gapId: "gap", offerId: first.offerId, replyBy: base + 15 * minute, awaitingConfirmationUntil: base + 5 * minute },
      { kind: "ordinary", offerId: "ordinary-offer" },
    ] });
    const released = data(await f.call("foreman", releaseCoverRoute, command("release", 2, 1, { reason: "safety" })));
    expect(released).toMatchObject({ currentRoundNo: 2, revision: 3, dispatchesUsed: 1, status: { state: "offers_out" } });
    expect(await f.db.prepare(`SELECT winner_offer_id FROM cover_rounds WHERE round_no = 1 AND state = 'closed'`).first("winner_offer_id")).toBe(first.offerId);
    expect(data(await f.call("first", getCoverRoute))).toMatchObject({ audience: "worker", offer: { state: "not_confirmed" } });
    expect(data(await f.call("first", getHomeRoute))).toMatchObject({
      offers: [{ kind: "ordinary", offerId: "ordinary-offer" }],
    });
    expect(await f.offer("second")).toMatchObject({ roundNo: 2, revision: 3 });
    expect(f.wakes.map((keys) => keys.length)).toEqual([2, 1]);
  } finally { f.close(); }
});
