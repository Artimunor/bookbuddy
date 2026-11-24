import { getCoverRoute, getSessionBookingRoute, getVisitLiveRoute, type CustomerSessionBooking } from "@bookbuddy/api-contract";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { useRemote } from "../../api";
import { useApiAccess } from "../../api/provider";
import { remoteRequestKey } from "../../api/requests";
import { useLocale, useT } from "../../i18n";
import { useAttendanceStatus, useProjection, useRepository } from "../../repository/hooks";
import { useSession } from "../../session";
import { cardScope, getStatusCards, reconcileStatusCards, refreshStatusCard, setStatusCardPreferences, setStatusCardScope, startStatusCard, stopStatusCard, subscribeStatusCards, type ActiveCard, type CardPreferences } from "./controller";
import { coverCardSource, sessionCardSource, shiftCardSource, visitCardSource, type StatusCardSource } from "./model";

export { setStatusCardPreferences } from "./controller";
export { coverCardSource, shiftCardSource, visitCardSource } from "./model";

export function useStatusCards() {
  const t = useT();
  const { locale } = useLocale();
  const { session, preferences: devicePreferences } = useSession();
  const displayZone = devicePreferences?.displayZone;
  const { client, requests, getConnection } = useApiAccess();
  const repo = useRepository();
  const key = cardScope(session)?.key;
  const { active, preferences, preferenceScope } = useSyncExternalStore(subscribeStatusCards, getStatusCards, getStatusCards);
  const start = useCallback((source: StatusCardSource) => startStatusCard(source, { t, locale, displayZone }, key), [key, t, locale, displayZone]);
  const refresh = useCallback((source: StatusCardSource) => refreshStatusCard(source, { t, locale, displayZone }, key), [key, t, locale, displayZone]);
  const startSessionCard = useCallback(async (bookingId: string): Promise<boolean> => {
    if (!client || !repo || Platform.OS === "web" || AppState.currentState !== "active" ||
        !preferences.statusCardsEnabled || preferenceScope !== key ||
        !requests.allows("context", repo) || session?.activeContext?.role !== "customer") return false;
    const input = { params: { id: bookingId } };
    const readKey = remoteRequestKey(getSessionBookingRoute, input);
    if (readKey === null) return false;
    const read = requests.read<CustomerSessionBooking>(repo, getSessionBookingRoute, readKey);
    const fence = () => ({ ...getConnection(), visibility: repo.visibilityGeneration });
    if (fence().offline) return false;
    if (read.stale) await read.load(signal => client.request(getSessionBookingRoute, input, { signal }), { getConnection: fence });
    const snapshot = read.getSnapshot(fence());
    if (snapshot.status !== "ready" || !requests.allows("context", repo)) return false;
    const source = sessionCardSource(snapshot.data);
    if (source.facts?.kind !== "session" || source.terminal) return false;
    // An explicit opt-in is only available on the booking's day, in the venue's clock.
    try {
      const day = new Intl.DateTimeFormat("en", { timeZone: source.zone, dateStyle: "short" });
      if (day.format(Date.now()) !== day.format(source.facts.startsAt)) return false;
    } catch { return false; }
    return start(source);
  }, [client, getConnection, repo, requests, session?.activeContext?.role, start, preferences.statusCardsEnabled, preferenceScope, key]);
  const stop = useCallback((id: string) => stopStatusCard(id, key), [key]);
  const changePreferences = useCallback((patch: Partial<CardPreferences>) => setStatusCardPreferences(patch, key), [key]);
  const scopedPreferences = preferenceScope === (key ?? null) ? preferences : { ...preferences, hideDetails: true, workerOptIn: null, coverOptIn: false };
  return { preferences: scopedPreferences, active: active && !active.stopPending && active.scopeKey === key ? active : null, start, startSessionCard, refresh, stop, changePreferences };
}

export function StatusCardHost() {
  const { session, status } = useSession();
  const context = useMemo(() => status === "loading" ? undefined : cardScope(session), [session, status]);
  const { active, preferences } = useSyncExternalStore(subscribeStatusCards, getStatusCards, getStatusCards);
  useLayoutEffect(() => { void setStatusCardScope(context).catch(() => undefined); }, [context]);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const onActive = () => { void reconcileStatusCards().catch(() => undefined); };
    const change = AppState.addEventListener("change", next => { if (next === "active") onActive(); });
    const focus = Platform.OS === "android" ? AppState.addEventListener("focus", onActive) : null;
    return () => { change.remove(); focus?.remove(); };
  }, []);
  if (!preferences.statusCardsEnabled || !active || active.stopPending || active.scopeKey !== context?.key) return null;
  switch (active.target.kind) {
    case "customer_visit": return <VisitStatus key={active.id} card={active} />;
    case "worker_shift": return <ShiftStatus key={active.id} card={active} />;
    case "foreman_cover": return <CoverStatus key={active.id} card={active} />;
    case "session": return <SessionStatus key={active.id} card={active} />;
  }
}

function useForeground() {
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", value => setForeground(value === "active"));
    return () => subscription.remove();
  }, []);
  return foreground;
}

function VisitStatus({ card }: { card: ActiveCard }) {
  // Observe existing role-scoped reads; a card never initiates a fetch or subscription.
  const read = useRemote(getVisitLiveRoute, { params: { id: card.target.id } }, { loadOnMount: false });
  const { refresh, stop } = useStatusCards();
  const foreground = useForeground();
  useEffect(() => {
    if (read.error?.code === "NOT_FOUND" || read.error?.code === "UNAUTHENTICATED") void stop(card.id).catch(() => undefined);
    else if (foreground && read.status === "ready" && "moments" in read.data) void refresh(visitCardSource(read.data)).catch(() => undefined);
  }, [foreground, card.id, read.status, read.data, read.error, refresh, stop]);
  return null;
}

function SessionStatus({ card }: { card: ActiveCard }) {
  const read = useRemote(getSessionBookingRoute, { params: { id: card.target.id } }, { loadOnMount: false });
  const synced = useProjection("session_booking", card.target.id);
  const seen = useRef<typeof synced>(null);
  const { refresh, stop } = useStatusCards();
  const foreground = useForeground();
  useEffect(() => {
    if ((synced && (synced.state !== "booked" || Date.now() >= synced.slotEnd)) ||
        read.error?.code === "NOT_FOUND" || read.error?.code === "UNAUTHENTICATED") {
      void stop(card.id).catch(() => undefined);
      return;
    }
    if (!foreground) return;
    const previous = seen.current;
    const changed = previous && synced && (previous.slotStart !== synced.slotStart || previous.slotEnd !== synced.slotEnd ||
      previous.hostDisplayName !== synced.hostDisplayName || previous.substituteHost !== synced.substituteHost);
    if (synced) seen.current = synced;
    // A sync-host change lacks confirmation provenance: reconcile it in one authorised read.
    if (changed || read.status === "idle") { void read.refresh(); return; }
    if (read.status === "ready") void refresh(sessionCardSource(read.data)).catch(() => undefined);
  }, [foreground, card.id, read.status, read.data, read.error, read.refresh, synced, refresh, stop]);
  return null;
}

function ShiftStatus({ card }: { card: ActiveCard }) {
  const shift = useProjection("worker_field_shift", card.target.id);
  const { arrival, departure, lastConfirmedAt } = useAttendanceStatus(card.target.id);
  const { refresh, stop } = useStatusCards();
  const foreground = useForeground();
  useEffect(() => {
    if (departure && ["saved_on_device", "checking", "sent", "recorded"].includes(departure.status)) {
      void stop(card.id).catch(() => undefined);
    } else if (foreground && shift) void refresh(shiftCardSource(shift, { arrival, departure, lastConfirmedAt })).catch(() => undefined);
  }, [foreground, card.id, shift, arrival, departure, lastConfirmedAt, refresh, stop]);
  return null;
}

function CoverStatus({ card }: { card: ActiveCard }) {
  const read = useRemote(getCoverRoute, { params: { g: card.target.id } }, { loadOnMount: false });
  const { refresh, stop } = useStatusCards();
  const foreground = useForeground();
  useEffect(() => {
    if (read.error?.code === "NOT_FOUND" || read.error?.code === "UNAUTHENTICATED") void stop(card.id).catch(() => undefined);
    else if (foreground && read.status === "ready" && read.data.audience === "foreman") void refresh(coverCardSource(read.data)).catch(() => undefined);
  }, [foreground, card.id, read.status, read.data, read.error, refresh, stop]);
  return null;
}
