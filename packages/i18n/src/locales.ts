import config from "../locales.json";

export type LocaleTag = keyof typeof config.enabledLocales;
type PseudoLocaleTag = keyof typeof config.pseudoLocales;
type Direction = "ltr" | "rtl";

function isEnabledLocale(tag: string): tag is LocaleTag {
  return Object.hasOwn(config.enabledLocales, tag);
}

export const defaultLocale: LocaleTag = (() => {
  if (!isEnabledLocale(config.defaultLocale)) throw new Error("The default locale must be enabled");
  return config.defaultLocale;
})();

export function directionOf(tag: LocaleTag | PseudoLocaleTag): Direction {
  const { dir } = isEnabledLocale(tag) ? config.enabledLocales[tag] : config.pseudoLocales[tag];
  if (dir !== "ltr" && dir !== "rtl") throw new Error(`Invalid direction for ${tag}`);
  return dir;
}

export const enabledLocales = Object.freeze((Object.keys(config.enabledLocales) as LocaleTag[]).map((tag) =>
  Object.freeze({ tag, autonym: config.enabledLocales[tag].autonym, dir: directionOf(tag) }),
));

export function resolveLocale(requested: readonly string[]): LocaleTag {
  for (const request of requested) {
    let tag: string | undefined;
    try {
      [tag] = Intl.getCanonicalLocales(request.trim());
    } catch {
      continue;
    }
    if (!tag) continue;

    for (;;) {
      if (isEnabledLocale(tag)) return tag;
      const separator = tag.lastIndexOf("-");
      if (separator === -1) break;
      tag = tag.slice(0, separator);
    }

    if (Object.hasOwn(config.languageDefaults, tag)) {
      const fallback = config.languageDefaults[tag as keyof typeof config.languageDefaults];
      if (isEnabledLocale(fallback)) return fallback;
    }
  }
  return defaultLocale;
}
