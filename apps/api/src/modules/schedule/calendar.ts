export const calendarDay = 86_400_000;
const weekDays = 7;
const timeZones = [...new Set([...Intl.supportedValuesOf("timeZone"), "UTC", "Etc/UTC", "Etc/GMT", "GMT"])];
const offsets = new Map<string, Intl.DateTimeFormat>();
const dayBoundsCache = new Map<string, string>();

export interface Span { startsAt: number; endsAt: number }
export interface CalendarDate {
  date: string;
  weekday: string;
  toUtc(startOffset: number, endOffset: number): Span[];
}
type Segment = Span & { offset: number };

function offsetAt(zone: string, instant: number) {
  let formatter = offsets.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "longOffset" });
    offsets.set(zone, formatter);
  }
  const label = formatter.formatToParts(instant).find((part) => part.type === "timeZoneName")?.value;
  if (label === "GMT") return 0;
  const match = /^GMT([+-])(\d\d):(\d\d)(?::(\d\d))?$/.exec(label ?? "");
  if (!match) throw new RangeError("Cannot resolve business calendar offset");
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4] ?? 0)) * 1000;
}

function segments(zone: string, from: number, until: number): Segment[] {
  const rows: Segment[] = [];
  let startsAt = from, offset = offsetAt(zone, from);
  for (let sample = Math.min(until, from + calendarDay); sample <= until; sample += calendarDay) {
    const next = offsetAt(zone, sample);
    if (next === offset) continue;
    let left = (sample - calendarDay) / 1000, right = sample / 1000;
    while (right - left > 1) {
      const mid = Math.floor((right + left) / 2);
      if (offsetAt(zone, mid * 1000) === offset) left = mid;
      else right = mid;
    }
    const endsAt = right * 1000;
    rows.push({ startsAt, endsAt, offset });
    startsAt = endsAt;
    offset = next;
  }
  rows.push({ startsAt, endsAt: until, offset });
  return rows;
}

export function intersect(span: Span, bounds: Span): Span | null {
  const startsAt = Math.max(span.startsAt, bounds.startsAt), endsAt = Math.min(span.endsAt, bounds.endsAt);
  return startsAt < endsAt ? { startsAt, endsAt } : null;
}

function utcSpans(periods: readonly Segment[], wallStart: number, wallEnd: number): Span[] {
  return periods.flatMap((period) => intersect({ startsAt: wallStart - period.offset, endsAt: wallEnd - period.offset }, period) ?? []);
}

export function mergeSpans(spans: Span[]): Span[] {
  const merged: Span[] = [];
  for (const span of spans.sort((a, b) => a.startsAt - b.startsAt || a.endsAt - b.endsAt)) {
    const last = merged.at(-1);
    if (last && last.endsAt >= span.startsAt) last.endsAt = Math.max(last.endsAt, span.endsAt);
    else merged.push(span);
  }
  return merged;
}

const wallAt = (date: string) => Date.parse(`${date}T00:00:00Z`);
const dateAt = (wallMs: number) => new Date(wallMs).toISOString().slice(0, 10);
export const localDate = (instant: number, zone: string) => dateAt(instant + offsetAt(zone, instant));
const dayNumber = (wall: number) => (new Date(wall).getUTCDay() + 6) % weekDays;

export function calendarWeek(zone: string, now: number, weekOf: string | null) {
  const wall = wallAt(weekOf ?? localDate(now, zone));
  const first = wall - dayNumber(wall) * calendarDay;
  const periods = segments(zone, first - calendarDay, first + (weekDays + 1) * calendarDay);
  return Array.from({ length: weekDays }, (_, i) => calendarDate(periods, first + i * calendarDay));
}

function calendarDate(periods: readonly Segment[], wall: number): CalendarDate {
  return {
    date: dateAt(wall), weekday: String(dayNumber(wall) + 1),
    toUtc: (startOffset: number, endOffset: number) => utcSpans(periods, wall + startOffset, wall + endOffset),
  };
}

export function singleDate(date: string, zone: string) {
  const wall = wallAt(date);
  return calendarDate(segments(zone, wall - calendarDay, wall + 2 * calendarDay), wall);
}

// The DB chooses the site's current business zone atomically with the edit.
// Pass compact IANA bounds for the selected date, not a client-trusted offset.
export function dayBoundsByZone(date: string): string {
  const existing = dayBoundsCache.get(date);
  if (existing !== undefined) return existing;
  const bounds: Record<string, readonly [number, number]> = {};
  for (const zone of timeZones) {
    const periods = singleDate(date, zone).toUtc(0, calendarDay);
    const first = periods[0], last = periods.at(-1);
    if (first && last) bounds[zone] = [first.startsAt, last.endsAt];
  }
  const json = JSON.stringify(bounds);
  if (dayBoundsCache.size >= weekDays) dayBoundsCache.delete(dayBoundsCache.keys().next().value!);
  dayBoundsCache.set(date, json);
  return json;
}
