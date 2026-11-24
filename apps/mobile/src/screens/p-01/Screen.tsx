import { getBusinessOverviewRoute, type BusinessOverview } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { View } from "react-native";
import { useRemote } from "../../api";
import { useFormat as useClockFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Card, ListRow } from "../../ui/controls";
import { Copy, Target } from "../../ui/controls/shared";
import { LiveCapsule, type LiveCapsuleState } from "../../ui/live";
import { useBeaconTheme } from "../../ui/theme";
import { ProviderScreenView, ReadState, useProvider, useProviderFormat as useFormat, useProviderLabels } from "./shared";

const liveStates: Record<NonNullable<BusinessOverview["liveJob"]>["step"], LiveCapsuleState> = {
  confirmed: "crewConfirmed", on_the_way: "onTheWay", on_site: "onSite", working: "working", finished: "finished",
};
const liveSteps = ["confirmed", "on_the_way", "on_site", "working", "finished"] as const;

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
  const t = useT(); const format = useFormat(); const clock = useClockFormat(); const labels = useProviderLabels(); const { color, radius, space } = useBeaconTheme();
  const live = overview?.liveJob;
  const pulse = live ? clock.siteTime(live.since, live.siteZone) : null;
  const siteZone = pulse?.kind === "available" ? clock.zoneLabel(live?.siteZone, pulse.site) : undefined;
  const siteDate = pulse?.kind === "available" ? pulse.site.date : undefined;
  const since = pulse?.kind === "available" ? t("mobile.provider.since", { time: pulse.site.time }) : undefined;
  const stage = live ? labels.visit(live.step) : "";
  const steps: [string, string, string, string, string] = [labels.visit("confirmed"), labels.visit("on_the_way"), labels.visit("on_site"), labels.visit("working"), labels.visit("finished")];
  const step = live ? liveSteps.indexOf(live.step) as 0 | 1 | 2 | 3 | 4 : 0;
  const provenance = live ? [live.accountableForeman ? t("mobile.provider.foreman", { name: live.accountableForeman }) : t("mobile.provider.noForeman"),
    t("mobile.provider.crewCount", { count: live.crewSize }),
    live.sharedBy && pulse?.kind === "available" ? t("mobile.customerHome.shared", { name: live.sharedBy, time: pulse.site.time }) : null].filter(Boolean).join(" · ") : "";
  return <ProviderScreenView title={t("mobile.provider.now")} subtitle={[siteDate, siteZone].filter(Boolean).join(" · ") || undefined} business={overview?.business.publicName} actor={actor} onProfile={onProfile} onNotifications={onNotifications}>
    <ReadState status={status} retry={onRetry} />
    {overview && status === "ready" && <>
      {(overview.handoffs.stuck.length > 0 || overview.bills.openCount > 0) && <Copy variant="sectionTitle">{t("mobile.provider.needsYou")}</Copy>}
      {overview.handoffs.stuck.map((job) => <Target key={job.jobId} accessibilityRole="button" onPress={() => onJob(job.jobId)} accessibilityLabel={[t("mobile.provider.handoffStuck"), job.title, job.reference, t("mobile.provider.since", { time: format.siteTime(job.since, job.siteZone) }), t("mobile.provider.offeredTo", { name: job.offeredTo }), job.accountableForeman ? t("mobile.provider.foreman", { name: job.accountableForeman }) : t("mobile.provider.noForeman")].join(" · ")} style={{ backgroundColor: color.criticalSoft, borderRadius: radius.card, padding: space.cardPadding, gap: space.grid[2] }}>
        <Badge tone="critical" label={t("mobile.provider.handoffStuck")} /><Copy variant="sectionTitle">{job.title} · {job.reference}</Copy>
        <Copy>{t("mobile.provider.since", { time: format.siteTime(job.since, job.siteZone) })}</Copy><Copy>{t("mobile.provider.offeredTo", { name: job.offeredTo })}</Copy><Copy>{job.accountableForeman ? t("mobile.provider.foreman", { name: job.accountableForeman }) : t("mobile.provider.noForeman")}</Copy>
      </Target>)}
      {overview.bills.openCount > 0 && <Target accessibilityRole="button" onPress={onJobs} accessibilityLabel={`${t("mobile.provider.recordPaid")} · ${t("mobile.provider.bills", { count: overview.bills.openCount, amount: format.money(overview.bills.totalMinor, overview.bills.currency) })}`} style={{ backgroundColor: color.attentionSoft, borderRadius: radius.card, padding: space.cardPadding, gap: space.grid[2] }}><Badge tone="attention" label={t("mobile.provider.recordPaid")} /><Copy>{t("mobile.provider.bills", { count: overview.bills.openCount, amount: format.money(overview.bills.totalMinor, overview.bills.currency) })}</Copy></Target>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: space.grid[2] }}>
        <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.provider.liveNow")}</Copy>
        {live && <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.customerHome.liveCount", { count: 1 })}</Copy>}
      </View>
      {live ? <LiveCapsule size="card" state={liveStates[live.step]} stateLabel={stage} source={live.title} reference={live.reference} time={since}
        zoneLine={siteZone} provenance={provenance}
        line={{ kind: "visit", steps, current: step, accessibilityLabel: t("mobile.liveVisit.step", { step: step + 1, stage }) }}
        accessibilityLabel={[live.title, live.reference, stage, since, siteZone, provenance].filter(Boolean).join(" · ")} onPress={() => onJob(live.jobId)} />
        : <Card><Copy variant="label">{t("mobile.provider.nothingLive")}</Copy>{overview.nextVisit && <Copy variant="supporting">{t("mobile.provider.nextVisit", { job: overview.nextVisit.title, time: clock.lines(overview.nextVisit.startsAt, overview.nextVisit.siteZone)?.site ?? "" })}</Copy>}</Card>}
      <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.provider.business")}</Copy>
      <Card>
        <ListRow glyph="↔" label={t("mobile.provider.handoffsTitle")} description={[
          t("mobile.provider.handoffs", { count: overview.handoffs.offeredCount }),
          overview.handoffs.nextReplyAt ? t("mobile.provider.replyBy", { time: clock.lines(overview.handoffs.nextReplyAt, overview.business.siteZone)?.site ?? "" }) : null,
          t("mobile.provider.unassigned", { count: overview.unassignedCount }),
          t("mobile.provider.reviews", { count: overview.commercialReviewCount }),
        ].filter(Boolean).join(" · ")} onPress={onJobs} />
        <ListRow glyph="≋" label={t("mobile.provider.billsTitle")} description={t("mobile.provider.bills", { count: overview.bills.openCount, amount: format.money(overview.bills.totalMinor, overview.bills.currency) })} onPress={onJobs} />
        <ListRow glyph="✓" label={t("mobile.provider.eligibility")} description={`${labels.eligibility(overview.eligibility.status)} · ${t("mobile.provider.pendingReviews", { count: overview.eligibility.pendingReviewCount })}`} onPress={onEligibility} />
        <ListRow glyph="●" label={t("mobile.provider.people")} onPress={onPeople} />
      </Card>
      {laterEntry}
    </>}
  </ProviderScreenView>;
}
