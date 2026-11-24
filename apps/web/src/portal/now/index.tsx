import type { HomeProjection } from "@bookbuddy/api-contract";
import { useEffect, useState } from "react";
import { ActionLink, Button, Card, Glyph, NeedsYouCard, Stamp, StatusBanner } from "../../ui";
import { liveVisitPath, splitUpcomingVisits } from "../live/navigation";
import { VisitSummaryCard } from "../live/summary";
import { Booking, Frame, jobTitle, momentLabel, money, PortalClock, usePortal, usePortalViewerZone } from "./common";

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
  const visits = data ? splitUpcomingVisits(data, Date.now()) : null;
  return <Frame current="now"><h1 className="text-page-title">{t("web.portal.work.now")}</h1>
    {!data && !failed && <p role="status">{t("web.portal.work.loading")}</p>}
    {failed && <StatusBanner title={t("web.portal.work.failed")} tone="critical" action={<Button onClick={() => setGeneration((n) => n + 1)}>{t("web.portal.work.retry")}</Button>} />}
    {data && <>
      <ActionLink className="bb-ask" to="/portal/new/describe" variant="secondary">{t("web.portal.ps.description")}<Glyph name="next" /></ActionLink>
      {data.liveVisits.length > 0 && <section className="space-y-3">
        <h2 className="text-section-title">{t("web.portal.work.live")}</h2>
        {data.liveVisits.map((item) => <VisitSummaryCard key={item.jobId} item={item} to={liveVisitPath(item.jobId)}
          t={t} locale={locale} viewerZone={viewerZone} />)}
      </section>}
      {data.decisions.length > 0 && <section className="space-y-3"><h2 className="text-section-title">{t("web.portal.work.needsYou")}</h2>{data.decisions.map((decision) => <NeedsYouCard key={decision.recordId} title={decision.kind === "review_quote" ? t("web.portal.work.reviewQuote") : t("web.portal.work.open")} detail={[jobTitle(t,decision.title,decision.reference), decision.reference, decision.amount && money(locale, decision.amount.minor, decision.amount.currency)].filter(Boolean).join(" · ")} deadline={decision.dueAt === null ? undefined : <PortalClock at={decision.dueAt} zone={decision.siteZone} locale={locale} viewerZone={viewerZone} />} action={{ label: decision.kind === "review_quote" ? t("web.portal.work.reviewQuote") : t("web.portal.work.open"), to: decision.kind === "review_quote" ? `/portal/jobs/${encodeURIComponent(decision.jobId)}/quote/${encodeURIComponent(decision.recordId)}` : `/portal/jobs/${encodeURIComponent(decision.jobId)}` }} />)}</section>}
      {visits && visits.today.length > 0 && <section className="space-y-3">
        <h2 className="text-section-title">{t("web.portal.work.todayVisits")}</h2>
        {visits.today.map((item) => <VisitSummaryCard key={item.jobId} item={item} to={liveVisitPath(item.jobId)}
          t={t} locale={locale} viewerZone={viewerZone} bookedWindow={item.nextVisit?.window} />)}
      </section>}
      {visits && visits.later.length > 0 && <section className="space-y-3"><h2 className="text-section-title">{t("web.portal.work.upcoming")}</h2>{visits.later.map((item) => <Booking key={item.jobId} item={item} viewerZone={viewerZone} />)}</section>}
      {data.recent.length > 0 && <Card title={t("web.portal.work.latest")}><div className="bb-moments text-ink [&_.bb-stamp]:animate-none">{data.recent.map((moment) => {
        const zone = data.place?.siteZone ?? zones.get(moment.jobId);
        return <Stamp key={`${moment.recordId}-${moment.at}`} kind="system" title={momentLabel(t, moment.kind)} time={zone ? <PortalClock at={moment.at} zone={zone} locale={locale} viewerZone={viewerZone} /> : t("web.portal.auth.yourTime", { time: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", hourCycle: "h23", timeZone: viewerZone }).format(moment.at) })} actor={moment.by ? { name: moment.by, role: "" } : undefined} />;
      })}</div></Card>}
      {!data.liveVisits.length && !data.decisions.length && !data.upcoming.length && !data.recent.length && <Card>{t("web.portal.work.noActiveBookings")}</Card>}
    </>}
  </Frame>;
}
