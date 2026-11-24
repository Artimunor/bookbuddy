import { getJobRoute, type JobDetail } from "@bookbuddy/api-contract";
import { JOURNEY_STEPS } from "@bookbuddy/domain";
import type { Translator } from "@bookbuddy/i18n";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { useRemote } from "../../api";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Button, Card, Dock, ListRow, Screen, SegmentedControl, StatusBanner } from "../../ui/controls";
import { Copy, Target } from "../../ui/controls/shared";
import { CrewDots, JobLine, Stamp } from "../../ui/live";
import { journeyLabels } from "../c-01/common";
import { LiveVisitScreen } from "../c-09/Screen";

type Job = Extract<Extract<JobDetail, { audience: "customer" }>["job"], { view: "whole" }>;
type Moment = Job["history"]["items"][number];
type T = Translator<"mobile">["t"];

function momentTitle(t: T, kind: Moment["kind"]) {
  switch (kind) {
    case "requested": return t("mobile.jobHome.eventRequested");
    case "quote_issued": return t("mobile.jobHome.eventQuote");
    case "quote_approved": return t("mobile.jobHome.eventApproved");
    case "visit_booked": return t("mobile.jobHome.eventBooked");
    case "cancelled": return t("mobile.jobHome.eventCancelled");
    case "signed_off": return t("mobile.jobHome.eventSigned");
    case "bill_issued": return t("mobile.jobHome.eventBill");
    case "paid": return t("mobile.jobHome.eventPaid");
    case "case_opened": return t("mobile.jobHome.eventCase");
    default: return t("mobile.customerHome.update");
  }
}

function momentPath(jobId: string, item: Moment): string | null {
  const root = `/c/jobs/${jobId}`;
  switch (item.kind) {
    case "quote_issued": case "quote_approved": return `${root}/quote/${item.recordId}`;
    case "visit_booked": case "visit_revised": return `${root}/windows`;
    case "change_issued": return `${root}/change/${item.recordId}`;
    case "completion_submitted": case "signed_off": return `${root}/completion`;
    case "bill_issued": case "paid": return `${root}/bill`;
    case "case_opened": return `${root}/case/${item.recordId}`;
    default: return null;
  }
}

export default function JobHomeScreen() {
  const { jobId, view: requestedView } = useLocalSearchParams<{ jobId: string; view?: string }>();
  const router = useRouter();
  const { preferences } = useSession();
  const [view, setView] = useState<"today" | "whole">(requestedView === "whole" ? "whole" : "today");
  useEffect(() => { setView(requestedView === "whole" ? "whole" : "today"); }, [requestedView]);
  const remote = useRemote(getJobRoute, { params: { j: jobId ?? "" }, query: { view: "whole" } }, { enabled: !!jobId });
  useEffect(() => {
    if (remote.error?.code === "NOT_FOUND" || remote.error?.code === "UNAUTHENTICATED") router.replace("/help?reason=removed" as Href);
  }, [remote.error, router]);
  const job = remote.data?.audience === "customer" && remote.data.job.view === "whole" ? remote.data.job : null;
  const lastVisit = useRef<{ jobId: string; visitId: string } | null>(null);
  if (job?.hasTodayView && job.nextVisit) lastVisit.current = { jobId: job.jobId, visitId: job.nextVisit.visitId };
  const liveVisitId = job?.hasTodayView ? job.nextVisit?.visitId : remote.status === "offline" && lastVisit.current?.jobId === jobId ? lastVisit.current.visitId : undefined;
  const switcher = <JobViewSwitcher value={view} onChange={next => { setView(next); router.setParams({ view: next }); }} />;
  if (view === "today" && liveVisitId) return <LiveVisitScreen visitId={liveVisitId} twoClock={preferences?.twoClock ?? false} viewSwitcher={switcher} onBack={() => router.back()} onNavigate={path => router.push(path as Href)} />;
  return <JobHomeView job={job} status={jobId ? remote.status : "error"} twoClock={preferences?.twoClock ?? false} onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} onNavigate={(path) => router.push(path as Href)} viewSwitcher={switcher} />;
}

function JobViewSwitcher({ value, onChange }: { value: "today" | "whole"; onChange: (value: "today" | "whole") => void }) {
  const t = useT();
  return <SegmentedControl label={t("mobile.liveVisit.views")} value={value} onChange={onChange} options={[{ value: "today", label: t("mobile.liveVisit.today") }, { value: "whole", label: t("mobile.liveVisit.whole") }]} />;
}

/** C-09 can supply an in-place Today/Whole job switch without adding a route. */
export function JobHomeView({ job, status, twoClock = false, onBack, onRetry, onNavigate, viewSwitcher }: {
  job: Job | null; status: RemoteStatus; twoClock?: boolean; onBack: () => void; onRetry: () => void;
  onNavigate: (path: string) => void; viewSwitcher?: ReactNode;
}) {
  const t = useT(); const format = useFormat(); const [more, setMore] = useState(false);
  const current = job ? JOURNEY_STEPS.indexOf(job.journey.step) as 0 | 1 | 2 | 3 | 4 | 5 : 0;
  const labels = journeyLabels(t);
  const readable = status === "ready" ? job : null;
  const root = readable ? `/c/jobs/${readable.jobId}` : "";
  const next = readable?.nextStep;
  const quote = readable?.quote;
  const stage = !readable ? "" : readable.journey.cancelled ? t("mobile.customerHome.cancelled") : readable.state === "closed" ? t("mobile.jobHome.closed") : next?.kind === "review_completion" || next?.kind === "sign_off" ? t("mobile.jobHome.finished") : quote?.state === "approved" && readable.journey.step === "quoted" ? t("mobile.jobHome.quoteApproved") : quote?.state === "issued" && readable.journey.step === "quoted" ? t("mobile.jobHome.quoteReady") : labels[current];
  const at = (value: number) => { const time = format.siteTime(value, readable?.siteZone); return time.kind === "available" ? time.siteTime : readable?.siteZone ?? ""; };
  const band = readable?.nextVisit?.window;
  const visitTime = band ? t("mobile.jobHome.range", { start: at(band.startsAt), end: at(band.endsAt) }) : null;
  const viewerZone = twoClock ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const viewerStart = band ? format.twoClock(band.startsAt, readable?.siteZone, viewerZone) : null;
  const viewerEnd = band ? format.twoClock(band.endsAt, readable?.siteZone, viewerZone) : null;
  const viewerTime = viewerStart?.kind === "available" && viewerEnd?.kind === "available" && viewerStart.viewerTime && viewerEnd.viewerTime ? t("mobile.jobHome.yourTime", { time: t("mobile.jobHome.range", { start: viewerStart.viewerTime, end: viewerEnd.viewerTime }) }) : null;
  const chat = readable?.chatThreadId ? () => onNavigate(`/threads/${readable.chatThreadId}`) : undefined;
  let primary: { label: string; onPress: () => void } | undefined;
  if (readable && !readable.journey.cancelled) {
    switch (next?.kind) {
      case "review_quote": case "read_quote": case "wait_for_approver": if (quote) primary = { label: next.kind === "review_quote" ? t("mobile.customerHome.reviewQuote") : t("mobile.jobHome.readQuote"), onPress: () => onNavigate(`${root}/quote/${quote.versionId}`) }; break;
      case "pick_window": case "review_revised_visit": primary = { label: t("mobile.customerHome.pickWindow"), onPress: () => onNavigate(`${root}/windows`) }; break;
      case "review_change": if (readable.change) primary = { label: t("mobile.customerHome.reviewChange"), onPress: () => onNavigate(`${root}/change/${readable.change!.versionId}`) }; break;
      case "review_completion": case "sign_off": primary = { label: t("mobile.customerHome.signOff"), onPress: () => onNavigate(`${root}/completion`) }; break;
      case "see_bill": primary = { label: t("mobile.customerHome.seeBill"), onPress: () => onNavigate(`${root}/bill`) }; break;
      case "open_case": if (readable.openCase) primary = { label: t("mobile.jobHome.openCase"), onPress: () => onNavigate(`${root}/case/${readable.openCase!.caseId}`) }; break;
      case "rate_job": primary = { label: t("mobile.jobHome.rate"), onPress: () => onNavigate(`${root}/rating`) }; break;
      case "wait_for_windows": case "visit": if (chat) primary = { label: t("mobile.jobHome.message"), onPress: chat }; break;
    }
    if (readable.openCase) primary = { label: t("mobile.jobHome.openCase"), onPress: () => onNavigate(`${root}/case/${readable.openCase!.caseId}`) };
  }
  const dock = primary ? <Dock primary={primary} secondary={chat && primary.onPress !== chat ? { label: t("mobile.jobHome.message"), onPress: chat } : undefined} /> : undefined;
  return <Screen title={readable?.title || t("mobile.customerHome.untitled")} navigation={{ kind: "back", label: t("mobile.jobHome.back"), onPress: onBack }} dock={dock}>
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.jobHome.loading")}</Copy>}
    {status === "offline" && <StatusBanner state="offline" label={t("mobile.jobHome.offline")} />}
    {(status === "error" || (status === "ready" && !readable)) && <><Copy>{t("mobile.jobHome.unavailable")}</Copy><Button label={t("mobile.jobHome.retry")} onPress={onRetry} /></>}
    {readable && <>
      <Copy variant="supporting">{readable.reference} · {readable.place.alias}</Copy>
      <Button variant="quiet" label={t("mobile.jobHome.more")} onPress={() => setMore(!more)} />
      {more && <Card><ListRow label={t("mobile.jobHome.cancel")} onPress={() => onNavigate(`${root}/cancel`)} /><ListRow label={t("mobile.jobHome.report")} onPress={() => onNavigate(`${root}/case/${readable.openCase?.caseId ?? "new"}`)} /><ListRow label={t("mobile.jobHome.place")} onPress={() => onNavigate(`/c/places/${readable.place.placeId}`)} /></Card>}
      {readable.hasTodayView && viewSwitcher}
      <Card>
        <Copy variant="supporting">{readable.providerName} · {t("mobile.customerHome.step", { step: current + 1, stage: labels[current] })}</Copy>
        <Copy variant="display" accessibilityLiveRegion="polite">{stage}</Copy>
        {quote?.state === "issued" && <Copy variant="sectionTitle">{t("mobile.jobHome.wholeTotal", { amount: format.money(quote.total.minor, quote.total.currency) })}</Copy>}
        {next?.kind === "review_quote" && <Copy variant="supporting">{t("mobile.jobHome.approver", { place: readable.place.alias })}</Copy>}
        {next?.kind === "wait_for_approver" && next.waitingOn && <Copy variant="supporting">{t("mobile.jobHome.waitingApprover", { name: next.waitingOn })}</Copy>}
        {next?.kind === "wait_for_quote" && <Copy variant="supporting">{t("mobile.jobHome.requestedDetail")}</Copy>}
        {next?.kind === "wait_for_windows" && <Copy variant="supporting">{t("mobile.jobHome.waitingWindows")}</Copy>}
        {readable.journey.step === "booked" && visitTime && <><Copy>{t("mobile.jobHome.nextVisit", { time: visitTime })}</Copy><Copy variant="supporting">{t("mobile.jobHome.nothingNeeded")}</Copy></>}
        <JobLine kind="journey" steps={labels} current={current} pulse={false} activity={readable.journey.complete ? "finished" : "live"} status={readable.journey.cancelled ? { state: "cancelled", label: t("mobile.customerHome.cancelled") } : undefined} accessibilityLabel={t("mobile.customerHome.step", { step: current + 1, stage })} />
      </Card>
      {readable.change?.state === "issued" && <Card onPress={() => onNavigate(`${root}/change/${readable.change!.versionId}`)} accessibilityLabel={t("mobile.jobHome.change", { amount: format.money(readable.change.delta.minor, readable.change.delta.currency) })}><Badge tone="attention" label={t("mobile.jobHome.change", { amount: format.money(readable.change.delta.minor, readable.change.delta.currency) })} /></Card>}
      {readable.openCase && <Card onPress={() => onNavigate(`${root}/case/${readable.openCase!.caseId}`)} accessibilityLabel={t("mobile.jobHome.openCase")}><Badge tone="critical" label={t("mobile.jobHome.problemOpen")} />{readable.openCase.state === "awaiting_plan" && <Copy>{t("mobile.jobHome.awaitingPlan")}</Copy>}</Card>}
      <Card>
        <ListRow label={quote ? t("mobile.jobHome.quote", { version: quote.version, amount: format.money(quote.total.minor, quote.total.currency) }) : t("mobile.jobHome.noQuote")} onPress={quote ? () => onNavigate(`${root}/quote/${quote.versionId}`) : undefined} />
        <ListRow label={t("mobile.jobHome.visit")} description={visitTime ?? (quote?.state === "issued" ? t("mobile.jobHome.afterApproval") : t("mobile.jobHome.noWindows"))} onPress={() => onNavigate(`${root}/windows`)} />
        {viewerTime && <Copy variant="supporting">{viewerTime}</Copy>}
        {readable.foremanName ? <><ListRow label={readable.foremanName} description={t("mobile.jobHome.foreman")} onPress={chat} /><CrewDots audience="customer" people={[{ id: readable.foremanName, name: readable.foremanName, initials: readable.foremanName.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join("").toUpperCase(), role: t("mobile.jobHome.foreman") }]} /></> : <ListRow label={t("mobile.jobHome.crewPending")} />}
        {readable.bill && <ListRow label={t("mobile.customerHome.seeBill")} description={format.money(readable.bill.total.minor, readable.bill.total.currency)} onPress={() => onNavigate(`${root}/bill`)} />}
      </Card>
      <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.jobHome.history")}</Copy>
      {!readable.history.items.length && <Copy variant="supporting">{t("mobile.jobHome.noHistory")}</Copy>}
      {readable.history.items.map((item, index) => { const title = momentTitle(t, item.kind); const path = momentPath(readable.jobId, item); const stamp = <Stamp kind="system" title={title} time={at(item.at)} attribution={item.by ?? undefined} />; return path ? <Target key={`${item.kind}-${item.recordId}-${index}`} accessibilityRole="button" accessibilityLabel={`${title}, ${at(item.at)}`} onPress={() => onNavigate(path)}>{stamp}</Target> : <View key={`${item.kind}-${item.recordId}-${index}`}>{stamp}</View>; })}
    </>}
  </Screen>;
}
