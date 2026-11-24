import { getHomeRoute, type HomeProjection } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useRouter, type Href } from "expo-router";
import { View } from "react-native";
import { useRemote } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useDraft, usePendingDrafts, useRepository } from "../../repository/hooks";
import type { CachedRead } from "../../repository/remote-cache";
import { useSession } from "../../session";
import { Button, Card, EmptyState, Screen } from "../../ui/controls";
import { ListRow } from "../../ui/controls/rows";
import { Copy } from "../../ui/controls/shared";
import { Bell, Booking, CachedBooking, CachedVisit, DecisionLabel, HeaderIdentity, Journey, Live, OfflineNotice, Section, decisionAction, type Decision } from "./common";
import { browseHref } from "../l-01/common";
import { requestDraftHref, savedRequestHref, type RequestDraft } from "../c-02/draft";

type Home = Extract<HomeProjection, { audience: "customer" }>;
type Status = "idle" | "loading" | "ready" | "error" | "offline";

export default function CustomerNowScreen() {
  const router = useRouter();
  const remote = useRemote(getHomeRoute, { query: {} }, { cache: { kind: "home" } });
  const { bootstrap, preferences } = useSession();
  const repo = useRepository();
  const drafts = usePendingDrafts("request");
  const count = drafts.length;
  const latest = drafts[0];
  const { draft } = useDraft<RequestDraft>(latest ? `request:${latest.draftId}` : null);
  const resume = () => {
    if (count > 1) router.push("/c/(tabs)/bookings" as Href);
    else if (latest && draft) router.push(requestDraftHref(draft.value.step, latest.draftId));
    else if (latest) void savedRequestHref(repo, latest.draftId).then((href) => { if (href) router.push(href); }).catch(() => {});
  };
  const ask = (mode?: "voice" | "photo") => router.push(requestDraftHref("describe", uuid.v4(), mode ? { mode } : undefined));
  const description = latest?.summary;
  const sessions = bootstrap?.capabilities?.sessions;
  if (remote.status === "offline") return <CachedNowView home={remote.data?.audience === "customer" ? remote.data : null} confirmed={remote.lastConfirmedAt} name={bootstrap?.account.displayName ?? null} draftCount={count} draftDescription={description} onResume={resume} onAsk={ask} onIdentity={() => router.push("/you" as Href)} onBell={() => router.push("/notifications" as Href)} />;
  return <NowView home={remote.data?.audience === "customer" ? remote.data : null} status={remote.status} confirmed={null} name={bootstrap?.account.displayName ?? null} twoClock={preferences?.twoClock ?? false} draftCount={count} draftDescription={description}
    onAsk={ask}
    onResume={resume}
    onSessions={sessions && "areaIds" in sessions ? () => router.push(browseHref) : undefined}
    onIdentity={() => router.push("/you" as Href)} onBell={() => router.push("/notifications" as Href)} onRetry={() => { void remote.refresh(); }}
    onJob={(id) => router.push(`/c/jobs/${id}` as Href)} onDecision={(decision) => {
      const root = `/c/jobs/${decision.jobId}`;
      const suffix = decision.kind === "review_quote" ? `/quote/${decision.recordId}` : decision.kind === "pick_window" || decision.kind === "review_revised_visit" ? "/windows" : decision.kind === "review_change" ? `/change/${decision.recordId}` : decision.kind === "see_bill" ? "/bill" : "/completion";
      router.push(`${root}${suffix}` as Href);
    }} />;
}

export function NowView({ home, status, confirmed, name, twoClock = false, draftCount = 0, draftDescription, onAsk, onResume, onIdentity, onBell, onRetry, onJob, onDecision, onSessions }: {
  home: Home | null; status: Status; confirmed: number | null; name: string | null; twoClock?: boolean; draftCount?: number; draftDescription?: string;
  onAsk: (mode?: "voice" | "photo") => void; onResume: () => void; onIdentity: () => void; onBell: () => void; onRetry: () => void;
  onJob: (id: string) => void; onDecision: (decision: Decision) => void;
  onSessions?: () => void;
}) {
  const t = useT(); const offline = status === "offline";
  const live = home?.liveVisits ?? [], decisions = home?.decisions ?? [], upcoming = home?.upcoming ?? [];
  const summary = live.length ? t("mobile.customerHome.liveCount", { count: live.length }) : decisions.length ? t("mobile.customerHome.decisionCount", { count: decisions.length }) : draftCount ? (draftCount === 1 ? t("mobile.customerHome.draft") : t("mobile.customerHome.drafts", { count: draftCount })) : t("mobile.customerHome.nothingNeeds");
  return <Screen title={t("mobile.customerHome.now")} identity={<HeaderIdentity name={name} place={home?.place?.alias ?? null} onPress={onIdentity} />} bell={<Bell count={home?.unreadCount ?? 0} onPress={onBell} />}>
    <Copy variant="supporting">{summary}</Copy>
    {offline && <OfflineNotice confirmed={confirmed} zone={home?.place?.siteZone ?? null} />}
    {draftCount > 0 ? <><Card onPress={onResume} accessibilityLabel={draftCount === 1 ? t("mobile.customerHome.draft") : t("mobile.customerHome.drafts", { count: draftCount })}><Copy variant="sectionTitle">{draftCount === 1 ? t("mobile.customerHome.draft") : t("mobile.customerHome.drafts", { count: draftCount })}</Copy>{!!draftDescription && <Copy>{draftDescription}</Copy>}</Card><Copy variant="supporting">{t("mobile.customerHome.draftNotice")}</Copy><Button variant="quiet" label={t("mobile.customerHome.newRequest")} onPress={() => onAsk()} /></> : <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}><View style={{ flexGrow: 1 }}><Button variant="neutral" label={t("mobile.customerHome.ask")} onPress={() => onAsk()} /></View><Button iconOnly glyph="◉" variant="neutral" label={t("mobile.customerHome.voice")} onPress={() => onAsk("voice")} /><Button iconOnly glyph="▣" variant="neutral" label={t("mobile.customerHome.photo")} onPress={() => onAsk("photo")} /></View>}
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.customerHome.loading")}</Copy>}
    {status === "error" && !home && <EmptyState title={t("mobile.customerHome.unavailable")} description={t("mobile.customerHome.offline")} action={{ label: t("mobile.customerHome.retry"), onPress: onRetry }} />}
    {!!live.length && <Section title={t("mobile.customerHome.liveNow")}>{live.map((item) => <Live key={item.jobId} item={item} quiet={offline} twoClock={twoClock} onPress={() => onJob(item.jobId)} />)}</Section>}
    {!!decisions.length && <Section title={t("mobile.customerHome.needsYou")}>{decisions.map((item) => <Card key={`${item.kind}-${item.recordId}`}><DecisionLabel decision={item} /><Button label={decisionAction(t, item.kind)} onPress={() => onDecision(item)} /></Card>)}</Section>}
    {!!upcoming.length && <Section title={t("mobile.customerHome.comingUp")}>{upcoming.map((item) => <Booking key={item.jobId} item={item} quiet={offline} onPress={() => onJob(item.jobId)} />)}</Section>}
    {home && !live.length && (decisions.length > 0 || upcoming.length > 0) && <EmptyState title={t("mobile.customerHome.nothingLive")} description={t("mobile.customerHome.lightsUp")} />}
    {!!home?.recent.length && <Section title={t("mobile.customerHome.latest")}>{home.recent.map((moment) => <RecentMoment key={`${moment.recordId}-${moment.kind}`} moment={moment} zone={[...live, ...decisions, ...upcoming].find((item) => item.jobId === moment.jobId)?.siteZone ?? null} onPress={() => onJob(moment.jobId)} />)}</Section>}
    {onSessions && <ListRow label={t("mobile.laterCustomer.entry")} onPress={onSessions} />}
    {home && !live.length && !decisions.length && !upcoming.length && !home.recent.length && <EmptyState title={t("mobile.customerHome.firstTitle")} description={t("mobile.customerHome.firstBody")} />}
  </Screen>;
}

function RecentMoment({ moment, zone, onPress }: { moment: Home["recent"][number]; zone: string | null; onPress: () => void }) {
  const t = useT(); const format = useFormat();
  const at = format.siteTime(moment.at, zone);
  const detail = at.kind === "available" ? (moment.by ? t("mobile.customerHome.shared", { name: moment.by, time: at.siteTime }) : t("mobile.customerHome.confirmedAt", { time: at.siteTime })) : moment.by;
  return <Card onPress={onPress} accessibilityLabel={[t("mobile.customerHome.update"), detail].filter(Boolean).join(", ")}><Copy variant="label">{t("mobile.customerHome.update")}</Copy>{!!detail && <Copy variant="supporting">{detail}</Copy>}</Card>;
}

export function CachedNowView({ home, confirmed, name, draftCount = 0, draftDescription, onResume, onAsk, onIdentity, onBell }: {
  home: Extract<CachedRead<"home">, { audience: "customer" }> | null; confirmed: number | null; name: string | null; draftCount?: number; draftDescription?: string;
  onResume: () => void; onAsk: () => void; onIdentity: () => void; onBell: () => void;
}) {
  const t = useT();
  return <Screen title={t("mobile.customerHome.now")} identity={<HeaderIdentity name={name} place={t("mobile.customerHome.allPlaces")} onPress={onIdentity} />} bell={<Bell count={home?.unreadCount ?? 0} onPress={onBell} />}>
    <OfflineNotice confirmed={confirmed} zone={home?.place?.siteZone ?? home?.liveVisits[0]?.siteZone ?? home?.upcoming[0]?.siteZone ?? home?.decisions[0]?.siteZone ?? null} />
    {draftCount > 0 ? <><Card onPress={onResume} accessibilityLabel={draftCount === 1 ? t("mobile.customerHome.draft") : t("mobile.customerHome.drafts", { count: draftCount })}><Copy variant="sectionTitle">{draftCount === 1 ? t("mobile.customerHome.draft") : t("mobile.customerHome.drafts", { count: draftCount })}</Copy>{!!draftDescription && <Copy>{draftDescription}</Copy>}</Card><Copy variant="supporting">{t("mobile.customerHome.draftNotice")}</Copy><Button variant="quiet" label={t("mobile.customerHome.newRequest")} onPress={onAsk} /></> : <Button variant="neutral" label={t("mobile.customerHome.ask")} onPress={onAsk} />}
    {!!home?.liveVisits.length && <Section title={t("mobile.customerHome.liveNow")}>{home.liveVisits.map((item) => <CachedVisit key={item.jobId} item={item} />)}</Section>}
    {!!home?.decisions.length && <Section title={t("mobile.customerHome.needsYou")}>{home.decisions.map((item) => <Card key={`${item.kind}-${item.jobId}`}><Copy variant="sectionTitle">{decisionAction(t, item.kind)}</Copy><Copy>{item.title || t("mobile.customerHome.untitled")} · {item.reference}</Copy><Journey journey={item.journey} quiet /></Card>)}</Section>}
    {!!home?.upcoming.length && <Section title={t("mobile.customerHome.comingUp")}>{home.upcoming.map((item) => <CachedBooking key={item.jobId} item={item} />)}</Section>}
  </Screen>;
}
