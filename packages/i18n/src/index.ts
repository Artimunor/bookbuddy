import { createMobileTranslator } from "./mobile";
import { createPushTranslator } from "./push";
import { createSharedTranslator } from "./shared";
import { createWebTranslator } from "./web";
import type { Surface } from "./generated/types";
import type { LocaleInput, Translator } from "./translator";

export type { MessageKey, MessageValues, Surface } from "./generated/types";
export type { LocaleInput, Translator } from "./translator";
export { defaultLocale, directionOf, enabledLocales, resolveLocale, type LocaleTag } from "./locales";

const factories: { [S in Surface]: (locale?: LocaleInput) => Translator<S> } = {
  shared: createSharedTranslator,
  mobile: createMobileTranslator,
  web: createWebTranslator,
  push: createPushTranslator,
};

export function createTranslator<S extends Surface>(surface: S, locale?: LocaleInput): Translator<S> {
  return factories[surface](locale);
}
