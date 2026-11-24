import type { BusinessSchedule } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useState } from "react";
import { View, useWindowDimensions, type DimensionValue } from "react-native";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useLocale, useT } from "../../i18n";
import { Button, Card, Dock, Screen, StatusBanner, TextField } from "../../ui/controls";
import { Copy, Target, controlMetrics } from "../../ui/controls/shared";
import { TwoClock } from "../../ui/live/TwoClock";
import { useBeaconTheme } from "../../ui/theme";
import { NativePicker } from "../w-08/NativePicker";
import { wallInstant } from "../w-08/Screen";
import { foremanWindow } from "./clock";

export type Window = { id: string; startsAt: number; endsAt: number };
type Capacity = { free: number; total: number } | null;
type Day = Extract<BusinessSchedule["capacity"], { state: "ready" }>["days"][number];
type Proposed = { window: Window; date: string; capacity: Capacity };
type Props = {
  data: BusinessSchedule | null; now?: number; status: RemoteStatus; windows: Window[];
  capacity: (window: Window) => Capacity; busy: boolean; checking: boolean; failed: boolean;
  onBack: () => void; onRetry: () => void; onWeek: (delta: number) => void;
  onWindows: (windows: Window[]) => void; onSend: () => void;
};
const axisHours = [8, 10, 12, 14, 16, 18];
const noDays: readonly Day[] = [];
const row = { flexDirection: "row" as const, alignItems: "center" as const };

export function ScheduleView(p: Props) {
  const t = useT(); const format = useFormat(); const { locale } = useLocale();
  const { color, field, radius, space } = useBeaconTheme();
  const { fontScale } = useWindowDimensions();
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [changing, setChanging] = useState(false);
  const [editor, setEditor] = useState(false);
  const d = p.data;
  const booked = d?.visit?.bookedWindow;
  const revised = booked?.crewAvailability === "no_crew_available";
  const agreed = !!booked && !revised && !changing;
  const now = p.now ?? Date.now();
  const days = d?.capacity.state === "ready" ? d.capacity.days : noDays;
  const dateKey = new Intl.DateTimeFormat("sv-SE", { timeZone: d?.siteZone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  const today = dateKey.format(now);
  const offered = d?.visit?.offeredWindows ?? [];
  const proposed = p.windows.map(window => ({ window, date: dateKey.format(window.startsAt), capacity: p.capacity(window) }));
  const selected = days.find(day => day.date === date) ?? days.find(day => day.date === proposed[0]?.date) ?? days.find(day => day.date === today) ?? days[0];
  const shortDay = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short" });
  const numberDay = new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric" });
  const fullDay = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
  const month = new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long", year: "numeric" });
  const zoneAt = d ? format.siteTime(now, d.siteZone) : null;
  const zoneLabel = zoneAt?.kind === "available" && d ? format.zoneLabel(d.siteZone, zoneAt.site) : "";
  const conflict = proposed.some(item => item.capacity?.free === 0);
  const unknown = proposed.some(item => item.capacity === null);
  const disabled = !d?.approvedQuote || !proposed.length || p.busy || p.status !== "ready" || conflict || unknown || proposed.some(item => item.window.startsAt <= now);
  const context = conflict ? t("mobile.crewSchedule.conflictWindow") : unknown || d?.capacity.state === "unavailable" ? t("mobile.crewSchedule.capacityUnknown") : revised ? t("mobile.crewSchedule.bookingRemains") : t("mobile.crewSchedule.proposalEffect");

  function add() {
    if (!d) return;
    const a = wallInstant(date, start, d.siteZone);
    const b = wallInstant(date, end, d.siteZone);
    if (a === null || b === null || a >= b || a <= now) { setInvalid(true); return; }
    const window = { id: uuid.v4(), startsAt: a, endsAt: b };
    p.onWindows(booked ? [window] : [...p.windows, window]);
    setInvalid(false); setEditor(false);
  }

  function showWindow(window: Window, hero = false) {
    if (!d) return null;
    const timing = foremanWindow(format, window, d.siteZone, d.customerZone);
    return timing && <>
      {timing.date && <Copy variant="supporting" style={{ color: color.muted }}>{timing.date}</Copy>}
      <TwoClock size={hero ? "hero" : "standard"} siteTime={timing.time} siteZone={timing.zone}
        viewerLine={timing.customerTime ? t("mobile.crewSchedule.customerClock", { time: timing.customerTime }) : undefined} />
    </>;
  }

  return <Screen title={t("mobile.crewSchedule.schedule")} subtitle={d ? `${d.job.reference} · ${d.job.title}` : undefined}
    navigation={{ kind: "back", label: t("mobile.crewSchedule.back"), onPress: p.onBack }}
    dock={d && !agreed ? <Dock context={context} primary={{ label: revised ? t("mobile.crewSchedule.newVisit") : proposed.length ? t("mobile.crewSchedule.sendWindowCount", { count: proposed.length }) : t("mobile.crewSchedule.sendWindows"), live: !!revised, onPress: p.onSend, disabled, busy: p.busy && !p.checking }} /> : undefined}>
    {(p.status === "idle" || p.status === "loading") && <Copy>{t("mobile.crewSchedule.loading")}</Copy>}
    {p.status === "error" && <StatusBanner state="not-sent" label={t("mobile.crewSchedule.error")} action={{ label: t("mobile.crewSchedule.retry"), onPress: p.onRetry }} />}
    {p.status === "offline" && <StatusBanner state="offline" label={t("mobile.crewSchedule.offline")} />}
    {d && <>
      {revised ? <StatusBanner state="not-sent" label={t("mobile.crewSchedule.revised")} /> : !booked && d.approvedQuote && !offered.length && <View style={{ padding: space.grid[3], backgroundColor: color.successSoft, borderRadius: radius.pill }}>
        <Copy variant="supporting" style={{ color: color.successInk }}>{t("mobile.crewSchedule.quoteApproved", { version: d.approvedQuote.number })}</Copy>
      </View>}
      {changing && <StatusBanner state="last-confirmed" label={t("mobile.crewSchedule.bookingRemains")} />}
      {booked && <Card dense>
        <Copy variant="label">{revised ? t("mobile.crewSchedule.oldWindow") : t("mobile.crewSchedule.booked")}</Copy>
        {showWindow(booked)}
        {revised && <Copy variant="supporting" style={{ color: color.criticalInk }}>{t("mobile.crewSchedule.cannotGoAhead")}</Copy>}
        {agreed && d.bookedByName && <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.crewSchedule.bookedBy", { name: d.bookedByName })}</Copy>}
        {agreed && <Button variant="quiet" label={t("mobile.crewSchedule.change")} onPress={() => setChanging(true)} />}
      </Card>}
      {!!offered.length && <Card dense><Copy variant="label">{t("mobile.crewSchedule.waitingCustomer")}</Copy>
        {offered.map(window => <View key={window.id}>{showWindow(window)}</View>)}
      </Card>}
      {!agreed && <>
        {d.capacity.state === "unavailable" ? <Copy>{t("mobile.crewSchedule.capacityUnknown")}</Copy> : selected && (!revised || editor || !proposed.length) && <>
          <View style={{ gap: space.grid[2] }}>
            <View style={[row, { flexWrap: "wrap" }]}>
              <Button variant="navigation" arrow="back" iconOnly label={t("mobile.crewSchedule.previous")} onPress={() => p.onWeek(-1)} />
              <View style={{ flex: 1, minWidth: 0 }}><Copy variant="label">{month.format(Date.parse(`${selected.date}T12:00:00Z`))}</Copy><Copy variant="supporting" style={{ color: color.muted }}>{zoneLabel}</Copy></View>
              <Button variant="navigation" arrow="next" iconOnly label={t("mobile.crewSchedule.next")} onPress={() => p.onWeek(1)} />
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.grid[1] }}>
              {days.map(day => {
                const active = selected.date === day.date;
                const currentDay = today === day.date;
                const hasWindow = proposed.some(item => item.date === day.date);
                const at = Date.parse(`${day.date}T12:00:00Z`);
                const ink = active ? color.onBrand : color.ink;
                return <Target key={day.date} accessibilityRole="button" accessibilityState={{ selected: active }}
                  accessibilityLabel={hasWindow ? t("mobile.crewSchedule.dayWithWindow", { day: fullDay.format(at) }) : fullDay.format(at)}
                  onPress={() => setDate(day.date)}
                  style={{ flex: 1, minWidth: fontScale >= 1.25 ? 72 : 44, minHeight: controlMetrics(field).rowMinHeight, paddingVertical: space.grid[1], justifyContent: "center", alignItems: "center", borderRadius: radius.input, borderWidth: currentDay && !active ? 2 : 0, borderColor: color.ink, backgroundColor: active ? color.brand : currentDay ? color.surface : color.subtle }}>
                  <Copy variant="caption" style={{ color: ink }}>{shortDay.format(at)}</Copy>
                  <Copy variant="label" style={{ color: ink }}>{numberDay.format(at)}</Copy>
                  <View aria-hidden style={{ backgroundColor: hasWindow ? ink : "transparent", width: 4, height: 4, borderRadius: 2 }} />
                </Target>;
              })}
            </View>
          </View>
          <ScheduleDay day={selected} zone={d.siteZone} windows={proposed.filter(item => item.date === selected.date)} />
        </>}
        {!!proposed.length && <Card dense>
          {revised && <Copy variant="label">{t("mobile.crewSchedule.proposedWindow")}</Copy>}
          {proposed.map(({ window, capacity }, index) => {
            const timing = revised ? null : foremanWindow(format, window, d.siteZone, d.customerZone);
            return <View key={window.id} style={[row, { gap: space.grid[2], borderTopWidth: index ? 1 : 0, borderColor: color.separator, paddingTop: index ? space.grid[2] : 0 }]}>
              <View style={{ flex: 1, minWidth: 0, gap: space.grid[1] }}>
                {revised ? showWindow(window, true) : timing && <>
                  <Copy variant="label" style={{ fontVariant: ["tabular-nums"] }}>{[timing.date, timing.time, !selected && timing.zone].filter(Boolean).join(" · ")}</Copy>
                  {!!timing.customerTime && <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.crewSchedule.customerClock", { time: timing.customerTime })}</Copy>}
                </>}
                <Copy variant="supporting" style={{ color: capacity?.free === 0 ? color.criticalInk : capacity ? color.successInk : color.muted }}>
                  {capacity ? t("mobile.crewSchedule.freeCount", capacity) : t("mobile.crewSchedule.capacityUnknown")}
                </Copy>
                {capacity?.free === 0 && <Copy variant="supporting" style={{ color: color.criticalInk }}>{t("mobile.crewSchedule.conflictWindow")}</Copy>}
              </View>
              <Button label={t("mobile.crewSchedule.remove")} variant="navigation" glyph="×" iconOnly onPress={() => p.onWindows(p.windows.filter(x => x.id !== window.id))} />
            </View>;
          })}
          {revised && d.approvedQuote && <Copy variant="supporting">{t("mobile.crewSchedule.quoteUnchanged", { version: d.approvedQuote.number })}</Copy>}
        </Card>}
        {editor ? <Card dense>
          <TextField label={t("mobile.crewSchedule.date")} helper={t("mobile.crewSchedule.dateHint")} value={date} onChangeText={setDate} />
          <NativePicker label={t("mobile.crewSchedule.date")} mode="date" date={date} time={start} zone={d.siteZone} onChange={setDate} />
          <TextField label={t("mobile.crewSchedule.start")} helper={t("mobile.crewSchedule.timeHint")} value={start} onChangeText={setStart} />
          <NativePicker label={t("mobile.crewSchedule.start")} mode="time" date={date} time={start} zone={d.siteZone} onChange={setStart} />
          <TextField label={t("mobile.crewSchedule.end")} helper={t("mobile.crewSchedule.timeHint")} value={end} onChangeText={setEnd} />
          <NativePicker label={t("mobile.crewSchedule.end")} mode="time" date={date} time={end} zone={d.siteZone} onChange={setEnd} />
          {invalid && <Copy accessibilityRole="alert" style={{ color: color.criticalInk }}>{t("mobile.crewSchedule.invalidTime")}</Copy>}
          <Button variant="neutral" label={t("mobile.crewSchedule.addWindow")} onPress={add} />
          <Button variant="quiet" label={t("mobile.crewSchedule.cancel")} onPress={() => { setEditor(false); setInvalid(false); }} />
        </Card> : <View style={{ alignItems: "flex-start" }}><Button variant="quiet" glyph="+" label={t("mobile.crewSchedule.addWindow")} onPress={() => { setDate(selected?.date ?? today); setEditor(true); }} /></View>}
      </>}
      {p.checking && <Copy accessibilityLiveRegion="polite">{t("mobile.crewSchedule.checking")}</Copy>}
      {p.failed && !p.checking && <StatusBanner state="not-sent" label={t("mobile.crewSchedule.saveFailed")} />}
    </>}
  </Screen>;
}

function ScheduleDay({ day, zone, windows }: { day: Day; zone: string; windows: Proposed[] }) {
  const t = useT(); const format = useFormat(); const { locale } = useLocale();
  const { color, radius, space } = useBeaconTheme();
  const { fontScale } = useWindowDimensions();
  const axisStart = wallInstant(day.date, "08:00", zone);
  const axisEnd = wallInstant(day.date, "18:00", zone);
  const axisDuration = axisStart !== null && axisEnd !== null ? axisEnd - axisStart : 0;
  const displayDate = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(Date.parse(`${day.date}T12:00:00Z`));
  const displayHour = new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 });
  const agenda = fontScale >= 1.25 || !axisDuration || !day.lanes.length;

  function blockStyle(span: { startsAt: number; endsAt: number }) {
    if (axisStart === null || axisEnd === null || !axisDuration) return null;
    const a = Math.max(span.startsAt, axisStart), b = Math.min(span.endsAt, axisEnd);
    if (a >= b) return null;
    return { left: `${100 * (a - axisStart) / axisDuration}%` as DimensionValue, width: `${100 * (b - a) / axisDuration}%` as DimensionValue };
  }
  return <Card dense>
    <View style={[row, { flexWrap: "wrap", justifyContent: "space-between", gap: space.grid[1] }]}>
      <Copy variant="label">{displayDate}</Copy>
      <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.crewSchedule.eligibleCrew", { count: day.lanes.length })}</Copy>
    </View>
    {!agenda && <View aria-hidden style={{ flexDirection: "row", justifyContent: "space-between", paddingStart: 40, direction: "ltr" }}>
      {axisHours.map(hour => <Copy key={hour} variant="caption" style={{ color: color.muted }}>{displayHour.format(hour)}</Copy>)}
    </View>}
    {day.lanes.map((lane, i) => {
      const busy = lane.busy.map(span => foremanWindow(format, span, zone)?.time).filter(Boolean).join(", ");
      const label = busy ? `${lane.displayName} · ${t("mobile.crewSchedule.busy")} ${busy}` : lane.displayName;
      if (agenda) return <Copy key={lane.membershipId} variant="supporting">{label}</Copy>;
      return <View key={lane.membershipId} accessible accessibilityLabel={label} style={[row, { gap: space.grid[2] }]}>
        <View aria-hidden style={{ width: 32, height: 32, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: [color.personA, color.personB, color.personC, color.personD][i % 4] }}>
          <Copy variant="caption">{lane.displayName.trim().split(/\s+/).slice(0, 2).map(name => name[0]).join("")}</Copy>
        </View>
        <View aria-hidden style={{ flex: 1, minHeight: 28, backgroundColor: color.subtle, borderRadius: radius.smallTile, overflow: "hidden", direction: "ltr" }}>
          {lane.available.map(span => {
            const position = blockStyle(span);
            return position && <View key={span.startsAt} style={[position, { position: "absolute", top: 0, bottom: 0, backgroundColor: color.surface, borderRadius: radius.smallTile }]} />;
          })}
          {lane.busy.map(span => {
            const position = blockStyle(span);
            return position && <View key={span.startsAt} style={[position, { position: "absolute", top: 0, bottom: 0, borderWidth: 1, borderColor: color.outline, borderRadius: radius.smallTile, backgroundColor: color.subtle }]} />;
          })}
          {windows.map(({ window, capacity }) => {
            const position = blockStyle(window);
            const conflict = capacity?.free === 0;
            const busy = lane.busy.some(span => span.startsAt < window.endsAt && span.endsAt > window.startsAt);
            return position && <View key={window.id} style={[position, { position: "absolute", top: 0, bottom: 0, borderWidth: 2, borderColor: conflict ? color.criticalInk : color.infoInk, backgroundColor: busy ? "transparent" : conflict ? color.criticalSoft : color.infoSoft, borderRadius: radius.smallTile }]} />;
          })}
        </View>
      </View>;
    })}
    {!agenda && <View style={[row, { flexWrap: "wrap", gap: space.grid[3] }]}>
      <Copy variant="caption" style={{ color: color.muted }}>■ {t("mobile.crewSchedule.busy")}</Copy>
      <Copy variant="caption" style={{ color: color.infoInk }}>▧ {t("mobile.crewSchedule.proposedWindow")}</Copy>
    </View>}
  </Card>;
}
