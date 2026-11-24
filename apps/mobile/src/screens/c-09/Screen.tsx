import { getVisitLiveRoute, type CustomerLiveVisit, type CustomerUpdate } from "@bookbuddy/api-contract";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useRemote } from "../../api";
import { useLiveHints } from "../../api/live";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useLocale, useT } from "../../i18n";
import { useStatusCards, visitCardSource } from "../../system/status-cards";
import { useMediaReadBatch } from "../../media/read-batch";
import { useOpenMediaPreview } from "../../media/read";
import { Button, Card, Dock, Screen, StatusBanner, SwitchRow, Thumb } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { LiveCapsule, Stamp, type LiveCapsuleState } from "../../ui/live";
import { readingLanguageLabel } from "../s-12/language";
import { useBeaconTheme } from "../../ui/theme";

export function LiveVisitScreen({ visitId, twoClock, viewSwitcher, onBack, onNavigate }: {
  visitId: string; twoClock: boolean; viewSwitcher: ReactNode; onBack: () => void; onNavigate: (path: string) => void;
}) {
  const remote = useRemote(getVisitLiveRoute, { params: { id: visitId } }, { enabled: !!visitId });
  const retryLive = useLiveHints(visitId ? { kind: "customer-visit", opaqueId: visitId } : null, remote.refresh);
  const visit = remote.data && "moments" in remote.data ? remote.data : null;
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<CustomerUpdate[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const page = useRemote(getVisitLiveRoute, { params: { id: visitId }, query: cursor ? { cursor } : undefined }, { enabled: !!visitId && !!cursor && remote.status === "ready" });
  useEffect(() => {
    setCursor(null); setHistory([]); setNextPage(visit?.page.hasMore ? visit.page.cursor : null);
  }, [remote.data, visitId]);
  useEffect(() => {
    if (!cursor || page.status !== "ready" || !("moments" in page.data)) return;
    const result = page.data;
    setHistory(previous => {
      const seen = new Set(previous.map(item => item.id));
      return [...previous, ...result.moments.filter(item => !seen.has(item.id))];
    });
    setNextPage(page.data.page.hasMore ? page.data.page.cursor : null);
    setCursor(null);
  }, [cursor, page.status, page.data]);
  const displayedVisit = visit && history.length ? { ...visit, moments: [...visit.moments, ...history] } : visit;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (visit?.live.status !== "on_the_way") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [visit?.live.status, visit?.live.arrival?.id]);
  const last = useRef<{ at: number; zone: string } | null>(null);
  if (remote.status === "ready" && visit) last.current = { at: remote.lastConfirmedAt, zone: visit.siteZone };
  const { preferences, active, start, stop, refresh } = useStatusCards();
  const card = active?.target.kind === "customer_visit" && active.target.id === visitId ? active : null;
  const [followBusy, setFollowBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  useEffect(() => {
    if (!card) return;
    if (visit) void refresh(visitCardSource(visit)).catch(() => undefined);
    else if (remote.error?.code === "NOT_FOUND" || remote.error?.code === "UNAUTHENTICATED") void stop(card.id).catch(() => undefined);
  }, [card, visit, remote.error, refresh, stop]);
  async function changeFollow(value: boolean) {
    if (followBusy) return;
    setFollowBusy(true); setSaveError(false);
    try {
      if (!value && card) await stop(card.id);
      else if (value && visit && remote.status === "ready" && !await start(visitCardSource(visit))) setSaveError(true);
    } catch { setSaveError(true); }
    finally { setFollowBusy(false); }
  }
  return <LiveVisitView visit={displayedVisit} status={remote.status} lastConfirmed={last.current} twoClock={twoClock} now={now} viewSwitcher={viewSwitcher} statusCardsAvailable={preferences.statusCardsEnabled} following={!!card} followBusy={followBusy} saveError={saveError} onFollow={value => { void changeFollow(value); }} onBack={onBack} onRefresh={() => { retryLive(); void remote.refresh(); }} onNavigate={onNavigate} hasMore={!!nextPage} moreBusy={page.status === "loading"} onMore={() => { if (cursor) void page.refresh(); else if (nextPage) setCursor(nextPage); }} photoStamp={RoutedPhotoStamp} />;
}

export function LiveVisitView({ visit, status, lastConfirmed, twoClock = false, viewerZone, now = Date.now(), viewSwitcher, statusCardsAvailable = false, following = false, followBusy = false, saveError = false, hasMore = false, moreBusy = false, onMore, onFollow, onBack, onRefresh, onNavigate, photoStamp: VisitPhoto = PhotoStamp }: {
  visit: CustomerLiveVisit | null; status: RemoteStatus; lastConfirmed?: { at: number; zone: string } | null; twoClock?: boolean; viewerZone?: string; now?: number; viewSwitcher?: ReactNode;
  statusCardsAvailable?: boolean; following?: boolean; followBusy?: boolean; saveError?: boolean; hasMore?: boolean; moreBusy?: boolean; onMore?: () => void; onFollow: (value: boolean) => void; onBack: () => void; onRefresh: () => void; onNavigate: (path: string) => void;
  photoStamp?: typeof PhotoStamp;
}) {
  const t = useT(); const format = useFormat(); const { locale } = useLocale(); const { color, radius, space } = useBeaconTheme();
  const zone = visit?.siteZone ?? lastConfirmed?.zone;
  const viewer = twoClock ? (viewerZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone) : undefined;
  const clock = (value: number, timeZone: string | undefined) => {
    if (!timeZone) return "";
    try { return new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value); }
    catch { return ""; }
  };
  const at = (value: number) => clock(value, zone);
  const clocks = (start: number, end?: number) => {
    const a = format.twoClock(start, zone, viewer); const b = end === undefined ? null : format.twoClock(end, zone, viewer);
    const site = end === undefined ? at(start) : t("mobile.liveVisit.range", { start: at(start), end: at(end) });
    const viewerStart = a.kind === "available" && a.viewerTime ? (a.viewerDateDiffers ? a.viewerTime : clock(start, viewer)) : null;
    const viewerEnd = b?.kind === "available" && b.viewerTime && end !== undefined ? (b.viewerDateDiffers ? b.viewerTime : clock(end, viewer)) : null;
    const other = viewerStart && viewerEnd ? t("mobile.liveVisit.range", { start: viewerStart, end: viewerEnd }) : viewerStart;
    return { site, other: other ? t("mobile.liveVisit.yourTime", { time: other }) : undefined };
  };
  const live = visit?.live;
  const labels = [t("mobile.liveVisit.stepConfirmed"), t("mobile.liveVisit.stepWay"), t("mobile.liveVisit.stepSite"), t("mobile.liveVisit.working"), t("mobile.liveVisit.stepFinished")] as [string, string, string, string, string];
  const steps = ["confirmed", "on_the_way", "on_site", "working", "finished"];
  const newest = visit?.moments.slice().sort((a, b) => b.recordedAt - a.recordedAt) ?? [];
  const travel = newest.find(item => item.kind === "on_the_way" || item.kind === "arrival_revised" || item.kind === "arrival_withdrawn" || item.kind === "cover_arranging");
  const expired = !live?.status && (travel?.kind === "on_the_way" || travel?.kind === "arrival_revised") && live?.source?.at === travel.recordedAt ? travel : null;
  // The server omits an expired estimate; retain only its published band as history.
  const arrival = live?.arrival?.band ?? expired?.band;
  const passed = !!arrival && (expired !== null || (live?.status === "on_the_way" && now > arrival.endsAt));
  const index = (passed ? 1 : Math.max(0, steps.indexOf(live?.step ?? ""))) as 0 | 1 | 2 | 3 | 4;
  const changed = live?.status === "confirmed" && newest.find(item => item.kind === "crew_confirmed" || item.kind === "crew_updated")?.kind === "crew_updated";
  const states: Record<NonNullable<typeof live>["status"] & string, LiveCapsuleState> = { confirmed: changed ? "crewChanged" : "crewConfirmed", on_the_way: passed ? "noUpdateSince" : "onTheWay", on_site: "onSite", working: "working", finished: "finished", cover_arranging: "coverBeingArranged", no_crew_available: "quiet", paused: "paused" };
  const names = { confirmed: t("mobile.liveVisit.confirmed"), on_the_way: t("mobile.liveVisit.onWay"), on_site: t("mobile.liveVisit.onSite"), working: t("mobile.liveVisit.working"), finished: t("mobile.liveVisit.finished"), cover_arranging: t("mobile.liveVisit.cover"), no_crew_available: t("mobile.liveVisit.noCrew"), paused: t("mobile.liveVisit.paused") };
  const label = passed ? t("mobile.liveVisit.passed") : changed ? t("mobile.liveVisit.changed") : live?.status ? names[live.status] : t("mobile.liveVisit.quiet");
  const state = passed ? "noUpdateSince" : live?.status ? states[live.status] : "quiet";
  const band = (live?.status === "on_the_way" || passed) && arrival ? arrival : live?.status === "confirmed" ? visit?.window : null;
  const bandClock = band ? clocks(band.startsAt, band.endsAt) : null;
  const sinceClock = live?.since != null ? clocks(live.since) : null;
  const nextClock = live?.nextUpdateAt != null ? clocks(live.nextUpdateAt) : null;
  const time = bandClock?.site ?? (nextClock ? t("mobile.liveVisit.updateBy", { time: nextClock.site }) : sinceClock ? t("mobile.liveVisit.since", { time: sinceClock.site }) : undefined);
  const second = bandClock?.other ?? nextClock?.other ?? sinceClock?.other;
  const siteClock = visit ? format.siteTime(visit.window.startsAt, zone) : null;
  const zoneLabel = siteClock?.kind === "available" ? format.zoneLabel(zone, siteClock.site) : "";
  const source = live?.source;
  const estimatedMinutes = !passed && live?.status === "on_the_way" && arrival && now < arrival.startsAt ? Math.ceil((arrival.startsAt - now) / 60000) : null;
  const estimateLabel = estimatedMinutes === null ? undefined : t("mobile.liveVisit.estimate", { minutes: estimatedMinutes });
  const fraction = arrival && source && arrival.startsAt > source.at ? Math.max(0, Math.min(1, (now - source.at) / (arrival.startsAt - source.at))) : 0;
  const visitDate = siteClock?.kind === "available" ? siteClock.site.date ?? undefined : undefined;
  const provenance = source ? source.sharedByName ? t("mobile.liveVisit.shared", { name: source.sharedByName, time: [at(source.at), zoneLabel].filter(Boolean).join(" ") }) : t("mobile.liveVisit.last", { time: at(source.at) }) : "";
  const crew = visit?.confirmedCrewNames.map((name, i) => ({ id: `${name}-${i}`, name, initials: name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() })) ?? [];
  const corrected = new Set(newest.flatMap(item => "correctsId" in item ? [item.correctsId] : []));
  const root = visit ? `/c/jobs/${visit.job.id}` : "";
  const dock = visit?.live.status === "finished" ? <Dock primary={{ label: t("mobile.liveVisit.review"), onPress: () => onNavigate(`${root}/completion`) }} /> : visit?.jobThreadId ? <Dock primary={{ glyph: "✉", label: t("mobile.liveVisit.message", { name: visit.foremanName ?? visit.providerName }), onPress: () => onNavigate(`/threads/${visit.jobThreadId}`) }} /> : undefined;
  const titleFor = (item: CustomerUpdate) => {
    switch (item.kind) {
      case "crew_confirmed": return t("mobile.liveVisit.confirmed"); case "crew_updated": return t("mobile.liveVisit.changed");
      case "on_the_way": return t("mobile.liveVisit.stepWay"); case "arrival_revised": return t("mobile.liveVisit.revised"); case "arrival_withdrawn": return t("mobile.liveVisit.withdrawn");
      case "on_site": return t("mobile.liveVisit.onSite"); case "working": return t("mobile.liveVisit.working"); case "finished": return t("mobile.liveVisit.stepFinished");
      case "cover_arranging": return t("mobile.liveVisit.cover"); case "paused": return t("mobile.liveVisit.paused"); case "photo": return t("mobile.liveVisit.photo");
      case "no_crew_available": return t("mobile.liveVisit.noCrew");
    }
  };
  return <Screen title={visit?.job.title ?? t("mobile.customerHome.untitled")} subtitle={visit ? `${visit.job.reference} · ${visit.job.placeAlias}` : undefined} navigation={{ kind: "back", label: t("mobile.jobHome.back"), onPress: onBack }} dock={dock} scroll={false}>
    <ScrollView refreshControl={<RefreshControl refreshing={status === "loading"} onRefresh={onRefresh} />} contentContainerStyle={{ padding: space.contentInset, gap: space.grid[3] }}>
      {viewSwitcher}
      {status === "offline" && <StatusBanner state="offline" label={lastConfirmed ? `${t("mobile.liveVisit.offline")} · ${t("mobile.liveVisit.last", { time: at(lastConfirmed.at) })}` : t("mobile.liveVisit.offline")} />}
      {(status === "loading" || status === "idle") && <Copy>{t("mobile.jobHome.loading")}</Copy>}
      {status === "error" && <><Copy>{t("mobile.liveVisit.unavailable")}</Copy><Button label={t("mobile.liveVisit.refresh")} onPress={onRefresh} /></>}
      {visit && <>
        <LiveCapsule size="hero" state={state} stateLabel={label} source={visit.providerName} reference={visitDate} time={time} estimate={estimateLabel}
          zoneLine={[zoneLabel, second].filter(Boolean).join(" · ")} provenance={provenance}
          accessibilityLabel={[label, time, zoneLabel, second, estimateLabel, t("mobile.liveVisit.step", { step: index + 1, stage: labels[index] }), provenance].filter(Boolean).join(", ")}
          line={{ kind: "visit", steps: labels, hideEstimateLabel: true, ...(index === 1 ? { current: 1 as const, estimate: estimateLabel ? { fraction, label: estimateLabel } : undefined } : { current: index }),
            accessibilityLabel: t("mobile.liveVisit.step", { step: index + 1, stage: labels[index] }), ...(state === "coverBeingArranged" ? { status: { state: "cover" as const, label } } : {}) }} crew={{ audience: "customer", people: crew }} />
        {changed && <Copy variant="supporting">{t("mobile.liveVisit.sameWindow")}</Copy>}
        {live?.status === "no_crew_available" && <Button variant="quiet" label={t("mobile.visitWindow.title")} onPress={() => onNavigate(`${root}/windows?visitId=${encodeURIComponent(visit.visitId)}`)} />}
        {statusCardsAvailable && live?.status !== "finished" && <View style={{ overflow: "hidden", borderRadius: radius.card, borderWidth: 1, borderColor: color.separator }}>
          <SwitchRow label={t("mobile.liveVisit.follow")} description={t("mobile.statusCards.visitDescription")} value={following} disabled={followBusy || (!following && status !== "ready")} onValueChange={onFollow} />
          {saveError && <Copy accessibilityRole="alert" style={{ padding: space.grid[3], color: color.criticalInk }}>{t("mobile.statusCards.unavailable")}</Copy>}
        </View>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: space.grid[2] }}>
          <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.liveVisit.moments")}</Copy><Copy variant="supporting" style={{ color: color.muted }}>{zoneLabel}</Copy>
        </View>
        {!newest.length && <Card><Copy variant="supporting">{t("mobile.liveVisit.empty")}</Copy></Card>}
        {newest.map(item => {
          const title = titleFor(item);
          const time = at(item.recordedAt);
          if (item.kind === "photo") return <VisitPhoto key={item.id} item={item} title={title} time={time} onOpen={() => onNavigate(`/media/${item.photo.attachmentId}`)} />;
          const detail = "band" in item ? clocks(item.band.startsAt, item.band.endsAt).site : item.kind === "cover_arranging" ? t("mobile.liveVisit.updateBy", { time: at(item.nextUpdateAt) }) : undefined;
          return <Stamp key={item.id} kind={item.kind === "on_site" ? "attendance" : item.kind === "crew_updated" || item.kind === "crew_confirmed" ? "crew" : "system"} title={title} time={time} attribution={"sharedByName" in item ? item.sharedByName : undefined} detail={detail} {...(corrected.has(item.id) ? { state: "corrected" as const, stateLabel: t("mobile.liveVisit.corrected") } : { state: "confirmed" as const })} />;
        })}
        {hasMore && onMore && <Button variant="neutral" label={t("mobile.liveVisit.moreMoments")} disabled={moreBusy} onPress={onMore} />}
        {statusCardsAvailable && live?.status !== "finished" && <Button variant="quiet" label={t("mobile.liveVisit.privacy")} onPress={() => onNavigate("/live-privacy")} />}
        <Button variant="quiet" label={t("mobile.liveVisit.report")} onPress={() => onNavigate(`${root}/case/new`)} />
      </>}
    </ScrollView>
  </Screen>;
}

type PhotoStampProps = { item: Extract<CustomerUpdate, { kind: "photo" }>; title: string; time: string; onOpen: () => void; uri?: string };

function RoutedPhotoStamp(props: PhotoStampProps) {
  const { item } = props;
  const available = item.photo.availability === "available";
  const scope = { caller: "update" as const, parentScopeId: item.id };
  const urls = useMediaReadBatch(available ? [item.photo.attachmentId] : [], available ? scope : null);
  const open = useOpenMediaPreview();
  return <PhotoStamp {...props} uri={urls.get(item.photo.attachmentId)} onOpen={() => open(item.photo.attachmentId, scope)} />;
}

function PhotoStamp({ item, title, time, onOpen, uri }: PhotoStampProps) {
  const t = useT();
  const { caption, photo } = item;
  const translated = caption?.reading?.status === "ready" ? caption.reading.text : null;
  const available = photo.availability === "available";
  const detail = translated ?? caption?.original.text ?? (available ? undefined : t("mobile.liveVisit.photoUnavailable"));
  return <>
    <Stamp kind="photo" title={title} time={time} attribution={item.sharedByName} detail={detail}
      thumbnail={available ? <Thumb uri={uri} label={detail ?? title} onPress={onOpen} /> : undefined} />
    {translated && caption && <><Copy variant="supporting">{t("mobile.aftercare.original", { language: readingLanguageLabel(t, caption.original.language) })}</Copy><Copy>{caption.original.text}</Copy></>}
  </>;
}
