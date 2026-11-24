import { getJobsRoute, listPlacesRoute, type JobsPage, type PlaceSummary } from "@bookbuddy/api-contract";
import { JOURNEY_STEPS } from "@bookbuddy/domain";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useRemote } from "../../api";
import { useFormat, useT } from "../../i18n";
import { usePendingDrafts, useRepository } from "../../repository/hooks";
import type { CachedRead } from "../../repository/remote-cache";
import { useSession } from "../../session";
import { Button, Card, EmptyState, Screen, SegmentedControl } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { Bell, CachedBooking, HeaderIdentity, Journey, Live, OfflineNotice, Section, journeyLabels } from "../c-01/common";
import { savedRequestHref } from "../c-02/draft";

type CustomerPage = Extract<JobsPage, { audience: "customer" }>;
type Segment = "active" | "past";
type Status = "idle" | "loading" | "ready" | "error" | "offline";

export default function BookingsScreen() {
  const router = useRouter();
  const { bootstrap, preferences } = useSession();
  const repository = useRepository();
  const drafts = usePendingDrafts("request");
  const t = useT();
  const [segment, setSegment] = useState<Segment>("active");
  const [place, setPlace] = useState<Pick<PlaceSummary, "id" | "alias"> | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [cursors, setCursors] = useState<string[]>([]);
  const [placeCursors, setPlaceCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1), placeCursor = placeCursors.at(-1);
  const remote = useRemote(getJobsRoute, { query: { segment, ...(place ? { placeId: place.id } : {}), ...(cursor ? { cursor } : {}) } }, { cache: { kind: "jobs_list" } });
  const places = useRemote(listPlacesRoute, { query: { ...(placeCursor ? { cursor: placeCursor } : {}) } }, { enabled: filterOpen });
  const draftList = segment === "active" && drafts.length > 0
    ? <Section title={drafts.length === 1 ? t("mobile.customerHome.draft") : t("mobile.customerHome.drafts", { count: drafts.length })}>
      {drafts.map(({ draftId, summary }) => <Card key={draftId}
        accessibilityLabel={[t("mobile.customerHome.draft"), summary].filter(Boolean).join(", ")}
        onPress={() => { void savedRequestHref(repository, draftId).then((href) => { if (href) router.push(href); }).catch(() => {}); }}>
        <Copy variant="supporting">{t("mobile.customerHome.draft")}</Copy>{summary && <Copy>{summary}</Copy>}
      </Card>)}
    </Section> : null;
  if (remote.status === "offline") return <CachedBookingsView page={remote.data?.audience === "customer" ? remote.data : null} confirmed={remote.lastConfirmedAt} name={bootstrap?.account.displayName ?? null} segment={segment} draftList={draftList} onSegment={(next) => { setSegment(next); setCursors([]); }} onIdentity={() => router.push("/you" as Href)} onBell={() => router.push("/notifications" as Href)} />;
  const page = remote.data?.audience === "customer" ? remote.data : null;
  return <BookingsView page={page} status={remote.status} confirmed={null} name={bootstrap?.account.displayName ?? null} twoClock={preferences?.twoClock ?? false} segment={segment} draftList={draftList} place={place} filterOpen={filterOpen} places={places.data?.places ?? []} placesStatus={places.status}
    onSegment={(next) => { setSegment(next); setCursors([]); }} onToggleFilter={() => setFilterOpen((open) => !open)}
    onPlace={(next) => { setPlace(next); setFilterOpen(false); setCursors([]); }} onIdentity={() => router.push("/you" as Href)} onBell={() => router.push("/notifications" as Href)}
    onRetry={() => { void remote.refresh(); }} onRetryPlaces={() => { void places.refresh(); }}
    onJob={(id, live) => router.push(`/c/jobs/${id}?view=${live ? "today" : "whole"}` as Href)} onNow={() => router.push("/c/(tabs)/now" as Href)}
    onPrevious={cursors.length ? () => setCursors((current) => current.slice(0, -1)) : undefined}
    onNext={page?.page.hasMore && page.page.cursor ? () => setCursors((current) => [...current, page.page.cursor!]) : undefined}
    onPreviousPlaces={placeCursors.length ? () => setPlaceCursors((current) => current.slice(0, -1)) : undefined}
    onNextPlaces={places.data?.hasMore && places.data.cursor ? () => setPlaceCursors((current) => [...current, places.data!.cursor!]) : undefined} />;
}

export function BookingsView({ page, status, confirmed, name, twoClock = false, segment, draftList, place, filterOpen, places, placesStatus, onSegment, onToggleFilter, onPlace, onIdentity, onBell, onRetry, onRetryPlaces, onJob, onNow, onPrevious, onNext, onPreviousPlaces, onNextPlaces }: {
  page: CustomerPage | null; status: Status; confirmed: number | null; name: string | null; twoClock?: boolean; segment: Segment; place: Pick<PlaceSummary, "id" | "alias"> | null;
  draftList?: ReactNode;
  filterOpen: boolean; places: PlaceSummary[]; placesStatus: Status; onSegment: (value: Segment) => void; onToggleFilter: () => void; onPlace: (place: Pick<PlaceSummary, "id" | "alias"> | null) => void;
  onIdentity: () => void; onBell: () => void; onRetry: () => void; onRetryPlaces: () => void; onJob: (id: string, live: boolean) => void; onNow: () => void;
  onPrevious?: () => void; onNext?: () => void; onPreviousPlaces?: () => void; onNextPlaces?: () => void;
}) {
  const t = useT();
  const format = useFormat();
  const { field, space } = useBeaconTheme();
  const offline = status === "offline";
  const currentPage = page?.segment === segment ? page : null;
  const items = currentPage?.items ?? [];
  const live = segment === "active" ? currentPage?.live : null;
  const liveCount = items.reduce((count, item) => count + Number(item.live), 0);
  const liveDate = live ? format.siteTime(live.visit.window.startsAt, live.siteZone) : null;
  const summary = currentPage ? segment === "past" ? t("mobile.customerHome.pastCount", { count: currentPage.pastCount })
    : live ? [liveDate?.kind === "available" ? liveDate.site.date : null,
      currentPage.page.hasMore ? t("mobile.customerHome.liveNow") : t("mobile.customerHome.liveCount", { count: Math.max(1, liveCount) })].filter(Boolean).join(" · ")
      : t("mobile.customerHome.activeCount", { count: currentPage.activeCount }) : undefined;
  const filter = place?.alias ?? t("mobile.customerHome.allPlaces");
  return <Screen title={t("mobile.customerHome.bookings")} subtitle={summary}
    identity={<HeaderIdentity name={name} place={filter} onPress={onIdentity} />} bell={<Bell count={currentPage?.unreadCount ?? 0} onPress={onBell} />}
    dock={live ? <View style={{ paddingHorizontal: space.contentInset, paddingVertical: space.grid[2] }}>
      <Live item={live} quiet={offline} twoClock={twoClock} pill onPress={() => onJob(live.jobId, true)} />
    </View> : undefined}>
    {offline && <OfflineNotice confirmed={confirmed} zone={currentPage?.siteZone ?? null} />}
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.grid[field ? 4 : 3] }}>
      <View style={{ flexGrow: 1 }}>
        <SegmentedControl hideLabel label={t("mobile.customerHome.segment")} options={[{ value: "active", label: t("mobile.customerHome.active") }, { value: "past", label: t("mobile.customerHome.past") }]} value={segment} onChange={onSegment} />
      </View>
      <Button variant="neutral" glyph="⌄" label={filter} onPress={onToggleFilter} />
    </View>
    {filterOpen && <Card dense><Copy variant="label">{t("mobile.customerHome.filter")}</Copy><Button variant="quiet" label={t("mobile.customerHome.allPlaces")} onPress={() => onPlace(null)} />{places.map((item) => <Button key={item.id} variant="quiet" label={item.alias} onPress={() => onPlace(item)} />)}
      {(placesStatus === "loading" || placesStatus === "idle") && <Copy>{t("mobile.customerHome.loading")}</Copy>}
      {(placesStatus === "error" || placesStatus === "offline") && <><Copy>{t("mobile.customerHome.unavailable")}</Copy><Button label={t("mobile.customerHome.retry")} onPress={onRetryPlaces} /></>}
      {onPreviousPlaces && <Button variant="quiet" label={t("mobile.customerHome.previousPage")} onPress={onPreviousPlaces} />}{onNextPlaces && <Button variant="quiet" label={t("mobile.customerHome.nextPage")} onPress={onNextPlaces} />}</Card>}
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.customerHome.loading")}</Copy>}
    {status === "error" && !currentPage && <EmptyState title={t("mobile.customerHome.unavailable")} description={t("mobile.customerHome.offline")} action={{ label: t("mobile.customerHome.retry"), onPress: onRetry }} />}
    {items.map((item) => <BookingListCard key={item.jobId} item={item} quiet={offline || segment === "past"}
      onPress={() => onJob(item.jobId, item.live && segment === "active")} />)}
    {draftList}
    {currentPage && !items.length && !draftList && <EmptyState title={place ? t("mobile.customerHome.noFiltered", { place: place.alias }) : t("mobile.customerHome.noBookings")} description={t("mobile.customerHome.noBookingsBody")} action={place ? { label: t("mobile.customerHome.showAll"), onPress: () => onPlace(null) } : { label: t("mobile.customerHome.now"), onPress: onNow }} />}
    {onPrevious && <Button variant="quiet" label={t("mobile.customerHome.previousPage")} onPress={onPrevious} />}
    {onNext && <Button variant="quiet" label={t("mobile.customerHome.nextPage")} onPress={onNext} />}
  </Screen>;
}

function BookingListCard({ item, quiet, onPress }: { item: CustomerPage["items"][number]; quiet: boolean; onPress: () => void }) {
  const t = useT();
  const format = useFormat();
  const { color, radius, space } = useBeaconTheme();
  const title = item.title ?? t("mobile.customerHome.untitled");
  const step = JOURNEY_STEPS.indexOf(item.journey.step);
  const stage = journeyLabels(t)[step]!;
  const cancelled = item.journey.cancelled;
  const paid = item.journey.complete && item.journey.step === "paid";
  const lit = item.live && !quiet;
  const live = lit ? t("mobile.customerHome.live") : null;
  const when = item.nextVisit ? format.lines(item.nextVisit.window.startsAt, item.siteZone) : null;
  const final = paid && item.finalAt !== null ? format.siteTime(item.finalAt, item.siteZone) : null;
  const next = cancelled ? t("mobile.customerHome.noCancellationFee")
    : paid && final?.kind === "available" && final.site.date ? t("mobile.customerHome.paymentRecorded", { date: final.site.date })
      : item.nextStep?.waitingOn ? t("mobile.customerHome.waiting", { name: item.nextStep.waitingOn })
        : !quiet && item.journey.step === "requested" ? t("mobile.request.notYetBooking") : when?.site;
  const status = cancelled ? t("mobile.customerHome.cancelled") : stage;
  return <Card dense onPress={onPress} accessibilityLabel={[title, item.reference, item.place.alias, item.providerName,
    t("mobile.customerHome.step", { step: step + 1, stage }), cancelled ? status : null, next, live].filter(Boolean).join(", ")}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: space.grid[1] }}>
      <Copy variant="label" style={{ flexShrink: 1 }}>{title}</Copy>
      <Copy variant="caption" style={{ color: color.muted }}>{item.reference}</Copy>
    </View>
    <Copy variant="supporting" style={{ color: color.muted }}>{item.place.alias} · {item.providerName}</Copy>
    <Journey journey={item.journey} quiet={!lit && !paid} />
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.grid[2] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: space.grid[1], flexShrink: 1 }}>
        <Copy variant="supporting">{status}</Copy>
        {!!next && <Copy variant="supporting" style={{ color: color.muted }}>· {next}</Copy>}
      </View>
      {live && <View style={{ backgroundColor: color.live, borderWidth: 2, borderColor: color.onLive, borderRadius: radius.pill, paddingHorizontal: space.grid[2] }}>
        <Copy variant="caption" style={{ color: color.onLive }}>{live}</Copy>
      </View>}
    </View>
  </Card>;
}

export function CachedBookingsView({ page, confirmed, name, segment, draftList, onSegment, onIdentity, onBell }: {
  page: Extract<CachedRead<"jobs_list">, { audience: "customer" }> | null; confirmed: number | null; name: string | null; segment: Segment;
  draftList?: ReactNode;
  onSegment: (value: Segment) => void; onIdentity: () => void; onBell: () => void;
}) {
  const t = useT();
  return <Screen title={t("mobile.customerHome.bookings")} identity={<HeaderIdentity name={name} place={t("mobile.customerHome.allPlaces")} onPress={onIdentity} />} bell={<Bell count={page?.unreadCount ?? 0} onPress={onBell} />}>
    <OfflineNotice confirmed={confirmed} zone={page?.siteZone ?? null} />
    <SegmentedControl label={t("mobile.customerHome.segment")} options={[{ value: "active", label: t("mobile.customerHome.active") }, { value: "past", label: t("mobile.customerHome.past") }]} value={segment} onChange={onSegment} />
    {page?.items.map((item) => <CachedBooking key={item.jobId} item={item} />)}
    {draftList}
  </Screen>;
}
