import type { JobDetail } from "@bookbuddy/api-contract";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ActionLink, Button, Card, JobLine, Stamp, StatusBanner } from "../../ui";
import { Frame, line, momentLabel, money, PortalClock, stageLabel, usePortal, usePortalViewerZone } from "../now/common";
import { takeCheckedOpening } from "../notifications/handoff";

type Job = Extract<Extract<JobDetail, { audience: "customer" }>["job"], { view: "whole" }>;
export function JobHome() {
  const { id = "" } = useParams();
  const location = useLocation();
  const { jobs, locale, t, bootstrap, activeContext } = usePortal();
  const viewerZone = usePortalViewerZone();
  const [job, setJob] = useState<Job | null>(null);
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const checked = generation === 0 ? takeCheckedOpening(location.state, bootstrap?.sessionId, activeContext?.contextId ?? null) : null;
    if (checked?.kind === "job" && checked.record.audience === "customer" && checked.record.job.view === "whole" && checked.record.job.jobId === id) { setJob(checked.record.job); setFailed(false); return; }
    const controller = new AbortController(); setJob(null); setFailed(false);
    void jobs.getJob(id, { view: "whole" }, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok && result.data.audience === "customer" && result.data.job.view === "whole") setJob(result.data.job); else setFailed(true);
    });
    return () => controller.abort();
  }, [id, jobs, generation, location.state, bootstrap?.sessionId, activeContext?.contextId]);
  return <Frame><Link to="/portal/bookings">{t("web.portal.work.bookings")}</Link>
    {!job && !failed && <p role="status">{t("web.portal.work.loading")}</p>}
    {failed && <StatusBanner title={t("web.portal.work.failed")} tone="critical" action={<Button onClick={() => setGeneration((n) => n + 1)}>{t("web.portal.work.retry")}</Button>} />}
    {job && <><header><h1 className="text-page-title">{job.title ?? t("web.portal.work.untitled")}</h1><p>{job.reference} · {job.place.alias}</p></header>
      <Card><p>{job.providerName}</p><h2 className="text-section-title">{job.journey.cancelled ? t("web.portal.work.cancelled") : stageLabel(t, job.journey.step)}</h2><JobLine {...line(t, job.journey)} /></Card>
      <Card><div className="space-y-4">
        <div><h2 className="text-label">{t("web.portal.work.quote")}</h2>{job.quote ? <Link to={`/portal/jobs/${encodeURIComponent(id)}/quote/${encodeURIComponent(job.quote.versionId)}`}>{t("web.portal.work.version", { version: job.quote.version })} · {money(locale, job.quote.total.minor, job.quote.total.currency)} · {job.quote.state === "approved" ? t("web.portal.work.approved") : job.quote.state === "declined" ? t("web.portal.work.declined") : job.quote.state === "superseded" ? t("web.portal.work.replaced") : job.quote.state === "withdrawn" ? t("web.portal.work.withdrawn") : t("web.portal.work.current")}</Link> : <p>—</p>}</div>
        <div><h2 className="text-label">{t("web.portal.work.visit")}</h2>{job.nextVisit ? <Link to={`/portal/jobs/${encodeURIComponent(id)}/windows`}><PortalClock at={job.nextVisit.window.startsAt} end={job.nextVisit.window.endsAt} zone={job.siteZone} locale={locale} viewerZone={viewerZone} /></Link> : <p>{t("web.portal.work.noVisit")}</p>}</div>
        <div><h2 className="text-label">{t("web.portal.work.crew")}</h2><p>{job.foremanName ?? t("web.portal.work.noCrew")}</p></div>
      </div></Card>
      {job.history.items.length > 0 && <section className="space-y-3"><h2 className="text-section-title">{t("web.portal.work.history")}</h2>{job.history.items.map((moment) => <Stamp key={`${moment.recordId}-${moment.at}`} kind="system" title={momentLabel(t, moment.kind)} time={<PortalClock at={moment.at} zone={job.siteZone} locale={locale} viewerZone={viewerZone} />} actor={moment.by ? { name: moment.by, role: "" } : undefined} />)}</section>}
      {job.quote && (job.nextStep?.kind === "review_quote" || job.nextStep?.kind === "read_quote") && <ActionLink to={`/portal/jobs/${encodeURIComponent(id)}/quote/${encodeURIComponent(job.quote.versionId)}`}>{t("web.portal.work.reviewQuote")}</ActionLink>}
    </>}
  </Frame>;
}
