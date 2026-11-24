import type { ClockParts, TwoClockDateTime } from "@bookbuddy/domain";

type Format = {
  twoClock: (instant: number, siteZone: string, customerZone: string | null | undefined) => TwoClockDateTime;
  zoneLabel: (zone: string, parts: ClockParts) => string;
};

export function foremanWindow(format: Format, window: { startsAt: number; endsAt: number }, siteZone: string, customerZone?: string | null) {
  const first = format.twoClock(window.startsAt, siteZone, customerZone);
  const last = format.twoClock(window.endsAt, siteZone, customerZone);
  if (first.kind !== "available" || last.kind !== "available") return null;
  const range = (a: ClockParts, b: ClockParts) => a.date === b.date ? `${a.time}–${b.time}` : `${[a.date, a.time].filter(Boolean).join(" · ")} – ${[b.date, b.time].filter(Boolean).join(" · ")}`;
  return {
    date: first.site.date === last.site.date ? first.site.date : null,
    time: range(first.site, last.site),
    zone: format.zoneLabel(siteZone, first.site),
    customerTime: first.viewer && last.viewer ? first.viewer.date && first.viewer.date === last.viewer.date
      ? `${first.viewer.date} · ${range(first.viewer, last.viewer)}` : range(first.viewer, last.viewer) : null,
  };
}
