import { confirmCoverRoute, getCoverRoute, type ForemanCover } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote, useSeedRemote } from "../../api";
import type { CommandStatus, RemoteStatus } from "../../api/requests";
import { useFormat, useLocale, useT } from "../../i18n";
import { coverCardSource, useStatusCards } from "../../system/status-cards";
import { Card, Dock, Screen, Sheet, StatusBanner } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { foremanWindow } from "../f-06/clock";

type Outcome = "confirmed" | "already_filled" | "not_confirmed" | null;
export default function ConfirmCoverScreen() {
  const { gapId } = useLocalSearchParams<{ gapId: string }>(); const router = useRouter();
  const remote = useRemote(getCoverRoute, { params: { g: gapId ?? "" } }, { enabled: !!gapId }); const command = useCommand(confirmCoverRoute);
  const seedRemote = useSeedRemote(); const { active, refresh } = useStatusCards();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const data = remote.data?.audience === "foreman" ? remote.data : null;
  async function confirm() {
    if (!data || remote.status !== "ready" || data.status.state !== "accepted_pending_confirmation" || !data.actions.canConfirm || data.currentRoundNo === null || command.state === "checking" || command.state === "sending") return;
    const result = await command.run({ params: { g: data.gapId }, body: { expectedRevision: data.revision, expectedRoundNo: data.currentRoundNo, payload: {} } });
    if (result.ok) {
      const { cover, outcome } = result.data;
      setOutcome(outcome);
      seedRemote(getCoverRoute, { params: { g: data.gapId } }, cover, result.meta.serverTime);
      if (active?.target.kind === "foreman_cover" && active.target.id === data.gapId) void refresh(coverCardSource(cover)).catch(() => undefined);
    } else await remote.refresh();
  }
  return <ConfirmCoverView data={data} status={remote.status} outcome={outcome} commandState={command.state} onClose={() => router.back()} onConfirm={() => { void confirm(); }} onShift={() => data && router.replace(`/f/shifts/${data.shift.shiftId}` as Href)} onRetry={() => { void remote.refresh(); }} />;
}

export function ConfirmCoverView({ data, status, outcome, commandState = "idle", onClose, onConfirm, onShift, onRetry }: { data: ForemanCover | null; status: RemoteStatus; outcome: Outcome; commandState?: CommandStatus; onClose: () => void; onConfirm: () => void; onShift: () => void; onRetry: () => void }) {
  const t = useT(); const format = useFormat(); const { locale } = useLocale();
  const { color, radius, space } = useBeaconTheme();
  const siteZone = data?.shift.siteZone;
  const time = (at: number) => {
    const value = format.siteTime(at, siteZone);
    return value.kind === "available" ? value.site.time : "";
  };
  const held = data?.status.state === "accepted_pending_confirmation" ? data.status.hold : null;
  const confirmed = data?.status.state === "confirmed"; const completed = confirmed || outcome === "confirmed" || outcome === "already_filled";
  const invalid = outcome === "not_confirmed" || commandState === "conflict" || (!!data && (!held || !data.actions.canConfirm) && !completed);
  const busy = commandState === "checking" || commandState === "sending";
  const ready = status === "ready" && !!held && !!data?.actions.canConfirm && !busy && !invalid;
  const timing = data ? foremanWindow(format, data.shift.window, data.shift.siteZone) : null;
  const subtitle = data && timing ? [data.shift.reference, timing.date, `${timing.time} ${timing.zone}`].filter(Boolean).join(" · ") : undefined;
  const validUntil = held?.fit.eligibility.validUntil;
  const eligibilityDate = validUntil != null && siteZone ? new Intl.DateTimeFormat(locale, { timeZone: siteZone, year: "numeric", month: "short", day: "numeric" }).format(validUntil) : null;
  let language = t("mobile.foremanHome.unknownLanguage");
  if (data && typeof Intl.DisplayNames === "function") {
    try { language = new Intl.DisplayNames(locale, { type: "language", fallback: "none" }).of(data.shift.briefingLanguage) ?? language; }
    catch { /* Leave the catalog fallback on unrecognised tags. */ }
  }
  const context = status === "offline" && !invalid && !completed ? t("mobile.cover.connectConfirm") : ready ? t("mobile.cover.travel") : undefined;
  return <><Screen title={t("mobile.cover.title")} subtitle={data ? `${data.shift.reference} · ${data.shift.task}` : undefined}><></></Screen>
    <Sheet visible title={t("mobile.cover.confirmTitle")} subtitle={subtitle} closeLabel={t("mobile.cover.close")} onClose={onClose} dock={<Dock primary={
      completed ? { label: t("mobile.cover.viewShift"), onPress: onShift } :
      invalid ? { label: t("mobile.cover.backSearch"), onPress: onClose } :
      { label: held ? t("mobile.cover.confirmName", { name: held.worker.displayName }) : t("mobile.cover.confirmCover"), onPress: onConfirm, live: true, disabled: !ready, busy: commandState === "sending" }
    } context={context} />}>
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.cover.loading")}</Copy>}
    {(status === "offline" || status === "error") && <StatusBanner state={status === "offline" ? "offline" : "not-sent"} label={t("mobile.cover.unavailable")} action={{ label: t("mobile.cover.retry"), onPress: onRetry }} />}
    {commandState === "checking" && <Copy accessibilityLiveRegion="polite">{t("mobile.cover.checking")}</Copy>}
    {commandState === "failed" && <Copy>{t("mobile.cover.failed")}</Copy>}
    {data?.status.state === "confirmed" && <View style={{ gap: space.grid[2], padding: space.grid[4], backgroundColor: color.successSoft, borderRadius: radius.card }}>
      <Copy variant="label" style={{ color: color.successInk }}>{outcome === "confirmed" ? t("mobile.cover.onVisit", { name: data.status.worker.displayName }) : t("mobile.cover.alreadyFilled")}</Copy>
      <Copy variant="supporting" style={{ color: color.successInk }}>{t("mobile.cover.filledBy", { worker: data.status.worker.displayName, name: data.status.confirmedByName, time: time(data.status.confirmedAt) })}</Copy>
      {data.customerUpdate.state === "published" && data.customerUpdate.kind === "crew_updated" && <Copy variant="supporting" style={{ color: color.successInk }}>
        {t("mobile.cover.crewUpdatePublished", { time: time(data.customerUpdate.publishedAt) })}
      </Copy>}
    </View>}
    {invalid && <StatusBanner state="not-sent" label={t("mobile.cover.noLongerEligible")} />}
    {held && data && <>
      <Card dense>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.grid[3] }}>
          <View aria-hidden style={{ width: 40, height: 40, borderRadius: radius.pill, backgroundColor: color.personD, borderWidth: 2, borderColor: color.outline, alignItems: "center", justifyContent: "center" }}>
            <Copy variant="caption">{held.worker.displayName.trim().split(/\s+/).slice(0, 2).map(name => name[0]).join("")}</Copy>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Copy variant="sectionTitle">{held.worker.displayName}</Copy>
            <Copy variant="supporting">{data.shift.skill} · {language} · {t("mobile.cover.crewRung")}</Copy>
          </View>
        </View>
        <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.cover.acceptedUntil", { accepted: time(held.acceptedAt), deadline: time(held.confirmBy) })}</Copy>
      </Card>
      <Card dense>
        <Copy variant="label">{t("mobile.cover.rechecks")}</Copy>
        <Copy>{held.fit.result === "available" && eligibilityDate ? t("mobile.cover.eligibleUntil", { date: eligibilityDate }) : t("mobile.cover.eligible", { state: held.fit.result === "available" ? t("mobile.cover.available") : t("mobile.cover.ineligible") })}</Copy>
        {held.fit.availability.state === "free" && <Copy>{t("mobile.cover.free")}</Copy>}
        {held.gapStillOpen && <Copy>{t("mobile.cover.gapOpen")}</Copy>}
        <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.cover.checked", { time: time(held.fit.checkedAt) })}</Copy>
      </Card>
      <View style={{ padding: space.grid[4], gap: space.grid[2], borderRadius: radius.card, backgroundColor: color.infoSoft }}>
        <Copy variant="label" style={{ color: color.infoInk }}>{t("mobile.cover.effects")}</Copy>
        <Copy variant="supporting" style={{ color: color.infoInk }}>{t("mobile.cover.effectsDetail")}</Copy>
      </View>
    </>}
  </Sheet></>;
}
