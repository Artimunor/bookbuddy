import { getAssignmentBriefingRoute, getShiftRoute, type AssignmentBriefing } from "@bookbuddy/api-contract";
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCallback, useRef } from "react";
import { View } from "react-native";
import { useRemote } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useLastConfirmed, useProjection } from "../../repository/hooks";
import { Button, Card, Dock, ListRow, Screen, TwinCard } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { HoldBanner } from "../../ui/live/HoldBanner";
import { TwoClock } from "../../ui/live/TwoClock";
import { BeaconThemeProvider, useBeaconTheme } from "../../ui/theme";
import { siteWindow } from "../c-01/clock";
import { useOffline } from "../s-02/flow";
import { readingLanguageLabel } from "../s-12/language";
import { useSession } from "../../session";

export default function BriefingScreen() { return <BeaconThemeProvider field><BriefingRoute /></BeaconThemeProvider>; }
function BriefingRoute() {
  const { shiftId = "", assignmentId: requested = "" } = useLocalSearchParams<{ shiftId: string; assignmentId?: string }>(); const offline = useOffline(); const router = useRouter(); const returned = useRef(false);
  const { bootstrap } = useSession();
  const viewerZone = bootstrap?.preferences.twoClock ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const lookup = useRemote(getShiftRoute, { params: { s: shiftId } }, { enabled: !!shiftId && !requested && !offline });
  const assignmentId = requested || (lookup.data?.view === "worker" ? lookup.data.assignment.id : "");
  const cached = useProjection("assignment_briefing", assignmentId); const lastConfirmedAt = useLastConfirmed();
  const remote = useRemote(getAssignmentBriefingRoute, { params: { id: assignmentId } }, { enabled: !!assignmentId && !offline });
  useFocusEffect(useCallback(() => { if (returned.current && !offline) void remote.refresh(); returned.current = true; }, [offline, remote.refresh]));
  return <BriefingView data={remote.data} cached={cached} lastConfirmedAt={lastConfirmedAt} offline={offline} loading={lookup.status === "loading" || remote.status === "loading"} viewerZone={viewerZone} onBack={() => router.canGoBack() ? router.back() : router.replace(`/w/shifts/${shiftId}` as Href)} onNavigate={path => router.push(path as Href)} onRetry={() => void remote.refresh()} />;
}
type CachedBriefing = { assignmentId: string; siteZone: string; bookedWindow: { startsAt: number; endsAt: number }; hasActiveHold: boolean; instruction: { instructionId: string; version: { id: string; no: number; issuedByName: string; issuedAt: number }; state: "awaiting_teach_back" | "awaiting_acknowledgement" | "acknowledged"; original: { language: string; text: string }; reviewedHumanReadingAid: { language: string; text: string } | null } | null };
export function BriefingView({ data, cached = null, lastConfirmedAt = null, offline, loading, viewerZone, onBack, onNavigate, onRetry }: { data: AssignmentBriefing | null; cached?: CachedBriefing | null; lastConfirmedAt?: number | null; offline: boolean; loading: boolean; viewerZone?: string; onBack: () => void; onNavigate: (path: string) => void; onRetry: () => void }) {
  const t = useT(); const format = useFormat(); const { color, space } = useBeaconTheme();
  const d = offline ? null : data; const shift = d?.shift; const instruction = d?.instruction; const active = shift?.holds.some(h => h.state === "active"); const plan = d?.site?.arrivalPlan;
  const source = shift ?? (offline ? cached : null);
  const zone = source?.siteZone;
  const clock = source && siteWindow(format, source.bookedWindow.startsAt, source.bookedWindow.endsAt, zone, viewerZone);
  const time = (at: number) => format.lines(at, zone)?.site ?? "";
  const open = () => instruction && onNavigate(`/safety/${instruction.instructionId}?versionId=${encodeURIComponent(instruction.version.id)}`);
  const window = clock && <TwoClock siteTime={[clock.date, clock.time].filter(Boolean).join(" · ")} siteZone={clock.zone} viewerLine={clock.viewer ?? undefined} />;
  return <Screen title={t("mobile.briefing.title")} subtitle={shift ? `${shift.job.reference} · ${shift.job.title ?? shift.task}` : undefined} navigation={{ kind: "back", label: t("mobile.liveShift.back"), onPress: onBack }} dock={instruction ? <Dock primary={{ label: t("mobile.briefing.safety"), onPress: open }} /> : undefined}>
    {loading && <Copy>{t("mobile.liveShift.loading")}</Copy>}{offline && <><Copy>{t("mobile.briefing.offline")}</Copy><Copy>{t("mobile.briefing.arrivalOnline")}</Copy></>}{!loading && !offline && !d && <><Copy>{t("mobile.liveShift.error")}</Copy><Button label={t("mobile.liveShift.retry")} onPress={onRetry} /></>}
    {offline && cached && <>
      <Copy>{lastConfirmedAt != null ? t("mobile.liveShift.offlineAt", { time: time(lastConfirmedAt) }) : t("mobile.liveShift.offline")}</Copy>
      {window && <Card dense>{window}</Card>}
      {cached.instruction && <>
        <Copy variant="sectionTitle">{t("mobile.briefing.cachedSafety", { version: cached.instruction.version.no })}</Copy>
        {(() => {
          const { original, reviewedHumanReadingAid: aid } = cached.instruction;
          const originalText = { text: original.text, label: t("mobile.briefing.original", { language: readingLanguageLabel(t, original.language) }) };
          return aid && aid.language !== original.language
            ? <TwinCard state="translated" original={originalText} translation={{ text: aid.text, label: t("mobile.briefing.translation", { language: readingLanguageLabel(t, aid.language) }) }} />
            : <TwinCard state="original" original={originalText} />;
        })()}
        <Copy>{cached.instruction.state === "awaiting_teach_back" ? t("mobile.briefing.cachedPending") : cached.instruction.state === "awaiting_acknowledgement" ? t("mobile.briefing.cachedReady") : t("mobile.briefing.cachedAcknowledged")}</Copy>
        {cached.hasActiveHold && <Copy>{t("mobile.briefing.hold", { version: cached.instruction.version.no })}</Copy>}
        <Copy variant="supporting">{t("mobile.briefing.issued", { name: cached.instruction.version.issuedByName, time: time(cached.instruction.version.issuedAt) })}</Copy>
      </>}
    </>}
    {instruction && shift?.holds.some(h => h.instruction && h.instruction.version.id !== instruction.version.id) && <Copy>{t("mobile.briefing.changed", { version: instruction.version.no })}</Copy>}
    {d && shift && <>{active && <HoldBanner state="briefingRequired" label={instruction ? t("mobile.briefing.hold", { version: instruction.version.no }) : t("mobile.liveShift.hold")} blocked={t("mobile.briefing.blocked")} action={instruction ? t("mobile.briefing.safety") : t("mobile.briefing.noInstruction")} />}{!active && shift.holds.some(h => h.state === "cleared") && <HoldBanner state="cleared" label={t("mobile.liveShift.holdCleared")} />}
      <Card dense>
        {d.site && <ListRow glyph="⌖" label={shift.job.placeAlias ?? d.site.address} description={shift.job.placeAlias && d.site.address !== shift.job.placeAlias ? d.site.address : undefined} />}
        {window}
      </Card>
      {plan ? <View style={{ gap: space.grid[2] }}>
        <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.briefing.posted", { name: plan.postedByName, time: time(plan.postedAt) })}</Copy>
        {(() => {
          const original = { text: plan.original.text, label: t("mobile.briefing.original", { language: readingLanguageLabel(t, plan.original.language) }) };
          const reading = plan.reading;
          if (reading?.status !== "ready") return <TwinCard state="unavailable" original={original} status={t("mobile.briefing.unavailableTranslation")} />;
          if (reading.language === plan.original.language) return <TwinCard state="original" original={original} />;
          return <TwinCard state="translated" original={original} translation={{ text: reading.text, label: t("mobile.briefing.translation", { language: readingLanguageLabel(t, reading.language) }) }} />;
        })()}
      </View> : <Copy>{t("mobile.briefing.noPlan")}</Copy>}
      {!instruction && <Copy>{t("mobile.briefing.noInstruction")}</Copy>}{shift.crewThreadId && <Button variant="quiet" label={t("mobile.briefing.askArrival")} onPress={() => onNavigate(`/threads/${shift.crewThreadId}`)} />}</>}
  </Screen>;
}
