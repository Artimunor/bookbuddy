import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Button, Card, Dialog, StatusBanner } from "../../ui";
import { Frame, usePortal } from "../now/common";
import { usePendingOperation } from "../session/pending-operation";
import { currentVisit, useWindows, WindowTime } from "../windows/common";

type Operation = { kind: "cancel" | "request"; visitId: string; operationId: string; expectedRevision: number; bookedWindowId: string | null; requestId: string };
export function Cancel() {
  const { id = "" } = useParams(); const [search] = useSearchParams(); const { t } = usePortal(); const { data, setData, schedule, failed, refresh } = useWindows(id);
  const visit = currentVisit(data, search.get("visit")); const [choice, setChoice] = useState<"reschedule" | "cancel">("reschedule"); const [dialog,setDialog] = useState(false);
  const command = usePendingOperation(`manage:${id}`, (p: Operation) => p.kind === "cancel" ? "POST /visits/:id/cancel" : "POST /visits/:id/request-reschedule", p => p.kind === "cancel" && p.bookedWindowId ? schedule.cancelVisit(p.visitId, {operationId:p.operationId, expectedRevision:p.expectedRevision, payload:{bookedWindowId:p.bookedWindowId}}) : schedule.requestVisitReschedule(p.visitId, {operationId:p.operationId, expectedRevision:p.expectedRevision, payload:{id:p.requestId,bookedWindowId:p.bookedWindowId}}), value => {setData(old => old ? {...old,visits:old.visits.map(v=>v.id===value.visit.id ? value.visit : v)} : old);setDialog(false);}, () => {void refresh();});
  useEffect(() => { if (command.state === "checking" || command.state === "failed") setDialog(false); }, [command.state]);
  const busy = command.state === "sending" || command.state === "checking"; const alternatives = !!visit?.offeredWindows.some(w=>w.confirmationMode); const requested = visit?.rescheduleRequest?.state === "requested"; const cancelled = visit?.state === "cancelled";
  function send(kind: Operation["kind"]) { if (!visit || busy || (kind === "cancel" && !visit.bookedWindow)) return; command.start({kind,visitId:visit.id,operationId:crypto.randomUUID(),expectedRevision:visit.revision,bookedWindowId:visit.bookedWindow?.id ?? null,requestId:crypto.randomUUID()}); }
  return <Frame><Link to={`/portal/jobs/${encodeURIComponent(id)}`}>{t("web.portal.work.untitled")}</Link><h1 className="text-page-title">{t("web.portal.schedule.manage")}</h1>
    {failed && <StatusBanner title={t("web.portal.work.failed")} action={<Button onClick={()=>void refresh()}>{t("web.portal.work.retry")}</Button>}/>} {!data && !failed && <p role="status">{t("web.portal.work.loading")}</p>}
    {command.state === "checking" && <StatusBanner title={t("web.portal.work.checking")} action={<Button onClick={command.check}>{t("web.portal.work.checkAgain")}</Button>}/>} {command.state === "failed" && <p role="alert">{t("web.portal.work.notRecorded")}</p>}
    {data && <><p>{data.job.title} · {data.job.reference}</p>{visit?.bookedWindow && <Card title={t("web.portal.schedule.current")}><WindowTime start={visit.bookedWindow.startsAt} end={visit.bookedWindow.endsAt} zone={data.siteZone}/></Card>}{visit?.actions.canCancelFeeFree && <p>{t("web.portal.schedule.noFee")}</p>}
    {requested && <p role="status">{t("web.portal.schedule.requested")}</p>}{cancelled && <p role="status">{t("web.portal.work.cancelled")}</p>}
    {!requested && !cancelled && visit && <><fieldset className="space-y-3"><legend>{t("web.portal.schedule.manage")}</legend><label className="flex gap-3 rounded-2xl border p-4"><input type="radio" name="management" checked={choice === "reschedule"} onChange={()=>setChoice("reschedule")}/><span>{t("web.portal.schedule.reschedule")}<br/>{t("web.portal.schedule.keep")}</span></label><label className="flex gap-3 rounded-2xl border p-4"><input type="radio" name="management" checked={choice === "cancel"} onChange={()=>setChoice("cancel")}/><span>{t("web.portal.schedule.cancel")}<br/>{t("web.portal.schedule.cancelEffect")}</span></label></fieldset>
    {choice === "reschedule" ? alternatives ? <Link to={`/portal/jobs/${encodeURIComponent(id)}/windows?visit=${encodeURIComponent(visit.id)}`}>{t("web.portal.schedule.choose")}</Link> : <Button disabled={!visit.actions.canRequestReschedule || busy} onClick={()=>send("request")}>{t("web.portal.schedule.request")}</Button> : <Button disabled={!visit.actions.canCancelFeeFree || !visit.bookedWindow || busy} onClick={()=>setDialog(true)}>{t("web.portal.schedule.cancel")}</Button>}</>}
    {data.withdrawalQuoteVersionId && <p><Link to={`/portal/jobs/${encodeURIComponent(id)}/withdrawal`}>{t("web.portal.schedule.withdrawal")}</Link></p>}
    <Dialog open={dialog} onOpenChange={setDialog} title={t("web.portal.schedule.cancel")} closeLabel={t("web.portal.work.close")} footer={<Button disabled={busy} onClick={()=>send("cancel")}>{t("web.portal.schedule.cancel")}</Button>}><p>{data.job.title} · {data.job.reference}</p><p>{t("web.portal.schedule.cancelEffect")}</p></Dialog></>}
  </Frame>;
}
