import { getCrewAvailabilityRoute, linkTokenSchema, openLinkRoute, patchCrewAvailabilityRoute, type CrewAvailability } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useFormat, useLocale, useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Button, Card, Dock, ListRow, Screen, SegmentedControl, StatusBanner, SwitchRow, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { siteWindow } from "../c-01/clock";
import { NativePicker } from "./NativePicker";

type Day = CrewAvailability["days"][number];
type Status = "idle" | "loading" | "ready" | "error" | "offline";
// Reject nonexistent and repeated wall times rather than silently selecting an offset.
export function wallInstant(date: string, time: string, zone: string): number | null {
  if (!/^\d{4}-\d\d-\d\d$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const target = Date.parse(`${date}T${time}:00Z`); if (!Number.isFinite(target)) return null;
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = (at: number) => Object.fromEntries(fmt.formatToParts(at).map(x => [x.type, x.value]));
  const offsets = new Set([-86400000, 0, 86400000].map(delta => { const at = target + delta; const p = parts(at); return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - at; }));
  const matches = [...offsets].map(offset => target - offset).filter(at => { const p = parts(at); return `${p.year}-${p.month}-${p.day}` === date && `${p.hour}:${p.minute}` === time; });
  return matches.length === 1 ? matches[0]! : null;
}
function addDays(date: string, days: number) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function wallTime(at: number, zone: string) { return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at); }
export default function AvailabilityScreen() {
  const { session } = useSession(); const context = session?.activeContext;
  const member = context && "membershipId" in context && typeof context.membershipId === "string" ? context.membershipId : "";
  const { date, opaque } = useLocalSearchParams<{ date?: string; opaque?: string }>();
  const parsedDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T12:00:00Z`) : NaN;
  const target = Number.isFinite(parsedDate) && new Date(parsedDate).toISOString().slice(0, 10) === date ? date : undefined;
  const [week, setWeek] = useState<string | undefined>(target); const [selected, setSelected] = useState<string | null>(target ?? null);
  const [edit, setEdit] = useState<{ date: string; kind: "available" | "unavailable"; start: string; end: string; cover: boolean } | null>(null);
  const [linkConsumed, setLinkConsumed] = useState(false);
  const [appliedRoute, setAppliedRoute] = useState({ target, opaque });
  const [refreshAfterSave, setRefreshAfterSave] = useState(false);
  useEffect(() => { setWeek(target); setSelected(target ?? null); setEdit(null); setLinkConsumed(false); setRefreshAfterSave(false); setAppliedRoute({ target, opaque }); }, [target, opaque]);
  const [invalid, setInvalid] = useState(false);
  const token = linkTokenSchema.safeParse(opaque);
  const routeSettled = appliedRoute.target === target && appliedRoute.opaque === opaque;
  const linked = routeSettled && !!target && week === target && typeof opaque === "string" && !linkConsumed;
  const opening = useRemote(openLinkRoute, { params: { opaque: token.success ? token.data : "" } }, { enabled: routeSettled && !!member && linked && token.success });
  const direct = useRemote(getCrewAvailabilityRoute, { params: { member }, query: { weekOf: week } }, { enabled: routeSettled && !!member && (!linked || opening.status === "offline"), cache: { kind: "crew_availability" } });
  const projection = opening.status === "ready" && opening.data.kind === "crew_availability" && opening.data.date === target
    && opening.data.availability.membershipId === member && opening.data.availability.businessId === context?.businessId
    && opening.data.availability.days.some(day => day.date === target) ? opening.data.availability : null;
  const remote = linked && opening.status !== "offline"
    ? { status: !token.success || (opening.status === "ready" && !projection) ? "error" as const : opening.status, data: projection, lastConfirmedAt: opening.lastConfirmedAt, refresh: opening.refresh }
    : direct;
  useEffect(() => { if (refreshAfterSave && !linked) { setRefreshAfterSave(false); void direct.refresh(); } }, [refreshAfterSave, linked, direct.refresh]);
  const command = useCommand(patchCrewAvailabilityRoute); const router = useRouter();
  const data = refreshAfterSave ? null : remote.data; const day = data?.days.find(d => d.date === selected) ?? data?.days[0];
  const busy = command.state === "sending" || command.state === "checking";
  function begin(d: Day, kind: "available" | "unavailable") { const p = d.preference; setInvalid(false); setEdit({ date: d.date, kind, start: p.kind === "available" ? wallTime(p.hours[0]!.startsAt, data!.siteZone) : "", end: p.kind === "available" ? wallTime(p.hours[0]!.endsAt, data!.siteZone) : "", cover: p.kind === "available" && p.openToCover }); }
  async function save() {
    if (!day || !data || !edit || edit.date !== day.date || remote.status !== "ready" || busy) return;
    const basis = day.confirmedShifts.map(({ assignmentId, startsAt, endsAt }) => ({ assignmentId, startsAt, endsAt }));
    const start = wallInstant(day.date, edit.start, data.siteZone), end = wallInstant(day.date, edit.end, data.siteZone);
    const otherHours = day.preference.kind === "available" ? day.preference.hours.slice(1) : [];
    const hours = start !== null && end !== null ? [{ startsAt: start, endsAt: end }, ...otherHours].sort((a, b) => a.startsAt - b.startsAt) : [];
    if (edit.kind === "available" && (start === null || end === null || start >= end || hours.some((h, i) => i > 0 && hours[i - 1]!.endsAt > h.startsAt))) { setInvalid(true); return; }
    const payload = edit.kind === "unavailable" ? { kind: "unavailable" as const, date: day.date, expectedConfirmedShifts: basis } : { kind: "available" as const, date: day.date, expectedConfirmedShifts: basis, hours, openToCover: edit.cover };
    const result = await command.run({ params: { member }, body: { expectedRevision: day.revision, payload } });
    if (result.ok) setEdit(null);
    if (result.ok || result.error.code === "STALE_REVISION" || result.error.code === "CONFLICT") {
      if (linked) { setRefreshAfterSave(true); setLinkConsumed(true); }
      else void remote.refresh();
    }
  }
  return <AvailabilityView data={routeSettled ? data : null} day={routeSettled ? day ?? null : null} status={!member ? "error" : !routeSettled || refreshAfterSave ? "loading" : remote.status} lastConfirmedAt={remote.lastConfirmedAt} edit={edit} invalid={invalid} busy={busy} checking={command.state === "checking"} failed={command.state === "failed" || command.state === "conflict"} onBack={() => router.back()} onRetry={() => void remote.refresh()} onDay={date => { setSelected(date); setEdit(null); }} onWeek={delta => { if (data) { setLinkConsumed(true); setWeek(addDays(data.days[0]!.date, delta * 7)); setSelected(null); setEdit(null); } }} onBegin={begin} onEdit={setEdit} onSave={() => void save()} onShift={id => router.push(`/w/shifts/${id}` as Href)} />;
}
type Edit = { date: string; kind: "available" | "unavailable"; start: string; end: string; cover: boolean };
export function AvailabilityView(p: { data: CrewAvailability | null; day: Day | null; status: Status; lastConfirmedAt: number | null; edit: Edit | null; invalid: boolean; busy: boolean; checking: boolean; failed: boolean; onBack: () => void; onRetry: () => void; onDay: (date: string) => void; onWeek: (delta: number) => void; onBegin: (day: Day, kind: "available" | "unavailable") => void; onEdit: (edit: Edit | null) => void; onSave: () => void; onShift: (id: string) => void }) {
  const t = useT(); const format = useFormat(); const { locale } = useLocale(); const { color, space, radius } = useBeaconTheme(); const { fontScale } = useWindowDimensions();
  const d = p.day; const e = p.edit; const zone = p.data?.siteZone;
  const days = p.data?.days ?? [];
  const shortDate = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  const weekDate = new Intl.DateTimeFormat(locale, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
  const weekday = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short" });
  const dayNumber = new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric" });
  const first = days[0] && new Date(`${days[0].date}T12:00:00Z`);
  const last = days.at(-1);
  const confirmed = p.lastConfirmedAt != null && format.lines(p.lastConfirmedAt, zone)?.site;
  const localZone = first ? format.siteTime(first.getTime(), zone) : null;
  const zoneName = localZone?.kind === "available" ? format.zoneLabel(zone, localZone.site) : undefined;
  const pref = d?.preference;
  const saved = pref && pref.kind !== "not_set" && format.lines(pref.savedAt, zone)?.site;
  const proposedStart = d && e?.kind === "available" && zone ? wallInstant(d.date, e.start, zone) : null;
  const proposedEnd = d && e?.kind === "available" && zone ? wallInstant(d.date, e.end, zone) : null;
  const proposedHours = d?.preference.kind === "available" ? d.preference.hours.slice(1) : [];
  const conflicts = d?.confirmedShifts.filter(s => e?.kind === "unavailable" || (e?.kind === "available" && proposedStart !== null && proposedEnd !== null ? ![{ startsAt: proposedStart, endsAt: proposedEnd }, ...proposedHours].some(h => h.startsAt <= s.startsAt && h.endsAt >= s.endsAt) : s.conflictsWithPreference)) ?? [];
  return <Screen title={t("mobile.crewSchedule.availability")} subtitle={zoneName} navigation={{ kind: "back", label: t("mobile.crewSchedule.back"), onPress: p.onBack }} dock={e ? <Dock context={t("mobile.crewSchedule.saveEffect")} primary={{ label: t("mobile.crewSchedule.save"), onPress: p.onSave, disabled: p.status !== "ready" || p.busy }} /> : undefined}>
    {(p.status === "idle" || p.status === "loading") && <Copy>{t("mobile.crewSchedule.loading")}</Copy>}{p.status === "error" && <><Copy>{t("mobile.crewSchedule.error")}</Copy><Button label={t("mobile.crewSchedule.retry")} onPress={p.onRetry} /></>}
    {p.status === "offline" && <StatusBanner state="offline" label={t("mobile.crewSchedule.offline")} detail={confirmed ? t("shared.status.lastConfirmed", { time: confirmed }) : undefined} />}
    {p.data && d && zone && first && last && <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.grid[2] }}>
        <Copy variant="sectionTitle" style={{ flexGrow: 1, flexShrink: 1 }}>
          {typeof weekDate.formatRange === "function" ? weekDate.formatRange(first, new Date(`${last.date}T12:00:00Z`)) : `${shortDate.format(first)} – ${weekDate.format(new Date(`${last.date}T12:00:00Z`))}`}
        </Copy>
        <Button label={t("mobile.crewSchedule.previous")} arrow="back" iconOnly variant="neutral" onPress={() => p.onWeek(-1)} />
        <Button label={t("mobile.crewSchedule.next")} arrow="next" iconOnly variant="neutral" onPress={() => p.onWeek(1)} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.grid[1] }}>
        {days.map(day => {
          const date = new Date(`${day.date}T12:00:00Z`);
          const selected = day.date === d.date;
          const unavailable = day.preference.kind === "unavailable";
          const state = unavailable ? t("mobile.crewSchedule.unavailable") : day.preference.kind === "available" ? t("mobile.crewSchedule.available") : t("mobile.crewSchedule.notSet");
          const ink = selected ? color.onBrand : color.ink;
          return <Pressable key={day.date} accessibilityRole="button" accessibilityLabel={`${shortDate.format(date)} · ${state}`}
            accessibilityState={{ selected }} onPress={() => p.onDay(day.date)}
            style={{ flexGrow: 1, flexBasis: fontScale >= 1.5 ? "100%" : 46, minHeight: 64, padding: space.grid[1], alignItems: "center", justifyContent: "center",
              borderWidth: 1, borderColor: selected ? color.brand : color.separator, borderRadius: radius.smallTile, backgroundColor: selected ? color.brand : color.surface }}>
            <Copy variant="caption" style={{ color: ink }}>{weekday.format(date)}</Copy>
            <Copy variant="label" style={{ color: ink }}>{dayNumber.format(date)}</Copy>
            <Copy variant="caption" aria-hidden style={{ color: ink }}>{unavailable ? "×" : day.preference.kind === "available" ? "•" : " "}</Copy>
          </Pressable>;
        })}
      </View>
      <Copy variant="caption" style={{ color: color.muted }}>{t("mobile.crewSchedule.dayLegend")}</Copy>
      <Card dense>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: space.grid[2] }}>
          <Copy variant="sectionTitle">{shortDate.format(new Date(`${d.date}T12:00:00Z`))}</Copy>
          {pref?.kind !== "not_set" && <Badge label={pref?.kind === "available" ? t("mobile.crewSchedule.available") : t("mobile.crewSchedule.unavailable")} tone={pref?.kind === "available" ? "success" : "neutral"} />}
        </View>
        <SegmentedControl<Day["preference"]["kind"]> label={t("mobile.crewSchedule.preference")} hideLabel value={e?.kind ?? d.preference.kind}
          onChange={kind => { if (kind !== "not_set") p.onBegin(d, kind); }}
          options={[{ value: "available", label: t("mobile.crewSchedule.available") }, { value: "unavailable", label: t("mobile.crewSchedule.unavailable") }]} />
        {d.preference.kind === "not_set" && !e && <Copy>{t("mobile.crewSchedule.notSet")}</Copy>}
        {e?.kind === "available" && <>
          <TextField label={t("mobile.crewSchedule.start")} value={e.start} onChangeText={start => p.onEdit({ ...e, start })} helper={t("mobile.crewSchedule.timeHint")} />
          <NativePicker label={t("mobile.crewSchedule.start")} mode="time" date={d.date} time={e.start} zone={zone} onChange={start => p.onEdit({ ...e, start })} />
          <TextField label={t("mobile.crewSchedule.end")} value={e.end} onChangeText={end => p.onEdit({ ...e, end })} />
          <NativePicker label={t("mobile.crewSchedule.end")} mode="time" date={d.date} time={e.end} zone={zone} onChange={end => p.onEdit({ ...e, end })} />
          {p.invalid && <Copy>{t("mobile.crewSchedule.invalidTime")}</Copy>}
          <SwitchRow label={t("mobile.crewSchedule.cover")} value={e.cover} onValueChange={cover => p.onEdit({ ...e, cover })} />
        </>}
        {e && <Button variant="quiet" label={t("mobile.crewSchedule.cancel")} onPress={() => p.onEdit(null)} />}
        {!e && d.preference.kind === "available" && <>
          <ListRow label={t("mobile.crewSchedule.hours")} description={d.preference.hours.map(h => siteWindow(format, h.startsAt, h.endsAt, zone)?.time).filter(Boolean).join(" · ")}
            trailing={<Button label={t("mobile.crewSchedule.change")} variant="neutral" onPress={() => p.onBegin(d, "available")} />} />
          <Copy variant="supporting" style={{ color: color.muted }}>{d.preference.openToCover ? t("mobile.crewSchedule.coverOn") : t("mobile.crewSchedule.coverOff")}</Copy>
        </>}
        {d.preference.kind === "unavailable" && !e && <Copy variant="supporting">{t("mobile.crewSchedule.coverUnavailable")}</Copy>}
      </Card>
      {conflicts.length > 0 && <View style={{ backgroundColor: color.attentionSoft, borderRadius: radius.input, padding: space.grid[4], gap: space.grid[1] }}>
        <Copy variant="label" style={{ color: color.attentionInk }}>{t("mobile.crewSchedule.conflict")}</Copy>
        <Copy variant="supporting" style={{ color: color.attentionInk }}>{t("mobile.crewSchedule.shiftStillConfirmed")}</Copy>
      </View>}
      {d.confirmedShifts.length > 0 && <Card dense>
        <Copy variant="label">{t("mobile.crewSchedule.confirmedShifts")}</Copy>
        {d.confirmedShifts.map(s => {
          const clock = siteWindow(format, s.startsAt, s.endsAt, s.siteZone);
          return <ListRow key={s.shiftId} glyph="▦" label={clock?.time ?? t("mobile.crewSchedule.openShift")}
            description={[t("mobile.crewSchedule.confirmed"), clock?.zone].filter(Boolean).join(" · ")} onPress={() => p.onShift(s.shiftId)} />;
        })}
      </Card>}
      {saved && <Copy variant="supporting" style={{ color: color.muted }}>{t("shared.status.lastConfirmed", { time: saved })}</Copy>}
      <Copy>{t("mobile.crewSchedule.privacy")}</Copy>{p.checking && <Copy>{t("mobile.crewSchedule.checking")}</Copy>}{p.failed && <Copy>{t("mobile.crewSchedule.saveFailed")}</Copy>}</>}
  </Screen>;
}
