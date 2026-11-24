import { expect, spyOn, test } from "bun:test";
import { openLinkRoute, operationIdHeader, resultSchema, syncRoute } from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential } from "../src/modules/auth/session";
import { readShiftAgenda } from "../src/modules/schedule/shifts";
import { createTestD1 } from "./d1";

const at = Date.parse("2026-11-23T08:00:00Z");
const hour = 60 * 60_000;
const origin = "https://bookbuddy.test";
const placeRoles = ["customer", "delegate", "viewer", "unrelated"] as const;
const staff = { foreman: "foreman", other: "foreman", provider: "provider_admin", crew: "worker", second: "worker" } as const;
type Actor = typeof placeRoles[number] | keyof typeof staff;
const write = (operationId: string, expectedRevision: number, payload: unknown) => ({ operationId, expectedRevision, payload });

async function fixture() {
  const db = await createTestD1();
  const app = createApp().onError((error) => { throw error; });
  const wakes: (readonly string[])[] = [];
  const env = {
    DB: db, SYNC_CURSOR_HMAC_KEY: "a-test-only-sync-cursor-key-for-scheduling", EFFECTS: {
      async send({ workKeys }: { workKeys: readonly string[] }) { wakes.push(workKeys); },
    },
  } as unknown as Bindings;
  const execution = { waitUntil() {}, passThroughOnException() {} };
  const actors = [...placeRoles, ...Object.keys(staff) as (keyof typeof staff)[]];
  const credentials = await Promise.all(actors.map(async (actor) => {
    const token = randomToken();
    return { actor, token, digest: await hashSessionCredential(token) };
  }));
  await db.batch([
    db.prepare("INSERT INTO operating_areas (id, name, site_zone, polygon) VALUES ('area', 'Fixture', 'Europe/Madrid', '[0]')"),
    db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
      VALUES ('business', 'Provider LLC', 'Provider', 'work@example.test', 'area', 'approved')`),
    ...credentials.flatMap(({ actor, digest }) => {
      const role = staff[actor as keyof typeof staff];
      return [
        db.prepare("INSERT INTO accounts (id, email_normalized, display_name, verified_at, setup_at, state) VALUES (?, ?, ?, 1, 1, 'active')")
          .bind(actor, `${actor}@example.test`, `${actor} name`),
        ...(role ? [
          db.prepare("INSERT INTO memberships VALUES (?, 'business', ?, 'active')").bind(`${actor}-member`, actor),
          db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at)
            VALUES (?, ?, 'business', ?, ?, 1)`).bind(`${actor}-role`, `${actor}-member`, actor, role),
          db.prepare("INSERT INTO account_contexts VALUES (?, ?, ?, 'business', ?)").bind(`${actor}-context`, actor, role, `${actor}-role`),
        ] : [db.prepare("INSERT INTO account_contexts (id, account_id, role) VALUES (?, ?, 'customer')").bind(`${actor}-context`, actor)]),
        db.prepare(`INSERT INTO sessions (id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
          VALUES (?, ?, ?, ?, 'device', 1, ?)`).bind(`${actor}-session`, actor, digest, `${actor}-context`, at + 168 * hour),
      ];
    }),
    db.prepare(`INSERT INTO business_grants (id, business_id, membership_id, capability, issuer_id, valid_from)
      VALUES ('schedule-correction', 'business', 'provider-member', 'schedule_correction', 'foreman', 1)`),
    db.prepare("INSERT INTO member_skills VALUES ('crew-member', 'carpentry'), ('second-member', 'plumbing')"),
    db.prepare("INSERT INTO member_languages VALUES ('crew-member', 'es'), ('second-member', 'es')"),
    db.prepare(`INSERT INTO eligibility_checks (id, business_id, membership_id, trade, work_language, scope, state, checked_by, checked_at, valid_until)
      VALUES ('crew-check', 'business', 'crew-member', 'carpentry', 'es', 'internal', 'approved', 'provider', 1, ?),
             ('second-check', 'business', 'second-member', 'plumbing', 'es', 'internal', 'approved', 'provider', 1, ?)`).bind(at + 168 * hour, at + 168 * hour),
    ...[23, 24, 25, 26].map((date) => db.prepare(`INSERT INTO availability_intervals
      (id, membership_id, week_day_or_date, starts_at, ends_at, kind, source, open_to_cover, recorded_by, recorded_at)
      VALUES (?, 'crew-member', ?, ?, ?, 'available', 'worker', 1, 'crew', 1)`)
      .bind(`hours-${date}`, `2026-11-${date}`, Date.UTC(2026, 10, date, 7), Date.UTC(2026, 10, date, 20))),
    db.prepare(`INSERT INTO terms_versions VALUES ('terms', 'business', 1, 'Provider legal snapshot', 'Terms', 'en', 'Consent', 'hash')`),
  ]);
  async function job(id: string) {
    const place = `${id}-place`;
    await db.batch([
      db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state)
        VALUES (?, 'customer', 'Private alias', 'Private address', 'pending_verification')`).bind(place),
      ...["customer", "delegate", "viewer"].map((actor) => db.prepare(`INSERT INTO place_people (place_id, account_id, verified_from, history_from)
        VALUES (?, ?, 1, 1)`).bind(place, actor)),
      db.prepare(`UPDATE places SET state = 'in_area', named_approver_id = 'customer', area_id = 'area', site_zone = 'Europe/Madrid',
        pin = '{"latitude":0,"longitude":0}' WHERE id = ?`).bind(place),
      ...([["approve", "customer"], ["book", "delegate"], ["view", "viewer"]] as const).map(([grant, actor]) => db.prepare(`INSERT INTO place_grants
        (id, place_id, account_id, capability, issuer_id, valid_from) VALUES (?, ?, ?, ?, 'customer', 1)`)
        .bind(`${place}-${grant}`, place, actor, grant)),
      db.prepare(`INSERT INTO jobs (id, reference, business_id, place_id, requester_id, accountable_foreman_membership_id, trade, origin, state)
        VALUES (?, ?, 'business', ?, 'customer', 'foreman-member', 'carpentry', 'provider', 'open')`).bind(id, `BB-${id.toUpperCase()}`, place),
      db.prepare(`INSERT INTO requests (job_id, original_text, arrival_arrangement, submitted_at) VALUES (?, 'Repair door', 'requester', 2)`).bind(id),
      db.prepare("INSERT INTO quotes (id, job_id) VALUES (?, ?)").bind(`${id}-quote`, id),
      db.prepare(`INSERT INTO quote_versions (id, quote_id, job_id, business_id, no, author_id, terms_id, original_locale,
        scope, exclusions, net_minor, tax_minor, total_minor, currency, state)
        VALUES (?, ?, ?, 'business', 1, 'foreman', 'terms', 'en', 'Door', 'None', 20000, 4000, 24000, 'EUR', 'draft')`)
        .bind(`${id}-version`, `${id}-quote`, id),
      db.prepare("UPDATE quote_versions SET publisher_id = 'provider', issued_at = 2, expires_at = ?, state = 'issued' WHERE id = ?")
        .bind(at + hour, `${id}-version`),
      db.prepare(`INSERT INTO approvals (id, quote_version_id, account_id, grant_id, terms_hash, decision, at)
        VALUES (?, ?, 'customer', ?, 'hash', 'approve', 3)`).bind(`${id}-approval`, `${id}-version`, `${place}-approve`),
      db.prepare("UPDATE quote_versions SET state = 'approved' WHERE id = ?").bind(`${id}-version`),
    ]);
  }
  async function call(actor: Actor, path: string, options?: {
    body: Record<string, unknown>; method?: "POST" | "PATCH"; race?: boolean;
  }) {
    const { batch, query } = db.calls;
    const operationId = options?.body.operationId;
    const response = await app.request(`${origin}/api/v1${path}`, {
      method: options ? options.method ?? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${credentials.find(({ actor: who }) => who === actor)!.token}`,
        ...(options ? { "Content-Type": "application/json" } : {}),
        ...(typeof operationId === "string" ? { [operationIdHeader]: operationId } : {}),
      },
      body: options && JSON.stringify(options.body),
    }, env, execution);
    if (!options?.race) {
      const batched = !!options || path.startsWith("/links/");
      expect(db.calls.batch - batch).toBe(batched ? 1 : 0);
      expect(db.calls.query - query).toBe(batched ? 0 : 1);
    }
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    return { status: response.status, body: await response.json() };
  }
  return { db, job, call, wakes };
}

const windowAt = (id: string, startsAt: number, expiresAt = at + hour) => ({ id, startsAt, endsAt: startsAt + hour, expiresAt });
const booking = (job: string, startsAt: number) => ({
  visitId: `${job}-visit`, approvedQuoteVersionId: `${job}-version`, purpose: { kind: "booking", visitKind: "work", requestId: null },
  windows: [windowAt(`${job}-window`, startsAt)],
});

async function book(f: Awaited<ReturnType<typeof fixture>>, job: string, startsAt: number) {
  const opened = await f.call("foreman", `/jobs/${job}/windows`, { body: write(`${job}-propose`, 0, booking(job, startsAt)) });
  expect(opened.body).toMatchObject({ data: { visit: { state: "planned", revision: 1 } } });
  const confirmed = await f.call("customer", `/windows/${job}-window/confirm`, {
    body: write(`${job}-confirm`, 1, { approvedQuoteVersionId: `${job}-version` }),
  });
  expect(confirmed.body).toMatchObject({ data: { visit: { state: "booked", revision: 2, bookedWindow: { startsAt } } } });
}

test("proposals make no holds; competing jobs consume the one available slot once", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(at);
  const f = await fixture();
  try {
    await f.job("alpha");
    await f.job("beta");
    const starts = at + 3 * hour;
    const proposal = booking("alpha", starts);
    expect((await f.call("foreman", "/jobs/alpha/windows", { body: write("no-quote", 0, { ...proposal, approvedQuoteVersionId: null }) })).status).toBe(409);
    expect((await f.call("other", "/jobs/alpha/windows", { body: write("unauthorized", 0, proposal) })).status).toBe(404);
    for (const job of ["alpha", "beta"]) {
      expect((await f.call("foreman", `/jobs/${job}/windows`, { body: write(`${job}-propose`, 0, booking(job, starts)) })).status).toBe(200);
    }
    const dest = await f.db.prepare(`SELECT t.token FROM notifications n JOIN link_targets t ON t.token = n.link_token
      AND t.required_scope = n.context_id JOIN effect_outbox e ON e.resource_ref = n.id AND e.kind = 'notification_push'
      WHERE t.kind = 'job_update' AND t.resource_id = 'alpha' AND n.kind = 'visit_windows_offered'
        AND n.context_id = 'customer-context'`).first<string>("token");
    expect(dest).toBeTruthy();
    expect((await f.call("customer", `/links/${dest}`)).body).toMatchObject({
      data: { kind: "job", record: { audience: "customer", job: { jobId: "alpha", view: "whole" } } },
    });
    expect(await f.db.prepare("SELECT count(*) AS total FROM shifts").first("total")).toBe(0);
    const windows = await f.call("customer", "/jobs/alpha/windows");
    expect(windows.body).toMatchObject({ data: { visits: [{ bookedWindow: null, offeredWindows: [{ confirmationMode: "booking" }] }] } });
    expect(JSON.stringify(windows.body)).not.toMatch(/crew-member|Private address|capacity/);
    expect((await f.call("viewer", "/jobs/alpha/windows")).body).toMatchObject({ data: { visits: [{ offeredWindows: [{ confirmationMode: null }] }] } });
    const confirm = (job: string, actor: Actor, race = false) => f.call(actor, `/windows/${job}-window/confirm`, {
      body: write(`${job}-confirm`, 1, { approvedQuoteVersionId: `${job}-version` }), race,
    });
    expect((await confirm("alpha", "viewer")).status).toBe(404);
    const { batch, query } = f.db.calls;
    const [a, b] = await Promise.all([confirm("alpha", "delegate", true), confirm("beta", "customer", true)]);
    expect(f.db.calls.batch - batch).toBe(2);
    expect(f.db.calls.query - query).toBe(0);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? "alpha" : "beta";
    const loser = winner === "alpha" ? "beta" : "alpha";
    expect((winner === "alpha" ? b : a).body).toMatchObject({ error: { code: "CONFLICT", current: { kind: "window_unavailable" } } });
    expect((await confirm(winner, winner === "alpha" ? "delegate" : "customer")).body)
      .toMatchObject({ data: { visit: { id: `${winner}-visit`, state: "booked", offeredWindows: [] } } });
    expect(await f.db.prepare("SELECT count(*) AS total FROM operation_receipts WHERE command = 'schedule.confirm_window'").first("total")).toBe(1);
    expect(await f.db.prepare("SELECT count(*) AS total FROM shift_slots").first("total")).toBe(1);
    expect(f.wakes).toHaveLength(3);
    const shift = await f.db.prepare("SELECT id, visit_id, skill, briefing_language FROM shifts").first<{ id: string }>();
    expect(shift).toMatchObject({ visit_id: `${winner}-visit`, skill: "carpentry", briefing_language: "es" });
    expect((await f.call("foreman", `/shifts/${shift!.id}`)).body).toMatchObject({ data: { view: "foreman", slots: [{ number: 1, isLead: true }] } });
    expect((await f.call("other", `/shifts/${shift!.id}`)).status).toBe(404);
    expect((await f.call("crew", `/shifts/${shift!.id}`)).status).toBe(404);
    expect((await f.call("crew", "/shifts")).body).toMatchObject({ data: { segment: "upcoming", rows: [], total: 0 } });
    expect((await f.call("second", "/shifts?segment=offers")).body).toMatchObject({ data: { segment: "offers", rows: [] } });
    expect((await f.call("foreman", `/businesses/business/schedule?jobId=${loser}&weekOf=2026-11-23`)).body)
      .toMatchObject({ data: { capacity: { state: "ready", days: [{ date: "2026-11-23", lanes: [{ membershipId: "crew-member" }] },
        ...Array.from({ length: 6 }, () => expect.anything())] } } });
    expect((await f.call("other", `/businesses/business/schedule?jobId=${loser}`)).status).toBe(404);
  } finally { f.db.close(); clock.mockRestore(); }
});

test("short-notice reschedule waits for agreement, then moves the one shift; pre-start cancellation is fee-free", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(at);
  const f = await fixture();
  try {
    await f.job("alpha");
    await book(f, "alpha", at + 8 * hour);
    const replacement = { ...booking("alpha", at + 25 * hour), windows: [windowAt("revision", at + 25 * hour)] };
    const path = "/visits/alpha-visit";
    const direct = { ...replacement, purpose: { kind: "direct_alternative", replacesWindowId: "alpha-window" } };
    expect((await f.call("foreman", "/jobs/alpha/windows", { body: write("too-late-direct", 2, direct) })).status).toBe(409);
    const requested = await f.call("customer", `${path}/request-reschedule`, { body: write("ask", 2, { id: "request", bookedWindowId: "alpha-window" }) });
    expect(requested.body).toMatchObject({ data: { visit: { revision: 3, bookedWindow: { id: "alpha-window" },
      rescheduleRequest: { id: "request", state: "requested" } } } });
    const shift = await f.db.prepare("SELECT id, starts_at FROM shifts").first();
    const agreed = { ...replacement, purpose: { kind: "agreement", replacesWindowId: "alpha-window", requestId: "request" } };
    expect((await f.call("foreman", "/jobs/alpha/windows", { body: write("agreement", 3, agreed) })).body).toMatchObject({ data: { visit: {
      bookedWindow: { id: "alpha-window" }, rescheduleRequest: { state: "proposed" }, offeredWindows: [{ confirmationMode: "agreed_reschedule" }],
    } } });
    expect(await f.db.prepare("SELECT id, starts_at FROM shifts").first()).toEqual(shift);
    expect((await f.call("customer", "/windows/revision/confirm", { body: write("confirm-agreement", 4, { approvedQuoteVersionId: "alpha-version" }) })).body)
      .toMatchObject({ data: { visit: { revision: 5, bookedWindow: { id: "revision" }, rescheduleRequest: { state: "accepted" }, actions: { canCancelFeeFree: true } } } });
    expect(await f.db.prepare("SELECT id, starts_at FROM shifts").first()).toMatchObject({ ...shift, starts_at: at + 25 * hour });
    expect(await f.db.prepare("SELECT state FROM visit_windows WHERE id = 'alpha-window'").first("state")).toBe("superseded");
    const cancelled = await f.call("customer", `${path}/cancel`, { body: write("cancel", 5, { bookedWindowId: "revision" }) });
    expect(cancelled.body).toMatchObject({ data: { visit: { state: "cancelled", bookedWindow: null, cancellation: { at, byViewer: true },
      actions: { canCancelFeeFree: false } } } });
    expect(await f.db.prepare("SELECT state FROM shifts").first("state")).toBe("cancelled");
    expect(await f.db.prepare("SELECT state FROM quote_versions WHERE id = 'alpha-version'").first("state")).toBe("approved");
  } finally { f.db.close(); clock.mockRestore(); }
});

test("a like-for-like alternative is direct at exactly 24 hours, and withdrawing it never moves the visit", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(at);
  const f = await fixture();
  try {
    await f.job("alpha");
    await book(f, "alpha", at + 24 * hour);
    const revised = (id: string) => ({ ...booking("alpha", at + 48 * hour),
      purpose: { kind: "direct_alternative", replacesWindowId: "alpha-window" }, windows: [windowAt(id, at + 48 * hour)] });
    const open = await f.call("foreman", "/jobs/alpha/windows", { body: write("first-alternative", 2, revised("alt-one")) });
    const staffed = await f.db.prepare(`SELECT sh.id, slot.id AS slot FROM shifts sh JOIN shift_slots slot ON slot.shift_id = sh.id
      WHERE sh.visit_id = 'alpha-visit'`).first<{ id: string; slot: string }>();
    if (!staffed) throw new Error("Expected the booked shift");
    await f.db.prepare(`INSERT INTO assignments (id, slot_id, worker_membership_id, source, state, confirmed_by, confirmed_at, starts_at, ends_at)
      VALUES ('initial-assignment', ?, 'crew-member', 'ordinary', 'confirmed', 'foreman', ?, ?, ?)`)
      .bind(staffed.slot, at, at + 24 * hour, at + 25 * hour).run();
    expect(open.body).toMatchObject({ data: { visit: { bookedWindow: { id: "alpha-window" }, offeredWindows: [{ confirmationMode: "direct_reschedule" }] } } });
    expect((await f.call("foreman", "/windows/alt-one/withdraw", { body: write("withdraw", 3, {}) })).body)
      .toMatchObject({ data: { visit: { revision: 4, bookedWindow: { id: "alpha-window" }, offeredWindows: [] } } });
    expect((await f.call("foreman", "/jobs/alpha/windows", { body: write("second-alternative", 4, revised("alt-two")) })).status).toBe(200);
    expect((await f.call("customer", "/windows/alt-two/confirm", { body: write("confirm-alternative", 5, { approvedQuoteVersionId: "alpha-version" }) })).body)
      .toMatchObject({ data: { visit: { bookedWindow: { id: "alt-two" } } } });
    expect(await f.db.prepare("SELECT state, starts_at FROM shifts WHERE id = ?").bind(staffed.id).first())
      .toEqual({ state: "cancelled", starts_at: at + 24 * hour });
    expect(await f.db.prepare("SELECT state FROM assignments WHERE id = 'initial-assignment'").first("state")).toBe("released");
    expect(await f.db.prepare("SELECT starts_at FROM shifts WHERE state = 'planned'").first("starts_at")).toBe(at + 48 * hour);
    await f.db.prepare(`INSERT INTO visit_activity_events (id, visit_id, actor_id, kind, at)
      VALUES ('early-work', 'alpha-visit', 'foreman', 'work_started', ?)`).bind(at).run();
    expect((await f.call("customer", "/visits/alpha-visit/cancel", { body: write("actual-start", 6, { bookedWindowId: "alt-two" }) })).status).toBe(409);
    clock.mockReturnValue(at + 48 * hour);
    expect((await f.call("customer", "/visits/alpha-visit/cancel", { body: write("after-start", 6, { bookedWindowId: "alt-two" }) })).status).toBe(409);
  } finally { f.db.close(); clock.mockRestore(); }
});

test("availability honors worker scope, stale bases, attributed correction and matching sync projections", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(at);
  const f = await fixture();
  try {
    const path = "/crew/crew-member/availability";
    const payload = { date: "2026-11-23", kind: "unavailable", expectedConfirmedShifts: [] };
    const edit = { method: "PATCH", body: write("worker-edit", 0, payload) } as const;
    expect((await f.call("second", path)).status).toBe(404);
    expect((await f.call("second", path, edit)).status).toBe(404);
    expect((await f.call("crew", path, edit)).body).toMatchObject({ data: { day: { revision: 1, preference: { kind: "unavailable", source: "worker" } } } });
    expect((await f.call("crew", path, { ...edit, body: write("no-change", 1, payload) })).status).toBe(200);
    expect(await f.db.prepare("SELECT operation_id FROM operation_receipts WHERE operation_id = 'no-change'").first()).toBeNull();
    const correction = { ...payload, kind: "available", hours: [{ startsAt: at, endsAt: at + 2 * hour }], openToCover: false };
    expect((await f.call("foreman", path, { ...edit, body: write("ungranted", 1, correction) })).status).toBe(404);
    expect((await f.call("provider", path, { ...edit, body: write("stale", 0, correction) })).body)
      .toMatchObject({ error: { code: "STALE_REVISION", current: { kind: "revision", revision: 1 } } });
    expect((await f.call("provider", path, { ...edit, body: write("corrected", 1, correction) })).body)
      .toMatchObject({ data: { day: { revision: 2, preference: { kind: "available", source: "employer" } } } });
    const dest = await f.db.prepare(`SELECT t.token FROM notifications n JOIN link_targets t ON t.token = n.link_token
      AND t.required_scope = n.context_id JOIN effect_outbox e ON e.resource_ref = n.id AND e.kind = 'notification_push'
      WHERE n.kind = 'availability_corrected' AND n.context_id = 'crew-context' AND t.kind = 'crew_availability'`).first<string>("token");
    expect(dest).toBeTruthy();
    const opened = resultSchema(openLinkRoute.output).parse((await f.call("crew", `/links/${dest}`)).body);
    expect(opened).toMatchObject({ data: { kind: "crew_availability", date: payload.date,
      availability: { membershipId: "crew-member", days: expect.arrayContaining([{ date: payload.date, revision: 2,
        confirmedShifts: [], preference: expect.objectContaining({ source: "employer" }) }]) } } });
    expect((await f.call("second", `/links/${dest}`)).body).toMatchObject({ data: { kind: "unavailable", reason: "unavailable" } });
    expect(await f.db.prepare("SELECT recorded_by FROM availability_intervals WHERE membership_id = 'crew-member' AND week_day_or_date = '2026-11-23'").first("recorded_by")).toBe("provider");
    const week = await f.call("crew", `${path}?weekOf=2026-11-25`);
    expect(week.body).toMatchObject({ data: { membershipId: "crew-member", siteZone: "Europe/Madrid", days: [
      { date: "2026-11-23", revision: 2, confirmedShifts: [] }, ...Array.from({ length: 6 }, () => expect.anything()),
    ] } });
    for (const actor of ["crew", "second"] as const) {
      const page = resultSchema(syncRoute.output).parse((await f.call(actor, "/sync", {
        body: { contextId: `${actor}-context`, operations: [], cursor: null },
      })).body);
      expect(page.ok).toBe(true);
      if (!page.ok) throw new Error(JSON.stringify(page));
      expect(page.data.upserts.filter(({ kind }) => kind === "shift_agenda" || kind === "crew_availability")
        .map(({ kind, resourceId }) => ({ kind, resourceId }))).toEqual([
        { kind: "crew_availability", resourceId: `${actor}-member` }, { kind: "shift_agenda", resourceId: `${actor}-member` },
      ]);
    }
  } finally { f.db.close(); clock.mockRestore(); }
});

test("worker reads only their confirmed shift, their named offer, and an address-free sync agenda", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(at);
  const f = await fixture();
  try {
    const start = at + 3 * hour;
    await f.job("alpha");
    await f.job("beta");
    await book(f, "alpha", start);
    await book(f, "beta", start + 2 * hour);
    const { results: shifts } = await f.db.prepare(`SELECT sh.id, sh.starts_at, sh.ends_at, slot.id AS slot
      FROM shifts sh JOIN shift_slots slot ON slot.shift_id = sh.id ORDER BY sh.starts_at`)
      .all<{ id: string; starts_at: number; ends_at: number; slot: string }>();
    const [own, other] = shifts;
    if (!own || !other) throw new Error("Expected two booked shifts");
    await f.db.batch([
      ...([[own, "crew"], [other, "second"]] as const).map(([item, worker]) => {
        return f.db.prepare(`INSERT INTO assignments (id, slot_id, worker_membership_id, source, state, confirmed_by, confirmed_at, starts_at, ends_at)
          VALUES (?, ?, ?, 'ordinary', 'confirmed', 'foreman', ?, ?, ?)`)
          .bind(`${worker}-assignment`, item.slot, `${worker}-member`, at, item.starts_at, item.ends_at);
      }),
      f.db.prepare("INSERT INTO shift_slots (id, shift_id, number) VALUES ('offer-slot', ?, 2)").bind(other.id),
      f.db.prepare(`INSERT INTO assignment_offers (id, slot_id, recipient_id, issued_by, issued_at, expires_at, state)
        VALUES ('crew-offer', 'offer-slot', 'crew-member', 'foreman', ?, ?, 'offered')`).bind(at, at + hour),
      f.db.prepare("INSERT INTO safety_holds (id, assignment_id, kind, state) VALUES ('briefing', 'crew-assignment', 'briefing', 'active')"),
    ]);
    const agenda = await f.call("crew", "/shifts");
    expect(agenda.body).toMatchObject({ data: { segment: "upcoming", total: 1,
      rows: [{ shift: { id: own.id }, assignment: { id: "crew-assignment" }, nextAction: "check_briefing" }] } });
    const offer = await f.call("crew", "/shifts?segment=offers");
    expect(offer.body).toMatchObject({ data: { segment: "offers", rows: [{ kind: "offer", id: "crew-offer", state: "offered" }] } });
    expect(JSON.stringify(offer.body)).not.toMatch(/Private alias|customer|second-assignment/);
    expect((await f.call("crew", `/shifts/${other.id}`)).status).toBe(404);
    expect((await f.call("second", `/shifts/${own.id}`)).status).toBe(404);
    const detail = await f.call("crew", `/shifts/${own.id}`);
    expect(detail.body).toMatchObject({ data: { view: "worker", shift: { id: own.id, placeAlias: "Private alias" },
      assignment: { id: "crew-assignment" }, holds: [{ id: "briefing" }] } });
    expect(detail.body.data).not.toHaveProperty("slots");
    expect((await f.call("foreman", `/shifts/${own.id}`)).body).toMatchObject({ data: { view: "foreman",
      slots: [{ assignments: [{ member: { id: "crew-member" }, confirmedByName: "foreman name" }] }] } });
    const board = await f.call("foreman", "/businesses/business/schedule?jobId=beta");
    expect(board.body.data.capacity.days[0].lanes).toMatchObject([{ membershipId: "crew-member",
      busy: [{ startsAt: own.starts_at, endsAt: own.ends_at }] }]);
    expect(board.body.data.capacity.days[0].lanes[0].busy[0]).toEqual({ startsAt: own.starts_at, endsAt: own.ends_at });
    const sync = ({ cursor = null }: { cursor?: string | null } = {}) => f.call("crew", "/sync", {
      body: { contextId: "crew-context", operations: [], cursor },
    });
    const snapshot = resultSchema(syncRoute.output).parse((await sync()).body);
    if (!snapshot.ok) throw new Error(JSON.stringify(snapshot));
    const cached = snapshot.data.upserts.find(({ kind }) => kind === "shift_agenda");
    expect(cached).toMatchObject({ resourceId: "crew-member", value: { rows: [{ shift: { id: own.id } }] } });
    expect(JSON.stringify(cached)).not.toMatch(/Private alias|BB-ALPHA|placeAlias|visitId|second-assignment/);
    expect(snapshot.data.upserts.find(({ kind }) => kind === "worker_field_shift"))
      .toMatchObject({ resourceId: "crew-assignment", value: { state: "confirmed" } });
    expect(snapshot.data.upserts).toContainEqual(expect.objectContaining({ kind: "assignment_briefing", resourceId: "crew-assignment" }));
    const changeDay = { date: "2026-11-23", kind: "unavailable" };
    const edit = (id: string, basis: unknown[]) => f.call("crew", "/crew/crew-member/availability", {
      method: "PATCH", body: write(id, 0, { ...changeDay, expectedConfirmedShifts: basis }),
    });
    expect((await edit("stale-basis", [])).status).toBe(409);
    expect((await edit("correct-basis", [{ assignmentId: "crew-assignment", startsAt: own.starts_at, endsAt: own.ends_at }])).body)
      .toMatchObject({ data: { day: { confirmedShifts: [{ assignmentId: "crew-assignment", conflictsWithPreference: true }] } } });
    expect(await f.db.prepare("SELECT state FROM assignments WHERE id = 'crew-assignment'").first("state")).toBe("confirmed");
    expect((await f.call("customer", "/jobs/alpha/windows")).body).toMatchObject({ data: { visits: [
      { bookedWindow: { crewAvailability: "as_agreed" } },
    ] } });
    const cancelled = await f.call("customer", "/visits/alpha-visit/cancel", { body: write("cancel-staffed", 2, { bookedWindowId: "alpha-window" }) });
    expect(cancelled.status).toBe(200);
    expect(await f.db.prepare("SELECT state FROM assignments WHERE id = 'crew-assignment'").first("state")).toBe("released");
    const delta = resultSchema(syncRoute.output).parse((await sync({ cursor: snapshot.data.cursor })).body);
    if (!delta.ok) throw new Error(JSON.stringify(delta));
    expect(delta.data.upserts.find(({ kind }) => kind === "shift_agenda")).toMatchObject({ value: { rows: [] } });
    expect(delta.data.removals).toEqual(expect.arrayContaining([
      { kind: "assignment_briefing", resourceId: "crew-assignment" },
      { kind: "worker_field_shift", resourceId: "crew-assignment" },
    ]));
    expect((await f.call("crew", `/shifts/${own.id}`)).status).toBe(404);
    expect((await f.call("crew", "/shifts?segment=past")).body).toMatchObject({ data: { rows: [
      { shift: { id: own.id, placeAlias: null }, outcome: "cancelled", endedAt: at },
    ] } });
  } finally { f.db.close(); clock.mockRestore(); }
});

test("Past shift agenda looks up history by the scoped worker rather than scanning assignments", async () => {
  const db = await createTestD1();
  try {
    const { sql, params } = readShiftAgenda({
      sql: "WITH acting_session AS (SELECT 1), live_scope AS (SELECT 'crew-context' AS context_id, 'worker' AS role, 'business' AS business_id)",
      params: [],
    }, at, "past", { key: null, id: "" });
    const { results } = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params ?? []).all<{ detail: string }>();
    expect(results.map(({ detail }) => detail)).toContainEqual(expect.stringMatching(/SEARCH a .*assignments_worker_history \(worker_membership_id=\?\)/));
  } finally { db.close(); }
});

test("shift detail gives the foreman only the current cover gap for each slot", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(at);
  const f = await fixture();
  try {
    const start = at + 3 * hour, end = start + hour;
    await f.job("alpha");
    await book(f, "alpha", start);
    const shift = await f.db.prepare(`SELECT sh.id, slot.id AS slot FROM shifts sh
      JOIN shift_slots slot ON slot.shift_id = sh.id WHERE sh.visit_id = 'alpha-visit'`).first<{ id: string; slot: string }>();
    if (!shift) throw new Error("Expected a booked shift");
    await f.db.batch([
      f.db.prepare(`INSERT INTO shift_slots (id, shift_id, number) VALUES ('second-slot', ?, 2)`).bind(shift.id),
      f.db.prepare(`INSERT INTO assignments (id, slot_id, worker_membership_id, source, state, confirmed_by,
        confirmed_at, starts_at, ends_at, dropped_at, dropout_reported_by, dropout_source)
        VALUES ('dropped', ?, 'crew-member', 'ordinary', 'dropped', 'crew', ?, ?, ?, ?, 'crew', 'self'),
          ('remaining', 'second-slot', 'second-member', 'ordinary', 'confirmed', 'second', ?, ?, ?, NULL, NULL, NULL)`)
        .bind(shift.slot, at, start, end, at, at, start, end),
      f.db.prepare(`INSERT INTO cover_gaps (id, slot_id, prior_assignment_id, safe_cutoff, state)
        VALUES ('gap', ?, 'dropped', ?, 'open')`).bind(shift.slot, start),
    ]);
    const path = `/shifts/${shift.id}`;
    expect((await f.call("foreman", path)).body).toMatchObject({ data: {
      nextAction: "find_cover", slots: [{ id: shift.slot, coverGapId: "gap" }, { id: "second-slot", coverGapId: null }],
    } });
    const worker = await f.call("second", path);
    expect(worker.body).toMatchObject({ data: { view: "worker" } });
    expect(JSON.stringify(worker.body)).not.toContain("coverGapId");
    expect((await f.call("customer", path)).status).toBe(404);
    await f.db.prepare("UPDATE cover_gaps SET state = 'closed', closed_at = ? WHERE id = 'gap'").bind(at).run();
    expect((await f.call("foreman", path)).body.data.slots[0]).toMatchObject({ coverGapId: null });
  } finally { f.db.close(); clock.mockRestore(); }
});
