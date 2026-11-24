import { getHomeRoute, type HomeProjection } from "@bookbuddy/api-contract";
import type { SiteDateTime } from "@bookbuddy/domain";
import type { Translator } from "@bookbuddy/i18n";
import { useRouter, type Href } from "expo-router";
import { useRemote, type CachedRead } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { BookingCard, Button, Card, Dock, EmptyState, IdentityChip, ListRow, NeedsYouCard, Screen, StatusBanner } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { LiveCapsule, type LiveCapsuleState } from "../../ui/live/LiveCapsule";
import { siteWindow } from "../c-01/clock";

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
  const router = useRouter(); const { session, bootstrap } = useSession();
  const scope = bootstrap?.capabilities?.sessions;
  const context = session?.activeContext;
  const sessionsAvailable = context?.role === "foreman" && !!scope && "businessId" in scope && scope.businessId === context.businessId;
  const data = remote.status === "ready" && remote.data?.audience === "foreman" ? remote.data : null;
  const cached = remote.status === "offline" && remote.data?.audience === "foreman" ? remote.data : null;
  return <HomeView data={data} cached={cached} lastConfirmedAt={remote.status === "offline" ? remote.lastConfirmedAt : null} status={remote.status} name={bootstrap?.account.displayName ?? ""} sessionsAvailable={sessionsAvailable} onRetry={() => { void remote.refresh(); }} onNavigate={(path) => router.push(path as Href)} />;
}
export function HomeView({ data, cached, lastConfirmedAt, status, name, sessionsAvailable, onRetry, onNavigate }: { data: Home | null; cached?: CachedHome | null; lastConfirmedAt?: number | null; status: Status; name: string; sessionsAvailable?: boolean; onRetry: () => void; onNavigate: (path: string) => void }) {
  const t = useT(); const format = useFormat();
  const actionPath = (item: Home["needsYou"][number]) => {
    const id = item.action.recordId;
    if (item.action.kind === "accept_job" && id) return `/f/intake/${id}`;
    if (item.action.kind === "find_cover" && id) return `/f/cover/${id}`;
    if (item.action.kind === "confirm_cover" && id) return `/f/cover/${id}/confirm`;
    if (item.action.kind === "review_briefing" && id) return `/w/shifts/${id}/briefing`;
    return `/f/jobs/${item.jobId}`;
  };
  const crewLabel = (person: Home["liveVisits"][number]["crew"][number], zone: string) => {
    const state = { confirmed: t("mobile.foremanHome.confirmed"), on_the_way: t("mobile.foremanHome.onWay"), on_site: t("mobile.foremanHome.onSite"), working: t("mobile.foremanHome.working"), departed: t("mobile.foremanHome.departed"), dropped: t("mobile.foremanHome.dropped") }[person.state];
    const briefing = { due: t("mobile.foremanHome.briefingDue"), acknowledged: t("mobile.foremanHome.briefingDone"), hold: t("mobile.foremanHome.briefingHold") }[person.briefing];
    const clock = format.siteTime(person.at, zone);
    return [state, clock.kind === "available" ? clock.site.time : null, briefing].filter(Boolean).join(" · ");
  };
  const firstGap = data?.gaps[0]; const firstLive = data?.liveVisits[0];
  const date = firstLive ? format.siteTime(firstLive.visit.window.startsAt, firstLive.siteZone) : null;
  const subtitle = date?.kind === "available" ? [date.site.date, format.zoneLabel(firstLive?.siteZone, date.site)].filter(Boolean).join(" · ") : undefined;
  const days: [string, string, string, string, string] = [t("mobile.foremanHome.confirmed"), t("mobile.foremanHome.onWay"), t("mobile.foremanHome.onSite"), t("mobile.foremanHome.working"), t("mobile.foremanHome.finished")];
  const dock = status === "ready" && firstGap ? <Dock primary={{ label: t("mobile.foremanHome.cover"), onPress: () => onNavigate(`/f/cover/${firstGap.gapId}`) }} /> : status === "ready" && firstLive ? <Dock primary={{ label: t("mobile.foremanHome.share"), live: true, glyph: "◉", onPress: () => onNavigate(`/f/jobs/${firstLive.jobId}/share`) }} /> : undefined;
  return <Screen title={t("mobile.foremanHome.now")} subtitle={subtitle} dock={dock}
    identity={<IdentityChip name={name || t("mobile.foremanHome.foreman")} initials={name.split(/\s+/).map(x => x[0]).join("").slice(0, 2)} person="personB" context={[t("mobile.foremanHome.foreman"), (data ?? cached)?.businessName].filter(Boolean).join(" · ")} accessibilityLabel={t("mobile.foremanHome.profile")} onPress={() => onNavigate("/profile")} />}
    bell={<Button variant="neutral" iconOnly glyph="🔔︎" label={t("mobile.foremanHome.bell", { count: data?.unreadCount ?? 0 })} onPress={() => onNavigate("/notifications")} />}>
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.foremanHome.loading")}</Copy>}
    {status === "offline" && <StatusBanner state="offline" label={t("mobile.foremanHome.offline")} detail={cached && lastConfirmedAt != null ? t("shared.status.lastConfirmed", { time: format.lines(lastConfirmedAt, cached.siteZone)?.site ?? "" }) : undefined} />}
    {status === "error" && <><Copy>{t("mobile.foremanHome.unavailable")}</Copy><Button label={t("mobile.foremanHome.retry")} onPress={onRetry} /></>}
    {cached && status === "offline" && <>
      {cached.gaps.map(gap => <Card key={gap.gapId}><Copy variant="label">{t("mobile.foremanHome.gap")}</Copy><Copy variant="sectionTitle">{gap.title ?? gap.reference}</Copy><Copy>{gap.reference} · {gap.skill}</Copy><Copy>{siteTime(format, gap.reportedAt, gap.siteZone)}</Copy></Card>)}
      {cached.liveVisits.map(job => {
        const band = job.visit.arrival ?? job.visit.window;
        const clock = siteWindow(format, band.startsAt, band.endsAt, job.siteZone);
        const label = visitLabel(t, job.visit.status);
        return <LiveCapsule key={job.jobId} state="quiet" stateLabel={label} source={job.title ?? job.reference} reference={job.reference} time={clock?.time} zoneLine={clock?.zone}
          provenance={lastConfirmedAt == null ? t("mobile.foremanHome.offline") : t("shared.status.lastConfirmed", { time: format.lines(lastConfirmedAt, job.siteZone)?.site ?? "" })} accessibilityLabel={[job.title ?? job.reference, label, clock?.time, clock?.zone].filter(Boolean).join(", ")} />;
      })}
      {cached.laterVisits.map(job => <Card key={job.jobId}><Copy variant="sectionTitle">{job.title ?? t("mobile.foremanHome.untitled")}</Copy><Copy>{job.reference}</Copy><Copy>{stageLabel(t, job.journey.step, job.journey.cancelled)}</Copy>{job.nextVisit && <Copy>{siteTime(format, job.nextVisit.window.startsAt, job.siteZone)}</Copy>}</Card>)}
    </>}
    {data && status === "ready" && <>
      {data.gaps.map(gap => <NeedsYouCard key={gap.gapId} label={t("mobile.foremanHome.gap")} title={gap.title ?? gap.reference} description={`${t("mobile.foremanHome.gapDetail", { name: gap.worker.displayName, time: siteTime(format, gap.reportedAt, gap.siteZone), skill: gap.skill })} ${gap.customerNotified ? t("mobile.foremanHome.notified") : t("mobile.foremanHome.notNotified")}`} action={{ label: t("mobile.foremanHome.cover"), onPress: () => onNavigate(`/f/cover/${gap.gapId}`) }} />)}
      {data.liveVisits.map(job => {
        const gap = data.gaps.some(item => item.jobId === job.jobId);
        const label = gap ? t("mobile.foremanHome.gap") : visitLabel(t, job.visit.status);
        const band = job.visit.arrival ?? job.visit.window;
        const clock = siteWindow(format, band.startsAt, band.endsAt, job.siteZone);
        const day = job.visit.step;
        const step = day === "on_the_way" ? 1 : day === "on_site" ? 2 : day === "working" ? 3 : day === "finished" ? 4 : 0;
        const attribution = format.siteTime(job.visit.source.at, job.siteZone);
        const provenance = job.customerStatus ? t("mobile.foremanHome.customerSees", { status: visitLabel(t, job.customerStatus.status) }) : t("mobile.foremanHome.customerUnknown");
        const crew = job.crew.map(p => ({ id: p.membershipId, name: p.displayName, initials: p.displayName.split(/\s+/).map(x => x[0]).join("").slice(0, 2),
          status: (p.state === "dropped" ? "gap" : p.briefing === "hold" ? "hold" : p.state === "on_the_way" ? "onTheWay" : p.state === "on_site" || p.state === "working" ? "onSite" : "confirmed") as "gap" | "hold" | "onTheWay" | "onSite" | "confirmed", statusLabel: crewLabel(p, job.siteZone) }));
        const source = attribution.kind === "available" && job.visit.source.by ? t("mobile.customerHome.shared", { name: job.visit.source.by, time: attribution.site.time }) : null;
        return <LiveCapsule key={job.jobId} state={gap ? "coverBeingArranged" : capsuleState[job.visit.status]} stateLabel={label} source={job.title ?? job.reference}
          reference={job.reference} time={clock?.time} zoneLine={[job.place.alias, clock?.zone].filter(Boolean).join(" · ")} provenance={[provenance, source].filter(Boolean).join(" · ")}
          accessibilityLabel={[job.title, job.reference, label, clock?.time, clock?.zone, job.place.alias, provenance, source, ...crew.map(p => `${p.name}, ${p.statusLabel}`)].filter(Boolean).join(", ")}
          line={{ kind: "visit", steps: days, current: step, accessibilityLabel: t("mobile.liveVisit.step", { step: step + 1, stage: days[step] }) }}
          onPress={() => onNavigate(`/f/jobs/${job.jobId}`)} crew={{ audience: "foreman", people: crew }} />;
      })}
      {!data.liveVisits.length && !data.laterVisits.length && <EmptyState title={t("mobile.foremanHome.quiet")} description={t("mobile.foremanHome.quietBody")} />}
      {!!data.needsYou.length && <>
        <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.foremanHome.needsYou", { count: data.needsYouCount })}</Copy>
        <Card>{data.needsYou.map((item, i) => {
          const label = item.action.kind === "review_briefing" ? t("mobile.liveShift.briefing")
            : item.action.kind === "accept_job" ? t("mobile.foremanHome.newJob")
            : item.action.kind === "write_quote" ? t("mobile.foremanQuote.title")
            : item.action.kind === "assign_crew" ? t("mobile.jobControl.assign")
            : item.action.kind === "find_cover" ? t("mobile.foremanHome.cover")
            : item.action.kind === "confirm_cover" ? t("mobile.cover.confirmTitle")
            : item.action.kind === "share_update" ? t("mobile.foremanHome.share") : t("mobile.foremanHome.open");
          return <ListRow key={`${item.jobId}-${i}`} glyph={item.action.kind === "review_briefing" ? "✋︎" : "≋"} label={label}
            description={[item.title ?? item.reference, item.title ? item.reference : null, item.action.at ? format.lines(item.action.at, item.siteZone)?.site : null].filter(Boolean).join(" · ")} onPress={() => onNavigate(actionPath(item))} />;
        })}</Card>
      </>}
      {sessionsAvailable && <Card accessibilityLabel={t("mobile.sessionSetup.sessions")} onPress={() => onNavigate("/f/sessions")}><Copy>{t("mobile.sessionSetup.sessions")}</Copy></Card>}
      {data.laterVisits.map(job => <BookingCard key={job.jobId} title={job.title ?? t("mobile.foremanHome.untitled")} place={`${job.reference} · ${job.place.alias} · ${job.customerName}`} stage={stageLabel(t, job.journey.step, job.journey.cancelled)} next={job.nextVisit ? siteTime(format, job.nextVisit.window.startsAt, job.siteZone) : undefined} accessibilityLabel={[job.title ?? job.reference, job.place.alias, stageLabel(t, job.journey.step, job.journey.cancelled)].join(", ")} onPress={() => onNavigate(`/f/jobs/${job.jobId}`)} />)}
    </>}
  </Screen>;
}
