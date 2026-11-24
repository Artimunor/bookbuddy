import { departAssignmentRoute } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { useCommand } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useAttendanceStatus } from "../../repository/hooks";
import { useSession } from "../../session";
import { Button, Card, Dock, Sheet, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { BeaconThemeProvider, useBeaconTheme } from "../../ui/theme";
import { siteWindow } from "../c-01/clock";
import { wallInstant } from "../w-08/Screen";
import { NativePicker } from "../w-08/NativePicker";
import { LiveShiftView, useFieldShift, type FieldShift } from "../w-04/Screen";

type Band = { startsAt: number; endsAt: number };
export default function DepartScreen() { return <BeaconThemeProvider field><DepartRoute /></BeaconThemeProvider>; }
function DepartRoute() {
  const f = useFieldShift(); const router = useRouter(); const attendance = useAttendanceStatus(f.assignmentId); const command = useCommand(departAssignmentRoute);
  const { bootstrap } = useSession();
  const viewerZone = bootstrap?.preferences.twoClock ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const back = () => router.canGoBack() ? router.back() : router.replace(`/w/shifts/${f.shiftId}?assignmentId=${encodeURIComponent(f.assignmentId)}` as Href);
  async function send(band: Band) {
    if (!f.data || f.offline || f.data.state !== "confirmed" || attendance.arrival || f.data.attendance.arrival || command.state === "sending" || command.state === "checking" || band.endsAt <= Date.now()) return;
    const result = await command.run({ params: { id: f.assignmentId }, body: { payload: { id: uuid.v4(), band, expectedAudience: f.data.isLead ? "crew_and_customer" : "crew_only" } } });
    if (result.ok) await f.refresh();
  }
  return <><LiveShiftView {...f} attendance={attendance} onBack={back} onNavigate={path => router.push(path as Href)} onRetry={() => void f.refresh()} /><DepartSheet data={f.data} offline={f.offline} arrived={!!(attendance.arrival || f.data?.attendance.arrival)} commandState={command.state} receipt={command.result} onSend={band => void send(band)} onClose={back} now={Date.now()} viewerZone={viewerZone} /></>;
}
export function DepartSheet({ data, offline, arrived, commandState, receipt, onSend, onClose, now, viewerZone }: { data: FieldShift | null; offline: boolean; arrived: boolean; commandState: string; receipt: { at: number } | null; onSend: (band: Band) => void; onClose: () => void; now: number; viewerZone?: string }) {
  const t = useT(); const format = useFormat(); const { color, radius, space } = useBeaconTheme(); const { fontScale } = useWindowDimensions();
  const [minutes, setMinutes] = useState(15); const [other, setOther] = useState(false); const [custom, setCustom] = useState(""); const [base] = useState(() => Math.floor(now / 300000) * 300000);
  const zone = data?.siteZone ?? "UTC";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`; const customAt = other ? wallInstant(date, custom, zone) : null; const center = other ? customAt : base + minutes * 60000;
  const band = center === null ? null : { startsAt: center - 5 * 60000, endsAt: center + 5 * 60000 };
  const clock = (window: Band) => siteWindow(format, window.startsAt, window.endsAt, zone, viewerZone);
  const estimate = band && clock(band);
  const booked = data && clock(data.bookedWindow);
  const previous = data?.estimate && clock(data.estimate.band);
  const busy = commandState === "sending" || commandState === "checking"; const sent = !!receipt && commandState === "done";
  const eligible = !!data && data.state === "confirmed" && !offline && !arrived && !busy && !sent && !!band && band.endsAt > now && (!other || (customAt !== null && customAt > now));
  return <Sheet visible title={t("mobile.briefing.depart")} closeLabel={t("mobile.liveShift.close")} onClose={onClose} dock={<Dock context={offline ? t("mobile.briefing.notSent") : undefined} primary={sent ? { label: t("mobile.liveShift.backToShift"), onPress: onClose } : { label: data?.estimate ? t("mobile.briefing.sendUpdate") : t("mobile.briefing.sendWay"), onPress: () => { if (band) onSend(band); }, disabled: !eligible, busy, live: true }} />}>
    {!data && <Copy>{t("mobile.liveShift.unavailable")}</Copy>}
    {data && <>
      <View style={{ gap: space.grid[1] }}>
        <Copy variant="label">{data.job.reference} · {data.job.title ?? data.task}</Copy>
        {booked && <Copy variant="supporting" style={{ color: color.muted }}>{[booked.date, booked.time, booked.zone].filter(Boolean).join(" · ")}</Copy>}
        {booked?.viewer && <Copy variant="supporting" style={{ color: color.muted }}>{booked.viewer}</Copy>}
      </View>
      {previous && !arrived && <Copy>{t("mobile.briefing.previous", { band: `${previous.time} · ${previous.zone}` })}</Copy>}
      <Copy variant="label">{t("mobile.briefing.estimate")}</Copy>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("mobile.briefing.estimate")} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.grid[4] }}>
        {[10, 15, 20, 30].map(n => {
          const option = clock({ startsAt: base + (n - 5) * 60000, endsAt: base + (n + 5) * 60000 });
          if (!option) return null;
          const selected = !other && n === minutes;
          const disabled = busy || sent;
          const ink = selected ? color.onBrand : color.ink;
          const duration = t("mobile.briefing.minutes", { minutes: n });
          return <Pressable key={n} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }}
            accessibilityLabel={`${option.time} · ${option.zone} · ${duration}`}
            disabled={disabled} onPress={() => { setMinutes(n); setOther(false); }}
            style={{ minHeight: 64, flexBasis: fontScale >= 1.5 ? "100%" : "45%", flexGrow: 1, padding: space.grid[3], justifyContent: "center", borderWidth: 2, borderColor: selected ? color.brand : color.outline, borderRadius: radius.input, backgroundColor: selected ? color.brand : color.surface }}>
            <Copy variant="label" style={{ color: ink, fontVariant: ["tabular-nums"] }}>{option.time}{selected ? " ✓" : ""}</Copy>
            <Copy variant="supporting" style={{ color: selected ? ink : color.muted }}>{duration}</Copy>
          </Pressable>;
        })}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
        <Button variant="quiet" label={t("mobile.briefing.otherTime")} onPress={() => setOther(value => !value)} disabled={busy || sent} />
        {booked && <Copy variant="supporting" style={{ color: color.muted }}>{booked.zone}</Copy>}
      </View>
    {other && <><TextField label={t("mobile.briefing.enterTime")} value={custom} onChangeText={setCustom} /><NativePicker label={t("mobile.briefing.enterTime")} mode="time" date={date} time={custom} zone={zone} onChange={setCustom} />{(!customAt || customAt <= now) && <Copy>{t("mobile.briefing.invalidTime")}</Copy>}</>}
    {estimate && <Card dense><Copy>{data.isLead ? t("mobile.briefing.customer", { name: data.foremanName, band: `${estimate.time} · ${estimate.zone}` }) : t("mobile.briefing.internal", { name: data.foremanName })}</Copy>{estimate.viewer && <Copy variant="supporting">{estimate.viewer}</Copy>}</Card>}
    <View style={{ backgroundColor: color.successSoft, borderRadius: radius.input, padding: space.grid[3] }}><Copy variant="supporting" style={{ color: color.successInk }}>{t("mobile.briefing.noLocation")}</Copy></View></>}
    {commandState === "checking" && <Copy>{t("mobile.briefing.checking")}</Copy>}{(commandState === "failed" || commandState === "conflict") && <Copy>{t("mobile.briefing.failed")}</Copy>}{sent && receipt && <Copy>{t("mobile.briefing.sent", { time: format.lines(receipt.at, zone)?.site ?? "" })}</Copy>}
  </Sheet>;
}
