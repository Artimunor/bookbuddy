import { at, liveTerm } from "../access/policy";
import type { SessionAccess } from "../auth/session";

const minute = 60_000, day = 24 * 60 * minute, week = 7 * day;
const offerMinutes = { standard: 120, urgent: 30 } as const;
const clockWeeks = 6;
let cachedClock: { from: number; until: number; offsets: string } | undefined;

function offsetAt(formatter: Intl.DateTimeFormat, ms: number): number {
  const zone = formatter.formatToParts(ms).find(({ type }) => type === "timeZoneName")?.value;
  if (zone === "GMT") return 0;
  const match = /^GMT([+-])(\d\d):(\d\d)(?::(\d\d))?$/.exec(zone ?? "");
  if (!match) throw new RangeError("Staffed calendar could not resolve the site offset");
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 * minute + Number(match[3]) * minute + Number(match[4] ?? 0) * 1_000);
}

// D1 has no IANA conversion function. Supply immutable UTC offset segments for
// the next five full weeks, but pick the authoritative site zone and calendar in
// SQL. Neither the client nor the Worker host's local zone chooses a deadline.
export function staffedOffsets(now: number): string {
  if (cachedClock && now >= cachedClock.from && now < cachedClock.until) return cachedClock.offsets;
  const from = Math.floor(now / week) * week;
  const end = from + clockWeeks * week;
  const zones: Record<string, [number, number, number][]> = {
    UTC: [[from, end, 0]], "Etc/UTC": [[from, end, 0]], "Etc/GMT": [[from, end, 0]], GMT: [[from, end, 0]],
  };
  for (const zone of Intl.supportedValuesOf("timeZone")) {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" });
    let offset = offsetAt(formatter, from), start = from;
    const intervals: [number, number, number][] = [];
    for (let sample = from + week; sample <= end; sample += week) {
      const next = offsetAt(formatter, sample);
      if (next === offset) continue;
      let lo = (sample - week) / 1_000, hi = sample / 1_000;
      while (hi - lo > 1) {
        const mid = Math.floor((hi + lo) / 2);
        if (offsetAt(formatter, mid * 1_000) === offset) lo = mid;
        else hi = mid;
      }
      const transition = hi * 1_000;
      intervals.push([start, transition, offset]);
      start = transition;
      offset = next;
    }
    intervals.push([start, end, offset]);
    zones[zone] = intervals;
  }
  const offsets = JSON.stringify(zones);
  cachedClock = { from, until: from + week, offsets };
  return offsets;
}

// Also supplied by the batch that embeds a provider job in an opaque link.
export function withHandoffClock(access: SessionAccess, now: number): SessionAccess {
  return { sql: `${access.sql}, handoff_offsets(value) AS (VALUES (?))`, params: [...access.params, staffedOffsets(now)] };
}

// The caller supplies one authorized calendar_area row (id and site_zone).
export function handoffDeadlineSql(policy: keyof typeof offerMinutes, offsets: string): string {
  const duration = offerMinutes[policy] * minute;
  return `staffed_days(wall_ms) AS (
      SELECT (${at} / ${day} - 1) * ${day}
      UNION ALL SELECT wall_ms + ${day} FROM staffed_days WHERE wall_ms < (${at} / ${day} + ${clockWeeks * 7 + 1}) * ${day}
    ), staffed_windows AS (
      SELECT max(${at}, zone.value ->> '$[0]', d.wall_ms + ${minute} *
          CASE WHEN holiday.id IS NULL THEN weekday.opens_minute ELSE holiday.opens_minute END - (zone.value ->> '$[2]')) AS starts,
        min(zone.value ->> '$[1]', d.wall_ms + ${minute} *
          CASE WHEN holiday.id IS NULL THEN weekday.closes_minute ELSE holiday.closes_minute END - (zone.value ->> '$[2]')) AS ends
      FROM calendar_area area CROSS JOIN json_each(${offsets} -> ('$.' || json_quote(area.site_zone))) zone CROSS JOIN staffed_days d
      LEFT JOIN staffed_calendar holiday ON holiday.area_id = area.id AND holiday.local_date = date(d.wall_ms / 1000, 'unixepoch')
      LEFT JOIN staffed_calendar weekday ON weekday.area_id = area.id AND weekday.weekday =
        (CAST(strftime('%w', d.wall_ms / 1000, 'unixepoch') AS INTEGER) + 6) % 7 + 1
    ), staffed_elapsed AS (
      SELECT starts, ends, sum(ends - starts) OVER (ORDER BY starts ROWS UNBOUNDED PRECEDING) AS elapsed
      FROM staffed_windows WHERE starts < ends
    ), deadline AS MATERIALIZED (
      SELECT ends - (elapsed - ${duration}) AS expires_at FROM staffed_elapsed WHERE elapsed >= ${duration} ORDER BY starts LIMIT 1
    )`;
}

export function foremanScope(condition: string, select = "c.id AS context_id, m.id AS membership_id, m.business_id, m.account_id"): string {
  return `SELECT ${select} FROM account_contexts c
    JOIN membership_roles r ON r.id = c.role_grant_id AND r.role = 'foreman' AND r.revoked_at IS NULL AND r.granted_at <= ${at}
    JOIN memberships m ON m.id = r.membership_id AND m.state = 'active'
    JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
    WHERE c.role = 'foreman' AND (${condition})`;
}

export function liveProviderHandoff(scope: string, business: string): string {
  return `${scope}.role = 'provider_admin' AND ${scope}.business_id = ${business} AND EXISTS (
    SELECT 1 FROM account_contexts c JOIN membership_roles r ON r.id = c.role_grant_id AND r.granted_at <= ${at}
    JOIN business_grants g ON g.membership_id = r.membership_id AND g.business_id = ${business} AND g.capability = 'handoff'
    WHERE c.id = ${scope}.context_id AND ${liveTerm("g")})`;
}

export const latestHandoff = (jobId: string, columns: "h.*" | "h.id") => `SELECT ${columns} FROM job_handoffs h
  WHERE h.job_id = ${jobId} ORDER BY h.offered_at DESC, h.rowid DESC LIMIT 1`;

export const initialHandoffAllowed = (h: string) => `(${h}.id IS NULL OR ${h}.state = 'accepted'
  OR (${h}.state = 'withdrawn' AND ${h}.reoffer_of_id IS NULL))`;

export const reofferAllowed = (job: string, h: string) => `(${h}.reoffer_of_id IS NULL AND ${h}.incumbent_id IS ${job}.accountable_foreman_membership_id
  AND (${h}.state IN ('declined', 'expired') OR (${h}.state = 'offered' AND ${h}.expires_at <= ${at})))`;

// Both the current-grant index and the historical primary key can block an insert.
export const handoffRecipientAllowed = (job: string, memberId: string, contextId: string) => `
  ${job}.state = 'open' AND ${job}.accountable_foreman_membership_id IS NOT ${memberId}
  AND NOT EXISTS (SELECT 1 FROM job_grants g WHERE g.job_id = ${job}.id AND g.context_id = ${contextId}
    AND g.capability = 'intake' AND (g.revoked_at IS NULL OR g.valid_from = ${at}))`;
