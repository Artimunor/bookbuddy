import { SESSIONS_FEATURE_FLAG, sessionFeatureScopeKey } from "@bookbuddy/domain";
import { loadOtpKey, mailboxKey } from "../src/modules/auth/crypto";
import { ids, sql } from "./cast";

const area = "seed-session-area";
const business = "seed-mar-pilates";
const venue = "seed-mar-studio";
const listing = "seed-mat-pilates";
const version = "seed-mat-pilates-v1";
const category = "pilates";
const siteZone = "Europe/Madrid";
const duration = 45 * 60_000;
const studioTime = (day: number, time: string) => Date.parse(`2026-11-${day}T${time}:00+01:00`);
const terms = "Pay Estudi Mar Pilates at the studio. No payment is taken in the app. You can move or cancel for free before the start.";
const people = [
  { id: "seed-session-marina", handle: "marina", display: "Marina Serra", roles: ["provider_admin", "foreman"] },
  { id: "seed-session-elena", handle: "elena", display: "Elena Costa", roles: ["worker"] },
  { id: "seed-session-lucia", handle: "lucia-pilates", display: "Lucía Vidal", roles: ["worker"] },
  { id: "seed-session-guest", handle: "pilates-guest", display: "Alex Vidal", roles: ["customer"] },
] as const;
const [marina, elena, lucia, guest] = people;
const member = (id: string) => `${id}-member`;

export async function sessionsSql(domain: string, secret: string) {
  const key = await loadOtpKey(secret);
  if (!key) throw new Error("OTP_HMAC_KEY in apps/api/.dev.vars must contain at least 32 characters");
  const accounts = await Promise.all(people.map(async (person) => {
    const email = `${person.handle}@${domain}`;
    return { ...person, email, emailKey: await mailboxKey(key, email) };
  }));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(terms))).toHex();
  const rows: string[] = [];
  function insert(table: string, columns: string, ...values: (string | number | null)[]) {
    rows.push(`INSERT INTO ${table} (${columns}) VALUES (${values.map(sql).join(", ")});`);
  }
  const publishedAt = studioTime(22, "09:00");
  const heldAt = studioTime(23, "10:41");
  const bookedAt = studioTime(23, "10:42");
  const confirmedAt = studioTime(22, "12:00");
  const branchAt = studioTime(23, "12:00");
  const expiresAt = heldAt + 10 * 60_000;

  // Its own market keeps the opt-in away from the construction provider and other businesses.
  insert("operating_areas", "id, name, site_zone, polygon", area, "Xàbia · Sessions demo", siteZone,
    JSON.stringify([[[0.14, 38.76], [0.26, 38.76], [0.26, 38.83], [0.14, 38.83], [0.14, 38.76]]]));
  insert("businesses", "id, legal_name, public_name, verified_work_contact, catchment_id, state",
    business, "Estudi Mar Pilates", "Estudi Mar Pilates", accounts[0]!.email, area, "approved");
  insert("feature_flags", "key, scope_key, enabled, config_version", SESSIONS_FEATURE_FLAG, sessionFeatureScopeKey(area, category), 1, 1);
  for (const account of accounts) {
    const { id, email, emailKey, display, roles } = account;
    insert("accounts", "id, email_normalized, email_key, display_name, verified_at, setup_at, state", id, email, emailKey, display, 1, 1, "active");
    insert("account_preferences", "account_id, ui_locale, reading_locale", id, "en", "en");
    if (id === guest.id) {
      insert("account_contexts", "id, account_id, role", `${id}-customer-context`, id, "customer");
      continue;
    }
    insert("memberships", "id, business_id, account_id, state", member(id), business, id, "active");
    for (const role of roles) {
      const grant = `${id}-${role}-role`;
      insert("membership_roles", "id, membership_id, business_id, account_id, role, granted_at", grant, member(id), business, id, role, 1);
      insert("account_contexts", "id, account_id, role, business_id, role_grant_id", `${id}-${role}-context`, id, role, business, grant);
    }
    if (id !== marina.id) {
      insert("member_skills", "membership_id, tag", member(id), category);
      insert("member_languages", "membership_id, tag", member(id), "en");
      insert("eligibility_checks", "id, business_id, membership_id, trade, work_language, scope, state, checked_by, checked_at, valid_until",
        `${id}-pilates-check`, business, member(id), category, "en", "internal", "approved", marina.id, 1, Date.UTC(2030, 0, 1));
    }
  }
  insert("venues", "id, business_id, area_id, site_zone, name, locality, address, access_note, arrival_note, state, approved_at",
    venue, business, area, siteZone, "Estudi Mar Pilates", "Xàbia", "Demo studio, Xàbia", "Step-free entry", "Check in at reception.", "approved", publishedAt);
  insert("session_listings", "id, business_id, category", listing, business, category);
  insert("session_listing_versions", `id, listing_id, business_id, no, venue_id, title, description, original_locale, language, format,
    duration_ms, price_minor, currency, price_basis, terms_text, terms_locale, terms_hash, cancellation_notice_ms, created_by_id, created_at`,
  version, listing, business, 1, venue, "Mat Pilates", "A 45-minute small group mat class.", "en", "en", "group", duration,
  1600, "EUR", "per_person", terms, "en", hash, 0, marina.id, publishedAt);

  function slot(name: string, start: number, capacity: number) {
    const id = `seed-session-slot-${name}`;
    insert("session_slots", `id, listing_id, listing_version_id, business_id, starts_at, ends_at,
      capacity, hosts_required, coordinator_membership_id, state, updated_at`,
    id, listing, version, business, start, start + duration, capacity, 1, member(marina.id), "published", publishedAt);
    return id;
  }
  function assign(slotId: string, hostId: string, confirmed: number, released?: number) {
    insert("session_host_assignments", `id, slot_id, business_id, membership_id, position, role_label, language,
      state, changed_at, changed_by_id, confirmed_at`,
    `${slotId}-${hostId}`, slotId, business, member(hostId), 1, "Instructor", "en", released ? "released" : "confirmed",
    released ?? confirmed, marina.id, confirmed);
  }
  function hold(id: string, slotId: string, bookerId: string, places: number) {
    insert("session_holds", "id, slot_id, listing_id, listing_version_id, terms_hash, booker_id, places, held_at, expires_at, state",
      id, slotId, listing, version, hash, bookerId, places, heldAt, expiresAt, "held");
  }
  function book(number: number, slotId: string, bookerId = ids.claire as string, places = 1) {
    const id = `seed-session-booking-${number}`;
    const holdId = `seed-session-hold-${number}`;
    hold(holdId, slotId, bookerId, places);
    insert("session_bookings", `id, reference, booker_id, listing_id, original_hold_id, original_slot_id, original_listing_version_id,
      original_terms_hash, slot_id, listing_version_id, terms_hash, places, state, booked_at`,
    id, `BB-S${number}`, bookerId, listing, holdId, slotId, version, hash, slotId, version, hash, places, "booked", bookedAt);
    return id;
  }

  const primary = slot("1042", studioTime(28, "10:00"), 8);
  const full = slot("full", studioTime(28, "11:30"), 1);
  const substitute = slot("substitute", studioTime(29, "10:00"), 8);
  const original = slot("change", studioTime(29, "11:30"), 8);
  const proposed = slot("proposed", studioTime(29, "13:00"), 8);
  const cancelled = slot("cancelled", studioTime(30, "10:00"), 8);
  const attended = slot("attended", studioTime(23, "11:00"), 8);
  for (const id of [primary, full, original, proposed, cancelled, attended]) assign(id, elena.id, confirmedAt);
  assign(substitute, elena.id, confirmedAt, branchAt);
  assign(substitute, lucia.id, branchAt);
  const booking = book(1042, primary);
  book(1043, primary, guest.id, 5);
  book(1044, full, guest.id);
  book(1045, substitute);
  const changed = book(1046, original);
  const cancelledBooking = book(1047, cancelled);
  const attendedBooking = book(1048, attended);
  hold("seed-session-expired-hold", primary, ids.sam, 1);
  rows.push(`UPDATE session_slots SET state = 'paused', updated_at = ${branchAt}, revision = 1 WHERE id = ${sql(original)};`);
  insert("session_change_proposals", `id, booking_id, listing_id, version, booked_slot_id, booked_listing_version_id,
    proposed_slot_id, proposed_listing_version_id, proposed_by_id, proposed_at, respond_by, state`,
  "seed-session-proposal", changed, listing, 1, original, version, proposed, version, marina.id, branchAt, studioTime(28, "18:00"), "pending");
  rows.push(`UPDATE session_bookings SET revision = 1 WHERE id = ${sql(changed)};`);
  rows.push(`UPDATE session_bookings SET state = 'cancelled', cancelled_at = ${branchAt}, cancelled_by_id = ${sql(ids.claire)},
    revision = 1 WHERE id = ${sql(cancelledBooking)};`);
  rows.push(`UPDATE session_slots SET state = 'finished', day_stage = 'done', stage_at = ${branchAt}, stage_by_id = ${sql(elena.id)},
    updated_at = ${branchAt}, revision = 1 WHERE id = ${sql(attended)};`);
  rows.push(`UPDATE session_bookings SET state = 'completed', completed_at = ${branchAt}, revision = 1 WHERE id = ${sql(attendedBooking)};`);
  insert("session_attendance", "id, booking_id, result, places_attended, recorded_by_id, recorded_at",
    "seed-session-attended", attendedBooking, "attended", 1, elena.id, branchAt);
  insert("link_targets", "token, kind, resource_id, required_scope, expires_at",
    "seed-session-booking-1042-link", "session_booking", booking, `${ids.claire}-customer-context`, studioTime(30, "10:00"));
  return { sql: rows.join("\n"), accounts };
}
