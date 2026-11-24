import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Button, Card, Dialog, StatusBanner } from "../../ui";
import { Frame, money, usePortal } from "../now/common";
import { usePendingOperation } from "../session/pending-operation";
import { PendingReceiptNotice } from "../session/pending-receipt";
import { currentVisit, useWindows, WindowTime } from "./common";

export function Windows() {
  const { id = "" } = useParams(); const [search] = useSearchParams(); const { t, locale } = usePortal();
  const { data, setData, schedule, failed, refresh } = useWindows(id); const visit = currentVisit(data, search.get("visit"));
  const [selection, setSelection] = useState<string | null>(null); const [taken, setTaken] = useState(false); const [dialog, setDialog] = useState(false);
  const command = usePendingOperation(`window:${id}`, "POST /windows/:id/confirm", (p: { windowId: string; operationId: string; expectedRevision: number; approvedQuoteVersionId: string | null }) => schedule.confirmVisitWindow(p.windowId, { operationId: p.operationId, expectedRevision: p.expectedRevision, payload: { approvedQuoteVersionId: p.approvedQuoteVersionId } }), value => { setData(old => old ? { ...old, visits: old.visits.map(v => v.id === value.visit.id ? value.visit : v) } : old); setSelection(null); setDialog(false); }, code => { if (["CONFLICT", "STALE_REVISION", "NOT_FOUND"].includes(code)) { setTaken(true); setSelection(null); void refresh(); } }, {
    resourceIds: input => [input.windowId],
    onCommitted: () => { setData(null); setSelection(null); setDialog(false); void refresh(); },
  });
  useEffect(() => { if (command.state === "checking" || command.state === "failed") setDialog(false); }, [command.state]);
  useEffect(() => { if (!taken && visit?.offeredWindows.length === 1 && visit.offeredWindows[0]?.confirmationMode) setSelection(visit.offeredWindows[0].id); }, [visit?.id, visit?.revision, taken]);
  const windows = visit?.offeredWindows ?? []; const selected = windows.find(w => w.id === selection); const booked = visit?.bookedWindow; const busy = command.state === "sending" || command.state === "checking";
  const action = booked ? t("web.portal.schedule.acceptWindow") : t("web.portal.schedule.confirmWindow");
  return <Frame><Link to={`/portal/jobs/${encodeURIComponent(id)}`}>{t("web.portal.work.untitled")}</Link><h1 className="text-page-title">{t("web.portal.schedule.windows")}</h1>
    {failed && <StatusBanner title={t("web.portal.work.failed")} action={<Button onClick={() => void refresh()}>{t("web.portal.work.retry")}</Button>} />}{!data && !failed && <p role="status">{t("web.portal.work.loading")}</p>}
    {taken && <p role="alert">{t("web.portal.schedule.taken")}</p>}{command.state === "checking" && <StatusBanner title={t("web.portal.work.checking")} action={<Button onClick={command.check}>{t("web.portal.work.checkAgain")}</Button>} />}{command.state === "failed" && !taken && <p role="alert">{t("web.portal.work.notRecorded")}</p>}
    <PendingReceiptNotice state={command.state} />
    {data && <><p>{data.job.title} · {data.job.reference}</p>{data.approvedQuote && <p>{t("web.portal.work.approved")} · {t("web.portal.work.version", {version:data.approvedQuote.number})} · {money(locale,data.approvedQuote.totalMinor,data.approvedQuote.currency)}</p>}
    {booked && <Card title={booked.crewAvailability === "no_crew_available" ? t("web.portal.schedule.agreedNoCrew") : t("web.portal.schedule.current")}><WindowTime start={booked.startsAt} end={booked.endsAt} zone={data.siteZone}/></Card>}
    {windows.length ? <><h2 className="text-section-title">{t("web.portal.schedule.proposed")}</h2><p>{t("web.portal.schedule.clockRule")}</p><fieldset className="space-y-3"><legend>{t("web.portal.schedule.choose")}</legend>{[...windows].sort((a,b)=>a.startsAt-b.startsAt).map(w => <label key={w.id} className="flex gap-3 rounded-2xl border p-4"><input type="radio" name="window" checked={selection === w.id} disabled={!w.confirmationMode || busy} onChange={() => {setSelection(w.id);setTaken(false);}}/><WindowTime start={w.startsAt} end={w.endsAt} zone={data.siteZone}/></label>)}</fieldset><p>{t("web.portal.schedule.arrivalNote")}</p><Button disabled={!selected?.confirmationMode || busy} onClick={() => setDialog(true)}>{action}</Button></> : !booked && <Card><p>{t("web.portal.schedule.none")}</p></Card>}
    {booked && <p>{t("web.portal.schedule.keep")}</p>}<p><Link to={`/portal/jobs/${encodeURIComponent(id)}/cancel${visit ? `?visit=${encodeURIComponent(visit.id)}` : ""}`}>{t("web.portal.schedule.manage")}</Link></p>
    <Dialog open={dialog} onOpenChange={setDialog} title={action} closeLabel={t("web.portal.work.close")} footer={<Button disabled={!selected || !visit || busy} onClick={() => { if (selected && visit) command.start({windowId:selected.id, operationId:crypto.randomUUID(),expectedRevision:visit.revision,approvedQuoteVersionId:data.approvedQuote?.id ?? null}); }}>{action}</Button>}><p>{data.job.reference} · {data.job.title}</p>{selected && <WindowTime start={selected.startsAt} end={selected.endsAt} zone={data.siteZone}/>}<p>{t("web.portal.schedule.keep")}</p></Dialog></>}
  </Frame>;
}
