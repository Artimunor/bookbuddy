import { defaultLocale, enabledLocales, resolveLocale } from "@bookbuddy/i18n/locales";
import { localizedPath, matchPublicEntry } from "./public-paths";

const localeCookie = /(?:^|;)\s*bookbuddy_ui_locale=([^;\s]*)/;
const languageWeight = /^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i;

function weightedLanguages(header: string): string[] {
  const languages: { tag: string; quality: number }[] = [];
  for (const entry of header.split(",")) {
    const [range, parameter, ...extra] = entry.split(";");
    const tag = range?.trim();
    if (!tag || tag === "*" || extra.length > 0) continue;

    const quality = parameter === undefined ? 1 : Number(languageWeight.exec(parameter.trim())?.[1]);
    if (quality > 0) languages.push({ tag, quality });
  }
  // Stable sort retains header order for equal weights.
  return languages.sort((a, b) => b.quality - a.quality).map(({ tag }) => tag);
}

export function redirectPublicEntry(
  method: string,
  url: URL,
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Response | undefined {
  if (method !== "GET" && method !== "HEAD") return;
  const path = matchPublicEntry(url.pathname);
  if (!path) return;

  const savedTag = cookie ? localeCookie.exec(cookie)?.[1] : undefined;
  const tag = enabledLocales.find((locale) => locale.tag === savedTag)?.tag
    ?? (acceptLanguage ? resolveLocale(weightedLanguages(acceptLanguage)) : defaultLocale);

  return new Response(null, {
    status: 302,
    headers: {
      "Location": localizedPath(tag, path) + url.search,
      "Cache-Control": "private, no-store",
      "Vary": "Cookie, Accept-Language",
    },
  });
}

export const portalDocumentPath = /^\/(?:portal(?:\/|$)|l\/[^/]+\/?$)/;
