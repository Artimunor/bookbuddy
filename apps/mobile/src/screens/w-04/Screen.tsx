import { getShiftRoute, getWorkerFieldShiftRoute, type WorkerFieldShift } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useRemote } from "../../api";
import { useFormat, useT } from "../../i18n";
import type { AttendanceStatus } from "../../repository/attendance";
import type { CachedWorkerFieldShift } from "../../repository/cache";
import { useAttendanceStatus, useLastConfirmed, useProjection } from "../../repository/hooks";
import { Button, Card, Dock, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { HoldBanner } from "../../ui/live/HoldBanner";
import { LiveCapsule } from "../../ui/live/LiveCapsule";
import { BeaconThemeProvider } from "../../ui/theme";
import { siteTime } from "../f-01/Screen";
import { useOffline } from "../s-02/flow";

export type FieldShift = WorkerFieldShift | CachedWorkerFieldShift;
export function useFieldShift() {
  const { shiftId = "", assignmentId: requested = "" } = useLocalSearchParams<{ shiftId: string; assignmentId?: string }>();
  const offline = useOffline();
  const lookup = useRemote(getShiftRoute, { params: { s: shiftId } }, { enabled: !!shiftId && !requested && !offline });
  const assignmentId = requested || (lookup.data?.view === "worker" ? lookup.data.assignment.id : "");
  const projection = useProjection("worker_field_shift", assignmentId);
  const field = useRemote(getWorkerFieldShiftRoute, { params: { id: assignmentId } }, { enabled: !!assignmentId && !offline });
  const lastConfirmed = useLastConfirmed();
  const data = offline ? projection : field.data;
  return { shiftId, assignmentId, offline, data: data?.shiftId === shiftId && data.id === assignmentId ? data : null, lastConfirmedAt: offline ? lastConfirmed : field.lastConfirmedAt, loading: !offline && (field.status === "loading" || lookup.status === "loading" || (!!assignmentId && field.status === "idle")), error: !offline && (field.status === "error" || lookup.status === "error"), refresh: field.refresh };
}
export default function LiveShiftScreen() {
  return <BeaconThemeProvider field><LiveShiftRoute /></BeaconThemeProvider>;
}
function LiveShiftRoute() {
  const f = useFieldShift(); const router = useRouter(); const attendance = useAttendanceStatus(f.assignmentId);
  const navigate = (path: string) => router.push(path as Href);
  return <LiveShiftView {...f} attendance={attendance} onBack={() => router.canGoBack() ? router.back() : router.replace("/w/(tabs)/now" as Href)} onNavigate={navigate} onRetry={() => void f.refresh()} />;
}
export function LiveShiftView(p: { data: FieldShift | null; shiftId: string; assignmentId: string; offline: boolean; lastConfirmedAt: number | null; loading: boolean; error: boolean; attendance: AttendanceStatus; now?: number; onBack: () => void; onNavigate: (path: string) => void; onRetry: () => void }) {
  const t = useT(); const format = useFormat(); const d = p.data; const active = d?.state === "confirmed"; const hold = d?.holds.some(h => h.state === "active") ?? false;
  const arrival = p.attendance.arrival ?? (d?.attendance.arrival ? { status: "recorded" as const, actualAt: d.attendance.arrival.actualAt } : null);
  const departure = p.attendance.departure ?? (d?.attendance.departure ? { status: "recorded" as const, actualAt: d.attendance.departure.actualAt } : null);
  const confirmedArrival = arrival?.status === "recorded"; const confirmedDeparture = departure?.status === "recorded";
  const current: 0 | 1 | 2 | 3 | 4 = confirmedDeparture ? 4 : d?.work?.kind === "work_started" ? 3 : confirmedArrival ? 2 : d?.estimate ? 1 : 0;
  const label = !active ? t("mobile.liveShift.cancelled") : confirmedDeparture ? t("mobile.liveShift.departed") : hold && confirmedArrival ? t("mobile.liveShift.attendanceOnly") : confirmedArrival && d && (p.now ?? Date.now()) >= d.bookedWindow.endsAt ? t("mobile.liveShift.checkoutDue") : current === 3 ? t("mobile.liveShift.working") : confirmedArrival ? t("mobile.liveShift.onSite") : d?.estimate ? t("mobile.liveShift.onWay") : t("mobile.liveShift.confirmed");
  const zone = d?.siteZone ?? ""; const time = (n: number) => `${siteTime(format, n, zone)} · ${zone}`;
  const suffix = `?assignmentId=${encodeURIComponent(p.assignmentId)}`; const path = (leaf = "") => `/w/shifts/${p.shiftId}${leaf ? `/${leaf}` : ""}${suffix}`;
  const steps: [string, string, string, string, string] = [t("mobile.liveShift.confirmed"), t("mobile.liveShift.onWay"), t("mobile.liveShift.onSite"), t("mobile.liveShift.working"), t("mobile.liveShift.departed")];
  const primary = active && !confirmedDeparture ? hold ? { label: t("mobile.liveShift.briefing"), onPress: () => p.onNavigate(path("briefing")) } : !arrival && !d?.estimate ? { label: t("mobile.liveShift.setOff"), onPress: () => p.onNavigate(path("depart")) } : { label: arrival ? t("mobile.liveShift.checkOut") : t("mobile.liveShift.checkIn"), onPress: () => p.onNavigate(`${path("attendance")}&event=${arrival ? "departure" : "arrival"}`) } : null;
  return <Screen title={t("mobile.liveShift.title")} navigation={{ kind: "back", label: t("mobile.liveShift.back"), onPress: p.onBack }} dock={primary ? <Dock primary={primary} /> : undefined}>
    {p.loading && <Copy>{t("mobile.liveShift.loading")}</Copy>}{p.error && <><Copy>{t("mobile.liveShift.error")}</Copy><Button label={t("mobile.liveShift.retry")} onPress={p.onRetry} /></>}
    {p.offline && <Copy>{p.lastConfirmedAt && d ? t("mobile.liveShift.offlineAt", { time: time(p.lastConfirmedAt) }) : t("mobile.liveShift.offline")}</Copy>}
    {d && <><LiveCapsule size="hero" state={!active ? "quiet" : current === 4 ? "finished" : current === 3 ? "working" : current === 2 ? "onSite" : current === 1 ? "onTheWay" : "crewConfirmed"} stateLabel={label} source={d.job.title ?? d.task} reference={d.job.reference} time={confirmedArrival && arrival ? time(arrival.actualAt) : `${time(d.bookedWindow.startsAt)} – ${time(d.bookedWindow.endsAt)}`} zoneLine={"placeAlias" in d.job ? d.job.placeAlias ?? undefined : undefined} estimate={d.estimate ? `${time(d.estimate.band.startsAt)} – ${time(d.estimate.band.endsAt)}` : undefined} provenance={p.lastConfirmedAt ? t("mobile.liveShift.confirmedAt", { time: time(p.lastConfirmedAt) }) : t("mobile.liveShift.confirmedSource")} accessibilityLabel={`${label} · ${d.task} · ${zone}`} line={{ kind: "visit", steps, current, accessibilityLabel: `${label} · ${steps.join(" · ")}`, ...(active ? {} : { status: { state: "cancelled" as const, label } }) }} />
      {hold && <HoldBanner state="briefingRequired" label={t("mobile.liveShift.hold")} blocked={t("mobile.liveShift.holdEffect")} action={t("mobile.liveShift.briefing")} />}
      {!hold && d.holds.some(h => h.state === "cleared") && <HoldBanner state="cleared" label={t("mobile.liveShift.holdCleared")} />}
      {arrival && arrival.status !== "recorded" && <Copy>{t("mobile.liveShift.pendingAttendance")}</Copy>}
      {active && <Card><Copy variant="sectionTitle">{d.task}</Copy><Copy>{d.job.reference}</Copy>{"placeAlias" in d.job && d.job.placeAlias && <Copy>{d.job.placeAlias}</Copy>}<Button variant="quiet" label={t("mobile.liveShift.briefing")} onPress={() => p.onNavigate(path("briefing"))} />{!departure && <Button variant="quiet" label={arrival ? t("mobile.liveShift.checkOut") : t("mobile.liveShift.checkIn")} onPress={() => p.onNavigate(`${path("attendance")}&event=${arrival ? "departure" : "arrival"}`)} />}{!arrival && <Button variant="quiet" label={t("mobile.liveShift.cantMakeIt")} onPress={() => p.onNavigate(path("dropout"))} />}{d.crewThreadId && <Button variant="quiet" label={t("mobile.liveShift.chat")} onPress={() => p.onNavigate(`/threads/${d.crewThreadId}`)} />}</Card>}
    </>}
  </Screen>;
}
