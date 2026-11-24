import { createSessionHoldRoute, getSessionBookingRoute, getSessionRoute, releaseSessionHoldRoute, sessionBookingIdSchema, type CustomerSessionDetail } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useApiAccess } from "../../api/provider";
import { useT } from "../../i18n";
import { Button, Card, Dock, Screen, Sheet } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { dayKey, detailHref, Notice, SessionSkeleton, useSessionDisplay, useSessionsBack, type Slot } from "../l-01/common";
import { DetailView, useSessionDetail } from "../l-02/Screen";
import { enterCheckout, useCheckoutScope } from "../l-04/checkout";
import { ChoiceRadio } from "../s-12/ChoiceRadio";

type Attempt = { id: string; slotId: string; places: number; moveBookingId?: string };
type Refusal = { reason: "places_unavailable" | "booking_unavailable" | "active_hold_exists" | "failed"; slotId: string; placesLeft: number };

export default function SessionSlotScreen() {
  const { listingId = "", move } = useLocalSearchParams<{ listingId: string; move?: string }>();
  const t = useT();
  const router = useRouter();
  const back = useSessionsBack(detailHref(listingId));
  const scope = useCheckoutScope();
  const { offline } = useApiAccess();
  const listing = useSessionDetail(listingId);
  const moving = useRemote(getSessionBookingRoute, { params: { id: move ?? "" } }, { enabled: sessionBookingIdSchema.safeParse(move).success });
  const original = moving.status === "ready" && moving.data.listingId === listingId && moving.data.actions.move ? moving.data : null;
  const [intentId, setIntentId] = useState(() => uuid.v4());
  const command = useCommand(createSessionHoldRoute, { resourceId: intentId });
  const release = useCommand(releaseSessionHoldRoute);
  const [page, setPage] = useState<{ cursor: string; detail: CustomerSessionDetail }>();
  const extra = useRemote(getSessionRoute, { params: { id: listingId }, query: { cursor: page?.cursor } }, { enabled: !!page });
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [availability, setAvailability] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const locked = useRef(false);
  const closed = useRef(false);
  const latestScope = useRef(scope);
  latestScope.current = scope;
  useEffect(() => { closed.current = false; return () => { closed.current = true; }; }, []);
  const root = listing.data?.audience === "customer" ? listing.data : null;
  const additional = extra.data?.audience === "customer" ? extra.data : null;
  const base = root && (page?.detail ?? root);
  const detail = base && additional ? { ...base, slots: [...base.slots, ...additional.slots], versions: [...base.versions, ...additional.versions], page: additional.page } : base;
  const cursor = page ? additional?.page.cursor : detail?.page.cursor;
  const busy = command.state === "sending";
  const checking = command.state === "checking";

  async function request(slot: Slot, places: number) {
    if (locked.current || closed.current || offline || !scope || (move && !original)) return;
    if (checking && !attempt) return;
    const payload = attempt ?? { id: intentId, slotId: slot.id, places, ...(original ? { moveBookingId: original.id } : {}) };
    if (!attempt) setAttempt(payload);
    locked.current = true;
    setRefusal(null);
    try {
      const result = await command.run({ params: { id: listingId }, body: { payload } });
      if (result.ok && result.data.status === "held") {
        if (closed.current || latestScope.current !== scope) {
          await release.run({ params: { id: result.data.id }, body: { payload: {} } });
          return;
        }
        closed.current = true;
        router.replace(enterCheckout({ scope, hold: result.data, bookingId: uuid.v4(), clockOffset: result.meta.serverTime - Date.now(), moveRevision: original?.revision }));
        return;
      }
      if (closed.current || latestScope.current !== scope) return;
      if (result.ok && result.data.status === "not_held") {
        const notHeld = result.data;
        setRefusal(notHeld);
        if (notHeld.reason === "places_unavailable") setAvailability(previous => new Map(previous).set(notHeld.slotId, notHeld.placesLeft));
        setAttempt(null);
        setIntentId(uuid.v4());
      } else if (!result.ok && result.error.code !== "INTERNAL_ERROR" && !("delivery" in result.error && result.error.delivery === "unknown")) {
        setRefusal({ reason: result.error.code === "NOT_FOUND" ? "booking_unavailable" : "failed", slotId: slot.id, placesLeft: slot.placesLeft });
        setAttempt(null);
        setIntentId(uuid.v4());
      }
    } finally { locked.current = false; }
  }
  function close() { closed.current = true; back(); }

  const visible = detail && (!move || !!original);
  return <>
    {original ? <Screen title={original.agreement.version.title}><Card><Copy variant="sectionTitle">{original.reference}</Copy><Copy>{t("mobile.laterCustomer.originalStillBooked")}</Copy></Card></Screen> :
      detail ? <DetailView detail={detail} onBack={close} onBrowse={close} /> : <Screen title={t("mobile.laterCustomer.sessions")}><SessionSkeleton /></Screen>}
    <SlotView detail={visible ? detail : null} fixedPlaces={original?.agreement.places} excludedSlotId={original?.agreement.slotId}
      blocked={offline ? "offline" : !scope || (move && !original && moving.status !== "idle" && moving.status !== "loading") || listing.status === "error" ? "unavailable" : undefined}
      refusal={refusal} availability={availability} busy={busy} checking={checking} recoverable={!!attempt} onClose={close}
      onHold={(slot, places) => { void request(slot, places); }} onMore={cursor && detail ? () => setPage({ cursor, detail }) : undefined}
      pageState={page ? extra.status === "loading" || extra.status === "idle" ? "loading" : extra.status === "error" ? "error" : undefined : undefined}
      onRetry={() => { void extra.refresh(); }} />
  </>;
}

type SlotViewProps = {
  detail: CustomerSessionDetail | null; viewerZone?: string; fixedPlaces?: number; excludedSlotId?: string; refusal?: Refusal | null;
  availability?: ReadonlyMap<string, number>; blocked?: "offline" | "unavailable"; busy?: boolean; checking?: boolean; recoverable?: boolean;
  initialSelection?: string;
  onClose: () => void; onHold: (slot: Slot, places: number) => void; onMore?: () => void; pageState?: "loading" | "error"; onRetry?: () => void;
};

export function SlotView({ detail, viewerZone, fixedPlaces, excludedSlotId, refusal, availability, blocked, busy, checking, recoverable, initialSelection, onClose, onHold, onMore, pageState, onRetry }: SlotViewProps) {
  const t = useT();
  const display = useSessionDisplay(viewerZone);
  const [day, setDay] = useState<string>();
  const [selection, setSelection] = useState(initialSelection);
  const [quantity, setQuantity] = useState(1);
  const [tooMany, setTooMany] = useState(false);
  useEffect(() => {
    if (refusal?.reason === "places_unavailable") setSelection(selected => selected === refusal.slotId ? undefined : selected);
  }, [refusal]);
  const versions = new Map(detail?.versions.map(version => [version.id, version]));
  const slots = detail?.slots.filter(slot => slot.id !== excludedSlotId && slot.state === "published" && versions.has(slot.listingVersionId)) ?? [];
  const days = new Map<string, { at: number; zone: string; slots: Slot[] }>();
  for (const slot of slots) {
    const zone = versions.get(slot.listingVersionId)!.venue.siteZone;
    const key = dayKey(slot.startsAt, zone);
    const existing = days.get(key);
    if (existing) existing.slots.push(slot);
    else days.set(key, { at: slot.startsAt, zone, slots: [slot] });
  }
  const selectedDay = day && days.has(day) ? day : days.keys().next().value;
  const times = selectedDay ? days.get(selectedDay)?.slots ?? [] : [];
  const chosen = times.find(slot => slot.id === selection);
  const version = (chosen && versions.get(chosen.listingVersionId)) ?? (times[0] && versions.get(times[0].listingVersionId)) ?? detail?.versions[0];
  const privateSlot = version?.format === "private";
  const places = fixedPlaces ?? (privateSlot ? 1 : quantity);
  const left = (slot: Slot) => availability?.get(slot.id) ?? slot.placesLeft;
  const shownChoice = chosen && left(chosen) >= places;
  const soldOut = times.length > 0 && times.every(slot => !left(slot));
  const selectedDayAt = (selectedDay ? days.get(selectedDay)?.at : undefined) ?? 0;
  const nextDay = [...days].find(([, item]) => item.at > selectedDayAt && item.slots.some(slot => left(slot) >= places));
  const other = times.find(slot => slot.id !== refusal?.slotId && left(slot) >= places);
  const next = other && versions.get(other.listingVersionId);
  const locked = !!(busy || checking || blocked);
  const primary = checking ? { label: t("mobile.laterCustomer.checkHold"), disabled: !!blocked || !chosen || !recoverable, onPress: () => { if (chosen) onHold(chosen, places); } } :
    soldOut && nextDay ? { label: t("mobile.laterCustomer.nextDay"), disabled: locked, onPress: () => { setDay(nextDay[0]); setSelection(undefined); } } :
    { label: privateSlot ? t("mobile.laterCustomer.holdAppointment") : t("mobile.laterCustomer.holdPlaces", { count: places }),
      disabled: !shownChoice || !!blocked || refusal?.reason === "active_hold_exists", busy, onPress: () => { if (shownChoice) onHold(chosen, places); } };
  return <Sheet visible title={t("mobile.laterCustomer.chooseTime")} closeLabel={t("mobile.laterCustomer.close")} onClose={onClose}
    dock={<Dock primary={primary} context={blocked === "offline" ? t("mobile.laterCustomer.connectHold") : checking ? t("mobile.laterCustomer.checkingHold") :
      refusal?.reason === "places_unavailable" && !shownChoice ? t("mobile.laterCustomer.chooseAnother") : t("mobile.laterCustomer.nothingHeld")} />}>
    {!!version && <Copy variant="supporting">{version.title} · {display.instant(times[0]?.startsAt ?? Date.now(), version.venue.siteZone).zone}</Copy>}
    {blocked && <Notice tone="attention" title={blocked === "offline" ? t("mobile.laterCustomer.offline") : t("mobile.laterCustomer.bookingUnavailable")} />}
    {!detail && !blocked && <SessionSkeleton />}
    {!!days.size && <View accessibilityRole="radiogroup" accessibilityLabel={t("mobile.laterCustomer.days")} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {[...days].map(([key, item]) => <ChoiceRadio key={key} pill label={display.date(item.at, item.zone)} disabled={locked} selected={selectedDay === key}
        onPress={() => { setDay(key); setSelection(undefined); setTooMany(false); }} />)}
    </View>}
    {!!version && <Card>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Copy variant="label">{privateSlot ? t("mobile.laterCustomer.oneAppointment") : t("mobile.laterCustomer.placesCount", { count: places })}</Copy>
        {!privateSlot && fixedPlaces === undefined && <View style={{ flexDirection: "row", gap: 8 }}>
          <Button iconOnly glyph="−" label={t("mobile.laterCustomer.removePlace")} variant="neutral" disabled={locked || quantity === 1}
            onPress={() => { setQuantity(quantity - 1); setTooMany(false); }} />
          <Button iconOnly glyph="+" label={t("mobile.laterCustomer.addPlace")} variant="neutral" disabled={locked || quantity >= Math.max(1, ...times.map(slot => slot.capacity))}
            onPress={() => { setQuantity(quantity + 1); if (chosen && quantity + 1 > left(chosen)) { setSelection(undefined); setTooMany(true); } }} />
        </View>}
      </View>
      <Copy variant="supporting">{display.price(version.price)}</Copy>
    </Card>}
    {tooMany && <Notice tone="attention" title={t("mobile.laterCustomer.tooMany")} />}
    {refusal && <Notice tone="critical" title={refusal.reason === "places_unavailable" ? refusal.placesLeft ? t("mobile.laterCustomer.fewerPlaces", { count: refusal.placesLeft, requested: places }) : t("mobile.laterCustomer.slotTaken") :
      refusal.reason === "active_hold_exists" ? t("mobile.laterCustomer.activeHold") : refusal.reason === "booking_unavailable" ? t("mobile.laterCustomer.bookingUnavailable") : t("mobile.laterCustomer.holdFailed")}>
      {refusal.reason === "places_unavailable" && other && next && <Copy>{t("mobile.laterCustomer.otherSlot", { time: display.instant(other.startsAt, next.venue.siteZone).time, count: left(other) })}</Copy>}
    </Notice>}
    <View accessibilityRole="radiogroup" accessibilityLabel={t("mobile.laterCustomer.times")} style={{ gap: 8 }}>
      {times.map(slot => {
        const item = versions.get(slot.listingVersionId)!;
        const clock = display.clock(slot.startsAt, slot.endsAt, item.venue.siteZone);
        const count = left(slot);
        const marker = !count ? t("mobile.laterCustomer.noPlaces") : item.format === "private" ? t("mobile.laterCustomer.available") : t("mobile.laterCustomer.placesLeft", { count });
        return count ? <ChoiceRadio key={slot.id} label={clock.time} description={clock.viewer} marker={marker} selected={shownChoice && selection === slot.id ? true : false}
          disabled={locked || count < (fixedPlaces ?? (item.format === "private" ? 1 : quantity))} onPress={() => { setSelection(slot.id); setTooMany(false); }} /> :
          <Notice key={slot.id} tone="neutral" title={clock.time}><Copy variant="supporting">{clock.viewer}</Copy><Copy variant="label">{marker}</Copy></Notice>;
      })}
    </View>
    {detail && !slots.length && <Copy>{t("mobile.laterCustomer.noTimes")}</Copy>}
    {onMore && <Button variant="neutral" label={t("mobile.laterCustomer.moreTimes")} onPress={onMore} disabled={locked} />}
    {pageState === "loading" && <Copy accessibilityLiveRegion="polite">{t("mobile.laterCustomer.loading")}</Copy>}
    {pageState === "error" && onRetry && <Button variant="neutral" label={t("mobile.laterCustomer.retry")} onPress={onRetry} disabled={locked} />}
    {!!slots.length && <Copy variant="supporting">{t("mobile.laterCustomer.holdNote")}</Copy>}
  </Sheet>;
}
