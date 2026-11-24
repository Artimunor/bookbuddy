import { cancelVisitRoute, getJobWindowsRoute, idSchemaFor, requestVisitRescheduleRoute, type JobWindows } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import type { CommandStatus, RemoteStatus } from "../../api/requests";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Dock, Screen, Sheet } from "../../ui/controls";
import { Copy, Target, controlMetrics } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { currentVisit, WindowTime } from "../c-08/Screen";
import { confirmAction } from "../s-17/confirmAction";

type Choice = "reschedule" | "cancel";
export default function CancelScreen() {
  const { jobId, visitId } = useLocalSearchParams<{ jobId: string; visitId?: string }>(); const router = useRouter(); const t = useT(); const { preferences, bootstrap } = useSession();
  const remote = useRemote(getJobWindowsRoute, { params: { j: jobId ?? "" } }, { enabled: !!jobId });
  const cancel = useCommand(cancelVisitRoute); const request = useCommand(requestVisitRescheduleRoute);
  const [choice, setChoice] = useState<Choice>("reschedule"); const data = remote.data; const visit = currentVisit(data, visitId);
  async function reschedule() {
    if (!visit || request.state === "checking" || request.state === "sending") return;
    if (visit.offeredWindows.some(w => !!w.confirmationMode)) { router.push({ pathname: "/c/jobs/[jobId]/windows", params: { jobId: jobId ?? "", visitId: visit.id } } as Href); return; }
    if (!visit.actions.canRequestReschedule) return;
    const result = await request.run({ params: { id: visit.id }, body: { expectedRevision: visit.revision, payload: { id: idSchemaFor<"reschedule_request">().parse(uuid.v4()), bookedWindowId: visit.bookedWindow?.id ?? null } } });
    if (result.ok || result.error.code === "CONFLICT" || result.error.code === "STALE_REVISION" || ("delivery" in result.error && result.error.delivery === "unknown")) await remote.refresh();
  }
  function askCancel() {
    if (!data || !visit?.bookedWindow || !visit.actions.canCancelFeeFree) return;
    const booked = visit.bookedWindow;
    confirmAction(router, { title: t("mobile.visitWindow.cancel"), actionLabel: t("mobile.visitWindow.cancel"), actionLabelKey: "mobile.visitWindow.cancel", item: `${data.job.reference} · ${data.job.title}`, actor: bootstrap?.account.displayName ?? "", role: data.foremanName ?? t("mobile.visitWindow.provider"), effects: [t("mobile.visitWindow.cancelEffect")], destructive: true, onReview: () => { void remote.refresh(); }, onConfirm: async () => {
      const result = await cancel.run({ params: { id: visit.id }, body: { expectedRevision: visit.revision, payload: { bookedWindowId: booked.id } } });
      if (result.ok) { await remote.refresh(); return "confirmed"; }
      if (result.error.code === "INTERNAL_ERROR" || ("delivery" in result.error && result.error.delivery === "unknown")) { await remote.refresh(); return "uncertain"; }
      await remote.refresh(); return "invalidated";
    } });
  }
  return <CancelView data={data} visitId={visitId} status={remote.status} choice={choice} commandState={request.state === "idle" ? cancel.state : request.state} twoClock={preferences?.twoClock ?? false} onChoice={setChoice} onClose={() => router.back()} onAction={() => { if (choice === "cancel") askCancel(); else void reschedule(); }} />;
}

export function CancelView({ data, visitId, status, choice, commandState = "idle", twoClock, viewerZone, onChoice, onClose, onAction }: { data: JobWindows | null; visitId?: string; status: RemoteStatus; choice: Choice; commandState?: CommandStatus; twoClock: boolean; viewerZone?: string; onChoice: (choice: Choice) => void; onClose: () => void; onAction: () => void }) {
  const t = useT();
  const { color, field, radius, space } = useBeaconTheme();
  const metrics = controlMetrics(field);
  const visit = currentVisit(data, visitId);
  const booked = visit?.bookedWindow;
  const requested = visit?.rescheduleRequest?.state === "requested"; const cancelled = visit?.state === "cancelled";
  const alternatives = !!visit?.offeredWindows.some(w => !!w.confirmationMode);
  const canAct = choice === "cancel" ? !!booked && !!visit?.actions.canCancelFeeFree : !!visit?.actions.canRequestReschedule || alternatives;
  const busy = commandState === "sending" || commandState === "checking";
  const label = choice === "cancel" ? t("mobile.visitWindow.cancel") : alternatives ? t("mobile.visitWindow.chooseNew") : t("mobile.visitWindow.request");
  const context = status === "offline" || status === "error" ? t("mobile.visitWindow.unavailable")
    : choice === "cancel" ? t("mobile.visitWindow.cancelEffect") : t("mobile.visitWindow.keep");
  return <><Screen title={data?.job.title ?? t("mobile.visitWindow.cancelTitle")} subtitle={data?.job.reference}>{null}</Screen>
    <Sheet visible title={t("mobile.visitWindow.cancelTitle")} subtitle={data ? `${data.job.reference} · ${data.job.title}` : undefined} closeLabel={t("mobile.visitWindow.close")} onClose={onClose}
      dock={<Dock primary={requested || cancelled ? { label: t("mobile.visitWindow.done"), onPress: onClose } : {
        label, onPress: onAction, disabled: status !== "ready" || !canAct || busy, busy: commandState === "sending", destructive: choice === "cancel",
      }} context={requested || cancelled ? undefined : context} />}>
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.visitWindow.loading")}</Copy>}
    {(status === "error" || status === "offline") && <Copy>{t("mobile.visitWindow.unavailable")}</Copy>}
    {booked && data && <View style={{ padding: space.grid[4], gap: space.grid[1], borderRadius: radius.card, backgroundColor: color.subtle }}>
      <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.visitWindow.current")}</Copy>
      <WindowTime start={booked.startsAt} end={booked.endsAt} zone={data.siteZone} twoClock={twoClock} viewerZone={viewerZone} />
    </View>}
    {visit?.actions.canCancelFeeFree && <Badge tone="success" label={t("mobile.visitWindow.noFee")} />}
    {requested && <Badge tone="info" label={t("mobile.visitWindow.requested")} />}
    {cancelled && <Badge tone="success" label={t("mobile.visitWindow.cancelled")} />}
    {commandState === "checking" && <Copy accessibilityLiveRegion="polite">{t("mobile.visitWindow.checking")}</Copy>}
    {commandState === "failed" && <Copy accessibilityLiveRegion="polite">{t("mobile.visitWindow.failed")}</Copy>}
    {!requested && !cancelled && data && <View accessibilityRole="radiogroup" accessibilityLabel={t("mobile.visitWindow.cancelTitle")} style={{ gap: metrics.controlGap }}>
      {(["reschedule", "cancel"] as const).map(option => {
        const checked = option === choice;
        return <Target key={option} accessibilityRole="radio" accessibilityState={{ checked }} onPress={() => onChoice(option)}
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "flex-start", gap: space.grid[3],
            borderWidth: checked ? 2 : metrics.controlBorderWidth, borderColor: checked ? color.ink : color.outline,
            borderRadius: radius.input, padding: space.grid[3], backgroundColor: checked || pressed ? color.subtle : color.surface,
          })}>
          <Copy aria-hidden variant="label">{checked ? "◉" : "○"}</Copy>
          <View style={{ flex: 1, gap: space.grid[1] }}>
            <Copy variant="label">{option === "reschedule" ? t("mobile.visitWindow.reschedule") : t("mobile.visitWindow.cancel")}</Copy>
            <Copy variant="supporting" style={{ color: color.muted }}>{option === "reschedule" ? t("mobile.visitWindow.keep") : t("mobile.visitWindow.cancelEffect")}</Copy>
          </View>
        </Target>;
      })}
    </View>}
    {!alternatives && !requested && visit?.actions.canRequestReschedule && <Copy>{t("mobile.visitWindow.needsAgreement")}</Copy>}
    {data && !visit && <Copy>{t("mobile.visitWindow.noAction")}</Copy>}
  </Sheet></>;
}
