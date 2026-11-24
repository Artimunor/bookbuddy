import type { ClockParts, TwoClockDateTime } from "@bookbuddy/domain";

type Format = {
  twoClock: (instant: number, siteZone: string | null | undefined, viewerZone?: string) => TwoClockDateTime;
  zoneLabel: (zone: string | null | undefined, parts: ClockParts) => string;
};

export function siteWindow(format: Format, start: number, end: number, zone: string | null | undefined, viewerZone?: string) {
  const first = format.twoClock(start, zone, viewerZone);
  const last = format.twoClock(end, zone, viewerZone);
  if (first.kind !== "available" || last.kind !== "available") return null;
  const range = (a: ClockParts, b: ClockParts) => a.date === b.date
    ? `${a.time}–${b.time}`
    : `${[a.date, a.time].filter(Boolean).join(" · ")} – ${[b.date, b.time].filter(Boolean).join(" · ")}`;
  return {
    date: first.site.date === last.site.date ? first.site.date : null,
    time: range(first.site, last.site),
    zone: format.zoneLabel(zone, first.site),
    viewer: first.viewer && last.viewer ? `${range(first.viewer, last.viewer)} ${format.zoneLabel(viewerZone, first.viewer)}` : null,
  };
}
