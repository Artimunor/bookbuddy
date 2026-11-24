import { dropoutAssignmentRoute, getHomeRoute, getShiftRoute, getWorkerFieldShiftRoute } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useFormat, useT } from "../../i18n";
import { Button, Card, Screen, SegmentedControl, Sheet, StatusBanner } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { siteWindow } from "../c-01/clock";
import { siteTime } from "../f-01/Screen";
import { useOffline } from "../s-02/flow";

export type DecisionMode = "decline" | "withdraw" | "dropout";
export type Reason = "busy_then" | "too_far_away" | "transport" | "another_job" | "personal" | null;
export function DecisionSheet(p: { visible: boolean; mode: DecisionMode; detail?: string; offline: boolean; busy: boolean; checking: boolean; failed: boolean; onClose: () => void; onSubmit: (reason: Reason) => void }) {
  const t = useT(); const { color, space } = useBeaconTheme(); const [reason, setReason] = useState<Reason>(null);
  const title = p.mode === "decline" ? t("mobile.workerOffer.decline") : p.mode === "withdraw" ? t("mobile.workerOffer.withdraw") : t("mobile.workerOffer.dropout");
  const keep = p.mode === "decline" ? t("mobile.workerOffer.keepOffer") : p.mode === "withdraw" ? t("mobile.workerOffer.keepPlace") : t("mobile.workerOffer.keepShift");
  const effect = p.mode === "decline" ? t("mobile.workerOffer.declineEffect") : p.mode === "withdraw" ? t("mobile.workerOffer.withdrawEffect") : t("mobile.workerOffer.dropoutEffect");
  const options: { value: Exclude<Reason, null>; label: string }[] = p.mode === "dropout" ? [{ value: "transport", label: t("mobile.workerOffer.transport") }, { value: "another_job", label: t("mobile.workerOffer.anotherJob") }, { value: "personal", label: t("mobile.workerOffer.personal") }] : p.mode === "decline" ? [{ value: "busy_then", label: t("mobile.workerOffer.busy") }, { value: "too_far_away", label: t("mobile.workerOffer.tooFar") }] : [];
  const confirm = p.mode === "dropout" ? t("mobile.workerOffer.tellForeman") : title;
  return <Sheet visible={p.visible} title={title} closeLabel={t("mobile.workerOffer.close")} onClose={p.onClose} dock={
    <View style={{ backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.separator, paddingHorizontal: space.contentInset, paddingVertical: space.grid[3], gap: space.grid[3] }}>
      {(p.offline || p.checking) && <Copy variant="supporting" style={{ color: color.muted }}>{p.offline ? t("mobile.workerOffer.notSent") : t("mobile.workerOffer.checking")}</Copy>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.grid[4] }}>
        <View style={{ flexGrow: 1 }}><Button variant="neutral" label={keep} onPress={p.onClose} /></View>
        <View style={{ flexGrow: 1 }}><Button variant="destructive" label={confirm} disabled={p.offline || p.busy} busy={p.checking} onPress={() => p.onSubmit(reason)} /></View>
      </View>
    </View>
  }>
    {!!p.detail && <Copy variant="supporting" style={{ color: color.muted }}>{p.detail}</Copy>}
    <StatusBanner state="last-confirmed" label={effect} />
    {options.length > 0 && <SegmentedControl label={t("mobile.workerOffer.reason")} value={reason ?? "none"}
      options={[...options, { value: "none", label: t("mobile.workerOffer.preferNot") }]} onChange={value => setReason(value === "none" ? null : value)} />}
    {p.offline && <Copy>{t("mobile.workerOffer.contact")}</Copy>}{p.failed && <Copy accessibilityRole="alert">{t("mobile.workerOffer.failed")}</Copy>}
  </Sheet>;
}
export default function DropoutScreen() {
  const { shiftId } = useLocalSearchParams<{ shiftId: string }>(); const router = useRouter(); const t = useT(); const format = useFormat(); const offline = useOffline();
  const shift = useRemote(getShiftRoute, { params: { s: shiftId ?? "" } }, { enabled: !!shiftId });
  const data = shift.data?.view === "worker" ? shift.data : null;
  const field = useRemote(getWorkerFieldShiftRoute, { params: { id: data?.assignment.id ?? "" } }, { enabled: !!data && !offline });
  const home = useRemote(getHomeRoute, { query: {} }, { enabled: offline, cache: { kind: "home" } }); const command = useCommand(dropoutAssignmentRoute);
  const current = home.data?.audience === "worker" && home.data.assignment?.assignment.shiftId === shiftId ? home.data.assignment.assignment : null;
  const allowed = !!data && data.assignment.state === "confirmed" && field.status === "ready" && field.data?.state === "confirmed" && !field.data.attendance.arrival && !field.data.attendance.hasPendingReview;
  const busy = command.state === "sending" || command.state === "checking";
  async function send(reason: Reason) { if (!data || !allowed || offline || busy || shift.status !== "ready") return; const result = await command.run({ params: { id: data.assignment.id }, body: { payload: { source: "self", reason: reason === "transport" || reason === "another_job" || reason === "personal" ? reason : null } } }); if (result.ok) router.back(); else { void shift.refresh(); void field.refresh(); } }
  const window = data ? siteWindow(format, data.shift.startsAt, data.shift.endsAt, data.shift.siteZone)
    : current && home.data?.audience === "worker" ? siteWindow(format, current.window.startsAt, current.window.endsAt, home.data.siteZone) : null;
  const detail = window ? [data?.shift.job.title, window.date, window.time, window.zone].filter(Boolean).join(" · ") : undefined;
  return <Screen title={t("mobile.workerOffer.shift")} navigation={{ kind: "back", label: t("mobile.workerOffer.back"), onPress: () => router.back() }}>
    {data && <Card><Copy variant="sectionTitle">{data.shift.job.title}</Copy><Copy>{data.shift.placeAlias}</Copy><Copy>{siteTime(format, data.shift.startsAt, data.shift.siteZone)} – {siteTime(format, data.shift.endsAt, data.shift.siteZone)}</Copy></Card>}
    {!data && <Copy>{shift.status === "error" ? t("mobile.workerOffer.error") : t("mobile.workerOffer.loading")}</Copy>}
    <DecisionSheet visible mode="dropout" detail={detail} offline={offline} busy={busy || !allowed || shift.status !== "ready"} checking={command.state === "checking"} failed={command.state === "failed" || command.state === "conflict"} onClose={() => router.back()} onSubmit={reason => void send(reason)} />
  </Screen>;
}
