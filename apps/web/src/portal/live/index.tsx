import { idSchema } from "@bookbuddy/api-contract";
import { Link, useParams, useSearchParams } from "react-router";
import { ActionLink, Button, Card, Dock, Stamp, StatusBanner } from "../../ui";
import { jobTitle, Frame, momentLabel, usePortal, usePortalViewerZone } from "../now/common";
import { useSession } from "../session";
import { useLiveHints } from "../session/live";
import { formatPortalTime } from "../time";
import { AttachmentThumb } from "../media";
import { useLiveVisitRead } from "./read";
import { VisitStatus } from "./status";

export function Live() {
  const { id = "" } = useParams();
  const [search] = useSearchParams();
  const visitId = idSchema.safeParse(search.get("visit")).data ?? null;
  const { bootstrap, activeContext } = useSession();
  return <LiveVisit key={JSON.stringify([id, visitId, bootstrap?.sessionId, activeContext?.contextId])} id={id} visitId={visitId} />;
}

function LiveVisit({ id, visitId }: { id: string; visitId: string | null }) {
  const { t, locale, api } = usePortal();
  const [{ visit, failed, loading, canSubscribe }, read] = useLiveVisitRead(api, id, visitId);
  useLiveHints(visitId && canSubscribe ? { kind: "customer-visit", opaqueId: visitId } : null, read.hint, read.reauthorize);
  const viewer = usePortalViewerZone();
  const status = visit?.live.status;
  const jobPath = `/portal/jobs/${encodeURIComponent(id)}`;
  const message = visit?.jobThreadId ? `/portal/messages/${encodeURIComponent(visit.jobThreadId)}` : null;
  const completion = status === "finished" ? `${jobPath}/completion` : null;
  const windows = status === "no_crew_available" && visit ? `${jobPath}/windows?visit=${encodeURIComponent(visit.visitId)}` : null;
  return <Frame><Link to={jobPath}>{t("web.portal.closeout.back")}</Link>
    <header className="space-y-1">
      <h1 className="text-page-title">{t("web.portal.schedule.live")}</h1>
      {visit && <p className="text-supporting text-muted" dir="auto">{[jobTitle(t,visit.job.title,visit.job.reference), visit.job.reference, visit.job.placeAlias].filter(Boolean).join(" · ")}</p>}
    </header>
    {(failed || !visitId) && <StatusBanner title={t("web.portal.work.failed")} tone="critical"
      action={visitId && <Button disabled={loading} onClick={() => void read.load()}>{t("web.portal.work.retry")}</Button>} />}
    {visitId && !visit && !failed && <p role="status">{t("web.portal.work.loading")}</p>}
    {visit && <>
      <VisitStatus visit={visit} t={t} locale={locale} viewer={viewer} />
      <Card title={t("web.portal.schedule.moments")}>
        <div className="bb-moments" aria-live="polite">
          {visit.moments.map(item => {
            const time = formatPortalTime(item.recordedAt, visit.siteZone, locale, viewer);
            return <div key={item.id}>
              <Stamp kind={item.kind==="photo"?"photo":item.kind==="on_site"?"attendance":"crew"} title={momentLabel(t,item.kind)}
                time={time && <><p className="text-supporting text-muted">{time.site}</p>{time.viewer && <p className="text-supporting text-muted">{time.viewer}</p>}</>}
                {...("sharedByName" in item?{actor:{name:item.sharedByName,role:""}}:{})}/>
              {item.kind === "photo" && <>
                <AttachmentThumb caller="update" parentScopeId={item.id} attachments={[{ attachmentId:item.photo.attachmentId, available:item.photo.availability==="available", photo:true, caption:item.caption?.original.text }]} />
                {item.caption && <div>{item.caption.reading?.status==="ready" && <p lang={item.caption.reading.language} dir="auto">{item.caption.reading.text}</p>}<p lang={item.caption.original.language} dir="auto">{item.caption.original.text}</p></div>}
              </>}
            </div>;
          })}
          {!visit.moments.length && <p className="text-supporting text-muted">{t("web.portal.schedule.noMoments")}</p>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="text" disabled={loading} onClick={() => void read.load()}>{t("web.portal.schedule.refresh")}</Button>
          {visit.page.hasMore && visit.page.cursor && <Button variant="text" disabled={loading} onClick={() => void read.load(visit.page.cursor ?? undefined)}>{t("web.portal.schedule.more")}</Button>}
        </div>
      </Card>
      {(completion || windows) && message && <ActionLink variant="text" to={message}>{t("web.portal.work.messages")}</ActionLink>}
      <Dock primary={completion ? {to:completion,label:t("web.portal.closeout.review")} : windows ? {to:windows,label:t("web.portal.schedule.windows")} : message ? {to:message,label:t("web.portal.work.messages")} : {to:`${jobPath}/cancel`,label:t("web.portal.schedule.manage")}}
        secondary={(completion || windows || message) ? {to:`${jobPath}/cancel`,label:t("web.portal.schedule.manage")} : undefined} />
    </>}
  </Frame>;
}
