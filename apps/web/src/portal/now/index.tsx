import type { HomeProjection } from "@bookbuddy/api-contract";
import { useEffect, useState } from "react";
import { BookingCard, Button, NeedsYouCard, Stamp, StatusBanner } from "../../ui";
import { Booking, date, Frame, line, momentLabel, money, usePortal } from "./common";

type Home = Extract<HomeProjection, { audience: "customer" }>;
export function Now() {
  const { jobs, locale, t } = usePortal();
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
  }, [jobs, generation]);
  return <Frame current="now"><h1 className="text-page-title">{t("web.portal.work.now")}</h1>
    {!data && !failed && <p role="status">{t("web.portal.work.loading")}</p>}
    {failed && <StatusBanner title={t("web.portal.work.failed")} tone="critical" action={<Button onClick={() => setGeneration((n) => n + 1)}>{t("web.portal.work.retry")}</Button>} />}
    {data && <>
      {data.liveVisits.length > 0 && <section className="space-y-3"><h2 className="text-section-title">{t("web.portal.work.live")}</h2>{data.liveVisits.map((visit) => <BookingCard key={visit.jobId} to={`/portal/jobs/${encodeURIComponent(visit.jobId)}/live`} title={visit.title ?? t("web.portal.work.untitled")} reference={visit.reference} place={visit.providerName} stage={{ label: momentLabel(t, visit.visit.status === "confirmed" ? "crew_confirmed" : visit.visit.status) }} stageLine={line(t, visit.journey)} next={date(locale, visit.visit.window.startsAt, visit.siteZone)} />)}</section>}
      {data.decisions.length > 0 && <section className="space-y-3"><h2 className="text-section-title">{t("web.portal.work.needsYou")}</h2>{data.decisions.map((decision) => <NeedsYouCard key={decision.recordId} status={t("web.portal.work.needsYou")} title={decision.kind === "review_quote" ? t("web.portal.work.reviewQuote") : t("web.portal.work.open")} detail={[decision.title ?? t("web.portal.work.untitled"), decision.reference, decision.amount && money(locale, decision.amount.minor, decision.amount.currency)].filter(Boolean).join(" · ")} deadline={decision.dueAt === null ? undefined : date(locale, decision.dueAt, decision.siteZone)} action={{ label: decision.kind === "review_quote" ? t("web.portal.work.reviewQuote") : t("web.portal.work.open"), to: decision.kind === "review_quote" ? `/portal/jobs/${encodeURIComponent(decision.jobId)}/quote/${encodeURIComponent(decision.recordId)}` : `/portal/jobs/${encodeURIComponent(decision.jobId)}` }} />)}</section>}
      {data.upcoming.length > 0 && <section className="space-y-3"><h2 className="text-section-title">{t("web.portal.work.upcoming")}</h2>{data.upcoming.map((item) => <Booking key={item.jobId} item={item} />)}</section>}
      {data.recent.length > 0 && <section className="space-y-3"><h2 className="text-section-title">{t("web.portal.work.latest")}</h2>{data.recent.map((moment) => <Stamp key={`${moment.recordId}-${moment.at}`} kind="system" title={momentLabel(t, moment.kind)} time={date(locale, moment.at, data.place?.siteZone ?? "UTC")} actor={moment.by ? { name: moment.by, role: "" } : undefined} />)}</section>}
      {!data.liveVisits.length && !data.decisions.length && !data.upcoming.length && !data.recent.length && <p>{t("web.portal.work.empty")}</p>}
    </>}
  </Frame>;
}
