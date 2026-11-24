import { createAccessClient, createApiClient, listNotifications, markNotificationsRead } from "@bookbuddy/api-client";
import type { LinkOpening, NotificationProjection } from "@bookbuddy/api-contract";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Button } from "../../ui";
import { Frame, usePortal } from "../now/common";
import { authClient } from "../session";
import { storeCheckedOpening } from "./handoff";

export function Notifications() {
  const { locale,activeContext,t } = usePortal();
  const api = useMemo(()=>createApiClient({baseUrl:"/api/v1",getSession:()=>null,getLocale:()=>locale}),[locale]);
  const [items,setItems] = useState<NotificationProjection[] | null>(null); const [cursor,setCursor] = useState<string | null>(null); const [failed,setFailed] = useState(false); const [busy,setBusy] = useState(false);
  const contextId = activeContext?.contextId;
  useEffect(()=>{ if(!contextId) { setFailed(true); return; } const c = new AbortController(); setItems(null); setFailed(false); void listNotifications(api,{contextId},{signal:c.signal}).then(r=>{ if(!c.signal.aborted) { if(r.ok) {setItems(r.data.items); setCursor(r.data.page.cursor);} else setFailed(true); }}); return ()=>c.abort(); },[api,contextId]);
  async function more() { if(!contextId || !cursor || busy) return; setBusy(true); const r = await listNotifications(api,{contextId,cursor}); setBusy(false); if(r.ok) {setItems(old=>[...(old ?? []),...r.data.items]); setCursor(r.data.page.cursor);} else setFailed(true); }
  async function markAll() { if(!contextId || !items?.length || busy) return; const first = items[0]!; setBusy(true); const r = await markNotificationsRead(api,{contextId,operationId:crypto.randomUUID(),payload:{mode:"all",through:{createdAt:first.createdAt,id:first.id}}}); setBusy(false); if(r.ok && r.data.status !== "rejected") setItems(items.map(item=>({...item,readAt:item.readAt ?? Date.now()}))); else setFailed(true); }
  return <Frame><h1 className="text-page-title">{t("web.portal.ps.notifications")}</h1>{failed && <p role="alert">{t("web.portal.work.failed")}</p>}{!items && !failed && <p role="status">{t("web.portal.work.loading")}</p>}{items && <>{items.length ? <><Button disabled={busy || !items.some(i=>!i.readAt)} onClick={()=>void markAll()}>{t("web.portal.ps.markAll")}</Button>{items.map(item=><article key={item.id} className="rounded-2xl border p-4">{item.linkToken ? <Link to={`/l/${encodeURIComponent(item.linkToken)}`} state={{notificationId:item.id,contextId}}>{t("web.portal.ps.notification")}</Link> : <span>{t("web.portal.ps.notification")}</span>}<p><time dateTime={new Date(item.createdAt).toISOString()}>{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(item.createdAt)}</time>{!item.readAt && ` · ${t("web.portal.ps.unread")}`}</p></article>)}</> : <p>{t("web.portal.ps.noNotifications")}</p>}{cursor && <Button disabled={busy} onClick={()=>void more()}>{t("web.portal.work.more")}</Button>}</>}</Frame>;
}
export function LinkResolver() {
  const { opaque = "" } = useParams(); const { locale,activeContext,acceptBootstrap,bootstrap,t } = usePortal(); const navigate = useNavigate(); const location = useLocation();
  const api = useMemo(()=>createApiClient({baseUrl:"/api/v1",getSession:()=>null,getLocale:()=>locale}),[locale]);
  const [status,setStatus] = useState<"loading" | "unavailable" | "native" | "expired" | "wrongAccount" | "choose">("loading");
  const [choices,setChoices] = useState<Extract<LinkOpening,{kind:"switch_context"}>["choices"]>([]);
  const [switching,setSwitching] = useState(false); const [switchError,setSwitchError] = useState(false);
  const [generation,setGeneration] = useState(0);
  const pendingSwitch = useRef<{operationId:string; contextId:string} | null>(null);
  useEffect(()=>{ const c = new AbortController(); setStatus("loading"); void createAccessClient(api).openLink(opaque,{signal:c.signal}).then(r=>{
    if(c.signal.aborted) return; if(!r.ok || r.data.kind === "unavailable") {setStatus("unavailable"); return;}
    if(r.data.kind === "invitation" && r.data.invitation.status === "unavailable") { setStatus(r.data.invitation.reason === "expired" ? "expired" : r.data.invitation.reason === "wrong_account" ? "wrongAccount" : "unavailable"); return; }
    if(r.data.kind === "switch_context") { const available = r.data.choices.filter(choice=>choice.scope.role === "customer"); if(available.length) { setChoices(available); setStatus("choose"); return; } }
    const opening = r.data; let destination: string | null = null;
    if(opening.kind === "place") destination = `/portal/places/${encodeURIComponent(opening.place.id)}`;
    else if(opening.kind === "job" && opening.record.audience === "customer" && opening.record.job.view === "whole") destination = `/portal/jobs/${encodeURIComponent(opening.record.job.jobId)}`;
    else if(opening.kind === "thread") {
      if(opening.audience === "crew") { setStatus("native"); return; }
      destination = `/portal/messages/${encodeURIComponent(opening.threadId)}`;
    }
    else if(opening.kind === "invitation" && opening.invitation.status !== "unavailable") destination = `/portal/invite/${encodeURIComponent(opening.invitation.id)}`;
    else if(opening.kind === "completion" && opening.completion.audience === "customer") destination = `/portal/jobs/${encodeURIComponent(opening.completion.job.jobId)}/completion`;
    else if(opening.kind === "bill" && opening.bill.audience === "customer") destination = `/portal/jobs/${encodeURIComponent(opening.bill.job.jobId)}/bill`;
    else if(opening.kind === "problem_case" && opening.case.audience === "reporter" && activeContext?.role === "customer") destination = `/portal/jobs/${encodeURIComponent(opening.case.job.jobId)}/cases/${encodeURIComponent(opening.case.receipt.id)}`;
    if(!destination) {setStatus(opening.kind === "cover" || opening.kind === "assignment_offer" || opening.kind === "crew_availability" || opening.kind === "business_overview" || opening.kind === "business_member" || opening.kind === "business_eligibility" || opening.kind === "completion" && opening.completion.audience !== "customer" || opening.kind === "bill" && opening.bill.audience !== "customer" || opening.kind === "problem_case" && activeContext?.role !== "customer" || opening.kind === "switch_context" && opening.choices.every(choice=>choice.scope.role !== "customer") ? "native" : "unavailable"); return;}
    const state = location.state as { notificationId?: unknown; contextId?: unknown } | null;
    if(activeContext && typeof state?.notificationId === "string" && state.contextId === activeContext.contextId) void markNotificationsRead(api,{contextId:activeContext.contextId,operationId:crypto.randomUUID(),payload:{mode:"ids",ids:[state.notificationId]}});
    const checkedNonce = bootstrap && opening.kind !== "thread" ? storeCheckedOpening(opening, bootstrap.sessionId, activeContext?.contextId ?? null) : null;
    navigate(destination,{replace:true,state:{checkedNonce}});
  }); return ()=>c.abort(); },[api,opaque,navigate,location.state,activeContext?.contextId,bootstrap?.sessionId,generation]);
  async function switchContext(contextId:string) { if(switching) return; const command = pendingSwitch.current ?? {operationId:crypto.randomUUID(),contextId}; if (pendingSwitch.current && pendingSwitch.current.contextId !== contextId) return; setSwitching(true); setSwitchError(false); const result = await authClient.switchContext({operationId:command.operationId,payload:{contextId:command.contextId}}); setSwitching(false); if(result.ok) {pendingSwitch.current = null; setStatus("loading"); acceptBootstrap(result.data); setGeneration(value=>value+1);} else {setSwitchError(true); if(result.error.code === "NETWORK_ERROR" || result.error.code === "INVALID_RESPONSE" || result.error.code === "INTERNAL_ERROR") pendingSwitch.current = command; else pendingSwitch.current = null;} }
  return <Frame>{status === "loading" ? <p role="status">{t("web.portal.work.loading")}</p> : status === "choose" ? <><h1>{t("web.portal.ps.switchRole")}</h1><p>{t("web.portal.ps.switchRoleHint")}</p>{choices.map(choice=><Button key={choice.scope.contextId} disabled={switching || !!pendingSwitch.current && pendingSwitch.current.contextId !== choice.scope.contextId} onClick={()=>void switchContext(choice.scope.contextId)}>{t("web.portal.ps.customerRole")}</Button>)}{switchError && <p role="alert">{pendingSwitch.current ? t("web.portal.auth.uncertain") : t("web.portal.work.failed")}</p>}</> : <p role="alert">{status === "native" ? t("web.portal.ps.nativeOnly") : status === "expired" ? t("web.portal.ps.invitationExpired") : status === "wrongAccount" ? t("web.portal.ps.invitationWrongAccount") : t("web.portal.ps.linkUnavailable")}</p>}</Frame>;
}
