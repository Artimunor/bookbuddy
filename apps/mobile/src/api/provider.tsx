import { createApiClient } from "@bookbuddy/api-client";
import type { ApiClient, ApiFetch } from "@bookbuddy/api-client";
import { resolveLocale } from "@bookbuddy/i18n/locales";
import type { LocaleTag } from "@bookbuddy/i18n/locales";
import Constants from "expo-constants";
import { useLocales } from "expo-localization";
import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";
import type { NetworkState } from "expo-network";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Platform } from "react-native";
import { initialReadConnection, observeReadConnection, RequestBook } from "./requests";
import type { ReadConnection } from "./requests";

interface ApiAccess {
  client: ApiClient | null;
  cookieSession: boolean;
  locale: LocaleTag;
  requests: RequestBook;
  connection: ReadConnection;
  offline: boolean;
  getConnection: () => ReadConnection;
  isOffline: () => boolean;
  bindSession: (credential: string | null, sessionId: string | null, uiLocale: string | null) => void;
  setRequestLocale: (locale: LocaleTag) => void;
}
const ApiContext = createContext<ApiAccess | null>(null);

export function ApiProvider({ children, baseUrl, fetch }: { children: ReactNode; baseUrl?: string; fetch?: ApiFetch }) {
  const extra = Constants.expoConfig?.extra;
  const location: unknown = Reflect.get(globalThis, "location");
  const cookieSession = Platform.OS === "web" && extra?.localWebApi === true
    && !!location && typeof location === "object" && "protocol" in location && location.protocol === "http:"
    && "hostname" in location && (location.hostname === "localhost" || location.hostname === "127.0.0.1");
  const url = cookieSession ? "/api/v1" : baseUrl ?? (Platform.OS !== "web" && typeof extra?.apiBaseUrl === "string" ? extra.apiBaseUrl : undefined);
  const locales = useLocales();
  const credential = useRef<string | null>(null);
  const sessionId = useRef<string | null>(null);
  const [requests, setRequests] = useState(() => new RequestBook(false));
  const currentRequests = useRef(requests);
  const [connection, setConnection] = useState(initialReadConnection);
  const liveConnection = useRef(connection);
  useEffect(() => {
    let live = true;
    let sawEvent = false;
    const observe = (state: NetworkState) => {
      const next = observeReadConnection(liveConnection.current, state);
      if (next === liveConnection.current) return;
      liveConnection.current = next;
      setConnection(next);
    };
    // Fence data on the event itself: React may batch a fast disconnect and reconnect.
    const network = addNetworkStateListener((state) => { sawEvent = true; observe(state); });
    void getNetworkStateAsync().then((state) => { if (live && !sawEvent) observe(state); }, () => {});
    return () => { live = false; network.remove(); };
  }, []);
  const getConnection = useCallback(() => liveConnection.current, []);
  const isOffline = useCallback(() => liveConnection.current.offline, []);
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
  const bindSession = useCallback((token: string | null, id: string | null, preferred: string | null) => {
    if (sessionId.current !== id || credential.current !== token) {
      sessionId.current = id;
      credential.current = token;
      currentRequests.current.active = false;
      currentRequests.current = new RequestBook(id !== null);
      setRequests(currentRequests.current);
    }
    setPreference(preferred);
  }, []);
  const locale = effectiveLocale ?? fallbackLocale;
  const access = useMemo<ApiAccess>(() => ({ client, cookieSession, locale, requests, connection, offline: connection.offline, getConnection, isOffline, bindSession, setRequestLocale }),
    [client, cookieSession, locale, requests, connection, getConnection, isOffline, bindSession, setRequestLocale]);
  return <ApiContext.Provider value={access}>{children}</ApiContext.Provider>;
}

export function useApiAccess(): ApiAccess {
  const access = useContext(ApiContext);
  if (!access) throw new Error("ApiProvider is required");
  return access;
}

export function useApiClient(): ApiClient | null { return useApiAccess().client; }
export function useEffectiveLocale(): LocaleTag { return useApiAccess().locale; }
