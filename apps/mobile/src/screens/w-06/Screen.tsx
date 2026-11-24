import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { useFormat, useT } from "../../i18n";
import type { AttendanceProgress } from "../../repository/attendance";
import { useAttendanceStatus, useOutbox, useRepository } from "../../repository/hooks";
import { useSync } from "../../sync/provider";
import { shiftCardSource, useStatusCards } from "../../system/status-cards";
import { Button, Card, Dock, Sheet } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { HoldBanner } from "../../ui/live/HoldBanner";
import { BeaconThemeProvider } from "../../ui/theme";
import { siteTime } from "../f-01/Screen";
import { LiveShiftView, useFieldShift, type FieldShift } from "../w-04/Screen";

type Event = "arrival" | "departure";
export default function AttendanceScreen() { return <BeaconThemeProvider field><AttendanceRoute /></BeaconThemeProvider>; }
function AttendanceRoute() {
  const f = useFieldShift(); const router = useRouter(); const { event: requested } = useLocalSearchParams<{ event?: string }>();
  const status = useAttendanceStatus(f.assignmentId); const outbox = useOutbox(); const sync = useSync(); const repository = useRepository();
  const [chosenEvent, setChosenEvent] = useState<Event | null>(null);
  const event: Event = chosenEvent ?? (requested === "departure" ? "departure" : requested === "arrival" ? "arrival" : status.arrival || f.data?.attendance.arrival ? "departure" : "arrival");
  const [saving, setSaving] = useState(false); const [failure, setFailure] = useState(false); const [saved, setSaved] = useState<AttendanceProgress | null>(null); const guard = useRef(false);
  const t = useT();
  const { preferences, active, start, stop, changePreferences } = useStatusCards();
  const card = active?.target.kind === "worker_shift" && active.target.id === f.assignmentId ? active : null;
  const [cardBusy, setCardBusy] = useState(false); const [cardFailed, setCardFailed] = useState(false);
  const foregroundEpoch = useRef(0);
  const automatic = useRef<string | null>(null);
  useFocusEffect(useCallback(() => {
    const forget = () => { foregroundEpoch.current++; automatic.current = null; };
    const subscription = AppState.addEventListener("change", next => { if (next !== "active") forget(); });
    return () => { subscription.remove(); forget(); };
  }, []));
  const back = () => router.canGoBack() ? router.back() : router.replace(`/w/shifts/${f.shiftId}?assignmentId=${encodeURIComponent(f.assignmentId)}` as Href);
  const progress = status[event] ?? (f.data?.attendance[event] ? { status: "recorded" as const, operationId: null, eventId: f.data.attendance[event]!.id, actualAt: f.data.attendance[event]!.actualAt, capturedAt: f.data.attendance[event]!.capturedAt, receivedAt: f.data.attendance[event]!.receivedAt, error: null } : null) ?? saved;
  const hasArrival = !!(status.arrival || f.data?.attendance.arrival); const hasDeparture = !!(status.departure || f.data?.attendance.departure);
  const eligible = !!f.data && f.data.state === "confirmed" && !progress && (event === "arrival" ? !hasArrival && !hasDeparture : hasArrival && !hasDeparture && status.arrival?.status !== "failed" && status.arrival?.status !== "conflict" && status.arrival?.status !== "needs_review");
  const mayShowCard = preferences.statusCardsEnabled && !f.offline && !f.loading && !f.error && !hasDeparture && f.data?.state === "confirmed" &&
    (status.arrival?.status === "recorded" || !!f.data.attendance.arrival);
  useEffect(() => {
    const receipt = status.arrival;
    if (!mayShowCard || !f.data || !automatic.current || receipt?.status !== "recorded" || receipt.operationId !== automatic.current) return;
    automatic.current = null;
    void start(shiftCardSource(f.data, status)).then(shown => setCardFailed(!shown), () => setCardFailed(true));
  }, [f.data, mayShowCard, status, start]);
  async function changeCard(show: boolean) {
    if (cardBusy) return;
    setCardBusy(true); setCardFailed(false);
    try {
      if (card) await stop(card.id);
      else {
        await changePreferences({ workerOptIn: show });
        if (show && mayShowCard && f.data && !await start(shiftCardSource(f.data, status))) setCardFailed(true);
      }
    } catch { setCardFailed(true); }
    finally { setCardBusy(false); }
  }
  async function record() {
    if (!eligible || guard.current || !repository) return;
    guard.current = true; setChosenEvent(event); setSaving(true); setFailure(false); const at = Date.now();
    const epoch = foregroundEpoch.current;
    const startAfterReceipt = event === "arrival" && !f.offline && preferences.statusCardsEnabled && preferences.workerOptIn === true && AppState.currentState === "active";
    let enqueued = false;
    try {
      const latest = await repository.getAttendanceStatus(f.assignmentId);
      if (latest[event] || (event === "arrival" && latest.departure) || (event === "departure" && (!(latest.arrival || f.data?.attendance.arrival) || (latest.arrival && ["failed", "conflict", "needs_review"].includes(latest.arrival.status))))) return;
      const id = await outbox.enqueueOperation({ kind: "attendance", assignmentId: f.assignmentId, event, actualAt: at, capturedAt: at });
      enqueued = true;
      if (startAfterReceipt && epoch === foregroundEpoch.current && AppState.currentState === "active") automatic.current = id;
      setSaved({ status: "saved_on_device", operationId: id, eventId: id, actualAt: at, capturedAt: at, receivedAt: null, error: null });
      if (!f.offline) await sync.refresh();
    } catch { if (!enqueued) setFailure(true); } finally { setSaving(false); guard.current = false; }
  }
  const cardControls = preferences.statusCardsEnabled && (card || (mayShowCard && preferences.workerOptIn !== false)) ? <Card>
    <Copy>{t("mobile.liveShift.cardDescription")}</Copy>
    <Button variant="quiet" label={card ? t("mobile.statusCards.stop") : t("mobile.liveShift.shiftCard")} disabled={cardBusy} onPress={() => { void changeCard(!card); }} />
    {!card && preferences.workerOptIn === null && <Button variant="quiet" label={t("mobile.statusCards.notNow")} disabled={cardBusy} onPress={() => { void changeCard(false); }} />}
    {cardFailed && <Copy accessibilityRole="alert">{t("mobile.statusCards.unavailable")}</Copy>}
  </Card> : undefined;
  return <><LiveShiftView {...f} attendance={status} onBack={back} onNavigate={path => router.push(path as Href)} onRetry={() => void f.refresh()} /><AttendanceSheet data={f.data} event={event} progress={progress} offline={f.offline} lastConfirmedAt={f.lastConfirmedAt} eligible={eligible} busy={saving} failed={failure} cardControls={cardControls} now={Date.now()} onRecord={() => void record()} onClose={back} /></>;
}
export function AttendanceSheet(p: { data: FieldShift | null; event: Event; progress: AttendanceProgress | null; offline: boolean; lastConfirmedAt: number | null; eligible: boolean; busy: boolean; failed: boolean; cardControls?: ReactNode; now: number; onRecord: () => void; onClose: () => void }) {
  const t = useT(); const format = useFormat(); const d = p.data; const zone = d?.siteZone ?? ""; const at = p.progress?.actualAt ?? p.now; const hold = d?.holds.some(h => h.state === "active") ?? false;
  const title = p.event === "arrival" ? t("mobile.liveShift.checkIn") : t("mobile.liveShift.checkOut");
  const result = p.progress?.status === "recorded" ? t("mobile.liveShift.recorded") : p.busy && !p.offline ? t("mobile.liveShift.checking") : p.progress?.status === "saved_on_device" ? t("mobile.liveShift.saved") : p.progress?.status === "checking" || p.progress?.status === "sent" ? t("mobile.liveShift.checking") : p.progress ? t("mobile.liveShift.needsReview") : null;
  return <Sheet visible title={title} closeLabel={t("mobile.liveShift.close")} onClose={p.onClose} dock={<Dock primary={p.progress ? { label: t("mobile.liveShift.backToShift"), onPress: p.onClose } : { label: p.event === "arrival" ? t("mobile.liveShift.recordIn") : t("mobile.liveShift.recordOut"), onPress: p.onRecord, disabled: !p.eligible || p.busy, busy: p.busy }} />}>
    {d && <><Copy>{d.job.reference} · {d.job.title ?? d.task}</Copy>{p.offline && <Copy>{p.lastConfirmedAt ? t("mobile.liveShift.offlineAt", { time: `${siteTime(format, p.lastConfirmedAt, zone)} · ${zone}` }) : t("mobile.liveShift.offline")}</Copy>}<Card><Copy variant="sectionTitle">{result ?? title}</Copy><Copy variant="sectionTitle">{siteTime(format, at, zone)} · {zone}</Copy>{"placeAlias" in d.job && d.job.placeAlias && <Copy>{d.job.placeAlias}</Copy>}<Copy>{siteTime(format, d.bookedWindow.startsAt, zone)} – {siteTime(format, d.bookedWindow.endsAt, zone)} · {zone}</Copy></Card>
      {p.progress?.status === "saved_on_device" && (!p.busy || p.offline) && <Copy>{t("mobile.liveShift.notSentYet", { name: d.foremanName })}</Copy>}{p.progress?.status === "recorded" && p.progress.receivedAt && <Copy>{t("mobile.liveShift.receivedAt", { time: `${siteTime(format, p.progress.receivedAt, zone)} · ${zone}` })}</Copy>}
      <Copy>{t("mobile.liveShift.noLocation")}</Copy>{hold && <HoldBanner state="briefingRequired" label={t("mobile.liveShift.attendanceOnly")} blocked={t("mobile.liveShift.holdEffect")} action={t("mobile.liveShift.holdNotCleared")} />}
      <Copy>{t("mobile.liveShift.attendanceAudience", { name: d.foremanName })}</Copy>{p.cardControls}
    </>}{!d && <Copy>{t("mobile.liveShift.unavailable")}</Copy>}{!p.eligible && !p.progress && d && <Copy>{t("mobile.liveShift.notEligible")}</Copy>}{p.failed && <Copy>{t("mobile.liveShift.notSaved")}</Copy>}
  </Sheet>;
}
