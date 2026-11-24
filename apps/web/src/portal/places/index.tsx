import { createAccessClient, createPlacesClient, type ApiResult } from "@bookbuddy/api-client";
import type { PlaceDetails, PlaceList, PlacePersonPatch } from "@bookbuddy/api-contract";
import { looksLikeAccessCode } from "@bookbuddy/domain";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Button, Card, Dialog, Dock, Glyph, Select, TextField } from "../../ui";
import { Frame, stageLabel, usePortal } from "../now/common";
import { storeCheckedOpening, takeCheckedOpening } from "../notifications/handoff";
import { usePendingOperation } from "../session/pending-operation";
import { PendingReceiptNotice } from "../session/pending-receipt";
import { formatPortalTime, siteZoneLabel } from "../time";
import { PlacePersonDialog } from "./people";
import { placeSearch } from "./search";

function usePlaces() {
  const { api } = usePortal();
  return useMemo(() => createPlacesClient(api), [api]);
}
export function Places() {
  const { t, locale } = usePortal(); const api = usePlaces();
  const [query, setQuery] = useState(() => placeSearch.query);
  const location = useLocation(); const navigate = useNavigate();
  useEffect(() => {
    // Replace an old bookmark/current history entry without carrying its filter forward.
    if (new URLSearchParams(location.search).has("q")) navigate(location.pathname, { replace: true });
  }, [location.pathname, location.search, navigate]);
  const [page, setPage] = useState<PlaceList | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => { const controller = new AbortController(); setPage(null); setFailed(false);
    const timer = window.setTimeout(() => { void api.listPlaces(query.trim() ? { q: query.trim() } : undefined, { signal: controller.signal }).then(r => { if (!controller.signal.aborted) r.ok ? setPage(r.data) : setFailed(true); }); }, query ? 300 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); }; }, [api,query]);
  const shown = page?.places.slice().sort((a,b) => b.liveBookingCount - a.liveBookingCount || b.openBookingCount - a.openBookingCount || a.alias.localeCompare(b.alias));
  async function more() { if (!page?.cursor) return; const r = await api.listPlaces({ cursor: page.cursor, ...(query.trim() ? {q:query.trim()} : {}) }); if (r.ok) setPage({ ...r.data, places: [...page.places, ...r.data.places] }); else setFailed(true); }
  return <Frame current="places"><h1 className="text-page-title">{t("web.portal.work.places")}</h1><TextField label={t("web.portal.ps.search")} value={query} onChange={e => { placeSearch.query = e.target.value; setQuery(placeSearch.query); }}/>
    {failed && <p role="alert">{t("web.portal.work.failed")}</p>}{!page && !failed && <p role="status">{t("web.portal.work.loading")}</p>}
    {page && <>
      <p className="text-supporting text-muted">{t("web.portal.ps.placeCount", { count: page.total })}</p>
      {shown?.length ? <ul className="space-y-3">{shown.map(p => <li key={p.id}>
        <Link className="bb-card bb-booking-card" to={`/portal/places/${encodeURIComponent(p.id)}`}>
          <div className="bb-card-heading"><div><h2 className="text-section-title" dir="auto">{p.alias}</h2><p className="text-supporting text-muted">{[p.areaName,siteZoneLabel(p.siteZone,locale)].filter(Boolean).join(" · ")}</p></div><Glyph name="chevron" /></div>
          <p>{p.relationship === "manager" && p.ownerDisplayName ? t("web.portal.ps.managedFor", { name: p.ownerDisplayName }) : p.relationship === "owner" ? t("web.portal.ps.owner") : t("web.portal.ps.viewer")}{p.viewerIsNamedApprover ? ` · ${t("web.portal.ps.namedApprover")}` : ""}</p>
          <p className="text-supporting text-muted">{t("web.portal.ps.bookingsCount", { count: p.openBookingCount })}</p>
        </Link>
      </li>)}</ul> : <Card>{query ? t("web.portal.ps.noMatch") : t("web.portal.ps.noPlaces")}</Card>}
      {page.hasMore && <Button variant="secondary" onClick={() => void more()}>{t("web.portal.work.more")}</Button>}
    </>}
    <Dock context={t("web.portal.ps.separatePeople")} primary={{ to:"/portal/places/new", label:t("web.portal.ps.addPlace") }} />
  </Frame>;
}
type PlaceEdit = { alias: string; address: string; safeArrivalNote: string | null };
type PlaceOperation = { operationId: string } & (
  | { kind: "create"; payload: PlaceEdit }
  | { kind: "edit"; expectedRevision: number; payload: PlaceEdit }
  | { kind: "person"; expectedRevision: number; person: string; payload: PlacePersonPatch }
  | { kind: "invite"; expectedRevision: number; payload: { email: string } }
  | { kind: "approver"; expectedRevision: number; payload: { successorAccountId: string } }
  | { kind: "reissue" | "withdraw"; invitation: string }
);
type PlaceInvite = NonNullable<PlaceDetails["pendingInvitations"]>[number];

export function PlaceDetail() {
  const { id = "" } = useParams();
  const { bootstrap, activeContext } = usePortal();
  return <PlaceDetailPage key={`${bootstrap?.sessionId}:${activeContext?.contextId}:${id}`} id={id} />;
}
function PlaceDetailPage({ id }: { id: string }) {
  const { t, locale, api: portalApi, bootstrap, activeContext } = usePortal(); const api = usePlaces(); const navigate = useNavigate(); const location = useLocation();
  const [place, setPlace] = useState<PlaceDetails | null>(null); const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [personId, setPersonId] = useState<string | null>(null);
  const [invitationAction, setInvitationAction] = useState<{ id: string; email: string; action: "reissue" | "withdraw" } | null>(null);
  const access = useMemo(() => createAccessClient(portalApi), [portalApi]);
  const [email, setEmail] = useState(""); const [successor, setSuccessor] = useState(""); const [confirm, setConfirm] = useState(false); const [editing, setEditing] = useState(id === "new"); const [alias,setAlias] = useState(""); const [address,setAddress] = useState(""); const [note,setNote] = useState("");
  useEffect(() => {
    if (id === "new") return;
    const checked = takeCheckedOpening(location.state, bootstrap?.sessionId, activeContext?.contextId ?? null);
    function show(data: PlaceDetails) { setPlace(data); setAlias(data.alias); setAddress(data.address ?? ""); setNote(data.safeArrivalNote ?? ""); }
    if (checked?.kind === "place" && checked.place.id === id) { show(checked.place); return; }
    const controller = new AbortController(); setPlace(null); setFailed(false);
    void api.getPlace(id, { signal: controller.signal }).then(r => { if (!controller.signal.aborted) r.ok ? show(r.data) : setFailed(true); });
    return () => controller.abort();
  }, [api, id, location.state, bootstrap?.sessionId, activeContext?.contextId, generation]);
  const blocked = looksLikeAccessCode(note);
  async function send(input: PlaceOperation): Promise<ApiResult<PlaceDetails | PlaceInvite | null>> {
    const { operationId, kind } = input;
    switch (kind) {
      case "create": return api.createPlace({ operationId, payload: input.payload });
      case "edit": return api.patchPlace(id, { operationId, payload: input.payload, expectedRevision: input.expectedRevision });
      case "person": return api.patchPlacePerson(id, input.person, { operationId, payload: input.payload, expectedRevision: input.expectedRevision });
      case "invite": return api.invitePlacePerson(id, { operationId, payload: input.payload, expectedRevision: input.expectedRevision });
      case "approver": return api.changePlaceApprover(id, { operationId, payload: input.payload, expectedRevision: input.expectedRevision });
      case "reissue": {
        const result = await access.reissueInvitation(input.invitation, { operationId, payload: {} });
        if (!result.ok) return result;
        if (result.data.kind === "place_view" || result.data.kind === "place_transfer") return { ...result, data: result.data };
        return { ok: false, error: { code: "INTERNAL_ERROR" }, meta: result.meta };
      }
      case "withdraw": {
        const result = await access.withdrawInvitation(input.invitation, { operationId, payload: {} });
        return result.ok ? { ...result, data: null } : result;
      }
    }
  }
  const command = usePendingOperation(`place:${id}`, send, (value, input) => {
    if (value && "people" in value) {
      setPlace(value);
      if (input.kind === "person") setPersonId(null);
      if (input.kind === "approver") setSuccessor("");
      if (input.kind === "edit" || input.kind === "create") {
        setAlias(value.alias); setAddress(value.address ?? ""); setNote(value.safeArrivalNote ?? ""); setEditing(false);
      }
      if (input.kind === "create") {
        const checkedNonce = bootstrap ? storeCheckedOpening({ kind: "place", place: value }, bootstrap.sessionId, activeContext?.contextId ?? null) : null;
        const destination = location.pathname.startsWith("/portal/new/") ? "/portal/new/place" : `/portal/places/${encodeURIComponent(value.id)}`;
        navigate(destination, { replace: true, state: { checkedNonce } });
      }
    } else if (value && input.kind === "invite") {
      setPlace(current => current ? { ...current, pendingInvitations: [...(current.pendingInvitations ?? []).filter(item => item.id !== value.id), value] } : current);
      setEmail("");
    } else if (input.kind === "withdraw" || input.kind === "reissue") {
      setPlace(current => {
        if (!current?.pendingInvitations) return current;
        const replacement = value ? [value] : [];
        return { ...current, pendingInvitations: current.pendingInvitations.flatMap(item => item.id === input.invitation ? replacement : [item]) };
      });
    }
  }, undefined, {
    ...(id === "new" ? { includeResource: true as const } : {}),
    onCommitted: status => {
      const resource = status.resource;
      if (id === "new" && resource?.kind === "place") {
        navigate(location.pathname.startsWith("/portal/new/") ? "/portal/new/place" : `/portal/places/${encodeURIComponent(resource.id)}`, { replace: true });
      } else if (id !== "new") {
        setPlace(null); setEditing(false); setPersonId(null); setEmail(""); setSuccessor("");
        setGeneration(n => n + 1);
      } else setEditing(false);
    },
  });
  const busy = command.state === "sending";
  const checking = command.state === "checking";
  const person = place?.people.find(item => item.accountId === personId);
  const canEditPeople = place?.actions.edit && place.actions.invite && place.relationship === "owner";
  function save() {
    if (busy || checking || blocked || !alias.trim() || !address.trim()) return;
    const body = { operationId: crypto.randomUUID(), payload: { alias: alias.trim(), address: address.trim(), safeArrivalNote: note.trim() || null } };
    if (id === "new") command.start({ kind: "create", ...body });
    else if (place?.actions.edit) command.start({ kind: "edit", ...body, expectedRevision: place.revision });
  }
  function invite() {
    if (!place?.actions.invite || busy || checking || !email.trim()) return;
    command.start({ kind: "invite", operationId: crypto.randomUUID(), expectedRevision: place.revision, payload: { email: email.trim() } });
  }
  function changeApprover() {
    if (!place?.actions.changeApprover || !successor || busy || checking) return;
    setConfirm(false);
    command.start({ kind: "approver", operationId: crypto.randomUUID(), expectedRevision: place.revision, payload: { successorAccountId: successor } });
  }
  function manageInvitation() {
    if (!invitationAction || busy || checking) return;
    command.start({ kind: invitationAction.action, operationId: crypto.randomUUID(), invitation: invitationAction.id });
    setInvitationAction(null);
  }
  function editPerson(payload: PlacePersonPatch) {
    if (!place || !person || !canEditPeople || busy || checking) return;
    command.start({ kind: "person", operationId: crypto.randomUUID(), person: person.accountId, expectedRevision: place.revision, payload });
    setPersonId(null);
  }
  const title = place?.alias ?? t("web.portal.ps.addPlace");
  const back = location.pathname.startsWith("/portal/new/") ? "/portal/new/place" : "/portal/places";
  const viewerZone = bootstrap?.preferences.twoClock ? bootstrap.preferences.displayZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  return <Frame current="places"><Link to={back}>{t("web.portal.ps.backPlaces")}</Link>
    <header className="space-y-1"><h1 className="text-page-title" dir="auto">{title}</h1>{place && <p className="text-supporting text-muted">{[place.areaName,siteZoneLabel(place.siteZone,locale)].filter(Boolean).join(" · ")}</p>}</header>
    {(failed || command.state === "failed") && <p role="alert">{t("web.portal.work.failed")}</p>}
    <PendingReceiptNotice state={command.state} />
    {checking && <><p role="status">{t("web.portal.auth.uncertain")}</p><Button onClick={command.check}>{t("web.portal.work.checkAgain")}</Button></>}
    {id !== "new" && !place && !failed && <p role="status">{t("web.portal.work.loading")}</p>}
    {editing ? <>
      <Card><div className="space-y-4">
        <TextField label={t("web.portal.ps.placeName")} value={alias} maxLength={100} readOnly={busy || checking} onChange={e=>setAlias(e.target.value)}/>
        <TextField label={t("web.portal.ps.address")} value={address} maxLength={500} readOnly={busy || checking} onChange={e=>setAddress(e.target.value)}/>
        <TextField label={t("web.portal.ps.safeNote")} hint={t("web.portal.ps.noCodes")} value={note} maxLength={500} readOnly={busy || checking} onChange={e=>setNote(e.target.value)} error={blocked ? t("web.portal.ps.noCodesError") : undefined}/>
      </div></Card>
      {place && <Button variant="text" disabled={busy || checking} onClick={()=>setEditing(false)}>{t("web.portal.work.close")}</Button>}
      <Dock primary={{ label:t("web.portal.ps.save"), disabled:blocked || busy || checking, onClick:save }} />
    </> : place && <>
    <Card title={t("web.portal.ps.placeDetails")} footer={place.actions.edit && <Button variant="secondary" disabled={busy || checking} onClick={()=>setEditing(true)}>{t("web.portal.ps.edit")}</Button>}>
      {place.address && <p dir="auto">{place.address}</p>}{place.safeArrivalNote && <p dir="auto">{place.safeArrivalNote}</p>}<p className="text-supporting text-muted">{t("web.portal.ps.noCodes")}</p>
    </Card>
    <section className="space-y-3"><h2 className="text-section-title">{t("web.portal.ps.people")}</h2>
    {place.people.map(person => <Card key={person.accountId} footer={canEditPeople && <Button variant="text" disabled={busy || checking} onClick={() => setPersonId(person.accountId)}>{t("web.portal.ps.editPerson")}</Button>}>
      <p className="text-label" dir="auto">{person.displayName}</p>
      <p className="text-supporting text-muted">{[person.isOwner && t("web.portal.ps.owner"),person.isNamedApprover && t("web.portal.ps.namedApprover"),...person.capabilities.map(capability => capability === "view" ? t("web.portal.ps.personView") : capability === "message" ? t("web.portal.ps.personMessage") : capability === "approve" ? t("web.portal.ps.personApprove") : null)].filter(Boolean).join(" · ")}</p>
    </Card>)}
    {canEditPeople && person && <PlacePersonDialog key={person.accountId} person={person} place={place} busy={busy || checking} close={() => setPersonId(null)} save={editPerson} />}
    {place.pendingInvitations?.map(invite => {
      const zone = invite.siteZone ?? place.siteZone;
      const issued = formatPortalTime(invite.issuedAt, zone, locale, viewerZone);
      const retry = invite.reissue.status === "wait" ? formatPortalTime(invite.reissue.retryAt, zone, locale, viewerZone) : null;
      const fallback = !issued || (invite.reissue.status === "wait" && !retry) ? new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:viewerZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}) : null;
      const issuedLabel = issued?.site ?? t("web.portal.auth.yourTime",{time:fallback!.format(invite.issuedAt)});
      const retryLabel = invite.reissue.status === "wait" ? retry?.site ?? t("web.portal.auth.yourTime",{time:fallback!.format(invite.reissue.retryAt)}) : "";
      return <div className="rounded-2xl border p-4" key={invite.id}><strong>{invite.email}</strong><p>{t("web.portal.ps.invitePending")} · {issuedLabel}</p>{issued?.viewer && <p>{issued.viewer}</p>}{invite.reissue.status === "wait" && <><p>{t("web.portal.ps.reissueAt",{date:retryLabel})}</p>{retry?.viewer && <p>{retry.viewer}</p>}</>}{invite.reissue.status === "available" && <Button disabled={busy || checking} onClick={()=>setInvitationAction({id:invite.id,email:invite.email,action:"reissue"})}>{t("web.portal.ps.reissueInvite")}</Button>}{invite.canWithdraw && <Button variant="text" disabled={busy || checking} onClick={()=>setInvitationAction({id:invite.id,email:invite.email,action:"withdraw"})}>{t("web.portal.ps.withdrawInvite")}</Button>}</div>;
    })}
    <Dialog open={!!invitationAction} onOpenChange={open=>{if(!open) setInvitationAction(null);}} title={invitationAction?.action === "reissue" ? t("web.portal.ps.reissueInvite") : t("web.portal.ps.withdrawInvite")} description={invitationAction?.action === "reissue" ? t("web.portal.ps.reissueEffect",{email:invitationAction.email}) : t("web.portal.ps.withdrawEffect",{email:invitationAction?.email ?? ""})} closeLabel={t("web.portal.work.close")}><Button disabled={busy || checking} onClick={manageInvitation}>{t("web.portal.ps.confirm")}</Button></Dialog>
    {place.actions.changeApprover && <>
      <Card footer={<Button variant="secondary" disabled={!successor || busy || checking} onClick={()=>setConfirm(true)}>{t("web.portal.ps.changeApprover")}</Button>}>
        <Select label={t("web.portal.ps.changeApprover")} value={successor} disabled={busy || checking} onChange={e=>setSuccessor(e.target.value)}>
          <option value="">{t("web.portal.ps.choosePerson")}</option>{place.people.filter(p=>!p.isNamedApprover).map(p=><option key={p.accountId} value={p.accountId}>{p.displayName}</option>)}
        </Select>
      </Card>
      <Dialog open={confirm} onOpenChange={setConfirm} title={t("web.portal.ps.confirmApprover")} description={t("web.portal.ps.approverEffect", { name: place.people.find(p=>p.accountId===successor)?.displayName ?? "" })} closeLabel={t("web.portal.work.close")}><Button disabled={busy} onClick={changeApprover}>{t("web.portal.ps.confirm")}</Button></Dialog>
    </>}
    {place.actions.invite && <Card><form className="space-y-3" onSubmit={e=>{e.preventDefault(); invite();}}><TextField type="email" required label={t("web.portal.ps.inviteEmail")} hint={t("web.portal.ps.inviteView")} value={email} readOnly={busy || checking} onChange={e=>setEmail(e.target.value)}/><Button type="submit" disabled={busy || checking}>{t("web.portal.ps.invite")}</Button></form></Card>}</section>
    <Card title={t("web.portal.ps.bookingsHere")}>{place.bookings.length ? <ul className="bb-inset-list">{place.bookings.map(b=><li key={b.jobId}><Link to={`/portal/jobs/${encodeURIComponent(b.jobId)}`}>{[b.reference,stageLabel(t,b.journeyStep)].filter(Boolean).join(" · ")}</Link></li>)}</ul> : <p>{t("web.portal.work.empty")}</p>}</Card></>}
  </Frame>;
}
