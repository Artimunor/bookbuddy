import type { Translator } from "@bookbuddy/i18n";
import type { LocaleTag } from "@bookbuddy/i18n/locales";

export const readingLanguages = [null, "en", "es", "de", "ro", "ar", "pt-PT"] as const;

type Translate = Translator<"mobile">["t"];

export function appLanguageLabel(t: Translate, locale: LocaleTag) {
  return locale === "pt-PT" ? t("mobile.auth.welcome.portuguese") : t("mobile.auth.welcome.english");
}

export function readingLanguageLabel(t: Translate, tag: string | null) {
  switch (tag) {
    case null: return t("mobile.auth.setup.originals");
    case "en": return t("mobile.auth.welcome.english");
    case "es": return t("mobile.display.spanish");
    case "de": return t("mobile.display.german");
    case "ro": return t("mobile.display.romanian");
    case "ar": return t("mobile.display.arabic");
    case "pt-PT": return t("mobile.auth.welcome.portuguese");
    default: return tag;
  }
}
