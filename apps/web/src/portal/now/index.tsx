import type { HomeProjection } from "@bookbuddy/api-contract";
import { useEffect, useState } from "react";
import { ActionLink, Button, Card, Glyph, LiveCapsule, NeedsYouCard, Stamp, StatusBanner } from "../../ui";
import { formatPortalClock } from "../time";
import { Booking, dayLine, Frame, jobTitle, momentLabel, money, PortalClock, usePortal, usePortalViewerZone, visitLabels } from "./common";

type Home = Extract<HomeProjection, { audience: "customer" }>;
export function Now() {
  const { jobs, locale, t, bootstrap, activeContext } = usePortal();
  const viewerZone = usePortalViewerZone();
  const [data, setData] = useState<Home | null>(null);
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setFailed(false);
    void jobs.getHome({}, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok && result.data.audience === "customer") setData(result.data); else setFailed(true);
    });
    return () => controller.abort();
  }, [jobs, generation, bootstrap?.sessionId, activeContext?.contextId]);
  const zones = new Map<string, string>();
  if (data?.recent.length && !data.place?.siteZone) {
    for (const group of [data.liveVisits, data.decisions, data.upcoming]) {
      for (const item of group) zones.set(item.jobId, item.siteZone);
    }
  }
  const labels = visitLabels(t);
  return <Frame current="now"><h1 className="text-page-title">{t("web.portal.work.now")}</h1>
    {!data && !failed && <p role="status">{t("web.portal.work.loading")}</p>}
    {failed && <StatusBanner title={t("web.portal.work.failed")} tone="critical" action={<Button onClick={() => setGeneration((n) => n + 1)}>{t("web.portal.work.retry")}</Button>} />}
    {data && <>
      <ActionLink className="bb-ask" to="/portal/new/describe" variant="secondary">{t("web.portal.ps.description")}<Glyph name="next" /></ActionLink>
      {data.liveVisits.length > 0 && <section className="space-y-3">
        <h2 className="text-section-title">{t("web.portal.work.live")}</h2>
        {data.liveVisits.map(({ jobId, title, reference, providerName, siteZone, visit }) => {
          const label = labels[visit.status];
          const band = visit.arrival ?? (visit.status === "confirmed" ? visit.window : null);
          const clocks = band ? formatPortalClock(band.startsAt, siteZone, locale, viewerZone, band.endsAt, true) ?? undefined : undefined;
          const source = formatPortalClock(visit.source.at, siteZone, locale, undefined, undefined, true)?.site;
          const time = [source?.value, source?.zoneLabel].filter(Boolean).join(" ");
          const provenance = visit.source.by && time ? t("web.portal.schedule.shared", { name: visit.source.by, time }) : time;
          const sourceLabel = title ? jobTitle(t, title, reference) : providerName;
          return <LiveCapsule key={jobId} to={`/portal/jobs/${encodeURIComponent(jobId)}/live`} source={sourceLabel}
            reference={reference} state={{ kind: visit.status === "finished" ? "finished" : visit.status === "paused" ? "paused" : visit.status === "cover_arranging" ? "quiet" : "live", label }}
            clocks={clocks} provenance={provenance} stageLine={dayLine(labels, visit.step, t)} size="card"
            ariaLabel={[sourceLabel, label, clocks && `${clocks.site.value} ${clocks.site.zoneLabel}`, clocks?.viewer && `${clocks.viewer.value} ${clocks.viewer.zoneLabel}`, provenance].filter(Boolean).join(" · ")} />;
        })}
      </section>}
      {data.decisions.length > 0 && <section className="space-y-3"><h2 className="text-section-title">{t("web.portal.work.needsYou")}</h2>{data.decisions.map((decision) => <NeedsYouCard key={decision.recordId} title={decision.kind === "review_quote" ? t("web.portal.work.reviewQuote") : t("web.portal.work.open")} detail={[jobTitle(t,decision.title,decision.reference), decision.reference, decision.amount && money(locale, decision.amount.minor, decision.amount.currency)].filter(Boolean).join(" · ")} deadline={decision.dueAt === null ? undefined : <PortalClock at={decision.dueAt} zone={decision.siteZone} locale={locale} viewerZone={viewerZone} />} action={{ label: decision.kind === "review_quote" ? t("web.portal.work.reviewQuote") : t("web.portal.work.open"), to: decision.kind === "review_quote" ? `/portal/jobs/${encodeURIComponent(decision.jobId)}/quote/${encodeURIComponent(decision.recordId)}` : `/portal/jobs/${encodeURIComponent(decision.jobId)}` }} />)}</section>}
      {data.upcoming.length > 0 && <section className="space-y-3"><h2 className="text-section-title">{t("web.portal.work.upcoming")}</h2>{data.upcoming.map((item) => <Booking key={item.jobId} item={item} viewerZone={viewerZone} />)}</section>}
      {data.recent.length > 0 && <Card title={t("web.portal.work.latest")}><div className="bb-moments">{data.recent.map((moment) => {
        const zone = data.place?.siteZone ?? zones.get(moment.jobId);
        return <Stamp key={`${moment.recordId}-${moment.at}`} kind="system" title={momentLabel(t, moment.kind)} time={zone ? <PortalClock at={moment.at} zone={zone} locale={locale} viewerZone={viewerZone} /> : t("web.portal.auth.yourTime", { time: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", hourCycle: "h23", timeZone: viewerZone }).format(moment.at) })} actor={moment.by ? { name: moment.by, role: "" } : undefined} />;
      })}</div></Card>}
      {!data.liveVisits.length && !data.decisions.length && !data.upcoming.length && !data.recent.length && <Card>{t("web.portal.work.noActiveBookings")}</Card>}
    </>}
  </Frame>;
}
