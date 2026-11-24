import { getBusinessOverviewRoute, type BusinessOverview } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { useRemote } from "../../api";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Card } from "../../ui/controls";
import { Copy, Target } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { ProviderScreenView, ReadState, useProvider, useProviderFormat as useFormat, useProviderLabels } from "./shared";

export default function BusinessNowScreen() {
  const { businessId, actor } = useProvider(); const router = useRouter();
  const scope = useSession().bootstrap?.capabilities?.sessions;
  const sessionsAvailable = !!businessId && !!scope && "businessId" in scope && scope.businessId === businessId;
  const t = useT();
  const remote = useRemote(getBusinessOverviewRoute, { params: { b: businessId } }, { enabled: !!businessId });
  return <BusinessNowView overview={remote.data} status={remote.status} actor={actor} onProfile={() => router.push("/you" as Href)} onNotifications={() => router.push("/notifications" as Href)} onRetry={() => { void remote.refresh(); }}
    onJob={(id) => router.push(({ pathname: "/p/jobs", params: { jobId: id, segment: remote.data?.handoffs.stuck.some((job) => job.jobId === id) ? "needs_you" : "active" } }) as Href)} onJobs={() => router.push("/p/jobs" as Href)} onPeople={() => router.push("/p/people" as Href)} onEligibility={() => router.push("/p/eligibility" as Href)}
    laterEntry={sessionsAvailable ? <Card accessibilityLabel={t("mobile.sessionSetup.sessions")} onPress={() => router.push("/p/sessions" as Href)}><Copy>{t("mobile.sessionSetup.sessions")}</Copy></Card> : undefined} />;
}

export function BusinessNowView({ overview, status, actor, onProfile, onNotifications, onRetry, onJob, onJobs, onPeople, onEligibility, laterEntry }: { overview: BusinessOverview | null; status: string; actor: string; onProfile: () => void; onNotifications: () => void; onRetry: () => void; onJob: (id: string) => void; onJobs: () => void; onPeople: () => void; onEligibility: () => void; laterEntry?: React.ReactNode }) {
  const t = useT(); const format = useFormat(); const labels = useProviderLabels(); const { color, radius, space } = useBeaconTheme();
  return <ProviderScreenView title={t("mobile.provider.now")} business={overview?.business.publicName} actor={actor} onProfile={onProfile} onNotifications={onNotifications}>
    <ReadState status={status} retry={onRetry} />
    {overview && status === "ready" && <>
      {(overview.handoffs.stuck.length > 0 || overview.bills.openCount > 0) && <Copy variant="sectionTitle">{t("mobile.provider.needsYou")}</Copy>}
      {overview.handoffs.stuck.map((job) => <Target key={job.jobId} accessibilityRole="button" onPress={() => onJob(job.jobId)} accessibilityLabel={[t("mobile.provider.handoffStuck"), job.title, job.reference, t("mobile.provider.since", { time: format.siteTime(job.since, job.siteZone) }), t("mobile.provider.offeredTo", { name: job.offeredTo }), job.accountableForeman ? t("mobile.provider.foreman", { name: job.accountableForeman }) : t("mobile.provider.noForeman")].join(" · ")} style={{ backgroundColor: color.criticalSoft, borderRadius: radius.card, padding: space.cardPadding, gap: space.grid[2] }}>
        <Badge tone="critical" label={t("mobile.provider.handoffStuck")} /><Copy variant="sectionTitle">{job.title} · {job.reference}</Copy>
        <Copy>{t("mobile.provider.since", { time: format.siteTime(job.since, job.siteZone) })}</Copy><Copy>{t("mobile.provider.offeredTo", { name: job.offeredTo })}</Copy><Copy>{job.accountableForeman ? t("mobile.provider.foreman", { name: job.accountableForeman }) : t("mobile.provider.noForeman")}</Copy>
      </Target>)}
      {overview.bills.openCount > 0 && <Target accessibilityRole="button" onPress={onJobs} accessibilityLabel={`${t("mobile.provider.recordPaid")} · ${t("mobile.provider.bills", { count: overview.bills.openCount, amount: format.money(overview.bills.totalMinor, overview.bills.currency) })}`} style={{ backgroundColor: color.attentionSoft, borderRadius: radius.card, padding: space.cardPadding, gap: space.grid[2] }}><Badge tone="attention" label={t("mobile.provider.recordPaid")} /><Copy>{t("mobile.provider.bills", { count: overview.bills.openCount, amount: format.money(overview.bills.totalMinor, overview.bills.currency) })}</Copy></Target>}
      <Copy variant="sectionTitle">{t("mobile.provider.liveNow")}</Copy>
      {overview.liveJob ? <Card onPress={() => onJob(overview.liveJob!.jobId)} accessibilityLabel={`${overview.liveJob.title} · ${overview.liveJob.reference} · ${labels.visit(overview.liveJob.step)} · ${t("mobile.provider.since", { time: format.siteTime(overview.liveJob.since, overview.liveJob.siteZone) })}`}><Copy variant="sectionTitle">{overview.liveJob.title} · {overview.liveJob.reference}</Copy><Badge label={labels.visit(overview.liveJob.step)} tone="success" /><Copy>{t("mobile.provider.since", { time: format.siteTime(overview.liveJob.since, overview.liveJob.siteZone) })}</Copy><Copy>{overview.liveJob.accountableForeman ? t("mobile.provider.foreman", { name: overview.liveJob.accountableForeman }) : t("mobile.provider.noForeman")}</Copy><Copy>{t("mobile.provider.crewCount", { count: overview.liveJob.crewSize })}</Copy></Card> : <><Copy>{t("mobile.provider.nothingLive")}</Copy>{overview.nextVisit && <Copy>{t("mobile.provider.nextVisit", { job: overview.nextVisit.title, time: format.siteTime(overview.nextVisit.startsAt, overview.nextVisit.siteZone) })}</Copy>}</>}
      <Copy variant="sectionTitle">{t("mobile.provider.business")}</Copy>
      <Card onPress={onJobs} accessibilityLabel={t("mobile.provider.handoffs", { count: overview.handoffs.offeredCount })}><Copy>{t("mobile.provider.handoffs", { count: overview.handoffs.offeredCount })}</Copy>{overview.handoffs.nextReplyAt && <Copy>{t("mobile.provider.replyBy", { time: format.siteTime(overview.handoffs.nextReplyAt, overview.business.siteZone) })}</Copy>}<Copy>{t("mobile.provider.unassigned", { count: overview.unassignedCount })}</Copy><Copy>{t("mobile.provider.reviews", { count: overview.commercialReviewCount })}</Copy><Copy>{t("mobile.provider.bills", { count: overview.bills.openCount, amount: format.money(overview.bills.totalMinor, overview.bills.currency) })}</Copy></Card>
      <Card onPress={onEligibility} accessibilityLabel={t("mobile.provider.eligibility")}><Copy>{t("mobile.provider.eligibility")}</Copy><Badge label={labels.eligibility(overview.eligibility.status)} /><Copy>{t("mobile.provider.pendingReviews", { count: overview.eligibility.pendingReviewCount })}</Copy></Card>
      <Card onPress={onPeople} accessibilityLabel={t("mobile.provider.people")}><Copy>{t("mobile.provider.people")}</Copy></Card>
      {laterEntry}
    </>}
  </ProviderScreenView>;
}
