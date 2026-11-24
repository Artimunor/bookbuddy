import { getHomeRoute, type HomeProjection } from "@bookbuddy/api-contract";
import type { SiteDateTime } from "@bookbuddy/domain";
import type { Translator } from "@bookbuddy/i18n";
import { useRouter, type Href } from "expo-router";
import { useRemote, type CachedRead } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { BookingCard, Button, Card, Dock, IdentityChip, NeedsYouCard, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { LiveCapsule, type LiveCapsuleState } from "../../ui/live/LiveCapsule";

type Home = Extract<HomeProjection, { audience: "foreman" }>;
type CachedHome = Extract<CachedRead<"home">, { audience: "foreman" }>;
type Status = "idle" | "loading" | "ready" | "error" | "offline";
type T = Translator<"mobile">["t"];
export function siteTime(format: { siteTime: (at: number, zone: string) => SiteDateTime }, at: number, zone: string) { const value = format.siteTime(at, zone); return value.kind === "available" ? value.siteTime : zone; }
export function stageLabel(t: T, step: Home["laterVisits"][number]["journey"]["step"], cancelled = false) {
  if (cancelled) return t("mobile.foremanHome.cancelled");
  const stages = { requested: t("mobile.foremanHome.requested"), quoted: t("mobile.foremanHome.quoted"), booked: t("mobile.foremanHome.booked"), visit: t("mobile.foremanHome.visit"), signed_off: t("mobile.foremanHome.signedOff"), paid: t("mobile.foremanHome.paid") };
  return stages[step];
}
export function visitLabel(t: T, status: Home["liveVisits"][number]["visit"]["status"]) {
  const labels = { confirmed: t("mobile.foremanHome.confirmed"), on_the_way: t("mobile.foremanHome.onWay"), on_site: t("mobile.foremanHome.onSite"), working: t("mobile.foremanHome.working"), finished: t("mobile.foremanHome.finished"), cover_arranging: t("mobile.foremanHome.gap"), paused: t("mobile.foremanHome.paused") };
  return labels[status];
}
const capsuleState: Record<Home["liveVisits"][number]["visit"]["status"], LiveCapsuleState> = { confirmed: "crewConfirmed", on_the_way: "onTheWay", on_site: "onSite", working: "working", finished: "finished", cover_arranging: "coverBeingArranged", paused: "paused" };
export default function ForemanHome() {
  const remote = useRemote(getHomeRoute, { query: {} }, { cache: { kind: "home" } });
  const router = useRouter(); const { bootstrap } = useSession();
  const data = remote.status === "ready" && remote.data?.audience === "foreman" ? remote.data : null;
  const cached = remote.status === "offline" && remote.data?.audience === "foreman" ? remote.data : null;
  return <HomeView data={data} cached={cached} lastConfirmedAt={remote.status === "offline" ? remote.lastConfirmedAt : null} status={remote.status} name={bootstrap?.account.displayName ?? ""} onRetry={() => { void remote.refresh(); }} onNavigate={(path) => router.push(path as Href)} />;
}
export function HomeView({ data, cached, lastConfirmedAt, status, name, onRetry, onNavigate }: { data: Home | null; cached?: CachedHome | null; lastConfirmedAt?: number | null; status: Status; name: string; onRetry: () => void; onNavigate: (path: string) => void }) {
  const t = useT(); const format = useFormat();
  const actionPath = (item: Home["needsYou"][number]) => {
    const id = item.action.recordId;
    if (item.action.kind === "accept_job" && id) return `/f/intake/${id}?jobId=${item.jobId}`;
    if (item.action.kind === "find_cover" && id) return `/f/cover/${id}`;
    if (item.action.kind === "confirm_cover" && id) return `/f/cover/${id}/confirm`;
    if (item.action.kind === "review_briefing" && id) return `/w/shifts/${id}/briefing`;
    return `/f/jobs/${item.jobId}`;
  };
  const crewLabel = (person: Home["liveVisits"][number]["crew"][number], zone: string) => {
    const state = { confirmed: t("mobile.foremanHome.confirmed"), on_the_way: t("mobile.foremanHome.onWay"), on_site: t("mobile.foremanHome.onSite"), working: t("mobile.foremanHome.working"), departed: t("mobile.foremanHome.departed"), dropped: t("mobile.foremanHome.dropped") }[person.state];
    const briefing = { due: t("mobile.foremanHome.briefingDue"), acknowledged: t("mobile.foremanHome.briefingDone"), hold: t("mobile.foremanHome.briefingHold") }[person.briefing];
    return `${state} · ${siteTime(format, person.at, zone)} · ${briefing}`;
  };
  const firstGap = data?.gaps[0]; const firstLive = data?.liveVisits[0];
  const dock = status === "ready" && firstGap ? <Dock primary={{ label: t("mobile.foremanHome.cover"), onPress: () => onNavigate(`/f/cover/${firstGap.gapId}`) }} /> : status === "ready" && firstLive ? <Dock primary={{ label: t("mobile.foremanHome.share"), live: true, onPress: () => onNavigate(`/f/jobs/${firstLive.jobId}/share`) }} /> : undefined;
  return <Screen title={t("mobile.foremanHome.now")} dock={dock} identity={<IdentityChip name={name || t("mobile.foremanHome.foreman")} initials={name.split(/\s+/).map(x => x[0]).join("").slice(0,2)} context={[t("mobile.foremanHome.foreman"), data?.businessName].filter(Boolean).join(" · ")} accessibilityLabel={t("mobile.foremanHome.profile")} onPress={() => onNavigate("/profile")} />} bell={<Button variant="quiet" label={t("mobile.foremanHome.bell", { count: data?.unreadCount ?? 0 })} onPress={() => onNavigate("/notifications")} />}>
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.foremanHome.loading")}</Copy>}
    {status === "offline" && <><Copy>{t("mobile.foremanHome.offline")}</Copy>{cached && lastConfirmedAt != null && <Copy>{t("shared.status.lastConfirmed", { time: siteTime(format, lastConfirmedAt, cached.siteZone) })}</Copy>}</>}
    {status === "error" && <><Copy>{t("mobile.foremanHome.unavailable")}</Copy><Button label={t("mobile.foremanHome.retry")} onPress={onRetry} /></>}
    {cached && status === "offline" && <>
      <Copy variant="supporting">{cached.siteZone}</Copy>
      {cached.gaps.map(gap => <Card key={gap.gapId}><Copy variant="label">{t("mobile.foremanHome.gap")}</Copy><Copy variant="sectionTitle">{gap.title ?? gap.reference}</Copy><Copy>{gap.reference} · {gap.skill}</Copy><Copy>{siteTime(format, gap.reportedAt, gap.siteZone)}</Copy></Card>)}
      {cached.liveVisits.map(job => { const band = job.visit.arrival ?? job.visit.window; const label = visitLabel(t, job.visit.status); const time = `${siteTime(format, band.startsAt, job.siteZone)} – ${siteTime(format, band.endsAt, job.siteZone)}`; return <LiveCapsule key={job.jobId} state="quiet" stateLabel={label} source={job.title ?? job.reference} reference={job.reference} time={time} provenance={lastConfirmedAt == null ? t("mobile.foremanHome.offline") : t("shared.status.lastConfirmed", { time: siteTime(format, lastConfirmedAt, job.siteZone) })} accessibilityLabel={[job.title ?? job.reference, label, time].join(", ")} />; })}
      {cached.laterVisits.map(job => <Card key={job.jobId}><Copy variant="sectionTitle">{job.title ?? t("mobile.foremanHome.untitled")}</Copy><Copy>{job.reference}</Copy><Copy>{stageLabel(t, job.journey.step, job.journey.cancelled)}</Copy>{job.nextVisit && <Copy>{siteTime(format, job.nextVisit.window.startsAt, job.siteZone)}</Copy>}</Card>)}
    </>}
    {data && status === "ready" && <>
      <Copy variant="supporting">{data.siteZone}</Copy>
      {data.gaps.map(gap => <NeedsYouCard key={gap.gapId} label={t("mobile.foremanHome.gap")} title={gap.title ?? gap.reference} description={`${t("mobile.foremanHome.gapDetail", { name: gap.worker.displayName, time: siteTime(format, gap.reportedAt, gap.siteZone), skill: gap.skill })} ${gap.customerNotified ? t("mobile.foremanHome.notified") : t("mobile.foremanHome.notNotified")}`} action={{ label: t("mobile.foremanHome.cover"), onPress: () => onNavigate(`/f/cover/${gap.gapId}`) }} />)}
      {data.liveVisits.map(job => { const gap = data.gaps.some(item => item.jobId === job.jobId); const label = gap ? t("mobile.foremanHome.gap") : visitLabel(t, job.visit.status); const band = job.visit.arrival ?? job.visit.window; const time = `${siteTime(format, band.startsAt, job.siteZone)} – ${siteTime(format, band.endsAt, job.siteZone)}`; const provenance = job.customerStatus ? t("mobile.foremanHome.customerSees", { status: visitLabel(t, job.customerStatus.status) }) : t("mobile.foremanHome.customerUnknown"); return <LiveCapsule key={job.jobId} state={gap ? "coverBeingArranged" : capsuleState[job.visit.status]} stateLabel={label} source={job.title ?? job.reference} reference={job.reference} time={time} zoneLine={job.place.alias} provenance={provenance} accessibilityLabel={[job.title, job.reference, label, time, job.place.alias, provenance, ...job.crew.map(p => `${p.displayName}, ${crewLabel(p, job.siteZone)}`)].filter(Boolean).join(", ")} onPress={() => onNavigate(`/f/jobs/${job.jobId}`)} crew={{ audience: "foreman", people: job.crew.map(p => ({ id: p.membershipId, name: p.displayName, initials: p.displayName.split(/\s+/).map(x => x[0]).join("").slice(0,2), status: p.state === "dropped" ? "gap" : p.briefing === "hold" ? "hold" : p.state === "on_the_way" ? "onTheWay" : p.state === "on_site" || p.state === "working" ? "onSite" : "confirmed", statusLabel: crewLabel(p, job.siteZone) })) }} />; })}
      {!data.liveVisits.length && !data.laterVisits.length && <Copy>{t("mobile.foremanHome.quiet")}</Copy>}
      {!!data.needsYou.length && <><Copy variant="sectionTitle">{t("mobile.foremanHome.needsYou", { count: data.needsYouCount })}</Copy>{data.needsYou.map((item, i) => <NeedsYouCard key={`${item.jobId}-${i}`} label={item.reference} title={item.title ?? t("mobile.foremanHome.untitled")} description={item.action.at ? siteTime(format, item.action.at, item.siteZone) : undefined} action={{ label: t("mobile.foremanHome.open"), onPress: () => onNavigate(actionPath(item)) }} />)}</>}
      {data.laterVisits.map(job => <BookingCard key={job.jobId} title={job.title ?? t("mobile.foremanHome.untitled")} place={`${job.reference} · ${job.place.alias} · ${job.customerName}`} stage={stageLabel(t, job.journey.step, job.journey.cancelled)} next={job.nextVisit ? siteTime(format, job.nextVisit.window.startsAt, job.siteZone) : undefined} accessibilityLabel={[job.title ?? job.reference, job.place.alias, stageLabel(t, job.journey.step, job.journey.cancelled)].join(", ")} onPress={() => onNavigate(`/f/jobs/${job.jobId}`)} />)}
    </>}
  </Screen>;
}
