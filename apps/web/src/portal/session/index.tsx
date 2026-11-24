import { createAuthClient, type ApiClient } from "@bookbuddy/api-client";
import type { SessionBootstrap } from "@bookbuddy/api-contract";
import { createWebTranslator } from "@bookbuddy/i18n/web";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { authDraft } from "../auth/flow";
import { clearCheckedOpenings } from "../notifications/handoff";
import { placeSearch } from "../places/search";
import { createPortalApi, type PortalIdentity } from "./api";
import { activatePendingOperations, clearPendingOperationsForSession, migrateLegacyPendingOperations, suspendPendingOperations } from "./pending-storage";
import { connectSessionSignals, type SessionSignals } from "./signals";

type Locale = "en" | "pt-PT";
function browserLocale(): Locale {
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("pt") ? "pt-PT" : "en";
}
function supportedLocale(locale: string | null | undefined): Locale {
  return locale?.toLowerCase().startsWith("pt") ? "pt-PT" : locale ? "en" : browserLocale();
}
type SessionContext = {
  bootstrap: SessionBootstrap | null;
  account: SessionBootstrap["account"] | null;
  activeContext: SessionBootstrap["activeContext"];
  preferences: SessionBootstrap["preferences"] | null;
  status: "loading" | "authenticated" | "unauthenticated" | "error";
  locale: Locale;
  api: ApiClient;
  acceptBootstrap: (session: SessionBootstrap) => boolean;
  markUnauthenticated: () => void;
  reload: () => void;
  signOut: () => void;
  signOutStatus: "idle" | "sending" | "failed";
};
const Context = createContext<SessionContext | null>(null);
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error("PortalSessionProvider is missing");
  return value;
}

export function usePortalAuth() {
  const { api } = useSession();
  return useMemo(() => createAuthClient(api), [api]);
}
export function PortalSessionProvider({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<SessionBootstrap | null>(null);
  const [status, setStatus] = useState<SessionContext["status"]>("loading");
  const [generation, setGeneration] = useState(0);
  const [signOutStatus, setSignOutStatus] = useState<SessionContext["signOutStatus"]>("idle");
  const identity = useRef<PortalIdentity | null>(null);
  const epoch = useRef(0);
  const pendingSignOut = useRef<number | null>(null);
  const endedSession = useRef<string | null>(null);
  const signals = useRef<SessionSignals | null>(null);
  const locale = supportedLocale(bootstrap?.preferences.uiLocale);
  const requestLocale = useRef(locale);
  requestLocale.current = locale;

  const resetView = useCallback(() => {
    epoch.current++;
    identity.current = null;
    clearCheckedOpenings();
    placeSearch.query = "";
    authDraft.challenge = null;
    authDraft.email = "";
    setSignOutStatus("idle");
    setBootstrap(null);
  }, []);
  const markUnauthenticated = useCallback(() => {
    resetView();
    activatePendingOperations(null);
    setStatus("unauthenticated");
  }, [resetView]);
  const reload = useCallback(() => {
    resetView();
    suspendPendingOperations();
    setStatus("loading");
    setGeneration(n => n + 1);
  }, [resetView]);

  const install = useCallback((session: SessionBootstrap, notify: boolean) => {
    if (endedSession.current === session.sessionId) { markUnauthenticated(); return false; }
    const next: PortalIdentity = { sessionId: session.sessionId, contextId: session.activeContext?.contextId ?? null };
    if (identity.current?.sessionId !== next.sessionId || identity.current.contextId !== next.contextId) {
      resetView();
      activatePendingOperations(`${next.sessionId}:${next.contextId ?? ""}`);
      identity.current = next;
      if (notify) signals.current?.publish({ kind: "changed", ...next });
    }
    setBootstrap(session); setStatus("authenticated");
    return true;
  }, [markUnauthenticated, resetView]);

  useLayoutEffect(() => {
    migrateLegacyPendingOperations();
    const bus = connectSessionSignals(signal => {
      if (signal.kind === "signed_out") {
        endedSession.current = signal.sessionId;
        if (identity.current?.sessionId === signal.sessionId) markUnauthenticated();
        else clearPendingOperationsForSession(signal.sessionId);
      } else if (identity.current?.sessionId !== signal.sessionId || identity.current.contextId !== signal.contextId) reload();
    });
    signals.current = bus;
    return () => { signals.current = null; bus.close(); };
  }, [markUnauthenticated, reload]);
  useEffect(() => {
    const controller = new AbortController();
    const requestedAt = epoch.current;
    const client = createAuthClient(createPortalApi({ identity: null, getLocale: () => requestLocale.current,
      isCurrent: () => epoch.current === requestedAt, onSessionChanged: reload }));
    void client.getSession({ signal: controller.signal }).then(result => {
      if (controller.signal.aborted || requestedAt !== epoch.current) return;
      if (result.ok) install(result.data, false);
      else if (result.error.code === "UNAUTHENTICATED") markUnauthenticated();
      else setStatus("error");
    });
    return () => controller.abort();
  }, [generation, install, markUnauthenticated, reload]);

  const renderEpoch = epoch.current;
  const sessionId = bootstrap?.sessionId ?? null;
  const contextId = bootstrap?.activeContext?.contextId ?? null;
  const api = useMemo(() => createPortalApi({
    identity: sessionId === null ? null : { sessionId, contextId },
    getLocale: () => locale, isCurrent: () => epoch.current === renderEpoch, onSessionChanged: reload,
  }), [sessionId, contextId, locale, renderEpoch, reload]);
  const acceptBootstrap = useCallback((session: SessionBootstrap) =>
    epoch.current === renderEpoch && install(session, true), [renderEpoch, install]);
  const signOut = useCallback(async () => {
    if (!sessionId || epoch.current !== renderEpoch || pendingSignOut.current === renderEpoch) return;
    pendingSignOut.current = renderEpoch;
    setSignOutStatus("sending");
    const result = await createAuthClient(api).end();
    if (pendingSignOut.current === renderEpoch) pendingSignOut.current = null;
    if (result.ok || result.error.code === "UNAUTHENTICATED") {
      endedSession.current = sessionId;
      if (identity.current?.sessionId === sessionId) markUnauthenticated();
      else clearPendingOperationsForSession(sessionId);
      signals.current?.publish({ kind: "signed_out", sessionId });
    } else if (epoch.current === renderEpoch) setSignOutStatus("failed");
  }, [api, markUnauthenticated, renderEpoch, sessionId]);
  useEffect(() => { document.documentElement.lang = locale; document.documentElement.dir = "ltr"; }, [locale]);
  useEffect(() => {
    const root = document.documentElement;
    const preference = bootstrap?.preferences;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme = preference?.theme === "system" || !preference ? (media.matches ? "dark" : "light") : preference.theme;
      root.dataset.theme = theme;
      root.style.colorScheme = theme;
      if (preference?.fieldMode) root.dataset.fieldMode = "true";
      else delete root.dataset.fieldMode;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [bootstrap?.preferences.theme, bootstrap?.preferences.fieldMode]);
  const value = useMemo<SessionContext>(() => ({ bootstrap, account: bootstrap?.account ?? null,
    activeContext: bootstrap?.activeContext ?? null, preferences: bootstrap?.preferences ?? null,
    status, locale, api, acceptBootstrap, markUnauthenticated, reload, signOut, signOutStatus,
  }), [bootstrap, status, locale, api, acceptBootstrap, markUnauthenticated, reload, signOut, signOutStatus]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function PortalLayout() { return <PortalSessionProvider><Outlet /></PortalSessionProvider>; }
export function ProtectedPortal() {
  const { status, bootstrap, locale, reload } = useSession();
  const location = useLocation();
  const { t } = createWebTranslator(locale);
  if (status === "loading") return <main><p role="status">{t("web.portal.auth.loading")}</p></main>;
  if (status === "error") return <main><p role="alert">{t("web.portal.auth.unavailable")}</p><button onClick={reload}>{t("web.portal.auth.retry")}</button></main>;
  const destination = location.pathname === "/portal/places" ? location.pathname : location.pathname + location.search + location.hash;
  if (status === "unauthenticated") return <Navigate replace to={`/portal/sign-in?next=${encodeURIComponent(destination)}`} />;
  if (bootstrap?.setup === "required") return <Navigate replace to={`/portal/setup?next=${encodeURIComponent(destination)}`} />;
  return <Outlet key={`${bootstrap?.sessionId}:${bootstrap?.activeContext?.contextId ?? ""}`} />;
}
