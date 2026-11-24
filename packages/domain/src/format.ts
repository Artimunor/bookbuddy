import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS } from "./units";

export const CURRENCIES = ["EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(minor: number, currency: Currency, locale: string): string {
  if (!Number.isSafeInteger(minor)) throw new RangeError("Money requires safe integer minor units");
  const key = `${locale}:${currency}`;
  let formatter = moneyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
    moneyFormatters.set(key, formatter);
  }
  if (Math.abs(minor) < 2 ** 46 * 100) return formatter.format(minor / 100);

  // Above this magnitude adjacent floats in major units can be more than a cent apart.
  const cents = minor % 100;
  const whole = (minor - cents) / 100;
  const fraction = formatter.formatToParts(Math.abs(cents) / 100).find((part) => part.type === "fraction");
  return formatter.formatToParts(whole).map((part) => part.type === "fraction" ? fraction!.value : part.value).join("");
}

export type ClockParts<Kind extends "site" | "viewer" = "site" | "viewer"> = {
  readonly date: Kind extends "site" ? string : string | null;
  readonly time: string;
  readonly zoneLabelKind: Kind;
  readonly zoneName: string | null;
};

export type ClockFormatOptions = {
  /** Distinguish repeated local clock times when the UTC offset matters. */
  readonly showOffset?: boolean;
};

type SiteTimeUnavailable = { readonly kind: "site_time_unavailable" };
type SiteTimeAvailable = {
  readonly kind: "available";
  readonly siteTime: string;
  readonly site: ClockParts<"site">;
};
export type SiteDateTime = SiteTimeAvailable | SiteTimeUnavailable;
export type TwoClockDateTime = SiteTimeUnavailable | (SiteTimeAvailable & {
  readonly viewerTime: string | null;
  readonly viewerDateDiffers: boolean;
  readonly viewer: ClockParts<"viewer"> | null;
});

const unavailable = { kind: "site_time_unavailable" } as const;
const timeOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
const clockOptions = {
  date: { weekday: "short", month: "short", day: "numeric" },
  numericDate: { weekday: "short", month: "2-digit", day: "2-digit" },
  time: timeOptions,
  offsetTime: { ...timeOptions, timeZoneName: "shortOffset" },
  zoneName: { timeZoneName: "longGeneric" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;
const clockFormatters = new Map<string, Intl.DateTimeFormat>();

function getClockFormatter(locale: string, zone: string, style: keyof typeof clockOptions): Intl.DateTimeFormat {
  const key = `${style}:${locale}:${zone}`;
  let formatter = clockFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...clockOptions[style], timeZone: zone });
    clockFormatters.set(key, formatter);
  }
  return formatter;
}

function getDateClock(locale: string, zone: string): Intl.DateTimeFormat | null {
  try {
    return getClockFormatter(locale, zone, /^pt(?:-|$)/i.test(locale) ? "numericDate" : "date");
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

function compactDate(instantMs: number, formatter: Intl.DateTimeFormat, locale: string): string {
  if (!/^en(?:-|$)/i.test(locale)) return formatter.format(instantMs);

  // Keep the Beacon English order while leaving the weekday and month text to Intl.
  let weekday = "", day = "", month = "";
  for (const { type, value } of formatter.formatToParts(instantMs)) {
    if (type === "weekday") weekday = value;
    else if (type === "day") day = value;
    else if (type === "month") month = value;
  }
  return `${weekday} ${day} ${month}`;
}

/** A localized generic zone name for callers without a more specific catalog label. */
export function formatZoneName(instantMs: number, zone: string | null | undefined, locale: string): string | null {
  if (!zone) return null;
  try {
    return getClockFormatter(locale, zone, "zoneName").formatToParts(instantMs)
      .find(({ type }) => type === "timeZoneName")?.value ?? null;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

function formatSiteClock(
  instantMs: number,
  siteZone: string,
  locale: string,
  dateClock: Intl.DateTimeFormat,
  timeStyle: "time" | "offsetTime",
): SiteTimeAvailable {
  const date = compactDate(instantMs, dateClock, locale);
  const time = getClockFormatter(locale, siteZone, timeStyle).format(instantMs);
  return {
    kind: "available",
    siteTime: `${date} · ${time}`,
    site: { date, time, zoneLabelKind: "site", zoneName: formatZoneName(instantMs, siteZone, locale) },
  };
}

/** Missing or unrecognised site data is never interpreted in the device zone. */
export function formatSiteDateTime(
  instantMs: number,
  siteZone: string | null | undefined,
  locale: string,
  options?: ClockFormatOptions,
): SiteDateTime {
  if (!siteZone) return unavailable;
  const dateClock = getDateClock(locale, siteZone);
  return dateClock
    ? formatSiteClock(instantMs, siteZone, locale, dateClock, options?.showOffset ? "offsetTime" : "time")
    : unavailable;
}

/** Pass no viewer zone when the second clock is disabled. */
export function formatTwoClock(
  instantMs: number,
  siteZone: string | null | undefined,
  viewerZone: string | null | undefined,
  locale: string,
  options?: ClockFormatOptions,
): TwoClockDateTime {
  if (!siteZone) return unavailable;
  const siteClock = getDateClock(locale, siteZone);
  if (!siteClock) return unavailable;
  const timeStyle = options?.showOffset ? "offsetTime" : "time";
  const site = formatSiteClock(instantMs, siteZone, locale, siteClock, timeStyle);
  if (viewerZone && viewerZone !== siteZone) {
    const viewerClock = getDateClock(locale, viewerZone);
    if (viewerClock && viewerClock.resolvedOptions().timeZone !== siteClock.resolvedOptions().timeZone) {
      const viewerDate = compactDate(instantMs, viewerClock, locale);
      const viewerDateDiffers = viewerDate !== site.site.date;
      const time = getClockFormatter(locale, viewerZone, timeStyle).format(instantMs);
      return {
        ...site,
        viewerDateDiffers,
        viewerTime: viewerDateDiffers ? `${viewerDate} · ${time}` : time,
        viewer: {
          date: viewerDateDiffers ? viewerDate : null, time, zoneLabelKind: "viewer",
          zoneName: formatZoneName(instantMs, viewerZone, locale),
        },
      };
    }
  }
  return { ...site, viewerTime: null, viewerDateDiffers: false, viewer: null };
}

const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();

export function formatSyncAge(lastSyncedAtMs: number, nowMs: number, locale: string): string {
  let formatter = relativeTimeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeTimeFormatters.set(locale, formatter);
  }
  const ageMs = Math.max(0, nowMs - lastSyncedAtMs);
  if (ageMs < MINUTE_MS) return formatter.format(-Math.floor(ageMs / SECOND_MS), "second");
  if (ageMs < HOUR_MS) return formatter.format(-Math.floor(ageMs / MINUTE_MS), "minute");
  if (ageMs < DAY_MS) return formatter.format(-Math.floor(ageMs / HOUR_MS), "hour");
  return formatter.format(-Math.floor(ageMs / DAY_MS), "day");
}
