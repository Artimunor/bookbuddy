import type { CustomerLiveVisit } from "@bookbuddy/api-contract";
import { Card, CrewDots, LiveCapsule } from "../../ui";
import { dayLine, type T, visitLabels } from "../now/common";
import { formatPortalClock, formatPortalTime } from "../time";
import { useArrivalExpired } from "./arrival";

export function VisitStatus({ visit, t, locale, viewer }: { visit: CustomerLiveVisit; t: T; locale: string; viewer: string | undefined }) {
  const { live, siteZone } = visit;
  const travel = live.status === null ? visit.moments.find(({ kind }) =>
    kind === "on_the_way" || kind === "arrival_revised" || kind === "arrival_withdrawn" || kind === "cover_arranging") : undefined;
  const expiredArrival = (travel?.kind === "on_the_way" || travel?.kind === "arrival_revised") &&
    live.source?.at === travel.recordedAt ? travel.band : undefined;
  const arrival = live.arrival?.band ?? expiredArrival;
  const estimateExpired = useArrivalExpired(live.status === "on_the_way" ? arrival?.endsAt : undefined);
  const status = expiredArrival || estimateExpired ? "estimate_passed" : live.status;
  const labels = visitLabels(t);
  const label = status === "estimate_passed" ? t("web.portal.schedule.passed") : status ? labels[status] : t("web.portal.schedule.quiet");
  const step = status === "estimate_passed" && live.step === "on_the_way" ? null : live.step;
  const band = status === "on_the_way" || status === "estimate_passed" ? arrival : status === "confirmed" ? visit.window : null;
  const clocks = band ? formatPortalClock(band.startsAt, siteZone, locale, viewer, band.endsAt, true) ?? undefined : undefined;
  const source = live.source ? formatPortalTime(live.source.at, siteZone, locale, viewer)?.site ?? "" : "";
  const provenance = live.source?.sharedByName ? t("web.portal.schedule.shared", { name: live.source.sharedByName, time: source }) : source;
  const nextUpdate = live.nextUpdateAt ? formatPortalTime(live.nextUpdateAt, siteZone, locale, viewer) : null;
  const gap = status === "cover_arranging" || status === "no_crew_available";
  const capsule = status === "estimate_passed" || !status || gap ? "quiet" : status === "finished" || status === "paused" ? status : "live";
  const crew = status === "on_site" || status === "working" ? "on-site" : status === "on_the_way" ? "on-the-way" : gap ? "gap" : "confirmed";

  return <>
    <LiveCapsule ariaLabel={label} source={visit.providerName} reference={visit.job.reference}
      state={{ kind: capsule, label }} clocks={clocks} provenance={provenance} stageLine={dayLine(labels, step, t)} />
    {nextUpdate && <Card><p>{t("web.portal.schedule.updateBy", { time: nextUpdate.site })}</p>{nextUpdate.viewer && <p className="text-supporting text-muted">{nextUpdate.viewer}</p>}</Card>}
    {visit.confirmedCrewNames.length > 0 && <Card title={t("web.portal.schedule.crew")}><CrewDots
      people={visit.confirmedCrewNames.map((name, i) => ({ id: String(i), name, initials: name.split(/\s+/).map(x => x[0]).join("").slice(0, 2).toUpperCase(), role: "", tone: i % 2 ? "d" : "b" }))}
      status={crew} statusLabel={label} /></Card>}
  </>;
}
