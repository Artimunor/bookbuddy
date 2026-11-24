import type { HomeProjection, JobDetail } from "@bookbuddy/api-contract";
import { LiveCapsule } from "../../ui";
import { dayLine, jobTitle, line, type T, visitLabels } from "../now/common";
import { formatPortalClock } from "../time";

type LiveItem = Extract<HomeProjection, { audience: "customer" }>["liveVisits"][number];
type WholeJob = Extract<Extract<JobDetail, { audience: "customer" }>["job"], { view: "whole" }>;
type SummaryProps = {
  item: Pick<LiveItem, "title" | "reference" | "providerName" | "siteZone" | "journey"> & {
    visit?: LiveItem["visit"] | WholeJob["visit"];
    crewName?: LiveItem["crewName"];
  };
  to: string;
  t: T;
  locale: string;
  viewerZone?: string;
  bookedWindow?: LiveItem["visit"]["window"];
  live?: boolean;
};

export function VisitSummaryCard({ item, to, t, locale, viewerZone, bookedWindow, live }: SummaryProps) {
  const { visit, crewName, providerName, reference, title, siteZone, journey } = item;
  const labels = visitLabels(t);
  const wholeVisit = visit && "arrivalWindow" in visit ? visit : undefined;
  const homeVisit = visit && "window" in visit ? visit : undefined;
  const status = visit?.status;
  const label = homeVisit?.status === "confirmed" && !homeVisit.step ? t("web.portal.work.eventVisitBooked")
    : status ? labels[status] : visit ? t("web.portal.schedule.quiet")
      : live ? t("web.portal.schedule.live") : t("web.portal.schedule.todayVisit");
  const kind = !status || status === "cover_arranging" || status === "no_crew_available" ? "quiet"
    : status === "finished" ? "finished" : status === "paused" ? "paused" : "live";
  const window = wholeVisit?.arrivalWindow;
  const booked = homeVisit ? homeVisit.arrival ?? (status === "confirmed" ? homeVisit.window : null) : bookedWindow;
  const clocks = (wholeVisit
    ? window && status === "on_the_way" && formatPortalClock(window.start, window.siteZone, locale, viewerZone, window.end, true)
    : booked && formatPortalClock(booked.startsAt, siteZone, locale, viewerZone, booked.endsAt, true)) || undefined;
  const sourceAt = visit?.source?.at;
  const source = sourceAt === undefined ? undefined : formatPortalClock(sourceAt, siteZone, locale, undefined, undefined, true)?.site;
  const time = source ? `${source.value} ${source.zoneLabel}`.trim() : "";
  const sharedByName = wholeVisit?.source?.sharedByName ?? homeVisit?.source.by;
  const shared = sharedByName && time ? t("web.portal.schedule.shared", { name: sharedByName, time }) : time;
  const provenance = [crewName, providerName, shared].filter(Boolean).join(" · ");
  const stageLine = wholeVisit || homeVisit?.step ? dayLine(labels, visit?.step ?? null, t) : { ...line(t, journey), labelAll: true };
  const sourceLabel = title ? jobTitle(t, title, reference) : providerName;
  const accessibleName = [sourceLabel, reference, label, clocks && `${clocks.site.value} ${clocks.site.zoneLabel}`,
    clocks?.viewer && `${clocks.viewer.value} ${clocks.viewer.zoneLabel}`, stageLine.ariaLabel, provenance].filter(Boolean).join(" · ");

  return <LiveCapsule to={to} source={sourceLabel} reference={reference} state={{ kind, label }}
    clocks={clocks} provenance={provenance} stageLine={stageLine} size="card" ariaLabel={accessibleName} />;
}
