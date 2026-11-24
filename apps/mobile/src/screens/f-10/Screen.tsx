import { closeCoverRoute, getCoverRoute, getShiftRoute, issueCoverRoute, type ForemanCover } from "@bookbuddy/api-contract";
import type { SiteDateTime } from "@bookbuddy/domain";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { AppState, Pressable, View } from "react-native";
import { useCommand, useRemote, useSeedRemote } from "../../api";
import type { CommandStatus, RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { coverCardSource, useStatusCards } from "../../system/status-cards";
import { Button, Card, Dock, Screen, SwitchRow } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { LiveCapsule } from "../../ui/live/LiveCapsule";
import { OfferClock } from "../../ui/live/OfferClock";
import { useBeaconTheme } from "../../ui/theme";
import { confirmAction } from "../s-17/confirmAction";

type Candidate = ForemanCover["candidates"][number];
export function isCandidateEligible(c: Candidate) { return c.onDuty && c.fit.result === "available" && c.fit.skillMatches && c.fit.briefingLanguageMatches && c.fit.availability.state === "free"; }
export function formatTime(format: { siteTime: (at: number, zone: string) => SiteDateTime }, at: number, zone: string) { const value = format.siteTime(at, zone); return value.kind === "available" ? value.siteTime : zone; }
export default function CoverScreen() {
  const { gapId } = useLocalSearchParams<{ gapId: string }>(); const router = useRouter(); const t = useT(); const { bootstrap } = useSession();
  const remote = useRemote(getCoverRoute, { params: { g: gapId ?? "" } }, { enabled: !!gapId });
  const data = remote.data?.audience === "foreman" ? remote.data : null;
  const [selected, setSelected] = useState<string[]>([]); const [openSchedule, setOpenSchedule] = useState(false);
  const { preferences, active, start, refresh, stop, changePreferences } = useStatusCards();
  const seedRemote = useSeedRemote();
  const card = active?.target.kind === "foreman_cover" && active.target.id === gapId ? active : null;
  const [cardFailed, setCardFailed] = useState(false);
  useEffect(() => {
    if (!card) return;
    if (data) void refresh(coverCardSource(data)).catch(() => undefined);
    else if (remote.error?.code === "NOT_FOUND" || remote.error?.code === "UNAUTHENTICATED") void stop(card.id).catch(() => undefined);
  }, [card, data, remote.error, refresh, stop]);
  const shift = useRemote(getShiftRoute, { params: { s: data?.shift.shiftId ?? "" } }, { enabled: !!data && openSchedule });
  const issue = useCommand(issueCoverRoute); const close = useCommand(closeCoverRoute);
  useEffect(() => { if (!openSchedule || shift.status !== "ready") return; setOpenSchedule(false); router.push(`/f/jobs/${shift.data.shift.job.id}/schedule` as Href); }, [openSchedule, shift.status, shift.data, router]);
  useEffect(() => { if (openSchedule && (shift.status === "error" || shift.status === "offline")) setOpenSchedule(false); }, [openSchedule, shift.status]);
  function ask(kind: "issue" | "delivery" | "safety") {
    if (!data || remote.status !== "ready" || (kind === "issue" && (!selected.length || !data.actions.canIssue)) || (kind !== "issue" && !data.actions.canClose)) return;
    const names = data.candidates.filter(c => selected.includes(c.membershipId)).map(c => c.displayName).join(", ");
    const title = kind === "issue" ? t("mobile.cover.send", { count: selected.length }) : kind === "delivery" ? t("mobile.cover.closeDelivery") : t("mobile.cover.closeSafety");
    confirmAction(router, { title, actionLabel: title, actionLabelKey: kind === "issue" ? "mobile.cover.sendOffers" : kind === "delivery" ? "mobile.cover.closeDelivery" : "mobile.cover.closeSafety", item: `${data.shift.reference} · ${kind === "issue" ? names : data.shift.task}`, actor: bootstrap?.account.displayName ?? "", role: t("mobile.cover.foreman"), effects: [kind === "issue" ? t("mobile.cover.sendEffect") : t("mobile.cover.closeEffect")], destructive: kind !== "issue", onReview: () => { void remote.refresh(); }, onConfirm: async () => {
      const basis = { expectedRevision: data.revision, expectedRoundNo: data.currentRoundNo };
      const showCard = kind === "issue" && preferences.statusCardsEnabled && preferences.coverOptIn && AppState.currentState === "active";
      const result = kind === "issue" ? await issue.run({ params: { g: data.gapId }, body: { ...basis, payload: { recipientMembershipIds: selected } } }) : await close.run({ params: { g: data.gapId }, body: { ...basis, payload: { reason: kind } } });
      if (result.ok) {
        seedRemote(getCoverRoute, { params: { g: data.gapId } }, result.data, result.meta.serverTime);
        setSelected([]);
        if (showCard) void start(coverCardSource(result.data)).then(shown => setCardFailed(!shown), () => setCardFailed(true));
        return "confirmed";
      }
      await remote.refresh();
      if (result.error.code === "INTERNAL_ERROR" || ("delivery" in result.error && result.error.delivery === "unknown")) return "uncertain";
      return "invalidated";
    } });
  }
  const commandState = issue.state === "idle" ? close.state : issue.state;
  const cardControls = preferences.statusCardsEnabled ? <>
    {data?.actions.canIssue && <SwitchRow label={t("mobile.statusCards.coverPreference")} description={t("mobile.statusCards.coverDescription")} value={preferences.coverOptIn} onValueChange={coverOptIn => {
      setCardFailed(false);
      void changePreferences({ coverOptIn }).catch(() => setCardFailed(true));
    }} />}
    {cardFailed && <Copy accessibilityRole="alert">{t("mobile.statusCards.unavailable")}</Copy>}
  </> : undefined;
  return <CoverView data={data} status={remote.status} selected={selected} commandState={commandState} cardControls={cardControls} onToggle={id => setSelected(current => current.includes(id) ? current.filter(x => x !== id) : current.length < 3 ? [...current, id] : current)} onSend={() => ask("issue")} onCloseRound={reason => ask(reason)} onReview={() => router.push(`/f/cover/${gapId}/confirm` as Href)} onShift={() => data && router.push(`/f/shifts/${data.shift.shiftId}` as Href)} onPropose={() => setOpenSchedule(true)} onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} />;
}

export function CoverView({ data, status, selected, commandState = "idle", now: fixedNow, cardControls, onToggle, onSend, onCloseRound, onReview, onShift, onPropose, onBack, onRetry }: { data: ForemanCover | null; status: RemoteStatus; selected: string[]; commandState?: CommandStatus; now?: number; cardControls?: ReactNode; onToggle: (id: string) => void; onSend: () => void; onCloseRound: (reason: "delivery" | "safety") => void; onReview: () => void; onShift: () => void; onPropose: () => void; onBack: () => void; onRetry: () => void }) {
  const t = useT(); const format = useFormat(); const { color, radius, space } = useBeaconTheme();
  const [clock, setClock] = useState(() => Date.now());
  const state = data?.status.state; const active = state === "offers_out" || state === "accepted_pending_confirmation";
  useEffect(() => { if (!active || fixedNow !== undefined || status !== "ready") return; const id = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(id); }, [active, fixedNow, status]);
  const now = fixedNow ?? clock; const time = (at: number) => formatTime(format, at, data?.shift.siteZone ?? "");
  const statusLabel = !data ? "" : data.status.state === "gap" ? t("mobile.cover.gap") : data.status.state === "offers_out" ? t("mobile.cover.offersOut") : data.status.state === "accepted_pending_confirmation" ? t("mobile.cover.accepted", { name: data.status.hold.worker.displayName }) : data.status.state === "confirmed" ? t("mobile.cover.confirmed") : data.status.state === "no_cover" ? t("mobile.cover.noCover") : t("mobile.cover.proposed");
  const deadline = data?.status.state === "offers_out" ? data.status.replyBy : data?.status.state === "accepted_pending_confirmation" ? data.status.hold.confirmBy : null;
  const start = data?.status.state === "offers_out" ? data.status.sentAt : data?.status.state === "accepted_pending_confirmation" ? data.status.hold.acceptedAt : null;
  const allowPropose = state === "no_cover" || (state === "gap" && (!data?.actions.canIssue || !data.candidates.some(isCandidateEligible)));
  const busy = commandState === "sending" || commandState === "checking"; const ready = status === "ready";
  const dock = !data ? undefined : <Dock primary={state === "confirmed" || state === "new_visit_proposed" ? { label: t("mobile.cover.viewShift"), onPress: onShift } : state === "accepted_pending_confirmation" ? { label: t("mobile.cover.review", { name: data.status.hold.worker.displayName }), onPress: onReview, live: true, disabled: !ready || !data.actions.canConfirm || busy } : state === "offers_out" ? { label: t("mobile.cover.confirmCover"), onPress: onReview, disabled: true } : allowPropose ? { label: t("mobile.cover.propose"), onPress: onPropose, disabled: !ready } : { label: t("mobile.cover.send", { count: selected.length }), onPress: onSend, live: true, disabled: !ready || !data.actions.canIssue || !selected.length || busy }} context={state === "offers_out" ? t("mobile.cover.waiting") : state === "gap" && !selected.length && !allowPropose ? t("mobile.cover.selectFirst") : undefined} />;
  const response = (c: Candidate) => { const r = c.response; if (!r) return isCandidateEligible(c) ? t("mobile.cover.available") : t("mobile.cover.ineligible"); const labels = { offered: t("mobile.cover.offered"), on_hold: t("mobile.cover.onHold"), held: t("mobile.cover.held"), confirmed: t("mobile.cover.assigned"), declined: t("mobile.cover.declined"), withdrawn: t("mobile.cover.withdrawn"), not_confirmed: t("mobile.cover.notConfirmed"), expired: t("mobile.cover.expired"), filled_elsewhere: t("mobile.cover.filledElsewhere") }; return `${labels[r.state]} · ${time(r.at)}`; };
  return <Screen title={t("mobile.cover.title")} navigation={{ kind: "back", label: t("mobile.cover.back"), onPress: onBack }} dock={dock}>
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.cover.loading")}</Copy>}
    {(status === "error" || status === "offline") && <><Copy>{t("mobile.cover.unavailable")}</Copy><Button label={t("mobile.cover.retry")} onPress={onRetry} /></>}
    {commandState === "checking" && <Copy accessibilityLiveRegion="polite">{t("mobile.cover.checking")}</Copy>}{commandState === "failed" && <Copy>{t("mobile.cover.failed")}</Copy>}
    {data && <><Copy variant="supporting">{data.shift.reference} · {data.shift.task}</Copy>
      <LiveCapsule state={active ? "crewConfirmed" : "quiet"} stateLabel={statusLabel} source={t("mobile.cover.search")} reference={data.shift.reference} time={deadline === null ? time(data.shift.window.startsAt) : time(deadline)} zoneLine={data.shift.siteZone} provenance={t("mobile.cover.visitStarts", { time: time(data.shift.window.startsAt) })} accessibilityLabel={[t("mobile.cover.search"), statusLabel, deadline === null ? time(data.shift.window.startsAt) : time(deadline), data.shift.siteZone].join(", ")} />
      <Copy variant="supporting">{t("mobile.cover.stages")}</Copy>
      {cardControls}
      {deadline !== null && start !== null && (deadline > now && ready ? <OfferClock state="running" remaining={t("mobile.cover.minutes", { count: Math.max(0, Math.ceil((deadline - now) / 60000)) })} fraction={Math.max(0, Math.min(1, (deadline - now) / (deadline - start)))} deadline={data.status.state === "offers_out" ? t("mobile.cover.replyBy", { time: time(deadline) }) : t("mobile.cover.confirmBy", { time: time(deadline) })} /> : <OfferClock state="expired" statusLabel={t("mobile.cover.checking")} deadline={data.status.state === "offers_out" ? t("mobile.cover.replyBy", { time: time(deadline) }) : t("mobile.cover.confirmBy", { time: time(deadline) })} />)}
      <Card><Copy variant="label">{t("mobile.cover.customer")}</Copy><Copy>{data.customerUpdate.state === "not_shared" ? t("mobile.cover.notShared") : data.customerUpdate.kind === "cover_arranging" ? t("mobile.cover.coverArranging") : t("mobile.cover.crewUpdated")}</Copy>{data.customerUpdate.state === "published" && <Copy variant="supporting">{t("mobile.cover.shared", { time: time(data.customerUpdate.publishedAt) })}</Copy>}</Card>
      <Card><Copy variant="sectionTitle">{t("mobile.cover.crew")}</Copy><Copy variant="supporting">{t("mobile.cover.select")}</Copy>
        {data.candidates.map(c => { const selectable = state === "gap" && data.actions.canIssue && isCandidateEligible(c) && ready; const checked = selected.includes(c.membershipId); return <Pressable key={c.membershipId} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: !selectable }} disabled={!selectable} onPress={() => onToggle(c.membershipId)} style={{ minHeight: 56, paddingVertical: space.grid[3], borderBottomWidth: 1, borderColor: color.outline, flexDirection: "row", alignItems: "center", gap: space.grid[3] }}><View style={{ width: 40, height: 40, borderRadius: radius.card, backgroundColor: color.subtle, alignItems: "center", justifyContent: "center" }}><Copy variant="label">{c.displayName.split(/\s+/).map(x => x[0]).slice(0, 2).join("")}</Copy></View><View style={{ flex: 1, minWidth: 0 }}><Copy variant="label">{c.displayName}</Copy><Copy variant="supporting">{response(c)}</Copy></View>{state === "gap" && <Copy>{checked ? "●" : "○"}</Copy>}</Pressable>; })}
        {data.actions.canClose && state === "offers_out" && <><Button variant="quiet" label={t("mobile.cover.closeDelivery")} onPress={() => onCloseRound("delivery")} disabled={!ready || busy} /><Button variant="quiet" label={t("mobile.cover.closeSafety")} onPress={() => onCloseRound("safety")} disabled={!ready || busy} /></>}
      </Card>
      <Card><Copy variant="label">{t("mobile.cover.pool")}</Copy></Card>
      <Card><Copy variant="sectionTitle">{t("mobile.cover.newVisit")}</Copy><Copy>{allowPropose ? t("mobile.cover.newVisitHelp") : t("mobile.cover.locked")}</Copy>{allowPropose && <Button variant="neutral" label={t("mobile.cover.propose")} onPress={onPropose} disabled={!ready} />}</Card>
    </>}
  </Screen>;
}
