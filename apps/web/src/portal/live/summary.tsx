import type { HomeProjection } from "@bookbuddy/api-contract";
import { LiveCapsule } from "../../ui";
import { dayLine, jobTitle, line, type T, visitLabels } from "../now/common";
import { formatPortalClock } from "../time";

type LiveItem = Extract<HomeProjection, { audience: "customer" }>["liveVisits"][number];
type SummaryProps = {
  item: Pick<LiveItem, "title" | "reference" | "providerName" | "siteZone" | "journey"> & Partial<Pick<LiveItem, "visit" | "crewName">>;
  to: string;
  t: T;
  locale: string;
  viewerZone?: string;
  bookedWindow?: LiveItem["visit"]["window"];
  live?: boolean;
};

export function VisitSummaryCard({ item, to, t, locale, viewerZone, bookedWindow, live }: SummaryProps) {
  const { visit, crewName, providerName, reference, title, siteZone, journey } = item;
  const labels = visit ? visitLabels(t) : null;
  const label = visit && labels
    ? visit.status === "confirmed" && !visit.step ? t("web.portal.work.eventVisitBooked") : labels[visit.status]
    : live ? t("web.portal.schedule.live") : t("web.portal.schedule.todayVisit");
  const kind = !visit || visit.status === "cover_arranging" ? "quiet"
    : visit.status === "finished" ? "finished" : visit.status === "paused" ? "paused" : "live";
  const band = visit ? visit.arrival ?? (visit.status === "confirmed" ? visit.window : null) : bookedWindow;
  const clocks = band ? formatPortalClock(band.startsAt, siteZone, locale, viewerZone, band.endsAt, true) ?? undefined : undefined;
  const source = visit ? formatPortalClock(visit.source.at, siteZone, locale, undefined, undefined, true)?.site : undefined;
  const time = source ? `${source.value} ${source.zoneLabel}`.trim() : "";
  const shared = visit?.source.by && time ? t("web.portal.schedule.shared", { name: visit.source.by, time }) : time;
  const provenance = [crewName, providerName, shared].filter(Boolean).join(" · ");
  const stageLine = visit?.step && labels ? dayLine(labels, visit.step, t) : line(t, journey);
  const sourceLabel = title ? jobTitle(t, title, reference) : providerName;
  const accessibleName = [sourceLabel, reference, label, clocks && `${clocks.site.value} ${clocks.site.zoneLabel}`,
    clocks?.viewer && `${clocks.viewer.value} ${clocks.viewer.zoneLabel}`, stageLine.ariaLabel, provenance].filter(Boolean).join(" · ");

  return <LiveCapsule to={to} source={sourceLabel} reference={reference} state={{ kind, label }}
    clocks={clocks} provenance={provenance} stageLine={stageLine} size="card" ariaLabel={accessibleName} />;
}
