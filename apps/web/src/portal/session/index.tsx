import { createApiClient, createAuthClient } from "@bookbuddy/api-client";
import type { SessionBootstrap } from "@bookbuddy/api-contract";
import { createWebTranslator } from "@bookbuddy/i18n/web";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";

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
  const locale = supportedLocale(bootstrap?.preferences.uiLocale);
  requestLocale = locale;
  const acceptBootstrap = useCallback((session: SessionBootstrap) => {
    setBootstrap(session); setStatus("authenticated");
  }, []);
  useEffect(() => {
    let active = true;
    void authClient.getSession().then((result) => {
      if (!active) return;
      if (result.ok) acceptBootstrap(result.data);
      else if (result.error.code === "UNAUTHENTICATED") { setBootstrap(null); setStatus("unauthenticated"); }
      else setStatus("error");
    });
    return () => { active = false; };
  }, [generation, acceptBootstrap]);
  useEffect(() => { document.documentElement.lang = locale; document.documentElement.dir = "ltr"; }, [locale]);
  const value = useMemo<SessionContext>(() => ({ bootstrap, account: bootstrap?.account ?? null,
    activeContext: bootstrap?.activeContext ?? null, preferences: bootstrap?.preferences ?? null,
    status, locale, acceptBootstrap, reload: () => { setStatus("loading"); setGeneration((n) => n + 1); },
  }), [bootstrap, status, locale, acceptBootstrap]);
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
