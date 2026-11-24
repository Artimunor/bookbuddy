import { getBusinessScheduleRoute, proposeVisitWindowsRoute, type BusinessSchedule } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Button, Card, Dock, Screen, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { TwoClock } from "../../ui/live/TwoClock";
import { siteTime } from "../f-01/Screen";
import { useLocalDraft } from "../f-04/draft";
import { confirmAction } from "../s-17/confirmAction";
import { wallInstant } from "../w-08/Screen";
import { NativePicker } from "../w-08/NativePicker";

type Window = { id: string; startsAt: number; endsAt: number };
type Status = "idle" | "loading" | "ready" | "error" | "offline";
const emptyDraft: { windows: Window[] } = { windows: [] };
export default function ForemanSchedule() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>(); const { session } = useSession();
  return <ScheduleRoute key={`${session?.sessionId}:${session?.activeContext?.contextId}:${jobId}`} />;
}
function ScheduleRoute() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>(); const { session, bootstrap } = useSession(); const router = useRouter(); const t = useT();
  const businessId = session?.activeContext?.businessId ?? "";
  const [week, setWeek] = useState<string | undefined>();
  const remote = useRemote(getBusinessScheduleRoute, { params: { b: businessId }, query: { jobId: jobId ?? "", weekOf: week } }, { enabled: !!businessId && !!jobId });
  const command = useCommand(proposeVisitWindowsRoute); const local = useLocalDraft(`schedule:${jobId ?? "missing"}`, emptyDraft); const windows = local.value.windows;
  const [newVisitId] = useState(() => uuid.v4());
  const data = remote.status === "ready" ? remote.data : null; const visit = data?.visit;
  const days = useRef(new Map<string, Extract<BusinessSchedule["capacity"], { state: "ready" }>["days"][number]>());
  useEffect(() => { if (!data) return; if (data.capacity.state !== "ready") { days.current.clear(); return; } for (const day of data.capacity.days) days.current.set(day.date, day); }, [data]);
  const capacity = (w: Window) => { if (!data || data.capacity.state !== "ready") return null; const parts = new Intl.DateTimeFormat("en-CA", { timeZone: data.siteZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(w.startsAt); const get = (name: string) => parts.find(part => part.type === name)?.value; const date = `${get("year")}-${get("month")}-${get("day")}`; const day = data.capacity.days.find(item => item.date === date) ?? days.current.get(date); if (!day) return null; return { free: day.lanes.filter(lane => lane.available.some(a => a.startsAt <= w.startsAt && a.endsAt >= w.endsAt) && !lane.busy.some(b => b.startsAt < w.endsAt && b.endsAt > w.startsAt)).length, total: day.lanes.length }; };
  const busy = command.state === "sending" || command.state === "checking";
  function send() {
    if (!data || !data.approvedQuote || !jobId || !windows.length || busy || windows.some(w => !capacity(w)?.free || w.startsAt <= Date.now())) return;
    const booked = visit?.bookedWindow; const revised = booked?.crewAvailability === "no_crew_available";
    confirmAction(router, { title: revised ? t("mobile.crewSchedule.newVisit") : t("mobile.crewSchedule.sendWindows"), actionLabel: revised ? t("mobile.crewSchedule.newVisit") : t("mobile.crewSchedule.sendWindows"), actionLabelKey: revised ? "mobile.crewSchedule.newVisit" : "mobile.crewSchedule.sendWindows", item: data.job.reference, actor: bootstrap?.account.displayName ?? "", role: session?.activeContext?.businessName ?? "", effects: [t("mobile.crewSchedule.proposalEffect")], onReview: () => {}, onConfirm: async () => { const result = await command.run({ params: { j: jobId }, body: { expectedRevision: visit?.revision ?? 0, payload: { visitId: visit?.id ?? newVisitId, approvedQuoteVersionId: data.approvedQuote!.id, purpose: booked ? { kind: "agreement", replacesWindowId: booked.id, requestId: visit?.rescheduleRequest?.id ?? null } : { kind: "booking", visitKind: visit?.kind ?? "work", requestId: visit?.rescheduleRequest?.id ?? null }, windows: windows.map(w => ({ ...w, expiresAt: Math.min(w.startsAt, Date.now() + 86400000) })) } } }); if (result.ok) { await local.remove().catch(() => {}); router.replace(`/f/jobs/${jobId}` as Href); return "confirmed"; } return "delivery" in result.error && result.error.delivery === "unknown" ? "uncertain" : "invalidated"; } });
  }
  return <ScheduleView data={data} status={remote.status} windows={windows} capacity={capacity} busy={busy} checking={command.state === "checking"} failed={command.state === "failed" || command.state === "conflict"} onBack={() => router.back()} onRetry={() => void remote.refresh()} onWeek={delta => { if (data?.capacity.state !== "ready") return; const date = new Date(`${data.capacity.days[0]!.date}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 7 * delta); setWeek(date.toISOString().slice(0, 10)); }} onWindows={next => local.change({ windows: next })} onSend={send} />;
}
export function ScheduleView(p: { data: BusinessSchedule | null; customerZone?: string | null; status: Status; windows: Window[]; capacity: (w: Window) => { free: number; total: number } | null; busy: boolean; checking: boolean; failed: boolean; onBack: () => void; onRetry: () => void; onWeek: (delta: number) => void; onWindows: (w: Window[]) => void; onSend: () => void }) {
  const t = useT(); const format = useFormat(); const [date, setDate] = useState(""); const [start, setStart] = useState(""); const [end, setEnd] = useState(""); const [invalid, setInvalid] = useState(false); const [changing, setChanging] = useState(false);
  const d = p.data; const visit = d?.visit; const revised = visit?.bookedWindow?.crewAvailability === "no_crew_available"; const agreed = !!visit?.bookedWindow && !revised && !changing; const lanes = d?.capacity.state === "ready" ? d.capacity.days.find(day => day.date === date)?.lanes ?? [] : [];
  const customerZone = p.customerZone ?? null;
  const clock = (at: number) => { const value = format.twoClock(at, d?.siteZone, customerZone); return value.kind === "available" ? <TwoClock siteTime={value.siteTime} siteZone={d?.siteZone ?? ""} viewerLine={value.viewerTime ? t("mobile.crewSchedule.customerClock", { time: value.viewerTime }) : undefined} /> : null; };
  function add() { if (!d) return; const a = wallInstant(date, start, d.siteZone), b = wallInstant(date, end, d.siteZone); if (a === null || b === null || a >= b || a <= Date.now()) { setInvalid(true); return; } const window = { id: uuid.v4(), startsAt: a, endsAt: b }; p.onWindows(visit?.bookedWindow ? [window] : [...p.windows, window]); setInvalid(false); }
  const disabled = !d?.approvedQuote || !p.windows.length || p.busy || p.status !== "ready" || p.windows.some(w => !p.capacity(w)?.free || w.startsAt <= Date.now());
  return <Screen title={t("mobile.crewSchedule.schedule")} navigation={{ kind: "back", label: t("mobile.crewSchedule.back"), onPress: p.onBack }} dock={d && !agreed ? <Dock context={t("mobile.crewSchedule.proposalEffect")} primary={{ label: revised ? t("mobile.crewSchedule.newVisit") : t("mobile.crewSchedule.sendWindows"), live: !!revised, onPress: p.onSend, disabled }} /> : undefined}>
    {(p.status === "idle" || p.status === "loading") && <Copy>{t("mobile.crewSchedule.loading")}</Copy>}{p.status === "error" && <><Copy>{t("mobile.crewSchedule.error")}</Copy><Button label={t("mobile.crewSchedule.retry")} onPress={p.onRetry} /></>}{p.status === "offline" && <Copy>{t("mobile.crewSchedule.offline")}</Copy>}
    {d && <><Copy variant="sectionTitle">{d.job.title}</Copy><Copy>{d.job.reference} · {d.siteZone}</Copy>{revised && <Card><Copy>{t("mobile.crewSchedule.revised")}</Copy></Card>}{changing && <Card><Copy>{t("mobile.crewSchedule.bookingRemains")}</Copy></Card>}{visit?.bookedWindow && <Card><Copy variant="sectionTitle">{t("mobile.crewSchedule.booked")}</Copy>{clock(visit.bookedWindow.startsAt)}{clock(visit.bookedWindow.endsAt)}{agreed && <Button variant="quiet" label={t("mobile.crewSchedule.change")} onPress={() => setChanging(true)} />}</Card>}
    {visit?.offeredWindows.map(w => <Card key={w.id}><Copy>{t("mobile.crewSchedule.waitingCustomer")}</Copy><Copy>{siteTime(format, w.startsAt, d.siteZone)} – {siteTime(format, w.endsAt, d.siteZone)}</Copy></Card>)}
    {!agreed && <>{d.capacity.state === "unavailable" ? <Copy>{t("mobile.crewSchedule.capacityUnknown")}</Copy> : <><View style={{ flexDirection: "row", flexWrap: "wrap" }}><Button variant="quiet" label={t("mobile.crewSchedule.previous")} onPress={() => p.onWeek(-1)} /><Button variant="quiet" label={t("mobile.crewSchedule.next")} onPress={() => p.onWeek(1)} /></View><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>{d.capacity.days.map(day => <Button key={day.date} label={day.date} variant={date === day.date ? "primary" : "neutral"} onPress={() => setDate(day.date)} />)}</View></>}
    {lanes.map(lane => <Card key={lane.membershipId}><Copy variant="sectionTitle">{lane.displayName}</Copy>{lane.busy.map(b => <Copy key={b.startsAt}>{t("mobile.crewSchedule.busy")} · {siteTime(format, b.startsAt, d.siteZone)} – {siteTime(format, b.endsAt, d.siteZone)}</Copy>)}</Card>)}
    {p.windows.map(w => { const c = p.capacity(w); return <Card key={w.id}>{clock(w.startsAt)}{clock(w.endsAt)}<Copy>{c ? t("mobile.crewSchedule.freeCount", c) : t("mobile.crewSchedule.capacityUnknown")}</Copy>{c?.free === 0 && <Copy>{t("mobile.crewSchedule.conflictWindow")}</Copy>}<Button variant="quiet" label={t("mobile.crewSchedule.remove")} onPress={() => p.onWindows(p.windows.filter(x => x.id !== w.id))} /></Card>; })}
    <Card><TextField label={t("mobile.crewSchedule.date")} helper={t("mobile.crewSchedule.dateHint")} value={date} onChangeText={setDate} /><NativePicker label={t("mobile.crewSchedule.date")} mode="date" date={date} time={start} zone={d.siteZone} onChange={setDate} /><TextField label={t("mobile.crewSchedule.start")} helper={t("mobile.crewSchedule.timeHint")} value={start} onChangeText={setStart} /><NativePicker label={t("mobile.crewSchedule.start")} mode="time" date={date} time={start} zone={d.siteZone} onChange={setStart} /><TextField label={t("mobile.crewSchedule.end")} value={end} onChangeText={setEnd} /><NativePicker label={t("mobile.crewSchedule.end")} mode="time" date={date} time={end} zone={d.siteZone} onChange={setEnd} />{invalid && <Copy>{t("mobile.crewSchedule.invalidTime")}</Copy>}<Button label={t("mobile.crewSchedule.addWindow")} onPress={add} /></Card></>}{p.checking && <Copy>{t("mobile.crewSchedule.checking")}</Copy>}{p.failed && <Copy>{t("mobile.crewSchedule.saveFailed")}</Copy>}</>}
  </Screen>;
}
