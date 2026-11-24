import { acceptCoverRoute, acceptOfferRoute, declineCoverRoute, declineOfferRoute, getCoverRoute, getHomeRoute, getOfferRoute, withdrawCoverRoute, type WorkerAssignmentOffer, type WorkerCoverOffer } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { useCommand, useRemote, type CachedRead } from "../../api";
import { useFormat, useT } from "../../i18n";
import { Button, Card, Dock, Screen, Sheet } from "../../ui/controls";
import { useSession } from "../../session";
import { Copy } from "../../ui/controls/shared";
import { OfferClock } from "../../ui/live/OfferClock";
import { siteTime } from "../f-01/Screen";
import { useOffline } from "../s-02/flow";
import { DecisionSheet, type DecisionMode, type Reason } from "../w-05/Screen";
import SessionHostOfferScreen from "./SessionOffer";

export type Offer = WorkerAssignmentOffer | WorkerCoverOffer;
type Status = "idle" | "loading" | "ready" | "error" | "offline";
type CachedOffer = Extract<CachedRead<"home">, { audience: "worker" }>["offers"][number];
export function useClock() { const [now, setNow] = useState(Date.now); useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []); return now; }
export function Deadline({ deadline, starts, zone, now, confirmation = false, field = false }: { deadline: number; starts: number; zone: string; now: number; confirmation?: boolean; field?: boolean }) {
  const t = useT(); const format = useFormat(); const remaining = Math.max(0, deadline - now); const label = confirmation ? t("mobile.workerOffer.confirmBy", { time: `${siteTime(format, deadline, zone)} · ${zone}` }) : t("mobile.workerOffer.replyBy", { time: `${siteTime(format, deadline, zone)} · ${zone}` });
  return <OfferClock state="running" surface={field ? "fieldCapsule" : "neutral"} deadline={label} remaining={t("mobile.workerOffer.minutes", { count: Math.ceil(remaining / 60000) })} fraction={deadline > starts ? Math.max(0, Math.min(1, remaining / (deadline - starts))) : 0} />;
}
export default function OfferScreen() {
  const { session } = useSession();
  const { offerId, gapId, sessionHost, listingId, slotId } = useLocalSearchParams<{ offerId: string; gapId?: string; sessionHost?: string; listingId?: string; slotId?: string }>();
  const scope = `${session?.sessionId}:${session?.activeContext?.contextId}`;
  if (sessionHost === "1") return <SessionHostOfferScreen key={`${scope}:${listingId}:${slotId}:${offerId}`} offerId={offerId ?? ""} listingId={listingId ?? ""} slotId={slotId ?? ""} />;
  return <OfferRoute key={`${scope}:${offerId}:${gapId}`} />;
}
function OfferRoute() {
  const { offerId, gapId, accept: acceptParam, decision: initialDecision } = useLocalSearchParams<{ offerId: string; gapId?: string; accept?: string; decision?: string }>(); const router = useRouter(); const offline = useOffline();
  const cover = useRemote(getCoverRoute, { params: { g: gapId ?? "" } }, { enabled: !!gapId });
  const ordinary = useRemote(getOfferRoute, { params: { id: offerId ?? "" } }, { enabled: !!offerId && !gapId });
  const cachedHome = useRemote(getHomeRoute, { query: {} }, { enabled: offline, cache: { kind: "home" } });
  const acceptCover = useCommand(acceptCoverRoute), declineCover = useCommand(declineCoverRoute), withdrawCover = useCommand(withdrawCoverRoute), acceptOrdinary = useCommand(acceptOfferRoute), declineOrdinary = useCommand(declineOfferRoute);
  const [local, setLocal] = useState<Offer | null>(null); const [acceptOpen, setAcceptOpen] = useState(acceptParam === "1"); const [decision, setDecision] = useState<DecisionMode | null>(initialDecision === "decline" ? "decline" : initialDecision === "withdraw" ? "withdraw" : null);
  const remote = gapId ? cover : ordinary; const raw = gapId ? (cover.data?.audience === "worker" ? cover.data.offer : null) : ordinary.data;
  const data = local ?? (raw?.offerId === offerId ? raw : null);
  const states = [acceptCover.state, declineCover.state, withdrawCover.state, acceptOrdinary.state, declineOrdinary.state]; const busy = states.some(s => s === "sending" || s === "checking"); const checking = states.includes("checking"); const failed = states.some(s => s === "failed" || s === "conflict");
  async function accept() {
    if (!data || data.state !== "offered" || offline || busy || remote.status !== "ready" || Date.now() >= data.replyBy) return;
    const result = data.kind === "cover" ? await acceptCover.run({ params: { g: data.gapId }, body: { expectedRevision: data.revision, expectedRoundNo: data.roundNo, payload: { offerId: data.offerId } } }) : await acceptOrdinary.run({ params: { id: data.offerId }, body: { payload: {} } });
    if (result.ok) { setLocal({ ...data, ...result.data } as Offer); setAcceptOpen(false); } else void remote.refresh();
  }
  async function decide(reason: Reason) {
    if (!data || offline || busy || remote.status !== "ready") return;
    if (decision === "decline" && data.state === "offered" && Date.now() < data.replyBy) {
      const category = reason === "busy_then" || reason === "too_far_away" ? reason : null;
      const result = data.kind === "cover" ? await declineCover.run({ params: { g: data.gapId }, body: { expectedRevision: data.revision, expectedRoundNo: data.roundNo, payload: { offerId: data.offerId, reason: category } } }) : await declineOrdinary.run({ params: { id: data.offerId }, body: { payload: { reason: category } } });
      if (result.ok) { setLocal(result.data); setDecision(null); } else void remote.refresh();
    } else if (decision === "withdraw" && data.kind === "cover" && data.state === "accepted_pending_confirmation") {
      const result = await withdrawCover.run({ params: { g: data.gapId }, body: { expectedRevision: data.revision, expectedRoundNo: data.roundNo, payload: { offerId: data.offerId } } });
      if (result.ok) { setLocal(result.data); setDecision(null); } else void remote.refresh();
    }
  }
  return <OfferView data={data} cached={cachedHome.data?.audience === "worker" ? cachedHome.data.offers.find(item => item.offerId === offerId) : undefined} lastConfirmedAt={cachedHome.lastConfirmedAt} status={offline ? "offline" : remote.status} now={useClock()} busy={busy} checking={checking} failed={failed} acceptOpen={acceptOpen} decision={decision} onBack={() => router.canGoBack() ? router.back() : router.replace("/w/(tabs)/now" as Href)} onRetry={() => void remote.refresh()} onOpenAccept={() => setAcceptOpen(true)} onCloseAccept={() => setAcceptOpen(false)} onAccept={() => void accept()} onDecision={setDecision} onSubmitDecision={reason => void decide(reason)} onShift={id => router.replace(`/w/shifts/${id}` as Href)} />;
}
export function OfferView(p: { data: Offer | null; cached?: CachedOffer; lastConfirmedAt?: number | null; status: Status; now: number; busy: boolean; checking: boolean; failed: boolean; acceptOpen: boolean; decision: DecisionMode | null; onBack: () => void; onRetry: () => void; onOpenAccept: () => void; onCloseAccept: () => void; onAccept: () => void; onDecision: (mode: DecisionMode | null) => void; onSubmitDecision: (reason: Reason) => void; onShift: (id: string) => void }) {
  const t = useT(); const format = useFormat(); const data = p.data; const open = data?.state === "offered"; const held = data?.state === "accepted_pending_confirmation"; const enabled = p.status === "ready" && !p.busy && !!data && (!open || p.now < data.replyBy);
  const stateLabel = data?.state === "filled_elsewhere" ? t("mobile.workerOffer.filled") : data?.state === "expired" ? t("mobile.workerOffer.expired") : data?.state === "not_confirmed" ? t("mobile.workerOffer.notConfirmed") : data?.state === "declined" ? t("mobile.workerOffer.declined") : data?.state === "withdrawn" ? t("mobile.workerOffer.withdrawn") : data?.state === "on_hold" ? t("mobile.workerOffer.onHold") : data?.state === "confirmed" ? t("mobile.workerOffer.confirmed") : held ? t("mobile.workerOffer.waiting") : "";
  const title = data?.kind === "assignment" ? t("mobile.workerOffer.assignmentOffer") : t("mobile.workerOffer.offer");
  return <Screen title={title} navigation={{ kind: "back", label: t("mobile.workerOffer.back"), onPress: p.onBack }} dock={open ? <Dock context={data.kind === "cover" ? t("mobile.workerOffer.provisional") : t("mobile.workerOffer.ordinaryEffect")} primary={{ label: data.kind === "cover" ? t("mobile.workerOffer.accept") : t("mobile.workerOffer.confirmAssignment"), onPress: p.onOpenAccept, disabled: !enabled }} secondary={{ label: t("mobile.workerOffer.decline"), onPress: () => p.onDecision("decline"), disabled: !enabled }} /> : held ? <Dock context={t("mobile.workerOffer.noTravel")} primary={{ label: t("mobile.workerOffer.withdraw"), onPress: () => p.onDecision("withdraw"), disabled: !enabled }} /> : data?.state === "confirmed" ? <Dock primary={{ label: t("mobile.workerOffer.openShift"), onPress: () => p.onShift(data.shiftId) }} /> : undefined}>
    {(p.status === "loading" || p.status === "idle") && <Copy>{t("mobile.workerOffer.loading")}</Copy>}{p.status === "error" && <><Copy>{t("mobile.workerOffer.error")}</Copy><Button label={t("mobile.workerOffer.retry")} onPress={p.onRetry} /></>}{p.status === "offline" && <Copy>{t("mobile.workerOffer.offline")}</Copy>}
    {p.status === "offline" && !data && p.cached && <Card>{p.lastConfirmedAt != null && <Copy>{t("shared.status.lastConfirmed", { time: `${siteTime(format, p.lastConfirmedAt, p.cached.siteZone)} · ${p.cached.siteZone}` })}</Copy>}<Copy variant="sectionTitle">{p.cached.town} · {p.cached.skill}</Copy><Copy>{siteTime(format, p.cached.window.startsAt, p.cached.siteZone)} – {siteTime(format, p.cached.window.endsAt, p.cached.siteZone)} · {p.cached.siteZone}</Copy><Copy>{t("mobile.workerOffer.language", { language: p.cached.briefingLanguage })}</Copy>{p.cached.awaitingConfirmationUntil && <Copy>{t("mobile.workerOffer.noTravel")}</Copy>}</Card>}
    {data && <Card>{!!stateLabel && <Copy variant="sectionTitle">{stateLabel}</Copy>}{"town" in data && <><Copy variant="sectionTitle">{data.task}</Copy><Copy>{data.town} · {data.skill}</Copy><Copy>{siteTime(format, data.window.startsAt, data.siteZone)} – {siteTime(format, data.window.endsAt, data.siteZone)} · {data.siteZone}</Copy><Copy>{t("mobile.workerOffer.language", { language: data.briefingLanguage })}</Copy>{(open || held) && <Deadline deadline={held ? data.confirmBy : data.replyBy} starts={data.sentAt} zone={data.siteZone} now={p.now} confirmation={held} />}</>}{"endedAt" in data && <OfferClock state={data.state === "expired" ? "expired" : "filled"} statusLabel={stateLabel} deadline={`${siteTime(format, data.endedAt, data.siteZone)} · ${data.siteZone}`} />}{held && <Copy>{t("mobile.workerOffer.noTravel")}</Copy>}</Card>}
    {p.checking && <Copy>{t("mobile.workerOffer.checking")}</Copy>}{p.failed && <Copy>{t("mobile.workerOffer.failed")}</Copy>}
    <Sheet visible={p.acceptOpen && !!open} title={t("mobile.workerOffer.accept")} closeLabel={t("mobile.workerOffer.close")} onClose={p.onCloseAccept} dock={<Dock primary={{ label: data?.kind === "cover" ? t("mobile.workerOffer.reserve") : t("mobile.workerOffer.confirmAssignment"), onPress: p.onAccept, disabled: !enabled }} secondary={{ label: t("mobile.workerOffer.close"), onPress: p.onCloseAccept }} />}><Copy>{data?.kind === "cover" ? t("mobile.workerOffer.provisional") : t("mobile.workerOffer.ordinaryEffect")}</Copy>{data && "town" in data && <Copy>{data.task} · {data.town}</Copy>}{p.checking && <Copy>{t("mobile.workerOffer.checking")}</Copy>}{p.failed && <Copy>{t("mobile.workerOffer.failed")}</Copy>}{p.status === "offline" && <Copy>{t("mobile.workerOffer.offline")}</Copy>}</Sheet>
    <DecisionSheet visible={(p.decision === "decline" && !!open) || (p.decision === "withdraw" && !!held)} mode={p.decision ?? "decline"} detail={data && "town" in data ? `${data.task} · ${data.town}` : undefined} offline={p.status !== "ready"} busy={!enabled} checking={p.checking} failed={p.failed} onClose={() => p.onDecision(null)} onSubmit={p.onSubmitDecision} />
  </Screen>;
}
