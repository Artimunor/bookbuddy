import { expect, spyOn, test } from "bun:test";
import {
  changeSessionHostRoute, getSessionBookingFeedbackRoute, getSessionHostOffersRoute, getSessionRosterRoute, operationIdHeader,
  listBusinessSessionsRoute, listMySessionHostOffersRoute, publishSessionRoute, recordSessionAttendanceRoute, replyToSessionHostOfferRoute,
  resultSchema, updateSessionRosterRoute,
} from "@bookbuddy/api-contract";
import type { ResponseSchema } from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential } from "../src/modules/auth/session";
import { createTestD1 } from "./d1";

const now = Date.UTC(2026, 10, 24, 8);
const minute = 60_000;
const start = now + 60 * minute;
const duration = 45 * minute;
const roles = {
  admin: "provider_admin", coordinator: "foreman", otherCoordinator: "foreman", outsider: "provider_admin",
  original: "worker", cover: "worker", rival: "worker", foreign: "worker", unqualified: "worker",
  customer: "customer", secondCustomer: "customer",
} as const;
type Actor = keyof typeof roles;
const listing = {
  kind: "save_listing", category: "pilates", listingVersionId: "v1", venueId: "venue", title: "Mat Pilates",
  description: "Pilates for adults", originalLocale: "en", language: "en", format: "group", durationMs: duration,
  guaranteedHostMembershipId: null, price: { currency: "EUR", unitMinor: 1600, basis: "per_person" },
  terms: { text: "Pay the studio directly.", locale: "en", cancellationNoticeMs: 0 },
};

async function fixture(enabled = true) {
  const db = await createTestD1();
  const app = createApp().onError((error) => { throw error; });
  const tokens = new Map((Object.keys(roles) as Actor[]).map((actor) => [actor, randomToken()]));
  const credentials = await Promise.all([...tokens].map(async ([actor, token]) => [actor, await hashSessionCredential(token)] as const));
  const wakes: string[][] = [];
  const env = { DB: db, EFFECTS: { async send({ workKeys }: { workKeys: string[] }) { wakes.push(workKeys); } } } as unknown as Bindings;
  const execution = { waitUntil() {}, passThroughOnException() {} };
  try {
    await db.batch([
      db.prepare("INSERT INTO operating_areas VALUES ('area', 'Market', 'Europe/Madrid', '[0]')"),
      db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state) VALUES
        ('studio', 'Studio Legal', 'Studio', 'studio@example.test', 'area', 'approved'),
        ('outside', 'Other Legal', 'Other', 'other@example.test', 'area', 'approved')`),
      db.prepare(`INSERT INTO venues (id, business_id, area_id, site_zone, name, locality, address, access_note, arrival_note, state, approved_at)
       VALUES ('venue', 'studio', 'area', 'Europe/Madrid', 'Studio Venue', 'Xàbia', 'Studio address', 'Step-free', 'Reception', 'approved', 1)`),
      ...(enabled ? [db.prepare("INSERT INTO feature_flags VALUES ('sessions', 'area:pilates', 1, 1)")] : []),
      ...credentials.flatMap(([actor, hash]) => {
        const role = roles[actor];
        const business = actor === "foreign" || actor === "outsider" ? "outside" : "studio";
        const staff = role !== "customer";
        const skilled = role === "worker" && actor !== "unqualified";
        return [
          db.prepare("INSERT INTO accounts (id, email_normalized, display_name, verified_at, state) VALUES (?, ?, ?, 1, 'active')")
            .bind(actor, `${actor}@example.test`, `${actor} name`),
          ...(staff ? [
            db.prepare("INSERT INTO memberships (id, business_id, account_id, state) VALUES (?, ?, ?, 'active')").bind(`${actor}-member`, business, actor),
            db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at) VALUES (?, ?, ?, ?, ?, 1)`)
              .bind(`${actor}-role`, `${actor}-member`, business, actor, role),
          ] : []),
          ...(skilled ? [
            db.prepare("INSERT INTO member_skills VALUES (?, 'pilates')").bind(`${actor}-member`),
            db.prepare("INSERT INTO member_languages VALUES (?, 'en')").bind(`${actor}-member`),
            db.prepare(`INSERT INTO eligibility_checks (id, business_id, membership_id, trade, work_language, scope, state, checked_by, checked_at, valid_until)
              VALUES (?, ?, ?, 'pilates', 'en', 'internal', 'approved', ?, 2, ?)`)
              .bind(`${actor}-check`, business, `${actor}-member`, actor, now + 20 * 60 * minute),
          ] : []),
          db.prepare(`INSERT INTO account_contexts (id, account_id, role, business_id, role_grant_id) VALUES (?, ?, ?, ?, ?)`)
            .bind(`${actor}-context`, actor, role, staff ? business : null, staff ? `${actor}-role` : null),
          db.prepare(`INSERT INTO sessions (id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
            VALUES (?, ?, ?, ?, 'device', 1, ?)`).bind(`${actor}-session`, actor, hash, `${actor}-context`, now + 24 * 60 * minute),
        ];
      }),
    ]);
  } catch (error) {
    db.close();
    throw error;
  }
  let clock = now;
  const clockMock = spyOn(Date, "now").mockImplementation(() => clock);
  let serial = 0;
  async function call<Schema extends ResponseSchema>(actor: Actor, route: { method: string; path: string; output: Schema },
    options: { payload?: object; expectedRevision?: number; query?: Record<string, string>; operationId?: string; businessId?: string } = {}) {
    const search = options.query ? `?${new URLSearchParams(options.query)}` : "";
    const command = options.payload === undefined ? undefined : {
      operationId: options.operationId ?? `hosting-${++serial}`, payload: options.payload, expectedRevision: options.expectedRevision,
    };
    const { batch, query } = db.calls;
    const path = route.path.replace(":id", "listing").replace(":b", options.businessId ?? "studio");
    const response = await app.request(`https://bookbuddy.test/api/v1${path}${search}`, {
      method: route.method, headers: { Authorization: `Bearer ${tokens.get(actor)}`, "Content-Type": "application/json",
        ...(command ? { [operationIdHeader]: command.operationId } : {}) }, body: command ? JSON.stringify(command) : undefined,
    }, env, execution);
    expect(db.calls.batch - batch).toBe(command ? 1 : 0);
    expect(db.calls.query - query).toBe(command ? 0 : 1);
    return { status: response.status, result: resultSchema(route.output).parse(await response.json()) };
  }
  const slotDraft = (slotId: string, startsAt = start, capacity = 4) => ({
    kind: "save_slot", slotId, slotRevision: null, listingVersionId: "v1", startsAt, endsAt: startsAt + duration,
    capacity, hostsRequired: 1, coordinatorMembershipId: "coordinator-member",
  });
  const host = (slotId: string, slotRevision: number, actor: Actor, offerExpiresAt?: number) => ({
    kind: "propose_host", slotId, slotRevision, id: `${slotId}-${actor}-host`, membershipId: `${actor}-member`,
    position: 1, roleLabel: "Instructor", language: "en", offerExpiresAt,
  });
  async function publish(slotId: string, startsAt = start, capacity = 4) {
    data(await call("admin", publishSessionRoute, { payload: slotDraft(slotId, startsAt, capacity) }));
    const proposed = data(await call("coordinator", updateSessionRosterRoute, { payload: host(slotId, 0, "original") }));
    const confirmed = data(await call("coordinator", updateSessionRosterRoute, { payload: {
      kind: "confirm_host", slotId, slotRevision: proposed.slot.revision, assignmentId: `${slotId}-original-host`,
    } }));
    return data(await call("admin", publishSessionRoute, { payload: {
      kind: "publish", slotId, slotRevision: confirmed.slot.revision, listingVersionId: "v1",
    } })).slots.find((slot) => slot.id === slotId)!;
  }
  async function book(slotId: string, bookingId: string, actor: Actor, hash: string, places = 1) {
    const holdId = `hold-${bookingId}`;
    await db.batch([
      db.prepare(`INSERT INTO session_holds (id, slot_id, listing_id, listing_version_id, terms_hash, booker_id, places, held_at, expires_at, state)
        VALUES (?, ?, 'listing', 'v1', ?, ?, ?, ?, ?, 'held')`).bind(holdId, slotId, hash, actor, places, now, now + minute),
      db.prepare(`INSERT INTO session_bookings (id, reference, booker_id, listing_id, original_hold_id, original_slot_id,
        original_listing_version_id, original_terms_hash, slot_id, listing_version_id, terms_hash, places, state, booked_at)
        VALUES (?1, ?2, ?3, 'listing', ?4, ?5, 'v1', ?6, ?5, 'v1', ?6, ?7, 'booked', ?8)`)
        .bind(bookingId, `BB-S${bookingId.toUpperCase()}`, actor, holdId, slotId, hash, places, now + 1),
    ]);
  }
  return { db, call, publish, slotDraft, host, book, wakes, advance: (time: number) => { clock = time; }, close() { clockMock.mockRestore(); db.close(); } };
}

function data<T>({ status, result }: { status: number; result: { ok: true; data: T } | { ok: false; error: { code: string } } }): T {
  if (!result.ok) throw new Error(`Unexpected ${status}: ${result.error.code}`);
  expect(status).toBe(200);
  return result.data;
}

const notFound = { status: 404, result: { ok: false, error: { code: "NOT_FOUND" } } };
const conflict = { status: 409, result: { ok: false, error: { code: "CONFLICT" } } };

test("business session discovery pages only enabled listings and respects coordinator assignments", async () => {
  const f = await fixture(false);
  try {
    await f.db.prepare("INSERT INTO feature_flags VALUES ('sessions', 'area2:pilates', 1, 1)").run();
    expect(await f.call("admin", listBusinessSessionsRoute)).toMatchObject(notFound);
    await f.db.prepare("INSERT INTO feature_flags VALUES ('sessions', 'area:pilates', 1, 1)").run();
    expect(data(await f.call("admin", listBusinessSessionsRoute))).toEqual({ sessions: [], page: { cursor: null, hasMore: false } });
    expect(await f.call("outsider", listBusinessSessionsRoute)).toMatchObject(notFound);
    expect(await f.call("admin", listBusinessSessionsRoute, { businessId: "outside" })).toMatchObject(notFound);
    expect(await f.call("original", listBusinessSessionsRoute)).toMatchObject(notFound);

    const draft = data(await f.call("admin", publishSessionRoute, { payload: listing }));
    await f.publish("morning");
    data(await f.call("admin", publishSessionRoute, {
      payload: { ...listing, listingVersionId: "v2", title: "Pilates edited" }, expectedRevision: draft.revision,
    }));
    data(await f.call("admin", publishSessionRoute, { payload: {
      ...f.slotDraft("other-draft", start + 60 * minute), listingVersionId: "v2", coordinatorMembershipId: "otherCoordinator-member",
    } }));
    await f.db.batch([
      f.db.prepare(`WITH RECURSIVE copies(n) AS (VALUES (1) UNION ALL SELECT n + 1 FROM copies WHERE n < 50)
        INSERT INTO session_listings (id, business_id, category) SELECT printf('listing-%02d', n), 'studio', 'pilates' FROM copies
        UNION ALL SELECT 'hidden-listing', 'studio', 'coaching'`),
      f.db.prepare(`INSERT INTO session_listing_versions (id, listing_id, business_id, no, venue_id, title, description,
        original_locale, language, format, duration_ms, price_minor, currency, price_basis, terms_text, terms_locale, terms_hash,
        cancellation_notice_ms, created_by_id, created_at)
        SELECT 'draft-' || l.id, l.id, l.business_id, 1, v.venue_id, v.title, v.description, v.original_locale, v.language, v.format,
          v.duration_ms, v.price_minor, v.currency, v.price_basis, v.terms_text, v.terms_locale, v.terms_hash, 0, v.created_by_id, v.created_at
        FROM session_listings l JOIN session_listing_versions v ON v.id = 'v1' WHERE l.id <> 'listing'`),
    ]);
    const first = data(await f.call("admin", listBusinessSessionsRoute));
    expect(first.sessions).toHaveLength(50);
    expect(first.sessions[0]).toMatchObject({
      id: "listing", version: { id: "v2", no: 2, title: "Pilates edited", venue: { id: "venue" } },
      nextSlots: [
        { id: "morning", listingVersionId: "v1", siteZone: "Europe/Madrid", state: "published" },
        { id: "other-draft", listingVersionId: "v2", siteZone: "Europe/Madrid", state: "draft" },
      ],
    });
    expect(first.sessions[0]?.version).not.toHaveProperty("terms");
    expect(first.page).toEqual({ cursor: "pilates~listing-49", hasMore: true });
    const second = data(await f.call("admin", listBusinessSessionsRoute, { query: { cursor: first.page.cursor! } }));
    expect(second.sessions).toMatchObject([{ id: "listing-50", nextSlots: [] }]);
    expect(second.page).toEqual({ cursor: null, hasMore: false });
    expect(data(await f.call("coordinator", listBusinessSessionsRoute)).sessions).toMatchObject([
      { id: "listing", version: { id: "v1" }, nextSlots: [{ id: "morning" }] },
    ]);
    await f.db.prepare("UPDATE feature_flags SET enabled = 0 WHERE scope_key = 'area:pilates'").run();
    expect(await f.call("admin", listBusinessSessionsRoute)).toMatchObject(notFound);
  } finally { f.close(); }
});

test("sessions flag defaults off for provider writes and reads", async () => {
  const f = await fixture(false);
  try {
    await f.db.prepare("INSERT INTO feature_flags VALUES ('sessions', 'different-area:pilates', 1, 1)").run();
    expect(await f.call("admin", publishSessionRoute, { payload: listing })).toMatchObject(notFound);
    await f.db.prepare("INSERT INTO feature_flags VALUES ('sessions', 'area:pilates', 1, 1)").run();
    data(await f.call("admin", publishSessionRoute, { payload: listing }));
    const slot = await f.publish("morning");
    await f.db.prepare("UPDATE feature_flags SET enabled = 0 WHERE scope_key = 'area:pilates'").run();
    expect(await f.call("coordinator", getSessionRosterRoute, { query: { slotId: slot.id } })).toMatchObject(notFound);
    expect(await f.call("coordinator", updateSessionRosterRoute, { payload: {
      kind: "release_host", slotId: slot.id, slotRevision: slot.revision, assignmentId: "morning-original-host",
    } })).toMatchObject(notFound);
  } finally { f.close(); }
});

test("only the provider admin edits listing drafts and publication preserves the exact immutable version", async () => {
  const f = await fixture();
  try {
    const draft = data(await f.call("admin", publishSessionRoute, { payload: listing }));
    const edit = { ...listing, listingVersionId: "v2", title: "Pilates updated" };
    for (const unauthorized of ["outsider", "customer", "coordinator"] as const) {
      expect(await f.call(unauthorized, publishSessionRoute, { payload: edit, expectedRevision: draft.revision })).toMatchObject(notFound);
    }
    data(await f.call("admin", publishSessionRoute, { payload: f.slotDraft("private-draft") }));
    expect(await f.call("coordinator", updateSessionRosterRoute, { payload: f.host("private-draft", 0, "foreign") })).toMatchObject(conflict);
    expect(await f.call("coordinator", updateSessionRosterRoute, { payload: f.host("private-draft", 0, "unqualified") })).toMatchObject(conflict);
    const published = await f.publish("morning");
    expect(await f.call("admin", publishSessionRoute, { payload: { ...edit, listingVersionId: "v1" }, expectedRevision: draft.revision }))
      .toMatchObject(conflict);
    expect(data(await f.call("admin", publishSessionRoute, { payload: edit, expectedRevision: draft.revision })))
      .toMatchObject({ version: { id: "v2", no: 2, title: "Pilates updated" }, slots: expect.arrayContaining([{ ...published, listingVersionId: "v1" }]) });
    expect(await f.call("admin", publishSessionRoute, { payload: { ...f.slotDraft("morning"), slotRevision: published.revision,
      listingVersionId: "v2" } })).toMatchObject(conflict);
    expect(await f.db.prepare("SELECT title FROM session_listing_versions WHERE id = 'v1'").first("title")).toBe("Mat Pilates");
    expect(await f.call("otherCoordinator", getSessionRosterRoute, { query: { slotId: "morning" } })).toMatchObject(notFound);
  } finally { f.close(); }
});

test("material slot change atomically reserves the proposed time and notifies each current booking", async () => {
  const f = await fixture();
  try {
    const draft = data(await f.call("admin", publishSessionRoute, { payload: listing }));
    const source = await f.publish("morning");
    const target = await f.publish("afternoon", start + 60 * minute, 3);
    const hash = draft.version!.terms.hash;
    await f.book("morning", "first", "customer", hash);
    await f.book("morning", "second", "secondCustomer", hash);
    await f.book("morning", "third", "customer", hash);
    const options = { operationId: "propose-material", payload: { kind: "propose_change", slotId: source.id,
      slotRevision: source.revision, proposedSlotId: target.id, proposedListingVersionId: "v1", respondBy: start - minute } };
    const roster = data(await f.call("coordinator", changeSessionHostRoute, options));
    expect(roster.slot).toMatchObject({ state: "paused", bookedPlaces: 3 });
    expect(roster.attendees).toHaveLength(3);
    const proposals = await f.db.prepare(`SELECT p.booking_id, p.state, p.version, p.proposed_slot_id, b.slot_id, b.revision
      FROM session_change_proposals p JOIN session_bookings b ON b.id = p.booking_id ORDER BY p.booking_id`).all();
    expect(proposals.results).toEqual(["first", "second", "third"].map((booking_id) => ({
      booking_id, state: "pending", version: 1, proposed_slot_id: "afternoon", slot_id: "morning", revision: 1,
    })));
    expect(f.wakes.map((work) => work.length)).toEqual([3]);
    expect(data(await f.call("coordinator", changeSessionHostRoute, options))).toEqual(roster);
    expect(f.wakes.map((work) => work.length)).toEqual([3]);
    const effects = await f.db.prepare(`SELECT n.context_id, l.resource_id, e.kind FROM notifications n
      JOIN link_targets l ON l.token = n.link_token AND l.kind = 'session_booking' AND l.required_scope = n.context_id
      JOIN effect_outbox e ON e.resource_ref = n.id WHERE n.kind = 'session_change_proposed' ORDER BY l.resource_id`).all();
    expect(effects.results).toEqual([
      { context_id: "customer-context", resource_id: "first", kind: "notification_push" },
      { context_id: "secondCustomer-context", resource_id: "second", kind: "notification_push" },
      { context_id: "customer-context", resource_id: "third", kind: "notification_push" },
    ]);
    expect(data(await f.call("coordinator", getSessionRosterRoute, { query: { slotId: target.id } })).slot.placesLeft).toBe(0);
    expect(await f.call("admin", publishSessionRoute, { payload: { ...f.slotDraft("afternoon", target.startsAt, 2),
      slotRevision: target.revision } })).toMatchObject(conflict);
    await expect(f.db.prepare(`INSERT INTO session_holds (id, slot_id, listing_id, listing_version_id, terms_hash, booker_id, places, held_at, expires_at, state)
      VALUES ('excess', 'afternoon', 'listing', 'v1', ?, 'customer', 1, ?, ?, 'held')`).bind(hash, now, now + minute).run())
      .rejects.toThrow(/session hold unavailable/);
  } finally { f.close(); }
});

test("cover is addressed only to eligible own-team hosts; the first acceptance reserves without assigning", async () => {
  const f = await fixture();
  try {
    data(await f.call("admin", publishSessionRoute, { payload: listing }));
    const slot = await f.publish("morning");
    const gap = data(await f.call("coordinator", updateSessionRosterRoute, { payload: {
      kind: "release_host", slotId: slot.id, slotRevision: slot.revision, assignmentId: "morning-original-host",
    } }));
    expect(gap.slot.state).toBe("paused");
    const offerExpiresAt = now + 10 * minute;
    const first = data(await f.call("coordinator", updateSessionRosterRoute, { payload: f.host(slot.id, gap.slot.revision, "cover", offerExpiresAt) }));
    const second = data(await f.call("coordinator", updateSessionRosterRoute, { payload: f.host(slot.id, first.slot.revision, "rival", offerExpiresAt) }));
    const assignmentId = "morning-cover-host";
    const query = { slotId: slot.id };
    expect(await f.call("foreign", getSessionHostOffersRoute, { query })).toMatchObject(notFound);
    expect(await f.call("cover", getSessionRosterRoute, { query })).toMatchObject(notFound);
    expect(data(await f.call("cover", getSessionHostOffersRoute, { query })).offers).toMatchObject([{ id: assignmentId, cover: { status: "offered" } }]);
    const confirm = { kind: "confirm_host", slotId: slot.id, slotRevision: second.slot.revision, assignmentId };
    expect(await f.call("coordinator", updateSessionRosterRoute, { payload: confirm })).toMatchObject(conflict);
    const reply = { kind: "reply_cover", slotId: slot.id, assignmentId, decision: "accept" };
    expect(await f.call("rival", replyToSessionHostOfferRoute, { payload: reply })).toMatchObject(notFound);
    const accepted = data(await f.call("cover", replyToSessionHostOfferRoute, { payload: reply }));
    expect(accepted.cover.status).toBe("accepted");
    expect(await f.call("rival", replyToSessionHostOfferRoute, { payload: { ...reply, assignmentId: "morning-rival-host" } })).toMatchObject(conflict);
    const declined = data(await f.call("rival", replyToSessionHostOfferRoute, { payload: { ...reply, assignmentId: "morning-rival-host", decision: "decline" } }));
    expect(await f.db.prepare("SELECT count(*) AS count FROM session_host_assignments WHERE state = 'confirmed'").first("count")).toBe(0);
    const confirmed = data(await f.call("coordinator", updateSessionRosterRoute, { payload: { ...confirm, slotRevision: declined.slotRevision } }));
    expect(confirmed.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: assignmentId, state: "confirmed", cover: expect.objectContaining({ status: "confirmed" }) }),
      expect.objectContaining({ id: "morning-rival-host", cover: expect.objectContaining({ status: "declined" }) }),
    ]));
  } finally { f.close(); }
});

test("worker discovery returns only the active membership's still-actionable session host offers in deadline order", async () => {
  const f = await fixture(false);
  try {
    expect(await f.call("cover", listMySessionHostOffersRoute)).toMatchObject(notFound);
    await f.db.prepare("INSERT INTO feature_flags VALUES ('sessions', 'area:pilates', 1, 1)").run();
    expect(data(await f.call("cover", listMySessionHostOffersRoute))).toEqual({ offers: [] });
    expect(await f.call("coordinator", listMySessionHostOffersRoute)).toMatchObject(notFound);
    data(await f.call("admin", publishSessionRoute, { payload: listing }));
    const morning = await f.publish("morning");
    const afternoon = await f.publish("afternoon", start + 2 * duration);
    for (const slot of [morning, afternoon]) {
      const gap = data(await f.call("coordinator", updateSessionRosterRoute, { payload: {
        kind: "release_host", slotId: slot.id, slotRevision: slot.revision, assignmentId: `${slot.id}-original-host`,
      } }));
      const offered = data(await f.call("coordinator", updateSessionRosterRoute, {
        payload: f.host(slot.id, gap.slot.revision, "cover", now + (slot.id === morning.id ? 5 : 2) * minute),
      }));
      if (slot.id === morning.id) data(await f.call("coordinator", updateSessionRosterRoute, {
        payload: f.host(slot.id, offered.slot.revision, "rival", now + 4 * minute),
      }));
    }
    expect(data(await f.call("foreign", listMySessionHostOffersRoute))).toEqual({ offers: [] });
    expect(data(await f.call("cover", listMySessionHostOffersRoute)).offers).toMatchObject([
      { listingId: "listing", id: "afternoon-cover-host", slotId: "afternoon", title: "Mat Pilates",
        startsAt: afternoon.startsAt, endsAt: afternoon.endsAt, siteZone: "Europe/Madrid",
        cover: { status: "offered", expiresAt: now + 2 * minute, repliedAt: null } },
      { id: "morning-cover-host" },
    ]);
    expect(data(await f.call("rival", listMySessionHostOffersRoute)).offers).toMatchObject([{ id: "morning-rival-host" }]);
    f.advance(now + 2 * minute);
    expect(data(await f.call("cover", listMySessionHostOffersRoute)).offers).toMatchObject([{ id: "morning-cover-host" }]);
    data(await f.call("rival", replyToSessionHostOfferRoute, { payload: {
      kind: "reply_cover", decision: "accept", assignmentId: "morning-rival-host", slotId: morning.id,
    } }));
    expect(data(await f.call("cover", listMySessionHostOffersRoute))).toEqual({ offers: [] });
    expect(data(await f.call("rival", listMySessionHostOffersRoute))).toEqual({ offers: [] });
    await f.db.prepare("UPDATE feature_flags SET enabled = 0 WHERE key = 'sessions'").run();
    expect(await f.call("cover", listMySessionHostOffersRoute)).toMatchObject(notFound);
  } finally { f.close(); }
});

test("attendance verifies once, appends a correction, and gates completed booking feedback", async () => {
  const f = await fixture();
  try {
    const draft = data(await f.call("admin", publishSessionRoute, { payload: listing }));
    const slot = await f.publish("morning");
    await f.book(slot.id, "first", "customer", draft.version!.terms.hash);
    let revision = slot.revision;
    for (const stage of ["today", "doors_open", "in_session", "done"]) {
      if (stage === "in_session") f.advance(start);
      if (stage === "done") f.advance(start + duration);
      revision = data(await f.call("coordinator", updateSessionRosterRoute, { payload: {
        kind: "confirm_stage", slotId: slot.id, slotRevision: revision, stage,
      } })).slot.revision;
    }
    const attendance = { id: "verified", slotId: slot.id, slotRevision: revision, bookingId: "first", correction: null,
      result: "absent", placesAttended: 0 };
    expect(data(await f.call("coordinator", recordSessionAttendanceRoute, { payload: attendance }))).toMatchObject({ id: "verified", correctsId: null });
    expect(await f.call("coordinator", recordSessionAttendanceRoute, { payload: { ...attendance, id: "duplicate" } })).toMatchObject(conflict);
    f.advance(start + duration + 1);
    const correction = { ...attendance, id: "correction", result: "attended", placesAttended: 1,
      correction: { correctsId: "verified", reason: "Host checked the sign-in" } };
    expect(data(await f.call("coordinator", recordSessionAttendanceRoute, { payload: correction }))).toMatchObject({ id: "correction", correctsId: "verified" });
    expect(await f.call("coordinator", recordSessionAttendanceRoute, { payload: { ...correction, id: "fork" } })).toMatchObject(conflict);
    expect((await f.db.prepare("SELECT id, result FROM session_attendance ORDER BY recorded_at").all()).results).toEqual([
      { id: "verified", result: "absent" }, { id: "correction", result: "attended" },
    ]);
    const query = { slotId: slot.id };
    expect(data(await f.call("coordinator", getSessionRosterRoute, { query })).attendees).toMatchObject([{ attendance: { id: "correction" } }]);
    await f.db.prepare("INSERT INTO session_booking_feedback VALUES ('first', 5, 'Clear instructions.', ?)").bind(start + duration + 1).run();
    expect(data(await f.call("coordinator", getSessionBookingFeedbackRoute, { query })).feedback).toMatchObject([{ bookingId: "first", stars: 5 }]);
    expect(await f.call("otherCoordinator", getSessionBookingFeedbackRoute, { query })).toMatchObject(notFound);
  } finally { f.close(); }
});
