import { enabledLocales, type LocaleTag } from "@bookbuddy/i18n/locales";
import { useEffect } from "react";
import { Outlet, useLoaderData, type RouteObject } from "react-router";
import { Now } from "../portal/now";
import { Bookings } from "../portal/bookings";
import { JobHome } from "../portal/jobs";
import { Quote } from "../portal/quote";
import { Places, PlaceDetail } from "../portal/places";
import { Settings } from "../portal/settings";
import { Notifications, LinkResolver } from "../portal/notifications";
import { RequestLayout, Describe, RequestPlace, ReviewRequest } from "../portal/new";
import { Invitation } from "../portal/invite";
import { Live } from "../portal/live";
import { Windows } from "../portal/windows";
import { Cancel } from "../portal/cancel";
import { Change } from "../portal/change";
import { Withdrawal } from "../portal/withdrawal";
import { Completion } from "../portal/completion";
import { Bill } from "../portal/bill";
import { Rating } from "../portal/rating";
import { Cases } from "../portal/cases";
import { Messages, Thread } from "../portal/messages";
import { PortalLayout, ProtectedPortal } from "../portal/session";
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
    Component: PortalLayout,
    children: [
  {
    path: "portal",
    caseSensitive: true,
    children: [
      { path: "sign-in", caseSensitive: true, lazy: async () => ({ Component: (await import("../portal/auth")).SignIn }) },
      { path: "verify", caseSensitive: true, lazy: async () => ({ Component: (await import("../portal/auth")).Verify }) },
      { path: "setup", caseSensitive: true, lazy: async () => ({ Component: (await import("../portal/auth")).Setup }) },
      pendingPortalRoute("help"),
      {
        id: "portal-protected",
        Component: ProtectedPortal,
        children: [
          { path: "invite/:opaque", caseSensitive: true, Component: Invitation },
          { path: "now", caseSensitive: true, Component: Now },
          { path: "bookings", caseSensitive: true, Component: Bookings },
          { path: "jobs/:id", caseSensitive: true, Component: JobHome },
          { path: "jobs/:id/quote/:version", caseSensitive: true, Component: Quote },
          { path: "jobs/:id/live", caseSensitive: true, Component: Live },
          { path: "jobs/:id/windows", caseSensitive: true, Component: Windows },
          { path: "jobs/:id/change/:version", caseSensitive: true, Component: Change },
          { path: "jobs/:id/cancel", caseSensitive: true, Component: Cancel },
          { path: "jobs/:id/withdrawal", caseSensitive: true, Component: Withdrawal },
          { path: "new", Component: RequestLayout, children: [
            { path: "describe", Component: Describe },
            { path: "place", Component: RequestPlace },
            { path: "place/:id", Component: PlaceDetail },
            { path: "review", Component: ReviewRequest },
          ] },
          { path: "places", caseSensitive: true, Component: Places },
          { path: "places/:id", caseSensitive: true, Component: PlaceDetail },
          { path: "settings", caseSensitive: true, Component: Settings },
          { path: "notifications", caseSensitive: true, Component: Notifications },
          { path: "messages", caseSensitive: true, Component: Messages },
          { path: "messages/:id", caseSensitive: true, Component: Thread },
          { path: "jobs/:id/completion", caseSensitive: true, Component: Completion },
          { path: "jobs/:id/bill", caseSensitive: true, Component: Bill },
          { path: "jobs/:id/rating", caseSensitive: true, Component: Rating },
          { path: "jobs/:id/cases/:caseId", caseSensitive: true, Component: Cases },
        ],
      },
    ],
  },
  { Component: ProtectedPortal, children: [
    { path: "l/:opaque", caseSensitive: true, Component: LinkResolver },
  ] },
    ],
  },
];
