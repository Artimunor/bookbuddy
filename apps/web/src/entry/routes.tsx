import { enabledLocales, type LocaleTag } from "@bookbuddy/i18n/locales";
import { useEffect } from "react";
import { Outlet, useLoaderData, type RouteObject } from "react-router";
import { publicPaths } from "./public-paths";

type WebLocale = (typeof enabledLocales)[number];

export function publicLocaleRouteId(tag: LocaleTag): string {
  return `public-${tag}`;
}

function PublicLayout() {
  const locale = useLoaderData<() => WebLocale>();

  useEffect(() => {
    document.documentElement.lang = locale.tag;
    document.documentElement.dir = locale.dir;
  }, [locale]);

  return <main id="main"><Outlet context={locale} /></main>;
}

function publicRoutes(locale: WebLocale): RouteObject {
  return {
    id: publicLocaleRouteId(locale.tag),
    path: locale.tag,
    caseSensitive: true,
    loader: () => locale,
    Component: PublicLayout,
    children: publicPaths.map((path) => path === "/"
      ? { index: true, element: null }
      : { path: path.slice(1), caseSensitive: true, element: null }),
  };
}

const pendingRoute = () => import("../portal/_pending/route");

function pendingPortalRoute(path: string): RouteObject {
  return { path, caseSensitive: true, lazy: pendingRoute };
}

export const routes: RouteObject[] = [
  ...enabledLocales.map(publicRoutes),
  {
    path: "portal",
    caseSensitive: true,
    lazy: async () => ({ Component: (await import("../portal/session")).PortalLayout }),
    children: [
      { path: "sign-in", caseSensitive: true, lazy: async () => ({ Component: (await import("../portal/auth")).SignIn }) },
      { path: "verify", caseSensitive: true, lazy: async () => ({ Component: (await import("../portal/auth")).Verify }) },
      { path: "setup", caseSensitive: true, lazy: async () => ({ Component: (await import("../portal/auth")).Setup }) },
      ...["invite/:opaque", "help"].map(pendingPortalRoute),
      {
        id: "portal-protected",
        lazy: async () => ({ Component: (await import("../portal/session")).ProtectedPortal }),
        children: [
          "now",
          "bookings",
          "new/describe",
          "new/place",
          "new/review",
          "places",
          "places/:id",
          "settings",
          "messages",
          "messages/:id",
          "notifications",
          "jobs/:id",
          "jobs/:id/live",
          "jobs/:id/quote/:version",
          "jobs/:id/windows",
          "jobs/:id/completion",
          "jobs/:id/bill",
          "jobs/:id/rating",
          "jobs/:id/change/:version",
          "jobs/:id/cases/:caseId",
          "jobs/:id/cancel",
          "jobs/:id/withdrawal",
        ].map(pendingPortalRoute),
      },
    ],
  },
  { path: "l/:opaque", caseSensitive: true, lazy: pendingRoute },
];
