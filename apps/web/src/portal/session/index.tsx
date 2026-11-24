import { createApiClient, createAuthClient } from "@bookbuddy/api-client";
import type { SessionBootstrap } from "@bookbuddy/api-contract";
import { createWebTranslator } from "@bookbuddy/i18n/web";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { clearCheckedOpenings } from "../notifications/handoff";
import { activatePendingOperations } from "./pending-storage";

type Locale = "en" | "pt-PT";
function browserLocale(): Locale {
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("pt") ? "pt-PT" : "en";
}
function supportedLocale(locale: string | null | undefined): Locale {
  return locale?.toLowerCase().startsWith("pt") ? "pt-PT" : locale ? "en" : browserLocale();
}
let requestLocale: Locale = "en";
export const authClient = createAuthClient(createApiClient({
  baseUrl: "/api/v1", getSession: () => null, getLocale: () => requestLocale,
}));
type SessionContext = {
  bootstrap: SessionBootstrap | null;
  account: SessionBootstrap["account"] | null;
  activeContext: SessionBootstrap["activeContext"];
  preferences: SessionBootstrap["preferences"] | null;
  status: "loading" | "authenticated" | "unauthenticated" | "error";
  locale: Locale;
  acceptBootstrap: (session: SessionBootstrap) => void;
  markUnauthenticated: () => void;
  reload: () => void;
};
const Context = createContext<SessionContext | null>(null);
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error("PortalSessionProvider is missing");
  return value;
}
export function PortalSessionProvider({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<SessionBootstrap | null>(null);
  const [status, setStatus] = useState<SessionContext["status"]>("loading");
  const [generation, setGeneration] = useState(0);
  const identity = useRef<string | null>(null);
  const locale = supportedLocale(bootstrap?.preferences.uiLocale);
  requestLocale = locale;
  const acceptBootstrap = useCallback((session: SessionBootstrap) => {
    const nextIdentity = `${session.sessionId}:${session.activeContext?.contextId ?? ""}`;
    if (identity.current !== nextIdentity) { clearCheckedOpenings(); activatePendingOperations(nextIdentity); }
    identity.current = nextIdentity;
    setBootstrap(session); setStatus("authenticated");
  }, []);
  const markUnauthenticated = useCallback(() => {
    clearCheckedOpenings(); activatePendingOperations(null); identity.current = null;
    setBootstrap(null); setStatus("unauthenticated");
  }, []);
  useEffect(() => {
    let active = true;
    void authClient.getSession().then((result) => {
      if (!active) return;
      if (result.ok) acceptBootstrap(result.data);
      else if (result.error.code === "UNAUTHENTICATED") markUnauthenticated();
      else setStatus("error");
    });
    return () => { active = false; };
  }, [generation, acceptBootstrap, markUnauthenticated]);
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
    status, locale, acceptBootstrap, markUnauthenticated,
    reload: () => { clearCheckedOpenings(); setStatus("loading"); setGeneration((n) => n + 1); },
  }), [bootstrap, status, locale, acceptBootstrap, markUnauthenticated]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function PortalLayout() { return <PortalSessionProvider><Outlet /></PortalSessionProvider>; }
export function ProtectedPortal() {
  const { status, bootstrap, locale, reload } = useSession();
  const location = useLocation();
  const { t } = createWebTranslator(locale);
  if (status === "loading") return <main><p role="status">{t("web.portal.auth.loading")}</p></main>;
  if (status === "error") return <main><p role="alert">{t("web.portal.auth.unavailable")}</p><button onClick={reload}>{t("web.portal.auth.retry")}</button></main>;
  if (status === "unauthenticated") return <Navigate replace to={`/portal/sign-in?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`} />;
  if (bootstrap?.setup === "required") return <Navigate replace to={`/portal/setup?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`} />;
  return <Outlet />;
}
