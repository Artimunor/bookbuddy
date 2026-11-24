import type { ClockParts } from "@bookbuddy/domain";
import type { LocaleTag } from "@bookbuddy/i18n/locales";
import { createMobileTranslator } from "@bookbuddy/i18n/mobile";

const regions: Record<string, string> = {
  "Europe/Madrid": "ES", "Atlantic/Canary": "ES",
  "Europe/Lisbon": "PT", "Atlantic/Madeira": "PT", "Atlantic/Azores": "PT",
  "Europe/London": "GB",
};

export function zoneLabel(zone: string | null | undefined, parts: ClockParts, locale: LocaleTag): string {
  const t = createMobileTranslator(locale).t;
  if (parts.zoneLabelKind === "viewer") return t("shared.time.viewerZone");
  const region = zone ? regions[zone] : undefined;
  if (region && typeof Intl.DisplayNames === "function") {
    const country = new Intl.DisplayNames(locale, { type: "region" }).of(region);
    if (country) return t("shared.time.siteZone", { country, region });
  }
  return parts.zoneName ?? zone ?? "";
}
