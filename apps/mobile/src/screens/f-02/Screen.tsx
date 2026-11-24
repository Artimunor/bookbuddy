import { getJobsRoute, type JobsPage } from "@bookbuddy/api-contract";
import { JOURNEY_STEPS } from "@bookbuddy/domain";
import { useRouter, type Href } from "expo-router";
import { useRef, useState, type ComponentRef } from "react";
import { ScrollView, View } from "react-native";
import { useRemote, type CachedRead } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, BookingCard, Button, Card, IdentityChip, Screen, SegmentedControl } from "../../ui/controls";
import { controlMetrics, Copy } from "../../ui/controls/shared";
import { JobLine, LiveCapsule } from "../../ui/live";
import { useBeaconTheme } from "../../ui/theme";
import { journeyLabels } from "../c-01/common";
import { siteTime, stageLabel, visitLabel } from "../f-01/Screen";

type Jobs = Extract<JobsPage, { audience: "foreman" }>;
type CachedJobs = Extract<CachedRead<"jobs_list">, { audience: "foreman" }>;
type Segment = "incoming" | "active" | "past";
type Status = "idle" | "loading" | "ready" | "error" | "offline";
type JobRow = Jobs["list"]["items"][number];
type Pagination = { cursor: string; previous: JobRow[] };
export default function ForemanJobs() {
  const { session } = useSession();
  return <JobsRoute key={`${session?.sessionId}:${session?.activeContext?.contextId}`} />;
}

function JobsRoute() {
  const [segment, setSegment] = useState<Segment>("active");
  const [pagination, setPagination] = useState<Partial<Record<Segment, Pagination>>>({});
  const current = pagination[segment];
  const remote = useRemote(getJobsRoute, { query: { segment } }, { cache: { kind: "jobs_list" } });
  const next = useRemote(getJobsRoute, { query: { segment, cursor: current?.cursor } }, { enabled: !!current });
  const router = useRouter(); const { bootstrap } = useSession();
  const data = remote.status === "ready" && remote.data?.audience === "foreman" ? remote.data : null;
  const cached = remote.status === "offline" && remote.data?.audience === "foreman" ? remote.data : null;
  const nextPage = next.status === "ready" && next.data?.audience === "foreman" && next.data.list.segment === segment ? next.data : null;
  const page = current ? nextPage : data;
  const cursor = page?.page.hasMore ? page.page.cursor : null;
  const pageStatus = current ? next.status : "idle";
  const items = current ? [...current.previous, ...(nextPage?.list.items ?? [])] : data?.list.items;
  return <JobsView
    data={data} items={items} cached={cached} lastConfirmedAt={remote.status === "offline" ? remote.lastConfirmedAt : null}
    segment={segment} onSegment={setSegment} status={remote.status} name={bootstrap?.account.displayName ?? ""}
    onRetry={() => { void remote.refresh(); }}
    pageStatus={pageStatus}
    onMore={cursor && items ? () => setPagination(state => ({ ...state, [segment]: { cursor, previous: items } })) : undefined}
    onRetryMore={() => { void next.refresh(); }}
    onNavigate={path => router.push(path as Href)}
  />;
}
export function JobsView({ data, items = data?.list.items ?? [], cached, lastConfirmedAt, segment, onSegment, status, name, onRetry, pageStatus, onMore, onRetryMore, onNavigate }: {
  data: Jobs | null; items?: JobRow[]; cached?: CachedJobs | null; lastConfirmedAt?: number | null; segment: Segment;
  onSegment: (value: Segment) => void; status: Status; name: string; onRetry: () => void;
  pageStatus?: Status; onMore?: () => void; onRetryMore?: () => void; onNavigate: (path: string) => void;
}) {
  const t = useT(); const format = useFormat();
  const { space, field } = useBeaconTheme();
  const gap = controlMetrics(field).controlGap;
  const scrollOffsets = useRef<Partial<Record<Segment, number>>>({});
  const list = useRef<ComponentRef<typeof ScrollView>>(null);
  const restored = useRef<Segment | null>(null);
  const labels = { incoming: t("mobile.foremanHome.incoming"), active: t("mobile.foremanHome.active"), past: t("mobile.foremanHome.past") };
  const counts = { incoming: data?.incomingCount, active: data?.activeCount, past: data?.pastCount };
  const options = (["incoming", "active", "past"] as const).map(value => ({ value, label: data && status === "ready" ? t("mobile.foremanHome.count", { label: labels[value], count: counts[value] ?? 0 }) : labels[value] }));
  const labelsForLine = journeyLabels(t);
  const flags = {
    crew_gap: { label: t("mobile.foremanHome.gap"), tone: "critical" },
    open_change: { label: t("mobile.foremanJobs.openChange"), tone: "attention" },
    open_problem: { label: t("mobile.jobHome.problemOpen"), tone: "critical" },
    unpaid_bill: { label: t("mobile.foremanJobs.unpaidBill"), tone: "attention" },
  } as const;
  const live = data?.live;
  const liveBand = live && (live.visit.arrival ?? live.visit.window);
  const liveTime = live && liveBand ? t("mobile.jobHome.range", {
    start: siteTime(format, liveBand.startsAt, live.siteZone), end: siteTime(format, liveBand.endsAt, live.siteZone),
  }) : undefined;
  const line = (journey: JobRow["journey"], current: 0 | 1 | 2 | 3 | 4 | 5, label: string, isLive = false) =>
    <JobLine kind="journey" steps={labelsForLine} current={current} accessibilityLabel={label} compact pulse={false}
      activity={journey.complete ? "finished" : isLive ? "live" : "quiet"}
      status={journey.cancelled ? { state: "cancelled", label: t("mobile.foremanHome.cancelled") } : undefined} />;
  const livePill = live && <View style={{ paddingHorizontal: space.contentInset, paddingBottom: space.grid[2] }}>
    <LiveCapsule size="pill" state="quiet" stateLabel={visitLabel(t, live.visit.status)} source={live.title ?? live.reference} time={liveTime} provenance=""
      accessibilityLabel={[live.reference, visitLabel(t, live.visit.status), liveTime].filter(Boolean).join(", ")} onPress={() => onNavigate(`/f/jobs/${live.jobId}`)} />
  </View>;
  return <Screen title={t("mobile.foremanHome.jobs")} scroll={false} dock={livePill}
    identity={<IdentityChip name={name || t("mobile.foremanHome.foreman")} initials={name.split(/\s+/).map(x => x[0]).join("").slice(0,2)} context={[t("mobile.foremanHome.foreman"), data?.businessName].filter(Boolean).join(" · ")} accessibilityLabel={t("mobile.foremanHome.profile")} onPress={() => onNavigate("/you")} />}
    bell={<Button variant="quiet" label={t("mobile.foremanHome.bell", { count: data?.unreadCount ?? 0 })} onPress={() => onNavigate("/notifications")} />}>
    <View style={{ paddingHorizontal: space.contentInset, paddingTop: space.contentInset, gap }}>
      {data && <Copy variant="supporting">{data.businessName} · {data.siteZone}</Copy>}
      <SegmentedControl label={t("mobile.foremanHome.stages")} options={options} value={segment}
        onChange={next => { if (next !== segment) { restored.current = null; onSegment(next); } }} />
    </View>
    <ScrollView key={segment} ref={list} contentContainerStyle={{ padding: space.contentInset, gap }} scrollEventThrottle={64}
      onContentSizeChange={() => {
        if ((!data && !cached) || restored.current === segment) return;
        restored.current = segment;
        const y = scrollOffsets.current[segment];
        if (y) list.current?.scrollTo({ y, animated: false });
      }}
      onScroll={event => {
        if (restored.current === segment) scrollOffsets.current[segment] = Math.max(0, event.nativeEvent.contentOffset.y);
      }}>
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.foremanHome.loading")}</Copy>}
    {status === "offline" && <><Copy>{t("mobile.foremanHome.offline")}</Copy>{cached && lastConfirmedAt != null && <Copy>{t("shared.status.lastConfirmed", { time: siteTime(format, lastConfirmedAt, cached.siteZone) })}</Copy>}</>}
    {status === "error" && <><Copy>{t("mobile.foremanHome.unavailable")}</Copy><Button label={t("mobile.foremanHome.retry")} onPress={onRetry} /></>}
    {cached && status === "offline" && cached.list.segment === segment && cached.list.items.map(job => {
      const stage = stageLabel(t, job.journey.step, job.journey.cancelled);
      const current = JOURNEY_STEPS.indexOf(job.journey.step) as 0 | 1 | 2 | 3 | 4 | 5;
      return <Card key={job.jobId}>
        <Copy variant="sectionTitle">{job.title ?? t("mobile.foremanHome.untitled")}</Copy><Copy>{job.reference}</Copy><Copy>{stage}</Copy>
        <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{line(job.journey, current, stage)}</View>
        {"nextVisit" in job && job.nextVisit && <Copy>{siteTime(format, job.nextVisit.window.startsAt, job.siteZone)}</Copy>}
        {"handoff" in job && job.handoff && <Copy>{t("mobile.foremanHome.replyBy", { time: siteTime(format, job.handoff.expiresAt, job.siteZone) })}</Copy>}
      </Card>;
    })}
    {data && status === "ready" && data.list.segment === segment && <>
      {!items.length && <Copy>{segment === "incoming" ? t("mobile.foremanHome.emptyIncoming") : segment === "active" ? t("mobile.foremanHome.emptyActive") : t("mobile.foremanHome.emptyPast")}</Copy>}
      {items.map(job => {
        const title = job.title ?? t("mobile.foremanHome.untitled");
        const incoming = "handoff" in job;
        const isLive = !incoming && segment === "active" && job.live;
        const liveStatus = isLive && live?.jobId === job.jobId ? visitLabel(t, live.visit.status) : null;
        const stage = [stageLabel(t, job.journey.step, job.journey.cancelled), liveStatus].filter(Boolean).join(" · ");
        const current = JOURNEY_STEPS.indexOf(job.journey.step) as 0 | 1 | 2 | 3 | 4 | 5;
        const step = job.journey.cancelled ? stage : t("mobile.customerHome.step", { step: current + 1, stage });
        const next = incoming ? t("mobile.foremanHome.replyBy", { time: siteTime(format, job.handoff.expiresAt, job.siteZone) })
          : segment === "past" ? (job.finalAt == null ? undefined : siteTime(format, job.finalAt, job.siteZone))
          : liveStatus && liveTime ? liveTime
          : job.nextStep?.kind === "assign_crew" ? t("mobile.jobControl.assign")
          : job.nextStep?.kind === "write_quote" ? t("mobile.foremanJobs.writeQuote")
          : job.nextVisit ? t("mobile.jobHome.nextVisit", { time: siteTime(format, job.nextVisit.window.startsAt, job.siteZone) }) : undefined;
        const place = incoming ? job.town : job.place.alias;
        const jobFlags = incoming || segment !== "active" ? [] : job.flags;
        return <BookingCard key={incoming ? job.handoff.handoffId : job.jobId} title={title}
          place={`${job.reference} · ${place} · ${job.customerName}`} stage={stage} next={next} tone={isLive ? "success" : undefined}
          progress={<>{line(job.journey, current, step, isLive)}
            {!!jobFlags.length && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
              {jobFlags.map(flag => <Badge key={flag} {...flags[flag]} />)}
            </View>}</>}
          accessibilityLabel={[title, place, job.customerName, step, next, ...jobFlags.map(flag => flags[flag].label)].filter(Boolean).join(", ")}
          onPress={() => onNavigate(incoming ? `/f/intake/${job.handoff.handoffId}` : `/f/jobs/${job.jobId}`)} />;
      })}
      {pageStatus === "loading" && <Copy>{t("mobile.foremanHome.loading")}</Copy>}
      {pageStatus === "error" && <><Copy>{t("mobile.foremanHome.unavailable")}</Copy>{onRetryMore && <Button label={t("mobile.foremanHome.retry")} onPress={onRetryMore} />}</>}
      {onMore && <Button variant="neutral" label={t("mobile.foremanJobs.more")} onPress={onMore} />}
    </>}
    </ScrollView>
  </Screen>;
}
