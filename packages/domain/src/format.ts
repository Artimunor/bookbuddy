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

type SiteTimeUnavailable = { readonly kind: "site_time_unavailable" };
type SiteTimeAvailable = { readonly kind: "available"; readonly siteTime: string };
export type SiteDateTime = SiteTimeAvailable | SiteTimeUnavailable;
export type TwoClockDateTime = SiteTimeUnavailable | (SiteTimeAvailable & {
  readonly viewerTime: string | null;
  readonly viewerDateDiffers: boolean;
});

const unavailable = { kind: "site_time_unavailable" } as const;
const dateOptions = { year: "numeric", month: "short", day: "numeric" } as const;
const timeOptions = { hour: "numeric", minute: "2-digit", timeZoneName: "short" } as const;
const clockOptions = {
  dateTime: { ...dateOptions, ...timeOptions },
  date: dateOptions,
  time: timeOptions,
};
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

function getFullClock(locale: string, zone: string | null | undefined): Intl.DateTimeFormat | null {
  if (!zone) return null;
  try {
    return getClockFormatter(locale, zone, "dateTime");
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/** Missing or unrecognised site data is never interpreted in the device zone. */
export function formatSiteDateTime(instantMs: number, siteZone: string | null | undefined, locale: string): SiteDateTime {
  const siteClock = getFullClock(locale, siteZone);
  return siteClock ? { kind: "available", siteTime: siteClock.format(instantMs) } : unavailable;
}

/** Pass no viewer zone when the second clock is disabled. */
export function formatTwoClock(
  instantMs: number,
  siteZone: string | null | undefined,
  viewerZone: string | null | undefined,
  locale: string,
): TwoClockDateTime {
  const siteClock = getFullClock(locale, siteZone);
  if (!siteClock) return unavailable;
  const siteTime = siteClock.format(instantMs);
  const viewerClock = viewerZone === siteZone ? null : getFullClock(locale, viewerZone);
  if (!viewerClock) return { kind: "available", siteTime, viewerTime: null, viewerDateDiffers: false };

  const siteTimeZone = siteClock.resolvedOptions().timeZone;
  const viewerTimeZone = viewerClock.resolvedOptions().timeZone;
  if (siteTimeZone === viewerTimeZone) {
    return { kind: "available", siteTime, viewerTime: null, viewerDateDiffers: false };
  }
  const viewerDateDiffers = getClockFormatter(locale, siteTimeZone, "date").format(instantMs)
    !== getClockFormatter(locale, viewerTimeZone, "date").format(instantMs);
  const viewerTime = (viewerDateDiffers ? viewerClock : getClockFormatter(locale, viewerTimeZone, "time")).format(instantMs);
  return { kind: "available", siteTime, viewerTime, viewerDateDiffers };
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
