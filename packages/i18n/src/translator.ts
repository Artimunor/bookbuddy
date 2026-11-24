import { createIntl, createIntlCache, type IntlShape } from "@formatjs/intl";
import type { MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import type { MessageKey, MessageValues, Surface } from "./generated/types";
import { defaultLocale, resolveLocale } from "./locales";

export type Catalogs = Readonly<Partial<Record<string, Record<string, MessageFormatElement[]>>>>;
export type LocaleInput = string | null | undefined;

type Values = Record<string, string | number | boolean | Date | ((chunks: string[]) => string)>;
type Format = (key: string, values?: Values) => string;
interface Namespace {
  hasLocale(tag: string): boolean;
  forLocale(tag: string): Format;
}
type ValuesArgument<K extends MessageKey<Surface>> = [MessageValues<K>] extends [undefined]
  ? [values?: undefined]
  : [values: Exclude<MessageValues<K>, undefined>];
export type Translator<S extends Surface> = Readonly<{
  t<K extends MessageKey<S>>(key: K, ...args: ValuesArgument<NoInfer<K>>): string;
}>;

const english = "en";
const intlCache = createIntlCache();

export function createNamespace(catalogs: Catalogs, pseudo?: Catalogs): Namespace {
  const hasPseudo = (tag: string): boolean => !!pseudo && Object.hasOwn(pseudo, tag);
  const createFormatter = (tag: string) => {
    const simulated = hasPseudo(tag);
    return createIntl({
      locale: simulated ? english : tag,
      defaultLocale: english,
      messages: (simulated ? pseudo : catalogs)?.[tag] ?? {},
    }, intlCache);
  };
  const formatters = new Map<string, Format>();
  let fallback: IntlShape | undefined;

  return {
    hasLocale: (tag: string) => Object.hasOwn(catalogs, tag) || hasPseudo(tag),
    forLocale(tag: string) {
      const cached = formatters.get(tag);
      if (cached) return cached;
      const current = tag === english ? (fallback ??= createFormatter(english)) : createFormatter(tag);
      const format: Format = (key, values) => {
        let intl = current;
        if (!Object.hasOwn(intl.messages, key)) {
          intl = fallback ??= createFormatter(english);
          if (!Object.hasOwn(intl.messages, key)) throw new Error(`Unknown message key ${key}`);
        }
        return intl.formatMessage({ id: key }, values);
      };
      formatters.set(tag, format);
      return format;
    },
  };
}

export function bindTranslator<S extends Surface>(shared: Namespace, own = shared) {
  const cached = new Map<string, Translator<S>>();
  return (locale?: LocaleInput): Translator<S> => {
    const tag = locale == null ? defaultLocale : shared.hasLocale(locale) ? locale : resolveLocale([locale]);
    const existing = cached.get(tag);
    if (existing) return existing;
    const sharedFormat = shared.forLocale(tag);
    const ownFormat = own === shared ? sharedFormat : own.forLocale(tag);
    const translator: Translator<S> = Object.freeze({
      t: (key: string, values?: Values) => (key.startsWith("shared.") ? sharedFormat : ownFormat)(key, values),
    });
    cached.set(tag, translator);
    return translator;
  };
}
