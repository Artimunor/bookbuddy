import { expect, spyOn, test } from "bun:test";
import {
  bookSessionHoldRoute, cancelSessionBookingRoute, createSessionHoldRoute, getSessionBookingFeedbackRoute, getSessionBookingRoute,
  getSessionRoute, listSessionsRoute, moveSessionBookingRoute, openLinkRoute, operationIdHeader, recordSessionAttendanceRoute,
  releaseSessionHoldRoute, respondToSessionChangeRoute, resultSchema, submitSessionBookingFeedbackRoute, syncRoute,
} from "@bookbuddy/api-contract";
import type { ResponseSchema } from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential } from "../src/modules/auth/session";
import { createTestD1 } from "./d1";
import type { TestD1 } from "./d1";

const origin = "https://bookbuddy.test";
const now = Date.parse("2026-11-23T09:41:00Z");
const minute = 60_000;
const morning = Date.parse("2026-11-28T09:00:00Z");
const afternoon = morning + 90 * minute;
const duration = 45 * minute;
const accepted = { listingVersionId: "v1", termsHash: "hash-1", totalMinor: 1600 };
const command = (operationId: string, payload: unknown) => ({ operationId, payload });
const hold = (id: string, slotId = "morning", extra = {}) => command(`op-${id}`, { id, slotId, places: 1, ...extra });
const book = (id: string, terms = accepted) => command(`op-${id}`, { id, ...terms });
const bookers = ["booker", "other"] as const;
const actors = [...bookers, "coordinator"] as const;
type Actor = typeof actors[number];

type RequestBody = { operationId?: string } | { contextId: string; operations: []; cursor: string | null };
interface TestResponse { status: number; body: unknown }
interface Fixture {
  db: TestD1;
  call(actor: Actor, path: string, body?: RequestBody, race?: boolean): Promise<TestResponse>;
}
function version(db: TestD1, id: string, no: number, hash: string, price: number, language = "en", listing = "listing") {
  return db.prepare(`INSERT INTO session_listing_versions (
    id, listing_id, business_id, no, venue_id, title, description, original_locale, language, format, duration_ms,
    price_minor, currency, price_basis, terms_text, terms_locale, terms_hash, cancellation_notice_ms, created_by_id, created_at
  ) VALUES (?, ?, 'provider', ?, 'venue', 'Mat Pilates', 'Small group class', 'en', ?, 'group', ?,
    ?, 'EUR', 'per_person', 'Pay the provider in person. Free to cancel before start.', 'en', ?, 0, 'coordinator', 1)`)
    .bind(id, listing, no, language, duration, price, hash);
}

function slot(db: TestD1, id: string, start: number, versionId: string, capacity: number, listing = "listing") {
  return db.prepare(`INSERT INTO session_slots (id, listing_id, listing_version_id, business_id, starts_at, ends_at, capacity,
    hosts_required, coordinator_membership_id, state, updated_at)
    VALUES (?, ?, ?, 'provider', ?, ?, ?, 1, 'team', 'published', 1)`).bind(id, listing, versionId, start, start + duration, capacity);
}

async function fixture(): Promise<Fixture> {
  const db = await createTestD1();
  const app = createApp().onError((error) => { throw error; });
  const env = { DB: db, SYNC_CURSOR_HMAC_KEY: "a-test-only-sync-cursor-key-for-sessions" } as Bindings;
  const execution = { waitUntil() {}, passThroughOnException() {} };
  const credentials = await Promise.all(actors.map(async (actor) => {
    const token = randomToken();
    return { actor, token, digest: await hashSessionCredential(token) };
  }));
  await db.batch([
    db.prepare(`INSERT INTO operating_areas VALUES ('area', 'Demo area', 'Europe/Madrid', '[0]'), ('off-area', 'Off area', 'Europe/Madrid', '[0]')`),
    db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
      VALUES ('provider', 'Demo Studio SL', 'Demo Studio', 'studio@example.test', 'area', 'approved')`),
    db.prepare(`INSERT INTO accounts (id, email_normalized, display_name, verified_at, state) VALUES
      ('coordinator', 'coordinator@example.test', 'Marina', 1, 'active'),
      ('host', 'host@example.test', 'Elena', 1, 'active'), ('substitute', 'substitute@example.test', 'Lucía', 1, 'active')`),
    db.prepare(`INSERT INTO memberships VALUES ('team', 'provider', 'coordinator', 'active'),
      ('host-team', 'provider', 'host', 'active'), ('substitute-team', 'provider', 'substitute', 'active')`),
    db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at)
      VALUES ('coordinator-role', 'team', 'provider', 'coordinator', 'foreman', 1)`),
    ...credentials.flatMap(({ actor, digest }) => [
      ...(actor === "coordinator" ? [
        db.prepare(`INSERT INTO account_contexts (id, account_id, role, business_id, role_grant_id)
          VALUES ('coordinator-context', 'coordinator', 'foreman', 'provider', 'coordinator-role')`),
      ] : [
        db.prepare("INSERT INTO accounts (id, email_normalized, display_name, verified_at, state) VALUES (?, ?, ?, 1, 'active')")
          .bind(actor, `${actor}@example.test`, actor === "booker" ? "Claire" : "Jo"),
        db.prepare("INSERT INTO account_contexts (id, account_id, role) VALUES (?, ?, 'customer')").bind(`${actor}-context`, actor),
      ]),
      db.prepare(`INSERT INTO sessions (id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
        VALUES (?, ?, ?, ?, 'device', 1, ?)`).bind(`${actor}-session`, actor, digest, `${actor}-context`, morning + 7 * 86400_000),
    ]),
    db.prepare(`INSERT INTO venues (id, business_id, area_id, site_zone, name, locality, address, access_note, arrival_note, state, approved_at)
      VALUES ('venue', 'provider', 'area', 'Europe/Madrid', 'Demo Studio', 'Xàbia', 'Demo address', 'Step-free', 'Reception', 'approved', 1)`),
    db.prepare("INSERT INTO session_listings (id, business_id, category) VALUES ('listing', 'provider', 'pilates'), ('disabled', 'provider', 'massage')"),
    version(db, "v1", 1, "hash-1", 1600), version(db, "v2", 2, "hash-2", 2200, "es"),
    version(db, "disabled-v1", 1, "not-public", 1000, "en", "disabled"),
    slot(db, "morning", morning, "v1", 1), slot(db, "afternoon", afternoon, "v2", 1),
    slot(db, "disabled-slot", morning, "disabled-v1", 1, "disabled"),
    db.prepare(`INSERT INTO session_host_assignments (id, slot_id, business_id, membership_id, position, role_label, language,
      state, changed_at, changed_by_id, confirmed_at)
      VALUES ('original-host', 'morning', 'provider', 'host-team', 1, 'Instructor', 'en', 'confirmed', 1, 'coordinator', 1)`),
    db.prepare("INSERT INTO feature_flags VALUES ('sessions', 'area:pilates', 1, 1), ('sessions', 'off-area:pilates', 0, 1), ('sessions', 'provider', 1, 1)"),
  ]);
  async function call(actor: Actor, path: string, body?: RequestBody, race = false): Promise<TestResponse> {
    const before = { ...db.calls };
    const operationId = body && "operationId" in body ? body.operationId : undefined;
    const response = await app.request(`${origin}/api/v1${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${credentials.find((entry) => entry.actor === actor)!.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(operationId ? { [operationIdHeader]: operationId } : {}),
      }, body: body && JSON.stringify(body),
    }, env, execution);
    if (!race) {
      const batch = Boolean(body) || path.startsWith("/links/");
      expect(db.calls.batch - before.batch).toBe(batch ? 1 : 0);
      expect(db.calls.query - before.query).toBe(batch ? 0 : 1);
    }
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    return { status: response.status, body: await response.json() };
  }
  return { db, call };
}

async function withSessions(run: (f: Fixture, clock: { now: number }) => Promise<void>) {
  const f = await fixture();
  const clock = { now };
  const mocked = spyOn(Date, "now").mockImplementation(() => clock.now);
  try { await run(f, clock); } finally { mocked.mockRestore(); f.db.close(); }
}

function data<Output extends ResponseSchema>(route: { output: Output }, response: { status: number; body: unknown }) {
  expect(response.status).toBe(200);
  const result = resultSchema(route.output).parse(response.body);
  if (!result.ok) throw new Error(result.error.code);
  return result.data;
}

function status(response: { status: number; body: unknown }, http: number, code: string) {
  expect(response.status).toBe(http);
  expect(response.body).toMatchObject({ ok: false, error: { code } });
}

async function bookMorning(f: Fixture) {
  expect(data(createSessionHoldRoute, await f.call("booker", "/sessions/listing/holds", hold("hold"))).status).toBe("held");
  const result = data(bookSessionHoldRoute, await f.call("booker", "/holds/hold/book", book("booking")));
  if (result.status !== "booked") throw new Error(result.failure.reason);
  return result.booking;
}

test("browse filters in one read and paginates by next start and listing", () => withSessions(async (f) => {
  const range = `startsFrom=${afternoon}&startsBefore=${afternoon + 1}`;
  const filtered = data(listSessionsRoute, await f.call("booker", `/sessions?areaId=area&locality=X%C3%A0bia&category=pilates&language=es&${range}`));
  expect(filtered).toMatchObject({ categories: ["pilates"], sessions: [{ id: "listing", version: { id: "v2", price: { paymentMethod: "pay_provider" } }, nextSlot: { id: "afternoon" } }] });
  for (const filter of ["locality=Elsewhere", `language=en&${range}`, `startsBefore=${morning}`]) {
    expect(data(listSessionsRoute, await f.call("booker", `/sessions?areaId=area&${filter}`)).sessions).toEqual([]);
  }
  const detail = data(getSessionRoute, await f.call("booker", "/sessions/listing"));
  expect(detail).toMatchObject({ audience: "customer", nextSlotId: "morning", availability: "available", slots: [
    { id: "morning", placesLeft: 1, freeCancellationUntil: morning, host: { name: "Elena", confirmed: { byName: "Marina" } } },
    { id: "afternoon", placesLeft: 1 },
  ], versions: [{ id: "v1", venue: { siteZone: "Europe/Madrid" }, terms: { hash: "hash-1" } }, { id: "v2" }] });
  status(await f.call("booker", "/sessions/disabled"), 404, "NOT_FOUND");
  await f.db.batch(Array.from({ length: 31 }, (_, i) => {
    const id = `listing-${String(i).padStart(2, "0")}`;
    return [f.db.prepare("INSERT INTO session_listings (id, business_id, category) VALUES (?, 'provider', 'pilates')").bind(id),
      version(f.db, `${id}-version`, 1, "hash", 1600, "en", id), slot(f.db, `${id}-slot`, morning, `${id}-version`, 1, id)];
  }).flat());
  const first = data(listSessionsRoute, await f.call("booker", "/sessions?areaId=area"));
  expect(first.sessions).toHaveLength(30);
  expect(first.page.hasMore).toBe(true);
  const last = data(listSessionsRoute, await f.call("booker", `/sessions?areaId=area&cursor=${first.page.cursor}`));
  expect(last.sessions.map(({ id }) => id)).toEqual(["listing-29", "listing-30"]);
  expect(last.page).toEqual({ cursor: null, hasMore: false });
}));

test("losing the last place cannot create a hold; the winner cannot hold a second slot", () => withSessions(async (f) => {
  const before = { ...f.db.calls };
  const outcomes = await Promise.all(bookers.map(async (actor) => ({ actor,
    result: data(createSessionHoldRoute, await f.call(actor, "/sessions/listing/holds", hold(`hold-${actor}`), true)),
  })));
  expect(f.db.calls).toMatchObject({ batch: before.batch + 2, query: before.query });
  const winner = outcomes.find(({ result }) => result.status === "held");
  if (!winner) throw new Error("No hold won");
  expect(winner.result).toMatchObject({ expiresAt: now + 10 * minute, agreement: { places: 1, totalMinor: 1600 } });
  const loser = outcomes.find(({ actor }) => actor !== winner.actor)!;
  expect(loser.result).toEqual({ status: "not_held", reason: "places_unavailable", slotId: "morning", placesLeft: 0 });
  expect(data(createSessionHoldRoute, await f.call(winner.actor, "/sessions/listing/holds", hold("second", "afternoon"))))
    .toMatchObject({ status: "not_held", reason: "active_hold_exists" });
  expect(await f.db.prepare("SELECT id, state FROM session_holds").first()).toEqual({ id: `hold-${winner.actor}`, state: "held" });
  expect(data(releaseSessionHoldRoute, await f.call(winner.actor, `/holds/hold-${winner.actor}/release`, command("release", {}))))
    .toMatchObject({ state: "released", resolvedAt: now });
  expect(data(createSessionHoldRoute, await f.call(loser.actor, "/sessions/listing/holds", hold("retry"))).status).toBe("held");
}));

test("holds expire at the deadline and release capacity without cleanup calls", () => withSessions(async (f, clock) => {
  clock.now = morning - minute;
  const held = data(createSessionHoldRoute, await f.call("booker", "/sessions/listing/holds", hold("short")));
  expect(held).toMatchObject({ status: "held", expiresAt: morning });
  clock.now = morning;
  expect(data(bookSessionHoldRoute, await f.call("booker", "/holds/short/book", book("expired"))))
    .toEqual({ status: "not_booked", failure: { reason: "expired", expiresAt: morning } });
  expect(data(createSessionHoldRoute, await f.call("booker", "/sessions/listing/holds", hold("fresh", "afternoon"))).status).toBe("held");
  expect(await f.db.prepare("SELECT state FROM session_holds WHERE id = 'short'").first("state")).toBe("released");
}));

test("booking requires the exact active version, terms hash and total; receipts replay without a second booking", () => withSessions(async (f) => {
  expect(data(createSessionHoldRoute, await f.call("booker", "/sessions/listing/holds", hold("hold"))).status).toBe("held");
  for (const [id, terms] of [
    ["version", { ...accepted, listingVersionId: "v2" }], ["hash", { ...accepted, termsHash: "hash-2" }], ["total", { ...accepted, totalMinor: 1 }],
  ] as const) {
    expect(data(bookSessionHoldRoute, await f.call("booker", "/holds/hold/book", book(id, terms))))
      .toMatchObject({ status: "not_booked", failure: { reason: "terms_changed", current: { version: { id: "v1", terms: { hash: "hash-1" } } } } });
  }
  const booked = data(bookSessionHoldRoute, await f.call("booker", "/holds/hold/book", book("booking")));
  expect(booked).toMatchObject({ status: "booked", booking: { id: "booking", original: { slotId: "morning", listingVersionId: "v1", termsHash: "hash-1" },
    agreement: { totalMinor: 1600, version: { price: { basis: "per_person", paymentMethod: "pay_provider" } } } } });
  expect(data(bookSessionHoldRoute, await f.call("booker", "/holds/hold/book", book("booking")))).toEqual(booked);
  status(await f.call("booker", "/holds/hold/book", command("op-booking", { id: "different", ...accepted })), 409, "OPERATION_ID_REUSED");
  await f.db.batch([f.db.prepare("UPDATE session_slots SET listing_version_id = 'v2' WHERE id = 'morning'")]);
  expect(data(getSessionBookingRoute, await f.call("booker", "/session-bookings/booking")))
    .toMatchObject({ agreement: { version: { id: "v1", terms: { hash: "hash-1" } }, startsAt: morning, endsAt: morning + duration } });
}));

test("material proposals reserve space but change the agreement only after the booker accepts the exact proposal", () => withSessions(async (f, clock) => {
  await bookMorning(f);
  clock.now += minute;
  await f.db.batch([
    f.db.prepare(`INSERT INTO session_change_proposals (id, booking_id, listing_id, version, booked_slot_id, booked_listing_version_id,
      proposed_slot_id, proposed_listing_version_id, proposed_by_id, proposed_at, respond_by, state)
      VALUES ('proposal', 'booking', 'listing', 1, 'morning', 'v1', 'afternoon', 'v2', 'coordinator', ?, ?, 'pending')`)
      .bind(clock.now, clock.now + 10 * minute),
    f.db.prepare("UPDATE session_bookings SET revision = 1 WHERE id = 'booking'"),
    f.db.prepare("UPDATE session_slots SET state = 'paused', revision = 1 WHERE id = 'morning'"),
  ]);
  const before = data(getSessionBookingRoute, await f.call("booker", "/session-bookings/booking"));
  expect(before).toMatchObject({ agreement: { slotId: "morning", totalMinor: 1600 }, actions: { move: false, respond: true, cancel: true },
    proposal: { id: "proposal", version: 1, state: "pending", proposed: { slotId: "afternoon", totalMinor: 2200 } } });
  expect(data(createSessionHoldRoute, await f.call("other", "/sessions/listing/holds", hold("other-hold", "afternoon"))))
    .toMatchObject({ status: "not_held", reason: "places_unavailable", placesLeft: 0 });
  expect(data(createSessionHoldRoute, await f.call("booker", "/sessions/listing/holds", hold("move-hold", "afternoon", { moveBookingId: "booking" }))))
    .toMatchObject({ status: "not_held", reason: "booking_unavailable" });
  const response = { bookingRevision: 1, proposalId: "proposal", version: 1, decision: "accept" };
  status(await f.call("other", "/session-bookings/booking/respond", command("respond", response)), 404, "NOT_FOUND");
  status(await f.call("booker", "/session-bookings/booking/respond", command("wrong-version", { ...response, version: 2 })), 409, "CONFLICT");
  const changed = data(respondToSessionChangeRoute, await f.call("booker", "/session-bookings/booking/respond", command("respond", response)));
  expect(changed).toMatchObject({ revision: 2, original: { slotId: "morning", listingVersionId: "v1", termsHash: "hash-1" },
    agreement: { slotId: "afternoon", totalMinor: 2200, version: { id: "v2", terms: { hash: "hash-2" } } },
    proposal: { state: "accepted" }, actions: { respond: false } });
}));

test("booker sync and private links expose confirmed substitutes; moving and cancelling require the current agreement", () => withSessions(async (f, clock) => {
  const initial = data(syncRoute, await f.call("booker", "/sync", { contextId: "booker-context", operations: [], cursor: null }));
  await bookMorning(f);
  clock.now += minute;
  await f.db.batch([
    f.db.prepare("UPDATE session_host_assignments SET state = 'released', changed_at = ? WHERE id = 'original-host'").bind(clock.now),
    f.db.prepare(`INSERT INTO session_host_assignments (id, slot_id, business_id, membership_id, position, role_label, language,
      state, changed_at, changed_by_id, confirmed_at)
      VALUES ('replacement', 'morning', 'provider', 'substitute-team', 1, 'Instructor', 'en', 'confirmed', ?, 'coordinator', ?)`)
      .bind(clock.now, clock.now),
    f.db.prepare("INSERT INTO link_targets VALUES ('token', 'session_booking', 'booking', 'booker-context', ?)").bind(morning),
  ]);
  const replacement = { status: "confirmed", isSubstitute: true, host: { name: "Lucía", language: "en", confirmed: { byName: "Marina", at: clock.now } } };
  const synced = data(syncRoute, await f.call("booker", "/sync", { contextId: "booker-context", operations: [], cursor: initial.cursor }));
  expect(synced.upserts.find(({ kind, resourceId }) => kind === "session_booking" && resourceId === "booking")?.value)
    .toMatchObject({ category: "pilates", host: replacement });
  const other = data(syncRoute, await f.call("other", "/sync", { contextId: "other-context", operations: [], cursor: null }));
  expect(other.upserts.filter(({ kind }) => kind === "session_booking")).toEqual([]);
  expect(data(openLinkRoute, await f.call("booker", "/links/token"))).toMatchObject({ kind: "session_booking", booking: { host: replacement } });
  expect(data(openLinkRoute, await f.call("other", "/links/token"))).toMatchObject({ kind: "unavailable" });
  status(await f.call("other", "/session-bookings/booking"), 404, "NOT_FOUND");
  const next = { listingVersionId: "v2", termsHash: "hash-2", totalMinor: 2200 };
  expect(data(createSessionHoldRoute, await f.call("booker", "/sessions/listing/holds", hold("move-hold", "afternoon", { moveBookingId: "booking" }))))
    .toMatchObject({ status: "held", moveFrom: { id: "booking", startsAt: morning, siteZone: "Europe/Madrid" } });
  const moved = data(moveSessionBookingRoute, await f.call("booker", "/session-bookings/booking/move", command("move", {
    holdId: "move-hold", bookingRevision: 0, ...next,
  })));
  expect(moved).toMatchObject({ status: "moved", booking: { revision: 1, agreement: { slotId: "afternoon", totalMinor: 2200 } } });
  status(await f.call("booker", "/session-bookings/booking/cancel", command("stale", { bookingRevision: 0, termsHash: "hash-1" })), 409, "STALE_REVISION");
  const cancelled = data(cancelSessionBookingRoute, await f.call("booker", "/session-bookings/booking/cancel", command("cancel", {
    bookingRevision: 1, termsHash: next.termsHash,
  })));
  expect(cancelled).toMatchObject({ state: "cancelled", actions: { cancel: false, move: false }, cancellation: { byName: "Claire", at: clock.now } });
  clock.now = afternoon + duration;
  expect(data(getSessionBookingRoute, await f.call("booker", "/session-bookings/booking")).canGiveFeedback).toBe(false);
  status(await f.call("booker", "/session-bookings/booking/feedback", command("cancelled-feedback", { stars: 5 })), 409, "CONFLICT");
}));

test("feedback unlocks at scheduled end without attendance, is recorded once, and is private to the provider", () => withSessions(async (f, clock) => {
  const path = "/session-bookings/booking/feedback";
  const bookingPath = "/session-bookings/booking";
  const providerPath = "/sessions/listing/feedback?slotId=morning";
  const body = command("feedback", { stars: 5, comment: "Clear instructions." });
  expect((await bookMorning(f)).canGiveFeedback).toBe(false);
  clock.now = morning + duration - 1;
  status(await f.call("booker", path, body), 409, "CONFLICT");
  clock.now += 1;
  expect(data(getSessionBookingRoute, await f.call("booker", bookingPath))).toMatchObject({ state: "booked", canGiveFeedback: true });
  const initial = data(syncRoute, await f.call("booker", "/sync", { contextId: "booker-context", operations: [], cursor: null }));
  status(await f.call("other", path, body), 404, "NOT_FOUND");
  status(await f.call("coordinator", path, body), 404, "NOT_FOUND");
  const submitted = data(submitSessionBookingFeedbackRoute, await f.call("booker", path, body));
  expect(submitted.canGiveFeedback).toBe(false);
  expect(JSON.stringify(submitted)).not.toContain("Clear instructions.");
  expect(data(submitSessionBookingFeedbackRoute, await f.call("booker", path, body))).toEqual(submitted);
  status(await f.call("booker", path, command("another-feedback", { stars: 1 })), 409, "CONFLICT");
  const changed = data(syncRoute, await f.call("booker", "/sync", { contextId: "booker-context", operations: [], cursor: initial.cursor }));
  expect(changed.upserts.find(({ kind, resourceId }) => kind === "session_booking" && resourceId === "booking")?.value)
    .toMatchObject({ canGiveFeedback: false });
  expect(JSON.stringify(changed)).not.toContain("Clear instructions.");
  status(await f.call("booker", providerPath), 404, "NOT_FOUND");
  expect(data(getSessionBookingFeedbackRoute, await f.call("coordinator", providerPath)).feedback)
    .toEqual([{ bookingId: "booking", stars: 5, comment: "Clear instructions.", submittedAt: clock.now }]);
}));

test("recorded attendance unlocks feedback before scheduled end; omitting a comment is allowed", () => withSessions(async (f, clock) => {
  await bookMorning(f);
  clock.now = morning + minute;
  data(recordSessionAttendanceRoute, await f.call("coordinator", "/sessions/listing/attendance", command("attendance", {
    slotId: "morning", slotRevision: 0, id: "attendance", bookingId: "booking", result: "attended", placesAttended: 1, correction: null,
  })));
  const params = { id: "booking" };
  for (const stars of [0, 1.5, 6]) {
    expect(submitSessionBookingFeedbackRoute.input.safeParse({ params, body: command("invalid-feedback", { stars }) }).success).toBe(false);
  }
  expect(data(getSessionBookingRoute, await f.call("booker", "/session-bookings/booking")).canGiveFeedback).toBe(true);
  const result = data(submitSessionBookingFeedbackRoute, await f.call("booker", "/session-bookings/booking/feedback", command("vote", { stars: 1 })));
  expect(result.canGiveFeedback).toBe(false);
  expect(data(getSessionBookingFeedbackRoute, await f.call("coordinator", "/sessions/listing/feedback?slotId=morning")).feedback)
    .toEqual([{ bookingId: "booking", stars: 1, comment: null, submittedAt: clock.now }]);
}));

test("disabled or missing flags hide every route, including stored holds and booking projections", () => withSessions(async (f) => {
  await bookMorning(f);
  expect(data(createSessionHoldRoute, await f.call("booker", "/sessions/listing/holds", hold("second", "afternoon"))).status).toBe("held");
  await f.db.batch([f.db.prepare("INSERT INTO link_targets VALUES ('token', 'session_booking', 'booking', 'booker-context', ?)").bind(morning)]);
  for (const disable of ["UPDATE feature_flags SET enabled = 0 WHERE scope_key = 'area:pilates'", "DELETE FROM feature_flags WHERE scope_key = 'area:pilates'"]) {
    await f.db.batch([f.db.prepare(disable)]);
    status(await f.call("booker", "/sessions?areaId=area&category=pilates"), 404, "NOT_FOUND");
    status(await f.call("booker", "/sessions/listing"), 404, "NOT_FOUND");
    status(await f.call("booker", "/sessions/listing/holds", hold("blocked")), 404, "NOT_FOUND");
    status(await f.call("booker", "/holds/second/book", book("new-booking")), 404, "NOT_FOUND");
    status(await f.call("booker", "/holds/second/release", command("release", {})), 404, "NOT_FOUND");
    status(await f.call("booker", "/session-bookings/booking"), 404, "NOT_FOUND");
    status(await f.call("booker", "/session-bookings/booking/move", command("move", { holdId: "second", bookingRevision: 0, ...accepted })), 404, "NOT_FOUND");
    status(await f.call("booker", "/session-bookings/booking/cancel", command("cancel", { bookingRevision: 0, termsHash: "hash-1" })), 404, "NOT_FOUND");
    status(await f.call("booker", "/session-bookings/booking/respond", command("respond", { bookingRevision: 0, proposalId: "missing", version: 1, decision: "decline" })), 404, "NOT_FOUND");
    status(await f.call("booker", "/session-bookings/booking/feedback", command("feedback", { stars: 5 })), 404, "NOT_FOUND");
    expect(data(openLinkRoute, await f.call("booker", "/links/token"))).toMatchObject({ kind: "unavailable" });
    const synced = data(syncRoute, await f.call("booker", "/sync", { contextId: "booker-context", operations: [], cursor: null }));
    expect(synced.upserts.filter(({ kind }) => kind === "session_booking")).toEqual([]);
  }
}));
