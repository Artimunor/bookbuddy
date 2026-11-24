import { getJobsRoute, listPlacesRoute, type JobsPage, type PlaceSummary } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import type { ReactNode } from "react";
import { useRemote } from "../../api";
import { useT } from "../../i18n";
import { usePendingDrafts, useRepository } from "../../repository/hooks";
import type { CachedRead } from "../../repository/remote-cache";
import { useSession } from "../../session";
import { Button, Card, EmptyState, Screen, SegmentedControl } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { Bell, Booking, CachedBooking, HeaderIdentity, Live, OfflineNotice, Section } from "../c-01/common";
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
    onRetry={() => { void remote.refresh(); }} onRetryPlaces={() => { void places.refresh(); }} onJob={(id) => router.push(`/c/jobs/${id}` as Href)} onNow={() => router.push("/c/(tabs)/now" as Href)}
    onPrevious={cursors.length ? () => setCursors((current) => current.slice(0, -1)) : undefined}
    onNext={page?.page.hasMore && page.page.cursor ? () => setCursors((current) => [...current, page.page.cursor!]) : undefined}
    onPreviousPlaces={placeCursors.length ? () => setPlaceCursors((current) => current.slice(0, -1)) : undefined}
    onNextPlaces={places.data?.hasMore && places.data.cursor ? () => setPlaceCursors((current) => [...current, places.data!.cursor!]) : undefined} />;
}

export function BookingsView({ page, status, confirmed, name, twoClock = false, segment, draftList, place, filterOpen, places, placesStatus, onSegment, onToggleFilter, onPlace, onIdentity, onBell, onRetry, onRetryPlaces, onJob, onNow, onPrevious, onNext, onPreviousPlaces, onNextPlaces }: {
  page: CustomerPage | null; status: Status; confirmed: number | null; name: string | null; twoClock?: boolean; segment: Segment; place: Pick<PlaceSummary, "id" | "alias"> | null;
  draftList?: ReactNode;
  filterOpen: boolean; places: PlaceSummary[]; placesStatus: Status; onSegment: (value: Segment) => void; onToggleFilter: () => void; onPlace: (place: Pick<PlaceSummary, "id" | "alias"> | null) => void;
  onIdentity: () => void; onBell: () => void; onRetry: () => void; onRetryPlaces: () => void; onJob: (id: string) => void; onNow: () => void;
  onPrevious?: () => void; onNext?: () => void; onPreviousPlaces?: () => void; onNextPlaces?: () => void;
}) {
  const t = useT(); const offline = status === "offline";
  const items = page?.items ?? [];
  return <Screen title={t("mobile.customerHome.bookings")} identity={<HeaderIdentity name={name} place={place?.alias ?? t("mobile.customerHome.allPlaces")} onPress={onIdentity} />} bell={<Bell count={page?.unreadCount ?? 0} onPress={onBell} />}
    dock={segment === "active" && page?.live ? <Live item={page.live} quiet={offline} twoClock={twoClock} pill onPress={() => onJob(page.live!.jobId)} /> : undefined}>
    {offline && <OfflineNotice confirmed={confirmed} zone={page?.siteZone ?? null} />}
    <SegmentedControl label={t("mobile.customerHome.segment")} options={[{ value: "active", label: t("mobile.customerHome.active") }, { value: "past", label: t("mobile.customerHome.past") }]} value={segment} onChange={onSegment} />
    <Button variant="neutral" label={place?.alias ?? t("mobile.customerHome.allPlaces")} accessibilityLabel={t("mobile.customerHome.filter")} onPress={onToggleFilter} />
    {filterOpen && <><Button variant="quiet" label={t("mobile.customerHome.allPlaces")} onPress={() => onPlace(null)} />{places.map((item) => <Button key={item.id} variant="quiet" label={item.alias} onPress={() => onPlace(item)} />)}
      {(placesStatus === "loading" || placesStatus === "idle") && <Copy>{t("mobile.customerHome.loading")}</Copy>}
      {(placesStatus === "error" || placesStatus === "offline") && <><Copy>{t("mobile.customerHome.unavailable")}</Copy><Button label={t("mobile.customerHome.retry")} onPress={onRetryPlaces} /></>}
      {onPreviousPlaces && <Button variant="quiet" label={t("mobile.customerHome.previousPage")} onPress={onPreviousPlaces} />}{onNextPlaces && <Button variant="quiet" label={t("mobile.customerHome.nextPage")} onPress={onNextPlaces} />}</>}
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.customerHome.loading")}</Copy>}
    {status === "error" && !page && <EmptyState title={t("mobile.customerHome.unavailable")} description={t("mobile.customerHome.offline")} action={{ label: t("mobile.customerHome.retry"), onPress: onRetry }} />}
    {items.map((item) => <Booking key={item.jobId} item={item} quiet={offline || segment === "past"} onPress={() => onJob(item.jobId)} />)}
    {draftList}
    {page && !items.length && !draftList && <EmptyState title={place ? t("mobile.customerHome.noFiltered", { place: place.alias }) : t("mobile.customerHome.noBookings")} description={t("mobile.customerHome.noBookingsBody")} action={place ? { label: t("mobile.customerHome.showAll"), onPress: () => onPlace(null) } : { label: t("mobile.customerHome.now"), onPress: onNow }} />}
    {onPrevious && <Button variant="quiet" label={t("mobile.customerHome.previousPage")} onPress={onPrevious} />}
    {onNext && <Button variant="quiet" label={t("mobile.customerHome.nextPage")} onPress={onNext} />}
  </Screen>;
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
