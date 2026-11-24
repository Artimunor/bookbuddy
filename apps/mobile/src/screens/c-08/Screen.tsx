import { confirmVisitWindowRoute, getJobRoute, getJobWindowsRoute, type JobWindows, type VisitSchedule } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useCommand, useRemote } from "../../api";
import type { CommandStatus, RemoteStatus } from "../../api/requests";
import { useFormat, useLocale, useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Button, Card, Dock, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { TwoClock } from "../../ui/live/TwoClock";
import { useBeaconTheme } from "../../ui/theme";
import { confirmAction } from "../s-17/confirmAction";

export function currentVisit(data: JobWindows | null, visitId?: string): VisitSchedule | null {
  if (visitId) return data?.visits.find(v => v.id === visitId) ?? null;
  return data?.visits.find(v => v.offeredWindows.length > 0) ?? data?.visits.find(v => v.bookedWindow && v.state === "booked") ?? data?.visits[0] ?? null;
}

export function WindowTime({ start, end, zone, twoClock, viewerZone }: { start: number; end: number; zone: string; twoClock: boolean; viewerZone?: string }) {
  const t = useT(); const format = useFormat();
  const viewer = twoClock ? (viewerZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone) : undefined;
  const a = format.twoClock(start, zone, viewer); const b = format.twoClock(end, zone, viewer);
  if (a.kind !== "available" || b.kind !== "available") return null;
  return <TwoClock siteTime={`${a.siteTime} – ${b.siteTime}`} siteZone={t("mobile.visitWindow.siteTime")} viewerLine={a.viewerTime && b.viewerTime ? t("mobile.visitWindow.yourTime", { time: `${a.viewerTime} – ${b.viewerTime}` }) : undefined} />;
}

export default function WindowScreen() {
  const { jobId, visitId } = useLocalSearchParams<{ jobId: string; visitId?: string }>(); const router = useRouter(); const t = useT();
  const { preferences, bootstrap } = useSession();
  const remote = useRemote(getJobWindowsRoute, { params: { j: jobId ?? "" } }, { enabled: !!jobId });
  const command = useCommand(confirmVisitWindowRoute);
  const [selection, setSelection] = useState<string | null>(null); const [taken, setTaken] = useState(false);
  const data = remote.data; const visit = currentVisit(data, visitId);
  useEffect(() => { if (visit?.offeredWindows.length === 1 && !taken) setSelection(visit.offeredWindows[0]!.id); }, [visit?.id, visit?.revision, taken]);
  const [openingChat, setOpeningChat] = useState(false);
  const chat = useRemote(getJobRoute, { params: { j: jobId ?? "" }, query: { view: "whole" } }, { enabled: !!jobId && openingChat });
  useEffect(() => {
    if (!openingChat || chat.status !== "ready") return;
    const thread = chat.data.audience === "customer" && chat.data.job.view === "whole" ? chat.data.job.chatThreadId : null;
    setOpeningChat(false);
    if (thread) router.push(`/threads/${thread}` as Href);
    else router.push(`/c/jobs/${jobId}` as Href);
  }, [openingChat, chat.status, chat.data, jobId, router]);
  useEffect(() => { if (openingChat && (chat.status === "error" || chat.status === "offline")) setOpeningChat(false); }, [openingChat, chat.status]);
  const selected = visit?.offeredWindows.find(w => w.id === selection);
  function confirm() {
    if (!data || !visit || !selected || !selected.confirmationMode || command.state === "checking" || command.state === "sending") return;
    confirmAction(router, { title: visit.bookedWindow ? t("mobile.visitWindow.accept") : t("mobile.visitWindow.confirm"), actionLabel: visit.bookedWindow ? t("mobile.visitWindow.accept") : t("mobile.visitWindow.confirm"), actionLabelKey: visit.bookedWindow ? "mobile.visitWindow.accept" : "mobile.visitWindow.confirm", item: `${data.job.reference} · ${data.job.title}`, actor: bootstrap?.account.displayName ?? "", role: data.foremanName ?? t("mobile.visitWindow.provider"), effects: [visit.bookedWindow ? t("mobile.visitWindow.keep") : t("mobile.visitWindow.freeChange")], onReview: () => { void remote.refresh(); }, onConfirm: async () => {
      const result = await command.run({ params: { id: selected.id }, body: { expectedRevision: visit.revision, payload: { approvedQuoteVersionId: data.approvedQuote?.id ?? null } } });
      if (result.ok) { setSelection(null); await remote.refresh(); return "confirmed"; }
      if (result.error.code === "CONFLICT" || result.error.code === "STALE_REVISION" || result.error.code === "NOT_FOUND") { setSelection(null); setTaken(true); await remote.refresh(); return "invalidated"; }
      if (result.error.code === "INTERNAL_ERROR" || ("delivery" in result.error && result.error.delivery === "unknown")) { await remote.refresh(); return "uncertain"; }
      return "invalidated";
    } });
  }
  return <WindowView data={data} visitId={visitId} status={remote.status} selection={selection} taken={taken} commandState={command.state} twoClock={preferences?.twoClock ?? false} onSelect={id => { setTaken(false); setSelection(id); }} onConfirm={confirm} onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} onManage={() => router.push({ pathname: "/c/jobs/[jobId]/cancel", params: { jobId: jobId ?? "", ...(visit ? { visitId: visit.id } : {}) } } as Href)} onMessage={() => setOpeningChat(true)} />;
}

export function WindowView({ data, visitId, status, selection, taken = false, commandState = "idle", twoClock, viewerZone, onSelect, onConfirm, onBack, onRetry, onManage, onMessage }: { data: JobWindows | null; visitId?: string; status: RemoteStatus; selection: string | null; taken?: boolean; commandState?: CommandStatus; twoClock: boolean; viewerZone?: string; onSelect: (id: string) => void; onConfirm: () => void; onBack: () => void; onRetry: () => void; onManage: () => void; onMessage: () => void }) {
  const t = useT(); const format = useFormat(); const { color, radius, space } = useBeaconTheme();
  const visit = currentVisit(data, visitId); const windows = visit?.offeredWindows ?? []; const selected = windows.find(w => w.id === selection); const booked = visit?.bookedWindow;
  const agenda = useRef<ComponentRef<typeof ScrollView>>(null); const offsets = useRef<Record<string, number>>({});
  const { locale } = useLocale();
  const days = new Map<string, typeof windows>();
  if (data) {
    const date = new Intl.DateTimeFormat(locale, { timeZone: data.siteZone, weekday: "long", day: "numeric", month: "long", year: "numeric" });
    for (const window of [...windows].sort((a, b) => a.startsAt - b.startsAt)) {
      const day = date.format(window.startsAt);
      const list = days.get(day) ?? [];
      list.push(window);
      days.set(day, list);
    }
  }
  const finished = !!booked && windows.length === 0; const busy = commandState === "checking" || commandState === "sending";
  const confirmedAt = booked ? format.siteTime(booked.confirmedAt, data?.siteZone) : null;
  const dock = data && visit ? <Dock primary={windows.length ? { label: booked ? t("mobile.visitWindow.accept") : t("mobile.visitWindow.confirm"), onPress: onConfirm, disabled: !selected?.confirmationMode || busy, busy: commandState === "sending" } : { label: t("mobile.visitWindow.message"), onPress: onMessage }} context={selected ? t("mobile.visitWindow.freeChange") : windows.length ? t("mobile.visitWindow.heading") : undefined} /> : undefined;
  return <Screen title={t("mobile.visitWindow.title")} navigation={{ kind: "back", label: t("mobile.visitWindow.back"), onPress: onBack }} dock={dock}>
    {data && <Copy variant="supporting">{data.job.reference} · {data.job.title}</Copy>}
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.visitWindow.loading")}</Copy>}
    {(status === "error" || status === "offline") && <><Copy>{t("mobile.visitWindow.unavailable")}</Copy><Button variant="neutral" label={t("mobile.visitWindow.retry")} onPress={onRetry} /></>}
    {data?.approvedQuote && <Badge tone="success" label={t("mobile.visitWindow.quote", { number: data.approvedQuote.number, amount: format.money(data.approvedQuote.totalMinor, data.approvedQuote.currency) })} />}
    {taken && <Copy accessibilityLiveRegion="polite">{t("mobile.visitWindow.taken")}</Copy>}
    {commandState === "checking" && <Copy accessibilityLiveRegion="polite">{t("mobile.visitWindow.checking")}</Copy>}
    {commandState === "failed" && <Copy accessibilityLiveRegion="polite">{t("mobile.visitWindow.failed")}</Copy>}
    {booked && <Card><Copy variant="label">{booked.crewAvailability === "no_crew_available" ? t("mobile.visitWindow.agreed") : finished ? `${t("mobile.visitWindow.confirmed")}${confirmedAt?.kind === "available" ? ` · ${confirmedAt.siteTime}` : ""}` : t("mobile.visitWindow.current")}</Copy><WindowTime start={booked.startsAt} end={booked.endsAt} zone={data!.siteZone} twoClock={twoClock} viewerZone={viewerZone} /></Card>}
    {windows.length > 0 && <><Copy variant="sectionTitle">{booked ? t("mobile.visitWindow.proposed") : t("mobile.visitWindow.heading")}</Copy><Copy variant="supporting">{t("mobile.visitWindow.clockRule")}</Copy>
      {windows.length > 6 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.grid[2] }}>{Array.from(days.keys(), day => <Button key={day} variant="neutral" label={day} onPress={() => agenda.current?.scrollTo({ y: offsets.current[day] ?? 0, animated: true })} />)}</ScrollView>}
      <ScrollView ref={agenda} nestedScrollEnabled scrollEnabled={windows.length > 6} style={windows.length > 6 ? { maxHeight: 520 } : undefined}><View accessibilityRole="radiogroup" style={{ gap: space.grid[3] }}>{Array.from(days, ([day, items]) => <View key={day} onLayout={event => { offsets.current[day] = event.nativeEvent.layout.y; }} style={{ gap: space.grid[3] }}><Copy variant="label">{day}</Copy>{items.map(w => <Pressable key={w.id} accessibilityRole="radio" aria-checked={w.id === selection} accessibilityState={{ checked: w.id === selection, disabled: !w.confirmationMode }} disabled={!w.confirmationMode} onPress={() => onSelect(w.id)} style={{ borderColor: w.id === selection ? color.ink : color.outline, borderWidth: w.id === selection ? 2 : 1, borderRadius: radius.input, backgroundColor: color.surface, padding: space.grid[4], gap: space.grid[2] }}><WindowTime start={w.startsAt} end={w.endsAt} zone={data!.siteZone} twoClock={twoClock} viewerZone={viewerZone} />{w.id === selection && <Copy variant="label">✓ {t("mobile.visitWindow.chosen")}</Copy>}{!w.confirmationMode && <Copy>{t("mobile.visitWindow.needsAgreement")}</Copy>}</Pressable>)}</View>)}</View></ScrollView><Copy variant="supporting">{t("mobile.visitWindow.arrival")}</Copy></>}
    {data && !visit && <Copy>{t("mobile.visitWindow.unavailable")}</Copy>}
    {data && visit && !booked && windows.length === 0 && <Card><Copy variant="sectionTitle">{t("mobile.visitWindow.none")}</Copy><Copy>{t("mobile.visitWindow.proposeLater")}</Copy></Card>}
    {booked && <><Copy>{t("mobile.visitWindow.keep")}</Copy><Button variant="quiet" label={finished ? t("mobile.visitWindow.manage") : t("mobile.visitWindow.another")} onPress={onManage} /></>}
  </Screen>;
}
