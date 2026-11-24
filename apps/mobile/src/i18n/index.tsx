import { createAuthClient } from "@bookbuddy/api-client";
import { formatMoney, formatSiteDateTime, formatSyncAge, formatTwoClock } from "@bookbuddy/domain";
import { defaultLocale, directionOf, enabledLocales, resolveLocale, type LocaleTag } from "@bookbuddy/i18n/locales";
import { createMobileTranslator } from "@bookbuddy/i18n/mobile";
import { uuid } from "expo";
import { useLocales } from "expo-localization";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApiAccess } from "../api/provider";
import { useSession } from "../session";
import { localPreferenceStorage } from "./storage";

const signedOutKey = "bookbuddy.ui-locale.v1";
const accountKey = (id: string) => `${signedOutKey}.${id}`;

function enabled(value: unknown): value is LocaleTag {
  return enabledLocales.some(({ tag }) => tag === value);
}

function deviceMatches(tags: readonly string[]): boolean {
  // resolveLocale deliberately returns English for both a match and no match.
  return tags.some((tag) => {
    try {
      const language = new Intl.Locale(tag).language;
      return enabledLocales.some((locale) => new Intl.Locale(locale.tag).language === language);
    } catch { return false; }
  });
}

type Pending = { locale: LocaleTag; prior: string | null; revision: number | null; operationId: string };

function parsePending(json: string | null): Pending | null {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (value && typeof value === "object" && "locale" in value && enabled(value.locale)
      && "prior" in value && (value.prior === null || typeof value.prior === "string")
      && "revision" in value && (value.revision === null || (typeof value.revision === "number" && Number.isSafeInteger(value.revision)))
      && "operationId" in value && typeof value.operationId === "string") {
      return { locale: value.locale, prior: value.prior, revision: value.revision, operationId: value.operationId };
    }
  } catch { /* An invalid local choice is ignored. */ }
  return null;
}

type LocaleChoice = {
  locale: LocaleTag;
  deviceLanguageSupported: boolean;
  explicitChoice: LocaleTag | null;
  ready: boolean;
  pending: boolean;
  chooseLocale: (locale: LocaleTag) => Promise<void>;
};
const LocaleContext = createContext<LocaleChoice | null>(null);

type AccountPending = { key: string; value: Pending | null };

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { client, setRequestLocale } = useApiAccess();
  const { session, bootstrap, preferences, acceptBootstrap } = useSession();
  const device = useLocales();
  const tags = useMemo(() => device.map(({ languageTag }) => languageTag), [device]);
  const supported = useMemo(() => deviceMatches(tags), [tags]);
  const deviceLocale = resolveLocale(tags);
  const [local, setLocal] = useState<LocaleTag | null | undefined>(undefined);
  const [accountPending, setAccountPending] = useState<AccountPending | null>(null);
  const writing = useRef(false);
  const key = session ? accountKey(session.accountId) : null;
  const rawSaved = preferences?.uiLocale ?? null;
  const revision = bootstrap?.preferences.revision ?? null;
  const storedPending = key && accountPending?.key === key ? accountPending.value : null;
  const pending = storedPending && rawSaved === storedPending.prior && (rawSaved === null || resolveLocale([rawSaved]) !== storedPending.locale)
    && (revision === null || storedPending.revision === null || revision === storedPending.revision) ? storedPending : null;
  const locale = pending?.locale ?? (rawSaved !== null ? resolveLocale([rawSaved]) : local ?? deviceLocale);

  useEffect(() => {
    let active = true;
    void localPreferenceStorage.read(signedOutKey).then((value) => {
      if (active) setLocal((current) => current === undefined ? enabled(value) ? value : null : current);
    }).catch(() => { if (active) setLocal((current) => current ?? null); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!key) return;
    let active = true;
    void localPreferenceStorage.read(key).then((json) => {
      if (active) setAccountPending((current) => current?.key === key ? current : { key, value: parsePending(json) });
    }).catch(() => { if (active) setAccountPending((current) => current?.key === key ? current : { key, value: null }); });
    return () => { active = false; };
  }, [key]);

  useLayoutEffect(() => { setRequestLocale(locale); }, [locale, setRequestLocale]);

  async function chooseLocale(next: LocaleTag) {
    if (!key) {
      if (next === local) return;
      setLocal(next);
      await localPreferenceStorage.write(signedOutKey, next).catch(() => undefined);
      return;
    }
    if (writing.current || (next === locale && !pending)) return;
    writing.current = true;
    try {
      if (rawSaved !== null && resolveLocale([rawSaved]) === next) {
        setAccountPending({ key, value: null });
        await localPreferenceStorage.remove(key).catch(() => undefined);
        return;
      }
      const previous = pending?.locale === next ? pending : null;
      const choice: Pending = {
        locale: next, prior: rawSaved, revision, operationId: previous?.revision === revision ? previous.operationId : uuid.v4(),
      };
      setAccountPending({ key, value: choice });
      await localPreferenceStorage.write(key, JSON.stringify(choice)).catch(() => undefined);
      if (revision === null || !client) return;
      const result = await createAuthClient(client).patchSettings({
        operationId: choice.operationId, expectedRevision: revision, payload: { uiLocale: next },
      });
      if (!result.ok) return;
      await acceptBootstrap(result.data);
      setAccountPending((current) => current?.key === key ? { key, value: null } : current);
      await localPreferenceStorage.remove(key).catch(() => undefined);
    } catch {
      // The local choice remains marked pending until an explicit retry or newer account settings.
    } finally {
      writing.current = false;
    }
  }

  return <LocaleContext.Provider value={{ locale, explicitChoice: local ?? null, deviceLanguageSupported: supported,
    ready: local !== undefined && (!key || accountPending?.key === key), pending: !!pending, chooseLocale }}>{children}</LocaleContext.Provider>;
}

// Gallery fixtures are independent of real accounts and storage.
export function PreviewLocaleProvider({ children, initialLocale = defaultLocale, deviceLanguageSupported = true }: {
  children: ReactNode; initialLocale?: LocaleTag; deviceLanguageSupported?: boolean;
}) {
  const [locale, setLocale] = useState(initialLocale);
  return <LocaleContext.Provider value={{ locale, deviceLanguageSupported, explicitChoice: null, ready: true, pending: false,
    chooseLocale: async (next) => { setLocale(next); } }}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleChoice {
  const choice = useContext(LocaleContext);
  if (!choice) throw new Error("LocaleProvider is required");
  return choice;
}

export function useT() { return createMobileTranslator(useLocale().locale).t; }
export function useDirection() { return directionOf(useLocale().locale); }

export function useFormat() {
  const { locale } = useLocale();
  return useMemo(() => ({
    money: (amount: number, currency: Parameters<typeof formatMoney>[1]) => formatMoney(amount, currency, locale),
    siteTime: (instant: number, zone: string | null | undefined) => formatSiteDateTime(instant, zone, locale),
    twoClock: (instant: number, siteZone: string | null | undefined, viewerZone: string | null | undefined) =>
      formatTwoClock(instant, siteZone, viewerZone, locale),
    syncAge: (lastSyncedAt: number, now: number) => formatSyncAge(lastSyncedAt, now, locale),
  }), [locale]);
}
