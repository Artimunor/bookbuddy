import { idSchema, shiftAgendaSchema } from "@bookbuddy/api-contract";
import type { ShiftAgenda } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";
import { accessClock, at, displayName, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { currentMembership } from "../jobs/projections";
import { foreman, jobOpen, scheduleAccess, targetId, workerContext } from "./policy";

const pageSize = 50;
const array = (select: string) => `(SELECT json_group_array(json(value)) FROM (${select}))`;
const title = "coalesce(nullif(j.trade, ''), j.reference)";
const liveShift = "sh.state IN ('planned', 'active') AND v.state = 'booked' AND j.state = 'open' AND p.state = 'in_area'";
const activeWork = (clock: string) => `(${liveShift} AND sh.ends_at > ${clock} AND a.state = 'confirmed')`;
const taskJoin = `JOIN shifts sh ON sh.id = slot.shift_id JOIN visits v ON v.id = sh.visit_id
  JOIN jobs j ON j.id = v.job_id JOIN places p ON p.id = j.place_id JOIN businesses b ON b.id = j.business_id
  JOIN operating_areas area ON area.id = b.catchment_id`;
const assignmentFrom = `FROM assignments a JOIN shift_slots slot ON slot.id = a.slot_id JOIN shifts sh ON sh.id = slot.shift_id
  JOIN visits v ON v.id = sh.visit_id JOIN jobs j ON j.id = v.job_id JOIN places p ON p.id = j.place_id
  JOIN businesses b ON b.id = j.business_id JOIN operating_areas area ON area.id = b.catchment_id`;
const zone = "coalesce(p.site_zone, area.site_zone)";

const upcoming = shiftAgendaSchema.options[0];
const upcomingRow = upcoming.shape.rows.element;
export const cachedAgendaSchema = upcoming.pick({ segment: true }).extend({ rows: upcoming.shape.rows.element
  .pick({ kind: true, assignment: true }).extend({ shift: upcomingRow.shape.shift.pick({ id: true, startsAt: true, endsAt: true,
    siteZone: true, state: true }) }).array().max(pageSize) });

function shiftJson(zone: string, place: string, start = "sh.starts_at", end = "sh.ends_at") {
  return `json_object('id', sh.id, 'visitId', v.id, 'job', json_object('id', j.id, 'reference', j.reference, 'title', ${title}),
    'startsAt', ${start}, 'endsAt', ${end}, 'siteZone', ${zone}, 'placeAlias', ${place}, 'task', ${title},
    'skill', sh.skill, 'briefingLanguage', sh.briefing_language, 'state', sh.state)`;
}

function assignmentJson(alias: string, details = "") {
  return `json_object('id', ${alias}.id, 'source', ${alias}.source, 'state', ${alias}.state, 'confirmedAt', ${alias}.confirmed_at${details})`;
}

const activeHold = (assignment: string) => `FROM safety_holds h WHERE h.assignment_id = ${assignment} AND h.state = 'active'`;
function holdsJson(where: string, roster = false) {
  return array(`SELECT json_object('id', h.id, 'kind', h.kind, 'instruction', json(CASE WHEN ver.id IS NOT NULL
      THEN json_object('id', ver.instruction_id, 'version', ver.no) END)${roster ? ", 'assignmentId', h.assignment_id" : ""}) AS value
    FROM safety_holds h LEFT JOIN safety_versions ver ON ver.id = h.version_id WHERE h.state = 'active' AND (${where}) ORDER BY h.id`);
}

// The current round determines which single worker is awaiting confirmation.
// Being the recipient of a provisional cover reply never grants shift access.
const coverReplyBy = "min(co.expires_at, cd.reply_until, cg.safe_cutoff, sh.starts_at)";
const coverState = (clock: string) => `CASE
  WHEN co.state IN ('declined', 'withdrawn') THEN co.state
  WHEN cg.state = 'filled' THEN CASE WHEN cr.winner_offer_id IS co.id THEN NULL ELSE 'filled' END
  WHEN cg.state = 'closed' OR NOT (${liveShift}) THEN 'withdrawn'
  WHEN cr.winner_offer_id = co.id AND cr.state = 'accepted_pending_confirmation'
    THEN CASE WHEN cr.confirm_by > ${clock} THEN 'awaiting_confirmation' ELSE 'released' END
  WHEN won.state = 'closed' THEN 'released'
  WHEN ${coverReplyBy} <= ${clock} THEN 'expired'
  WHEN cd.state = 'closed' THEN 'withdrawn'
  WHEN cr.state = 'open' AND cg.state = 'open' AND cd.dispatch_no = cr.dispatch_no THEN 'offered'
END`;

function pendingOffer() {
  return `json(coalesce(
    (SELECT json_object('recipientName', ${displayName("a")}, 'replyBy', cr.confirm_by, 'state', 'awaiting_confirmation')
     FROM cover_rounds cr
     JOIN cover_offers co ON co.id = cr.winner_offer_id JOIN memberships m ON m.id = co.recipient_id JOIN accounts a ON a.id = m.account_id
     WHERE cr.gap_id = cg.id AND cr.round_no = cg.current_round_no
       AND cg.state = 'accepted_pending_confirmation' AND cr.state = 'accepted_pending_confirmation'
       AND m.business_id = j.business_id AND cr.confirm_by > ${at} LIMIT 1),
    (SELECT json_object('recipientName', ${displayName("a")}, 'replyBy', o.expires_at, 'state', 'offered')
     FROM assignment_offers o JOIN memberships m ON m.id = o.recipient_id JOIN accounts a ON a.id = m.account_id
     WHERE o.slot_id = slot.id AND m.business_id = j.business_id AND o.state = 'offered' AND o.expires_at > ${at})))`;
}

export function readShift(session: SessionAccess, now: number, shift: string): CommandStatement {
  const access = scheduleAccess(session, now, { kind: "shift", id: shift });
  const assignments = array(`SELECT ${assignmentJson("a", `, 'member', json_object('id', m.id, 'displayName', ${displayName("worker")}),
    'confirmedByName', ${displayName("actor")}, 'droppedAt', a.dropped_at, 'dropoutReason', a.dropout_reason`)} AS value
    FROM assignments a JOIN memberships m ON m.id = a.worker_membership_id AND m.business_id = j.business_id
    JOIN accounts worker ON worker.id = m.account_id JOIN accounts actor ON actor.id = a.confirmed_by
    WHERE a.slot_id = slot.id AND a.confirmed_at <= ${at} ORDER BY a.confirmed_at, a.id`);
  const slots = array(`SELECT json_object('id', slot.id, 'number', slot.number, 'isLead',
    json(CASE WHEN slot.is_lead = 1 THEN 'true' ELSE 'false' END), 'assignments', json(${assignments}),
    'coverGapId', cg.id, 'pendingOffer', ${pendingOffer()}) AS value FROM shift_slots slot
    LEFT JOIN cover_gaps cg ON cg.slot_id = slot.id AND cg.state IN ('open', 'accepted_pending_confirmation')
    WHERE slot.shift_id = sh.id ORDER BY slot.number`);
  const rosterHolds = holdsJson(`EXISTS (SELECT 1 FROM assignments a JOIN shift_slots slot ON slot.id = a.slot_id
    JOIN memberships m ON m.id = a.worker_membership_id AND m.business_id = j.business_id
    WHERE slot.shift_id = sh.id AND a.id = h.assignment_id AND a.state = 'confirmed')`, true);
  const missingSlot = `EXISTS (SELECT 1 FROM shift_slots slot WHERE slot.shift_id = sh.id AND NOT EXISTS (
    SELECT 1 FROM assignments a WHERE a.slot_id = slot.id AND a.state = 'confirmed'))`;
  const worker = `SELECT json_object('view', 'worker', 'shift', ${shiftJson("j.site_zone",
    `CASE WHEN a.state = 'confirmed' AND sh.state IN ('planned', 'active') AND ${jobOpen()} THEN j.alias END`, "a.starts_at", "a.ends_at")},
    'assignment', ${assignmentJson("a")}, 'holds', json(${holdsJson("a.state = 'confirmed' AND h.assignment_id = a.id")}), 'crewThreadId', NULL)
    FROM assignments a JOIN shift_slots slot ON slot.id = a.slot_id AND slot.shift_id = sh.id
    WHERE a.worker_membership_id = ${currentMembership("scope", at)} AND a.confirmed_at <= ${at}
    ORDER BY a.state = 'confirmed' DESC, a.confirmed_at DESC, a.id LIMIT 1`;
  return scopedStatement(access, `SELECT (SELECT CASE WHEN ${foreman("scope")} THEN json_object('view', 'foreman',
    'shift', ${shiftJson("j.site_zone", "j.alias")}, 'slots', json(${slots}), 'holds', json(${rosterHolds}),
    'customerUpdate', json(coalesce((SELECT json_object('state', 'published', 'kind', cu.kind, 'publishedAt', cu.recorded_at)
      FROM customer_updates cu WHERE cu.visit_id = v.id AND cu.recorded_at <= ${at} ORDER BY cu.recorded_at DESC, cu.id DESC LIMIT 1),
      json_object('state', 'not_shared'))), 'crewThreadId', NULL,
    'nextAction', CASE WHEN ${jobOpen()} AND sh.state IN ('planned', 'active') AND v.state = 'booked' THEN CASE
      WHEN NOT (${missingSlot}) THEN 'share_update' WHEN sh.starts_at > ${at} THEN CASE WHEN EXISTS (
        SELECT 1 FROM cover_gaps cg JOIN shift_slots slot ON slot.id = cg.slot_id WHERE slot.shift_id = sh.id
          AND cg.state IN ('open', 'accepted_pending_confirmation') AND cg.safe_cutoff > ${at}) THEN 'find_cover' ELSE 'assign_crew' END END END)
    WHEN ${workerContext("scope")} AND scope.business_id = j.business_id THEN (${worker}) END
    FROM live_scope scope CROSS JOIN schedule_job j JOIN visits v ON v.job_id = j.id
    JOIN shifts sh ON sh.visit_id = v.id AND sh.id = ${targetId}) AS value FROM acting_session`);
}

function nextAction(clock: string) {
  return `CASE WHEN EXISTS (SELECT 1 FROM attendance_events e WHERE e.assignment_id = a.id AND e.kind = 'departure'
    AND e.review_state = 'accepted') THEN 'view_shift'
    WHEN EXISTS (SELECT 1 FROM attendance_events e WHERE e.assignment_id = a.id AND e.kind = 'arrival' AND e.review_state = 'accepted') THEN 'check_out'
    WHEN EXISTS (SELECT 1 FROM visit_activity_events e WHERE e.visit_id = v.id AND e.assignment_id = a.id AND e.kind = 'setting_off') THEN 'check_in'
    WHEN EXISTS (SELECT 1 ${activeHold("a.id")}) THEN 'check_briefing'
    WHEN a.starts_at <= ${clock} THEN 'check_in' ELSE 'view_shift' END`;
}

export function cachedAgendaJson(member: string, business: string, clock: string) {
  return `json_object('segment', 'upcoming', 'rows', json(${array(`SELECT json_object('kind', 'shift', 'shift',
    json_object('id', sh.id, 'startsAt', a.starts_at, 'endsAt', a.ends_at, 'siteZone', ${zone}, 'state', sh.state),
    'assignment', ${assignmentJson("a")}) AS value ${assignmentFrom}
    WHERE a.worker_membership_id = ${member} AND j.business_id = ${business} AND a.confirmed_at <= ${clock}
      AND ${activeWork(clock)} ORDER BY a.starts_at, a.id LIMIT ${pageSize}`)}))`;
}

const offerSummary = `sh.starts_at, sh.ends_at, ${zone} AS site_zone, area.name AS area_name, ${title} AS task,
  sh.skill, sh.briefing_language`;

function coverOfferRows(clock: string, member: string, business: string) {
  return `SELECT co.id, 'cover' AS source, co.gap_id, ${offerSummary}, ${coverReplyBy} AS offer_reply_by,
    CASE WHEN cr.winner_offer_id = co.id AND cr.state = 'accepted_pending_confirmation'
      THEN cr.confirm_by ELSE ${coverReplyBy} END AS reply_by,
    ${coverState(clock)} AS state, coalesce(co.responded_at, won.ended_at, cg.closed_at, cr.ended_at, cd.closed_at, v.cancelled_at, cr.confirm_by, co.expires_at) AS ended_at
    FROM cover_offers co JOIN cover_dispatches cd ON cd.gap_id = co.gap_id AND cd.dispatch_no = co.dispatch_no
    JOIN cover_gaps cg ON cg.id = co.gap_id LEFT JOIN cover_rounds cr ON cr.gap_id = cg.id AND cr.round_no = cg.current_round_no
    LEFT JOIN cover_rounds won ON won.gap_id = co.gap_id AND won.dispatch_no = co.dispatch_no AND won.winner_offer_id = co.id
    JOIN shift_slots slot ON slot.id = cg.slot_id ${taskJoin}
    WHERE co.recipient_id = ${member} AND j.business_id = ${business} AND cd.issued_at <= ${clock}`;
}

export function workerHomeOffers(member: string, business: string) {
  return array(`SELECT json_object('kind', source, 'offerId', id, 'gapId', gap_id,
    'town', area_name, 'task', task, 'skill', skill, 'briefingLanguage', briefing_language, 'siteZone', site_zone,
    'window', json_object('startsAt', starts_at, 'endsAt', ends_at), 'replyBy', offer_reply_by,
    'awaitingConfirmationUntil', CASE WHEN state = 'awaiting_confirmation' THEN reply_by END) AS value
    FROM (${workerOfferRows(at, member, business)}) WHERE state IN ('offered', 'awaiting_confirmation')
    ORDER BY reply_by, id LIMIT ${pageSize}`);
}

function workerOfferRows(clock: string, member: string, business: string) {
  return `SELECT o.id, 'ordinary' AS source, NULL AS gap_id, ${offerSummary}, o.expires_at AS offer_reply_by, o.expires_at AS reply_by,
    CASE WHEN o.state = 'offered' THEN CASE WHEN o.expires_at <= ${clock} THEN 'expired'
      WHEN NOT (${liveShift}) OR sh.starts_at <= ${clock} THEN 'withdrawn' ELSE 'offered' END
      WHEN o.state <> 'confirmed' THEN o.state END AS state,
    coalesce(o.resolved_at, v.cancelled_at, o.expires_at) AS ended_at
    FROM assignment_offers o JOIN shift_slots slot ON slot.id = o.slot_id ${taskJoin}
    WHERE o.recipient_id = ${member} AND j.business_id = ${business} AND o.issued_at <= ${clock}
    UNION ALL ${coverOfferRows(clock, member, business)}`;
}

export interface AgendaPosition { key: number | null; id: string }
export function agendaPosition(cursor: string | undefined, segment: ShiftAgenda["segment"]): AgendaPosition | null {
  if (!cursor) return { key: null, id: "" };
  const parts = /^(upcoming|offers|past)~(-?\d+)~([A-Za-z0-9_-]+)$/.exec(cursor);
  if (!parts || parts[1] !== segment || !idSchema.safeParse(parts[3]).success || !Number.isSafeInteger(Number(parts[2]))) return null;
  return { key: Number(parts[2]), id: parts[3]! };
}

export function readShiftAgenda(session: SessionAccess, now: number, segment: ShiftAgenda["segment"], cursor: AgendaPosition): CommandStatement {
  const access = accessClock(session, now);
  const ascending = segment !== "past";
  const order = ascending ? "ASC" : "DESC";
  const compare = ascending ? ">" : "<";
  const offers = segment === "upcoming" ? "" : `, offers AS (${workerOfferRows(at, "(SELECT member_id FROM actor)", "(SELECT business_id FROM actor)")})`;
  const offerRows = `SELECT ${ascending ? "reply_by" : "ended_at"} AS key, id,
    json_object('kind', 'offer', 'id', id, 'source', source, 'gapId', gap_id, 'startsAt', starts_at, 'endsAt', ends_at,
    'siteZone', site_zone, 'areaName', area_name, 'task', task, 'replyBy', reply_by,
    'state', state${ascending ? "" : ", 'endedAt', ended_at"}) AS value FROM offers WHERE state IN (
    ${ascending ? "'offered', 'awaiting_confirmation'" : "'filled', 'expired', 'declined', 'withdrawn', 'released'"})`;
  const ended = `CASE WHEN sh.state = 'cancelled' OR v.state = 'cancelled'
    THEN coalesce(v.cancelled_at, (SELECT w.confirmed_at FROM visit_windows w WHERE w.visit_id = v.id AND w.state = 'confirmed'), a.ends_at)
    ELSE coalesce(a.dropped_at, a.ends_at) END`;
  const assignments = `SELECT ${ascending ? "a.starts_at" : ended} AS key, a.id,
    json_object('kind', 'shift', 'shift', ${shiftJson(zone, ascending ? "p.alias" : "NULL", "a.starts_at", "a.ends_at")},
    'assignment', ${assignmentJson("a")}${ascending ? `, 'nextAction', ${nextAction(at)}` : `,
    'endedAt', ${ended}, 'outcome', CASE WHEN sh.state = 'cancelled' OR v.state = 'cancelled' OR j.state = 'cancelled' THEN 'cancelled'
      WHEN a.state IN ('dropped', 'released') THEN a.state ELSE 'completed' END`}) AS value
    ${assignmentFrom} CROSS JOIN actor WHERE a.worker_membership_id = actor.member_id AND j.business_id = actor.business_id
    AND a.confirmed_at <= ${at} AND ${ascending ? activeWork(at) : `NOT ${activeWork(at)}`}`;
  const sources = segment === "upcoming" ? assignments : segment === "offers" ? offerRows : `${assignments} UNION ALL ${offerRows}`;
  return scopedStatement(access, `, actor AS MATERIALIZED (SELECT scope.business_id, ${currentMembership("scope", at)} AS member_id
    FROM live_scope scope WHERE ${workerContext("scope")})${offers}, agenda AS MATERIALIZED (${sources}),
    mark(key, id) AS (VALUES (?, ?)), page AS (
      SELECT agenda.* FROM agenda CROSS JOIN mark WHERE mark.key IS NULL OR (agenda.key, agenda.id) ${compare} (mark.key, mark.id)
      ORDER BY agenda.key ${order}, agenda.id ${order} LIMIT ${pageSize + 1})
    SELECT (SELECT json_object('segment', '${segment}', 'rows', json(${array(`SELECT json_object('key', key, 'id', id,
      'entry', json(value)) AS value FROM page ORDER BY key ${order}, id ${order}`)})
      ${segment === "upcoming" ? ", 'total', (SELECT count(*) FROM agenda)" : ""}) FROM actor) AS value FROM acting_session`, cursor.key, cursor.id);
}

export function projectShiftAgenda(value: unknown) {
  const { rows, ...content } = value as { segment: ShiftAgenda["segment"]; rows: { key: number; id: string; entry: unknown }[] };
  const hasMore = rows.length > pageSize, last = rows[pageSize - 1];
  return { ...content, rows: rows.slice(0, pageSize).map(({ entry }) => entry), hasMore,
    cursor: hasMore && last ? `${content.segment}~${last.key}~${last.id}` : null };
}
