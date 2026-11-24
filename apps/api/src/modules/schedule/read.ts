import type { BusinessSchedule, CrewAvailability, ShiftAgenda } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";
import { accessClock, at, displayName, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { calendarDay, calendarWeek, intersect, localDate, mergeSpans } from "./calendar";
import type { Span } from "./calendar";
import {
  approvedQuoteJoin, capacity, confirmationMode, confirmedWindow, customer, eligibleWorkers, foreman, jobOpen, namedApprover,
  noWithdrawal, provider, scheduleAccess, targetId, unstarted, visitManager, workerContext,
} from "./policy";

const bool = (predicate: string) => `json(CASE WHEN ${predicate} THEN 'true' ELSE 'false' END)`;
const jsonArray = (select: string) => `(SELECT json_group_array(json(value)) FROM (${select}))`;
const jobJson = (j: string) => `json_object('id', ${j}.id, 'reference', ${j}.reference,
  'title', coalesce(nullif(${j}.trade, ''), ${j}.reference))`;
const quoteJson = (q: string) => `CASE WHEN ${q}.id IS NOT NULL THEN json_object('id', ${q}.id, 'number', ${q}.no,
  'totalMinor', ${q}.total_minor, 'currency', ${q}.currency) END`;

export function visitJson(j: string, v: string, booked: string, scope: string) {
  const mayManage = `(${visitManager(scope)} AND ${unstarted(v, booked)})`;
  const activeRequest = `EXISTS (SELECT 1 FROM reschedule_requests pending WHERE pending.visit_id = ${v}.id
    AND pending.state IN ('requested', 'proposed') AND pending.reply_by > ${at})`;
  return `json_object('id', ${v}.id, 'kind', ${v}.kind, 'state', ${v}.state, 'revision', ${v}.revision,
    'bookedWindow', json(CASE WHEN ${booked}.id IS NOT NULL THEN json_object('id', ${booked}.id,
      'startsAt', ${booked}.starts_at, 'endsAt', ${booked}.ends_at, 'confirmedAt', ${booked}.confirmed_at,
      'crewAvailability', CASE WHEN ${v}.state = 'booked' AND ${booked}.starts_at > ${at}
        AND NOT ${capacity(j, `${v}.id`, `${booked}.starts_at`, `${booked}.ends_at`)}
        THEN 'no_crew_available' ELSE 'as_agreed' END) END),
    'offeredWindows', json(${jsonArray(`SELECT json_object('id', w.id, 'startsAt', w.starts_at, 'endsAt', w.ends_at,
      'expiresAt', w.expires_at, 'proposedAt', w.proposed_at, 'replacesWindowId', w.replaces_window_id,
      'confirmationMode', CASE WHEN NOT (${scope}.role = 'customer') OR ${customer(scope, j, true)}
        THEN ${confirmationMode(j, v, "w", booked)} END) AS value
      FROM visit_windows w WHERE w.visit_id = ${v}.id AND w.state = 'proposed' AND w.provider_authorized = 1
        AND w.proposed_at <= ${at} AND w.expires_at > ${at}
      ORDER BY w.starts_at, w.id`)}),
    'rescheduleRequest', json((SELECT json_object('id', r.id, 'state', r.state, 'requestedAt', r.requested_at, 'replyBy', r.reply_by)
      FROM reschedule_requests r WHERE r.visit_id = ${v}.id ORDER BY r.state IN ('requested', 'proposed') DESC, r.requested_at DESC, r.id DESC LIMIT 1)),
    'cancellation', json(CASE WHEN ${v}.state = 'cancelled' THEN json_object('at', ${v}.cancelled_at,
      'byViewer', ${bool(`${v}.cancelled_by = ${scope}.account_id`)}) END),
    'actions', json_object('canCancelFeeFree', ${bool(`${mayManage} AND ${booked}.id IS NOT NULL`)},
      'canRequestReschedule', ${bool(`${mayManage} AND ${jobOpen(j)} AND NOT (${activeRequest})`)}))`;
}

export function changedVisitJson(visitId: string) {
  return `SELECT json_object('jobId', j.id, 'siteZone', j.site_zone, 'visit',
      json(${visitJson("j", "v", "booked", "scope")}))
    FROM schedule_job j JOIN visits v ON v.job_id = j.id AND v.id = ${visitId} ${confirmedWindow("v")}`;
}

export function readJobWindows(session: SessionAccess, now: number, job: string): CommandStatement {
  const access = scheduleAccess(session, now, { kind: "job", id: job });
  return scopedStatement(access, `SELECT (SELECT json_object('job', ${jobJson("j")}, 'siteZone', j.site_zone,
    'foremanName', (SELECT ${displayName("a")} FROM memberships m JOIN accounts a ON a.id = m.account_id
      WHERE m.id = j.accountable_foreman_membership_id), 'approvedQuote', json(${quoteJson("q")}),
    'withdrawalAcceptedAt', (SELECT a.at FROM approvals a JOIN terms_versions t ON t.id = q.terms_id
      JOIN feature_flags f ON f.key = 'commercial_consumer_distance_14_day' AND f.scope_key = t.id AND f.enabled = 1
      WHERE a.quote_version_id = q.id AND a.account_id = scope.account_id AND a.at <= ${at} AND a.terms_hash = t.hash
        AND a.decision = 'approve' AND ${namedApprover("scope")} AND ${noWithdrawal()}),
    'visits', json(${jsonArray(`SELECT ${visitJson("j", "v", "booked", "scope")} AS value
      FROM visits v ${confirmedWindow("v")} WHERE v.job_id = j.id ORDER BY coalesce(booked.starts_at, 0), v.id`)}))
    FROM live_scope scope JOIN schedule_job j ON ${customer("scope")} ${approvedQuoteJoin()}) AS value FROM acting_session`);
}

export function projectJobWindows(value: unknown, now: number) {
  const { withdrawalAcceptedAt, ...result } = value as {
    siteZone: string; approvedQuote: { id: string } | null; withdrawalAcceptedAt: number | null;
  };
  const accepted = withdrawalAcceptedAt === null ? Infinity : Date.parse(localDate(withdrawalAcceptedAt, result.siteZone));
  const days = (Date.parse(localDate(now, result.siteZone)) - accepted) / calendarDay;
  return { ...result, withdrawalQuoteVersionId: days >= 0 && days <= 14 ? result.approvedQuote?.id ?? null : null };
}

function lanesJson(now: string) {
  return jsonArray(`SELECT json_object('membershipId', crew.id, 'displayName', ${displayName("a")},
      'eligibleUntil', crew.eligible_until, 'intervals', json(${jsonArray(`SELECT json_object('startsAt', p.starts_at,
        'endsAt', p.ends_at, 'kind', p.kind) AS value FROM availability_intervals p CROSS JOIN week_input
        WHERE p.membership_id = crew.id AND p.starts_at IS NOT NULL
          AND p.starts_at < 1000 * unixepoch(coalesce(week_input.day, date(${now} / 1000, 'unixepoch')), '+8 day')
          AND p.ends_at > 1000 * unixepoch(coalesce(week_input.day, date(${now} / 1000, 'unixepoch')), '-8 day')
        ORDER BY p.starts_at, p.id`)})) AS value
    FROM (SELECT id, account_id, max(eligible_until) AS eligible_until FROM (${eligibleWorkers("j", at)}) GROUP BY id, account_id) crew
    JOIN accounts a ON a.id = crew.account_id ORDER BY a.display_name, crew.id`);
}

export function readBusinessSchedule(session: SessionAccess, now: number, business: string, job: string, visit: string | null,
  weekOf: string | null): CommandStatement {
  const access = scheduleAccess(session, now, { kind: "job", id: job });
  return scopedStatement(access, `, week_input(day) AS (VALUES (?)), visit_input(id) AS (VALUES (?))
    SELECT (SELECT json_object('businessId', j.business_id, 'job', ${jobJson("j")}, 'siteZone', j.site_zone,
      'approvedQuote', json(${quoteJson("q")}), 'visit', json(CASE WHEN v.id IS NOT NULL THEN ${visitJson("j", "v", "booked", "scope")} END),
      'bookedByName', (SELECT ${displayName("a")} FROM accounts a WHERE a.id = booked.confirmed_by),
      'lanes', json(CASE WHEN ${jobOpen()} THEN ${lanesJson(at)} END))
    FROM live_scope scope JOIN schedule_job j ON j.business_id = ? AND (${foreman("scope")} OR ${provider("scope")})
    ${approvedQuoteJoin()} LEFT JOIN visits v ON v.id = (SELECT v2.id FROM visits v2 WHERE v2.job_id = j.id
      AND (vi.id IS NULL OR vi.id = v2.id) ORDER BY CASE v2.state WHEN 'booked' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, v2.id LIMIT 1)
    ${confirmedWindow("v")} WHERE vi.id IS NULL OR v.id IS NOT NULL) AS value FROM acting_session CROSS JOIN visit_input vi`, weekOf, visit, business);
}

type Lane = { membershipId: CrewAvailability["membershipId"]; displayName: string; eligibleUntil: number;
  intervals: (Span & { kind: "available" | "unavailable" | "duty" })[] };

function availableSpans(lane: Lane, period: Span): Span[] {
  const bounds = { startsAt: period.startsAt, endsAt: Math.min(period.endsAt, lane.eligibleUntil) };
  let spans = mergeSpans(lane.intervals.flatMap((interval) =>
    interval.kind === "unavailable" ? [] : intersect(interval, bounds) ?? []));
  for (const interval of lane.intervals) {
    if (interval.kind !== "unavailable" || !spans.length) continue;
    spans = spans.flatMap((span) => intersect(span, interval) ? [
      ...(span.startsAt < interval.startsAt ? [{ startsAt: span.startsAt, endsAt: interval.startsAt }] : []),
      ...(span.endsAt > interval.endsAt ? [{ startsAt: interval.endsAt, endsAt: span.endsAt }] : []),
    ] : [span]);
  }
  return spans;
}

export function projectBusinessSchedule(value: unknown, now: number, weekOf: string | null) {
  const { lanes, ...result } = value as { siteZone: string; lanes: Lane[] | null };
  const capacity: BusinessSchedule["capacity"] = lanes === null ? { state: "unavailable" } : {
    state: "ready", days: calendarWeek(result.siteZone, now, weekOf).map(({ date, toUtc }) => ({
      date, lanes: lanes.map((lane) => ({
        membershipId: lane.membershipId, displayName: lane.displayName,
        available: mergeSpans(toUtc(0, calendarDay).flatMap((period) => availableSpans(lane, period))),
        // Until staffing has named assignments, unallocated slots count against
        // pooled capacity on issue/confirm but cannot be attributed to a lane.
        busy: [],
      })),
    })),
  };
  return { ...result, capacity };
}

export function readShift(session: SessionAccess, now: number, shift: string): CommandStatement {
  const access = scheduleAccess(session, now, { kind: "shift", id: shift });
  return scopedStatement(access, `SELECT (SELECT json_object('view', 'foreman', 'shift', json_object('id', sh.id,
    'visitId', v.id, 'job', ${jobJson("j")}, 'startsAt', sh.starts_at, 'endsAt', sh.ends_at,
    'siteZone', j.site_zone, 'placeAlias', j.alias, 'task', coalesce(nullif(j.trade, ''), j.reference),
    'skill', sh.skill, 'briefingLanguage', sh.briefing_language, 'state', sh.state),
    'slots', json(${jsonArray(`SELECT json_object('id', slot.id, 'number', slot.number, 'isLead', ${bool("slot.is_lead = 1")},
      'assignments', json('[]'), 'pendingOffer', NULL) AS value FROM shift_slots slot WHERE slot.shift_id = sh.id ORDER BY slot.number`)}),
    'holds', json('[]'), 'customerUpdate', json_object('state', 'not_shared'), 'crewThreadId', NULL,
    'nextAction', CASE WHEN ${jobOpen()} AND sh.state = 'planned' AND v.state = 'booked' AND sh.starts_at > ${at}
      AND EXISTS (SELECT 1 FROM shift_slots slot WHERE slot.shift_id = sh.id) THEN 'assign_crew' END)
    FROM live_scope scope JOIN schedule_job j ON ${foreman("scope")} JOIN visits v ON v.job_id = j.id
    JOIN shifts sh ON sh.visit_id = v.id AND sh.id = ${targetId}) AS value FROM acting_session`);
}

// Do not infer a worker's assignment from a booked visit or from availability.
// Once 0007 is present, both this view and sync must use exact assignment/offer joins.
export function readShiftAgenda(session: SessionAccess, now: number, segment: ShiftAgenda["segment"]): CommandStatement {
  const access = accessClock(session, now);
  const value = JSON.stringify({ segment, rows: [], hasMore: false, cursor: null, ...(segment === "upcoming" ? { total: 0 } : {}) });
  return scopedStatement(access, `SELECT (SELECT ? FROM live_scope scope WHERE ${workerContext("scope")}) AS value FROM acting_session`, value);
}
