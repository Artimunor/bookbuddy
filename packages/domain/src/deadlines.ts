import { DAY_MS, HOUR_MS, SECOND_MS } from "./units";

export const QUOTE_VALIDITY_DAYS = 7;
export const CHANGE_VALIDITY_MS = 72 * HOUR_MS;

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

function getWallFormatter(timeZone: string): Intl.DateTimeFormat {
  if (!timeZone) throw new RangeError("Quote expiry requires a site time zone");
  let formatter = wallFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone, calendar: "iso8601", numberingSystem: "latn", hourCycle: "h23",
      era: "short", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    wallFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Represent the local date and clock on a UTC-shaped axis, not as an instant. */
function wallTime(formatter: Intl.DateTimeFormat, instantMs: number): number {
  let year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
  let beforeCommonEra = false;
  for (const { type, value } of formatter.formatToParts(instantMs)) {
    switch (type) {
      case "era": beforeCommonEra = value === "BC"; break;
      case "year": year = Number(value); break;
      case "month": month = Number(value); break;
      case "day": day = Number(value); break;
      case "hour": hour = Number(value); break;
      case "minute": minute = Number(value); break;
      case "second": second = Number(value); break;
    }
  }
  if (beforeCommonEra) year = 1 - year;
  const ms = instantMs - Math.floor(instantMs / SECOND_MS) * SECOND_MS;
  const wallMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  // Date.UTC treats years 0–99 as 1900-based; setUTCFullYear doesn't.
  if (year < 0 || year > 99) return wallMs;
  const wall = new Date(0);
  wall.setUTCFullYear(year, month - 1, day);
  return wall.setUTCHours(hour, minute, second, ms);
}

/** Seven local dates later at the original site clock time. */
export function quoteExpiresAt(issuedAtMs: number, siteZone: string): number {
  const formatter = getWallFormatter(siteZone);
  const target = wallTime(formatter, issuedAtMs) + QUOTE_VALIDITY_DAYS * DAY_MS;

  // Bracket the target local date's possible instants using the offsets on either side.
  const before = target - DAY_MS;
  const after = target + DAY_MS;
  const candidateBefore = target - (wallTime(formatter, before) - before);
  const candidateAfter = target - (wallTime(formatter, after) - after);
  if (candidateBefore === candidateAfter) return candidateBefore;

  let earlier = Math.min(candidateBefore, candidateAfter);
  let later = Math.max(candidateBefore, candidateAfter);
  if (wallTime(formatter, earlier) === target) return earlier; // Includes overlap: choose the first occurrence.
  if (wallTime(formatter, later) === target) return later;

  // In a forward gap, choose the boundary itself, not the requested minutes shifted past it.
  while (later - earlier > 1) {
    const midpoint = earlier + Math.floor((later - earlier) / 2);
    if (wallTime(formatter, midpoint) < target) earlier = midpoint;
    else later = midpoint;
  }
  return later;
}

/** 72 elapsed hours, shortened if the affected work starts sooner. */
export function changeExpiresAt(issuedAtMs: number, affectedWorkStartsAtMs: number | null): number {
  const deadline = issuedAtMs + CHANGE_VALIDITY_MS;
  return affectedWorkStartsAtMs === null ? deadline : Math.min(deadline, affectedWorkStartsAtMs);
}

/** A command must be recorded strictly before its deadline. */
export function isBeforeDeadline(atMs: number, deadlineMs: number): boolean {
  return atMs < deadlineMs;
}
