import { finishVisitWorkRoute, getJobRoute, getVisitLiveRoute, startVisitWorkRoute, type ForemanVisitControl, type JobDetail } from "@bookbuddy/api-contract";
import { formatSiteDateTime, JOURNEY_STEPS, type ClockParts, type SiteDateTime } from "@bookbuddy/domain";
import { uuid } from "expo";
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useLiveHints } from "../../api/live";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useLocale, useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Button, Card, Dock, ListRow, Screen, SegmentedControl } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { CrewDots, JobLine, LiveCapsule, Stamp, type LiveCapsuleState } from "../../ui/live";
import { journeyLabels } from "../c-01/common";
import { stageLabel } from "../f-01/Screen";
import { confirmAction } from "../s-17/confirmAction";

type Job = Extract<Extract<JobDetail, { audience: "foreman" }>["job"], { view: "whole" }>;
type Moment = NonNullable<Job["history"]>["items"][number];
type PageAccess = { cursor: string; firstCursor: string; earlier: Moment[] };
export function clockTime(time: number, zone: string, locale: string): string {
  const clock = formatSiteDateTime(time, zone, locale);
  return clock.kind === "available" ? clock.site.time : "";
}
type ViewMode = "today" | "whole";
export default function JobControlScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { session } = useSession();
  return <JobControlRoute key={`${session?.sessionId}:${session?.activeContext?.contextId}:${jobId}`} jobId={jobId} />;
}

function JobControlRoute({ jobId }: { jobId: string }) {
  const router = useRouter(); const { bootstrap, session } = useSession(); const t = useT();
  const format = useFormat();
  const [viewOverride, setView] = useState<ViewMode>();
  const [pageAccess, setPageAccess] = useState<PageAccess>();
  const jobRead = useRemote(getJobRoute, { params: { j: jobId ?? "" }, query: { view: "whole" } }, { enabled: !!jobId });
  const job = jobRead.data?.audience === "foreman" && jobRead.data.job.view === "whole" ? jobRead.data.job : null;
  const visitWindow = job?.nextVisit?.window;
  const now = visitWindow && job ? format.siteTime(Date.now(), job.siteZone) : null;
  const scheduled = visitWindow && job ? format.siteTime(visitWindow.startsAt, job.siteZone) : null;
  const siteToday = now?.kind === "available" && scheduled?.kind === "available" && now.site.date === scheduled.site.date;
  const preSignOff = job && !job.journey.cancelled && job.journey.step !== "signed_off" && job.journey.step !== "paid";
  const view = viewOverride ?? (preSignOff && (job.live || siteToday) ? "today" : "whole");
  const visitId = view === "today" ? job?.nextVisit?.visitId : undefined;
  const firstCursor = job?.history?.page.hasMore ? job.history.page.cursor : null;
  const pagination = pageAccess?.firstCursor === firstCursor ? pageAccess : undefined;
  const earlierRead = useRemote(getJobRoute, { params: { j: jobId ?? "" }, query: { view: "whole", cursor: pagination?.cursor } }, { enabled: !!pagination && !!jobId });
  const earlierPage = earlierRead.data?.audience === "foreman" && earlierRead.data.job.view === "whole" ? earlierRead.data.job.history : null;
  const earlier = [...(pagination?.earlier ?? []), ...(earlierRead.status === "ready" ? earlierPage?.items ?? [] : [])];
  const earlierCursor = pagination ? earlierPage?.page.hasMore ? earlierPage.page.cursor : null : firstCursor;
  const active = bootstrap?.activeContext ?? session?.activeContext;
  const canSwitchToProvider = !!active?.businessId && !!bootstrap?.contexts.some(context => context.role === "provider_admin" && context.businessId === active.businessId);
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
  return <JobControlView job={job} visit={visit} viewMode={view} onView={setView} status={jobRead.status} visitStatus={visitRead.status} busy={busy}
    checking={start.state === "checking" || finish.state === "checking"} failed={[start.state, finish.state].some(s => s === "failed" || s === "conflict")}
    payee={active?.businessName} canSwitchToProvider={canSwitchToProvider}
    earlier={earlier} earlierStatus={pagination ? earlierRead.status : "idle"}
    onEarlier={firstCursor && earlierCursor ? () => setPageAccess({ cursor: earlierCursor, earlier, firstCursor }) : undefined}
    onRetryEarlier={() => { void earlierRead.refresh(); }}
    onBack={() => router.back()} onRetry={() => { retryLive(); void jobRead.refresh(); if (visitId) void visitRead.refresh(); }}
    onNavigate={path => router.push(path as Href)} onWork={work} />;
}
export function JobControlView({ job, visit, status, visitStatus, busy, checking, failed, onBack, onRetry, onNavigate, onWork, initialView,
  viewMode, onView, earlier = [], earlierStatus, onEarlier, onRetryEarlier, payee, canSwitchToProvider }: {
  job: Job | null; visit: ForemanVisitControl | null; status: RemoteStatus; visitStatus: RemoteStatus; busy: boolean; checking: boolean; failed: boolean;
  onBack: () => void; onRetry: () => void; onNavigate: (path: string) => void; onWork: (kind: "start" | "finish") => void;
  initialView?: ViewMode; viewMode?: ViewMode; onView?: (view: ViewMode) => void; earlier?: Moment[]; earlierStatus?: RemoteStatus;
  onEarlier?: () => void; onRetryEarlier?: () => void; payee?: string; canSwitchToProvider?: boolean;
}) {
  const t = useT(), { locale } = useLocale(); const [previewView, setPreviewView] = useState<ViewMode>(initialView ?? "today");
  const view = viewMode ?? previewView;
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
  const staffedVisit = job?.visits?.find(entry => entry.visitId === job.nextVisit?.visitId);
  const assignmentSlot = staffedVisit?.vacantSlotId;
  const bill = job?.bill;
  const signed = job?.history?.items.find(item => item.kind === "signed_off");
  const billSent = job?.history?.items.find(item => item.kind === "bill_issued");
  const paid = job?.history?.items.find(item => item.kind === "paid");
  const stageLabelText = job ? stageLabel(t, job.journey.step, job.journey.cancelled) : "";
  const stageAccent = job?.journey.step === "signed_off" ? signed : job?.journey.step === "paid" ? paid : null;
  const stageSummary = t("mobile.customerHome.step", { step: stageIndex + 1, stage: stageLabelText });
  const hasSignedOff = job?.journey.step === "signed_off" || job?.journey.step === "paid";
  const workKind = visit?.work?.kind === "work_started" ? "finish" : "start";
  const workAllowed = visit?.workGate.status === "ready" && !busy && ready;
  const canWork = visit && visit.work?.kind !== "work_finished" && !job?.journey.complete;
  const share = () => onNavigate(`${root}/share`);
  let dock;
  if (job && !job.journey.cancelled && !job.journey.complete) {
    if (bill?.state === "sent") {
      dock = <Dock context={t("mobile.jobControl.paymentAdminOnly")} primary={{ label: t("mobile.jobControl.recordAsPaid"), disabled: true, onPress: () => {} }} />;
    } else if (!hasSignedOff && assignmentShift && assignmentSlot) {
      dock = <Dock primary={{ label: t("mobile.jobControl.assign"), disabled: status !== "ready", onPress: () => onNavigate(`${root}/assign?shiftId=${encodeURIComponent(assignmentShift)}&slotId=${encodeURIComponent(assignmentSlot)}`) }} />;
    } else if (view === "today" && !hasSignedOff) {
      if (visit?.work?.kind === "work_finished" && job.chatThreadId) {
        dock = <Dock primary={{ label: t("mobile.jobControl.chat"), onPress: () => onNavigate(`/threads/${job.chatThreadId}`) }} />;
      } else if (canWork) {
        dock = <Dock context={visit.workGate.status === "held" ? t("mobile.jobControl.hold") : !workAllowed ? t("mobile.jobControl.notReady") : t("mobile.jobControl.workEffect")}
          primary={{ label: workKind === "start" ? t("mobile.jobControl.start") : t("mobile.jobControl.finish"), onPress: () => onWork(workKind), disabled: !workAllowed }}
          secondary={{ label: t("mobile.jobControl.shareTitle"), onPress: share, disabled: !ready }} />;
      }
    }
  }
  return <Screen title={job?.title ?? t("mobile.foremanHome.untitled")} navigation={{ kind: "back", label: t("mobile.crewSchedule.back"), onPress: onBack }} dock={dock}>
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.foremanHome.loading")}</Copy>}{status === "offline" && <Copy>{t("mobile.foremanHome.offline")}</Copy>}{status === "error" && <><Copy>{t("mobile.jobControl.error")}</Copy><Button label={t("mobile.foremanHome.retry")} onPress={onRetry} /></>}
    {job && <><Copy variant="supporting">{job.reference} · {job.place.alias}</Copy>
      {job.nextVisit && <SegmentedControl label={t("mobile.jobControl.whole")} value={view} onChange={onView ?? setPreviewView} options={[{ value: "today", label: t("mobile.jobControl.today") }, { value: "whole", label: t("mobile.jobControl.whole") }]} />}
      {job.flags.includes("crew_gap") && <Badge label={t("mobile.foremanHome.gap")} tone="critical" />}
      {job.flags.includes("open_problem") && <Badge label={t("mobile.jobHome.problemOpen")} tone="critical" />}
      {job.flags.includes("open_change") && <Card><Copy>{t("mobile.jobControl.changePending")}</Copy></Card>}
      {view === "whole" && <>
        <Card>
          <Copy variant="supporting">{stageSummary}{stageAccent?.by ? ` · ${stageAccent.by}` : ""}</Copy>
          <Copy variant="display">{stageLabelText}</Copy>
          {stageAccent && <Copy>{stampTime(format, stageAccent.at, job.siteZone)}</Copy>}
          <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <JobLine kind="journey" steps={journeyLabels(t)} current={stageIndex} accessibilityLabel={stageSummary} pulse={false} activity={job.journey.complete ? "finished" : "quiet"}
              status={job.journey.cancelled ? { state: "cancelled", label: stageLabelText } : undefined} />
          </View>
        </Card>
        <BillCard bill={bill} payee={payee} sent={billSent} paid={paid} siteZone={job.siteZone} ready={status === "ready"} canSwitchToProvider={canSwitchToProvider}
          onSwitch={() => onNavigate("/switch-role")} />
        <Card>
          <VersionRow kind="quote" version={job.quote} root={root} history={job.history?.items} onNavigate={onNavigate} siteZone={job.siteZone} />
          {job.change && <VersionRow kind="change" version={job.change} root={root} history={job.history?.items} onNavigate={onNavigate} siteZone={job.siteZone} />}
          {job.nextVisit && <ListRow label={t("mobile.jobControl.schedule")} description={stampTime(format, job.nextVisit.window.startsAt, job.siteZone)} onPress={() => onNavigate(`${root}/schedule`)} />}
          {staffedVisit?.shifts.map(shift => <ListRow key={shift.shiftId} label={t("mobile.cover.shift")} onPress={() => onNavigate(`/f/shifts/${shift.shiftId}`)} />)}
        </Card>
        <History history={job.history?.items ?? []} earlier={earlier} status={earlierStatus} siteZone={job.siteZone} onEarlier={onEarlier} onRetry={onRetryEarlier} />
      </>}
      {view === "today" && <>
      {visit && <Copy variant="label">{t("mobile.jobControl.window")}</Copy>}
      {visit && <><LiveCapsule size="hero" state={live?.status ? statusStates[live.status] : "quiet"} stateLabel={customerLabel} source={`${job.customerName} · ${job.place.alias}`} reference={job.reference} time={bandLabel} zoneLine={siteZoneLabel} provenance={t("mobile.jobControl.shared", { status: customerLabel })} accessibilityLabel={[customerLabel, bandLabel, siteZoneLabel].join(", ")} line={{ kind: "visit", steps: days, current: dayIndex, accessibilityLabel: customerLabel }} /><Card><Copy variant="label">{t("mobile.jobControl.preview")}</Copy><Copy>{t("mobile.jobControl.shared", { status: customerLabel })}</Copy>{live?.source?.sharedByName && <Copy>{t("mobile.jobControl.sharedAt", { name: live.source.sharedByName, time: at(live.source.at) })}</Copy>}<Button label={t("mobile.jobControl.shareTitle")} variant="quiet" onPress={share} disabled={!ready} /></Card>
      <Card><Copy variant="sectionTitle">{t("mobile.jobControl.crew")}</Copy>{!visit.crew.length && <Copy>{t("mobile.jobControl.noCrew")}</Copy>}{visit.crew.map(person => { const hold = person.holds.some(h => h.state === "active"); const label = hold ? t("mobile.foremanHome.briefingHold") : person.attendance.departure ? t("mobile.foremanHome.departed") : person.attendance.arrival ? t("mobile.foremanHome.onSite") : person.estimate ? t("mobile.foremanHome.onWay") : t("mobile.foremanHome.confirmed"); return <View key={person.assignmentId}><CrewDots audience="foreman" people={[{ id: person.assignmentId, initials: person.workerName.split(/\s+/).map(x => x[0]).join("").slice(0,2), name: person.workerName, status: hold ? "hold" : person.attendance.arrival ? "onSite" : person.estimate ? "onTheWay" : "confirmed", statusLabel: label }]} />{person.attendance.arrival && <Copy>{at(person.attendance.arrival.actualAt)}</Copy>}{person.instruction && <Copy>{person.briefingReceipt?.acknowledgement ? t("mobile.foremanHome.briefingDone") : t("mobile.foremanHome.briefingDue")} · v{person.instruction.version.no}</Copy>}</View>; })}</Card></>}
      {!visit && job.nextVisit && <><Copy>{visitStatus === "offline" ? t("mobile.foremanHome.offline") : visitStatus === "error" ? t("mobile.jobControl.error") : t("mobile.foremanHome.loading")}</Copy>{visitStatus === "error" && <Button label={t("mobile.foremanHome.retry")} onPress={onRetry} />}</>}
      {!hasSignedOff && visit?.work?.kind === "work_finished" && <Copy>{t("mobile.jobControl.awaiting")}</Copy>}
      </>}
      {!hasSignedOff && assignmentShift && !assignmentSlot && <Copy>{t("mobile.jobControl.assignUnavailable")}</Copy>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {[...(view === "today" ? [{ label: t("mobile.jobControl.quote"), path: versionPath(root, "quote", job.quote?.versionId) }, { label: t("mobile.jobControl.schedule"), path: `${root}/schedule` }] : []),
          { label: t("mobile.jobControl.siteLog"), path: `${root}/site-log` },
          ...(!job.change || view === "today" ? [{ label: t("mobile.jobControl.change"), path: versionPath(root, "change", job.change?.versionId) }] : []),
          { label: t("mobile.jobControl.wrap"), path: `${root}/wrap-up` },
          ...(job.chatThreadId ? [{ label: t("mobile.jobControl.chat"), path: `/threads/${job.chatThreadId}` }] : []),
        ].map(link => <Button key={link.path} label={link.label} variant="neutral" onPress={() => onNavigate(link.path)} />)}
      </View>
      {checking && <Copy>{t("mobile.jobControl.checking")}</Copy>}{failed && <Copy>{t("mobile.jobControl.failed")}</Copy>}
    </>}
  </Screen>;
}

function stampTime(format: { siteTime: (at: number, zone: string) => SiteDateTime; zoneLabel: (zone: string, at: ClockParts<"site">) => string }, at: number, zone: string) {
  const clock = format.siteTime(at, zone);
  return clock.kind === "available" ? `${clock.siteTime} · ${format.zoneLabel(zone, clock.site)}` : zone;
}

function BillCard({ bill, payee, sent, paid, siteZone, ready, canSwitchToProvider, onSwitch }: {
  bill: Job["bill"]; payee?: string; sent?: Moment; paid?: Moment; siteZone: string;
  ready: boolean; canSwitchToProvider?: boolean; onSwitch: () => void;
}) {
  const t = useT(); const format = useFormat();
  const [preview, setPreview] = useState(false);
  if (!bill) return null;
  const label = bill.state === "none" ? t("mobile.jobControl.noBill") : bill.state === "draft" ? t("mobile.jobControl.billDraft")
    : bill.state === "sent" ? t("mobile.jobControl.billSent") : t("mobile.foremanHome.paid");
  const amount = bill.total ? format.money(bill.total.minor, bill.total.currency) : null;
  const stamp = bill.state === "sent" ? sent : bill.state === "paid_recorded" ? paid : null;
  return <>
    <Card>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
        <Copy variant="sectionTitle">{label}</Copy>
        {stamp && <Copy variant="supporting">{stampTime(format, stamp.at, siteZone)}</Copy>}
      </View>
      {bill.state === "sent" && <Badge label={t("mobile.jobControl.paymentNotRecorded")} tone="attention" />}
      {bill.state === "paid_recorded" && paid?.by && <Copy variant="supporting">{paid.by}</Copy>}
      {amount && <ListRow label={t("mobile.jobControl.billAmount")} trailing={<Copy variant="sectionTitle">{amount}</Copy>} />}
      {bill.state === "sent" && payee && <ListRow label={t("mobile.jobControl.billPayee")} trailing={<Copy variant="label">{payee}</Copy>} />}
    </Card>
    {bill.state === "sent" && <>
      <Card>
        <ListRow label={t("mobile.jobControl.customerSeesBill")} trailing={<Copy variant="label">{t("mobile.jobControl.billPreview")}</Copy>} selected={preview} onPress={() => setPreview(open => !open)} />
        {preview && <>
          <Copy variant="sectionTitle">{amount}</Copy>
          <Copy>{t("mobile.aftercare.due")}</Copy>
          {payee && <Copy>{t("mobile.aftercare.payDirect", { provider: payee })}</Copy>}
        </>}
      </Card>
      {canSwitchToProvider && <Card>
        <ListRow label={t("mobile.jobControl.alsoProviderAdmin")} description={t("mobile.jobControl.switchForPayment")} onPress={ready ? onSwitch : undefined} />
      </Card>}
    </>}
  </>;
}

function versionPath(root: string, kind: "quote" | "change", versionId?: string) {
  return `${root}/${kind}${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ""}`;
}

function VersionRow({ kind, version, root, history, onNavigate, siteZone }: {
  kind: "quote" | "change"; version: Job["quote"] | Job["change"]; root: string; history?: Moment[];
  onNavigate: (path: string) => void; siteZone: string;
}) {
  const t = useT(); const format = useFormat();
  const label = kind === "quote" ? t("mobile.jobControl.quote") : t("mobile.jobControl.currentChange");
  const state = version?.state;
  const labels = {
    draft: t("mobile.foremanQuote.draft"), in_review: t("mobile.foremanQuote.inReview"), returned: t("mobile.foremanQuote.returned"),
    issued: t("mobile.foremanQuote.sent"), approved: t("mobile.foremanQuote.approved"), declined: t("mobile.foremanQuote.rejected"),
    rejected: t("mobile.foremanQuote.rejected"), superseded: t("mobile.customerQuote.superseded"), withdrawn: t("mobile.provider.withdrawn"),
  };
  const stamp = version && history?.find(item => item.recordId === version.versionId && (
    (state === "issued" && item.kind === `${kind}_issued`) || (state === "approved" && item.kind === `${kind}_approved`)
    || (state === "in_review" && item.kind === `${kind}_in_review`) || (state === "returned" && item.kind === `${kind}_returned`)
  ));
  const description = version && state ? [
    t("mobile.foremanQuote.version", { number: version.no, status: labels[state] }),
    ...(stamp ? [stamp.by, stampTime(format, stamp.at, siteZone)] : []),
  ].filter(Boolean).join(" · ") : t("mobile.jobHome.noQuote");
  return <ListRow label={label} description={description} onPress={() => onNavigate(versionPath(root, kind, version?.versionId))} />;
}

function History({ history, earlier, status, siteZone, onEarlier, onRetry }: {
  history: Moment[]; earlier: Moment[]; status?: RemoteStatus; siteZone: string; onEarlier?: () => void; onRetry?: () => void;
}) {
  const t = useT(); const format = useFormat();
  const labels: Record<Moment["kind"], string> = {
    requested: t("mobile.jobHome.eventRequested"),
    quote_issued: t("mobile.jobHome.eventQuote"), quote_approved: t("mobile.jobHome.eventApproved"),
    visit_booked: t("mobile.jobHome.eventBooked"), visit_revised: t("mobile.jobControl.visitRevised"), cancelled: t("mobile.jobHome.eventCancelled"),
    change_issued: t("mobile.jobControl.changeSent"), completion_submitted: t("mobile.jobControl.completionSubmitted"), signed_off: t("mobile.jobHome.eventSigned"),
    bill_issued: t("mobile.jobControl.billSent"), paid: t("mobile.jobHome.eventPaid"), case_opened: t("mobile.jobHome.eventCase"),
    crew_confirmed: t("mobile.foremanHome.confirmed"), on_the_way: t("mobile.foremanHome.onWay"), arrival_revised: t("mobile.jobControl.arrivalRevised"),
    arrival_withdrawn: t("mobile.jobControl.arrivalWithdrawn"), on_site: t("mobile.foremanHome.onSite"), working: t("mobile.foremanHome.working"),
    paused: t("mobile.foremanHome.paused"), photo: t("mobile.liveVisit.photo"), cover_arranging: t("mobile.cover.coverArranging"),
    crew_updated: t("mobile.cover.crewUpdated"), finished: t("mobile.foremanHome.finished"),
    quote_in_review: t("mobile.jobControl.quoteInReview"), quote_returned: t("mobile.jobControl.quoteReturned"),
    change_in_review: t("mobile.jobControl.changeInReview"), change_returned: t("mobile.jobControl.changeReturned"),
    change_approved: t("mobile.jobControl.changeApproved"), payment_corrected: t("mobile.jobControl.paymentCorrected"),
  };
  return <Card>
    <Copy variant="sectionTitle">{t("mobile.jobHome.history")}</Copy>
    {!history.length && <Copy>{t("mobile.jobHome.noHistory")}</Copy>}
    {[...history, ...earlier].map(item =>
      <Stamp key={`${item.kind}:${item.recordId}`} title={labels[item.kind]} attribution={item.by ?? undefined} time={stampTime(format, item.at, siteZone)}
        kind={item.kind === "signed_off" || item.kind === "paid" || item.kind === "quote_approved" || item.kind === "change_approved" ? "decision" : "system"} />)}
    {status === "loading" && <Copy>{t("mobile.foremanHome.loading")}</Copy>}
    {status === "error" && onRetry && <Button variant="quiet" label={t("mobile.foremanHome.retry")} onPress={onRetry} />}
    {onEarlier && <Button variant="neutral" label={t("mobile.jobControl.earlierHistory")} onPress={onEarlier} />}
  </Card>;
}
