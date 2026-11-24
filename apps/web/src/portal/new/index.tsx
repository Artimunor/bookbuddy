import { createPlacesClient } from "@bookbuddy/api-client";
import { attachmentIdSchema, operationIdSchema, type PlaceDetails, type PlaceList, type RequestReceipt, type SubmitRequest } from "@bookbuddy/api-contract";
import { looksLikeAccessCode } from "@bookbuddy/domain";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate, useOutletContext } from "react-router";
import { Button, TextField } from "../../ui";
import { Frame, usePortal } from "../now/common";
import { takeCheckedOpening } from "../notifications/handoff";
import { usePendingOperation, type PendingOperation } from "../session/pending-operation";
import { PendingReceiptNotice } from "../session/pending-receipt";
import { formatPortalTime } from "../time";
import { MediaPicker, type SelectedMedia } from "../media";

type Draft = { text: string; place: PlaceDetails | null; arrangement: "nobody" | "requester" | "someone_else"; contact: string; note: string; media: SelectedMedia[]; mediaStage: string };
type Receipt = RequestReceipt | { jobId: string | null };
type Flow = { draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft>>; command: PendingOperation<SubmitRequest>; receipt: Receipt | null };
export function RequestLayout() {
  const { bootstrap, activeContext } = usePortal();
  return <RequestScope key={`${bootstrap?.sessionId}:${activeContext?.contextId}`} />;
}
function RequestScope() {
  const [draft,setDraft] = useState<Draft>(() => ({ text:"",place:null,arrangement:"requester",contact:"",note:"",media:[],mediaStage:crypto.randomUUID() }));
  const { jobs } = usePortal();
  const [receipt,setReceipt] = useState<Receipt | null>(null);
  const command = usePendingOperation("submit-request", "POST /requests", (body: SubmitRequest) => jobs.submitRequest(body), setReceipt, undefined, {
    includeResource: true, resourceIds: input => [input.payload.placeId],
    onCommitted: status => setReceipt({ jobId: status.resource?.kind === "job" ? status.resource.id : null }),
  });
  return <Outlet context={{draft,setDraft,command,receipt} satisfies Flow}/>;
}
export function Describe() {
  const { draft,setDraft,command } = useOutletContext<Flow>(); const { t } = usePortal();
  if (command.pending) return <Navigate replace to="/portal/new/review" />;
  return <Frame><h1 className="text-page-title">{t("web.portal.ps.describe")}</h1><p>{t("web.portal.ps.anyLanguage")}</p><label className="block">{t("web.portal.ps.description")}<textarea className="block w-full rounded-lg border p-3" dir="auto" rows={7} maxLength={16000} value={draft.text} onChange={e=>setDraft({...draft,text:e.target.value})}/></label><p>{t("web.portal.ps.noCodes")}</p><p>{t("web.portal.ps.memoryOnly")}</p><Link aria-disabled={!draft.text.trim()} onClick={e=>{if(!draft.text.trim()) e.preventDefault();}} to="/portal/new/place">{t("web.portal.auth.continue")}</Link></Frame>;
}
export function RequestPlace() {
  const { draft,setDraft,command } = useOutletContext<Flow>(); const { t,api: portalApi,bootstrap,activeContext } = usePortal(); const navigate = useNavigate(); const location = useLocation();
  const api = useMemo(() => createPlacesClient(portalApi), [portalApi]);
  const [list,setList] = useState<PlaceList | null>(null); const [failed,setFailed] = useState(false); const [loading,setLoading] = useState(false); const [mediaBusy,setMediaBusy] = useState(false);
  const hasPending = !!command.pending;
  useEffect(()=>{ if (hasPending) return; const c = new AbortController(); void api.listPlaces(undefined,{signal:c.signal}).then(r=>{if(!c.signal.aborted) r.ok ? setList(r.data) : setFailed(true);}); return ()=>c.abort(); },[api, hasPending]);
  useEffect(()=>{ const opening = takeCheckedOpening(location.state,bootstrap?.sessionId,activeContext?.contextId ?? null); if(opening?.kind === "place") setDraft(old=>({...old,place:opening.place,note:"",...(old.place?.id !== opening.place.id ? {media:[], mediaStage:crypto.randomUUID()} : {})})); },[location.state,setDraft,bootstrap?.sessionId,activeContext?.contextId]);
  async function select(id: string) { if(!id) { setDraft({...draft,place:null,media:[],mediaStage:crypto.randomUUID()}); return; } setLoading(true); const r = await api.getPlace(id); setLoading(false); if(r.ok) setDraft({...draft,place:r.data,note:"",...(draft.place?.id !== r.data.id ? {media:[],mediaStage:crypto.randomUUID()} : {})}); else setFailed(true); }
  async function more() { if (!list?.cursor) return; const r = await api.listPlaces({cursor:list.cursor}); if (r.ok) setList({...r.data,places:[...list.places,...r.data.places]}); else setFailed(true); }
  const blocked = looksLikeAccessCode(draft.note); const ready = !!draft.text.trim() && draft.place?.state === "in_area" && !blocked && (draft.arrangement !== "nobody" || !!draft.note.trim()) && (draft.arrangement !== "someone_else" || !!draft.contact.trim());
  if (hasPending) return <Navigate replace to="/portal/new/review" />;
  return <Frame><h1 className="text-page-title">{t("web.portal.ps.placeAccess")}</h1>{failed && <p role="alert">{t("web.portal.work.failed")}</p>}{!list && !failed && <p role="status">{t("web.portal.work.loading")}</p>}
    {list && <><label>{t("web.portal.ps.choosePlace")} <select disabled={loading || mediaBusy} value={draft.place?.id ?? ""} onChange={e=>void select(e.target.value)}><option value="">{t("web.portal.ps.choosePlace")}</option>{list.places.map(p=><option key={p.id} value={p.id}>{p.alias}</option>)}</select></label>{list.hasMore && <Button onClick={()=>void more()}>{t("web.portal.work.more")}</Button>}</>}
    {draft.place && <div><p>{draft.place.address}</p><p>{draft.place.siteZone}</p></div>}<p>{t("web.portal.ps.chooseVerified")}</p><Link to="/portal/new/place/new">{t("web.portal.ps.addPlace")}</Link>
    <TextField label={t("web.portal.ps.safeNote")} value={draft.note} maxLength={500} onChange={e=>setDraft({...draft,note:e.target.value})} error={blocked ? t("web.portal.ps.noCodesError") : undefined}/><p>{t("web.portal.ps.noCodes")}</p>
    <fieldset><legend>{t("web.portal.ps.onSite")}</legend>{(["nobody","requester","someone_else"] as const).map(a=><label key={a} className="block"><input type="radio" name="arrival" checked={draft.arrangement===a} onChange={()=>setDraft({...draft,arrangement:a})}/>{a === "nobody" ? t("web.portal.ps.nobody") : a === "requester" ? t("web.portal.ps.me") : t("web.portal.ps.someoneElse")}</label>)}</fieldset>{draft.arrangement === "someone_else" && <TextField label={t("web.portal.ps.contactName")} value={draft.contact} maxLength={100} onChange={e=>setDraft({...draft,contact:e.target.value})}/>}
    {draft.place?.state === "in_area" && <MediaPicker key={draft.mediaStage} caller="request" parentScopeId={draft.place.id} stageId={draft.mediaStage} value={draft.media} onChange={media=>setDraft(old=>({...old,media}))} onBusyChange={setMediaBusy}/>}
    <Button disabled={!ready || loading || mediaBusy} onClick={()=>navigate("/portal/new/review")}>{t("web.portal.ps.review")}</Button></Frame>;
}
export function ReviewRequest() {
  const { draft,command,receipt } = useOutletContext<Flow>(); const { t,locale,preferences } = usePortal();
  const checking = command.state === "checking";
  const busy = command.state === "sending";
  const pending = command.pending !== null;
  const arrangement = draft.arrangement;
  const ready = draft.place?.state === "in_area" && !!draft.text.trim() && !looksLikeAccessCode(draft.note) &&
    (draft.arrangement !== "nobody" || !!draft.note.trim()) && (draft.arrangement !== "someone_else" || !!draft.contact.trim());
  function send() {
    if (!ready || !draft.place) return;
    command.start({ operationId:operationIdSchema.parse(crypto.randomUUID()), expectedRevision:draft.place.revision, payload:{placeId:draft.place.id,originalText:draft.text,arrivalArrangement:draft.arrangement,...(draft.media.length ? {attachmentIds:draft.media.map(item=>attachmentIdSchema.parse(item.id))} : {}),...(draft.arrangement === "someone_else" ? {arrivalContactName:draft.contact.trim()} : {}),...(draft.note.trim() ? {safeNote:draft.note.trim()} : {})} });
  }
  const viewerZone = preferences?.twoClock ? preferences.displayZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const detail = receipt && "siteZone" in receipt ? receipt : null;
  const receiptTime = detail ? formatPortalTime(detail.submittedAt, detail.siteZone, locale, viewerZone) : null;
  return <Frame>{receipt ? <><h1 className="text-page-title">{t("web.portal.ps.requestSent")}</h1><p>{t("web.portal.ps.notBooking")}</p>{detail && <p>{detail.reference} · {receiptTime?.site ?? "—"}</p>}{receiptTime?.viewer && <p>{receiptTime.viewer}</p>}{receipt.jobId && <Link to={`/portal/jobs/${encodeURIComponent(receipt.jobId)}`}>{t("web.portal.ps.openJob")}</Link>}</> : <>
    <h1 className="text-page-title">{t("web.portal.ps.review")}</h1><p>{t("web.portal.ps.notBooking")}</p>
    <PendingReceiptNotice state={command.state} />
    {(!pending || draft.text) && <section><h2>{t("web.portal.ps.description")}</h2><p dir="auto">{draft.text}</p>{!pending && <Link to="/portal/new/describe">{t("web.portal.ps.edit")}</Link>}</section>}
    {(!pending || draft.place) && <section><h2>{t("web.portal.ps.placeAccess")}</h2>{draft.place && <p>{draft.place.alias} · {draft.place.address}</p>}<p dir="auto">{draft.note}</p><p>{arrangement === "nobody" ? t("web.portal.ps.nobody") : arrangement === "requester" ? t("web.portal.ps.me") : `${t("web.portal.ps.someoneElse")} · ${draft.contact}`}</p>{!pending && <Link to="/portal/new/place">{t("web.portal.ps.edit")}</Link>}</section>}
    <p>{t("web.portal.ps.noPayment")}</p>{command.state === "failed" && <p role="alert">{t("web.portal.work.failed")}</p>}{checking && <p role="status">{t("web.portal.ps.requestChecking")}</p>}
    <Button pending={busy} disabled={busy || (!checking && !ready)} onClick={checking ? command.check : send}>{checking ? t("web.portal.work.checkAgain") : t("web.portal.ps.sendRequest")}</Button></>}</Frame>;
}
