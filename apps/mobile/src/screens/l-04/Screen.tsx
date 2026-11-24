import { bookSessionHoldRoute, getSessionBookingRoute, moveSessionBookingRoute, releaseSessionHoldRoute, type CustomerSessionBooking, type RouteResponse, type SessionHoldProjection } from "@bookbuddy/api-contract";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, usePreventRemove, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useCommand, useSeedRemote } from "../../api";
import { useApiAccess } from "../../api/provider";
import { useFormat, useT } from "../../i18n";
import { Button, Card, Dock, Screen, Sheet } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { OfferClock, TwoClock } from "../../ui/live";
import { bookingHref, detailHref, holdDuration, holdHref, Notice, Separator, SessionState, useSessionDisplay, useSessionsBack } from "../l-01/common";
import { useSessionDetail } from "../l-02/Screen";
import { useDeadline } from "../s-02/flow";
import { clearCheckout, readCheckout, useCheckoutScope, type Checkout } from "./checkout";

type Failure = Extract<RouteResponse<typeof bookSessionHoldRoute.output>, { status: "not_booked" }>["failure"] | { reason: "rejected" };
type ReviewState = "held" | "processing" | "checking" | "booked" | "not_booked";

export default function ReviewSessionScreen() {
  const { listingId = "", holdId = "" } = useLocalSearchParams<{ listingId: string; holdId?: string }>();
  const scope = useCheckoutScope();
  const checkout = readCheckout(scope, listingId, holdId);
  const onBack = useSessionsBack(detailHref(listingId));
  const t = useT();
  return checkout ? <CheckoutScreen key={checkout.hold.id} checkout={checkout} /> :
    <SessionState title={t("mobile.laterCustomer.review")} state="unavailable" onBack={onBack} />;
}

function CheckoutScreen({ checkout }: { checkout: Checkout }) {
  const { hold, clockOffset, bookingId, moveRevision } = checkout;
  const router = useRouter();
  const seed = useSeedRemote();
  const { offline, isOffline, requests } = useApiAccess();
  const moveId = hold.moveFrom?.id;
  const book = useCommand(bookSessionHoldRoute, { resourceId: hold.id });
  const move = useCommand(moveSessionBookingRoute, { resourceId: moveId });
  const release = useCommand(releaseSessionHoldRoute, { resourceId: hold.id });
  const detail = useSessionDetail(hold.listingId, undefined, false);
  const [failure, setFailure] = useState<Failure>();
  const [leaving, setLeaving] = useState(false);
  const [releasedFailed, setReleaseFailed] = useState(false);
  const busyRef = useRef(false);
  const uncertain = useRef(false);
  const closed = useRef(false);
  const releaseLatest = useRef(release.run);
  releaseLatest.current = release.run;
  const left = useDeadline(hold.expiresAt, clockOffset, true);
  const command = moveId ? move : book;
  const checking = command.state === "checking" || uncertain.current;
  const processing = command.state === "sending";
  const ended = !left && !checking;
  const currentFailure = failure ?? (ended ? { reason: "expired" as const, expiresAt: hold.expiresAt } : undefined);
  const disableBack = usePreventRemove(true, () => { void leave(); });
  const liveCheckout = useRef(false);
  useEffect(() => {
    liveCheckout.current = true;
    return () => {
      liveCheckout.current = false;
      // The deferred check distinguishes an actual removal from React's development effect replay.
      void Promise.resolve().then(() => {
        if (liveCheckout.current || closed.current) return;
        clearCheckout(checkout);
        if (!busyRef.current && !uncertain.current && leftAt(hold.expiresAt, clockOffset) && !isOffline()) {
          void releaseLatest.current({ params: { id: hold.id }, body: { payload: {} } });
        }
      });
    };
  }, [checkout, hold.id, hold.expiresAt, clockOffset, isOffline]);

  async function leave() {
    if (busyRef.current || closed.current) return;
    busyRef.current = true;
    setLeaving(true);
    setReleaseFailed(false);
    try {
      if (!checking && leftAt(hold.expiresAt, clockOffset) && !isOffline()) {
        const result = await release.run({ params: { id: hold.id }, body: { payload: {} } });
        if (!result.ok && result.error.code !== "NOT_FOUND") { setReleaseFailed(true); return; }
      }
      if (!checking && (failure?.reason === "terms_changed" || failure?.reason === "slot_unavailable") && !isOffline()) await detail.refresh();
      if (!requests.active) return;
      closed.current = true;
      clearCheckout(checkout);
      disableBack();
      if (checking) {
        if (moveId) router.dismissTo(bookingHref(moveId));
        else router.dismissTo(detailHref(hold.listingId));
      } else router.replace(holdHref(hold.listingId, moveId));
    } finally { busyRef.current = false; if (!closed.current) setLeaving(false); }
  }

  async function submit() {
    if (busyRef.current || closed.current || offline || currentFailure || (!checking && !leftAt(hold.expiresAt, clockOffset))) return;
    if (moveId && moveRevision === undefined) return;
    busyRef.current = true;
    const { version, totalMinor } = hold.agreement;
    const reviewed = { listingVersionId: version.id, termsHash: version.terms.hash, totalMinor };
    try {
      // A status check resends the identical payload through the existing intent/receipt, never a new booking.
      const result = moveId && moveRevision !== undefined
        ? await move.run({ params: { id: moveId }, body: { payload: { holdId: hold.id, bookingRevision: moveRevision, ...reviewed } } })
        : await book.run({ params: { id: hold.id }, body: { payload: { id: bookingId, ...reviewed } } });
      if (!result.ok) {
        uncertain.current = result.error.code === "INTERNAL_ERROR" || ("delivery" in result.error && result.error.delivery === "unknown");
        if (!uncertain.current && requests.active && liveCheckout.current) setFailure({ reason: "rejected" });
        return;
      }
      uncertain.current = false;
      if (!requests.active || !liveCheckout.current) return;
      if (result.data.status === "not_booked" || result.data.status === "not_moved") {
        if (result.data.status === "not_moved") seed(getSessionBookingRoute, { params: { id: result.data.booking.id } }, result.data.booking, result.meta.serverTime);
        setFailure(result.data.failure);
        return;
      }
      const booked = result.data.booking;
      seed(getSessionBookingRoute, { params: { id: booked.id } }, booked, result.meta.serverTime);
      closed.current = true;
      clearCheckout(checkout);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      disableBack();
      if (moveId) router.dismissTo(bookingHref(booked.id));
      else router.replace(bookingHref(booked.id));
    } finally { busyRef.current = false; }
  }

  return <ReviewView hold={hold} left={left} state={processing ? "processing" : checking ? "checking" : currentFailure ? "not_booked" : "held"}
    failure={currentFailure} offline={offline} leaving={leaving} releaseFailed={releasedFailed} onBack={() => { void leave(); }} onBook={() => { void submit(); }} />;
}

function leftAt(deadline: number, offset: number) {
  return deadline > Date.now() + offset;
}

type ReviewProps = {
  hold: SessionHoldProjection; state: ReviewState; left: number; failure?: Failure; booked?: CustomerSessionBooking;
  offline?: boolean; leaving?: boolean; releaseFailed?: boolean; viewerZone?: string; onBack: () => void; onBook: () => void;
};

export function ReviewView({ hold, state, left, failure, booked, offline, leaving, releaseFailed, viewerZone, onBack, onBook }: ReviewProps) {
  const t = useT();
  const format = useFormat();
  const display = useSessionDisplay(viewerZone);
  const [terms, setTerms] = useState(false);
  const { agreement, host, provider } = hold;
  const { version, places, totalMinor } = agreement;
  const { siteZone } = version.venue;
  const expiry = display.instant(hold.expiresAt, siteZone);
  const clock = display.clock(agreement.startsAt, agreement.endsAt, siteZone);
  const amount = format.money(totalMinor, version.price.currency);
  const placeCount = version.format === "private" ? t("mobile.laterCustomer.oneAppointment") : t("mobile.laterCustomer.placesCount", { count: places });
  const minutes = Math.ceil(left / 60_000);
  const ended = state === "not_booked";
  const checking = state === "checking";
  const processing = state === "processing";
  const change = t("mobile.laterCustomer.changeTime");
  const book = hold.moveFrom ? t("mobile.laterCustomer.confirmMove") : t("mobile.laterCustomer.book");
  const primary = ended ? { label: t("mobile.laterCustomer.chooseAgain"), onPress: onBack, busy: leaving } : state === "booked" ?
    { label: t("mobile.laterCustomer.openBooking"), onPress: onBack } :
    { label: checking ? t("mobile.laterCustomer.checkBooking") : book, onPress: onBook, busy: processing, disabled: offline || leaving };
  return <>
    <Screen title={t("mobile.laterCustomer.review")} subtitle={`${hold.bookerName} · ${placeCount}`}
      navigation={{ kind: "back", label: t("mobile.laterCustomer.back"), onPress: onBack, disabled: processing || leaving }}
      dock={<Dock primary={primary} context={ended || state === "booked" ? undefined : offline ? t("mobile.laterCustomer.connectBook") : checking ? t("mobile.laterCustomer.checkingBooking") : t("mobile.laterCustomer.notYetBooked")} />}>
      {state === "booked" && booked ? <Notice tone="success" title={t("mobile.laterCustomer.booked")}><Copy>{booked.reference}</Copy></Notice> : ended ?
        <Notice tone="critical" title={t("mobile.laterCustomer.notBooked")}>
          <Copy>{failure?.reason === "expired" ? t("mobile.laterCustomer.holdEnded", { time: display.absolute(failure.expiresAt, siteZone) }) :
            failure?.reason === "terms_changed" ? t("mobile.laterCustomer.termsChanged") : t("mobile.laterCustomer.notBookedBody")}</Copy>
          {failure?.reason === "terms_changed" && <>
            <Copy>{t("mobile.laterCustomer.changedTotal", { old: amount, current: format.money(failure.current.totalMinor, failure.current.version.price.currency) })}</Copy>
            <Copy>{failure.current.version.terms.text}</Copy>
          </>}
        </Notice> : left > 0 ? <Notice tone="attention" title={t("mobile.laterCustomer.held")}>
          <OfferClock state={minutes <= 1 ? "urgent" : "running"} fraction={left / holdDuration}
            remaining={t("mobile.laterCustomer.shortMinutes", { count: minutes })} deadline={t("mobile.laterCustomer.heldUntil", { time: expiry.time })}
            statusLabel={[expiry.zone, expiry.viewer, minutes === 5 || minutes === 1 ? t("mobile.laterCustomer.minutesRemain", { count: minutes }) : null].filter(Boolean).join(" · ")} />
        </Notice> : <Notice tone="attention" title={t("mobile.laterCustomer.checkingBooking")}><Copy>{t("mobile.laterCustomer.heldUntil", { time: display.absolute(hold.expiresAt, siteZone) })}</Copy></Notice>}
      {releaseFailed && <Notice tone="critical" title={t("mobile.laterCustomer.releaseFailed")} />}
      <Card dense>
        <View style={{ gap: 3 }}>
          <Copy variant="sectionTitle">{version.title}</Copy><Copy variant="supporting">{version.venue.name} · {version.venue.locality}</Copy>
        </View>
        <Separator />
        <View style={{ gap: 5 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <Copy variant="label">{clock.date}</Copy>
            {!ended && !checking && state !== "booked" && <Button variant="quiet" label={change} onPress={onBack} disabled={processing || leaving} />}
          </View>
          <TwoClock siteTime={clock.time} siteZone={clock.zone} viewerLine={clock.viewer} size="hero" />
          <Copy variant="supporting">{[placeCount, t("mobile.laterCustomer.taughtIn", { language: display.language(version.language) }), host ? t("mobile.laterCustomer.withHost", { name: host.name }) : t("mobile.laterCustomer.hostUnconfirmed")].join(" · ")}</Copy>
          {!!hold.moveFrom && <Copy>{t("mobile.laterCustomer.originalUntilMove", { reference: hold.moveFrom.reference })}</Copy>}
        </View>
      </Card>
      <Card dense>
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
            <Copy variant="label">{t("mobile.laterCustomer.total")}</Copy><Copy variant="sectionTitle">{amount}</Copy>
          </View>
          <Copy variant="supporting">{t("mobile.laterCustomer.breakdown", { places: placeCount, price: display.price(version.price) })}</Copy>
        </View>
        <Separator />
        <View style={{ gap: 4 }}>
          <Copy variant="label">{t("mobile.laterCustomer.payProviderTitle")}</Copy>
          <Copy>{t("mobile.laterCustomer.payProvider", { name: provider.name })}</Copy><Copy variant="supporting">{t("mobile.laterCustomer.noPayment")}</Copy>
        </View>
      </Card>
      <Copy variant="supporting">{t("mobile.laterCustomer.freeUntil", { time: display.absolute(agreement.freeCancellationUntil, siteZone) })}</Copy>
      <Button variant="quiet" label={t("mobile.laterCustomer.readTerms")} onPress={() => setTerms(true)} />
    </Screen>
    {terms && <Sheet visible title={t("mobile.laterCustomer.readTerms")} closeLabel={t("mobile.laterCustomer.close")} onClose={() => setTerms(false)}>
      <Copy>{version.terms.text}</Copy>
    </Sheet>}
  </>;
}
