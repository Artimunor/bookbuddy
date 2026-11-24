import { finishVisitWorkRoute, getJobRoute, getVisitLiveRoute, startVisitWorkRoute, type ForemanVisitControl, type JobDetail } from "@bookbuddy/api-contract";
import { formatSiteDateTime, JOURNEY_STEPS } from "@bookbuddy/domain";
import { uuid } from "expo";
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useLiveHints } from "../../api/live";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useLocale, useT } from "../../i18n";
import { useSession } from "../../session";
import { Button, Card, Dock, Screen, SegmentedControl } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { CrewDots, JobLine, LiveCapsule, type LiveCapsuleState } from "../../ui/live";
import { journeyLabels } from "../c-01/common";
import { stageLabel } from "../f-01/Screen";
import { confirmAction } from "../s-17/confirmAction";

type Job = Extract<Extract<JobDetail, { audience: "foreman" }>["job"], { view: "whole" }>;
export function clockTime(time: number, zone: string, locale: string): string {
  const clock = formatSiteDateTime(time, zone, locale);
  return clock.kind === "available" ? clock.site.time : "";
}
type ViewMode = "today" | "whole";
export default function JobControlScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>(); const router = useRouter(); const { bootstrap, session } = useSession(); const t = useT();
  const jobRead = useRemote(getJobRoute, { params: { j: jobId ?? "" }, query: { view: "whole" } }, { enabled: !!jobId });
  const job = jobRead.data?.audience === "foreman" && jobRead.data.job.view === "whole" ? jobRead.data.job : null;
  const visitId = job?.nextVisit?.visitId;
  const visitRead = useRemote(getVisitLiveRoute, { params: { id: visitId ?? "" } }, { enabled: !!visitId });
  const retryLive = useLiveHints(jobId ? { kind: "provider-job", opaqueId: jobId } : null, visitId ? visitRead.refresh : jobRead.refresh, { onScopeClosed: jobRead.refresh });
  const visit = visitRead.data && "workGate" in visitRead.data ? visitRead.data : null;
  const start = useCommand(startVisitWorkRoute), finish = useCommand(finishVisitWorkRoute);
  const focusedOnce = useRef(false);
  const refreshCurrent = useRef({ job: jobRead.refresh, visit: visitRead.refresh, visitId });
  refreshCurrent.current = { job: jobRead.refresh, visit: visitRead.refresh, visitId };
  useFocusEffect(useCallback(() => { if (focusedOnce.current) { void refreshCurrent.current.job(); if (refreshCurrent.current.visitId) void refreshCurrent.current.visit(); } else focusedOnce.current = true; }, []));
  const busy = [start.state, finish.state].some(s => s === "sending" || s === "checking");
  function work(kind: "start" | "finish") {
    if (!visit || !job || busy || jobRead.status !== "ready" || visitRead.status !== "ready" || visit.workGate.status !== "ready") return;
    const command = kind === "start" ? start : finish;
    const label = kind === "start" ? t("mobile.jobControl.start") : t("mobile.jobControl.finish");
    confirmAction(router, { title: label, actionLabel: label, actionLabelKey: kind === "start" ? "mobile.jobControl.start" : "mobile.jobControl.finish", item: job.reference, actor: bootstrap?.account.displayName ?? "", role: session?.activeContext?.businessName ?? "", effects: [t("mobile.jobControl.workEffect")], onReview: () => {}, onConfirm: async () => { const result = await command.run({ params: { id: visit.visitId }, body: { expectedRevision: visit.revision, payload: { id: uuid.v4(), bookedWindowId: visit.window.id } } }); if (result.ok) { await visitRead.refresh(); return "confirmed"; } return result.error.code === "INTERNAL_ERROR" || ("delivery" in result.error && result.error.delivery === "unknown") ? "uncertain" : "invalidated"; } });
  }
  return <JobControlView job={job} visit={visit} status={jobRead.status} visitStatus={visitRead.status} busy={busy} checking={start.state === "checking" || finish.state === "checking"} failed={[start.state, finish.state].some(s => s === "failed" || s === "conflict")} onBack={() => router.back()} onRetry={() => { retryLive(); void jobRead.refresh(); if (visitId) void visitRead.refresh(); }} onNavigate={path => router.push(path as Href)} onWork={work} />;
}
export function JobControlView({ job, visit, status, visitStatus, busy, checking, failed, onBack, onRetry, onNavigate, onWork, initialView }: { job: Job | null; visit: ForemanVisitControl | null; status: RemoteStatus; visitStatus: RemoteStatus; busy: boolean; checking: boolean; failed: boolean; onBack: () => void; onRetry: () => void; onNavigate: (path: string) => void; onWork: (kind: "start" | "finish") => void; initialView?: ViewMode }) {
  const t = useT(), { locale } = useLocale(); const [view, setView] = useState<ViewMode>(initialView ?? "today");
  const root = job ? `/f/jobs/${job.jobId}` : ""; const ready = status === "ready" && visitStatus === "ready"; const live = visit?.customerPreview.live;
  const statusLabels = { confirmed: t("mobile.foremanHome.confirmed"), on_the_way: t("mobile.foremanHome.onWay"), on_site: t("mobile.foremanHome.onSite"), working: t("mobile.foremanHome.working"), finished: t("mobile.foremanHome.finished"), paused: t("mobile.foremanHome.paused"), cover_arranging: t("mobile.foremanHome.gap"), no_crew_available: t("mobile.foremanHome.gap") };
  const statusStates: Record<keyof typeof statusLabels, LiveCapsuleState> = { confirmed: "crewConfirmed", on_the_way: "onTheWay", on_site: "onSite", working: "working", finished: "finished", paused: "paused", cover_arranging: "coverBeingArranged", no_crew_available: "quiet" };
  const customerLabel = live?.status ? statusLabels[live.status] : t("mobile.jobControl.noUpdate");
  const at = (value: number) => clockTime(value, visit?.siteZone ?? job?.siteZone ?? "UTC", locale);
  const format = useFormat();
  const zoneClock = visit ? format.siteTime(visit.window.startsAt, visit.siteZone) : null;
  const siteZoneLabel = zoneClock?.kind === "available" ? format.zoneLabel(visit?.siteZone, zoneClock.site) : "";
  const band = visit?.window; const bandLabel = band ? `${at(band.startsAt)} – ${at(band.endsAt)}` : "";
  const days = [t("mobile.foremanHome.confirmed"), t("mobile.foremanHome.onWay"), t("mobile.foremanHome.onSite"), t("mobile.foremanHome.working"), t("mobile.foremanHome.finished")] as [string,string,string,string,string];
  const steps = ["confirmed", "on_the_way", "on_site", "working", "finished"] as const;
  const dayIndex = Math.max(0, steps.findIndex(s => s === live?.step)) as 0|1|2|3|4;
  const stageIndex = job ? JOURNEY_STEPS.indexOf(job.journey.step) as 0|1|2|3|4|5 : 0;
  const assignmentShift = job?.nextStep?.kind === "assign_crew" ? job.nextStep.recordId : null;
  const workKind = visit?.work?.kind === "work_started" ? "finish" : "start";
  const workAllowed = visit?.workGate.status === "ready" && !busy && ready;
  const canWork = visit && visit.work?.kind !== "work_finished" && !job?.journey.complete;
  const share = () => onNavigate(`${root}/share`);
  const dock = job && !job.journey.cancelled && !job.journey.complete ? visit?.work?.kind === "work_finished" ? (job.chatThreadId ? <Dock primary={{ label: t("mobile.jobControl.chat"), onPress: () => onNavigate(`/threads/${job.chatThreadId}`) }} /> : undefined) : !visit?.crew.length && assignmentShift ? <Dock primary={{ label: t("mobile.jobControl.assign"), onPress: () => onNavigate(`${root}/assign?shiftId=${encodeURIComponent(assignmentShift)}`) }} /> : canWork ? <Dock context={visit.workGate.status === "held" ? t("mobile.jobControl.hold") : !workAllowed ? t("mobile.jobControl.notReady") : t("mobile.jobControl.workEffect")} primary={{ label: workKind === "start" ? t("mobile.jobControl.start") : t("mobile.jobControl.finish"), onPress: () => onWork(workKind), disabled: !workAllowed }} secondary={{ label: t("mobile.jobControl.shareTitle"), onPress: share, disabled: !ready }} /> : undefined : undefined;
  return <Screen title={job?.title ?? t("mobile.foremanHome.untitled")} navigation={{ kind: "back", label: t("mobile.crewSchedule.back"), onPress: onBack }} dock={dock}>
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.foremanHome.loading")}</Copy>}{status === "offline" && <Copy>{t("mobile.foremanHome.offline")}</Copy>}{status === "error" && <><Copy>{t("mobile.jobControl.error")}</Copy><Button label={t("mobile.foremanHome.retry")} onPress={onRetry} /></>}
    {job && <><Copy variant="supporting">{job.reference} · {job.place.alias}</Copy><SegmentedControl label={t("mobile.jobControl.whole")} value={view} onChange={setView} options={[{ value: "today", label: t("mobile.jobControl.today") }, { value: "whole", label: t("mobile.jobControl.whole") }]} />
      {job.flags.includes("open_change") && <Card><Copy>{t("mobile.jobControl.changePending")}</Copy></Card>}{job.flags.includes("unpaid_bill") && <Card><Copy>{t("mobile.jobControl.unpaid")}</Copy></Card>}
      {view === "whole" && <Card><Copy variant="sectionTitle">{stageLabel(t, job.journey.step, job.journey.cancelled)}</Copy><JobLine kind="journey" steps={journeyLabels(t)} current={stageIndex} accessibilityLabel={t("mobile.customerHome.step", { step: stageIndex + 1, stage: stageLabel(t, job.journey.step, job.journey.cancelled) })} pulse={false} /></Card>}
      {visit && <Copy variant="label">{t("mobile.jobControl.window")}</Copy>}
      {visit && <><LiveCapsule size="hero" state={live?.status ? statusStates[live.status] : "quiet"} stateLabel={customerLabel} source={`${job.customerName} · ${job.place.alias}`} reference={job.reference} time={bandLabel} zoneLine={siteZoneLabel} provenance={t("mobile.jobControl.shared", { status: customerLabel })} accessibilityLabel={[customerLabel, bandLabel, siteZoneLabel].join(", ")} line={{ kind: "visit", steps: days, current: dayIndex, accessibilityLabel: customerLabel }} /><Card><Copy variant="label">{t("mobile.jobControl.preview")}</Copy><Copy>{t("mobile.jobControl.shared", { status: customerLabel })}</Copy>{live?.source?.sharedByName && <Copy>{t("mobile.jobControl.sharedAt", { name: live.source.sharedByName, time: at(live.source.at) })}</Copy>}<Button label={t("mobile.jobControl.shareTitle")} variant="quiet" onPress={share} disabled={!ready} /></Card>
      <Card><Copy variant="sectionTitle">{t("mobile.jobControl.crew")}</Copy>{!visit.crew.length && <Copy>{t("mobile.jobControl.noCrew")}</Copy>}{visit.crew.map(person => { const hold = person.holds.some(h => h.state === "active"); const label = hold ? t("mobile.foremanHome.briefingHold") : person.attendance.departure ? t("mobile.foremanHome.departed") : person.attendance.arrival ? t("mobile.foremanHome.onSite") : person.estimate ? t("mobile.foremanHome.onWay") : t("mobile.foremanHome.confirmed"); return <View key={person.assignmentId}><CrewDots audience="foreman" people={[{ id: person.assignmentId, initials: person.workerName.split(/\s+/).map(x => x[0]).join("").slice(0,2), name: person.workerName, status: hold ? "hold" : person.attendance.arrival ? "onSite" : person.estimate ? "onTheWay" : "confirmed", statusLabel: label }]} />{person.attendance.arrival && <Copy>{at(person.attendance.arrival.actualAt)}</Copy>}{person.instruction && <Copy>{person.briefingReceipt?.acknowledgement ? t("mobile.foremanHome.briefingDone") : t("mobile.foremanHome.briefingDue")} · v{person.instruction.version.no}</Copy>}</View>; })}</Card></>}
      {!visit && job.nextVisit && <><Copy>{visitStatus === "offline" ? t("mobile.foremanHome.offline") : visitStatus === "error" ? t("mobile.jobControl.error") : t("mobile.foremanHome.loading")}</Copy>{visitStatus === "error" && <Button label={t("mobile.foremanHome.retry")} onPress={onRetry} />}</>}
      {visit?.work?.kind === "work_finished" && <Copy>{t("mobile.jobControl.awaiting")}</Copy>}{!visit?.crew.length && !assignmentShift && job.nextVisit && <Copy>{t("mobile.jobControl.assignUnavailable")}</Copy>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{[{ label: t("mobile.jobControl.quote"), path: `${root}/quote` }, { label: t("mobile.jobControl.schedule"), path: `${root}/schedule` }, { label: t("mobile.jobControl.siteLog"), path: `${root}/site-log` }, { label: t("mobile.jobControl.change"), path: `${root}/change` }, { label: t("mobile.jobControl.wrap"), path: `${root}/wrap-up` }, ...(job.chatThreadId ? [{ label: t("mobile.jobControl.chat"), path: `/threads/${job.chatThreadId}` }] : [])].map(link => <Button key={link.path} label={link.label} variant="neutral" onPress={() => onNavigate(link.path)} />)}</View>
      {checking && <Copy>{t("mobile.jobControl.checking")}</Copy>}{failed && <Copy>{t("mobile.jobControl.failed")}</Copy>}
    </>}
  </Screen>;
}
