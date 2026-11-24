import type { CommandStatement } from "../../db/commit";
import { accessClock, at } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { sessionsBusinessEnabled, sessionsCategoryEnabled, sessionsCustomerMarket } from "../sessions/policy";

export const isSessionThread = (id: string) => /^session-[a-f0-9]{32}$/.test(id);

// The booking tracks the current slot and exact accepted listing version.
// Changing either changes admission immediately, including on link and effect claims.
export function sessionChatTargets(oneBooking: boolean, bookings = "session_bookings"): string {
  return `SELECT ${oneBooking ? "booking.thread_id" : "t.id"} AS id, NULL AS job_id, booking.id AS session_booking_id,
    'session' AS audience, ${oneBooking ? "'open', 0" : "t.write_state, t.last_position"},
    listing.business_id, NULL AS place_id, booking.booker_id AS requester_id,
    slot.coordinator_membership_id AS accountable_foreman_membership_id, booking.reference, version.title,
    booking.state = 'booked' AND slot.state IN ('published', 'paused') AS parent_open,
    venue.site_zone, slot.id AS slot_id, booking.booked_at, version.language AS host_language,
    version.guaranteed_host_membership_id AS guaranteed_host_id, venue.area_id AS session_area_id
    FROM ${bookings} booking ${oneBooking ? "" : "JOIN chat_threads t ON t.session_booking_id = booking.id"}
    JOIN session_listings listing ON listing.id = booking.listing_id
    JOIN session_slots slot ON slot.id = booking.slot_id
    JOIN session_listing_versions version ON version.id = booking.listing_version_id
    JOIN venues venue ON venue.id = version.venue_id
    JOIN businesses business ON business.id = listing.business_id AND business.state = 'approved'
    WHERE booking.booked_at <= ${at} AND ${sessionsBusinessEnabled("listing.business_id")}
      AND ${sessionsCategoryEnabled("venue.area_id", "listing.category")}
    ${oneBooking ? "AND booking.thread_id = ? AND NOT EXISTS (SELECT 1 FROM chat_threads WHERE session_booking_id = booking.id)" : ""}`;
}

export function sessionChatGrants(targets: string, contextFilter: string, staff: string): string {
  return `SELECT t.*, c.id, c.account_id, c.role, t.booked_at
    FROM ${targets} t JOIN account_contexts c ON c.account_id = t.requester_id AND c.role = 'customer'
    WHERE t.audience = 'session' AND (${contextFilter}) AND ${sessionsCustomerMarket("c.account_id", "t.session_area_id")}
    UNION ALL
    SELECT t.*, c.id, c.account_id, c.role, max(t.booked_at, role.granted_at, coalesce(host.confirmed_at, 0))
    FROM ${targets} t JOIN account_contexts c ON c.business_id = t.business_id ${staff}
    LEFT JOIN session_host_assignments host ON c.role = 'worker' AND host.slot_id = t.slot_id
      AND host.membership_id = m.id AND host.state = 'confirmed' AND host.confirmed_at <= ${at}
      AND host.language = t.host_language COLLATE NOCASE AND (t.guaranteed_host_id IS NULL OR t.guaranteed_host_id = m.id)
    WHERE t.audience = 'session' AND (${contextFilter}) AND (c.role = 'provider_admin'
      OR (c.role = 'foreman' AND m.id = t.accountable_foreman_membership_id)
      OR (c.role = 'worker' AND host.id IS NOT NULL))`;
}

// As with legacy job inbox provisioning, the first authorized open inserts
// only the missing durable row. Execute this in the same batch as the read.
export function ensureSessionThread(session: SessionAccess, now: number, id: string, staff: string): CommandStatement {
  const scope = accessClock(session, now);
  return { sql: `${scope.sql}, candidates AS MATERIALIZED (${sessionChatTargets(true)}), allowed AS (
      ${sessionChatGrants("candidates", "c.id = (SELECT context_id FROM live_scope)", staff)})
    INSERT INTO chat_threads (id, session_booking_id, audience, write_state)
    SELECT id, session_booking_id, 'session', CASE WHEN parent_open THEN 'open' ELSE 'read_only' END FROM allowed WHERE 1
    ON CONFLICT (session_booking_id) DO NOTHING`, params: [...scope.params, id] };
}
