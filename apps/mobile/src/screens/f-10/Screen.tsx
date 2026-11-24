import { closeCoverRoute, getCoverRoute, getShiftRoute, issueCoverRoute, publishVisitUpdateRoute, type ForemanCover } from "@bookbuddy/api-contract";
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
import { Copy, controlMetrics } from "../../ui/controls/shared";
import { LiveCapsule } from "../../ui/live/LiveCapsule";
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
  const publish = useCommand(publishVisitUpdateRoute, { resourceId: data?.noCrewUpdate?.visitId });
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
  function publishNoCrew() {
    const basis = data?.noCrewUpdate;
    if (!data || !basis || remote.status !== "ready" || publish.state === "sending") return;
    // Reopening the confirmation after uncertain delivery checks the same update.
    const id = `no-crew-${data.gapId}-${basis.expectedRevision}`;
    const noCrew = t("mobile.liveVisit.noCrew");
    const checking = publish.state === "checking";
    confirmAction(router, {
      title: t("mobile.jobControl.shareTitle"),
      actionLabel: checking ? t("mobile.request.checkStatus") : t("mobile.jobControl.send"),
      actionLabelKey: checking ? "mobile.request.checkStatus" : "mobile.jobControl.send",
      item: data.shift.reference, actor: bootstrap?.account.displayName ?? "", role: t("mobile.cover.foreman"),
      effects: [t("mobile.jobControl.shared", { status: noCrew })], onReview: () => { void remote.refresh(); },
      onConfirm: async () => {
        const result = await publish.run({ params: { id: basis.visitId }, body: { expectedRevision: basis.expectedRevision,
          payload: { id, kind: "no_crew_available", gapId: data.gapId, bookedWindowId: basis.bookedWindowId } } });
        if (result.ok) {
          seedRemote(getCoverRoute, { params: { g: data.gapId } }, { ...data, noCrewUpdate: null,
            customerUpdate: { state: "published", kind: "no_crew_available", publishedAt: result.data.update.recordedAt, nextUpdateAt: null },
          }, result.meta.serverTime);
          return "confirmed";
        }
        if (result.error.code === "INTERNAL_ERROR" || ("delivery" in result.error && result.error.delivery === "unknown")) return "uncertain";
        await remote.refresh();
        return "invalidated";
      },
    });
  }
  const commandStates = [issue.state, close.state, publish.state];
  const commandState = commandStates.find(state => state === "sending" || state === "checking") ??
    (commandStates.includes("failed") ? "failed" : "idle");
  const cardControls = preferences.statusCardsEnabled ? <>
    {data?.actions.canIssue && <SwitchRow label={t("mobile.statusCards.coverPreference")} description={t("mobile.statusCards.coverDescription")} value={preferences.coverOptIn} onValueChange={coverOptIn => {
      setCardFailed(false);
      void changePreferences({ coverOptIn }).catch(() => setCardFailed(true));
    }} />}
    {cardFailed && <Copy accessibilityRole="alert">{t("mobile.statusCards.unavailable")}</Copy>}
  </> : undefined;
  return <CoverView data={data} status={remote.status} selected={selected} commandState={commandState} checkingNoCrew={publish.state === "checking"} cardControls={cardControls} onToggle={id => setSelected(current => current.includes(id) ? current.filter(x => x !== id) : current.length < 3 ? [...current, id] : current)} onSend={() => ask("issue")} onCloseRound={reason => ask(reason)} onReview={() => router.push(`/f/cover/${gapId}/confirm` as Href)} onShift={() => data && router.push(`/f/shifts/${data.shift.shiftId}` as Href)} onPropose={() => setOpenSchedule(true)} onPublishNoCrew={publishNoCrew} onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} />;
}

const currentStep = { gap: 0, offers_out: 1, accepted_pending_confirmation: 2, confirmed: 3, no_cover: 2, new_visit_proposed: 3 } as const;

export function CoverView({ data, status, selected, commandState = "idle", checkingNoCrew = false, now: fixedNow, cardControls, onToggle, onSend, onCloseRound, onReview, onShift, onPropose, onPublishNoCrew, onBack, onRetry }: { data: ForemanCover | null; status: RemoteStatus; selected: string[]; commandState?: CommandStatus; checkingNoCrew?: boolean; now?: number; cardControls?: ReactNode; onToggle: (id: string) => void; onSend: () => void; onCloseRound: (reason: "delivery" | "safety") => void; onReview: () => void; onShift: () => void; onPropose: () => void; onPublishNoCrew: () => void; onBack: () => void; onRetry: () => void }) {
  const t = useT(); const format = useFormat(); const { color, field, radius, space } = useBeaconTheme();
  const [clock, setClock] = useState(() => Date.now());
  const state = data?.status.state; const active = state === "offers_out" || state === "accepted_pending_confirmation";
  useEffect(() => { if (!active || fixedNow !== undefined || status !== "ready") return; const id = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(id); }, [active, fixedNow, status]);
  const now = fixedNow ?? clock;
  const statusLabel = !data ? "" : data.status.state === "gap" ? t("mobile.cover.gap") : data.status.state === "offers_out" ? t("mobile.cover.offersOut") : data.status.state === "accepted_pending_confirmation" ? t("mobile.cover.accepted", { name: data.status.hold.worker.displayName }) : data.status.state === "confirmed" ? t("mobile.cover.confirmed") : data.status.state === "no_cover" ? t("mobile.cover.noCover") : t("mobile.cover.proposed");
  const deadline = data?.status.state === "offers_out" ? data.status.replyBy : data?.status.state === "accepted_pending_confirmation" ? data.status.hold.confirmBy : null;
  const start = data?.status.state === "offers_out" ? data.status.sentAt : data?.status.state === "accepted_pending_confirmation" ? data.status.hold.acceptedAt : null;
  const allowPropose = state === "no_cover" || (state === "gap" && (!data?.actions.canIssue || !data.candidates.some(isCandidateEligible)));
  const busy = commandState === "sending" || commandState === "checking"; const ready = status === "ready";
  const offline = status === "offline";
  const time = (at: number) => {
    const value = format.siteTime(at, data?.shift.siteZone);
    return value.kind === "available" ? value.site.time : "";
  };
  const range = (window: ForemanCover["shift"]["window"]) => t("mobile.liveVisit.range", { start: time(window.startsAt), end: time(window.endsAt) });
  const zone = data ? format.siteTime(data.shift.window.startsAt, data.shift.siteZone) : null;
  const zoneLabel = zone?.kind === "available" ? format.zoneLabel(data?.shift.siteZone, zone.site) : "";
  const terminal = state === "no_cover" || state === "new_visit_proposed";
  const step = state ? currentStep[state] : 0;
  const steps = [t("mobile.cover.gap"), t("mobile.cover.offersOut"), terminal ? t("mobile.cover.noCover") : t("mobile.cover.stepAccepted"), terminal ? t("mobile.cover.propose") : t("mobile.cover.assigned")] as const;
  const stepLabel = t("mobile.cover.stepLabel", { step: step + 1, stage: steps[step] });
  const heroAt = deadline ?? (data?.status.state === "no_cover" ? data.status.endedAt : data?.status.state === "confirmed" ? data.status.confirmedAt : data?.status.state === "new_visit_proposed" ? data.status.proposedAt : data?.shift.window.startsAt);
  const heroTime = heroAt === undefined ? "" : time(heroAt);
  const heading = state === "offers_out" ? t("mobile.cover.offersReply") : state === "accepted_pending_confirmation" ? t("mobile.cover.confirmByLabel", { status: statusLabel }) : statusLabel;
  const live = active && ready && deadline !== null && deadline > now;
  const remaining = live && start !== null ? {
    remaining: t("mobile.cover.shortMinutes", { count: Math.ceil((deadline - now) / 60000) }),
    fraction: (deadline - now) / Math.max(1, deadline - start),
  } : undefined;
  const dock = !data ? undefined : <Dock primary={
    state === "confirmed" || state === "new_visit_proposed" ? { label: t("mobile.cover.viewShift"), onPress: onShift } :
    state === "accepted_pending_confirmation" ? { label: t("mobile.cover.review", { name: data.status.hold.worker.displayName }), onPress: onReview, live: true, disabled: !ready || !data.actions.canConfirm || busy } :
    state === "offers_out" ? { label: t("mobile.cover.confirmCover"), onPress: onReview, disabled: true } :
    allowPropose ? { label: t("mobile.cover.propose"), onPress: onPropose, disabled: !ready } :
    { label: selected.length ? t("mobile.cover.send", { count: selected.length }) : t("mobile.cover.sendOffers"), onPress: onSend, live: true, disabled: !ready || !data.actions.canIssue || !selected.length || busy }
  } context={offline ? t("mobile.cover.connect") : state === "offers_out" && deadline !== null ? t("mobile.cover.waitingBy", { time: time(deadline) }) : state === "gap" && !selected.length && !allowPropose ? t("mobile.cover.selectFirst") : undefined} />;
  const labels = { offered: t("mobile.cover.offered"), on_hold: t("mobile.cover.onHold"), held: t("mobile.cover.held"), confirmed: t("mobile.cover.assigned"), declined: t("mobile.cover.declined"), withdrawn: t("mobile.cover.withdrawn"), not_confirmed: t("mobile.cover.notConfirmed"), expired: t("mobile.cover.expired"), filled_elsewhere: t("mobile.cover.filledElsewhere") };
  const response = (c: Candidate) => !c.response ? isCandidateEligible(c) ? t("mobile.cover.available") : t("mobile.cover.ineligible") : `${labels[c.response.state]} · ${time(c.response.at)}`;
  const update = data?.customerUpdate;
  const published = update?.state === "published";
  const nextUpdate = published ? update.nextUpdateAt : null;
  const attention = nextUpdate !== null && nextUpdate - now <= 3 * 60_000;
  const customerInk = attention ? color.attentionInk : published ? color.infoInk : color.ink;
  const customerLabel = !published ? t("mobile.cover.notShared") :
    update.kind === "cover_arranging" ? t("mobile.cover.coverArranging") : update.kind === "no_crew_available" ? t("mobile.liveVisit.noCrew") : t("mobile.cover.crewUpdated");
  const asked = data?.candidates.filter(c => c.response).length ?? 0;
  const replied = data?.candidates.filter(c => c.response && ["held", "confirmed", "declined", "not_confirmed"].includes(c.response.state)).length ?? 0;
  const rowHeight = controlMetrics(field).rowMinHeight;
  const railBead = (value: string, badge: "live" | "ink" | "outline") => <View aria-hidden style={{ width: 24, height: 24, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: badge === "live" ? color.live : badge === "ink" ? color.brand : color.surface, borderColor: badge === "outline" ? color.outline : color.ink, borderWidth: 2 }}>
    <Copy variant="caption" style={{ color: badge === "live" ? color.onLive : badge === "ink" ? color.onBrand : color.ink }}>{value}</Copy>
  </View>;
  return <Screen title={t("mobile.cover.title")} subtitle={data ? `${data.shift.reference} · ${data.shift.task}` : undefined} navigation={{ kind: "back", label: t("mobile.cover.back"), onPress: onBack }} dock={dock}>
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.cover.loading")}</Copy>}
    {(status === "error" || status === "offline") && <><Copy>{t("mobile.cover.unavailable")}</Copy><Button label={t("mobile.cover.retry")} onPress={onRetry} /></>}
    {commandState === "checking" && <Copy accessibilityLiveRegion="polite">{t("mobile.cover.checking")}</Copy>}{commandState === "failed" && <Copy>{t("mobile.cover.failed")}</Copy>}
    {data && <>
      <LiveCapsule size="card" state={live ? "crewConfirmed" : state === "confirmed" ? "finished" : "quiet"} stateLabel={heading} source={t("mobile.cover.search")} reference={range(data.shift.window)}
        time={heroTime} zoneLine={zoneLabel} provenance={deadline !== null ? t("mobile.cover.visitStarts", { time: time(data.shift.window.startsAt) }) : ""}
        accessibilityLabel={[t("mobile.cover.search"), heading, heroTime, zoneLabel, stepLabel].join(", ")}
        line={{ kind: "cover", current: step, steps, accessibilityLabel: stepLabel }} coverClock={remaining} />
      <View style={{ borderRadius: radius.card, padding: space.grid[4], gap: space.grid[1], backgroundColor: attention ? color.attentionSoft : published ? color.infoSoft : color.subtle }}>
        <Copy variant="label" style={{ color: customerInk }}>{published ? t("mobile.foremanHome.customerSees", { status: customerLabel }) : t("mobile.cover.customer")}</Copy>
        <Copy variant="supporting" style={{ color: customerInk }}>{published ? t("mobile.cover.shared", { time: time(update.publishedAt) }) : customerLabel}
          {nextUpdate !== null && ` · ${now >= nextUpdate ? t("mobile.cover.overdue", { time: time(nextUpdate) }) : t("mobile.liveVisit.updateBy", { time: time(nextUpdate) })}`}
        </Copy>
        {data.noCrewUpdate && <Button variant="quiet" label={checkingNoCrew ? t("mobile.request.checkStatus") : t("mobile.jobControl.shareTitle")} onPress={onPublishNoCrew} disabled={!ready || (busy && !checkingNoCrew)} />}
      </View>
      <Card dense>
        <View style={{ gap: space.grid[field ? 4 : 3] }}>
          <View aria-hidden pointerEvents="none" style={{ position: "absolute", start: 9, width: 6, top: 12, bottom: 12, borderRadius: radius.pill, backgroundColor: color.subtle }} />
          <View style={{ flexDirection: "row", gap: space.grid[2], alignItems: "flex-start" }}>
            {railBead(state === "confirmed" ? "✓" : terminal ? "×" : "1", live ? "live" : "ink")}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Copy variant="label">{t("mobile.cover.crewRung")}</Copy>
              <Copy variant="supporting" style={{ color: color.muted }}>{state === "gap" ? t("mobile.cover.select") : t("mobile.cover.replyCount", { asked, replied })}</Copy>
              {data.candidates.map((candidate, index) => {
                const canChoose = state === "gap" && isCandidateEligible(candidate);
                const checked = selected.includes(candidate.membershipId);
                const selectable = canChoose && data.actions.canIssue && ready && !busy && (checked || selected.length < 3);
                const held = candidate.response?.state === "held";
                const offered = candidate.response?.state === "offered" || candidate.response?.state === "on_hold";
                const info = <><View aria-hidden style={{ width: 36, height: 36, borderRadius: radius.pill, borderWidth: 2, borderStyle: offered ? "dashed" : "solid", borderColor: held ? color.ink : color.outline, backgroundColor: held ? color.live : index % 2 ? color.personC : color.personD, alignItems: "center", justifyContent: "center" }}>
                  <Copy variant="caption" style={{ color: held ? color.onLive : color.ink }}>{candidate.displayName.trim().split(/\s+/).slice(0, 2).map(x => x[0]).join("")}</Copy>
                </View><View style={{ flex: 1, minWidth: 0 }}><Copy variant="label">{candidate.displayName}</Copy><Copy variant="supporting" style={{ color: color.muted }}>{response(candidate)}</Copy></View></>;
                const row = { minHeight: rowHeight, paddingVertical: space.grid[1], borderBottomWidth: 1, borderColor: color.separator, flexDirection: "row" as const, alignItems: "center" as const, gap: space.grid[2] };
                return canChoose ? <Pressable key={candidate.membershipId} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: !selectable }} disabled={!selectable} onPress={() => onToggle(candidate.membershipId)} style={row}>{info}<Copy aria-hidden>{checked ? "✓" : "○"}</Copy></Pressable>
                  : <View key={candidate.membershipId} style={row}>{info}</View>;
              })}
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: space.grid[2], alignItems: "flex-start" }}>
            {railBead(state === "new_visit_proposed" ? "✓" : "2", terminal || allowPropose ? "ink" : "outline")}
            <View style={{ flex: 1, minWidth: 0 }}><Copy variant="label">{t("mobile.cover.propose")}</Copy>
              <Copy variant="supporting" style={{ color: color.muted }}>{data.status.state === "new_visit_proposed" ? `${range(data.status.window)} · ${t("mobile.crewSchedule.waitingCustomer")}` : allowPropose ? t("mobile.cover.newVisitHelp") : state === "confirmed" ? t("mobile.cover.confirmed") : t("mobile.cover.locked")}</Copy>
            </View>
          </View>
        </View>
      </Card>
      {data.actions.canClose && state === "offers_out" && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.grid[1] }}>
        <Button variant="quiet" label={t("mobile.cover.closeDelivery")} onPress={() => onCloseRound("delivery")} disabled={!ready || busy} />
        <Button variant="quiet" label={t("mobile.cover.closeSafety")} onPress={() => onCloseRound("safety")} disabled={!ready || busy} />
      </View>}
      {cardControls}
    </>}
  </Screen>;
}
