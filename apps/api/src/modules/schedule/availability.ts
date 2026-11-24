import type { CrewAvailability } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";
import { accessClock, at, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { currentMembership } from "../jobs/projections";
import { calendarWeek, mergeSpans, singleDate } from "./calendar";
import type { CalendarDate } from "./calendar";
import { scheduler, workerContext } from "./policy";

interface Interval {
  day: string;
  startsAt: number | null;
  endsAt: number | null;
  startOffset: number | null;
  endOffset: number | null;
  kind: "available" | "unavailable" | "duty";
  source: "worker" | "employer";
  savedAt: number;
  cover: number;
  revision: number;
}

interface RawAvailability {
  membershipId: CrewAvailability["membershipId"];
  businessId: CrewAvailability["businessId"];
  siteZone: string;
  now: number;
  intervals: Interval[];
}

export function intervalsJson(member: string, filter: string) {
  return `(SELECT json_group_array(json(value)) FROM (
    SELECT json_object('day', a.week_day_or_date, 'startsAt', a.starts_at, 'endsAt', a.ends_at,
      'startOffset', a.starts_offset_ms, 'endOffset', a.ends_offset_ms, 'kind', a.kind, 'source', a.source,
      'savedAt', a.recorded_at, 'cover', a.open_to_cover, 'revision', a.revision) AS value
    FROM availability_intervals a WHERE a.membership_id = ${member} AND (${filter})
    ORDER BY a.week_day_or_date, coalesce(a.starts_at, a.starts_offset_ms), a.id))`;
}

// Include the full possible local Monday–Sunday week across IANA offsets, then
// clip to the exact business week in the projection. No second scoped lookup.
export function availabilityWeekFilter(now: string, weekOf: string) {
  return `(a.week_day_or_date BETWEEN date(coalesce(${weekOf}, date(${now} / 1000, 'unixepoch')), '-7 day')
    AND date(coalesce(${weekOf}, date(${now} / 1000, 'unixepoch')), '+7 day')
    OR a.week_day_or_date IN ('1', '2', '3', '4', '5', '6', '7'))`;
}

export function availabilityJson(m: string, zone: string, now: string, filter: string) {
  return `json_object('membershipId', ${m}.id, 'businessId', ${m}.business_id, 'siteZone', ${zone}, 'now', ${now},
    'intervals', json(${intervalsJson(`${m}.id`, `a.kind <> 'duty' AND (${filter})`)}))`;
}

type Day = CrewAvailability["days"][number];
function projectDay(intervals: Interval[], calendar: CalendarDate): Day {
  const { date, weekday, toUtc } = calendar;
  const dated = intervals.filter((row) => row.day === date);
  const rows = dated.length ? dated : intervals.filter((row) => row.day === weekday);
  const revision = dated.reduce((latest, row) => Math.max(latest, row.revision), 0);
  // 0006 stores preferences, not worker assignments. Slots alone must never
  // appear here as confirmed work or grant a worker access to a site.
  const base = { date, revision, confirmedShifts: [] };
  const unavailable = rows.reduce<Interval | undefined>((latest, row) => row.kind === "unavailable"
    && (!latest || row.savedAt > latest.savedAt) ? row : latest, undefined);
  if (unavailable) return { ...base, preference: { kind: "unavailable", savedAt: unavailable.savedAt, source: unavailable.source } };
  const hours = mergeSpans(rows.flatMap((row) => {
    if (row.kind !== "available") return [];
    return row.startsAt === null || row.endsAt === null
      ? toUtc(row.startOffset!, row.endOffset!) : [{ startsAt: row.startsAt, endsAt: row.endsAt }];
  }));
  const saved = rows.reduce<Interval | undefined>((latest, row) => !latest || row.savedAt > latest.savedAt ? row : latest, undefined);
  return { ...base, preference: hours.length && saved
    ? { kind: "available", hours, openToCover: rows.some(({ cover }) => cover === 1), savedAt: saved.savedAt, source: saved.source }
    : { kind: "not_set" } };
}

export function projectAvailability(value: unknown, weekOf: string | null = null): CrewAvailability {
  const { now, intervals, ...scope } = value as RawAvailability;
  return { ...scope, days: calendarWeek(scope.siteZone, now, weekOf).map((calendar) => projectDay(intervals, calendar)) };
}

export function projectChangedAvailability(value: unknown, date: string) {
  const { now: _now, intervals, ...scope } = value as RawAvailability;
  return { ...scope, day: projectDay(intervals, singleDate(date, scope.siteZone)) };
}

export function availabilityAccess(session: SessionAccess, now: number, member: string): SessionAccess {
  const access = accessClock(session, now);
  return { sql: `${access.sql}, availability_member AS MATERIALIZED (
    SELECT m.id, m.business_id, area.site_zone FROM memberships m
    JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
    JOIN businesses b ON b.id = m.business_id AND b.state = 'approved'
    JOIN operating_areas area ON area.id = b.catchment_id
    WHERE m.id = ? AND m.state = 'active' AND EXISTS (SELECT 1 FROM membership_roles mr
      WHERE mr.membership_id = m.id AND mr.role = 'worker' AND mr.revoked_at IS NULL AND mr.granted_at <= ${at})
  )`, params: [...access.params, member] };
}

export const mayEditAvailability = (scope: string, m: string) => `(${scope}.business_id = ${m}.business_id AND (
  (${workerContext(scope)} AND ${currentMembership(scope, at)} = ${m}.id) OR ${scheduler(scope)}))`;

export function readAvailability(session: SessionAccess, now: number, member: string, weekOf: string | null): CommandStatement {
  const access = availabilityAccess(session, now, member);
  return scopedStatement(access, `, week_input(day) AS (VALUES (?))
    SELECT (SELECT ${availabilityJson("m", "m.site_zone", at, availabilityWeekFilter(at, "(SELECT day FROM week_input)"))}
      FROM live_scope scope JOIN availability_member m ON ${mayEditAvailability("scope", "m")}) AS value
    FROM acting_session`, weekOf);
}

export function datePreferences(date: string): string {
  return `a.kind <> 'duty' AND a.week_day_or_date = ${date}`;
}

export const dateBasisFilter = (date: string) => `(a.week_day_or_date = ${date} OR a.week_day_or_date =
  CAST((CAST(strftime('%w', ${date}) AS INTEGER) + 6) % 7 + 1 AS TEXT))`;

export function datedRevision(member: string, date: string) {
  return `coalesce((SELECT max(a.revision) FROM availability_intervals a WHERE a.membership_id = ${member} AND ${datePreferences(date)}), 0)`;
}

