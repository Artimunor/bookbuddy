import { getJobsRoute, type JobsPage } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { useRemote, type CachedRead } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { BookingCard, Button, Card, IdentityChip, Screen, SegmentedControl } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { LiveCapsule } from "../../ui/live/LiveCapsule";
import { siteTime, stageLabel, visitLabel } from "../f-01/Screen";

type Jobs = Extract<JobsPage, { audience: "foreman" }>;
type CachedJobs = Extract<CachedRead<"jobs_list">, { audience: "foreman" }>;
type Segment = "incoming" | "active" | "past";
type Status = "idle" | "loading" | "ready" | "error" | "offline";
export default function ForemanJobs() {
  const [segment, setSegment] = useState<Segment>("active");
  const remote = useRemote(getJobsRoute, { query: { segment } }, { cache: { kind: "jobs_list" } });
  const router = useRouter(); const { bootstrap } = useSession();
  const data = remote.status === "ready" && remote.data?.audience === "foreman" ? remote.data : null;
  const cached = remote.status === "offline" && remote.data?.audience === "foreman" ? remote.data : null;
  return <JobsView data={data} cached={cached} lastConfirmedAt={remote.status === "offline" ? remote.lastConfirmedAt : null} segment={segment} onSegment={setSegment} status={remote.status} name={bootstrap?.account.displayName ?? ""} onRetry={() => { void remote.refresh(); }} onNavigate={path => router.push(path as Href)} />;
}
export function JobsView({ data, cached, lastConfirmedAt, segment, onSegment, status, name, onRetry, onNavigate }: { data: Jobs | null; cached?: CachedJobs | null; lastConfirmedAt?: number | null; segment: Segment; onSegment: (value: Segment) => void; status: Status; name: string; onRetry: () => void; onNavigate: (path: string) => void }) {
  const t = useT(); const format = useFormat();
  const labels = { incoming: t("mobile.foremanHome.incoming"), active: t("mobile.foremanHome.active"), past: t("mobile.foremanHome.past") };
  const counts = { incoming: data?.incomingCount, active: data?.activeCount, past: data?.pastCount };
  const options = (["incoming", "active", "past"] as const).map(value => ({ value, label: data && status === "ready" ? t("mobile.foremanHome.count", { label: labels[value], count: counts[value] ?? 0 }) : labels[value] }));
  return <Screen title={t("mobile.foremanHome.jobs")} identity={<IdentityChip name={name || t("mobile.foremanHome.foreman")} initials={name.split(/\s+/).map(x => x[0]).join("").slice(0,2)} context={[t("mobile.foremanHome.foreman"), data?.businessName].filter(Boolean).join(" · ")} accessibilityLabel={t("mobile.foremanHome.profile")} onPress={() => onNavigate("/profile")} />} bell={<Button variant="quiet" label={t("mobile.foremanHome.bell", { count: data?.unreadCount ?? 0 })} onPress={() => onNavigate("/notifications")} />}>
    {data && <Copy variant="supporting">{data.businessName} · {data.siteZone}</Copy>}
    <SegmentedControl label={t("mobile.foremanHome.stages")} options={options} value={segment} onChange={onSegment} />
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.foremanHome.loading")}</Copy>}
    {status === "offline" && <><Copy>{t("mobile.foremanHome.offline")}</Copy>{cached && lastConfirmedAt != null && <Copy>{t("shared.status.lastConfirmed", { time: siteTime(format, lastConfirmedAt, cached.siteZone) })}</Copy>}</>}
    {status === "error" && <><Copy>{t("mobile.foremanHome.unavailable")}</Copy><Button label={t("mobile.foremanHome.retry")} onPress={onRetry} /></>}
    {cached && status === "offline" && cached.list.segment === segment && <>{cached.list.items.map(job => <Card key={job.jobId}><Copy variant="sectionTitle">{job.title ?? t("mobile.foremanHome.untitled")}</Copy><Copy>{job.reference}</Copy><Copy>{stageLabel(t, job.journey.step, job.journey.cancelled)}</Copy>{"nextVisit" in job && job.nextVisit && <Copy>{siteTime(format, job.nextVisit.window.startsAt, job.siteZone)}</Copy>}{"handoff" in job && job.handoff && <Copy>{t("mobile.foremanHome.replyBy", { time: siteTime(format, job.handoff.expiresAt, job.siteZone) })}</Copy>}</Card>)}</>}
    {data && status === "ready" && data.list.segment === segment && <>
      {!data.list.items.length && <Copy>{segment === "incoming" ? t("mobile.foremanHome.emptyIncoming") : segment === "active" ? t("mobile.foremanHome.emptyActive") : t("mobile.foremanHome.emptyPast")}</Copy>}
      {data.list.segment === "incoming" ? data.list.items.map(job => { const title = job.title ?? t("mobile.foremanHome.untitled"); const stage = stageLabel(t, job.journey.step, job.journey.cancelled); const deadline = t("mobile.foremanHome.replyBy", { time: siteTime(format, job.handoff.expiresAt, job.siteZone) }); return <BookingCard key={job.jobId} title={title} place={`${job.reference} · ${job.town} · ${job.customerName}`} stage={stage} next={deadline} accessibilityLabel={[title, job.town, stage, deadline].join(", ")} onPress={() => onNavigate(`/f/intake/${job.handoff.handoffId}?jobId=${job.jobId}`)} />; }) : data.list.items.map(job => { const title = job.title ?? t("mobile.foremanHome.untitled"); const stage = stageLabel(t, job.journey.step, job.journey.cancelled); const next = job.nextVisit ? siteTime(format, job.nextVisit.window.startsAt, job.siteZone) : undefined; return <BookingCard key={job.jobId} title={title} place={`${job.reference} · ${job.place.alias} · ${job.customerName}`} stage={stage} next={next} accessibilityLabel={[title, job.place.alias, stage, next].filter(Boolean).join(", ")} onPress={() => onNavigate(`/f/jobs/${job.jobId}`)} />; })}
      {data.live && <LiveCapsule size="pill" state="quiet" stateLabel={visitLabel(t, data.live.visit.status)} source={data.live.title ?? data.live.reference} provenance="" accessibilityLabel={`${data.live.reference}, ${visitLabel(t, data.live.visit.status)}`} onPress={() => onNavigate(`/f/jobs/${data.live!.jobId}`)} />}
    </>}
  </Screen>;
}
