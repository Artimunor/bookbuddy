import { quoteExpiresAt } from "@bookbuddy/domain";
import { at } from "../access/policy";
import type { SessionAccess } from "../auth/session";

const DAY_MS = 86_400_000;
const week = 7 * DAY_MS;
const zones = [...new Set([...Intl.supportedValuesOf("timeZone"), "UTC", "Etc/UTC", "Etc/GMT", "GMT"])];
const formatters = new Map<string, Intl.DateTimeFormat>();
type Segment = [startsAt: number, endsAt: number, offset: number];
let cached: { weekOf: number; segments: Map<string, Segment[]>; json: string } | undefined;

function offset(zone: string, instant: number): number {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" });
    formatters.set(zone, formatter);
  }
  const label = formatter.formatToParts(instant).find(({ type }) => type === "timeZoneName")?.value;
  if (label === "GMT") return 0;
  const parsed = /^GMT([+-])(\d\d):(\d\d)(?::(\d\d))?$/.exec(label ?? "");
  if (!parsed) throw new RangeError("Cannot resolve site offset");
  return (parsed[1] === "-" ? -1 : 1) * (Number(parsed[2]) * 3600 + Number(parsed[3]) * 60 + Number(parsed[4] ?? 0)) * 1000;
}

// The database chooses the site's live zone in the transaction. D1 has no IANA
// conversion function, so supply only bounded clock data, not a client-selected zone.
function clocks(now: number) {
  const weekOf = Math.floor(now / week) * week;
  if (cached?.weekOf === weekOf) return cached;
  const from = weekOf - 5 * week, until = weekOf + 6 * week;
  const segments = new Map<string, Segment[]>();
  for (const zone of zones) {
    let starts = from, current = offset(zone, starts);
    const periods: Segment[] = [];
    for (let sample = from + week; sample <= until; sample += week) {
      const next = offset(zone, sample);
      if (next === current) continue;
      let lo = (sample - week) / 1000, hi = sample / 1000;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (offset(zone, mid * 1000) === current) lo = mid;
        else hi = mid;
      }
      periods.push([starts, hi * 1000, current]);
      starts = hi * 1000;
      current = next;
    }
    periods.push([starts, until, current]);
    segments.set(zone, periods);
  }
  cached = { weekOf, segments, json: JSON.stringify(Object.fromEntries(segments)) };
  return cached;
}

export function withQuoteExpiry(access: SessionAccess, now: number): SessionAccess {
  const expiry = quoteExpiresAt(now, "UTC");
  const candidates: Record<string, number> = {};
  for (const [zone, periods] of clocks(now).segments) {
    // Stable-offset zones share UTC's elapsed validity. Use the exact domain
    // rule around transitions (including gaps/overlaps) for the other zones.
    if (periods.length > 1) candidates[zone] = quoteExpiresAt(now, zone);
  }
  return { sql: `${access.sql}, quote_clock AS (
    SELECT coalesce(json_extract(?, '$.' || json_quote(j.site_zone)), ?) AS expires_at
    FROM commercial_job j WHERE json_type(?, '$.' || json_quote(j.site_zone)) = 'array'
  )`, params: [...access.params, JSON.stringify(candidates), expiry, clocks(now).json] };
}

export function withSiteClock(access: SessionAccess, now: number, jobCte: "commercial_job" | "aftercare_job" = "commercial_job"): SessionAccess {
  return { sql: `${access.sql}, site_clock AS MATERIALIZED (
    SELECT value ->> '$[0]' AS starts, value ->> '$[1]' AS ends, value ->> '$[2]' AS offset_ms
    FROM ${jobCte} j CROSS JOIN json_each(? -> ('$.' || json_quote(j.site_zone)))
  )`, params: [...access.params, clocks(now).json] };
}

export function withReviewDue(access: SessionAccess, now: number): SessionAccess {
  const clock = withSiteClock(access, now);
  // One business day at the same site wall time. Local date overrides (including
  // holidays) take priority; weekdays are the fallback when no calendar is set.
  return { sql: `${clock.sql}, review_days(no) AS (
    VALUES (1) UNION ALL SELECT no + 1 FROM review_days WHERE no < 14
  ), review_target AS (
    SELECT ${at} + current.offset_ms + ${DAY_MS} * days.no AS wall_due
    FROM commercial_job j JOIN site_clock current ON ${at} >= current.starts AND ${at} < current.ends
    CROSS JOIN review_days days
    LEFT JOIN staffed_calendar h ON h.area_id = j.area_id AND h.local_date =
      date((${at} + current.offset_ms) / 1000, 'unixepoch', '+' || days.no || ' days')
    LEFT JOIN staffed_calendar weekday ON weekday.area_id = j.area_id AND weekday.weekday =
      (CAST(strftime('%w', (${at} + current.offset_ms) / 1000, 'unixepoch', '+' || days.no || ' days') AS INTEGER) + 6) % 7 + 1
    WHERE CASE WHEN h.id IS NOT NULL THEN h.opens_minute IS NOT NULL
      WHEN EXISTS (SELECT 1 FROM staffed_calendar configured WHERE configured.area_id = j.area_id AND configured.weekday IS NOT NULL)
        THEN weekday.id IS NOT NULL
      ELSE strftime('%w', (${at} + current.offset_ms) / 1000, 'unixepoch', '+' || days.no || ' days') NOT IN ('0', '6') END
    ORDER BY days.no LIMIT 1
  ), review_clock AS (
    SELECT min(max(s.starts, t.wall_due - s.offset_ms)) AS due_at FROM review_target t CROSS JOIN site_clock s
    WHERE max(s.starts, t.wall_due - s.offset_ms) < s.ends
  )`, params: clock.params };
}

export const insideNoticePeriod = `EXISTS (SELECT 1 FROM site_clock accepted CROSS JOIN site_clock current
  WHERE a.at >= accepted.starts AND a.at < accepted.ends AND ${at} >= current.starts AND ${at} < current.ends
    AND julianday(date((${at} + current.offset_ms) / 1000, 'unixepoch')) -
      julianday(date((a.at + accepted.offset_ms) / 1000, 'unixepoch')) BETWEEN 0 AND 14)`;
