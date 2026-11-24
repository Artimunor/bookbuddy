import { createApiClient, createCommercialClient, createJobsClient } from "@bookbuddy/api-client";
import type { HomeProjection } from "@bookbuddy/api-contract";
import type { Translator } from "@bookbuddy/i18n";
import { createWebTranslator } from "@bookbuddy/i18n/web";
import { useMemo, type ReactNode } from "react";
import { BookingCard, PortalShell, TwoClock, type JobLineProps } from "../../ui";
import { useSession } from "../session";
import { formatPortalClock, formatPortalTime } from "../time";

export function usePortal() {
  const session = useSession();
  const t = createWebTranslator(session.locale).t;
  const clients = useMemo(() => {
    const api = createApiClient({ baseUrl: "/api/v1", getSession: () => null, getLocale: () => session.locale });
    return { jobs: createJobsClient(api), commercial: createCommercialClient(api) };
  }, [session.locale]);
  return { ...session, t, ...clients };
}
export type T = Translator<"web">["t"];
export type Journey = Extract<HomeProjection, { audience: "customer" }>["upcoming"][number]["journey"];
export function stageLabel(t: T, step: Journey["step"]) {
  switch (step) {
    case "requested": return t("web.portal.work.requested");
    case "quoted": return t("web.portal.work.quoted");
    case "booked": return t("web.portal.work.booked");
    case "visit": return t("web.portal.work.visit");
    case "signed_off": return t("web.portal.work.signedOff");
    case "paid": return t("web.portal.work.paid");
  }
}
export function momentLabel(t: T, kind: Extract<HomeProjection, { audience: "customer" }>["recent"][number]["kind"]) {
  switch (kind) {
    case "requested": return t("web.portal.work.requested");
    case "quote_issued": return t("web.portal.work.eventQuoteIssued");
    case "quote_approved": return t("web.portal.work.eventQuoteApproved");
    case "visit_booked": return t("web.portal.work.eventVisitBooked");
    case "visit_revised": return t("web.portal.work.eventVisitRevised");
    case "cancelled": return t("web.portal.work.cancelled");
    case "change_issued": return t("web.portal.work.eventChange");
    case "completion_submitted": return t("web.portal.work.eventCompletion");
    case "signed_off": return t("web.portal.work.signedOff");
    case "bill_issued": return t("web.portal.work.eventBill");
    case "paid": return t("web.portal.work.paid");
    case "case_opened": return t("web.portal.work.eventCase");
    case "crew_confirmed": return t("web.portal.work.eventCrewConfirmed");
    case "on_the_way": return t("web.portal.work.eventOnWay");
    case "arrival_revised": return t("web.portal.work.eventArrivalRevised");
    case "arrival_withdrawn": return t("web.portal.work.eventArrivalWithdrawn");
    case "on_site": return t("web.portal.work.eventOnSite");
    case "working": return t("web.portal.work.eventWorking");
    case "paused": return t("web.portal.work.eventPaused");
    case "photo": return t("web.portal.work.eventPhoto");
    case "cover_arranging": return t("web.portal.work.eventCover");
    case "no_crew_available": return t("web.portal.schedule.noCrew");
    case "crew_updated": return t("web.portal.work.eventCrewUpdated");
    case "finished": return t("web.portal.work.eventFinished");
  }
}
export function line(t: T, journey: Journey): JobLineProps {
  const stages = (["requested", "quoted", "booked", "visit", "signed_off", "paid"] as const).map((id) => ({ id, label: stageLabel(t, id) }));
  const label = journey.cancelled ? t("web.portal.work.cancelled") : stageLabel(t, journey.step);
  return { stages, currentId: journey.step, ariaLabel: t("web.portal.work.journey", { stage: label }), quiet: journey.cancelled || journey.complete };
}
export function date(locale: string, at: number, zone: string) {
  return formatPortalTime(at, zone, locale)?.site ?? "";
}
export function PortalClock({ at, end, zone, locale, viewerZone }: { at: number; end?: number; zone: string | null; locale: string; viewerZone?: string }) {
  const clock = formatPortalClock(at, zone, locale, viewerZone, end);
  return clock ? <TwoClock {...clock} /> : null;
}
export function usePortalViewerZone() {
  const { preferences } = useSession();
  return preferences?.twoClock ? preferences.displayZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
}
export function money(locale: string, minor: number, currency = "EUR") {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
}
export function Frame({ current, children }: { current?: "now" | "bookings"; children: ReactNode }) {
  const { account, t } = usePortal();
  const name = account?.displayName ?? account?.email ?? "";
  const nav = {
    now: { label: t("web.portal.work.now"), to: "/portal/now" },
    bookings: { label: t("web.portal.work.bookings"), to: "/portal/bookings" },
    messages: { label: t("web.portal.work.messages"), to: "/portal/messages" },
    places: { label: t("web.portal.work.places"), to: "/portal/places" },
    settings: { label: t("web.portal.work.settings"), to: "/portal/settings" },
  };
  return <PortalShell identity={{ name, initials: name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(), to: "/portal/settings" }} nav={nav} current={current} navLabel={t("web.portal.work.navigation")} skipLabel={t("web.portal.work.skip")}><div className="space-y-6">{children}</div></PortalShell>;
}
type CustomerCard = Extract<HomeProjection, { audience: "customer" }>["upcoming"][number];
export function Booking({ item, viewerZone }: { item: CustomerCard; viewerZone?: string }) {
  const { t, locale } = usePortal();
  const label = item.journey.cancelled ? t("web.portal.work.cancelled") : stageLabel(t, item.journey.step);
  return <BookingCard to={`/portal/jobs/${encodeURIComponent(item.jobId)}`} title={item.title ?? t("web.portal.work.untitled")} reference={item.reference} place={`${item.place.alias} · ${item.providerName}`} stage={{ label }} stageLine={line(t, item.journey)} next={item.nextVisit && <PortalClock at={item.nextVisit.window.startsAt} zone={item.siteZone} locale={locale} viewerZone={viewerZone} />} />;
}
