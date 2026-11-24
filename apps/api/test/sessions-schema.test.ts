import { expect, test } from "bun:test";
import {
  bookSessionHoldRoute, cancelSessionBookingRoute, changeSessionHostRoute, createSessionHoldRoute, getSessionBookingRoute,
  getSessionRoute, listSessionsRoute, moveSessionBookingRoute, publishSessionRoute, recordSessionAttendanceRoute,
  releaseSessionHoldRoute, respondToSessionChangeRoute, updateSessionRosterRoute,
} from "@bookbuddy/api-contract";
import {
  isSessionHoldActive, requiresSessionChangeConsent, sessionFeatureScopeKey, sessionHoldExpiresAt, sessionTotalMinor,
} from "@bookbuddy/domain";
import type { SessionCommitment } from "@bookbuddy/domain";
import { and, eq } from "drizzle-orm";
import { openDb } from "../src/db/d1";
import { sessionFeatureFlagPredicate, sessionListings } from "../src/db/schema/sessions";
import { createTestD1 } from "./d1";
import type { TestD1 } from "./d1";

const startsAt = 5_400_000;
const duration = 2_700_000;
const endsAt = startsAt + duration;

async function writeOnce(db: TestD1, ...statements: D1PreparedStatement[]) {
  const { batch, query } = db.calls;
  try {
    return await db.batch(statements);
  } finally {
    expect(db.calls).toMatchObject({ batch: batch + 1, query });
  }
}

function version(db: TestD1, id: string, no: number, hash: string, replace = false) {
  return db.prepare(`${replace ? "INSERT OR REPLACE" : "INSERT"} INTO session_listing_versions (
    id, listing_id, business_id, no, venue_id, title, description, original_locale, language, format, duration_ms,
    price_minor, currency, price_basis, terms_text, terms_locale, terms_hash, cancellation_notice_ms, created_by_id, created_at
  ) VALUES (?, 'listing', 'provider', ?, 'venue', 'Mat Pilates', 'Mat Pilates for adults', 'en', 'en', 'group', ?,
    1600, 'EUR', 'per_person', 'Pay at the studio.', 'en', ?, 0, 'coordinator', 1)`).bind(id, no, duration, hash);
}

async function withSchedule(run: (db: TestD1) => Promise<void>) {
  const db = await createTestD1();
  try {
    await writeOnce(db,
      db.prepare(`INSERT INTO accounts (id, email_normalized, display_name, verified_at, state) VALUES
        ('booker', 'booker@example.test', 'Claire', 1, 'active'),
        ('other', 'other@example.test', 'Jo', 1, 'active'),
        ('coordinator', 'studio@example.test', 'Marina', 1, 'active')`),
      db.prepare("INSERT INTO operating_areas VALUES ('area', 'Area', 'Europe/Madrid', '[0]')"),
      db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state) VALUES
        ('provider', 'Studio Legal', 'Studio', 'studio@example.test', 'area', 'approved'),
        ('other-provider', 'Other Legal', 'Other', 'other@example.test', 'area', 'approved')`),
      db.prepare(`INSERT INTO memberships (id, business_id, account_id, state) VALUES
        ('team', 'provider', 'coordinator', 'active'), ('other-team', 'other-provider', 'other', 'active')`),
      db.prepare(`INSERT INTO venues (id, business_id, area_id, site_zone, name, locality, address, access_note, arrival_note, state, approved_at)
        VALUES ('venue', 'provider', 'area', 'Europe/Madrid', 'Studio', 'Xàbia', 'Studio address', 'Step-free', 'Reception', 'approved', 1)`),
      db.prepare("INSERT INTO session_listings (id, business_id, category) VALUES ('listing', 'provider', 'pilates')"),
      version(db, "v1", 1, "hash-1"),
      db.prepare(`INSERT INTO session_slots (
        id, listing_id, listing_version_id, business_id, starts_at, ends_at, capacity, hosts_required, coordinator_membership_id, state, updated_at
      ) VALUES ('morning', 'listing', 'v1', 'provider', ?, ?, 1, 1, 'team', 'published', 1),
        ('later', 'listing', 'v1', 'provider', ?, ?, 2, 1, 'team', 'published', 1)`).bind(startsAt, endsAt, endsAt, endsAt + duration),
    );
    await run(db);
  } finally {
    db.close();
  }
}

function hold(db: TestD1, id: string, bookerId: string, heldAt: number, expiresAt: number, slotId = "morning", places = 1) {
  return db.prepare(`INSERT INTO session_holds (
    id, slot_id, listing_id, listing_version_id, terms_hash, booker_id, places, held_at, expires_at, state
  ) VALUES (?, ?, 'listing', 'v1', 'hash-1', ?, ?, ?, ?, 'held')`).bind(id, slotId, bookerId, places, heldAt, expiresAt);
}

function book(db: TestD1, bookedAt: number, versionId = "v1", hash = "hash-1") {
  return db.prepare(`INSERT INTO session_bookings (
    id, reference, booker_id, listing_id, original_hold_id, original_slot_id, original_listing_version_id, original_terms_hash,
    slot_id, listing_version_id, terms_hash, places, state, booked_at
  ) VALUES ('booking', 'BB-S1042', 'booker', 'listing', 'hold', 'morning', ?1, ?2, 'morning', ?1, ?2, 1, 'booked', ?3)`)
    .bind(versionId, hash, bookedAt);
}

test("a held seat excludes a second booker until expiry, with one current hold per booker", () => withSchedule(async (db) => {
  await writeOnce(db, hold(db, "hold", "booker", 100, 200));
  await expect(writeOnce(db, hold(db, "loser", "other", 100, 200))).rejects.toThrow(/session hold unavailable/);
  await expect(writeOnce(db, hold(db, "second", "booker", 100, 200, "later"))).rejects.toThrow(/session_holds.booker_id/);
  await expect(writeOnce(db, book(db, 200))).rejects.toThrow(/exact active hold/);
  await writeOnce(db, hold(db, "winner", "other", 200, 300));
  await writeOnce(db,
    db.prepare("UPDATE session_holds SET state = 'released', resolved_at = 200 WHERE booker_id = 'booker' AND state = 'held' AND expires_at <= 200"),
    hold(db, "replacement", "booker", 200, 300, "later", 2),
  );
  await expect(writeOnce(db, db.prepare("UPDATE session_slots SET capacity = 1, updated_at = 250 WHERE id = 'later'")))
    .rejects.toThrow(/capacity is committed/);
}));

test("booking consumes only the exact held listing version and keeps the original terms after republication", () => withSchedule(async (db) => {
  await writeOnce(db, version(db, "v2", 2, "hash-2"), hold(db, "hold", "booker", 100, 200));
  await expect(writeOnce(db, book(db, 110, "v1", "hash-2"))).rejects.toThrow(/exact active hold and terms/);
  await expect(writeOnce(db, book(db, 110, "v2", "hash-2"))).rejects.toThrow(/exact active hold and terms/);
  const [, consumption] = await writeOnce(db, book(db, 110), db.prepare("SELECT state, resolved_at FROM session_holds WHERE id = 'hold'"));
  expect(consumption?.results).toEqual([{ state: "consumed", resolved_at: 110 }]);
  await expect(writeOnce(db, hold(db, "full", "other", 110, 200))).rejects.toThrow(/session hold unavailable/);
  await writeOnce(db, db.prepare("UPDATE session_slots SET listing_version_id = 'v2' WHERE id = 'morning'"));
  await expect(writeOnce(db, db.prepare(`UPDATE session_bookings SET original_listing_version_id = 'v2', original_terms_hash = 'hash-2'
    WHERE id = 'booking'`))).rejects.toThrow(/original booking terms are immutable/);
  const { batch, query } = db.calls;
  expect(await db.prepare(`SELECT booked.original_listing_version_id AS booked_version, booked.original_terms_hash AS booked_hash,
    slot.listing_version_id AS published_version FROM session_bookings AS booked JOIN session_slots AS slot ON slot.id = booked.slot_id
    WHERE booked.id = 'booking'`).first()).toEqual({ booked_version: "v1", booked_hash: "hash-1", published_version: "v2" });
  expect(db.calls).toMatchObject({ batch, query: query + 1 });
}));

test("even an unreferenced session listing version cannot be updated, deleted or replaced", () => withSchedule(async (db) => {
  await writeOnce(db, version(db, "v2", 2, "hash-2"));
  await expect(writeOnce(db, db.prepare("UPDATE session_listing_versions SET terms_text = 'Changed' WHERE id = 'v2'")))
    .rejects.toThrow(/listing versions are immutable/);
  await expect(writeOnce(db, db.prepare("DELETE FROM session_listing_versions WHERE id = 'v2'")))
    .rejects.toThrow(/listing versions are immutable/);
  await expect(writeOnce(db, version(db, "replacement", 2, "new-hash", true))).rejects.toThrow(/listing versions are immutable/);
}));

test("attendance has one verified result and a linear append-only correction history", () => withSchedule(async (db) => {
  await writeOnce(db, hold(db, "hold", "booker", 100, 200), book(db, 110));
  const attendance = db.prepare(`INSERT INTO session_attendance
    (id, booking_id, result, places_attended, recorded_by_id, recorded_at, corrects_id, correction_reason)
    VALUES (?, 'booking', ?, ?, 'coordinator', ?, ?, ?)`);
  await writeOnce(db, attendance.bind("original", "absent", 0, endsAt, null, null));
  await expect(writeOnce(db, attendance.bind("duplicate", "attended", 1, endsAt, null, null)))
    .rejects.toThrow(/already has a verified result/);
  await writeOnce(db, attendance.bind("correction", "attended", 1, endsAt + 1, "original", "Confirmed by the host"));
  await expect(writeOnce(db, attendance.bind("fork", "absent", 0, endsAt + 2, "original", "Wrong revision")))
    .rejects.toThrow(/already has a verified result or correction/);
  await expect(writeOnce(db, db.prepare("UPDATE session_attendance SET result = 'attended', places_attended = 1 WHERE id = 'original'")))
    .rejects.toThrow(/attendance is append-only/);
  const { batch, query } = db.calls;
  const history = await db.prepare("SELECT id, result, corrects_id FROM session_attendance WHERE booking_id = 'booking' ORDER BY recorded_at").all();
  expect(history.results).toEqual([
    { id: "original", result: "absent", corrects_id: null }, { id: "correction", result: "attended", corrects_id: "original" },
  ]);
  expect(db.calls).toMatchObject({ batch, query: query + 1 });
}));

test("session assignments cannot cross businesses", () => withSchedule(async (db) => {
  const assignment = db.prepare(`INSERT INTO session_host_assignments
    (id, slot_id, business_id, membership_id, position, role_label, language, state, changed_at, changed_by_id)
    VALUES ('host', 'morning', 'provider', ?, 1, 'Instructor', 'en', 'confirmed', 1, 'coordinator')`);
  await expect(writeOnce(db, assignment.bind("other-team"))).rejects.toThrow(/FOREIGN KEY constraint failed/);
  await writeOnce(db, assignment.bind("team"));
}));

test("the market/category flag defaults off and is checked in the scoped read", () => withSchedule(async (db) => {
  const scope = sessionFeatureScopeKey("area", "pilates");
  async function visible() {
    const { batch, query } = db.calls;
    const row = await openDb(db).select({ id: sessionListings.id }).from(sessionListings)
      .where(and(eq(sessionListings.id, "listing"), sessionFeatureFlagPredicate(scope))).get();
    expect(db.calls).toMatchObject({ batch, query: query + 1 });
    return row?.id ?? null;
  }
  expect(await visible()).toBeNull();
  await writeOnce(db, db.prepare("INSERT INTO feature_flags VALUES ('sessions', 'other-area:pilates', 1, 1), ('sessions', ?, 0, 1)").bind(scope));
  expect(await visible()).toBeNull();
  await writeOnce(db, db.prepare("UPDATE feature_flags SET enabled = 1, config_version = 2 WHERE key = 'sessions' AND scope_key = ?").bind(scope));
  expect(await visible()).toBe("listing");
}));

test("all Later route descriptors carry the default-off sessions gate", () => {
  const routes = [listSessionsRoute, getSessionRoute, getSessionBookingRoute, createSessionHoldRoute, bookSessionHoldRoute,
    releaseSessionHoldRoute, moveSessionBookingRoute, cancelSessionBookingRoute, respondToSessionChangeRoute,
    publishSessionRoute, updateSessionRosterRoute, changeSessionHostRoute, recordSessionAttendanceRoute];
  expect(routes.every((route) => route.featureFlag === "sessions")).toBe(true);
});

test("hold expiry is strict and material changes require consent, not a staffing-only substitute", () => {
  expect(sessionHoldExpiresAt(100, 150, 100)).toBe(150);
  expect(sessionHoldExpiresAt(150, 150, 100)).toBeNull();
  expect(isSessionHoldActive({ state: "held", expiresAt: 150 }, 149)).toBe(true);
  expect(isSessionHoldActive({ state: "held", expiresAt: 150 }, 150)).toBe(false);
  expect(isSessionHoldActive({ state: "released", expiresAt: 150 }, 149)).toBe(false);
  const booked: SessionCommitment = {
    startsAt, endsAt, venueId: "venue", language: "en", guaranteedHostId: null, termsHash: "hash-1",
    price: { basis: "per_person", unitMinor: 1600, currency: "EUR" },
  };
  const staffOnlyUpdate = { ...booked, confirmedHostId: "substitute" };
  expect(requiresSessionChangeConsent(booked, staffOnlyUpdate)).toBe(false);
  for (const change of [
    { startsAt: startsAt + 1 }, { venueId: "other-venue" }, { language: "pt-PT" }, { guaranteedHostId: "new-host" },
    { price: { ...booked.price, unitMinor: 2000 } }, { termsHash: "hash-2" },
  ]) expect(requiresSessionChangeConsent(booked, { ...booked, ...change })).toBe(true);
  expect(sessionTotalMinor(booked.price, 2)).toBe(3200);
  const appointment = { ...booked.price, basis: "per_appointment" } as const;
  expect(sessionTotalMinor(appointment, 1)).toBe(1600);
  expect(sessionTotalMinor(appointment, 2)).toBeNull();
});
