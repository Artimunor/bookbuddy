import { getJobRoute, listContractNoticesRoute, type ContractNotice, type JobDetail } from "@bookbuddy/api-contract";
import { JOURNEY_STEPS } from "@bookbuddy/domain";
import type { Translator } from "@bookbuddy/i18n";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { useRemote } from "../../api";
import { useLiveHints } from "../../api/live";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Button, Card, Dock, ListRow, Screen, SegmentedControl, StatusBanner } from "../../ui/controls";
import { Copy, Target } from "../../ui/controls/shared";
import { JobLine, Stamp } from "../../ui/live";
import { journeyLabels } from "../c-01/common";
import { siteWindow } from "../c-01/clock";
import { useBeaconTheme } from "../../ui/theme";
import { LiveVisitScreen } from "../c-09/Screen";
import { readingLanguageLabel } from "../s-12/language";

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
  const { jobId, view: requestedView, fromSwitch } = useLocalSearchParams<{ jobId: string; view?: string; fromSwitch?: string }>();
  const router = useRouter();
  const { preferences } = useSession();
  const [view, setView] = useState<"today" | "whole">(requestedView === "whole" ? "whole" : "today");
  useEffect(() => { setView(requestedView === "whole" ? "whole" : "today"); }, [requestedView]);
  const remote = useRemote(getJobRoute, { params: { j: jobId ?? "" }, query: { view: "whole" } }, { enabled: !!jobId });
  useEffect(() => {
    if (remote.error?.code === "NOT_FOUND") router.replace(fromSwitch === "1" ? "/c/now" : "/help?reason=removed" as Href);
    if (remote.error?.code === "UNAUTHENTICATED") router.replace("/help?reason=removed" as Href);
  }, [fromSwitch, remote.error, router]);
  const job = remote.data?.audience === "customer" && remote.data.job.view === "whole" ? remote.data.job : null;
  const lastVisit = useRef<{ jobId: string; visitId: string } | null>(null);
  if (job?.hasTodayView && job.nextVisit) lastVisit.current = { jobId: job.jobId, visitId: job.nextVisit.visitId };
  const liveVisitId = job?.hasTodayView ? job.nextVisit?.visitId : remote.status === "offline" && lastVisit.current?.jobId === jobId ? lastVisit.current.visitId : undefined;
  const subscribedVisit = liveVisitId ?? (remote.status === "loading" && lastVisit.current?.jobId === jobId ? lastVisit.current?.visitId : undefined);
  const retryLive = useLiveHints(view === "whole" && subscribedVisit ? { kind: "customer-visit", opaqueId: subscribedVisit } : null, remote.refresh);
  const switcher = <JobViewSwitcher value={view} onChange={next => { setView(next); router.setParams({ view: next }); }} />;
  if (view === "today" && liveVisitId) return <LiveVisitScreen visitId={liveVisitId} twoClock={preferences?.twoClock ?? false} viewSwitcher={switcher} onBack={() => router.back()} onNavigate={path => router.push(path as Href)} />;
  return <JobHomeView job={job} status={jobId ? remote.status : "error"} twoClock={preferences?.twoClock ?? false} onBack={() => router.back()} onRetry={() => { retryLive(); void remote.refresh(); }} onNavigate={(path) => router.push(path as Href)} viewSwitcher={switcher}
    history={job && <JobHistory key={`${job.jobId}:${job.history.page.cursor ?? ""}`} job={job} onNavigate={path => router.push(path as Href)} />}
    receipts={job?.quote && <WithdrawalReceipts key={job.jobId} job={job} />} />;
}

function JobViewSwitcher({ value, onChange }: { value: "today" | "whole"; onChange: (value: "today" | "whole") => void }) {
  const t = useT();
  return <SegmentedControl label={t("mobile.liveVisit.views")} hideLabel value={value} onChange={onChange} options={[{ value: "today", label: t("mobile.liveVisit.today") }, { value: "whole", label: t("mobile.liveVisit.whole") }]} />;
}

/** C-09 can supply an in-place Today/Whole job switch without adding a route. */
export function JobHomeView({ job, status, twoClock = false, onBack, onRetry, onNavigate, viewSwitcher, history, receipts }: {
  job: Job | null; status: RemoteStatus; twoClock?: boolean; onBack: () => void; onRetry: () => void;
  onNavigate: (path: string) => void; viewSwitcher?: ReactNode;
  history?: ReactNode; receipts?: ReactNode;
}) {
  const t = useT(); const format = useFormat(); const { color, space } = useBeaconTheme(); const [more, setMore] = useState(false);
  const current = job ? JOURNEY_STEPS.indexOf(job.journey.step) as 0 | 1 | 2 | 3 | 4 | 5 : 0;
  const labels = journeyLabels(t);
  const readable = status === "ready" ? job : null;
  const root = readable ? `/c/jobs/${readable.jobId}` : "";
  const next = readable?.nextStep;
  const quote = readable?.quote;
  const crew = readable?.crew;
  const cancellation = readable?.cancellation;
  const lead = crew?.leadName;
  const stage = !readable ? "" : readable.journey.cancelled ? t("mobile.customerHome.cancelled") : readable.state === "closed" ? t("mobile.jobHome.closed") : next?.kind === "review_completion" || next?.kind === "sign_off" ? t("mobile.jobHome.finished") : quote?.state === "approved" && readable.journey.step === "quoted" ? t("mobile.jobHome.quoteApproved") : quote?.state === "issued" && readable.journey.step === "quoted" ? t("mobile.jobHome.quoteReady") : labels[current];
  const message = readable?.foremanName ? t("mobile.liveVisit.message", { name: readable.foremanName }) : t("mobile.jobHome.message");
  const band = readable?.nextVisit?.window;
  const clock = band ? siteWindow(format, band.startsAt, band.endsAt, readable?.siteZone, twoClock ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined) : null;
  const visitTime = clock ? [clock.date, `${clock.time} ${clock.zone}`].filter(Boolean).join(" · ") : null;
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
      case "wait_for_windows": case "visit": if (chat) primary = { label: message, onPress: chat }; break;
    }
    if (readable.openCase) primary = { label: t("mobile.jobHome.openCase"), onPress: () => onNavigate(`${root}/case/${readable.openCase!.caseId}`) };
  }
  const dock = primary ? <Dock primary={{ ...primary, glyph: primary.onPress === chat ? "✉" : undefined }} secondary={chat && primary.onPress !== chat ? { label: message, onPress: chat } : undefined} /> : undefined;
  return <Screen title={readable?.title || t("mobile.customerHome.untitled")} subtitle={readable ? `${readable.reference} · ${readable.place.alias}` : undefined}
    navigation={{ kind: "back", label: t("mobile.jobHome.back"), onPress: onBack }} dock={dock}
    trailing={readable ? <Button variant="navigation" iconOnly glyph="⋯" label={t("mobile.jobHome.more")} onPress={() => setMore(!more)} /> : undefined}>
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.jobHome.loading")}</Copy>}
    {status === "offline" && <StatusBanner state="offline" label={t("mobile.jobHome.offline")} />}
    {(status === "error" || (status === "ready" && !readable)) && <><Copy>{t("mobile.jobHome.unavailable")}</Copy><Button label={t("mobile.jobHome.retry")} onPress={onRetry} /></>}
    {readable && <>
      {more && <Card><ListRow label={t("mobile.jobHome.cancel")} onPress={() => onNavigate(`${root}/cancel`)} /><ListRow label={t("mobile.jobHome.report")} onPress={() => onNavigate(`${root}/case/${readable.openCase?.caseId ?? "new"}`)} /><ListRow label={t("mobile.jobHome.place")} onPress={() => onNavigate(`/c/places/${readable.place.placeId}`)} /></Card>}
      {readable.hasTodayView && viewSwitcher}
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", columnGap: space.grid[3] }}>
          <Copy variant="caption" style={{ color: color.muted }}>{readable.providerName}</Copy>
          <Copy variant="caption" style={{ color: color.muted }}>{t("mobile.jobHome.journeyStep", { step: current + 1 })}</Copy>
        </View>
        <Copy variant="pageTitle" accessibilityLiveRegion="polite">{stage}</Copy>
        {cancellation && <Copy variant="supporting">{cancellation.by
          ? t("mobile.jobHome.cancelledBy", { name: cancellation.by, time: format.lines(cancellation.at, readable.siteZone)?.site ?? readable.siteZone })
          : t("mobile.jobHome.cancelledAt", { time: format.lines(cancellation.at, readable.siteZone)?.site ?? readable.siteZone })}</Copy>}
        {quote?.state === "issued" && <Copy variant="sectionTitle">{t("mobile.jobHome.wholeTotal", { amount: format.money(quote.total.minor, quote.total.currency) })}</Copy>}
        {next?.kind === "review_quote" && <Copy variant="supporting">{t("mobile.jobHome.approver", { place: readable.place.alias })}</Copy>}
        {next?.kind === "wait_for_approver" && next.waitingOn && <Copy variant="supporting">{t("mobile.jobHome.waitingApprover", { name: next.waitingOn })}</Copy>}
        {next?.kind === "wait_for_quote" && <Copy variant="supporting">{t("mobile.jobHome.requestedDetail")}</Copy>}
        {next?.kind === "wait_for_windows" && <Copy variant="supporting">{t("mobile.jobHome.waitingWindows")}</Copy>}
        {readable.journey.step === "booked" && clock && <><Copy variant="label">{t("mobile.jobHome.nextVisit", { time: clock.date ?? clock.time })}</Copy><Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.jobHome.nothingNeeded")}</Copy></>}
        <JobLine kind="journey" steps={labels} current={current} pulse={false} activity={readable.journey.complete ? "finished" : "live"} status={readable.journey.cancelled ? { state: "cancelled", label: t("mobile.customerHome.cancelled") } : undefined} accessibilityLabel={t("mobile.customerHome.step", { step: current + 1, stage })} />
      </Card>
      {readable.change?.state === "issued" && <Card onPress={() => onNavigate(`${root}/change/${readable.change!.versionId}`)} accessibilityLabel={t("mobile.jobHome.change", { amount: format.money(readable.change.delta.minor, readable.change.delta.currency) })}><Badge tone="attention" label={t("mobile.jobHome.change", { amount: format.money(readable.change.delta.minor, readable.change.delta.currency) })} /></Card>}
      {readable.openCase && <Card onPress={() => onNavigate(`${root}/case/${readable.openCase!.caseId}`)} accessibilityLabel={t("mobile.jobHome.openCase")}><Badge tone="critical" label={t("mobile.jobHome.problemOpen")} />{readable.openCase.state === "awaiting_plan" && <Copy>{t("mobile.jobHome.awaitingPlan")}</Copy>}</Card>}
      <Card>
        <ListRow glyph="≋" label={quote ? t("mobile.jobHome.quote", { version: quote.version, amount: format.money(quote.total.minor, quote.total.currency) }) : t("mobile.jobHome.noQuote")} description={quote?.approved
          ? `${quote.approved.by ? t("mobile.jobHome.approvedBy", { name: quote.approved.by }) : t("mobile.jobHome.eventApproved")} · ${format.lines(quote.approved.at, readable.siteZone)?.site ?? readable.siteZone}`
          : quote?.sent ? `${quote.sent.by ? t("mobile.jobHome.sentBy", { name: quote.sent.by }) : t("mobile.jobHome.eventQuote")} · ${format.lines(quote.sent.at, readable.siteZone)?.site ?? readable.siteZone}` : undefined}
          onPress={quote ? () => onNavigate(`${root}/quote/${quote.versionId}`) : undefined} />
        <ListRow glyph="▦" label={t("mobile.jobHome.visit")} description={visitTime ? [visitTime, clock?.viewer].filter(Boolean).join("\n") : quote?.state === "issued" ? t("mobile.jobHome.afterApproval") : t("mobile.jobHome.noWindows")} onPress={() => onNavigate(`${root}/windows`)} />
        {crew ? <>
          <ListRow glyph="●" label={lead ?? t("mobile.jobHome.crewConfirmed")} description={lead ? t("mobile.jobHome.crewLeadCount", { count: crew.count }) : t("mobile.jobHome.crewCount", { count: crew.count })} onPress={chat} />
          {readable.foremanName && readable.foremanName !== lead && <ListRow label={readable.foremanName} description={t("mobile.jobHome.foreman")} onPress={chat} />}
        </> : <ListRow label={t("mobile.jobHome.crewPending")} />}
        {readable.bill && <ListRow label={t("mobile.customerHome.seeBill")} description={format.money(readable.bill.total.minor, readable.bill.total.currency)} onPress={() => onNavigate(`${root}/bill`)} />}
      </Card>
      {history ?? <HistoryStamps job={readable} pages={[readable.history]} onNavigate={onNavigate} />}
      {receipts}
    </>}
  </Screen>;
}

function JobHistory({ job, onNavigate }: { job: Job; onNavigate: (path: string) => void }) {
  const t = useT();
  const [earlier, setEarlier] = useState<{ cursor: string; pages: Job["history"][] } | null>(null);
  const remote = useRemote(getJobRoute, { params: { j: job.jobId }, query: { view: "whole", cursor: earlier?.cursor } }, { enabled: earlier !== null });
  const current = earlier && remote.data?.audience === "customer" && remote.data.job.view === "whole" ? remote.data.job.history : null;
  const pages = [job.history, ...earlier?.pages ?? [], ...(current ? [current] : [])];
  const tail = pages.at(-1)!;
  const cursor = tail.page.hasMore ? tail.page.cursor : null;
  const waiting = earlier !== null && (remote.status === "idle" || remote.status === "loading");
  const blocked = earlier !== null && (remote.status === "offline" || remote.status === "error");
  return <>
    <HistoryStamps job={job} pages={pages} onNavigate={onNavigate} />
    {blocked && <Copy variant="supporting">{remote.status === "offline" ? t("mobile.jobHome.offline") : t("mobile.jobHome.historyUnavailable")}</Copy>}
    {cursor && <Button variant="quiet" label={t("mobile.jobHome.earlier")} busy={waiting} disabled={waiting || remote.status === "offline"} onPress={() => {
      if (blocked) { void remote.refresh(); return; }
      setEarlier({ cursor, pages: current ? [...earlier?.pages ?? [], current] : [] });
    }} />}
  </>;
}

function HistoryStamps({ job, pages, onNavigate }: { job: Job; pages: readonly Job["history"][]; onNavigate: (path: string) => void }) {
  const t = useT(); const format = useFormat();
  return <>
    <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.jobHome.history")}</Copy>
    {!pages[0]?.items.length && <Copy variant="supporting">{t("mobile.jobHome.noHistory")}</Copy>}
    {pages.map(({ items }, page) => items.map((item, index) => {
      const title = momentTitle(t, item.kind);
      const path = momentPath(job.jobId, item);
      const time = format.lines(item.at, job.siteZone)?.site ?? job.siteZone;
      const stamp = <Stamp kind="system" title={title} time={time} attribution={item.by ?? undefined} />;
      const key = `${page}-${index}-${item.recordId}`;
      return path ? <Target key={key} accessibilityRole="button" accessibilityLabel={[title, item.by, time].filter(Boolean).join(", ")} onPress={() => onNavigate(path)}>{stamp}</Target>
        : <View key={key}>{stamp}</View>;
    }))}
  </>;
}

function WithdrawalReceipts({ job }: { job: Job }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const remote = useRemote(listContractNoticesRoute, { params: { j: job.jobId } }, { enabled: open });
  return <Card>
    <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.jobHome.withdrawals")}</Copy>
    <Button variant="quiet" label={open ? t("mobile.jobHome.hideWithdrawals") : t("mobile.jobHome.showWithdrawals")} onPress={() => setOpen(!open)} />
    {open && (remote.status === "ready" ? <WithdrawalReceiptList notices={remote.data.notices} siteZone={job.siteZone} /> :
      remote.status === "error" ? <><Copy>{t("mobile.jobHome.withdrawalsUnavailable")}</Copy>
        {remote.error?.code !== "NOT_FOUND" && remote.error?.code !== "UNAUTHENTICATED" && <Button variant="quiet" label={t("shared.action.retry")} onPress={() => { void remote.refresh(); }} />}</> :
      <Copy>{remote.status === "offline" ? t("mobile.jobHome.offline") : t("mobile.jobHome.withdrawalsLoading")}</Copy>)}
  </Card>;
}

function deliveryLabel(t: T, state: ContractNotice["deliveryState"]) {
  switch (state) {
    case "delivered": return t("mobile.jobHome.withdrawalEmailSent");
    case "pending": case "claimed": return t("mobile.jobHome.withdrawalEmailPending");
    case "failed": return t("mobile.jobHome.withdrawalEmailFailed");
    case "skipped": return t("mobile.jobHome.withdrawalEmailSkipped");
    default: return t("mobile.jobHome.withdrawalEmailUnknown");
  }
}

export function WithdrawalReceiptList({ notices, siteZone }: { notices: readonly ContractNotice[]; siteZone: string }) {
  const t = useT(); const format = useFormat();
  const withdrawals = notices.filter(notice => notice.kind === "withdrawal");
  if (!withdrawals.length) return <Copy variant="supporting">{t("mobile.jobHome.noWithdrawals")}</Copy>;
  return withdrawals.map(notice => <View key={notice.id}>
    <Stamp kind="decision" title={t("mobile.jobHome.withdrawalReceived")} attribution={notice.actorDisplayName} time={format.lines(notice.at, siteZone)?.site ?? siteZone} />
    <Copy variant="label">{t("mobile.jobHome.withdrawalNoticeLanguage", { language: readingLanguageLabel(t, notice.noticeLocale) })}</Copy>
    <Copy>{notice.noticeText}</Copy>
    <Copy variant="label">{t("mobile.jobHome.withdrawalTermsLanguage", { language: readingLanguageLabel(t, notice.termsLocale) })}</Copy>
    <Copy>{notice.termsText}</Copy>
    <Copy variant="supporting">{deliveryLabel(t, notice.deliveryState)}</Copy>
  </View>);
}
