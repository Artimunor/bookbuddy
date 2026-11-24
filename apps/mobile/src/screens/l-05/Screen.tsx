import { cancelSessionBookingRoute, getSessionBookingRoute, respondToSessionChangeRoute, sessionBookingIdSchema, submitSessionBookingFeedbackRoute, type CustomerSessionBooking } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useRef, useState } from "react";
import { AppState, Linking, View } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useApiAccess } from "../../api/provider";
import { useFormat, useT } from "../../i18n";
import type { CachedSessionBooking } from "../../repository/cache";
import { useLastConfirmed, useProjection } from "../../repository/hooks";
import { useSession } from "../../session";
import { useStatusCards } from "../../system/status-cards";
import { Button, Card, Dock, ListRow, Screen, Sheet } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { LiveCapsule, TwoClock, type LiveCapsuleProps } from "../../ui/live";
import { dayKey, holdHref, Notice, Separator, SessionFact, SessionState, useSessionDisplay, useSessionsBack, type Agreement } from "../l-01/common";
import { useDeadline } from "../s-02/flow";
import { confirmAction } from "../s-17/confirmAction";
import { FeedbackSheet, type FeedbackDraft } from "./Feedback";

type Choice = "accept" | "decline" | "cancel";
type Attempt = { booking: CustomerSessionBooking; choice: Choice };
const emptyFeedback: FeedbackDraft = { stars: 0, comment: "" };

export default function CustomerSessionBookingScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  return <BookingRoute key={`${session?.sessionId}:${session?.activeContext?.contextId}:${id}`} id={id} />;
}

function BookingRoute({ id }: { id: string }) {
  const router = useRouter();
  const onBack = useSessionsBack();
  const t = useT();
  const valid = sessionBookingIdSchema.safeParse(id).success;
  const remote = useRemote(getSessionBookingRoute, { params: { id } }, { enabled: valid });
  const { offline } = useApiAccess();
  const snapshot = useProjection("session_booking", offline && valid ? id : "");
  const lastConfirmed = useLastConfirmed();
  const respond = useCommand(respondToSessionChangeRoute, { resourceId: id });
  const cancel = useCommand(cancelSessionBookingRoute, { resourceId: id });
  const feedback = useCommand(submitSessionBookingFeedbackRoute, { resourceId: id });
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [draft, setDraft] = useState(emptyFeedback);
  const [pendingFeedback, setPendingFeedback] = useState<{ stars: number; comment?: string }>();
  const { startSessionCard, active } = useStatusCards();
  const [followFailed, setFollowFailed] = useState(false);
  const [following, setFollowing] = useState(false);
  const [pending, setPending] = useState<Attempt | null>(null);
  const [commandFailed, setCommandFailed] = useState(false);
  const locked = useRef(false);
  const booking = remote.status === "ready" ? remote.data : null;
  const current = useRef(booking);
  current.current = booking;
  const checking = respond.state === "checking" || cancel.state === "checking";
  const checkingFeedback = feedback.state === "checking" && !!pendingFeedback && !!booking?.canGiveFeedback;
  const busy = respond.state === "sending" || cancel.state === "sending" || feedback.state === "sending";

  async function send(intent: Attempt) {
    if (locked.current) return "uncertain";
    const { booking: reviewed, choice } = intent;
    const proposal = reviewed.proposal;
    if (choice !== "cancel" && proposal?.state !== "pending") return "invalidated";
    locked.current = true;
    setCommandFailed(false);
    try {
      const result = choice === "cancel" ? await cancel.run({ params: { id }, body: { payload: {
        bookingRevision: reviewed.revision, termsHash: reviewed.agreement.version.terms.hash,
      } } }) : await respond.run({ params: { id }, body: { payload: {
        bookingRevision: reviewed.revision, proposalId: proposal!.id, version: proposal!.version, decision: choice,
      } } });
      if (result.ok) {
        remote.seed(result.data, result.meta.serverTime);
        setPending(null);
        return "confirmed";
      }
      if (result.error.code === "INTERNAL_ERROR" || ("delivery" in result.error && result.error.delivery === "unknown")) {
        setPending(intent);
        return "uncertain";
      }
      setPending(null);
      setCommandFailed(true);
      return "invalidated";
    } finally { locked.current = false; }
  }

  function ask(choice: Choice) {
    if (!booking || offline || busy || checking) return;
    if (choice === "cancel" ? !booking.actions.cancel : !booking.actions.respond || booking.proposal?.state !== "pending") return;
    const newTime = booking.proposal && (booking.proposal.proposed.startsAt !== booking.agreement.startsAt || booking.proposal.proposed.endsAt !== booking.agreement.endsAt);
    const key = choice === "cancel" ? "mobile.laterCustomer.cancelBooking" : choice === "decline" ? "mobile.laterCustomer.declineChange" :
      newTime ? "mobile.laterCustomer.acceptNewTime" : "mobile.laterCustomer.acceptChange";
    const label = choice === "cancel" ? t("mobile.laterCustomer.cancelBooking") : choice === "decline" ? t("mobile.laterCustomer.declineChange") :
      newTime ? t("mobile.laterCustomer.acceptNewTime") : t("mobile.laterCustomer.acceptChange");
    const item = `${booking.reference} · ${booking.agreement.version.title}${choice !== "cancel" && booking.proposal ? ` · ${t("mobile.laterCustomer.changeVersion", { number: booking.proposal.version })}` : ""}`;
    confirmAction(router, {
      title: label, actionLabel: label, actionLabelKey: key, item, actor: booking.bookerName, role: booking.provider.name,
      effects: [choice === "cancel" ? t("mobile.laterCustomer.cancelEffect") : choice === "accept" ? t("mobile.laterCustomer.acceptEffect") : t("mobile.laterCustomer.declineEffect")],
      destructive: choice !== "accept", onReview: () => { void remote.refresh(); },
      onConfirm: async () => current.current === booking ? send({ booking, choice }) : "invalidated",
    });
  }

  async function sendFeedback(payload: { stars: number; comment?: string }) {
    if (locked.current || offline) return "invalidated";
    locked.current = true;
    try {
      const result = await feedback.run({ params: { id }, body: { payload } });
      if (result.ok) {
        remote.seed(result.data, result.meta.serverTime);
        setPendingFeedback(undefined);
        setDraft(emptyFeedback);
        return "confirmed";
      }
      if (result.error.code === "INTERNAL_ERROR" || ("delivery" in result.error && result.error.delivery === "unknown")) {
        setPendingFeedback(payload);
        return "uncertain";
      }
      setPendingFeedback(undefined);
      return "invalidated";
    } finally { locked.current = false; }
  }

  function reviewFeedback() {
    if (!booking?.canGiveFeedback || offline || busy || checkingFeedback || draft.stars < 1 || draft.stars > 5) return;
    const comment = draft.comment.trim();
    const payload = { stars: draft.stars, ...(comment ? { comment } : {}) };
    setFeedbackOpen(false);
    confirmAction(router, {
      title: t("mobile.laterCustomer.rateSession"), actionLabel: t("mobile.aftercare.send"), actionLabelKey: "mobile.aftercare.send",
      item: `${booking.reference} · ${booking.agreement.version.title}`, actor: booking.bookerName, role: booking.provider.name,
      effects: [t("mobile.aftercare.stars", { count: payload.stars }), ...(comment ? [comment] : []), t("mobile.laterCustomer.feedbackAudience")],
      onConfirm: async () => current.current?.id === booking.id && current.current.canGiveFeedback ? sendFeedback(payload) : "invalidated",
      onReview: () => { void remote.refresh(); },
    });
  }

  async function follow() {
    if (AppState.currentState !== "active" || offline || following) return;
    setFollowing(true);
    setFollowFailed(false);
    try { if (!await startSessionCard(id)) setFollowFailed(true); }
    catch { setFollowFailed(true); }
    finally { setFollowing(false); }
  }

  if (offline && snapshot) return <CachedPass snapshot={snapshot} lastConfirmed={lastConfirmed} onBack={onBack} />;
  if (!booking) {
    const state = !valid || remote.error?.code === "NOT_FOUND" ? "unavailable" :
      remote.status === "offline" ? "offline" : remote.status === "error" ? "error" : "loading";
    return <SessionState title={t("mobile.laterCustomer.bookingPass")} state={state} onBack={onBack} retry={() => { void remote.refresh(); }} />;
  }
  return <><BookingView booking={booking} onBack={onBack} onRespond={ask} onMove={() => { if (booking.actions.move) router.push(holdHref(booking.listingId, booking.id)); }}
    onMessage={booking.threadId ? () => router.push({ pathname: "/threads/[threadId]", params: { threadId: booking.threadId } } as Href) : undefined}
    onFollow={() => { void follow(); }} following={following} isFollowing={active?.target.kind === "session" && active.target.id === id} followFailed={followFailed}
    onFeedback={booking.canGiveFeedback ? () => setFeedbackOpen(true) : undefined} feedbackSent={!!feedback.result}
    busy={busy} checking={checking || checkingFeedback} commandFailed={commandFailed}
    onCheck={checkingFeedback && pendingFeedback ? () => { void sendFeedback(pendingFeedback); } :
      pending ? () => { void send(pending); } : undefined} />
    {feedbackOpen && booking.canGiveFeedback && !checkingFeedback && <FeedbackSheet booking={booking} draft={draft} onChange={setDraft}
      onClose={() => setFeedbackOpen(false)} onReview={reviewFeedback} />}
  </>;
}

function CachedPass({ snapshot, lastConfirmed, onBack }: { snapshot: CachedSessionBooking; lastConfirmed: number | null; onBack: () => void }) {
  const t = useT();
  const format = useFormat();
  const display = useSessionDisplay();
  const clock = display.clock(snapshot.slotStart, snapshot.slotEnd, snapshot.siteZone);
  const money = format.money(snapshot.price.amountMinor, snapshot.price.currency);
  return <Screen title={snapshot.listingTitle} navigation={{ kind: "back", label: t("mobile.laterCustomer.back"), onPress: onBack }}>
    <Notice tone="info" title={lastConfirmed ? t("mobile.laterCustomer.lastConfirmed", { time: display.absolute(lastConfirmed, snapshot.siteZone) }) : t("mobile.laterCustomer.offline")}>
      <Copy>{t("mobile.laterCustomer.readOnly")}</Copy>
    </Notice>
    <Card>
      <Copy variant="sectionTitle">{snapshot.state === "cancelled" ? t("mobile.laterCustomer.cancelled") : snapshot.state === "completed" ? t("mobile.laterCustomer.done") : t("mobile.laterCustomer.booked")}</Copy>
      <Copy>{snapshot.venue.publicName} · {snapshot.venue.locality}</Copy><Copy>{clock.date}</Copy>
      <TwoClock siteTime={clock.time} siteZone={clock.zone} viewerLine={clock.viewer} size="hero" />
      <Copy>{snapshot.price.basis === "per_appointment" ? t("mobile.laterCustomer.perAppointment", { amount: money }) : t("mobile.laterCustomer.perPerson", { amount: money })} · {t("mobile.laterCustomer.placesCount", { count: snapshot.partySize })}</Copy>
      {snapshot.hostDisplayName && <Copy>{t("mobile.laterCustomer.withHost", { name: snapshot.hostDisplayName })}</Copy>}
    </Card>
    {snapshot.substituteHost && snapshot.hostDisplayName && <Notice tone="info" title={t("mobile.laterCustomer.hostChanged")} />}
    {snapshot.pendingChange && <Notice tone="attention" title={t("mobile.laterCustomer.proposalPending")}>
      <Copy>{t("mobile.laterCustomer.respondBy", { time: display.absolute(snapshot.pendingChange.respondBy, snapshot.siteZone) })}</Copy>
    </Notice>}
  </Screen>;
}

type BookingViewProps = {
  booking: CustomerSessionBooking; viewerZone?: string; now?: number;
  onBack: () => void; onRespond: (choice: Choice) => void; onMove: () => void; onMessage?: () => void;
  onFeedback?: () => void; feedbackSent?: boolean;
  onFollow?: () => void; following?: boolean; isFollowing?: boolean; followFailed?: boolean; busy?: boolean; checking?: boolean;
  onCheck?: () => void; commandFailed?: boolean;
};

export function BookingView({ booking, viewerZone, now, onBack, onRespond, onMove, onMessage, onFeedback, feedbackSent, onFollow, following, isFollowing, followFailed, busy, checking, onCheck, commandFailed }: BookingViewProps) {
  const t = useT();
  const format = useFormat();
  const display = useSessionDisplay(viewerZone);
  const [sheet, setSheet] = useState<"directions" | "changes" | null>(null);
  const [mapsFailed, setMapsFailed] = useState(false);
  const { agreement, provider, reference, actions, cancellation, day, coordinatorName } = booking;
  const { version, startsAt, endsAt } = agreement;
  const { venue } = version;
  const { siteZone } = venue;
  const clock = display.clock(startsAt, endsAt, siteZone);
  const at = now ?? Date.now();
  const cancelled = booking.state === "cancelled";
  const done = booking.state === "completed" || day?.stage === "done";
  const today = !cancelled && !done && dayKey(startsAt, siteZone) === dayKey(at, siteZone);
  const startIn = useDeadline(today && now === undefined ? startsAt : 0, 0, today);
  const minutes = Math.ceil((now === undefined ? startIn : Math.max(0, startsAt - now)) / 60_000);
  const daysAway = Math.round((Date.parse(dayKey(startsAt, siteZone)) - Date.parse(dayKey(at, siteZone))) / 86_400_000);
  const stages = [t("mobile.laterCustomer.booked"), t("mobile.laterCustomer.today"), t("mobile.laterCustomer.doorsOpen"), t("mobile.laterCustomer.inSession"), t("mobile.laterCustomer.done")] as const;
  const current: 0 | 1 | 2 | 3 | 4 = done ? 4 : !day || cancelled ? 0 : day.stage === "doors_open" ? 2 : day.stage === "in_session" ? 3 : 1;
  const stage = cancelled ? t("mobile.laterCustomer.cancelled") : current ? stages[current] : today ? stages[1] : t("mobile.laterCustomer.bookedOn", { date: clock.date });
  const estimate = today && minutes && current < 3 ? t("mobile.laterCustomer.startsIn", { count: minutes }) : !cancelled && !done && daysAway > 0 ?
    daysAway === 1 ? t("mobile.laterCustomer.tomorrow") : t("mobile.laterCustomer.inDays", { count: daysAway }) : undefined;
  const host = booking.host.status === "confirmed" ? booking.host.host : null;
  const substitute = booking.host.status === "confirmed" && booking.host.isSubstitute;
  const hostName = host ? t("mobile.laterCustomer.withHost", { name: host.name }) : t("mobile.laterCustomer.hostUnconfirmed");
  const confirmedDay = day ? t("mobile.laterCustomer.confirmedOn", { name: day.byName, time: display.absolute(day.at, siteZone) }) : null;
  const lastFact = substitute && host ? t("mobile.laterCustomer.updatedBy", { name: host.confirmed.byName, time: display.absolute(host.confirmed.at, siteZone) }) :
    confirmedDay ?? (today ? t("mobile.laterCustomer.lastConfirmed", { time: display.absolute(booking.bookedAt, siteZone) }) : t("mobile.laterCustomer.bookedAt", { time: display.absolute(booking.bookedAt, siteZone) }));
  const provenance = cancelled && cancellation ? t("mobile.laterCustomer.cancelledBy", { name: cancellation.byName, time: display.absolute(cancellation.at, siteZone) }) : host ? lastFact : `${hostName} · ${lastFact}`;
  const lineLabel = t("mobile.laterCustomer.step", { step: current + 1 });
  const sessionLine: NonNullable<LiveCapsuleProps["sessionLine"]> = { steps: stages, current, accessibilityLabel: lineLabel,
    ...(cancelled ? { status: { state: "cancelled", label: t("mobile.laterCustomer.cancelled") } } : {}) };
  const proposal = booking.proposal?.state === "pending" ? booking.proposal : null;
  const proposalOpen = !!proposal && proposal.respondBy > at;
  const newTime = proposal && (proposal.proposed.startsAt !== startsAt || proposal.proposed.endsAt !== endsAt);
  const zoneLine = [clock.zone, clock.viewer].filter(Boolean).join(" · ");
  const message = { label: t("mobile.laterCustomer.messageStudio"), glyph: "◫", onPress: onMessage ?? onBack, disabledReason: onMessage ? undefined : t("mobile.laterCustomer.messageUnavailable") };
  const dock = cancelled ? undefined : checking ? <Dock context={t("mobile.laterCustomer.checkingResponse")} primary={{ label: t("mobile.laterCustomer.checkResult"), onPress: onCheck ?? onBack, disabled: !onCheck, busy }} /> :
    done ? onFeedback ? <Dock primary={{ label: t("mobile.laterCustomer.rateSession"), onPress: onFeedback, busy }} /> : undefined :
    proposal && actions.respond && proposalOpen ? <Dock context={t("mobile.laterCustomer.respondBy", { time: display.absolute(proposal.respondBy, siteZone) })}
      primary={{ label: newTime ? t("mobile.laterCustomer.acceptNewTime") : t("mobile.laterCustomer.acceptChange"), onPress: () => onRespond("accept"), busy }} secondary={{ label: t("mobile.laterCustomer.declineChange"), onPress: () => onRespond("decline"), disabled: busy }} /> :
    today ? <Dock primary={{ label: t("mobile.laterCustomer.directions"), onPress: () => { setMapsFailed(false); setSheet("directions"); } }} secondary={onMessage ? { ...message, iconOnly: true, glyph: "◫" } : undefined} /> : <Dock primary={message} />;
  const free = !cancelled && !done && agreement.freeCancellationUntil > at && (actions.move || actions.cancel);
  return <>
    <Screen title={version.title} subtitle={`${reference} · ${venue.name} · ${venue.locality}`}
      navigation={{ kind: "back", label: t("mobile.laterCustomer.back"), onPress: onBack }} dock={dock}>
      <LiveCapsule size="hero" state={cancelled ? "paused" : done ? "finished" : current ? "crewConfirmed" : today ? "quiet" : "booked"} pulse={!cancelled && !!day && !done}
        stateLabel={stage} source={provider.name} reference={reference} time={clock.time} zoneLine={zoneLine} estimate={estimate || undefined}
        sessionLine={sessionLine} provenance={provenance} crew={!cancelled && host ? { audience: "customer", people: [{ id: host.name, name: host.name, initials: host.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("") }] } : undefined}
        accessibilityLabel={[version.title, stage, estimate, clock.time, clock.zone, clock.viewer, !cancelled && host ? hostName : null, provenance, lineLabel].filter(Boolean).join(", ")} />
      {cancelled && <Notice tone="critical" title={t("mobile.laterCustomer.cancelled")}><Copy>{provenance}</Copy></Notice>}
      {!cancelled && substitute && host && <Notice tone="info" title={t("mobile.laterCustomer.hostChanged")}>
        <View style={{ gap: 4 }}>
          <Copy>{t("mobile.laterCustomer.hostChangedBody", { name: host.name })}</Copy>
          <Copy>{t("mobile.laterCustomer.sameTimePlacePrice")}</Copy>
          <Copy>{t("mobile.laterCustomer.stillTaught", { language: display.language(version.language) })}</Copy>
        </View>
      </Notice>}
      {!cancelled && booking.host.status === "arranging" && <Notice tone="attention" title={t("mobile.laterCustomer.hostArranging")}>
        {coordinatorName && <Copy>{t("mobile.laterCustomer.coordinator", { name: coordinatorName })}</Copy>}
        {booking.host.nextUpdateAt !== null && <Copy>{t("mobile.laterCustomer.nextUpdate", { time: display.absolute(booking.host.nextUpdateAt, siteZone) })}</Copy>}
      </Notice>}
      {proposal && !cancelled && <ChangeCard agreement={agreement} proposal={proposal} viewerZone={viewerZone} />}
      {commandFailed && <Notice tone="critical" title={t("mobile.laterCustomer.changeFailed")} />}
      {feedbackSent && <Notice tone="success" title={t("mobile.laterCustomer.feedbackSent")} />}
      {today && <Notice tone="info" title={t("mobile.laterCustomer.followTitle")}>
        <Copy>{t("mobile.laterCustomer.followBody")}</Copy>
        <Button variant="neutral" label={isFollowing ? t("mobile.laterCustomer.following") : t("mobile.laterCustomer.turnOn")} onPress={onFollow ?? onBack} busy={following} disabled={isFollowing || !onFollow} />
        {followFailed && <Copy accessibilityLiveRegion="polite">{t("mobile.laterCustomer.followFailed")}</Copy>}
      </Notice>}
      {!cancelled && <Card dense>
        {!done && <><SessionFact glyph="⌑" title={t("mobile.laterCustomer.checkIn")} detail={`${venue.arrivalNote} · ${venue.accessNote}`} /><Separator /></>}
        <SessionFact glyph="€" title={t("mobile.laterCustomer.dueToProvider", { amount: format.money(agreement.totalMinor, version.price.currency) })}
          detail={`${display.price(version.price)} · ${t("mobile.laterCustomer.payProvider", { name: provider.name })} ${t("mobile.laterCustomer.noPayment")}`} />
        {free && !checking && <><Separator /><ListRow glyph="□" label={t("mobile.laterCustomer.changeCancel")}
          description={t("mobile.laterCustomer.freeUntil", { time: display.absolute(agreement.freeCancellationUntil, siteZone) })}
          onPress={() => setSheet("changes")} disabled={busy || proposalOpen} /></>}
      </Card>}
      {!!coordinatorName && !cancelled && <Copy variant="supporting">{t("mobile.laterCustomer.coordinator", { name: coordinatorName })}</Copy>}
    </Screen>
    {sheet === "directions" && <Sheet visible title={t("mobile.laterCustomer.directions")} closeLabel={t("mobile.laterCustomer.close")} onClose={() => setSheet(null)}
      dock={<Dock primary={{ label: t("mobile.laterCustomer.openMaps"), onPress: () => {
        const destination = encodeURIComponent(`${venue.address}, ${venue.locality}`);
        void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${destination}`).catch(() => setMapsFailed(true));
      } }} />}>
      <Copy variant="sectionTitle">{venue.name}</Copy><Copy>{venue.address} · {venue.locality}</Copy><Copy>{venue.arrivalNote}</Copy><Copy>{venue.accessNote}</Copy>
      {mapsFailed && <Notice tone="critical" title={t("mobile.laterCustomer.mapsFailed")} />}
    </Sheet>}
    {sheet === "changes" && <Sheet visible title={t("mobile.laterCustomer.changeCancel")} closeLabel={t("mobile.laterCustomer.close")} onClose={() => setSheet(null)}>
      <Copy>{t("mobile.laterCustomer.freeUntil", { time: display.absolute(agreement.freeCancellationUntil, siteZone) })}</Copy>
      {free && actions.move && <Button label={t("mobile.laterCustomer.changeTime")} onPress={() => { setSheet(null); onMove(); }} />}
      {free && actions.cancel && <Button label={t("mobile.laterCustomer.cancelBooking")} variant="destructive" onPress={() => { setSheet(null); onRespond("cancel"); }} />}
    </Sheet>}
  </>;
}

function ChangeCard({ agreement, proposal, viewerZone }: { agreement: Agreement; proposal: NonNullable<CustomerSessionBooking["proposal"]>; viewerZone?: string }) {
  const t = useT();
  const format = useFormat();
  const display = useSessionDisplay(viewerZone);
  const proposed = proposal.proposed;
  const oldVenue = agreement.version.venue;
  const newVenue = proposed.version.venue;
  const sameTime = agreement.startsAt === proposed.startsAt && agreement.endsAt === proposed.endsAt && oldVenue.siteZone === newVenue.siteZone;
  const samePlace = oldVenue.id === newVenue.id && oldVenue.address === newVenue.address;
  const sameLanguage = agreement.version.language === proposed.version.language;
  const samePrice = agreement.totalMinor === proposed.totalMinor && agreement.version.price.currency === proposed.version.price.currency && agreement.version.price.basis === proposed.version.price.basis;
  const unchanged = [sameTime && t("mobile.laterCustomer.sameTime"), samePlace && t("mobile.laterCustomer.samePlace"), sameLanguage && t("mobile.laterCustomer.sameLanguage"), samePrice && t("mobile.laterCustomer.samePrice")].filter(Boolean).join(" · ");
  const comparison = [[t("mobile.laterCustomer.booked"), agreement], [t("mobile.laterCustomer.proposed"), proposed]] as const;
  return <Notice tone="attention" title={sameTime ? t("mobile.laterCustomer.proposalPending") : t("mobile.laterCustomer.proposalTime")}>
    <Copy>{t("mobile.laterCustomer.originalStillBooked")}</Copy>
    <Copy variant="supporting">{t("mobile.laterCustomer.changeVersion", { number: proposal.version })} · {t("mobile.laterCustomer.updatedBy", { name: proposal.sent.byName, time: display.absolute(proposal.sent.at, oldVenue.siteZone) })}</Copy>
    {comparison.map(([label, item]) => {
      const { venue, language, price } = item.version;
      const clock = display.clock(item.startsAt, item.endsAt, venue.siteZone);
      return <View key={label} style={{ gap: 4 }}><Separator /><Copy variant="label">{label} · {clock.date}</Copy>
        <TwoClock siteTime={clock.time} siteZone={clock.zone} viewerLine={clock.viewer} />
        {!samePlace && <Copy>{venue.name} · {venue.address} · {venue.locality}</Copy>}
        {!sameLanguage && <Copy>{t("mobile.laterCustomer.taughtIn", { language: display.language(language) })}</Copy>}
        {!samePrice && <Copy>{format.money(item.totalMinor, price.currency)} · {display.price(price)}</Copy>}
      </View>;
    })}
    {!!unchanged && <Copy variant="supporting">{unchanged}</Copy>}
  </Notice>;
}
