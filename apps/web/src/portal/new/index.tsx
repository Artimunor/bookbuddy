import { createPlacesClient } from "@bookbuddy/api-client";
import { attachmentIdSchema, operationIdSchema, type PlaceDetails, type PlaceList, type RequestReceipt, type SubmitRequest } from "@bookbuddy/api-contract";
import { looksLikeAccessCode } from "@bookbuddy/domain";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate, useOutletContext } from "react-router";
import { ActionLink, Button, Card, Dialog, Dock, SegmentedControl, Select, TextField } from "../../ui";
import { Frame, usePortal } from "../now/common";
import { takeCheckedOpening } from "../notifications/handoff";
import { usePendingOperation, type PendingOperation } from "../session/pending-operation";
import { formatPortalTime, siteZoneLabel } from "../time";
import { MediaPicker, type SelectedMedia } from "../media";

type Draft = { text: string; place: PlaceDetails | null; arrangement: "nobody" | "requester" | "someone_else"; contact: string; note: string; media: SelectedMedia[]; mediaStage: string };
type Receipt = RequestReceipt | { jobId: string | null };
type Flow = { draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft>>; command: PendingOperation<SubmitRequest>; receipt: Receipt | null };
const requestLocked = (command: Flow["command"]) => command.state === "sending" || command.state === "checking" || command.replacement !== null;
export function RequestLayout() {
  const { bootstrap, activeContext } = usePortal();
  return <RequestScope key={`${bootstrap?.sessionId}:${activeContext?.contextId}`} />;
}
function RequestScope() {
  const [draft,setDraft] = useState<Draft>(() => ({ text:"",place:null,arrangement:"requester",contact:"",note:"",media:[],mediaStage:crypto.randomUUID() }));
  const { jobs } = usePortal();
  const [receipt,setReceipt] = useState<Receipt | null>(null);
  const command = usePendingOperation("submit-request", (body: SubmitRequest) => jobs.submitRequest(body), setReceipt, undefined, {
    includeResource: true, replay: true, placeId: input => input.payload.placeId,
    onCommitted: status => setReceipt({ jobId: status.resource?.kind === "job" ? status.resource.id : null }),
  });
  return <Outlet context={{draft,setDraft,command,receipt} satisfies Flow}/>;
}
export function Describe() {
  const { draft,setDraft,command } = useOutletContext<Flow>(); const { t } = usePortal(); const navigate = useNavigate();
  if (requestLocked(command)) return <Navigate replace to="/portal/new/review" />;
  return <Frame>
    <header className="space-y-1"><p className="text-supporting text-muted">{t("web.portal.ps.requestProgress", { step: 1 })}</p><h1 className="text-page-title">{t("web.portal.ps.describe")}</h1></header>
    <Card><div className="space-y-3">
      <label className="bb-field"><span className="text-label">{t("web.portal.ps.description")}</span><textarea className="bb-input" dir="auto" rows={7} maxLength={16000} value={draft.text} onChange={e=>setDraft({...draft,text:e.target.value})}/></label>
      <p className="text-supporting text-muted">{t("web.portal.ps.anyLanguage")}</p>
      <p className="text-supporting text-muted">{t("web.portal.ps.noCodes")}</p>
    </div></Card>
    <Dock context={t("web.portal.ps.memoryOnly")} primary={{ label: t("web.portal.auth.continue"), disabled: !draft.text.trim(), onClick: () => navigate("/portal/new/place") }} />
  </Frame>;
}
export function RequestPlace() {
  const { draft,setDraft,command } = useOutletContext<Flow>(); const { t,locale,api: portalApi,bootstrap,activeContext } = usePortal(); const navigate = useNavigate(); const location = useLocation();
  const api = useMemo(() => createPlacesClient(portalApi), [portalApi]);
  const [list,setList] = useState<PlaceList | null>(null); const [failed,setFailed] = useState(false); const [loading,setLoading] = useState(false); const [mediaBusy,setMediaBusy] = useState(false);
  const hasPending = requestLocked(command);
  useEffect(()=>{ if (hasPending) return; const c = new AbortController(); void api.listPlaces(undefined,{signal:c.signal}).then(r=>{if(!c.signal.aborted) r.ok ? setList(r.data) : setFailed(true);}); return ()=>c.abort(); },[api, hasPending]);
  useEffect(()=>{ const opening = takeCheckedOpening(location.state,bootstrap?.sessionId,activeContext?.contextId ?? null); if(opening?.kind === "place") setDraft(old=>({...old,place:opening.place,note:"",...(old.place?.id !== opening.place.id ? {media:[], mediaStage:crypto.randomUUID()} : {})})); },[location.state,setDraft,bootstrap?.sessionId,activeContext?.contextId]);
  async function select(id: string) { if(!id) { setDraft({...draft,place:null,media:[],mediaStage:crypto.randomUUID()}); return; } setLoading(true); const r = await api.getPlace(id); setLoading(false); if(r.ok) setDraft({...draft,place:r.data,note:"",...(draft.place?.id !== r.data.id ? {media:[],mediaStage:crypto.randomUUID()} : {})}); else setFailed(true); }
  async function more() { if (!list?.cursor) return; const r = await api.listPlaces({cursor:list.cursor}); if (r.ok) setList({...r.data,places:[...list.places,...r.data.places]}); else setFailed(true); }
  const blocked = looksLikeAccessCode(draft.note); const ready = !!draft.text.trim() && draft.place?.state === "in_area" && !blocked && (draft.arrangement !== "nobody" || !!draft.note.trim()) && (draft.arrangement !== "someone_else" || !!draft.contact.trim());
  if (hasPending) return <Navigate replace to="/portal/new/review" />;
  return <Frame>
    <header className="space-y-1"><p className="text-supporting text-muted">{t("web.portal.ps.requestProgress", { step: 2 })}</p><h1 className="text-page-title">{t("web.portal.ps.placeAccess")}</h1></header>
    {failed && <p role="alert">{t("web.portal.work.failed")}</p>}{!list && !failed && <p role="status">{t("web.portal.work.loading")}</p>}
    <Card><div className="space-y-3">
      {list && <><Select label={t("web.portal.ps.choosePlace")} hint={t("web.portal.ps.chooseVerified")} disabled={loading || mediaBusy} value={draft.place?.id ?? ""} onChange={e=>void select(e.target.value)}>
        <option value="">{t("web.portal.ps.noPlaceSelected")}</option>{list.places.map(p=><option key={p.id} value={p.id}>{p.alias}</option>)}
      </Select>{list.hasMore && <Button variant="secondary" onClick={()=>void more()}>{t("web.portal.work.more")}</Button>}</>}
      {draft.place && <p className="text-supporting text-muted" dir="auto">{[draft.place.address, siteZoneLabel(draft.place.siteZone, locale)].filter(Boolean).join(" · ")}</p>}
      <ActionLink variant="text" to="/portal/new/place/new">{t("web.portal.ps.addPlace")}</ActionLink>
    </div></Card>
    <Card><div className="space-y-4">
      <TextField label={t("web.portal.ps.safeNote")} hint={t("web.portal.ps.noCodes")} value={draft.note} maxLength={500} onChange={e=>setDraft({...draft,note:e.target.value})} error={blocked ? t("web.portal.ps.noCodesError") : undefined}/>
      <SegmentedControl label={t("web.portal.ps.onSite")} value={draft.arrangement} options={[
        {value:"nobody",label:t("web.portal.ps.nobody")}, {value:"requester",label:t("web.portal.ps.me")}, {value:"someone_else",label:t("web.portal.ps.someoneElse")},
      ]} onValueChange={arrangement=>setDraft({...draft,arrangement})} />
      {draft.arrangement === "someone_else" && <TextField label={t("web.portal.ps.contactName")} value={draft.contact} maxLength={100} onChange={e=>setDraft({...draft,contact:e.target.value})}/>}
    </div></Card>
    {draft.place?.state === "in_area" && <MediaPicker key={draft.mediaStage} caller="request" parentScopeId={draft.place.id} stageId={draft.mediaStage} value={draft.media} onChange={media=>setDraft(old=>({...old,media}))} onBusyChange={setMediaBusy}/>}
    <Dock primary={{ label:t("web.portal.ps.review"), disabled:!ready || loading || mediaBusy, onClick:()=>navigate("/portal/new/review") }} />
  </Frame>;
}
export function ReviewRequest() {
  const { draft,setDraft,command,receipt } = useOutletContext<Flow>(); const { t,locale,preferences,api } = usePortal();
  const navigate = useNavigate();
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useRef<AbortController | null>(null);
  useEffect(() => () => refresh.current?.abort(), []);
  const busy = command.state === "sending" || refreshing;
  const checking = command.pending !== null && !command.canResend;
  const reviewPlace = command.pending?.reviewPlace ? command.pending : null;
  const needsPlaceRefresh = !!reviewPlace && (draft.place?.id !== reviewPlace.placeId || draft.place?.revision === reviewPlace.expectedRevision);
  const locked = requestLocked(command);
  const arrangement = draft.arrangement;
  const ready = !needsPlaceRefresh && draft.place?.state === "in_area" && !!draft.text.trim() && !looksLikeAccessCode(draft.note) &&
    (draft.arrangement !== "nobody" || !!draft.note.trim()) && (draft.arrangement !== "someone_else" || !!draft.contact.trim());
  async function refreshPlace() {
    if (!reviewPlace?.placeId || refresh.current) return;
    const controller = new AbortController();
    refresh.current = controller;
    setRefreshing(true);
    setRefreshFailed(false);
    const result = await createPlacesClient(api).getPlace(reviewPlace.placeId, { signal: controller.signal });
    if (controller.signal.aborted) return;
    refresh.current = null;
    setRefreshing(false);
    if (!result.ok || result.data.id !== reviewPlace.placeId || result.data.revision === reviewPlace.expectedRevision) {
      setRefreshFailed(true);
      return;
    }
    setDraft(old => ({
      ...old, place: result.data,
      ...(old.place && old.place.id !== result.data.id ? { note: "", media: [], mediaStage: crypto.randomUUID() } : {}),
    }));
  }
  function send() {
    if (!ready || !draft.place || locked || refresh.current) return;
    const input: SubmitRequest = { operationId:operationIdSchema.parse(command.pending?.operationId ?? crypto.randomUUID()), expectedRevision:draft.place.revision, payload:{placeId:draft.place.id,originalText:draft.text,arrivalArrangement:draft.arrangement,...(draft.media.length ? {attachmentIds:draft.media.map(item=>attachmentIdSchema.parse(item.id))} : {}),...(draft.arrangement === "someone_else" ? {arrivalContactName:draft.contact.trim()} : {}),...(draft.note.trim() ? {safeNote:draft.note.trim()} : {})} };
    if (command.canResend) command.resend(input);
    else command.start(input);
  }
  function startNew() {
    if (locked || refresh.current || !command.discardStale()) return;
    setDraft(old => ({ ...old, place: null, arrangement: "requester", contact: "", note: "", media: [], mediaStage: crypto.randomUUID() }));
    navigate(draft.text.trim() ? "/portal/new/place" : "/portal/new/describe", { replace: true });
  }
  const viewerZone = preferences?.twoClock ? preferences.displayZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const detail = receipt && "siteZone" in receipt ? receipt : null;
  const receiptTime = detail ? formatPortalTime(detail.submittedAt, detail.siteZone, locale, viewerZone) : null;
  return <Frame>{receipt ? <>
    <h1 className="text-page-title">{t("web.portal.ps.requestSent")}</h1>
    <Card><p>{t("web.portal.ps.notBooking")}</p>{detail && <p className="text-supporting text-muted">{[detail.reference, receiptTime?.site].filter(Boolean).join(" · ")}</p>}{receiptTime?.viewer && <p className="text-supporting text-muted">{receiptTime.viewer}</p>}</Card>
    {receipt.jobId && <Dock primary={{ to:`/portal/jobs/${encodeURIComponent(receipt.jobId)}`, label: t("web.portal.ps.openJob") }} />}
  </> : <>
    <header className="space-y-1"><p className="text-supporting text-muted">{t("web.portal.ps.requestProgress", { step: 3 })}</p><h1 className="text-page-title">{t("web.portal.ps.review")}</h1><p className="text-supporting text-muted">{t("web.portal.ps.notBooking")}</p></header>
    {reviewPlace && !busy ? <p role="status">{t("web.portal.ps.requestPlaceChanged")}</p>
      : command.canResend && !busy && <p role="status">{t("web.portal.ps.requestPending")}</p>}
    {(!checking || draft.text) && <Card title={t("web.portal.ps.description")} footer={!locked && <ActionLink variant="text" to="/portal/new/describe">{t("web.portal.ps.edit")}</ActionLink>}><p dir="auto">{draft.text}</p></Card>}
    {(!checking || draft.place) && <Card title={t("web.portal.ps.placeAccess")} footer={!locked && <ActionLink variant="text" to="/portal/new/place">{t("web.portal.ps.edit")}</ActionLink>}>
      {draft.place && <p className="text-label" dir="auto">{[draft.place.alias,draft.place.address].filter(Boolean).join(" · ")}</p>}
      {reviewPlace && draft.place?.siteZone && <p className="text-supporting text-muted">{siteZoneLabel(draft.place.siteZone, locale)}</p>}
      {draft.note && <p dir="auto">{draft.note}</p>}
      <p className="text-supporting text-muted">{arrangement === "nobody" ? t("web.portal.ps.nobody") : arrangement === "requester" ? t("web.portal.ps.me") : [t("web.portal.ps.someoneElse"),draft.contact].filter(Boolean).join(" · ")}</p>
    </Card>}
    {(command.state === "failed" || (needsPlaceRefresh && refreshFailed)) && <p role="alert">{t("web.portal.work.failed")}</p>}
    {checking && <p role="status">{t("web.portal.ps.requestChecking")}</p>}
    <Dock context={t("web.portal.ps.noPayment")} primary={{
      label: checking ? t("web.portal.work.checkAgain") : needsPlaceRefresh ? t("web.portal.ps.requestReviewPlace") : command.canResend ? t("web.portal.ps.requestSendAgain") : t("web.portal.ps.sendRequest"),
      pending:busy, disabled:busy || (!checking && !needsPlaceRefresh && !ready),
      onClick:checking ? command.check : needsPlaceRefresh ? () => void refreshPlace() : send,
    }} secondary={busy ? undefined : reviewPlace ? { label:t("web.portal.ps.requestStartNew"), onClick:startNew }
      : command.canResend ? { label:t("web.portal.work.checkAgain"), onClick:command.check } : undefined} />
    <Dialog open={command.replacement !== null} onOpenChange={open=>{if(!open) command.replacement?.dismiss();}} title={t("web.portal.ps.requestSendChanged")} description={t("web.portal.ps.requestSendChangedDetail")} closeLabel={t("web.portal.work.close")}>
      <Button onClick={command.replacement?.confirm}>{t("web.portal.ps.confirm")}</Button>
    </Dialog>
  </>}</Frame>;
}
