import { getBusinessScheduleRoute, proposeVisitWindowsRoute, type BusinessSchedule } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useCommand, useRemote } from "../../api";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { useLocalDraft } from "../f-04/draft";
import { confirmAction } from "../s-17/confirmAction";
import { ScheduleView, type Window } from "./View";

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
