import { acceptInvitationRoute, declineInvitationRoute, linkTokenSchema, openLinkRoute, sessionContextRoute, type InvitationOpening, type LinkOpening } from "@bookbuddy/api-contract";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useApiAccess } from "../../api/provider";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { usePendingDrafts, usePendingSends, useStagedMediaCount } from "../../repository/hooks";
import { useSession } from "../../session";
import { Button, Card, Dock, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { authFlow } from "../s-02/flow";
import { isolated, roleLabel, roleRoots } from "../s-06/account";
import { confirmAction } from "../s-17/confirmAction";

type Pending = Extract<InvitationOpening, { status: "pending" }>;
type Accepted = Extract<InvitationOpening, { status: "accepted" }>;
type Unavailable = Extract<InvitationOpening, { status: "unavailable" }>;

function help(reason?: string): Href {
  return { pathname: "/help", params: { reason: reason === "expired" || reason === "removed" || reason === "pending" ? reason : "generic" } } as Href;
}

type Destination = Exclude<LinkOpening, { kind: "invitation" | "switch_context" | "unavailable" }>;
function destination(link: Destination, role: string | undefined): Href {
  switch (link.kind) {
    case "place": return { pathname: "/c/places/[placeId]", params: { placeId: link.place.id } } as Href;
    case "business_overview": return "/p/now" as Href;
    case "business_member": return "/p/people" as Href;
    case "business_eligibility": return (role === "provider_admin" ? "/p/eligibility" : "/f/crew") as Href;
    case "job": {
      const record = link.record;
      if (record.audience === "customer") return { pathname: "/c/jobs/[jobId]", params: { jobId: record.job.jobId, view: record.job.view } } as Href;
      if (record.audience === "foreman") return record.job.view === "intake"
        ? { pathname: "/f/intake/[handoffId]", params: { handoffId: record.job.handoff.handoffId } } as Href
        : { pathname: "/f/jobs/[jobId]", params: { jobId: record.job.jobId, view: record.job.view } } as Href;
      if (record.audience === "worker") return { pathname: "/w/shifts/[shiftId]", params: { shiftId: record.job.assignment.shiftId } } as Href;
      return "/p/jobs" as Href;
    }
    case "cover": return link.cover.audience === "foreman"
      ? { pathname: "/f/cover/[gapId]", params: { gapId: link.cover.gapId } } as Href
      : { pathname: "/w/offers/[offerId]", params: { offerId: link.cover.offer.offerId } } as Href;
    case "assignment_offer": return { pathname: "/w/offers/[offerId]", params: { offerId: link.offer.offerId } } as Href;
  }
}

export default function LinkScreen({ invitationOnly = false }: { invitationOnly?: boolean }) {
  const router = useRouter();
  const t = useT();
  const { opaque: raw } = useLocalSearchParams<{ opaque?: string }>();
  const parsed = linkTokenSchema.safeParse(raw);
  const opaque = parsed.success ? parsed.data : undefined;
  const { session, bootstrap, status, signOut, acceptBootstrap } = useSession();
  const { offline } = useApiAccess();
  const remote = useRemote(openLinkRoute, { params: { opaque: opaque ?? "" } }, { enabled: !!session && !!opaque });
  const accept = useCommand(acceptInvitationRoute);
  const decline = useCommand(declineInvitationRoute);
  const switchContext = useCommand(sessionContextRoute);
  const drafts = usePendingDrafts(true);
  const sends = usePendingSends();
  const media = useStagedMediaCount();
  const [newlyAccepted, setNewlyAccepted] = useState<Accepted>();
  const [navigationFailed, setNavigationFailed] = useState(false);
  const navigating = useRef(false);
  const active = session?.activeContext;
  const safeRoot = () => router.replace(active ? roleRoots[active.role] : "/help");

  useFocusEffect(useCallback(() => {
    if (!newlyAccepted || navigating.current) return;
    navigating.current = true;
    const current = newlyAccepted.currentAccess;
    if (current.kind === "place") {
      router.replace({ pathname: "/c/places/[placeId]", params: { placeId: current.placeId } } as Href);
      return;
    }
    if (current.workEligibility !== "approved" && current.workEligibility !== "expiring") {
      router.replace({ pathname: "/help", params: { reason: "pending" } } as Href);
      return;
    }
    if (current.context.scope.contextId === session?.activeContext?.contextId) {
      router.replace(roleRoots[current.context.scope.role]);
      return;
    }
    void (async () => {
      const outcome = await switchContext.run({ body: { payload: { contextId: current.context.scope.contextId } } });
      if (!outcome.ok || outcome.data.activeContext?.contextId !== current.context.scope.contextId) {
        setNavigationFailed(true); navigating.current = false; return;
      }
      try { await acceptBootstrap(outcome.data); router.replace(roleRoots[current.context.scope.role]); }
      catch { setNavigationFailed(true); navigating.current = false; }
    })();
  }, [newlyAccepted, session?.activeContext?.contextId, router, switchContext.run, acceptBootstrap]));

  function decide(invitation: Pending, kind: "accept" | "decline") {
    if (offline || accept.state === "sending" || accept.state === "checking" || decline.state === "sending" || decline.state === "checking") return;
    const grant = invitation.grant;
    const name = grant.kind === "business_role" ? grant.businessName : grant.placeAlias;
    const label = kind === "decline" ? t("mobile.invitation.confirmDecline") : grant.kind === "business_role" ? t("mobile.invitation.join") : t("mobile.invitation.accept");
    const actionLabelKey = kind === "decline" ? "mobile.invitation.confirmDecline" : grant.kind === "business_role" ? "mobile.invitation.join" : "mobile.invitation.accept";
    confirmAction(router, {
      title: label, actionLabel: label, actionLabelKey, item: isolated(name), actor: isolated(bootstrap?.account.displayName || bootstrap?.account.email || t("mobile.invitation.title")),
      role: grant.kind === "business_role" ? roleLabel(t, grant.role) : t("mobile.invitation.placeAccess"),
      effects: [kind === "accept" ? t("mobile.invitation.acceptEffect") : t("mobile.invitation.declineEffect")], destructive: kind === "decline",
      onReview: () => { void remote.refresh(); },
      onConfirm: async () => {
        const input = { params: { id: invitation.id }, body: { payload: {} } };
        if (kind === "accept") {
          const result = await accept.run(input);
          if (result.ok) { setNewlyAccepted(result.data); return "confirmed"; }
          return ("delivery" in result.error && result.error.delivery === "unknown") || result.error.code === "INTERNAL_ERROR" ? "uncertain" : "invalidated";
        }
        const result = await decline.run(input);
        if (result.ok) { setDeclined(true); return "confirmed"; }
        return ("delivery" in result.error && result.error.delivery === "unknown") || result.error.code === "INTERNAL_ERROR" ? "uncertain" : "invalidated";
      },
    });
  }
  const [declined, setDeclined] = useState(false);
  useFocusEffect(useCallback(() => { if (declined) safeRoot(); }, [declined, active?.role]));

  if (status === "loading") return null;
  if (!session) {
    if (opaque) authFlow.keepLink(opaque);
    return <Redirect href={{ pathname: "/welcome", params: { opaque, linkKind: invitationOnly ? "invite" : "update" } }} />;
  }
  if (!opaque) return <Redirect href={help()} />;
  if (!invitationOnly && remote.status === "error" && (remote.error?.code === "NOT_FOUND" || remote.error?.code === "UNAUTHENTICATED")) return <Redirect href={help()} />;
  const link = remote.status === "ready" ? remote.data : null;
  if (link && !invitationOnly) {
    if (link.kind === "invitation") return <Redirect href={{ pathname: "/invite/[opaque]", params: { opaque } }} />;
    if (link.kind === "switch_context") return <Redirect href={{ pathname: "/switch-role", params: { opaque } }} />;
    if (link.kind === "unavailable") return <Redirect href={help(link.reason)} />;
    return <Redirect href={destination(link, active?.role)} />;
  }
  let invitation: InvitationOpening | null = null;
  if (link?.kind === "invitation") invitation = link.invitation;
  else if (link?.kind === "unavailable") {
    const reason = link.reason;
    if (reason === "pending") return <Redirect href={help("pending")} />;
    invitation = { status: "unavailable", reason, supportReference: link.supportReference };
  }
  if (link && !invitation) return <Redirect href={help()} />;
  const busy = [accept.state, decline.state].some((state) => state === "sending" || state === "checking");
  return <InvitationView invitation={newlyAccepted ?? invitation} email={bootstrap?.account.email} status={remote.status} busy={busy}
    checking={accept.state === "checking" || decline.state === "checking" || navigationFailed} offline={offline}
    onBack={safeRoot} onRetry={() => { void remote.refresh(); }} onHelp={() => router.push(help(invitation?.status === "unavailable" ? invitation.reason : undefined))}
    onDifferentAccount={() => {
      confirmAction(router, { title: t("mobile.you.confirmTitle"), actionLabel: t("mobile.you.confirmAction"), actionLabelKey: "mobile.you.confirmAction",
        item: t("mobile.you.confirmItem"), actor: isolated(bootstrap?.account.email ?? t("mobile.invitation.title")), role: t("mobile.you.device"),
        effects: [t("mobile.you.confirmOtherDevices"), t("mobile.you.confirmWipe"),
          ...(drafts ? [t("mobile.you.drafts", { count: drafts })] : []),
          ...(sends?.waiting ? [t("mobile.you.waiting", { count: sends.waiting })] : []),
          ...(sends?.checking ? [t("mobile.you.checking", { count: sends.checking })] : []),
          ...(media ? [t("mobile.you.media", { count: media })] : []),
          ...(drafts || sends?.waiting || sends?.checking || media ? [t("mobile.you.confirmUnknown")] : [])],
        serverAction: false, destructive: true,
        onReview: () => {}, onConfirm: async () => { authFlow.keepLink(opaque); await signOut(); return "confirmed"; } });
    }}
    onAccept={() => { if (invitation?.status === "pending") decide(invitation, "accept"); }}
    onDecline={() => { if (invitation?.status === "pending") decide(invitation, "decline"); }}
    onSetup={() => { authFlow.keepLink(opaque); router.replace("/setup"); }} />;
}

export function InvitationRoute() { return <LinkScreen invitationOnly />; }

export function InvitationView({ invitation, email, status, busy = false, checking = false, offline = false, onBack, onRetry, onHelp, onDifferentAccount, onAccept, onDecline, onSetup }: {
  invitation: InvitationOpening | null; email?: string; status: RemoteStatus; busy?: boolean; checking?: boolean; offline?: boolean;
  onBack: () => void; onRetry: () => void; onHelp: () => void; onDifferentAccount: () => void; onAccept: () => void; onDecline: () => void; onSetup: () => void;
}) {
  const t = useT(); const format = useFormat(); const { color, space, radius } = useBeaconTheme();
  const pending = invitation?.status === "pending" ? invitation : null;
  const unavailable: Unavailable | null = invitation?.status === "unavailable" ? invitation : null;
  const accepted = invitation?.status === "accepted" ? invitation : null;
  const capabilities = { view: t("mobile.places.view"), message: t("mobile.places.message"), request: t("mobile.places.request"),
    book: t("mobile.places.book"), approve: t("mobile.places.approve"), sign_off: t("mobile.places.signOff"),
    bill_view: t("mobile.places.billView"), delegate: t("mobile.places.delegate") };
  const time = (value: number, zone: string | null) => { const result = format.siteTime(value, zone); return result.kind === "available" ? result.siteTime : t("mobile.invitation.timeUnavailable"); };
  const grant = pending?.grant;
  const dock = pending ? <Dock context={pending.setupRequired ? t("mobile.invitation.setup") : t("mobile.invitation.expires", { time: time(pending.expiresAt, pending.siteZone) })}
    primary={{ label: pending.setupRequired ? t("mobile.invitation.setupAction") : grant?.kind === "business_role" ? t("mobile.invitation.join") : t("mobile.invitation.accept"), onPress: pending.setupRequired ? onSetup : onAccept, disabled: offline || busy || checking }}
    secondary={{ label: t("mobile.invitation.decline"), onPress: onDecline, disabled: offline || busy || checking }} />
    : invitation ? <Dock primary={{ label: t("mobile.invitation.done"), onPress: onBack }} /> : undefined;
  return <Screen title={t("mobile.invitation.title")} navigation={{ kind: "back", label: t("shared.action.back"), onPress: onBack }} dock={dock}>
    {email && <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.invitation.signedIn", { email: isolated(email) })}</Copy>}
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.invitation.loading")}</Copy>}
    {status === "offline" && <Copy>{t("mobile.invitation.offline")}</Copy>}
    {status === "error" && <><Copy>{t("mobile.invitation.error")}</Copy><Button variant="quiet" label={t("mobile.invitation.retry")} onPress={onRetry} /></>}
    {pending && grant && <>
      <Copy variant="sectionTitle">{t("mobile.invitation.invites", { name: isolated(pending.inviterDisplayName) })}</Copy>
      <Copy variant="pageTitle">{grant.kind === "business_role" ? t("mobile.invitation.joinBusiness", { business: isolated(grant.businessName) }) : t("mobile.invitation.joinPlace", { place: isolated(grant.placeAlias) })}</Copy>
      <Card>
        <Copy variant="supporting">{t("mobile.invitation.joinAs")}</Copy>
        <Copy variant="sectionTitle">{grant.kind === "business_role" ? roleLabel(t, grant.role) : t("mobile.invitation.placeAccess")}</Copy>
        {grant.kind === "business_role" ? grant.role === "worker" ? <><Copy>✓  {t("mobile.invitation.workerOffers")}</Copy><Copy>✓  {t("mobile.invitation.workerShifts")}</Copy><Copy>✓  {t("mobile.invitation.workerChat")}</Copy></> : <Copy>{t("mobile.invitation.foremanLimits")}</Copy>
          : <Copy>{grant.kind === "place_view" ? t("mobile.invitation.placeView") : t("mobile.invitation.placeTransfer")}</Copy>}
      </Card>
      {grant.kind === "business_role" && <View style={{ backgroundColor: color.subtle, borderRadius: radius.card, padding: space.grid[4], gap: space.grid[2] }}><Copy variant="sectionTitle">{t("mobile.invitation.limitsTitle")}</Copy><Copy>{t("mobile.invitation.limits")}</Copy><Copy>{t("mobile.invitation.location")}</Copy></View>}
      <Copy variant="supporting">{t("mobile.invitation.sent", { time: time(pending.issuedAt, pending.siteZone) })}</Copy>
      <Copy variant="supporting">{t("mobile.invitation.singleUse")}</Copy>
      <Button variant="quiet" label={t("mobile.invitation.differentAccount")} onPress={onDifferentAccount} />
    </>}
    {unavailable && <><Copy variant="pageTitle">{unavailable.reason === "expired" ? t("mobile.invitation.expired") : unavailable.reason === "wrong_account" ? t("mobile.invitation.wrongAccount") : t("mobile.invitation.unavailable")}</Copy>
      {unavailable.reason === "expired" && <Copy>{t("mobile.invitation.expiredBody")}</Copy>}
      {unavailable.reason !== "expired" && <Button variant="quiet" label={t("mobile.invitation.differentAccount")} onPress={onDifferentAccount} />}
      <Button variant="quiet" label={t("mobile.invitation.help")} onPress={onHelp} /></>}
    {accepted && <><Copy variant="pageTitle">{t("mobile.invitation.accepted")}</Copy><Card>{accepted.currentAccess.kind === "business" ? <>
      <Copy variant="sectionTitle">{accepted.currentAccess.context.businessName && isolated(accepted.currentAccess.context.businessName)}</Copy>
      <Copy>{roleLabel(t, accepted.currentAccess.context.scope.role)}</Copy>
      <Copy>{accepted.currentAccess.workEligibility === "approved" ? t("mobile.invitation.eligibilityApproved")
        : accepted.currentAccess.workEligibility === "expiring" ? t("mobile.provider.expiring")
        : accepted.currentAccess.workEligibility === "expired" ? t("mobile.provider.expired")
        : accepted.currentAccess.workEligibility === "suspended" ? t("mobile.provider.suspended")
        : accepted.currentAccess.workEligibility === "rejected" ? t("mobile.provider.rejected") : t("mobile.invitation.eligibilityPending")}</Copy>
    </> : <><Copy variant="sectionTitle">{isolated(accepted.currentAccess.placeAlias)}</Copy><Copy>{accepted.currentAccess.isOwner ? t("mobile.invitation.placeOwner") : t("mobile.invitation.placeAccess")}</Copy>
      {accepted.currentAccess.capabilities.map((capability) => <Copy key={capability}>{capabilities[capability]}</Copy>)}</>}</Card></>}
    {checking && <Copy accessibilityLiveRegion="polite">{t("mobile.invitation.checking")}</Copy>}
  </Screen>;
}
