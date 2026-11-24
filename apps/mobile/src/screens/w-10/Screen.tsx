import { departAssignmentRoute } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useCommand } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useAttendanceStatus } from "../../repository/hooks";
import { Button, Card, Dock, Sheet, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { BeaconThemeProvider } from "../../ui/theme";
import { siteTime } from "../f-01/Screen";
import { wallInstant } from "../w-08/Screen";
import { NativePicker } from "../w-08/NativePicker";
import { LiveShiftView, useFieldShift, type FieldShift } from "../w-04/Screen";

type Band = { startsAt: number; endsAt: number };
export default function DepartScreen() { return <BeaconThemeProvider field><DepartRoute /></BeaconThemeProvider>; }
function DepartRoute() {
  const f = useFieldShift(); const router = useRouter(); const attendance = useAttendanceStatus(f.assignmentId); const command = useCommand(departAssignmentRoute);
  const back = () => router.canGoBack() ? router.back() : router.replace(`/w/shifts/${f.shiftId}?assignmentId=${encodeURIComponent(f.assignmentId)}` as Href);
  async function send(band: Band) {
    if (!f.data || f.offline || f.data.state !== "confirmed" || attendance.arrival || f.data.attendance.arrival || command.state === "sending" || command.state === "checking" || band.endsAt <= Date.now()) return;
    const result = await command.run({ params: { id: f.assignmentId }, body: { payload: { id: uuid.v4(), band, expectedAudience: f.data.isLead ? "crew_and_customer" : "crew_only" } } });
    if (result.ok) await f.refresh();
  }
  return <><LiveShiftView {...f} attendance={attendance} onBack={back} onNavigate={path => router.push(path as Href)} onRetry={() => void f.refresh()} /><DepartSheet data={f.data} offline={f.offline} arrived={!!(attendance.arrival || f.data?.attendance.arrival)} commandState={command.state} receipt={command.result} onSend={band => void send(band)} onClose={back} now={Date.now()} /></>;
}
export function DepartSheet({ data, offline, arrived, commandState, receipt, onSend, onClose, now }: { data: FieldShift | null; offline: boolean; arrived: boolean; commandState: string; receipt: { at: number } | null; onSend: (band: Band) => void; onClose: () => void; now: number }) {
  const t = useT(); const format = useFormat(); const [minutes, setMinutes] = useState(15); const [other, setOther] = useState(false); const [custom, setCustom] = useState(""); const [base] = useState(() => Math.floor(now / 300000) * 300000); const zone = data?.siteZone ?? "UTC";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`; const customAt = other ? wallInstant(date, custom, zone) : null; const center = other ? customAt : base + minutes * 60000;
  const band = center === null ? null : { startsAt: center - 5 * 60000, endsAt: center + 5 * 60000 }; const at = (n: number) => siteTime(format, n, zone); const range = band ? `${at(band.startsAt)} – ${at(band.endsAt)}` : ""; const busy = commandState === "sending" || commandState === "checking"; const sent = !!receipt && commandState === "done";
  const eligible = !!data && data.state === "confirmed" && !offline && !arrived && !busy && !sent && !!band && band.endsAt > now && (!other || (customAt !== null && customAt > now));
  return <Sheet visible title={t("mobile.briefing.depart")} closeLabel={t("mobile.liveShift.close")} onClose={onClose} dock={<Dock context={offline ? t("mobile.briefing.notSent") : t("mobile.briefing.noLocation")} primary={sent ? { label: t("mobile.liveShift.backToShift"), onPress: onClose } : { label: data?.estimate ? t("mobile.briefing.sendUpdate") : t("mobile.briefing.sendWay"), onPress: () => { if (band) onSend(band); }, disabled: !eligible, busy, live: true }} />}>
    {!data && <Copy>{t("mobile.liveShift.unavailable")}</Copy>}{data && <><Copy>{data.job.reference} · {data.job.title ?? data.task}</Copy><Copy>{at(data.bookedWindow.startsAt)} – {at(data.bookedWindow.endsAt)} · {zone}</Copy>{data.estimate && !arrived && <Copy>{t("mobile.briefing.previous", { band: `${at(data.estimate.band.startsAt)} – ${at(data.estimate.band.endsAt)}` })}</Copy>}<Copy variant="sectionTitle">{t("mobile.briefing.estimate")}</Copy><View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{[15, 25, 35, 45].map(n => { const label = `${at(base + (n - 5) * 60000)} – ${at(base + (n + 5) * 60000)} · ${t("mobile.briefing.minutes", { minutes: n })}`; return <Button key={n} variant={!other && n === minutes ? "primary" : "neutral"} label={!other && n === minutes ? t("mobile.briefing.selected", { band: label }) : label} onPress={() => { setMinutes(n); setOther(false); }} disabled={busy || sent} />; })}<Button variant={other ? "primary" : "neutral"} label={t("mobile.briefing.otherTime")} onPress={() => setOther(true)} disabled={busy || sent} /></View>
    {other && <><TextField label={t("mobile.briefing.enterTime")} value={custom} onChangeText={setCustom} /><NativePicker label={t("mobile.briefing.enterTime")} mode="time" date={date} time={custom} zone={zone} onChange={setCustom} />{(!customAt || customAt <= now) && <Copy>{t("mobile.briefing.invalidTime")}</Copy>}</>}
    {band && <Card><Copy>{data.isLead ? t("mobile.briefing.customer", { name: data.foremanName, band: range }) : t("mobile.briefing.internal", { name: data.foremanName })}</Copy></Card>}<Copy>{t("mobile.briefing.noLocation")}</Copy></>}
    {offline && <Copy>{t("mobile.briefing.notSent")}</Copy>}{commandState === "checking" && <Copy>{t("mobile.briefing.checking")}</Copy>}{(commandState === "failed" || commandState === "conflict") && <Copy>{t("mobile.briefing.failed")}</Copy>}{sent && receipt && <Copy>{t("mobile.briefing.sent", { time: `${at(receipt.at)} · ${zone}` })}</Copy>}
  </Sheet>;
}
