import { formatSiteDateTime, formatTwoClock, type ClockParts } from "@bookbuddy/domain";
import { resolveLocale } from "@bookbuddy/i18n/locales";
import { createWebTranslator } from "@bookbuddy/i18n/web";

const regions: Record<string, string> = {
  "Europe/Madrid": "ES", "Atlantic/Canary": "ES",
  "Europe/Lisbon": "PT", "Atlantic/Madeira": "PT", "Atlantic/Azores": "PT",
  "Europe/London": "GB",
};

export function zoneLabel(zone: string | null | undefined, parts: ClockParts, locale: string): string {
  const t = createWebTranslator(resolveLocale([locale])).t;
  if (parts.zoneLabelKind === "viewer") return t("shared.time.viewerZone");
  const region = zone ? regions[zone] : undefined;
  if (region && typeof Intl.DisplayNames === "function") {
    const country = new Intl.DisplayNames(locale, { type: "region" }).of(region);
    if (country) return t("shared.time.siteZone", { country, region });
  }
  return parts.zoneName ?? zone ?? "";
}

export function formatPortalClock(at: number, zone: string | null | undefined, locale: string, viewerZone?: string | null, end?: number) {
  const clock = formatTwoClock(at, zone, viewerZone, locale);
  if (clock.kind !== "available") return null;
  const until = end === undefined ? null : formatTwoClock(end, zone, viewerZone, locale);
  const siteEnd = until?.kind === "available" ? ` – ${until.site.date === clock.site.date ? until.site.time : until.siteTime}` : "";
  const viewerEnd = until?.kind === "available" && until.viewerTime ? ` – ${until.viewerTime}` : "";
  const dateTime = end === undefined ? new Date(at).toISOString() : undefined;
  return {
    site: { value: `${clock.siteTime}${siteEnd}`, dateTime, zoneLabel: zoneLabel(zone, clock.site, locale) },
    viewer: clock.viewer ? { value: `${clock.viewerTime}${viewerEnd}`, dateTime, zoneLabel: zoneLabel(viewerZone, clock.viewer, locale) } : undefined,
  };
}

export function formatPortalTime(at: number, zone: string | null | undefined, locale: string, viewerZone?: string | null): { site: string; viewer: string | null } | null {
  const clock = formatTwoClock(at, zone, viewerZone, locale);
  if (clock.kind !== "available") return null;
  const siteLabel = zoneLabel(zone, clock.site, locale);
  const site = [clock.site.date, clock.site.time, siteLabel].filter(Boolean).join(" · ");
  const viewer = clock.viewer ? `${clock.viewer.date ? `${clock.viewer.date} · ` : ""}${clock.viewer.time} ${zoneLabel(viewerZone, clock.viewer, locale)}` : null;
  return { site, viewer };
}

export function formatViewerTime(at: number, locale: string, zone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const clock = formatSiteDateTime(at, zone, locale);
  return clock.kind === "available" ? clock.site.time : "";
}
