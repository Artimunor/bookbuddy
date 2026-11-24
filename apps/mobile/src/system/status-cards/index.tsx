import { getCoverRoute, getVisitLiveRoute } from "@bookbuddy/api-contract";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { useRemote } from "../../api";
import { useLocale, useT } from "../../i18n";
import { useAttendanceStatus, useProjection } from "../../repository/hooks";
import { useSession } from "../../session";
import { cardScope, getStatusCards, reconcileStatusCards, refreshStatusCard, setStatusCardPreferences, setStatusCardScope, startStatusCard, stopStatusCard, subscribeStatusCards, type ActiveCard, type CardPreferences } from "./controller";
import { coverCardSource, shiftCardSource, visitCardSource, type StatusCardSource } from "./model";

export { setStatusCardPreferences } from "./controller";
export { coverCardSource, shiftCardSource, visitCardSource } from "./model";

export function useStatusCards() {
  const t = useT();
  const { locale } = useLocale();
  const { session } = useSession();
  const key = cardScope(session)?.key;
  const { active, preferences, preferenceScope } = useSyncExternalStore(subscribeStatusCards, getStatusCards, getStatusCards);
  const start = useCallback((source: StatusCardSource) => startStatusCard(source, { t, locale }, key), [key, t, locale]);
  const refresh = useCallback((source: StatusCardSource) => refreshStatusCard(source, { t, locale }, key), [key, t, locale]);
  const stop = useCallback((id: string) => stopStatusCard(id, key), [key]);
  const changePreferences = useCallback((patch: Partial<CardPreferences>) => setStatusCardPreferences(patch, key), [key]);
  const scopedPreferences = preferenceScope === (key ?? null) ? preferences : { ...preferences, hideDetails: true, workerOptIn: null, coverOptIn: false };
  return { preferences: scopedPreferences, active: active?.scopeKey === key ? active : null, start, refresh, stop, changePreferences };
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
  if (!preferences.statusCardsEnabled || !active || active.scopeKey !== context?.key) return null;
  switch (active.target.kind) {
    case "customer_visit": return <VisitStatus key={active.id} card={active} />;
    case "worker_shift": return <ShiftStatus key={active.id} card={active} />;
    case "foreman_cover": return <CoverStatus key={active.id} card={active} />;
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
    if (!foreground) return;
    if (read.status === "ready" && "moments" in read.data) void refresh(visitCardSource(read.data)).catch(() => undefined);
    else if (read.error?.code === "NOT_FOUND" || read.error?.code === "UNAUTHENTICATED") void stop(card.id).catch(() => undefined);
  }, [foreground, card.id, read.status, read.data, read.error, refresh, stop]);
  return null;
}

function ShiftStatus({ card }: { card: ActiveCard }) {
  const shift = useProjection("worker_field_shift", card.target.id);
  const { arrival, departure, lastConfirmedAt } = useAttendanceStatus(card.target.id);
  const { refresh, stop } = useStatusCards();
  const foreground = useForeground();
  useEffect(() => {
    if (departure && ["saved_on_device", "checking", "sent", "recorded"].includes(departure.status)) void stop(card.id).catch(() => undefined);
    else if (shift) void refresh(shiftCardSource(shift, { arrival, departure, lastConfirmedAt })).catch(() => undefined);
  }, [foreground, card.id, shift, arrival, departure, lastConfirmedAt, refresh, stop]);
  return null;
}

function CoverStatus({ card }: { card: ActiveCard }) {
  const read = useRemote(getCoverRoute, { params: { g: card.target.id } }, { loadOnMount: false });
  const { refresh, stop } = useStatusCards();
  const foreground = useForeground();
  useEffect(() => {
    if (!foreground) return;
    if (read.status === "ready" && read.data.audience === "foreman") void refresh(coverCardSource(read.data)).catch(() => undefined);
    else if (read.error?.code === "NOT_FOUND" || read.error?.code === "UNAUTHENTICATED") void stop(card.id).catch(() => undefined);
  }, [foreground, card.id, read.status, read.data, read.error, refresh, stop]);
  return null;
}
