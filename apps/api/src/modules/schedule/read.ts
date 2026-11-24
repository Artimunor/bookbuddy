import type { BusinessSchedule, CrewAvailability } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";
import { at, displayName, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { confirmedAssignments, weekBounds } from "./availability";
import { calendarDay, calendarWeek, intersect, localDate, mergeSpans } from "./calendar";
import type { Span } from "./calendar";
import {
  approvedQuoteJoin, capacity, confirmationMode, confirmedWindow, currentNoCrewStamp, customer, eligibleWorkers, foreman,
  jobOpen, namedApprover, noWithdrawal, optedInCustomerZone, provider, scheduleAccess, unstarted, visitManager,
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
  const needsCrew = `EXISTS (SELECT 1 FROM shifts sh JOIN shift_slots slot ON slot.shift_id = sh.id
    WHERE sh.visit_id = ${v}.id AND sh.state = 'planned' AND NOT EXISTS (
      SELECT 1 FROM assignments a JOIN memberships m ON m.id = a.worker_membership_id
      JOIN accounts worker ON worker.id = m.account_id AND worker.state = 'active'
      WHERE a.slot_id = slot.id AND a.state = 'confirmed' AND a.confirmed_at <= ${at}
        AND m.state = 'active' AND m.business_id = ${j}.business_id
        AND EXISTS (SELECT 1 FROM membership_roles mr WHERE mr.membership_id = m.id AND mr.role = 'worker'
          AND mr.revoked_at IS NULL AND mr.granted_at <= ${at})))`;
  return `json_object('id', ${v}.id, 'kind', ${v}.kind, 'state', ${v}.state, 'revision', ${v}.revision,
    'bookedWindow', json(CASE WHEN ${booked}.id IS NOT NULL THEN json_object('id', ${booked}.id,
      'startsAt', ${booked}.starts_at, 'endsAt', ${booked}.ends_at, 'confirmedAt', ${booked}.confirmed_at,
      'crewAvailability', CASE WHEN ${v}.state = 'booked' AND CASE WHEN ${scope}.role = 'customer'
        THEN ${currentNoCrewStamp(`${v}.id`, booked)} IS NOT NULL
        ELSE ${booked}.starts_at > ${at} AND ${needsCrew}
          AND NOT ${capacity(j, `${v}.id`, `${booked}.starts_at`, `${booked}.ends_at`)} END
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
    'customerZone', CASE WHEN scope.account_id = j.requester_id THEN ${optedInCustomerZone} END,
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
  const bounds = weekBounds(now, "(SELECT day FROM week_input)");
  return jsonArray(`SELECT json_object('membershipId', crew.id, 'displayName', ${displayName("a")},
      'eligibleUntil', crew.eligible_until, 'intervals', json(${jsonArray(`SELECT json_object('startsAt', p.starts_at,
        'endsAt', p.ends_at, 'kind', p.kind) AS value FROM availability_intervals p
        WHERE p.membership_id = crew.id AND p.recorded_at <= ${now} AND p.starts_at IS NOT NULL
          AND p.starts_at < ${bounds.end} AND p.ends_at > ${bounds.start}
        ORDER BY p.starts_at, p.id`)}), 'busy', json(${jsonArray(`SELECT json_object('startsAt', work.starts_at,
        'endsAt', work.ends_at) AS value ${confirmedAssignments("crew.id", "j.business_id", now)}
        AND work.starts_at < ${bounds.end} AND work.ends_at > ${bounds.start} ORDER BY work.starts_at, work.id`)})) AS value
    FROM (SELECT id, account_id, max(eligible_until) AS eligible_until FROM (${eligibleWorkers("j", at)}) GROUP BY id, account_id) crew
    JOIN accounts a ON a.id = crew.account_id ORDER BY a.display_name, crew.id`);
}

export function readBusinessSchedule(session: SessionAccess, now: number, business: string, job: string, visit: string | null,
  weekOf: string | null): CommandStatement {
  const access = scheduleAccess(session, now, { kind: "job", id: job });
  return scopedStatement(access, `, week_input(day) AS (VALUES (?)), visit_input(id) AS (VALUES (?))
    SELECT (SELECT json_object('businessId', j.business_id, 'job', ${jobJson("j")}, 'siteZone', j.site_zone,
      'customerZone', CASE WHEN scope.role = 'foreman' THEN ${optedInCustomerZone} END,
      'approvedQuote', json(${quoteJson("q")}), 'visit', json(CASE WHEN v.id IS NOT NULL THEN ${visitJson("j", "v", "booked", "scope")} END),
      'bookedByName', (SELECT ${displayName("a")} FROM accounts a WHERE a.id = booked.confirmed_by),
      'lanes', json(CASE WHEN ${jobOpen()} THEN ${lanesJson(at)} END))
    FROM live_scope scope JOIN schedule_job j ON j.business_id = ? AND (${foreman("scope")} OR ${provider("scope")})
    ${approvedQuoteJoin()} LEFT JOIN visits v ON v.id = (SELECT v2.id FROM visits v2 WHERE v2.job_id = j.id
      AND (v2.id = vi.id OR (vi.id IS NULL AND v2.state IN ('booked', 'planned')))
      ORDER BY v2.state = 'booked' DESC, v2.id LIMIT 1)
    ${confirmedWindow("v")} WHERE vi.id IS NULL OR v.id IS NOT NULL) AS value FROM acting_session CROSS JOIN visit_input vi`, weekOf, visit, business);
}

type Lane = { membershipId: CrewAvailability["membershipId"]; displayName: string; eligibleUntil: number;
  intervals: (Span & { kind: "available" | "unavailable" | "duty" })[]; busy: Span[] };

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
    state: "ready", days: calendarWeek(result.siteZone, now, weekOf).map(({ date, toUtc }) => {
      const bounds = toUtc(0, calendarDay);
      return { date, lanes: lanes.map((lane) => ({
        membershipId: lane.membershipId, displayName: lane.displayName,
        available: mergeSpans(bounds.flatMap((period) => availableSpans(lane, period))),
        busy: mergeSpans(lane.busy.flatMap((span) => bounds.flatMap((period) => intersect(span, period) ?? []))),
      })) };
    }),
  };
  return { ...result, capacity };
}
