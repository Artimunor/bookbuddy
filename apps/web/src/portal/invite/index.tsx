import { createAccessClient, createApiClient } from "@bookbuddy/api-client";
import type { InvitationOpening } from "@bookbuddy/api-contract";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { Button, Card, Dialog } from "../../ui";
import { Frame, usePortal } from "../now/common";
import { takeCheckedOpening } from "../notifications/handoff";
import { usePendingOperation } from "../session/pending-operation";
import { formatPortalTime } from "../time";

type InvitationAction = "accept" | "decline";
type InvitationOperation = { action: InvitationAction; operationId: string; invitationId: string };

export function Invitation() {
  const { opaque = "" } = useParams();
  const { bootstrap, activeContext, status } = usePortal();
  return <InvitationPage key={`${bootstrap?.sessionId}:${activeContext?.contextId}:${opaque}`} opaque={opaque} loading={status === "loading"} />;
}
function InvitationPage({ opaque, loading }: { opaque: string; loading: boolean }) {
  const location = useLocation(); const { locale, t, bootstrap, activeContext } = usePortal();
  const api = useMemo(()=>createAccessClient(createApiClient({baseUrl:"/api/v1",getSession:()=>null,getLocale:()=>locale})),[locale]);
  const [opening,setOpening] = useState<InvitationOpening | null>(null); const [failed,setFailed] = useState(false); const [declined,setDeclined] = useState(false); const [dialog,setDialog] = useState<InvitationAction | null>(null);
  useEffect(()=>{ if (loading) return; const checked = takeCheckedOpening(location.state,bootstrap?.sessionId,activeContext?.contextId ?? null); if(checked?.kind === "invitation" && checked.invitation.status !== "unavailable" && checked.invitation.id === opaque) {setOpening(checked.invitation); return;} const c = new AbortController(); void api.getInvitation(opaque,{signal:c.signal}).then(r=>{if(!c.signal.aborted) r.ok ? setOpening(r.data) : setFailed(true);}); return ()=>c.abort(); },[api,opaque,location.state,bootstrap?.sessionId,activeContext?.contextId,loading]);
  const command = usePendingOperation(`invitation:${opaque}`, (input: InvitationOperation) => `POST /invitations/:id/${input.action}`, async input => {
    const body = { operationId: input.operationId, payload: {} };
    if (input.action === "accept") return api.acceptInvitation(input.invitationId, body);
    const result = await api.declineInvitation(input.invitationId, body);
    return result.ok ? { ...result, data: null } : result;
  }, value => { if (value) setOpening(value); else setDeclined(true); });
  const busy = command.state === "sending" || command.state === "checking";
  function decide(action: InvitationAction) {
    if (!bootstrap || busy || opening?.status !== "pending") return;
    command.start({ action, operationId: crypto.randomUUID(), invitationId: opening.id });
    setDialog(null);
  }
  const viewerZone = bootstrap?.preferences.twoClock ? bootstrap.preferences.displayZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const expires = opening?.status === "pending" ? formatPortalTime(opening.expiresAt,opening.siteZone,locale,viewerZone) : null;
  const expiryLabel = opening?.status === "pending" ? expires?.site ?? t("web.portal.auth.yourTime",{time:new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:viewerZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}).format(opening.expiresAt)}) : "";
  return <Frame><h1 className="text-page-title">{t("web.portal.ps.invitationTitle")}</h1>
    {!opening && !failed && <p role="status">{t("web.portal.work.loading")}</p>}
    {(failed || command.state === "failed") && <p role="alert">{t("web.portal.work.failed")}</p>}
    {command.state === "checking" && <><p role="status">{t("web.portal.auth.uncertain")}</p><Button onClick={command.check}>{t("web.portal.work.checkAgain")}</Button></>}
    {declined ? <p>{t("web.portal.ps.invitationDeclined")}</p> : opening?.status === "unavailable" ? <p role="alert">{opening.reason === "expired" ? t("web.portal.ps.invitationExpired") : opening.reason === "wrong_account" ? t("web.portal.ps.invitationWrongAccount") : t("web.portal.ps.linkUnavailable")}</p> : opening?.status === "accepted" ? <Card><h2>{t("web.portal.ps.invitationAccepted")}</h2><p>{opening.currentAccess.kind === "place" ? opening.currentAccess.placeAlias : opening.currentAccess.context.businessName}</p>{opening.currentAccess.kind === "place" && <Link to={`/portal/places/${encodeURIComponent(opening.currentAccess.placeId)}`}>{t("web.portal.work.open")}</Link>}</Card> : opening?.status === "pending" && <Card><p>{t("web.portal.ps.invitedBy",{name:opening.inviterDisplayName})}</p><p>{opening.grant.kind === "business_role" ? `${opening.grant.businessName} · ${opening.grant.role}` : opening.grant.placeAlias}</p><p>{opening.grant.kind === "place_view" ? t("web.portal.ps.inviteView") : opening.grant.kind === "place_transfer" ? t("web.portal.ps.inviteTransfer") : t("web.portal.ps.inviteBusiness")}</p><p>{t("web.portal.ps.invitationExpiry",{date:expiryLabel})}</p>{expires?.viewer && <p>{expires.viewer}</p>}<Button disabled={busy || !bootstrap} onClick={()=>setDialog("accept")}>{t("web.portal.ps.acceptInvite")}</Button><Button variant="text" disabled={busy || !bootstrap} onClick={()=>setDialog("decline")}>{t("web.portal.ps.declineInvite")}</Button></Card>}
    <Dialog open={dialog !== null} onOpenChange={open=>{if(!open) setDialog(null);}} title={dialog === "accept" ? t("web.portal.ps.acceptInvite") : t("web.portal.ps.declineInvite")} description={dialog === "accept" ? t("web.portal.ps.acceptEffect") : t("web.portal.ps.declineEffect")} closeLabel={t("web.portal.work.close")}><Button disabled={busy || !dialog} onClick={()=>{if(dialog) void decide(dialog);}}>{t("web.portal.ps.confirm")}</Button></Dialog></Frame>;
}
