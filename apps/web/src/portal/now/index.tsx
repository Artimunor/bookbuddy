import type { HomeProjection } from "@bookbuddy/api-contract";
import { useEffect, useState } from "react";
import { BookingCard, Button, NeedsYouCard, Stamp, StatusBanner } from "../../ui";
import { Booking, Frame, line, momentLabel, money, PortalClock, usePortal, usePortalViewerZone } from "./common";

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
  return <Frame current="now"><h1 className="text-page-title">{t("web.portal.work.now")}</h1>
    {!data && !failed && <p role="status">{t("web.portal.work.loading")}</p>}
    {failed && <StatusBanner title={t("web.portal.work.failed")} tone="critical" action={<Button onClick={() => setGeneration((n) => n + 1)}>{t("web.portal.work.retry")}</Button>} />}
    {data && <>
      {data.liveVisits.length > 0 && <section className="space-y-3"><h2 className="text-section-title">{t("web.portal.work.live")}</h2>{data.liveVisits.map((visit) => <BookingCard key={visit.jobId} to={`/portal/jobs/${encodeURIComponent(visit.jobId)}/live`} title={visit.title ?? t("web.portal.work.untitled")} reference={visit.reference} place={visit.providerName} stage={{ label: momentLabel(t, visit.visit.status === "confirmed" ? "crew_confirmed" : visit.visit.status) }} stageLine={line(t, visit.journey)} next={<PortalClock at={visit.visit.window.startsAt} zone={visit.siteZone} locale={locale} viewerZone={viewerZone} />} />)}</section>}
      {data.decisions.length > 0 && <section className="space-y-3"><h2 className="text-section-title">{t("web.portal.work.needsYou")}</h2>{data.decisions.map((decision) => <NeedsYouCard key={decision.recordId} status={t("web.portal.work.needsYou")} title={decision.kind === "review_quote" ? t("web.portal.work.reviewQuote") : t("web.portal.work.open")} detail={[decision.title ?? t("web.portal.work.untitled"), decision.reference, decision.amount && money(locale, decision.amount.minor, decision.amount.currency)].filter(Boolean).join(" · ")} deadline={decision.dueAt === null ? undefined : <PortalClock at={decision.dueAt} zone={decision.siteZone} locale={locale} viewerZone={viewerZone} />} action={{ label: decision.kind === "review_quote" ? t("web.portal.work.reviewQuote") : t("web.portal.work.open"), to: decision.kind === "review_quote" ? `/portal/jobs/${encodeURIComponent(decision.jobId)}/quote/${encodeURIComponent(decision.recordId)}` : `/portal/jobs/${encodeURIComponent(decision.jobId)}` }} />)}</section>}
      {data.upcoming.length > 0 && <section className="space-y-3"><h2 className="text-section-title">{t("web.portal.work.upcoming")}</h2>{data.upcoming.map((item) => <Booking key={item.jobId} item={item} viewerZone={viewerZone} />)}</section>}
      {data.recent.length > 0 && <section className="space-y-3"><h2 className="text-section-title">{t("web.portal.work.latest")}</h2>{data.recent.map((moment) => {
        const zone = data.place?.siteZone ?? zones.get(moment.jobId);
        return <Stamp key={`${moment.recordId}-${moment.at}`} kind="system" title={momentLabel(t, moment.kind)} time={zone ? <PortalClock at={moment.at} zone={zone} locale={locale} viewerZone={viewerZone} /> : t("web.portal.auth.yourTime", { time: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", hourCycle: "h23", timeZone: viewerZone }).format(moment.at) })} actor={moment.by ? { name: moment.by, role: "" } : undefined} />;
      })}</section>}
      {!data.liveVisits.length && !data.decisions.length && !data.upcoming.length && !data.recent.length && <p>{t("web.portal.work.empty")}</p>}
    </>}
  </Frame>;
}
