import { confirmCoverRoute, getCoverRoute, type ForemanCover } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { useCommand, useRemote } from "../../api";
import type { CommandStatus, RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { Button, Card, Dock, Screen, Sheet } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { formatTime } from "../f-10/Screen";

type Outcome = "confirmed" | "already_filled" | "not_confirmed" | null;
export default function ConfirmCoverScreen() {
  const { gapId } = useLocalSearchParams<{ gapId: string }>(); const router = useRouter();
  const remote = useRemote(getCoverRoute, { params: { g: gapId ?? "" } }, { enabled: !!gapId }); const command = useCommand(confirmCoverRoute);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const data = remote.data?.audience === "foreman" ? remote.data : null;
  async function confirm() {
    if (!data || remote.status !== "ready" || data.status.state !== "accepted_pending_confirmation" || !data.actions.canConfirm || data.currentRoundNo === null || command.state === "checking" || command.state === "sending") return;
    const result = await command.run({ params: { g: data.gapId }, body: { expectedRevision: data.revision, expectedRoundNo: data.currentRoundNo, payload: {} } });
    if (result.ok) setOutcome(result.data.outcome);
    await remote.refresh();
  }
  return <ConfirmCoverView data={data} status={remote.status} outcome={outcome} commandState={command.state} onClose={() => router.back()} onConfirm={() => { void confirm(); }} onShift={() => data && router.replace(`/f/shifts/${data.shift.shiftId}` as Href)} onRetry={() => { void remote.refresh(); }} />;
}

export function ConfirmCoverView({ data, status, outcome, commandState = "idle", onClose, onConfirm, onShift, onRetry }: { data: ForemanCover | null; status: RemoteStatus; outcome: Outcome; commandState?: CommandStatus; onClose: () => void; onConfirm: () => void; onShift: () => void; onRetry: () => void }) {
  const t = useT(); const format = useFormat(); const time = (at: number) => formatTime(format, at, data?.shift.siteZone ?? "");
  const held = data?.status.state === "accepted_pending_confirmation" ? data.status.hold : null;
  const confirmed = data?.status.state === "confirmed"; const completed = confirmed || outcome === "confirmed" || outcome === "already_filled";
  const invalid = outcome === "not_confirmed" || commandState === "conflict" || (!!data && (!held || !data.actions.canConfirm) && !completed);
  const busy = commandState === "checking" || commandState === "sending";
  const ready = status === "ready" && !!held && !!data?.actions.canConfirm && !busy && !invalid;
  return <><Screen title={t("mobile.cover.title")}><Copy>{data?.shift.reference}</Copy></Screen><Sheet visible title={t("mobile.cover.confirmTitle")} closeLabel={t("mobile.cover.close")} onClose={onClose} dock={<Dock primary={completed ? { label: t("mobile.cover.viewShift"), onPress: onShift } : invalid ? { label: t("mobile.cover.backSearch"), onPress: onClose } : { label: held ? t("mobile.cover.confirmName", { name: held.worker.displayName }) : t("mobile.cover.confirmCover"), onPress: onConfirm, live: true, disabled: !ready, busy: commandState === "sending" }} context={t("mobile.cover.travel")} />}>
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.cover.loading")}</Copy>}
    {(status === "offline" || status === "error") && <><Copy>{t("mobile.cover.unavailable")}</Copy><Button variant="neutral" label={t("mobile.cover.retry")} onPress={onRetry} /></>}
    {commandState === "checking" && <Copy accessibilityLiveRegion="polite">{t("mobile.cover.checking")}</Copy>}{commandState === "failed" && <Copy>{t("mobile.cover.failed")}</Copy>}
    {data && <Copy variant="supporting">{data.shift.reference} · {time(data.shift.window.startsAt)} – {time(data.shift.window.endsAt)} · {data.shift.siteZone}</Copy>}
    {data?.status.state === "confirmed" && <Card><Copy variant="sectionTitle">{outcome === "confirmed" ? t("mobile.cover.onVisit", { name: data.status.worker.displayName }) : t("mobile.cover.alreadyFilled")}</Copy><Copy>{data.status.worker.displayName} · {time(data.status.confirmedAt)}</Copy></Card>}
    {invalid && <Card><Copy>{t("mobile.cover.noLongerEligible")}</Copy></Card>}
    {held && <><Card><Copy variant="sectionTitle">{held.worker.displayName}</Copy><Copy>{data!.shift.skill} · {data!.shift.briefingLanguage}</Copy><Copy>{t("mobile.cover.held")} · {time(held.acceptedAt)}</Copy><Copy>{t("mobile.cover.confirmBy", { time: time(held.confirmBy) })}</Copy></Card>
      <Card><Copy variant="sectionTitle">{t("mobile.cover.rechecks")}</Copy><Copy>{t("mobile.cover.eligible", { state: held.fit.result === "available" ? t("mobile.cover.available") : t("mobile.cover.ineligible") })}</Copy>{held.fit.availability.state === "free" && <Copy>{t("mobile.cover.free")}</Copy>}{held.gapStillOpen && <Copy>{t("mobile.cover.gapOpen")}</Copy>}<Copy variant="supporting">{t("mobile.cover.checked", { time: time(held.fit.checkedAt) })}</Copy></Card>
      <Card><Copy variant="sectionTitle">{t("mobile.cover.effects")}</Copy><Copy>{t("mobile.cover.effectsDetail")}</Copy></Card></>}
  </Sheet></>;
}
