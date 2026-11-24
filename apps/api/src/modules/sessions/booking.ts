import { customerSessionBookingSchema, timestampSchema } from "@bookbuddy/api-contract";
import type {
  bookSessionHoldRoute, cancelSessionBookingRoute, createSessionHoldRoute, listSessionsRoute, moveSessionBookingRoute,
  releaseSessionHoldRoute, respondToSessionChangeRoute, ErrorBody, OperationId, RouteRequest,
} from "@bookbuddy/api-contract";
import { SESSIONS_FEATURE_FLAG, SESSION_PAYMENT_METHOD } from "@bookbuddy/domain";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { planOperation } from "../../db/operations";
import type { OperationResult, OperationSpec } from "../../db/operations";
import type { RequestScope } from "../../db/scope";
import { accessClock, at, displayName, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import type { SyncProjectionReader } from "../sync/registry";

const pageSize = 30;
// The current category policy is ten minutes in flag-enabled markets, capped at start.
const holdDurationMs = 10 * 60_000;
export const sessionBookingKind = "session_booking";
const bool = (predicate: string) => `json(CASE WHEN ${predicate} THEN 'true' ELSE 'false' END)`;
const jsonArray = (select: string) => `(SELECT json_group_array(json(value)) FROM (${select}))`;
const provider = (b: string) => `json_object('id', ${b}.id, 'name', ${b}.public_name)`;
const enabledScope = (venue: string, listing: string) => `EXISTS (SELECT 1 FROM feature_flags flag
  WHERE flag.key = '${SESSIONS_FEATURE_FLAG}' AND flag.scope_key = ${venue}.area_id || ':' || ${listing}.category AND flag.enabled = 1)`;
const availableVenue = (venue: string, listing: string) => `(${venue}.state = 'approved' AND ${enabledScope(venue, listing)})`;
const safeTotal = (version: string, places: string) => `${version}.price_minor <= ${Number.MAX_SAFE_INTEGER} / ${places}`;

// Include active target reservations for material changes. Accepting converts the
// booker's own reservation into their booking, without double-counting either.
function placesLeft(slot: string, now: string, accepting?: string): string {
  return `max(0, ${slot}.capacity - coalesce((SELECT sum(h.places) FROM session_holds h
    WHERE h.slot_id = ${slot}.id AND h.state = 'held' AND h.expires_at > ${now}), 0)
    - coalesce((SELECT sum(b.places) FROM session_bookings b
      WHERE b.slot_id = ${slot}.id AND b.state IN ('booked', 'completed')), 0)
    - coalesce((SELECT sum(party.places) FROM session_change_proposals offer
      JOIN session_bookings party ON party.id = offer.booking_id AND party.state = 'booked'
        AND party.slot_id = offer.booked_slot_id AND party.listing_version_id = offer.booked_listing_version_id
      WHERE offer.proposed_slot_id = ${slot}.id AND offer.booked_slot_id <> ${slot}.id AND offer.state = 'pending'
        AND offer.respond_by > ${now}${accepting ? ` AND party.id <> ${accepting}` : ""}), 0))`;
}

function versionJson(v: string, venue: string, withTerms = true): string {
  return `json_object('id', ${v}.id, 'title', ${v}.title, 'language', ${v}.language, 'format', ${v}.format,
    'durationMs', ${v}.duration_ms, 'price', json_object('currency', ${v}.currency, 'unitMinor', ${v}.price_minor,
      'basis', ${v}.price_basis, 'paymentMethod', '${SESSION_PAYMENT_METHOD}'),
    'venue', json_object('id', ${venue}.id, 'name', ${venue}.name, 'locality', ${venue}.locality,
      'siteZone', ${venue}.site_zone, 'accessNote', ${venue}.access_note${withTerms ? `,
      'address', ${venue}.address, 'arrivalNote', ${venue}.arrival_note` : ""})${withTerms ? `,
    'description', ${v}.description, 'originalLocale', ${v}.original_locale,
    'hostGuaranteed', ${bool(`${v}.guaranteed_host_membership_id IS NOT NULL`)},
    'terms', json_object('text', ${v}.terms_text, 'locale', ${v}.terms_locale,
      'cancellationNoticeMs', ${v}.cancellation_notice_ms, 'hash', ${v}.terms_hash)` : ""})`;
}

function agreement(slot: string, v: string, venue: string, places: string): string {
  return `json_object('slotId', ${slot}.id, 'startsAt', ${slot}.starts_at, 'endsAt', ${slot}.ends_at,
    'version', ${versionJson(v, venue)}, 'places', ${places}, 'totalMinor', ${v}.price_minor * ${places},
    'freeCancellationUntil', ${slot}.starts_at)`;
}

function host(slot: string, v: string, now: string, booking?: string): string {
  const confirmed = `json_object('name', ${displayName("person")}, 'language', assignment.language,
    'confirmed', json_object('at', assignment.confirmed_at, 'byName', ${displayName("actor")}))`;
  return `(SELECT ${booking ? `json_object('status', 'confirmed', 'host', ${confirmed},
    'isSubstitute', ${bool(`${v}.guaranteed_host_membership_id IS NULL AND EXISTS (
      SELECT 1 FROM session_host_assignments earlier WHERE earlier.slot_id = assignment.slot_id
        AND earlier.position = assignment.position AND earlier.membership_id <> assignment.membership_id
        AND earlier.state = 'released' AND earlier.confirmed_at IS NOT NULL
        AND earlier.changed_at BETWEEN ${booking}.booked_at AND assignment.confirmed_at
    )`)})` : confirmed}
    FROM session_host_assignments assignment
    JOIN memberships member ON member.id = assignment.membership_id AND member.business_id = ${slot}.business_id AND member.state = 'active'
    JOIN accounts person ON person.id = member.account_id AND person.state = 'active'
    JOIN accounts actor ON actor.id = assignment.changed_by_id
    WHERE assignment.slot_id = ${slot}.id AND assignment.state = 'confirmed' AND assignment.confirmed_at <= ${now}
      AND assignment.language = ${v}.language
      AND (${v}.guaranteed_host_membership_id IS NULL OR member.id = ${v}.guaranteed_host_membership_id)
    ORDER BY assignment.position LIMIT 1)`;
}

function bookingTables(): string {
  return `session_bookings b JOIN session_slots s ON s.id = b.slot_id
    JOIN session_listing_versions v ON v.id = b.listing_version_id
    JOIN session_listings l ON l.id = b.listing_id
    JOIN venues venue ON venue.id = v.venue_id
    JOIN businesses business ON business.id = l.business_id AND business.state = 'approved'`;
}

const canCancel = (now: string) => `b.state = 'booked' AND b.booked_at <= ${now} AND s.starts_at > ${now}`;
const openProposal = (now: string) => `EXISTS (SELECT 1 FROM session_change_proposals pending
  WHERE pending.booking_id = b.id AND pending.state = 'pending' AND pending.respond_by > ${now}
    AND pending.booked_slot_id = b.slot_id AND pending.booked_listing_version_id = b.listing_version_id)`;
const canMove = (now: string) => `${canCancel(now)} AND NOT ${openProposal(now)}`;

function proposalJson(now: string): string {
  return `(SELECT json_object('id', offer.id, 'version', offer.version,
    'state', CASE WHEN offer.state = 'pending' AND offer.respond_by <= ${now} THEN 'expired' ELSE offer.state END,
    'respondBy', offer.respond_by, 'proposed', ${agreement("target", "next", "destination", "b.places")},
    'sent', json_object('at', offer.proposed_at, 'byName', ${displayName("sender")}), 'decidedAt', offer.resolved_at)
    FROM session_change_proposals offer
    JOIN session_slots target ON target.id = offer.proposed_slot_id
    JOIN session_listing_versions next ON next.id = offer.proposed_listing_version_id
    JOIN venues destination ON destination.id = next.venue_id
    JOIN accounts sender ON sender.id = offer.proposed_by_id
    WHERE offer.booking_id = b.id AND offer.proposed_at <= ${now} AND ${enabledScope("destination", "l")}
      AND ${safeTotal("next", "b.places")}
    ORDER BY offer.version DESC LIMIT 1)`;
}

function bookingJson(now: string): string {
  return `json_object('id', b.id, 'reference', b.reference, 'listingId', b.listing_id, 'provider', ${provider("business")},
    'revision', b.revision, 'state', b.state, 'bookerName', ${displayName("booker")}, 'bookedAt', b.booked_at,
    'original', json_object('slotId', b.original_slot_id, 'listingVersionId', b.original_listing_version_id, 'termsHash', b.original_terms_hash),
    'agreement', ${agreement("s", "v", "venue", "b.places")},
    'day', json((SELECT json_object('stage', s.day_stage, 'at', s.stage_at, 'byName', ${displayName("actor")}) FROM accounts actor
      WHERE actor.id = s.stage_by_id AND s.stage_at <= ${now} AND b.state <> 'cancelled')),
    'host', json(coalesce(${host("s", "v", now, "b")},
      json_object('status', CASE WHEN b.state = 'booked' AND s.state = 'paused' THEN 'arranging' ELSE 'unconfirmed' END, 'nextUpdateAt', NULL))),
    'coordinatorName', (SELECT ${displayName("coordinator")} FROM memberships team JOIN accounts coordinator ON coordinator.id = team.account_id
      WHERE team.id = s.coordinator_membership_id AND team.state = 'active' AND coordinator.state = 'active'),
    'threadId', (SELECT thread.id FROM session_threads thread WHERE thread.booking_id = b.id AND thread.audience = 'session'),
    'proposal', json(${proposalJson(now)}),
    'cancellation', json((SELECT json_object('at', b.cancelled_at, 'byName', ${displayName("actor")}) FROM accounts actor
      WHERE actor.id = b.cancelled_by_id)),
    'actions', json_object('move', ${bool(canMove(now))}, 'cancel', ${bool(canCancel(now))},
      'respond', ${bool(`${canCancel(now)} AND ${openProposal(now)}`)},
      'leaveFeedback', ${bool(`b.state = 'completed' AND EXISTS (SELECT 1 FROM session_attendance attendance
        WHERE attendance.booking_id = b.id AND attendance.result = 'attended' AND attendance.recorded_at <= ${now}
          AND NOT EXISTS (SELECT 1 FROM session_attendance correction WHERE correction.corrects_id = attendance.id))
        AND NOT EXISTS (SELECT 1 FROM session_booking_feedback feedback WHERE feedback.booking_id = b.id)`)}) )`;
}

export function sessionBookingValue(id: string, scope: string, now = at): string {
  return `(SELECT ${bookingJson(now)} FROM ${bookingTables()}
    JOIN accounts booker ON booker.id = b.booker_id
    WHERE b.id = ${id} AND b.booker_id = ${scope}.account_id AND ${scope}.role = 'customer' AND ${enabledScope("venue", "l")})`;
}

export const sessionBookingSyncProjection: SyncProjectionReader = {
  kind: sessionBookingKind, schema: customerSessionBookingSchema, roles: ["customer"],
  snapshotIds() {
    return { sql: `SELECT b.id AS resource_id FROM snapshot_scope scope CROSS JOIN ${bookingTables()}
      WHERE scope.role = 'customer' AND scope.account_id = b.booker_id AND b.id > scope.after_id AND ${enabledScope("venue", "l")}` };
  },
  project(now) {
    return { sql: `SELECT k.resource_id, ${sessionBookingValue("k.resource_id", "scope", String(now))} AS value
      FROM projection_keys k CROSS JOIN live_scope scope WHERE k.kind = '${sessionBookingKind}' AND scope.role = 'customer'` };
  },
};

export function readSessionBooking(session: SessionAccess, now: number, id: string): CommandStatement {
  return scopedStatement(accessClock(session, now), `, request(id) AS (VALUES (?))
    SELECT (SELECT ${sessionBookingValue("request.id", "scope")} FROM live_scope scope CROSS JOIN request) AS value FROM acting_session`, id);
}

interface Position { start: number; id: string }
export function sessionPosition(cursor: string | undefined): Position | null {
  if (cursor === undefined) return { start: Number.MIN_SAFE_INTEGER, id: "" };
  const match = /^1~(-?\d{1,16})~([A-Za-z0-9_-]{1,256})$/.exec(cursor);
  if (match === null) return null;
  const start = timestampSchema.safeParse(Number(match[1]));
  return start.success ? { start: start.data, id: match[2]! } : null;
}

const page = (start: string, id: string) => `json_object('hasMore', ${bool(`(SELECT count(*) FROM page_slots) > ${pageSize}`)},
  'cursor', CASE WHEN (SELECT count(*) FROM page_slots) > ${pageSize} THEN (SELECT '1~' || ${start} || '~' || ${id}
    FROM page_slots ORDER BY ${start}, ${id} LIMIT 1 OFFSET ${pageSize - 1}) END)`;

const slotJson = (s: string, places: string, details?: string) => `json_object('id', ${s}.id, 'listingVersionId', ${s}.listing_version_id,
  'startsAt', ${s}.starts_at, 'endsAt', ${s}.ends_at, 'capacity', ${s}.capacity, 'placesLeft', ${places}, 'state', ${s}.state${details ?? ""})`;

type BrowseQuery = Required<Pick<RouteRequest<typeof listSessionsRoute.input>["query"], "areaId">> & {
  category?: string; locality?: string; language?: string; startsFrom?: number; startsBefore?: number;
};

export function readSessions(session: SessionAccess, now: number, query: BrowseQuery, position: Position): CommandStatement {
  const language = query.language === undefined ? null : Intl.getCanonicalLocales(query.language)[0]!;
  return scopedStatement(accessClock(session, now), `, request(area, locality, category, language, from_at, before_at, after_at, after_id)
    AS (VALUES (?, ?, ?, ?, ?, ?, ?, ?)), enabled(category) AS MATERIALIZED (
      SELECT substr(flag.scope_key, length(i.area) + 2) FROM request i JOIN feature_flags flag
      WHERE flag.key = '${SESSIONS_FEATURE_FLAG}' AND flag.enabled = 1
        AND flag.scope_key > i.area || ':' AND flag.scope_key < i.area || ';'
    ), candidates AS MATERIALIZED (
      SELECT s.*, ${placesLeft("s", at)} AS available
      FROM live_scope scope CROSS JOIN request i
      JOIN venues venue ON venue.area_id = i.area AND venue.state = 'approved' AND (i.locality IS NULL OR venue.locality = i.locality COLLATE NOCASE)
      JOIN session_listing_versions v ON v.venue_id = venue.id AND (i.language IS NULL OR v.language = i.language COLLATE NOCASE)
      JOIN session_listings l ON l.id = v.listing_id
      JOIN enabled e ON e.category = l.category
      JOIN businesses business ON business.id = l.business_id AND business.state = 'approved'
      JOIN session_slots s ON s.listing_id = l.id AND s.listing_version_id = v.id
      WHERE scope.role = 'customer' AND (i.category IS NULL OR l.category = i.category)
        AND s.state = 'published' AND s.starts_at > ${at}
        AND (i.from_at IS NULL OR s.starts_at >= i.from_at) AND (i.before_at IS NULL OR s.starts_at < i.before_at)
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY listing_id ORDER BY available = 0, starts_at, id) AS rank FROM candidates
    ), page_slots AS MATERIALIZED (
      SELECT ranked.* FROM ranked CROSS JOIN request i WHERE rank = 1 AND (starts_at, listing_id) > (i.after_at, i.after_id)
      ORDER BY starts_at, listing_id LIMIT ${pageSize + 1}
    ) SELECT CASE WHEN EXISTS (SELECT 1 FROM live_scope WHERE role = 'customer')
      AND EXISTS (SELECT 1 FROM enabled e CROSS JOIN request i WHERE i.category IS NULL OR e.category = i.category) THEN
      json_object('categories', json((SELECT json_group_array(category) FROM (SELECT category FROM enabled ORDER BY category))),
        'sessions', json(${jsonArray(`SELECT json_object('id', l.id, 'provider', ${provider("business")}, 'category', l.category,
          'version', ${versionJson("v", "venue", false)}, 'nextSlot', ${slotJson("s", "s.available")}) AS value
          FROM page_slots s JOIN session_listings l ON l.id = s.listing_id JOIN businesses business ON business.id = l.business_id
          JOIN session_listing_versions v ON v.id = s.listing_version_id JOIN venues venue ON venue.id = v.venue_id
          ORDER BY s.starts_at, s.listing_id LIMIT ${pageSize}`)}), 'page', ${page("starts_at", "listing_id")}) END AS value
    FROM acting_session`, query.areaId, query.locality ?? null, query.category ?? null, language, query.startsFrom ?? null,
  query.startsBefore ?? null, position.start, position.id);
}

export function customerSessionValue(id: string, position: Position): CommandStatement {
  return { params: [id, position.start, position.id], sql: `WITH request(id, after_at, after_id) AS (VALUES (?, ?, ?)),
    public_listing AS MATERIALIZED (
      SELECT l.id, l.category, ${provider("business")} AS provider FROM request i
      JOIN session_listings l ON l.id = i.id JOIN businesses business ON business.id = l.business_id AND business.state = 'approved'
    ), candidates AS MATERIALIZED (
      SELECT s.*, ${placesLeft("s", at)} AS available
      FROM public_listing l JOIN session_slots s ON s.listing_id = l.id
      JOIN session_listing_versions v ON v.id = s.listing_version_id JOIN venues venue ON venue.id = v.venue_id
      WHERE s.state IN ('published', 'paused') AND s.starts_at > ${at} AND ${availableVenue("venue", "l")}
    ), page_slots AS MATERIALIZED (
      SELECT s.* FROM candidates s CROSS JOIN request i WHERE (s.starts_at, s.id) > (i.after_at, i.after_id)
      ORDER BY s.starts_at, s.id LIMIT ${pageSize + 1}
    ), next_slot AS (
      SELECT id, state, available FROM candidates ORDER BY state <> 'published', available = 0, starts_at, id LIMIT 1
    ) SELECT json_object('id', l.id, 'provider', json(l.provider), 'category', l.category, 'audience', 'customer',
      'availability', CASE WHEN first.state = 'paused' THEN 'paused' WHEN first.available = 0 THEN 'full' ELSE 'available' END,
      'nextSlotId', first.id, 'slots', json(${jsonArray(`SELECT ${slotJson("s", "s.available", `,
        'host', json(${host("s", "v", at)}), 'freeCancellationUntil', s.starts_at`)} AS value
        FROM page_slots s JOIN session_listing_versions v ON v.id = s.listing_version_id
        ORDER BY s.starts_at, s.id LIMIT ${pageSize}`)}),
      'versions', json(${jsonArray(`SELECT ${versionJson("v", "venue")} AS value
        FROM session_listing_versions v JOIN venues venue ON venue.id = v.venue_id WHERE v.id IN (
          SELECT listing_version_id FROM page_slots ORDER BY starts_at, id LIMIT ${pageSize}
        ) ORDER BY v.no`)}), 'page', ${page("starts_at", "id")})
    FROM public_listing l CROSS JOIN next_slot first` };
}

export interface SessionCommandResult { operation: OperationResult; value: string | null; error?: ErrorBody }
interface ResultRow { value: string | null; refusal: string | null; revision: number | null }
type Body<Payload> = { operationId: OperationId; expectedRevision?: number; payload: Payload };
type HoldInput = RouteRequest<typeof createSessionHoldRoute.input>["body"]["payload"];
type BookInput = RouteRequest<typeof bookSessionHoldRoute.input>["body"]["payload"];
type ReleaseInput = RouteRequest<typeof releaseSessionHoldRoute.input>["body"]["payload"];
type MoveInput = RouteRequest<typeof moveSessionBookingRoute.input>["body"]["payload"];
type CancelInput = RouteRequest<typeof cancelSessionBookingRoute.input>["body"]["payload"];
type RespondInput = RouteRequest<typeof respondToSessionChangeRoute.input>["body"]["payload"];

// The authorization CTE intentionally keeps terminal resources visible. A
// replay rechecks live ownership and flags, not the pre-commit state guard.
async function sessionReceipt(
  ctx: RequestScope, access: SessionAccess, spec: Omit<OperationSpec, "access" | "authorize">,
  projection: { value: string; refusal?: string; revision?: { sql: string; expected: number } },
): Promise<CommandInput<SessionCommandResult>> {
  const plan = await planOperation(ctx, { ...spec, access, authorize: { sql: "EXISTS (SELECT 1 FROM subject)" } });
  const result = scopedStatement(access, `SELECT CASE WHEN receipt.operation_id IS NOT NULL THEN (${projection.value}) END AS value,
      CASE WHEN receipt.operation_id IS NULL THEN (${projection.refusal ?? "NULL"}) END AS refusal,
      (${projection.revision?.sql ?? "NULL"}) AS revision
    FROM live_scope scope LEFT JOIN operation_receipts receipt ON receipt.account_id = scope.account_id AND receipt.context_id = scope.context_id
      AND receipt.operation_id = ? AND receipt.command = ? WHERE EXISTS (SELECT 1 FROM subject)`, spec.operationId, spec.command);
  return { statements: [...plan.statements, result], decode(results) {
    const operation = plan.decode(results);
    const row = results.at(-1)?.results[0] as ResultRow | undefined;
    if (operation.outcome.status !== "rejected") return { operation, value: row?.value ?? null };
    const error = operation.outcome.error;
    if (error.code === "CONFLICT") {
      if (projection.revision && row?.revision != null && row.revision !== projection.revision.expected) {
        return { operation, value: null, error: { code: "STALE_REVISION", current: { kind: "revision", revision: row.revision } } };
      }
      if (row?.refusal) return { operation, value: row.refusal };
    }
    return { operation, value: null, error };
  } };
}

function sessionSubject(session: SessionAccess, now: number, fields: string, params: unknown[], sql: string): SessionAccess {
  const access = accessClock(session, now);
  return { sql: `${access.sql}, request(${fields}) AS (VALUES (${params.map(() => "?").join(", ")})), ${sql}`,
    params: [...access.params, ...params] };
}

function bookerChanges(id: string, now: number): CommandStatement {
  return { sql: `SELECT '${sessionBookingKind}' AS kind, b.id AS resource_id, audience.id AS partition_key, 'upsert' AS op, ? AS at
    FROM session_bookings b JOIN account_contexts audience ON audience.account_id = b.booker_id AND audience.role = 'customer'
    WHERE b.id = ?`, params: [now, id] };
}

const bookingSubject = (join = "") => `subject AS (
    SELECT b.* FROM live_scope scope CROSS JOIN request i CROSS JOIN ${bookingTables()} ${join}
    WHERE b.id = i.booking_id AND scope.role = 'customer' AND b.booker_id = scope.account_id AND ${enabledScope("venue", "l")}
  )`;
const subjectBooking = sessionBookingValue("(SELECT id FROM subject)", "scope");
const subjectRevision = "(SELECT revision FROM subject)";

export function planSessionHold(ctx: RequestScope, session: SessionAccess, listingId: string, body: Body<HoldInput>) {
  const { id, slotId, places, moveBookingId } = body.payload;
  const access = sessionSubject(session, ctx.now, "listing_id, slot_id, hold_id, quantity, move_id", [listingId, slotId, id, places, moveBookingId ?? null], `subject AS (
    SELECT s.*, v.terms_hash, v.price_minor, v.format, scope.account_id, i.hold_id, i.quantity, i.move_id
    FROM live_scope scope CROSS JOIN request i
    JOIN session_slots s ON s.id = i.slot_id AND s.listing_id = i.listing_id AND s.state IN ('published', 'paused')
    JOIN session_listing_versions v ON v.id = s.listing_version_id JOIN venues venue ON venue.id = v.venue_id
    JOIN session_listings l ON l.id = s.listing_id JOIN businesses business ON business.id = l.business_id AND business.state = 'approved'
    WHERE scope.role = 'customer' AND ${availableVenue("venue", "l")}
      AND (i.move_id IS NULL OR EXISTS (SELECT 1 FROM ${bookingTables()} WHERE b.id = i.move_id
        AND b.booker_id = scope.account_id AND b.listing_id = i.listing_id AND ${enabledScope("venue", "l")}))
  )`);
  const bookable = `s.state = 'published' AND s.starts_at > ${at} AND (s.format <> 'private' OR s.quantity = 1)
    AND ${safeTotal("s", "s.quantity")} AND (s.move_id IS NULL OR EXISTS (
      SELECT 1 FROM ${bookingTables()} CROSS JOIN request wanted
      WHERE b.id = wanted.move_id AND b.slot_id <> wanted.slot_id AND b.places = wanted.quantity AND ${canMove(at)}
    ))`;
  const activeHold = `EXISTS (SELECT 1 FROM session_holds h WHERE h.booker_id = s.account_id AND h.state = 'held' AND h.expires_at > ${at})`;
  const available = placesLeft("s", at);
  const notHeld = (reason: string) => `json_object('status', 'not_held', 'reason', ${reason}, 'slotId', s.id, 'placesLeft', ${available})`;
  const held = `SELECT json_object('status', 'held', 'id', h.id, 'listingId', h.listing_id,
    'provider', ${provider("business")}, 'bookerName', ${displayName("booker")}, 'expiresAt', h.expires_at,
    'agreement', ${agreement("s", "chosen", "location", "h.places")}, 'host', json(${host("s", "chosen", at)}),
    'moveFrom', json((SELECT json_object('id', b.id, 'reference', b.reference, 'startsAt', s.starts_at, 'endsAt', s.ends_at, 'siteZone', venue.site_zone)
      FROM ${bookingTables()} WHERE b.id = h.move_booking_id AND ${enabledScope("venue", "l")})))
    FROM subject s JOIN session_holds h ON h.id = s.hold_id AND h.booker_id = s.account_id AND h.slot_id = s.id
    JOIN session_listing_versions chosen ON chosen.id = h.listing_version_id JOIN venues location ON location.id = chosen.venue_id
    JOIN session_listings l ON l.id = h.listing_id JOIN businesses business ON business.id = l.business_id
    JOIN accounts booker ON booker.id = h.booker_id
    WHERE h.state = 'held' AND h.expires_at > ${at} AND ${availableVenue("location", "l")}`;
  return sessionReceipt(ctx, access, {
    operationId: body.operationId, command: "session_hold", input: [listingId, body], resultRef: id,
    eligible: { sql: `EXISTS (SELECT 1 FROM subject s WHERE ${bookable} AND NOT ${activeHold} AND s.quantity <= ${available}
      AND NOT EXISTS (SELECT 1 FROM session_holds used WHERE used.id = s.hold_id))` },
    writes: (guard) => ({ statements: [
      scopedStatement(access, `UPDATE session_holds SET state = 'released', resolved_at = ${at}
        WHERE booker_id = (SELECT account_id FROM subject) AND state = 'held' AND expires_at <= ${at} AND ${guard.sql}`, ...guard.params ?? []),
      scopedStatement(access, `INSERT INTO session_holds (id, slot_id, listing_id, listing_version_id, terms_hash, booker_id, move_booking_id,
          places, held_at, expires_at, state)
        SELECT s.hold_id, s.id, s.listing_id, s.listing_version_id, s.terms_hash, s.account_id, s.move_id, s.quantity,
          ${at}, min(s.starts_at, ${at} + ${holdDurationMs}), 'held' FROM subject s WHERE ${guard.sql}`, ...guard.params ?? []),
    ] }),
  }, {
    value: `SELECT coalesce((${held}), ${notHeld("'booking_unavailable'")}) FROM subject s`,
    refusal: `SELECT CASE WHEN NOT (${bookable}) THEN ${notHeld("'booking_unavailable'")}
      WHEN ${activeHold} THEN ${notHeld("'active_hold_exists'")}
      WHEN s.quantity > ${available} THEN ${notHeld("'places_unavailable'")} END FROM subject s`,
  });
}

const authorizedHold = `owned_hold AS (
  SELECT h.* FROM live_scope scope CROSS JOIN request i
  JOIN session_holds h ON h.id = i.hold_id JOIN session_listings l ON l.id = h.listing_id
  JOIN businesses business ON business.id = l.business_id AND business.state = 'approved'
  JOIN session_listing_versions held ON held.id = h.listing_version_id JOIN venues original ON original.id = held.venue_id
  WHERE scope.role = 'customer' AND scope.account_id = h.booker_id AND ${enabledScope("original", "l")}
)`;
const holdTarget = `hold_target AS (
  SELECT target.id, target.listing_version_id, target.state, target.starts_at, next.terms_hash, next.price_minor
  FROM owned_hold h JOIN session_slots target ON target.id = h.slot_id
  JOIN session_listing_versions next ON next.id = target.listing_version_id JOIN venues destination ON destination.id = next.venue_id
  JOIN session_listings listing ON listing.id = h.listing_id
  WHERE ${availableVenue("destination", "listing")} AND ${safeTotal("next", "h.places")}
    AND (next.format <> 'private' OR h.places = 1)
)`;
const targetOpen = `target.state = 'published' AND target.starts_at > ${at}`;
const targetTerms = `target.listing_version_id = i.version_id AND target.terms_hash = i.terms_hash AND target.price_minor * h.places = i.total_minor`;
const validHeldTerms = `h.state = 'held' AND h.held_at <= ${at} AND h.expires_at > ${at}
  AND h.listing_version_id = target.listing_version_id AND h.terms_hash = target.terms_hash AND ${targetOpen} AND ${targetTerms}`;
const holdFailure = `SELECT CASE
  WHEN h.state <> 'consumed' AND h.expires_at <= ${at} THEN json_object('reason', 'expired', 'expiresAt', h.expires_at)
  WHEN h.state = 'held' AND ${targetOpen} AND (h.listing_version_id <> target.listing_version_id OR NOT (${targetTerms})) THEN
    json_object('reason', 'terms_changed', 'current', json((SELECT ${agreement("slot", "next", "destination", "h.places")}
      FROM session_slots slot JOIN session_listing_versions next ON next.id = slot.listing_version_id
      JOIN venues destination ON destination.id = next.venue_id WHERE slot.id = target.id)))
  ELSE json_object('reason', 'slot_unavailable') END
  FROM owned_hold h CROSS JOIN request i LEFT JOIN hold_target target ON target.id = h.slot_id`;

export function planBookSession(ctx: RequestScope, session: SessionAccess, holdId: string, body: Body<BookInput>) {
  const { id, listingVersionId, termsHash, totalMinor } = body.payload;
  const access = sessionSubject(session, ctx.now, "hold_id, booking_id, version_id, terms_hash, total_minor",
    [holdId, id, listingVersionId, termsHash, totalMinor], `${authorizedHold}, ${holdTarget}, subject AS (
      SELECT * FROM owned_hold WHERE move_booking_id IS NULL
    )`);
  const booking = sessionBookingValue("(SELECT booking_id FROM request)", "scope");
  return sessionReceipt(ctx, access, {
    operationId: body.operationId, command: "session_book", input: [holdId, body], resultRef: id,
    eligible: { sql: `EXISTS (SELECT 1 FROM subject h JOIN hold_target target ON target.id = h.slot_id CROSS JOIN request i
      WHERE ${validHeldTerms} AND NOT EXISTS (SELECT 1 FROM session_bookings used WHERE used.id = i.booking_id))` },
    writes: (guard) => ({ statements: [{
      sql: `INSERT INTO session_bookings (id, reference, booker_id, listing_id, original_hold_id, original_slot_id,
        original_listing_version_id, original_terms_hash, slot_id, listing_version_id, terms_hash, places, state, booked_at)
        SELECT ?, 'BB-S' || upper(hex(randomblob(10))), h.booker_id, h.listing_id, h.id, h.slot_id, h.listing_version_id, h.terms_hash,
          h.slot_id, h.listing_version_id, h.terms_hash, h.places, 'booked', ?
        FROM session_holds h WHERE h.id = ? AND ${guard.sql}`,
      params: [id, ctx.now, holdId, ...guard.params ?? []],
    }], changes: bookerChanges(id, ctx.now) }),
  }, {
    value: `SELECT json_object('status', 'booked', 'booking', json(${booking}))`,
    refusal: `SELECT json_object('status', 'not_booked', 'failure', json((${holdFailure})))`,
  });
}

export function planReleaseSessionHold(ctx: RequestScope, session: SessionAccess, holdId: string, body: Body<ReleaseInput>) {
  const access = sessionSubject(session, ctx.now, "hold_id", [holdId], `${authorizedHold}, subject AS (SELECT * FROM owned_hold)`);
  return sessionReceipt(ctx, access, {
    operationId: body.operationId, command: "session_release", input: [holdId, body], resultRef: holdId, eligible: { sql: "1" },
    writes: (guard) => ({ statements: [{
      sql: `UPDATE session_holds SET state = 'released', resolved_at = max(?, held_at)
        WHERE id = ? AND state = 'held' AND ${guard.sql}`, params: [ctx.now, holdId, ...guard.params ?? []],
    }] }),
  }, { value: `SELECT json_object('id', id, 'state', state, 'resolvedAt', resolved_at) FROM subject` });
}

function withdrawOffers(guard: CommandStatement, bookingId: string, now: number): CommandStatement {
  return { sql: `UPDATE session_change_proposals AS offer SET state = 'withdrawn', resolved_at = max(?, proposed_at),
    resolved_by_id = (SELECT booker_id FROM session_bookings b WHERE b.id = offer.booking_id)
    WHERE booking_id = ? AND state = 'pending' AND ${guard.sql}`, params: [now, bookingId, ...guard.params ?? []] };
}

function releaseMoveHold(guard: CommandStatement, bookingId: string, now: number): CommandStatement {
  return { sql: `UPDATE session_holds SET state = 'released', resolved_at = max(?, held_at)
    WHERE move_booking_id = ? AND state = 'held' AND ${guard.sql}`, params: [now, bookingId, ...guard.params ?? []] };
}

export function planMoveSessionBooking(ctx: RequestScope, session: SessionAccess, id: string, body: Body<MoveInput>) {
  const { holdId, bookingRevision, listingVersionId, termsHash, totalMinor } = body.payload;
  const access = sessionSubject(session, ctx.now, "booking_id, hold_id, version_id, terms_hash, total_minor",
    [id, holdId, listingVersionId, termsHash, totalMinor], `${authorizedHold}, ${holdTarget}, ${bookingSubject("JOIN owned_hold h ON h.move_booking_id = b.id")}`);
  return sessionReceipt(ctx, access, {
    operationId: body.operationId, command: "session_move", input: [id, body], resultRef: id,
    eligible: { sql: `EXISTS (SELECT 1 FROM subject b JOIN session_slots s ON s.id = b.slot_id
      JOIN owned_hold h ON h.move_booking_id = b.id JOIN hold_target target ON target.id = h.slot_id CROSS JOIN request i
      WHERE b.revision = ? AND ${canMove(at)} AND b.slot_id <> h.slot_id AND b.places = h.places AND ${validHeldTerms})`, params: [bookingRevision] },
    writes: (guard) => ({ statements: [
      { sql: `UPDATE session_holds SET state = 'consumed', resolved_at = ? WHERE id = ? AND ${guard.sql}`,
        params: [ctx.now, holdId, ...guard.params ?? []] },
      { sql: `UPDATE session_bookings SET (slot_id, listing_version_id, terms_hash) =
          (SELECT slot_id, listing_version_id, terms_hash FROM session_holds WHERE id = ?), revision = revision + 1
        WHERE id = ? AND ${guard.sql}`, params: [holdId, id, ...guard.params ?? []] },
      withdrawOffers(guard, id, ctx.now),
    ], changes: bookerChanges(id, ctx.now) }),
  }, {
    value: `SELECT json_object('status', 'moved', 'booking', json(${subjectBooking}))`,
    refusal: `SELECT json_object('status', 'not_moved', 'booking', json(${subjectBooking}), 'failure', json((${holdFailure})))`,
    revision: { sql: subjectRevision, expected: bookingRevision },
  });
}

export function planCancelSessionBooking(ctx: RequestScope, session: SessionAccess, id: string, body: Body<CancelInput>) {
  const { bookingRevision, termsHash } = body.payload;
  const access = sessionSubject(session, ctx.now, "booking_id", [id], bookingSubject());
  return sessionReceipt(ctx, access, {
    operationId: body.operationId, command: "session_cancel", input: [id, body], resultRef: id,
    eligible: { sql: `EXISTS (SELECT 1 FROM subject b JOIN session_slots s ON s.id = b.slot_id
      WHERE b.terms_hash = ? AND b.revision = ? AND ${canCancel(at)})`, params: [termsHash, bookingRevision] },
    writes: (guard) => ({ statements: [
      { sql: `UPDATE session_bookings SET state = 'cancelled', cancelled_at = ?, cancelled_by_id = booker_id, revision = revision + 1
        WHERE id = ? AND ${guard.sql}`, params: [ctx.now, id, ...guard.params ?? []] },
      withdrawOffers(guard, id, ctx.now),
      releaseMoveHold(guard, id, ctx.now),
    ], changes: bookerChanges(id, ctx.now) }),
  }, { value: subjectBooking, revision: { sql: subjectRevision, expected: bookingRevision } });
}

export function planRespondToSessionChange(ctx: RequestScope, session: SessionAccess, id: string, body: Body<RespondInput>) {
  const { bookingRevision, proposalId, version, decision } = body.payload;
  const accept = decision === "accept";
  const access = sessionSubject(session, ctx.now, "booking_id, proposal_id, proposal_version", [id, proposalId, version], bookingSubject());
  const targetAvailable = `EXISTS (SELECT 1 FROM session_slots target
    JOIN session_listing_versions next ON next.id = target.listing_version_id
    JOIN venues destination ON destination.id = next.venue_id JOIN session_listings listing ON listing.id = target.listing_id
    WHERE target.id = offer.proposed_slot_id AND target.listing_version_id = offer.proposed_listing_version_id AND ${targetOpen}
      AND ${availableVenue("destination", "listing")} AND ${safeTotal("next", "b.places")}
      AND (next.format <> 'private' OR b.places = 1)
      AND (target.id = b.slot_id OR b.places <= ${placesLeft("target", at, "b.id")}))`;
  return sessionReceipt(ctx, access, {
    operationId: body.operationId, command: "session_respond", input: [id, body], resultRef: id,
    eligible: { sql: `EXISTS (SELECT 1 FROM subject b JOIN session_slots s ON s.id = b.slot_id CROSS JOIN request i
      JOIN session_change_proposals offer ON offer.booking_id = b.id AND offer.id = i.proposal_id AND offer.version = i.proposal_version
      WHERE b.revision = ? AND ${canCancel(at)} AND offer.state = 'pending' AND offer.proposed_at <= ${at} AND offer.respond_by > ${at}
        AND offer.booked_slot_id = b.slot_id AND offer.booked_listing_version_id = b.listing_version_id${accept ? ` AND ${targetAvailable}` : ""})`,
    params: [bookingRevision] },
    writes: (guard) => ({ statements: [
      { sql: `UPDATE session_change_proposals SET state = ?, resolved_at = ?, resolved_by_id =
          (SELECT booker_id FROM session_bookings WHERE id = ?) WHERE id = ? AND ${guard.sql}`,
        params: [accept ? "accepted" : "declined", ctx.now, id, proposalId, ...guard.params ?? []] },
      { sql: `UPDATE session_bookings SET revision = revision + 1${accept ? `, (slot_id, listing_version_id, terms_hash) =
          (SELECT offer.proposed_slot_id, offer.proposed_listing_version_id, v.terms_hash FROM session_change_proposals offer
          JOIN session_listing_versions v ON v.id = offer.proposed_listing_version_id WHERE offer.id = ?)` : ""}
        WHERE id = ? AND ${guard.sql}`, params: [...(accept ? [proposalId] : []), id, ...guard.params ?? []] },
      ...(accept ? [releaseMoveHold(guard, id, ctx.now)] : []),
    ], changes: bookerChanges(id, ctx.now) }),
  }, { value: subjectBooking, revision: { sql: subjectRevision, expected: bookingRevision } });
}
