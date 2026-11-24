import { createApiClient } from "@bookbuddy/api-client";
import type { ApiClient, ApiFetch } from "@bookbuddy/api-client";
import { resolveLocale } from "@bookbuddy/i18n/locales";
import type { LocaleTag } from "@bookbuddy/i18n/locales";
import Constants from "expo-constants";
import { useLocales } from "expo-localization";
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Platform } from "react-native";

interface ApiAccess {
  client: ApiClient | null;
  locale: LocaleTag;
  bindSession: (credential: string | null, uiLocale: string | null) => void;
  setRequestLocale: (locale: LocaleTag) => void;
}
const ApiContext = createContext<ApiAccess | null>(null);

export function ApiProvider({ children, baseUrl, fetch }: { children: ReactNode; baseUrl?: string; fetch?: ApiFetch }) {
  const extraUrl: unknown = Constants.expoConfig?.extra?.apiBaseUrl;
  const url = baseUrl ?? (Platform.OS !== "web" && typeof extraUrl === "string" ? extraUrl : undefined);
  const locales = useLocales();
  const credential = useRef<string | null>(null);
  const [preference, setPreference] = useState<string | null>(null);
  const fallbackLocale = resolveLocale([...(preference ? [preference] : []), ...locales.map(({ languageTag }) => languageTag)]);
  const fallbackHeader = useRef(fallbackLocale);
  const explicitHeader = useRef<LocaleTag | null>(null);
  const [effectiveLocale, setEffectiveLocale] = useState<LocaleTag | null>(null);
  useLayoutEffect(() => { fallbackHeader.current = fallbackLocale; }, [fallbackLocale]);
  const setRequestLocale = useCallback((locale: LocaleTag) => {
    explicitHeader.current = locale;
    setEffectiveLocale(locale);
  }, []);
  const client = useMemo(() => url ? createApiClient({
    baseUrl: url, getSession: () => credential.current, getLocale: () => explicitHeader.current ?? fallbackHeader.current, fetch,
  }) : null, [url, fetch]);
  const bindSession = useCallback((token: string | null, preferred: string | null) => {
    credential.current = token;
    setPreference(preferred);
  }, []);
  const locale = effectiveLocale ?? fallbackLocale;
  const access = useMemo<ApiAccess>(() => ({ client, locale, bindSession, setRequestLocale }), [client, locale, bindSession, setRequestLocale]);
  return <ApiContext.Provider value={access}>{children}</ApiContext.Provider>;
}

export function useApiAccess(): ApiAccess {
  const access = useContext(ApiContext);
  if (!access) throw new Error("ApiProvider is required");
  return access;
}

export function useApiClient(): ApiClient | null { return useApiAccess().client; }
export function useEffectiveLocale(): LocaleTag { return useApiAccess().locale; }
