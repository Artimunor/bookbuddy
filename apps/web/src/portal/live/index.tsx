import type { CustomerLiveVisit } from "@bookbuddy/api-contract";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ActionLink, Button, Card, CrewDots, Dock, LiveCapsule, Stamp, StatusBanner } from "../../ui";
import { jobTitle, dayLine, Frame, momentLabel, usePortal, usePortalViewerZone, visitLabels } from "../now/common";
import { useLiveHints } from "../session/live";
import { formatPortalClock, formatPortalTime } from "../time";
import { useScheduleClients } from "../windows/common";
import { AttachmentThumb } from "../media";

export function Live() {
  const { id="" }=useParams();
  const { field }=useScheduleClients(); const { t,locale,jobs }=usePortal(); const [visit,setVisit]=useState<CustomerLiveVisit|null>(null); const [failed,setFailed]=useState(false); const [loading,setLoading]=useState(false); const [generation,setGeneration]=useState(0);
  const load=useCallback(async (visitId:string,signal?:AbortSignal)=>{setLoading(true);const r=await field.getVisitLive(visitId,undefined,signal?{signal}:undefined);if(signal?.aborted)return;setLoading(false);if(r.ok && "moments" in r.data){setVisit(r.data);setFailed(false);}else{setVisit(null);setFailed(true);}},[field]);
  useLiveHints(visit?.job.id === id ? { kind: "customer-visit", opaqueId: visit.visitId } : null, (signal) => { if (visit?.job.id === id) void load(visit.visitId, signal); });
  useEffect(()=>{setVisit(null);setFailed(false);const controller=new AbortController();void jobs.getJob(id,{view:"today"},{signal:controller.signal}).then(r=>{if(controller.signal.aborted)return;if(r.ok && r.data.audience==="customer" && r.data.job.view==="today") void load(r.data.job.visit.visitId,controller.signal); else setFailed(true);});return()=>controller.abort();},[id,jobs,load,generation]);
  async function more(){if(!visit?.page.hasMore || !visit.page.cursor || loading)return;setLoading(true);const r=await field.getVisitLive(visit.visitId,{cursor:visit.page.cursor});setLoading(false);if(r.ok && "moments" in r.data){const page=r.data;setVisit(old=>old?{...old,moments:[...old.moments,...page.moments],page:page.page}:old);}else setFailed(true);}
  const viewer = usePortalViewerZone();
  const clock=(value:number,zone:string)=>formatPortalTime(value,zone,locale,viewer); const live=visit?.live;
  const status = live?.status;
  const labels = visitLabels(t);
  const newest=[...(visit?.moments ?? [])].sort((a,b)=>b.recordedAt-a.recordedAt); const travel=newest.find(x=>x.kind==="on_the_way" || x.kind==="arrival_revised" || x.kind==="arrival_withdrawn" || x.kind==="cover_arranging");
  const expired=!status && (travel?.kind==="on_the_way" || travel?.kind==="arrival_revised") && live?.source?.at===travel.recordedAt ? travel : null; const arrival=live?.arrival?.band ?? expired?.band; const passed=!!arrival && (!!expired || (status==="on_the_way" && Date.now()>arrival.endsAt));
  const label=passed?t("web.portal.schedule.passed"):status?labels[status]:t("web.portal.schedule.quiet"); const source=visit && live?.source ? clock(live.source.at,visit.siteZone)?.site ?? "" : ""; const provenance=live?.source?.sharedByName ? t("web.portal.schedule.shared",{name:live.source.sharedByName,time:source}) : source;
  const band = arrival && (status === "on_the_way" || passed) ? arrival : status === "confirmed" ? visit?.window : null;
  const clocks = band && visit ? formatPortalClock(band.startsAt, visit.siteZone, locale, viewer, band.endsAt, true) ?? undefined : undefined;
  const nextUpdate = visit && live?.nextUpdateAt ? clock(live.nextUpdateAt, visit.siteZone) : null;
  const jobPath = `/portal/jobs/${encodeURIComponent(id)}`;
  const message = visit?.jobThreadId ? `/portal/messages/${encodeURIComponent(visit.jobThreadId)}` : null;
  const completion = status === "finished" ? `${jobPath}/completion` : null;
  const windows = status === "no_crew_available" && visit ? `${jobPath}/windows?visit=${encodeURIComponent(visit.visitId)}` : null;
  return <Frame><Link to={jobPath}>{t("web.portal.closeout.back")}</Link>
    <header className="space-y-1">
      <h1 className="text-page-title">{t("web.portal.schedule.live")}</h1>
      {visit && <p className="text-supporting text-muted" dir="auto">{[jobTitle(t,visit.job.title,visit.job.reference), visit.job.reference, visit.job.placeAlias].filter(Boolean).join(" · ")}</p>}
    </header>
    {failed && <StatusBanner title={t("web.portal.work.failed")} tone="critical" action={<Button onClick={()=>setGeneration(n=>n+1)}>{t("web.portal.work.retry")}</Button>}/>}
    {!visit && !failed && <p role="status">{t("web.portal.work.loading")}</p>}
    {visit && <>
      <LiveCapsule ariaLabel={label} source={visit.providerName} reference={visit.job.reference}
        state={{kind:passed || !status || status==="cover_arranging" || status==="no_crew_available"?"quiet":status==="finished"?"finished":status==="paused"?"paused":"live",label}}
        clocks={clocks} provenance={provenance} stageLine={dayLine(labels, live?.step ?? null, t)} />
      {nextUpdate && <Card><p>{t("web.portal.schedule.updateBy", {time:nextUpdate.site})}</p>{nextUpdate.viewer && <p className="text-supporting text-muted">{nextUpdate.viewer}</p>}</Card>}
      {visit.confirmedCrewNames.length>0 && <Card title={t("web.portal.schedule.crew")}><CrewDots
        people={visit.confirmedCrewNames.map((name,i)=>({id:String(i),name,initials:name.split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase(),role:"",tone:i%2?"d":"b"}))}
        status={status==="on_site"||status==="working"?"on-site":status==="on_the_way"?"on-the-way":status==="cover_arranging"||status==="no_crew_available"?"gap":"confirmed"} statusLabel={label}/></Card>}
      <Card title={t("web.portal.schedule.moments")}>
        <div className="bb-moments" aria-live="polite">
          {newest.map(item => {
            const time = clock(item.recordedAt,visit.siteZone);
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
          {!newest.length && <p className="text-supporting text-muted">{t("web.portal.schedule.noMoments")}</p>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="text" disabled={loading} onClick={()=>void load(visit.visitId)}>{t("web.portal.schedule.refresh")}</Button>
          {visit.page.hasMore && <Button variant="text" disabled={loading} onClick={()=>void more()}>{t("web.portal.schedule.more")}</Button>}
        </div>
      </Card>
      {(completion || windows) && message && <ActionLink variant="text" to={message}>{t("web.portal.work.messages")}</ActionLink>}
      <Dock primary={completion ? {to:completion,label:t("web.portal.closeout.review")} : windows ? {to:windows,label:t("web.portal.schedule.windows")} : message ? {to:message,label:t("web.portal.work.messages")} : {to:`${jobPath}/cancel`,label:t("web.portal.schedule.manage")}}
        secondary={(completion || windows || message) ? {to:`${jobPath}/cancel`,label:t("web.portal.schedule.manage")} : undefined} />
    </>}
  </Frame>;
}
