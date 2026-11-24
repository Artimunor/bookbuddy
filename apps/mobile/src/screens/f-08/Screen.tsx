import { getHomeRoute, listCrewRoute, type CrewRoster } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { useState, type ReactNode } from "react";
import { useRemote } from "../../api";
import type { RemoteStatus } from "../../api/requests";
import { useT } from "../../i18n";
import { Button, Card, Dock, IdentityChip, Screen, SegmentedControl, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useSession } from "../../session";
import { visitLabel } from "../f-01/Screen";
import { useCrewLabels } from "../f-09/Screen";

type Filter = "all" | "free_now" | "open_to_cover";
export default function CrewScreen() {
  const router = useRouter(); const t = useT(); const { bootstrap } = useSession(); const [search, setSearch] = useState(""); const [filter, setFilter] = useState<Filter>("all"); const [cursors, setCursors] = useState<string[]>([]);
  const remote = useRemote(listCrewRoute, { query: { ...(search.trim() ? { search: search.trim() } : {}), filter, ...(cursors.length ? { cursor: cursors[cursors.length - 1] } : {}) } });
  const home = useRemote(getHomeRoute, { query: {} }, { cache: { kind: "home" } });
  const homeData = home.status === "ready" && home.data?.audience === "foreman" ? home.data : null; const live = homeData?.liveVisits[0]; const name = bootstrap?.account.displayName ?? "";
  const identity = <IdentityChip name={name || t("mobile.foremanHome.foreman")} initials={name.split(/\s+/).map(x => x[0]).join("").slice(0, 2)} context={[t("mobile.foremanHome.foreman"), remote.data?.businessName].filter(Boolean).join(" · ")} accessibilityLabel={t("mobile.foremanHome.profile")} onPress={() => router.push("/you" as Href)} />;
  const bell = <Button variant="quiet" label={t("mobile.foremanHome.bell", { count: homeData?.unreadCount ?? 0 })} onPress={() => router.push("/notifications" as Href)} />;
  const dock = live ? <Dock primary={{ label: `${live.reference} · ${visitLabel(t, live.visit.status)}`, onPress: () => router.push(`/f/jobs/${live.jobId}` as Href) }} /> : undefined;
  return <CrewView data={remote.data} status={remote.status} identity={identity} bell={bell} dock={dock} search={search} filter={filter} canPrevious={cursors.length > 0} onSearch={value => { setCursors([]); setSearch(value); }} onFilter={value => { setCursors([]); setFilter(value); }} onClear={() => { setCursors([]); setSearch(""); setFilter("all"); }} onNext={() => { if (remote.data?.page.cursor) setCursors(current => [...current, remote.data!.page.cursor!]); }} onPrevious={() => setCursors(current => current.slice(0, -1))} onMember={id => router.push(`/f/crew/${id}` as Href)} onRetry={() => void remote.refresh()} />;
}
export function CrewView({ data, status, identity, bell, dock, search, filter, canPrevious, onSearch, onFilter, onClear, onNext, onPrevious, onMember, onRetry }: { data: CrewRoster | null; status: RemoteStatus; identity?: ReactNode; bell?: ReactNode; dock?: ReactNode; search: string; filter: Filter; canPrevious: boolean; onSearch: (value: string) => void; onFilter: (value: Filter) => void; onClear: () => void; onNext: () => void; onPrevious: () => void; onMember: (id: string) => void; onRetry: () => void }) {
  const t = useT(); const labels = useCrewLabels(data?.siteZone ?? "UTC");
  return <Screen title={t("mobile.crew.title")} identity={identity} bell={bell} dock={dock}>
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.crew.loading")}</Copy>}{(status === "error" || status === "offline") && <><Copy>{status === "offline" ? t("mobile.crew.offline") : t("mobile.crew.error")}</Copy><Button label={t("mobile.crew.retry")} onPress={onRetry} /></>}
    {data && <Copy variant="supporting">{t("mobile.crew.count", { business: data.businessName, count: data.total, zone: data.siteZone })}</Copy>}
    <TextField label={t("mobile.crew.search")} value={search} onChangeText={onSearch} autoCapitalize="none" /><SegmentedControl label={t("mobile.crew.filters")} value={filter} onChange={onFilter} options={[{ value: "all", label: t("mobile.crew.all") }, { value: "free_now", label: t("mobile.crew.freeNow") }, { value: "open_to_cover", label: t("mobile.crew.openCover") }]} />
    {data && <>{!data.members.length && <><Copy>{search || filter !== "all" ? t("mobile.crew.noMatches") : t("mobile.crew.empty")}</Copy>{(!!search || filter !== "all") && <Button variant="quiet" label={t("mobile.crew.clear")} onPress={onClear} />}</>}
      {data.members.map(member => { const s = member.status; const phase = s.state === "assigned" ? s.briefing === "due" ? t("mobile.crew.briefingDue") : s.phase === "confirmed" ? t("mobile.crew.confirmed") : s.phase === "on_the_way" ? t("mobile.crew.onWay") : s.phase === "on_site" ? t("mobile.crew.onSite") : s.phase === "working" ? t("mobile.crew.working") : t("mobile.crew.departed") : ""; const state = s.state === "assigned" ? s.reference ? t("mobile.crew.assigned", { reference: s.reference, phase }) : phase : s.state === "free" ? s.until === null ? t("mobile.crew.free") : t("mobile.crew.freeUntil", { time: labels.time(s.until) }) : s.state === "unavailable" ? s.since === null ? t("mobile.crew.unavailable") : t("mobile.crew.unavailableSince", { time: labels.time(s.since) }) : labels.eligibility(s.eligibility); return <Card key={member.membershipId} onPress={() => onMember(member.membershipId)} accessibilityLabel={[member.displayName, ...member.skills, ...member.workingLanguages, state, labels.eligibility(member.eligibility)].join(", ")}><Copy variant="sectionTitle">{member.displayName}</Copy><Copy>{member.skills.join(" · ")} · {member.workingLanguages.join(" · ")}</Copy><Copy>{state}</Copy><Copy variant="supporting">{labels.eligibility(member.eligibility)}</Copy></Card>; })}
      {canPrevious && <Button variant="neutral" label={t("mobile.crew.back")} onPress={onPrevious} />}{data.page.hasMore && data.page.cursor && <Button variant="neutral" label={t("mobile.crew.more")} onPress={onNext} />}</>}
  </Screen>;
}
