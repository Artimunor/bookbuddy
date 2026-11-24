import { idSchema, sessionCategorySchema, timestampSchema } from "@bookbuddy/api-contract";
import type {
  RouteResponse, changeSessionHostRoute, getSessionBookingFeedbackRoute, getSessionHostOffersRoute, getSessionRosterRoute,
  getSessionRoute, listBusinessSessionsRoute, publishSessionRoute, replyToSessionHostOfferRoute, updateSessionRosterRoute,
} from "@bookbuddy/api-contract";
import { SESSION_PAYMENT_METHOD, SESSIONS_FEATURE_FLAG } from "@bookbuddy/domain";
import type { SessionCommitment } from "@bookbuddy/domain";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { planOperation } from "../../db/operations";
import type { OperationResult, OperationSpec } from "../../db/operations";
import { accessClock, at, currentCheck, displayName, eligibilityCutoff, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { currentMembership } from "../jobs/projections";
import { createLinkTarget, linkTokenFor } from "../links";
import { calendarDay as DAY_MS } from "../schedule/calendar";

const pageSize = 50;
const actor = "(SELECT account_id FROM live_scope)";
const hostingSlotId = "(SELECT id FROM hosting_slot)";
const boolean = (expression: string) => `json(CASE WHEN ${expression} THEN 'true' ELSE 'false' END)`;
const enabled = (area: string, category: string) => `EXISTS (SELECT 1 FROM feature_flags flag
  WHERE flag.key = '${SESSIONS_FEATURE_FLAG}' AND flag.scope_key = ${area} || ':' || ${category} AND flag.enabled = 1)`;
const admin = (scope: string, business: string) => `(${scope}.role = 'provider_admin' AND ${scope}.business_id = ${business}
  AND ${currentMembership(scope, at)} IS NOT NULL)`;
const managesSlot = (scope: string, slot: string) => `(${admin(scope, `${slot}.business_id`)} OR
  (${scope}.role = 'foreman' AND ${scope}.business_id = ${slot}.business_id AND ${currentMembership(scope, at)} = ${slot}.coordinator_membership_id))`;
const confirmation = (time: string, person: string) => `json_object('at', ${time}, 'byName', ${displayName(person)})`;
const eligibleMemberRole = (id: string, business: string, role: "foreman" | "worker", extra = "1") => `EXISTS (
  SELECT 1 FROM memberships m JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
  JOIN membership_roles r ON r.membership_id = m.id AND r.role = '${role}' AND r.revoked_at IS NULL AND r.granted_at <= ${at}
  WHERE m.id = ${id} AND m.business_id = ${business} AND m.state = 'active' AND (${extra}))`;

function eligibleHost(id: string, business: string, category: string, language: string, slot?: string) {
  const through = slot ? `${slot}.ends_at` : at;
  return eligibleMemberRole(id, business, "worker", `EXISTS (SELECT 1 FROM member_skills sk WHERE sk.membership_id = m.id AND sk.tag = ${category})
    AND EXISTS (SELECT 1 FROM member_languages ml WHERE ml.membership_id = m.id AND ml.tag = ${language} COLLATE NOCASE)
    AND EXISTS (SELECT 1 FROM eligibility_checks e WHERE e.business_id = m.business_id AND e.membership_id = m.id
      AND e.trade = ${category} AND e.work_language = ${language} COLLATE NOCASE AND e.scope = 'internal' AND e.state = 'approved'
      AND e.checked_at <= ${at} AND ${eligibilityCutoff("e")} >= ${through} AND ${currentCheck("e")})${slot ? `
    AND NOT EXISTS (SELECT 1 FROM availability_intervals off WHERE off.membership_id = m.id AND off.kind = 'unavailable'
      AND off.recorded_at <= ${at} AND off.starts_at < ${slot}.ends_at AND off.ends_at > ${slot}.starts_at)
    AND NOT EXISTS (SELECT 1 FROM session_host_assignments busy JOIN session_slots occupied ON occupied.id = busy.slot_id
      WHERE busy.membership_id = m.id AND busy.state = 'confirmed' AND occupied.id <> ${slot}.id
        AND occupied.state IN ('draft', 'published', 'paused') AND occupied.starts_at < ${slot}.ends_at AND occupied.ends_at > ${slot}.starts_at)` : ""}`);
}

const heldPlaces = (slotId: string) => `coalesce((SELECT sum(places) FROM session_holds
  WHERE slot_id = ${slotId} AND state = 'held' AND expires_at > ${at}), 0)`;
const bookedPlaces = (slotId: string) => `coalesce((SELECT sum(places) FROM session_bookings
  WHERE slot_id = ${slotId} AND state IN ('booked', 'completed')), 0)`;
const reservedPlaces = (slotId: string) => `coalesce((SELECT sum(b.places) FROM session_change_proposals p
  JOIN session_bookings b ON b.id = p.booking_id AND b.state = 'booked'
    AND b.slot_id = p.booked_slot_id AND b.listing_version_id = p.booked_listing_version_id
  WHERE p.proposed_slot_id = ${slotId} AND p.booked_slot_id <> ${slotId} AND p.state = 'pending' AND p.respond_by > ${at}), 0)`;
const committedPlaces = (slotId: string) => `${heldPlaces(slotId)} + ${bookedPlaces(slotId)} + ${reservedPlaces(slotId)}`;

function versionValue(v: string, venue: string, detail = true) {
  const venueDetail = detail ? `, 'accessNote', ${venue}.access_note, 'address', ${venue}.address, 'arrivalNote', ${venue}.arrival_note` : "";
  const terms = detail ? `, 'description', ${v}.description, 'originalLocale', ${v}.original_locale,
    'hostGuaranteed', ${boolean(`${v}.guaranteed_host_membership_id IS NOT NULL`)},
    'guaranteedHostMembershipId', ${v}.guaranteed_host_membership_id,
    'terms', json_object('text', ${v}.terms_text, 'locale', ${v}.terms_locale, 'hash', ${v}.terms_hash,
      'cancellationNoticeMs', ${v}.cancellation_notice_ms)` : "";
  return `json_object('id', ${v}.id, 'no', ${v}.no, 'title', ${v}.title,
    'language', ${v}.language, 'format', ${v}.format, 'durationMs', ${v}.duration_ms,
    'venue', json_object('id', ${venue}.id, 'name', ${venue}.name, 'locality', ${venue}.locality, 'siteZone', ${venue}.site_zone${venueDetail}),
    'price', json_object('currency', ${v}.currency, 'unitMinor', ${v}.price_minor, 'basis', ${v}.price_basis,
      'paymentMethod', '${SESSION_PAYMENT_METHOD}')${terms})`;
}

function slotValue(sl: string, includeSiteZone = false) {
  return `(WITH occupancy(held, booked, reserved) AS MATERIALIZED (
    SELECT ${heldPlaces(`${sl}.id`)}, ${bookedPlaces(`${sl}.id`)}, ${reservedPlaces(`${sl}.id`)}
  ) SELECT json_object('id', ${sl}.id, 'listingVersionId', ${sl}.listing_version_id,
    'startsAt', ${sl}.starts_at, 'endsAt', ${sl}.ends_at, 'capacity', ${sl}.capacity,
    'placesLeft', max(0, ${sl}.capacity - occ.held - occ.booked - occ.reserved),
    'state', ${sl}.state, 'revision', ${sl}.revision, 'hostsRequired', ${sl}.hosts_required,
    'heldPlaces', occ.held, 'bookedPlaces', occ.booked,
    'day', json((SELECT json_object('stage', ${sl}.day_stage, 'at', ${sl}.stage_at, 'byName', ${displayName("stage_actor")})
      FROM accounts stage_actor WHERE stage_actor.id = ${sl}.stage_by_id)),
    'coordinator', json((SELECT json_object('membershipId', m.id, 'name', ${displayName("a")})
      FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.id = ${sl}.coordinator_membership_id))
    ${includeSiteZone ? `, 'siteZone', ${sl}.site_zone` : ""})
  FROM occupancy occ)`;
}

function coverValue(h: string) {
  return `CASE WHEN ${h}.offer_expires_at IS NOT NULL THEN json_object('expiresAt', ${h}.offer_expires_at,
    'repliedAt', ${h}.offer_responded_at, 'status', CASE
      WHEN ${h}.offer_decision = 'declined' THEN 'declined'
      WHEN ${h}.state = 'confirmed' THEN 'confirmed'
      WHEN ${h}.state = 'released' AND ${h}.changed_at < ${h}.offer_expires_at THEN 'withdrawn'
      WHEN ${h}.offer_expires_at <= ${at} THEN 'expired'
      WHEN ${h}.offer_decision = 'accepted' THEN 'accepted'
      ELSE 'offered' END) END`;
}

export function attendanceValue(row: string, recorder: string) {
  return `json_object('id', ${row}.id, 'bookingId', ${row}.booking_id, 'result', ${row}.result,
    'placesAttended', ${row}.places_attended, 'correctsId', ${row}.corrects_id,
    'recorded', ${confirmation(`${row}.recorded_at`, recorder)})`;
}

function rosterValue(sl: string, after: string) {
  return `(WITH attendees AS MATERIALIZED (
    SELECT b.id, b.booker_id, b.places FROM session_bookings b WHERE b.slot_id = ${sl}.id
      AND b.state IN ('booked', 'completed') AND (${after} IS NULL OR b.id > ${after}) ORDER BY b.id LIMIT ${pageSize + 1}
  ) SELECT json_object('slot', json(${slotValue(sl)}),
    'assignments', json((SELECT json_group_array(json(value)) FROM (
      SELECT json_object('id', h.id, 'membershipId', h.membership_id, 'name', ${displayName("a")},
        'position', h.position, 'roleLabel', h.role_label, 'language', h.language, 'state', h.state,
        'changed', ${confirmation("h.changed_at", "origin")}, 'cover', json(${coverValue("h")})) AS value
      FROM session_host_assignments h JOIN memberships m ON m.id = h.membership_id JOIN accounts a ON a.id = m.account_id
      JOIN accounts origin ON origin.id = h.changed_by_id WHERE h.slot_id = ${sl}.id ORDER BY h.position, h.changed_at, h.id
    ))), 'attendees', json((SELECT json_group_array(json(value)) FROM (
      SELECT json_object('id', b.id, 'bookerName', ${displayName("a")}, 'places', b.places,
        'attendance', json((SELECT ${attendanceValue("result", "recorder")}
          FROM session_attendance result JOIN accounts recorder ON recorder.id = result.recorded_by_id
          WHERE result.booking_id = b.id AND NOT EXISTS (SELECT 1 FROM session_attendance child WHERE child.corrects_id = result.id)))) AS value
      FROM attendees b JOIN accounts a ON a.id = b.booker_id ORDER BY b.id LIMIT ${pageSize}
    ))), 'attendeesPage', json(${pageValue("attendees", "id", "id")})))`;
}

function pageValue(rows: string, cursor: string, order: string) {
  const more = `EXISTS (SELECT 1 FROM ${rows} LIMIT 1 OFFSET ${pageSize})`;
  return `json_object('cursor', CASE WHEN ${more} THEN (SELECT ${cursor} FROM ${rows} ORDER BY ${order} LIMIT 1 OFFSET ${pageSize - 1}) END,
    'hasMore', ${boolean(more)})`;
}

function slotCursor(cursor: string | undefined): [number | null, string | null] | null {
  if (!cursor) return [null, null];
  const [timestamp, slot, extra] = cursor.split("~");
  if (extra !== undefined || !timestamp || !/^-?\d+$/.test(timestamp) || !slot || !idSchema.safeParse(slot).success) return null;
  const parsed = timestampSchema.safeParse(Number(timestamp));
  return parsed.success ? [parsed.data, slot] : null;
}

// Embedded once into the shared customer/provider GET, with live_scope and clock from its request prefix.
export function providerSessionValue({ params, query }: RouteResponse<typeof getSessionRoute.input>): CommandStatement | null {
  const after = slotCursor(query?.cursor);
  if (!after || (query?.attendeeCursor !== undefined && !idSchema.safeParse(query.attendeeCursor).success)) return null;
  return detailValue(params.id, after, query?.rosterSlotId ?? null, query?.attendeeCursor ?? null);
}

function detailValue(id: string, after: [number | null, string | null], rosterSlotId: string | null, attendeeAfter: string | null): CommandStatement {
  const visible = `(l.is_admin OR sl.coordinator_membership_id = l.member_id)
    AND ${enabled("venue.area_id", "l.category")}`;
  const version = `(SELECT ${versionValue("v", "venue")}
    FROM session_listing_versions v JOIN venues venue ON venue.id = v.venue_id
    WHERE v.listing_id = l.id AND ${enabled("venue.area_id", "l.category")} AND (l.is_admin OR EXISTS (
      SELECT 1 FROM session_slots sl WHERE sl.listing_version_id = v.id AND sl.listing_id = l.id
        AND sl.coordinator_membership_id = l.member_id)) ORDER BY v.no DESC LIMIT 1)`;
  return { sql: `WITH input(id, after_start, after_id, roster_slot, attendee_after) AS (VALUES (?, ?, ?, ?, ?)),
    listing AS MATERIALIZED (
      SELECT listing.*, b.public_name, scope.role = 'provider_admin' AS is_admin, ${currentMembership("scope", at)} AS member_id
      FROM input i JOIN session_listings listing ON listing.id = i.id
      JOIN businesses b ON b.id = listing.business_id AND b.state = 'approved'
      JOIN live_scope scope ON scope.business_id = listing.business_id AND scope.role IN ('provider_admin', 'foreman')
    ), chosen_version AS MATERIALIZED (
      SELECT ${version} AS value FROM listing l WHERE l.member_id IS NOT NULL
    ), slot_page AS MATERIALIZED (
      SELECT sl.* FROM input i CROSS JOIN listing l JOIN session_slots sl ON sl.listing_id = l.id
      JOIN session_listing_versions v ON v.id = sl.listing_version_id JOIN venues venue ON venue.id = v.venue_id
      WHERE ${visible} AND (i.after_start IS NULL OR (sl.starts_at, sl.id) > (i.after_start, i.after_id))
      ORDER BY sl.starts_at, sl.id LIMIT ${pageSize + 1}
    ), roster_slot AS (
      SELECT sl.* FROM input i CROSS JOIN listing l JOIN session_slots sl ON sl.listing_id = l.id AND sl.id = i.roster_slot
      JOIN session_listing_versions v ON v.id = sl.listing_version_id JOIN venues venue ON venue.id = v.venue_id WHERE ${visible}
    ) SELECT json_object('id', l.id, 'provider', json_object('id', l.business_id, 'name', l.public_name),
      'category', l.category, 'audience', 'provider', 'revision', l.revision, 'version', json(v.value),
      'slots', json((SELECT json_group_array(json(value)) FROM (
        SELECT ${slotValue("sl")} AS value FROM slot_page sl ORDER BY sl.starts_at, sl.id LIMIT ${pageSize}
      ))), 'page', json(${pageValue("slot_page", "starts_at || '~' || id", "starts_at, id")}),
      'roster', json((SELECT ${rosterValue("sl", "(SELECT attendee_after FROM input)")} FROM roster_slot sl)),
      'actions', json_object('publish', ${boolean("l.is_admin")}, 'roster', json('true'), 'changeHost', json('true'), 'recordAttendance', json('true')))
    AS value FROM listing l CROSS JOIN chosen_version v WHERE v.value IS NOT NULL`,
  params: [id, ...after, rosterSlotId, attendeeAfter] };
}

export function hostingSlotAccess(session: SessionAccess, now: number, listingId: string, slotId: string): SessionAccess {
  const access = accessClock(session, now);
  return {
    sql: `${access.sql}, hosting_slot AS MATERIALIZED (
      SELECT sl.*, l.category, v.venue_id, v.format, v.duration_ms, v.guaranteed_host_membership_id, v.language,
        v.price_minor, v.currency, v.price_basis, v.terms_hash, v.title, venue.state AS venue_state, venue.approved_at, venue.site_zone
      FROM session_slots sl JOIN session_listings l ON l.id = sl.listing_id
      JOIN businesses business ON business.id = l.business_id AND business.state = 'approved'
      JOIN session_listing_versions v ON v.id = sl.listing_version_id JOIN venues venue ON venue.id = v.venue_id
      WHERE l.id = ? AND sl.id = ? AND ${enabled("venue.area_id", "l.category")}
    )`, params: [...access.params, listingId, slotId],
  };
}

export const hostingSlotAuthorization = { sql: `EXISTS (SELECT 1 FROM hosting_slot sl WHERE ${managesSlot("scope", "sl")})` };
const adminSlotAuthorization = { sql: `EXISTS (SELECT 1 FROM hosting_slot sl WHERE ${admin("scope", "sl.business_id")})` };
const firstRoster = () => rosterProjection(null);
function rosterProjection(cursor: string | null): CommandStatement {
  return { sql: `WITH page_input(after_id) AS (VALUES (?)) SELECT ${rosterValue("sl", "(SELECT after_id FROM page_input)")} AS value
    FROM live_scope scope CROSS JOIN hosting_slot sl WHERE ${managesSlot("scope", "sl")}`, params: [cursor] };
}

function scopedValue(access: SessionAccess, value: CommandStatement): CommandStatement {
  return scopedStatement(access, `SELECT (${value.sql}) AS value FROM acting_session`, ...value.params ?? []);
}

// An allowed empty worklist exists only if at least one category is on in the business's market or an owned venue's market.
const marketEnabled = (area: string) => `EXISTS (SELECT 1 FROM feature_flags category_flag
  WHERE category_flag.key = '${SESSIONS_FEATURE_FLAG}' AND category_flag.enabled = 1
    AND category_flag.scope_key >= ${area} || ':' AND category_flag.scope_key < ${area} || ';')`;
const businessMarketEnabled = (b: string) => `(${marketEnabled(`${b}.catchment_id`)} OR EXISTS (
  SELECT 1 FROM venues owned WHERE owned.business_id = ${b}.id AND ${marketEnabled("owned.area_id")}))`;

export function readBusinessSessions(session: SessionAccess, now: number,
  { params, query }: RouteResponse<typeof listBusinessSessionsRoute.input>): CommandStatement | null {
  const cursor = query?.cursor?.split("~");
  if (cursor && (cursor.length !== 2 || !sessionCategorySchema.safeParse(cursor[0]).success || !idSchema.safeParse(cursor[1]).success)) return null;
  return scopedValue(accessClock(session, now), { sql: `
    WITH business_scope AS MATERIALIZED (
      SELECT b.id, b.public_name, scope.role = 'provider_admin' AS is_admin, ${currentMembership("scope", at)} AS member_id
      FROM live_scope scope JOIN businesses b ON b.id = scope.business_id AND b.id = ? AND b.state = 'approved'
      WHERE scope.role IN ('provider_admin', 'foreman') AND ${businessMarketEnabled("b")}
    ), listing_page AS MATERIALIZED (
      SELECT l.id AS listing_id, l.category, l.revision, l.business_id, b.public_name, b.is_admin, b.member_id,
        v.id, v.no, v.venue_id, v.title, v.language, v.format, v.duration_ms, v.price_minor, v.currency, v.price_basis
      FROM business_scope b JOIN session_listings l ON l.business_id = b.id
      JOIN session_listing_versions v ON v.id = (
        SELECT candidate.id FROM session_listing_versions candidate JOIN venues site ON site.id = candidate.venue_id
        WHERE candidate.listing_id = l.id AND ${enabled("site.area_id", "l.category")} AND (b.is_admin OR EXISTS (
          SELECT 1 FROM session_slots assigned WHERE assigned.listing_id = l.id AND assigned.listing_version_id = candidate.id
            AND assigned.coordinator_membership_id = b.member_id))
        ORDER BY candidate.no DESC LIMIT 1)
      WHERE b.member_id IS NOT NULL ${cursor ? "AND (l.category, l.id) > (?, ?)" : ""}
      ORDER BY l.category, l.id LIMIT ${pageSize + 1}
    )
    SELECT json_object('sessions', json((SELECT json_group_array(json(value)) FROM (
      SELECT json_object('id', l.listing_id, 'category', l.category, 'revision', l.revision,
        'provider', json_object('id', l.business_id, 'name', l.public_name), 'version', ${versionValue("l", "venue", false)},
        'nextSlots', json((SELECT json_group_array(json(${slotValue("sl", true)})) FROM (
          SELECT upcoming.*, slot_venue.site_zone FROM session_slots upcoming
          JOIN session_listing_versions slot_version ON slot_version.id = upcoming.listing_version_id
          JOIN venues slot_venue ON slot_venue.id = slot_version.venue_id
          WHERE upcoming.listing_id = l.listing_id AND upcoming.ends_at > ${at}
            AND upcoming.state IN ('draft', 'published', 'paused') AND (l.is_admin OR upcoming.coordinator_membership_id = l.member_id)
            AND ${enabled("slot_venue.area_id", "l.category")}
          ORDER BY upcoming.starts_at, upcoming.id LIMIT 3
        ) sl))) AS value
      FROM listing_page l JOIN venues venue ON venue.id = l.venue_id ORDER BY l.category, l.listing_id LIMIT ${pageSize}
    ))), 'page', json(${pageValue("listing_page", "category || '~' || listing_id", "category, listing_id")}))
    FROM business_scope WHERE member_id IS NOT NULL`, params: [params.b, ...cursor ?? []] });
}

export function readProviderSessionRoster(session: SessionAccess, now: number,
  { params, query }: RouteResponse<typeof getSessionRosterRoute.input>): CommandStatement | null {
  if (query.cursor && !idSchema.safeParse(query.cursor).success) return null;
  return scopedValue(hostingSlotAccess(session, now, params.id, query.slotId), rosterProjection(query.cursor ?? null));
}

export function readSessionBookingFeedback(session: SessionAccess, now: number,
  { params, query }: RouteResponse<typeof getSessionBookingFeedbackRoute.input>): CommandStatement | null {
  if (query.cursor && !idSchema.safeParse(query.cursor).success) return null;
  const access = hostingSlotAccess(session, now, params.id, query.slotId);
  return scopedValue(access, { sql: `WITH page_input(after_id) AS (VALUES (?)), permitted AS MATERIALIZED (
    SELECT sl.id FROM live_scope scope CROSS JOIN hosting_slot sl WHERE ${managesSlot("scope", "sl")}
  ), feedback_page AS MATERIALIZED (
    SELECT f.* FROM permitted p JOIN session_bookings b ON b.slot_id = p.id
    JOIN session_booking_feedback f ON f.booking_id = b.id CROSS JOIN page_input i
    WHERE i.after_id IS NULL OR b.id > i.after_id ORDER BY b.id LIMIT ${pageSize + 1}
  ) SELECT json_object('feedback', json((SELECT json_group_array(json_object('bookingId', booking_id, 'stars', stars,
    'comment', comment, 'submittedAt', submitted_at)) FROM (SELECT * FROM feedback_page ORDER BY booking_id LIMIT ${pageSize}))),
    'page', json(${pageValue("feedback_page", "booking_id", "booking_id")})) FROM permitted`, params: [query.cursor ?? null] });
}

const offerOwner = (scope: string, sl: string, h: string) => `${scope}.role = 'worker' AND ${scope}.business_id = ${sl}.business_id
  AND ${h}.slot_id = ${sl}.id AND ${h}.membership_id = ${currentMembership(scope, at)} AND ${h}.offer_expires_at IS NOT NULL`;
function workerOfferValue(h: string, sl: string, discovery = false) {
  return `json_object('id', ${h}.id, 'slotId', ${sl}.id, 'slotRevision', ${sl}.revision, 'title', ${sl}.title,
    'startsAt', ${sl}.starts_at, 'endsAt', ${sl}.ends_at, 'siteZone', ${sl}.site_zone, 'position', ${h}.position,
    'roleLabel', ${h}.role_label, 'language', ${h}.language, 'cover', json(${coverValue(h)})
    ${discovery ? `, 'listingId', ${sl}.listing_id` : ""})`;
}

export function readSessionHostOffers(session: SessionAccess, now: number,
  { params, query }: RouteResponse<typeof getSessionHostOffersRoute.input>): CommandStatement {
  return scopedValue(hostingSlotAccess(session, now, params.id, query.slotId), { sql: `WITH offers AS MATERIALIZED (
    SELECT ${workerOfferValue("h", "sl")} AS value FROM live_scope scope CROSS JOIN hosting_slot sl
    JOIN session_host_assignments h ON ${offerOwner("scope", "sl", "h")} ORDER BY h.changed_at DESC, h.id
  ) SELECT json_object('offers', json_group_array(json(value))) AS value FROM offers HAVING count(*) > 0` });
}

export function readMySessionHostOffers(session: SessionAccess, now: number): CommandStatement {
  return scopedValue(accessClock(session, now), { sql: `WITH worker_scope AS MATERIALIZED (
    SELECT b.id AS business_id, ${currentMembership("scope", at)} AS member_id
    FROM live_scope scope JOIN businesses b ON b.id = scope.business_id AND b.state = 'approved'
    WHERE scope.role = 'worker' AND ${businessMarketEnabled("b")}
  ) SELECT json_object('offers', json((SELECT json_group_array(json(value)) FROM (
    SELECT ${workerOfferValue("h", "sl", true)} AS value
    FROM session_host_assignments h JOIN (
      SELECT s.*, l.category, v.title, v.language, v.guaranteed_host_membership_id, site.site_zone, site.area_id
      FROM session_slots s JOIN session_listings l ON l.id = s.listing_id
      JOIN session_listing_versions v ON v.id = s.listing_version_id JOIN venues site ON site.id = v.venue_id
    ) sl ON sl.id = h.slot_id AND sl.business_id = h.business_id
    WHERE h.business_id = scope.business_id AND h.membership_id = scope.member_id
      AND ${unansweredCover("h", "sl")} AND ${enabled("sl.area_id", "sl.category")} AND ${canAcceptCover("h", "sl")}
    ORDER BY h.offer_expires_at, h.id
  )))) FROM worker_scope scope WHERE scope.member_id IS NOT NULL` });
}

export type HostingResult = { operation: OperationResult; value: string | null };
export async function hostingCommand(now: number, access: SessionAccess, spec: Omit<OperationSpec, "access">,
  projection: CommandStatement, projectionAccess = access): Promise<CommandInput<HostingResult>> {
  const command = await planOperation({ now }, { ...spec, access });
  return { statements: [ ...command.statements, scopedValue(projectionAccess, projection) ], decode: (results) => ({
    operation: command.decode(results), value: (results.at(-1)?.results[0] as { value: string | null } | undefined)?.value ?? null,
  }) };
}

const slotIsUpcoming = (slot: string) => `${slot}.state IN ('draft', 'published', 'paused') AND ${slot}.starts_at > ${at}`;
const admitsHost = (sl: string, position: string, member: string) => `(${position} <= ${sl}.hosts_required
  AND (${position} <> 1 OR ${sl}.guaranteed_host_membership_id IS NULL OR ${member} = ${sl}.guaranteed_host_membership_id))`;
const staffingReady = (sl: string) => `(SELECT count(*) FROM session_host_assignments h WHERE h.slot_id = ${sl}.id
  AND h.state = 'confirmed' AND ${admitsHost(sl, "h.position", "h.membership_id")} AND h.language = ${sl}.language COLLATE NOCASE
  AND ${eligibleHost("h.membership_id", `${sl}.business_id`, `${sl}.category`, `${sl}.language`, sl)}) = ${sl}.hosts_required`;
const openPosition = (sl: string, p: string) => `NOT EXISTS (SELECT 1 FROM session_host_assignments h WHERE h.slot_id = ${sl}.id
  AND h.position = ${p} AND h.state = 'confirmed')`;

function bumpSlot(access: SessionAccess, guard: CommandStatement, state?: "'published'" | "'paused'" | "'cancelled'") {
  return scopedStatement(access, `UPDATE session_slots SET revision = revision + 1, updated_at = ${at}${state ? `, state = ${state}` : ""}
    WHERE id = ${hostingSlotId} AND ${guard.sql}`, ...guard.params ?? []);
}

function releaseHolds(access: SessionAccess, guard: CommandStatement) {
  return scopedStatement(access, `UPDATE session_holds SET state = 'released', resolved_at = ${at}
    WHERE slot_id = ${hostingSlotId} AND state = 'held' AND held_at <= ${at} AND ${guard.sql}`, ...guard.params ?? []);
}

// Diff and inbox audiences are exact, live customer contexts. Each booking gets its own event even if two share an account.
const bookerAudience = (condition: string) => `SELECT b.id AS resource_id, c.id AS context_id FROM session_bookings b
  JOIN account_contexts c ON c.account_id = b.booker_id AND c.role = 'customer'
  JOIN accounts a ON a.id = c.account_id AND a.state = 'active' WHERE ${condition}`;
const currentBookers = `b.slot_id = ${hostingSlotId} AND b.state = 'booked'`;
const bookingChanges = (access: SessionAccess, condition: string) => scopedStatement(access,
  `SELECT 'session_booking' AS kind, x.resource_id, x.context_id AS partition_key, 'upsert' AS op, ${at} AS at
    FROM (${bookerAudience(condition)}) x`);

function bookingNotices(access: SessionAccess, guard: CommandStatement, kind: string, condition: string, changedCondition = condition) {
  const event = `${kind}:${crypto.randomUUID()}:`;
  const targets = scopedStatement(access, `SELECT 'session_booking' AS kind, x.resource_id, x.context_id AS required_scope,
    ${at} AS created_at, ${at} + ${DAY_MS} AS expires_at FROM (${bookerAudience(condition)}) x`);
  const token = linkTokenFor("t.kind", "t.resource_id", "t.required_scope", "t.expires_at");
  const statements = [createLinkTarget(targets, guard), {
    sql: `INSERT INTO notifications (id, context_id, event_key, kind, link_token, created_at)
      SELECT lower(hex(randomblob(16))), t.required_scope, ? || t.resource_id, ?, ${token}, t.created_at
      FROM (${targets.sql}) t WHERE ${guard.sql} ON CONFLICT (context_id, event_key) DO NOTHING`,
    params: [event, kind, ...targets.params ?? [], ...guard.params ?? []],
  }];
  const notified = `FROM (${bookerAudience(changedCondition)}) x
    JOIN notifications n ON n.context_id = x.context_id AND n.event_key = ? || x.resource_id`;
  const changes = scopedStatement(access, `SELECT 'notification' AS kind, n.id AS resource_id, n.context_id AS partition_key,
    'upsert' AS op, ${at} AS at ${notified}
    UNION ALL SELECT 'session_booking', x.resource_id, x.context_id, 'upsert', ${at} ${notified}`, event, event);
  const effects = scopedStatement(access, `SELECT lower(hex(randomblob(16))) AS id, 'notification_push' AS kind,
    'notification_push:' || n.id AS dedupe_key, n.id AS resource_ref, ${at} AS due_at, ${at} + ${DAY_MS} AS expires_at
    ${notified} WHERE n.link_token IS NOT NULL`, event);
  return { statements, changes, effects };
}

type PublishInput = RouteResponse<typeof publishSessionRoute.input>;
type ListingDraft = Extract<PublishInput["body"]["payload"], { kind: "save_listing" }>;
type SlotDraft = Extract<PublishInput["body"]["payload"], { kind: "save_slot" }>;

function withInput(access: SessionAccess, columns: string, values: readonly unknown[]): SessionAccess {
  return { sql: `${access.sql}, hosting_input(${columns}) AS (VALUES (${values.map(() => "?").join(", ")}))`,
    params: [...access.params, ...values] };
}

async function saveListing(now: number, session: SessionAccess, input: PublishInput, draft: ListingDraft) {
  const { params: { id }, body } = input;
  const { listingVersionId, category, venueId, title, description, format, durationMs,
    guaranteedHostMembershipId, price, terms } = draft;
  const language = Intl.getCanonicalLocales(draft.language)[0]!;
  const locale = Intl.getCanonicalLocales(terms.locale)[0]!;
  const encoded = new TextEncoder().encode(JSON.stringify([terms.text, locale, terms.cancellationNoticeMs]));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoded)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const access = withInput(accessClock(session, now), `listing_id, version_id, category, venue_id, title, description,
    original_locale, language, format, duration_ms, guaranteed_host, price_minor, currency, price_basis, terms_text, terms_locale,
    terms_hash, cancellation_notice, expected_revision`,
    [id, listingVersionId, category, venueId, title, description, Intl.getCanonicalLocales(draft.originalLocale)[0]!,
      language, format, durationMs, guaranteedHostMembershipId, price.unitMinor, price.currency, price.basis,
      terms.text, locale, hash, terms.cancellationNoticeMs, body.expectedRevision ?? null]);
  return hostingCommand(now, access, {
    operationId: body.operationId, command: "session.save_listing", input, resultRef: id,
    authorize: { sql: `EXISTS (SELECT 1 FROM hosting_input i JOIN venues venue ON venue.id = i.venue_id
      WHERE ${admin("scope", "venue.business_id")} AND ${enabled("venue.area_id", "i.category")}
        AND NOT EXISTS (SELECT 1 FROM session_listings foreign_listing WHERE foreign_listing.id = i.listing_id
          AND foreign_listing.business_id <> scope.business_id))` },
    eligible: { sql: `EXISTS (SELECT 1 FROM hosting_input i JOIN venues venue ON venue.id = i.venue_id
      LEFT JOIN session_listings l ON l.id = i.listing_id
      WHERE venue.state <> 'retired' AND i.cancellation_notice = 0
        AND (i.guaranteed_host IS NULL OR ${eligibleHost("i.guaranteed_host", "scope.business_id", "i.category", "i.language")})
        AND NOT EXISTS (SELECT 1 FROM session_listing_versions used WHERE used.id = i.version_id)
        AND ((l.id IS NULL AND coalesce(i.expected_revision, 0) = 0)
          OR (l.category = i.category AND l.revision = i.expected_revision)))` },
    writes: (guard) => ({ statements: [
      scopedStatement(access, `INSERT INTO session_listings (id, business_id, category)
        SELECT i.listing_id, scope.business_id, i.category FROM hosting_input i CROSS JOIN live_scope scope WHERE ${guard.sql}
        ON CONFLICT (id) DO UPDATE SET revision = session_listings.revision + 1`, ...guard.params ?? []),
      scopedStatement(access, `INSERT INTO session_listing_versions (
        id, listing_id, business_id, no, venue_id, title, description, original_locale, language, format, duration_ms,
        guaranteed_host_membership_id, price_minor, currency, price_basis, terms_text, terms_locale, terms_hash,
        cancellation_notice_ms, created_by_id, created_at
      ) SELECT i.version_id, l.id, l.business_id, coalesce((SELECT max(no) FROM session_listing_versions WHERE listing_id = l.id), 0) + 1,
        i.venue_id, i.title, i.description, i.original_locale, i.language, i.format, i.duration_ms, i.guaranteed_host,
        i.price_minor, i.currency, i.price_basis, i.terms_text, i.terms_locale, i.terms_hash, i.cancellation_notice, ${actor}, ${at}
      FROM hosting_input i JOIN session_listings l ON l.id = i.listing_id WHERE ${guard.sql}`, ...guard.params ?? []),
    ] }),
  }, detailValue(id, [null, null], null, null), accessClock(session, now));
}

function saveSlot(now: number, session: SessionAccess, input: PublishInput, draft: SlotDraft) {
  const { params: { id }, body } = input;
  const { slotId, slotRevision, listingVersionId, startsAt, endsAt, capacity, hostsRequired, coordinatorMembershipId } = draft;
  const access = withInput(accessClock(session, now), `listing_id, slot_id, slot_revision, version_id, starts_at, ends_at,
    capacity, hosts_required, coordinator`, [id, slotId, slotRevision, listingVersionId, startsAt, endsAt, capacity, hostsRequired, coordinatorMembershipId]);
  return hostingCommand(now, access, {
    operationId: body.operationId, command: "session.save_slot", input, resultRef: slotId,
    authorize: { sql: `EXISTS (SELECT 1 FROM hosting_input i JOIN session_listings l ON l.id = i.listing_id
      JOIN session_listing_versions v ON v.listing_id = l.id AND v.id = i.version_id JOIN venues venue ON venue.id = v.venue_id
      WHERE ${admin("scope", "l.business_id")} AND ${enabled("venue.area_id", "l.category")})` },
    eligible: { sql: `EXISTS (SELECT 1 FROM hosting_input i JOIN session_listings l ON l.id = i.listing_id
      JOIN session_listing_versions v ON v.listing_id = l.id AND v.id = i.version_id JOIN venues venue ON venue.id = v.venue_id
      LEFT JOIN session_slots sl ON sl.id = i.slot_id
      LEFT JOIN session_listing_versions prior ON prior.id = sl.listing_version_id
      LEFT JOIN venues old_venue ON old_venue.id = prior.venue_id
      WHERE i.starts_at > ${at} AND venue.state <> 'retired' AND i.ends_at - i.starts_at = v.duration_ms
        AND (v.format <> 'private' OR i.capacity = 1)
        AND (v.price_minor = 0 OR i.capacity <= 9007199254740991 / v.price_minor)
        AND (i.coordinator IS NULL OR ${eligibleMemberRole("i.coordinator", "l.business_id", "foreman")})
        AND ((sl.id IS NULL AND i.slot_revision IS NULL) OR (
          sl.listing_id = l.id AND sl.revision = i.slot_revision AND ${enabled("old_venue.area_id", "l.category")}
          AND ${slotIsUpcoming("sl")} AND i.capacity >= ${committedPlaces("sl.id")}
          AND NOT EXISTS (SELECT 1 FROM session_host_assignments h WHERE h.slot_id = sl.id AND h.state = 'confirmed'
            AND (h.position > i.hosts_required OR h.language <> v.language COLLATE NOCASE
              OR (h.position = 1 AND v.guaranteed_host_membership_id IS NOT NULL AND h.membership_id <> v.guaranteed_host_membership_id)))
          AND (sl.state = 'draft' OR (i.coordinator IS NOT NULL AND sl.starts_at = i.starts_at AND sl.ends_at = i.ends_at
            AND sl.listing_version_id = i.version_id AND (sl.state = 'paused' OR sl.hosts_required = i.hosts_required)))
        )))` },
    writes: (guard) => ({ statements: [scopedStatement(access, `INSERT INTO session_slots (
      id, listing_id, listing_version_id, business_id, starts_at, ends_at, capacity, hosts_required, coordinator_membership_id, state, updated_at
    ) SELECT i.slot_id, l.id, i.version_id, l.business_id, i.starts_at, i.ends_at, i.capacity, i.hosts_required, i.coordinator, 'draft', ${at}
      FROM hosting_input i JOIN session_listings l ON l.id = i.listing_id WHERE ${guard.sql}
      ON CONFLICT (id) DO UPDATE SET listing_version_id = excluded.listing_version_id, starts_at = excluded.starts_at,
        ends_at = excluded.ends_at, capacity = excluded.capacity, hosts_required = excluded.hosts_required,
        coordinator_membership_id = excluded.coordinator_membership_id, updated_at = excluded.updated_at,
        revision = session_slots.revision + 1`, ...guard.params ?? [])] }),
  }, detailValue(id, [null, null], slotId, null), accessClock(session, now));
}

export function publishSession(now: number, session: SessionAccess, input: PublishInput) {
  const { params: { id }, body } = input;
  const p = body.payload;
  if (p.kind === "save_listing") return saveListing(now, session, input, p);
  if (p.kind === "save_slot") return saveSlot(now, session, input, p);
  const access = withInput(hostingSlotAccess(session, now, id, p.slotId), "slot_revision, version_id",
    [p.slotRevision, p.kind === "publish" ? p.listingVersionId : null]);
  const ready = `sl.state IN ('draft', 'paused') AND sl.starts_at > ${at} AND sl.listing_version_id = i.version_id
    AND sl.venue_state = 'approved' AND sl.approved_at <= ${at} AND sl.ends_at - sl.starts_at = sl.duration_ms
    AND (sl.format <> 'private' OR sl.capacity = 1)
    AND ${eligibleMemberRole("sl.coordinator_membership_id", "sl.business_id", "foreman")} AND ${staffingReady("sl")}
    AND NOT EXISTS (SELECT 1 FROM session_slots duplicate WHERE duplicate.listing_id = sl.listing_id
      AND duplicate.starts_at = sl.starts_at AND duplicate.id <> sl.id AND duplicate.state = 'published')`;
  const eligibility = p.kind === "publish" ? ready : p.kind === "pause" ? `sl.state = 'published' AND sl.starts_at > ${at}`
    : `(sl.state = 'draft' OR (sl.state IN ('published', 'paused') AND sl.starts_at > ${at}))`;
  return hostingCommand(now, access, {
    operationId: body.operationId, command: `session.${p.kind}`, input, resultRef: p.slotId,
    authorize: p.kind === "publish" ? adminSlotAuthorization : hostingSlotAuthorization,
    eligible: { sql: `EXISTS (SELECT 1 FROM hosting_slot sl CROSS JOIN hosting_input i WHERE sl.revision = i.slot_revision AND (${eligibility}))` },
    writes: (guard) => {
      if (p.kind === "publish") return { statements: [bumpSlot(access, guard, "'published'")],
        changes: bookingChanges(access, currentBookers) };
      if (p.kind === "pause") return { statements: [bumpSlot(access, guard, "'paused'"), releaseHolds(access, guard)],
        changes: bookingChanges(access, currentBookers) };
      const proposalAffected = `p.proposed_slot_id = ${hostingSlotId} OR p.booked_slot_id = ${hostingSlotId}`;
      const affected = (pending: boolean) => `EXISTS (SELECT 1 FROM session_change_proposals p WHERE p.booking_id = b.id
        AND (${proposalAffected})${pending ? " AND p.state = 'pending'" : ""})`;
      const notice = bookingNotices(access, guard, "session_booking_updated", `b.state = 'booked' AND
        (b.slot_id = ${hostingSlotId} OR ${affected(true)})`, `b.slot_id = ${hostingSlotId} OR ${affected(false)}`);
      const writes = [
        ...notice.statements, bumpSlot(access, guard, "'cancelled'"), releaseHolds(access, guard),
        scopedStatement(access, `UPDATE session_bookings AS b SET revision = revision + 1,
          state = CASE WHEN b.slot_id = ${hostingSlotId} THEN 'cancelled' ELSE state END,
          cancelled_at = CASE WHEN b.slot_id = ${hostingSlotId} THEN ${at} ELSE NULL END,
          cancelled_by_id = CASE WHEN b.slot_id = ${hostingSlotId} THEN ${actor} ELSE NULL END
          WHERE b.state = 'booked' AND (b.slot_id = ${hostingSlotId} OR ${affected(true)}) AND ${guard.sql}`, ...guard.params ?? []),
        scopedStatement(access, `UPDATE session_change_proposals AS p SET state = 'withdrawn', resolved_at = ${at}, resolved_by_id = ${actor}
          WHERE p.state = 'pending' AND (${proposalAffected}) AND ${guard.sql}`, ...guard.params ?? []),
        scopedStatement(access, `UPDATE session_threads SET write_state = 'read_only' WHERE write_state = 'open' AND booking_id IN (
          SELECT id FROM session_bookings WHERE slot_id = ${hostingSlotId} AND state = 'cancelled') AND ${guard.sql}`, ...guard.params ?? []),
      ];
      return { ...notice, statements: writes };
    },
  }, detailValue(id, [null, null], p.slotId, null));
}

const assignmentTarget = "h.id = i.assignment_id AND h.slot_id = sl.id";
const availableOffer = (h: string) => `(${h}.offer_expires_at IS NULL OR (${h}.offer_decision = 'accepted' AND ${h}.offer_expires_at > ${at}))`;
const hasReservation = (sl: string, position: string, except: string) => `EXISTS (SELECT 1 FROM session_host_assignments reserved
  WHERE reserved.slot_id = ${sl}.id AND reserved.position = ${position} AND reserved.id <> ${except}
    AND reserved.state = 'proposed' AND reserved.offer_decision = 'accepted' AND reserved.offer_expires_at > ${at})`;
const assignmentEligible = (sl: string, member: string, position: string, language: string) => `
  ${language} = ${sl}.language COLLATE NOCASE AND ${admitsHost(sl, position, member)}
  AND ${eligibleHost(member, `${sl}.business_id`, `${sl}.category`, `${sl}.language`, sl)}`;
const unansweredCover = (h: string, sl: string) => `${h}.state = 'proposed' AND ${h}.offer_decision IS NULL
  AND ${h}.offer_expires_at > ${at} AND ${sl}.state IN ('published', 'paused') AND ${sl}.starts_at > ${at}`;
const canAcceptCover = (h: string, sl: string) => `${assignmentEligible(sl, `${h}.membership_id`, `${h}.position`, `${h}.language`)}
  AND ${openPosition(sl, `${h}.position`)} AND NOT ${hasReservation(sl, `${h}.position`, `${h}.id`)}`;

function updateAssignment(access: SessionAccess, guard: CommandStatement, id: string, state: "released" | "confirmed") {
  return scopedStatement(access, `UPDATE session_host_assignments SET state = '${state}', changed_at = ${at}, changed_by_id = ${actor}
    ${state === "confirmed" ? `, confirmed_at = ${at}` : ""} WHERE id = ${id} AND slot_id = ${hostingSlotId} AND ${guard.sql}`,
  ...guard.params ?? []);
}

function expireOffers(access: SessionAccess, guard: CommandStatement, condition: string) {
  return scopedStatement(access, `UPDATE session_host_assignments AS h SET state = 'released', changed_at = ${at}, changed_by_id = ${actor}
    WHERE h.slot_id = ${hostingSlotId} AND h.state = 'proposed' AND h.offer_expires_at <= ${at}
      AND (${condition}) AND ${guard.sql}`, ...guard.params ?? []);
}

type RosterInput = RouteResponse<typeof updateSessionRosterRoute.input>;
export function updateSessionRoster(now: number, session: SessionAccess, input: RosterInput) {
  const { params: { id }, body } = input;
  const p = body.payload;
  const access = withInput(hostingSlotAccess(session, now, id, p.slotId),
    "slot_revision, assignment_id, member_id, position, role_label, language, offer_expiry, next_stage",
    [p.slotRevision, p.kind === "propose_host" ? p.id : p.kind === "confirm_stage" ? null : p.assignmentId,
      p.kind === "propose_host" ? p.membershipId : null, p.kind === "propose_host" ? p.position : null,
      p.kind === "propose_host" ? p.roleLabel : null, p.kind === "propose_host" ? Intl.getCanonicalLocales(p.language)[0]! : null,
      p.kind === "propose_host" ? p.offerExpiresAt ?? null : null, p.kind === "confirm_stage" ? p.stage : null]);
  const fromSlot = "FROM hosting_slot sl CROSS JOIN hosting_input i WHERE sl.revision = i.slot_revision";
  const assigned = `EXISTS (SELECT 1 FROM session_host_assignments h WHERE ${assignmentTarget} AND`;
  let eligible: string;
  if (p.kind === "propose_host") {
    eligible = `${slotIsUpcoming("sl")} AND ${assignmentEligible("sl", "i.member_id", "i.position", "i.language")}
      AND (i.offer_expiry IS NULL OR (sl.state IN ('published', 'paused') AND i.offer_expiry > ${at} AND i.offer_expiry <= sl.starts_at
        AND ${openPosition("sl", "i.position")} AND NOT ${hasReservation("sl", "i.position", "i.assignment_id")}))
      AND NOT EXISTS (SELECT 1 FROM session_host_assignments prior WHERE prior.id = i.assignment_id OR (
        prior.slot_id = sl.id AND prior.membership_id = i.member_id AND (
          prior.state = 'confirmed' OR (prior.state = 'proposed' AND prior.offer_decision IS NOT 'declined'
            AND (prior.offer_expires_at IS NULL OR prior.offer_expires_at > ${at})))))`;
  } else if (p.kind === "confirm_host") {
    eligible = `${slotIsUpcoming("sl")} AND ${assigned} h.state = 'proposed' AND ${availableOffer("h")}
      AND ${assignmentEligible("sl", "h.membership_id", "h.position", "h.language")} AND ${openPosition("sl", "h.position")}
      AND NOT ${hasReservation("sl", "h.position", "h.id")})`;
  } else if (p.kind === "release_host") {
    eligible = `${slotIsUpcoming("sl")} AND ${assigned} h.state IN ('proposed', 'confirmed') AND h.offer_decision IS NOT 'declined')`;
  } else {
    eligible = `sl.state = 'published' AND CASE i.next_stage
      WHEN 'today' THEN sl.day_stage IS NULL AND ${at} < sl.ends_at
      WHEN 'doors_open' THEN sl.day_stage = 'today' AND ${at} < sl.ends_at
      WHEN 'in_session' THEN sl.day_stage = 'doors_open' AND ${at} >= sl.starts_at
      WHEN 'done' THEN sl.day_stage = 'in_session' AND ${at} >= sl.stage_at END`;
  }
  return hostingCommand(now, access, {
    operationId: body.operationId, command: `session.${p.kind}`, input, resultRef: p.slotId,
    authorize: hostingSlotAuthorization, eligible: { sql: `EXISTS (SELECT 1 ${fromSlot} AND (${eligible}))` },
    writes: (guard) => {
      const target = "(SELECT assignment_id FROM hosting_input)";
      if (p.kind === "propose_host") return { statements: [
        expireOffers(access, guard, "h.membership_id = (SELECT member_id FROM hosting_input)"),
        scopedStatement(access, `INSERT INTO session_host_assignments
          (id, slot_id, business_id, membership_id, position, role_label, language, state, changed_at, changed_by_id, offer_expires_at)
          SELECT i.assignment_id, sl.id, sl.business_id, i.member_id, i.position, i.role_label, i.language, 'proposed', ${at}, ${actor}, i.offer_expiry
          FROM hosting_slot sl CROSS JOIN hosting_input i WHERE ${guard.sql}`, ...guard.params ?? []),
        bumpSlot(access, guard),
      ] };
      if (p.kind === "confirm_stage") {
        const statements = [scopedStatement(access, `UPDATE session_slots SET day_stage = (SELECT next_stage FROM hosting_input),
          stage_at = ${at}, stage_by_id = ${actor}, updated_at = ${at}, revision = revision + 1
          ${p.stage === "done" ? ", state = 'finished'" : ""} WHERE id = ${hostingSlotId} AND ${guard.sql}`, ...guard.params ?? [])];
        if (p.stage === "done") statements.push(scopedStatement(access, `UPDATE session_bookings SET state = 'completed',
          completed_at = ${at}, revision = revision + 1 WHERE slot_id = ${hostingSlotId} AND state = 'booked' AND ${guard.sql}`, ...guard.params ?? []));
        return { statements, changes: bookingChanges(access, p.stage === "done" ? `b.slot_id = ${hostingSlotId} AND b.state = 'completed'` : currentBookers) };
      }
      if (p.kind === "release_host") {
        const dropped = `EXISTS (SELECT 1 FROM session_host_assignments h WHERE h.id = ${target} AND h.state = 'confirmed')`;
        const notice = bookingNotices(access, guard, "session_host_arranging", `${currentBookers} AND ${dropped}`, currentBookers);
        const pause = { sql: `(${guard.sql}) AND ${dropped} AND (SELECT state FROM hosting_slot) = 'published'`, params: guard.params };
        return { ...notice, statements: [
          ...notice.statements, releaseHolds(access, pause),
          scopedStatement(access, `UPDATE session_slots SET state = 'paused' WHERE id = ${hostingSlotId} AND ${pause.sql}`, ...pause.params ?? []),
          updateAssignment(access, guard, target, "released"), bumpSlot(access, guard),
        ] };
      }
      const replaced = `EXISTS (SELECT 1 FROM session_host_assignments prior JOIN session_host_assignments replacement
        ON replacement.slot_id = prior.slot_id AND replacement.position = prior.position AND replacement.id = ${target}
        WHERE prior.state = 'released' AND prior.confirmed_at IS NOT NULL AND prior.id <> replacement.id)`;
      const notice = bookingNotices(access, guard, "session_host_changed", `${currentBookers} AND ${replaced}`);
      const noReplacement = bookingChanges(access, `${currentBookers} AND NOT ${replaced}`);
      return { ...notice, statements: [updateAssignment(access, guard, target, "confirmed"), bumpSlot(access, guard), ...notice.statements],
        changes: { sql: `SELECT * FROM (${notice.changes.sql}) UNION ALL SELECT * FROM (${noReplacement.sql})`,
          params: [...notice.changes.params ?? [], ...noReplacement.params ?? []] } };
    },
  }, firstRoster());
}

type OfferReply = RouteResponse<typeof replyToSessionHostOfferRoute.input>;
export function replyToSessionHostOffer(now: number, session: SessionAccess, { params, body }: OfferReply) {
  const p = body.payload;
  const access = withInput(hostingSlotAccess(session, now, params.id, p.slotId), "assignment_id", [p.assignmentId]);
  const offer = `FROM live_scope scope CROSS JOIN hosting_slot sl CROSS JOIN hosting_input i
    JOIN session_host_assignments h ON h.id = i.assignment_id AND ${offerOwner("scope", "sl", "h")}`;
  const target = "(SELECT assignment_id FROM hosting_input)";
  const accepts = p.decision === "accept";
  return hostingCommand(now, access, {
    operationId: body.operationId, command: "session.reply_cover", input: [params, body], resultRef: p.assignmentId,
    authorize: { sql: `EXISTS (SELECT 1 FROM hosting_slot sl CROSS JOIN hosting_input i
      JOIN session_host_assignments h ON h.id = i.assignment_id AND ${offerOwner("scope", "sl", "h")})` },
    eligible: { sql: `EXISTS (SELECT 1 ${offer} WHERE ${unansweredCover("h", "sl")}${accepts ? ` AND ${canAcceptCover("h", "sl")}` : ""})` },
    writes: (guard) => ({ statements: [
      ...(accepts ? [expireOffers(access, guard, `h.offer_decision = 'accepted' AND h.position =
        (SELECT position FROM session_host_assignments WHERE id = ${target})`)] : []),
      scopedStatement(access, `UPDATE session_host_assignments SET offer_decision = '${accepts ? "accepted" : "declined"}',
        offer_responded_at = ${at}, changed_at = ${at}, changed_by_id = ${actor} WHERE id = ${target} AND ${guard.sql}`, ...guard.params ?? []),
      bumpSlot(access, guard),
    ] }),
  }, { sql: `SELECT ${workerOfferValue("h", "sl")} AS value ${offer}` });
}

// SQL counterpart of requiresSessionChangeConsent: compare current booked snapshots set-wise inside the write batch.
function commitment(slot: string, version: string) {
  return {
    startsAt: `${slot}.starts_at`, endsAt: `${slot}.ends_at`, venueId: `${version}.venue_id`, language: `${version}.language`,
    guaranteedHostId: `${version}.guaranteed_host_membership_id`, termsHash: `${version}.terms_hash`,
    price: { basis: `${version}.price_basis`, unitMinor: `${version}.price_minor`, currency: `${version}.currency` },
  } satisfies Record<Exclude<keyof SessionCommitment, "price">, string> & { price: Record<keyof SessionCommitment["price"], string> };
}
function materialChange() {
  const { price: bookedPrice, ...booked } = commitment("sl", "booked_version");
  const { price: proposedPrice, ...proposed } = commitment("next", "next");
  const fields = (xs: object, price: object) => [...Object.values(xs), ...Object.values(price)].join(", ");
  return `((${fields(booked, bookedPrice)}) IS NOT (${fields(proposed, proposedPrice)}))`;
}

type ChangeInput = RouteResponse<typeof changeSessionHostRoute.input>;
export function changeSessionHost(now: number, session: SessionAccess, input: ChangeInput) {
  const { params: { id }, body } = input;
  const p = body.payload;
  const base = hostingSlotAccess(session, now, id, p.slotId);
  if (p.kind === "substitute") {
    const access = withInput(base, "slot_revision, prior_id, replacement_id", [p.slotRevision, p.replacedAssignmentId, p.replacementAssignmentId]);
    return hostingCommand(now, access, {
      operationId: body.operationId, command: "session.substitute", input, resultRef: p.slotId,
      authorize: hostingSlotAuthorization,
      eligible: { sql: `EXISTS (SELECT 1 FROM hosting_slot sl CROSS JOIN hosting_input i
        JOIN session_host_assignments prior ON prior.id = i.prior_id AND prior.slot_id = sl.id AND prior.state = 'confirmed'
        JOIN session_host_assignments h ON h.id = i.replacement_id AND h.slot_id = sl.id AND h.state = 'proposed' AND h.position = prior.position
        WHERE sl.revision = i.slot_revision AND ${slotIsUpcoming("sl")} AND ${availableOffer("h")}
          AND ${assignmentEligible("sl", "h.membership_id", "h.position", "h.language")} AND NOT ${hasReservation("sl", "h.position", "h.id")})` },
      writes: (guard) => {
        const notice = bookingNotices(access, guard, "session_host_changed", currentBookers);
        return { ...notice, statements: [
          updateAssignment(access, guard, "(SELECT prior_id FROM hosting_input)", "released"),
          updateAssignment(access, guard, "(SELECT replacement_id FROM hosting_input)", "confirmed"),
          bumpSlot(access, guard), ...notice.statements,
        ] };
      },
    }, firstRoster());
  }
  if (p.kind === "withdraw_change") {
    const access = withInput(base, "slot_revision, booking_id, proposal_id, version", [p.slotRevision, p.bookingId, p.proposalId, p.version]);
    return hostingCommand(now, access, {
      operationId: body.operationId, command: "session.withdraw_change", input, resultRef: p.proposalId,
      authorize: hostingSlotAuthorization,
      eligible: { sql: `EXISTS (SELECT 1 FROM hosting_slot sl CROSS JOIN hosting_input i
        JOIN session_bookings b ON b.id = i.booking_id AND b.slot_id = sl.id AND b.state = 'booked'
        JOIN session_change_proposals p ON p.id = i.proposal_id AND p.booking_id = b.id AND p.booked_slot_id = sl.id
          AND p.booked_listing_version_id = b.listing_version_id
        WHERE sl.revision = i.slot_revision AND p.version = i.version AND p.state = 'pending')` },
      writes: (guard) => {
        const notice = bookingNotices(access, guard, "session_change_withdrawn", `${currentBookers} AND b.id = (SELECT booking_id FROM hosting_input)`);
        return { ...notice, statements: [
          scopedStatement(access, `UPDATE session_change_proposals SET state = 'withdrawn', resolved_at = ${at}, resolved_by_id = ${actor}
            WHERE id = (SELECT proposal_id FROM hosting_input) AND ${guard.sql}`, ...guard.params ?? []),
          scopedStatement(access, `UPDATE session_bookings SET revision = revision + 1
            WHERE id = (SELECT booking_id FROM hosting_input) AND ${guard.sql}`, ...guard.params ?? []),
          bumpSlot(access, guard), ...notice.statements,
        ] };
      },
    }, firstRoster());
  }
  const withRequest = withInput(base, "slot_revision, offered_slot, offered_version, respond_by",
    [p.slotRevision, p.proposedSlotId, p.proposedListingVersionId, p.respondBy]);
  const access = { ...withRequest, sql: `${withRequest.sql}, proposed_target AS MATERIALIZED (
    SELECT next.*, v.venue_id, v.language, v.guaranteed_host_membership_id, v.terms_hash, v.price_minor, v.price_basis, v.currency,
      sl.category FROM hosting_slot sl CROSS JOIN hosting_input i
    JOIN session_slots next ON next.id = i.offered_slot AND next.id <> sl.id AND next.listing_id = sl.listing_id
      AND next.listing_version_id = i.offered_version AND next.state = 'published'
    JOIN session_listing_versions v ON v.id = next.listing_version_id
    JOIN venues venue ON venue.id = v.venue_id AND venue.state = 'approved' AND venue.approved_at <= ${at}
    WHERE next.starts_at >= i.respond_by AND ${enabled("venue.area_id", "sl.category")}
  ), candidates AS MATERIALIZED (
    SELECT b.id, b.listing_id, b.slot_id, b.listing_version_id, b.places
    FROM hosting_slot sl JOIN session_bookings b ON b.slot_id = sl.id AND b.state = 'booked'
    JOIN session_listing_versions booked_version ON booked_version.id = b.listing_version_id
    CROSS JOIN proposed_target next WHERE ${materialChange()}
  )` };
  return hostingCommand(now, access, {
    operationId: body.operationId, command: "session.propose_change", input, resultRef: p.slotId,
    authorize: hostingSlotAuthorization,
    eligible: { sql: `EXISTS (SELECT 1 FROM hosting_slot sl CROSS JOIN hosting_input i CROSS JOIN proposed_target next
      WHERE sl.revision = i.slot_revision AND sl.state IN ('published', 'paused') AND i.respond_by > ${at}
        AND i.respond_by <= sl.starts_at AND ${managesSlot("scope", "next")} AND ${staffingReady("next")}
        AND EXISTS (SELECT 1 FROM candidates)
        AND NOT EXISTS (SELECT 1 FROM candidates b JOIN session_change_proposals active ON active.booking_id = b.id
          WHERE active.state = 'pending' AND active.respond_by > ${at})
        AND next.capacity >= ${committedPlaces("next.id")} + (SELECT sum(places) FROM candidates))` },
    writes: (guard) => {
      const offered = `${currentBookers} AND EXISTS (SELECT 1 FROM session_change_proposals p CROSS JOIN hosting_input i
        WHERE p.booking_id = b.id AND p.booked_slot_id = ${hostingSlotId} AND p.proposed_slot_id = i.offered_slot
          AND p.state = 'pending' AND p.proposed_at = ${at} AND p.proposed_by_id = ${actor})`;
      const notice = bookingNotices(access, guard, "session_change_proposed", offered);
      return { ...notice, statements: [
        scopedStatement(access, `UPDATE session_change_proposals SET state = 'withdrawn', resolved_at = ${at}, resolved_by_id = ${actor}
          WHERE state = 'pending' AND respond_by <= ${at} AND booking_id IN (SELECT id FROM candidates) AND ${guard.sql}`, ...guard.params ?? []),
        scopedStatement(access, `INSERT INTO session_change_proposals
          (id, booking_id, listing_id, version, booked_slot_id, booked_listing_version_id, proposed_slot_id,
            proposed_listing_version_id, proposed_by_id, proposed_at, respond_by, state)
          SELECT lower(hex(randomblob(16))), b.id, b.listing_id,
            coalesce((SELECT max(version) FROM session_change_proposals WHERE booking_id = b.id), 0) + 1,
            b.slot_id, b.listing_version_id, i.offered_slot, i.offered_version, ${actor}, ${at}, i.respond_by, 'pending'
          FROM candidates b CROSS JOIN hosting_input i WHERE ${guard.sql}`, ...guard.params ?? []),
        scopedStatement(access, `UPDATE session_bookings SET revision = revision + 1 WHERE id IN (SELECT id FROM candidates) AND ${guard.sql}`, ...guard.params ?? []),
        bumpSlot(access, guard, "'paused'"), releaseHolds(access, guard), ...notice.statements,
      ] };
    },
  }, firstRoster());
}
