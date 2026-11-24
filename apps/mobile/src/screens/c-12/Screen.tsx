import { getJobRatingEligibilityRoute, idSchemaFor, submitRatingRoute, type RatingEligibility, type RatingReceipt } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import type { CommandStatus, RemoteStatus } from "../../api/requests";
import { useFormat, useLocale, useT } from "../../i18n";
import { Card, Dock, Screen, Sheet, TextField } from "../../ui/controls";
import { Copy, Target, controlMetrics } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { useSession } from "../../session";
import { ReadState } from "../c-10/Screen";

export default function RatingScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>(); const router = useRouter(); const { locale } = useLocale();
  const { preferences } = useSession();
  const remote = useRemote(getJobRatingEligibilityRoute, { params: { j: jobId ?? "" } }, { enabled: !!jobId }); const command = useCommand(submitRatingRoute);
  const [stars, setStars] = useState(0); const [comment, setComment] = useState("");
  const data = remote.status === "ready" ? remote.data : null;
  async function send() {
    if (!jobId || data?.status !== "eligible" || !stars || command.state === "sending" || command.state === "checking") return;
    await command.run({ params: { j: jobId }, body: { payload: { id: idSchemaFor<"rating">().parse(uuid.v4()), stars, ...(comment.trim() ? { comment: { language: locale, text: comment } } : {}) } } });
  }
  return <RatingView data={data} status={remote.status} receipt={command.result} commandState={command.state} stars={stars} comment={comment} twoClock={preferences?.twoClock}
    onStars={setStars} onComment={setComment} onSend={() => { void send(); }} onClose={() => router.back()} onRetry={() => { void remote.refresh(); }} />;
}
export function RatingView({ data, status, receipt, commandState, stars, comment, twoClock = false, onStars, onComment, onSend, onClose, onRetry }: { data: RatingEligibility | null; status: RemoteStatus; receipt: RatingReceipt | null; commandState: CommandStatus; stars: number; comment: string; twoClock?: boolean; onStars: (value: number) => void; onComment: (value: string) => void; onSend: () => void; onClose: () => void; onRetry: () => void }) {
  const t = useT();
  const format = useFormat();
  const { color, field, radius, space } = useBeaconTheme();
  const read = status === "ready" ? data : null;
  const sent = receipt ?? (read?.status === "submitted" ? read.rating : null);
  const busy = commandState === "sending" || commandState === "checking";
  const clocks = sent && read ? format.lines(sent.submittedAt, read.job.siteZone, twoClock ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined) : null;
  const labels = [t("mobile.aftercare.ratingPoor"), t("mobile.aftercare.ratingFair"), t("mobile.aftercare.ratingOkay"),
    t("mobile.aftercare.ratingGood"), t("mobile.aftercare.ratingExcellent")];
  const ratingLabel = (count: number) => count > 0 ? t("mobile.aftercare.starsQuality", { count, quality: labels[count - 1]! }) : t("mobile.aftercare.choose");
  const metrics = controlMetrics(field);
  const context = sent ? undefined : status === "offline" ? t("mobile.aftercare.offline") : commandState === "failed"
    ? t("mobile.aftercare.failed") : commandState === "checking" ? t("mobile.aftercare.checking")
      : stars ? t("mobile.aftercare.optional") : t("mobile.aftercare.choose");
  return <>
    <Screen title={read?.job.title ?? t("mobile.aftercare.rating")} subtitle={read?.job.reference}>{null}</Screen>
    <Sheet visible title={t("mobile.aftercare.rating")} subtitle={read ? `${read.job.title} · ${read.job.providerDisplayName}` : undefined}
      closeLabel={t("mobile.aftercare.close")} onClose={onClose} dock={<Dock context={context} primary={sent
        ? { label: t("mobile.aftercare.doneAction"), onPress: onClose }
        : { label: t("mobile.aftercare.send"), onPress: onSend, disabled: read?.status !== "eligible" || !stars || busy, busy: commandState === "sending" }} />}>
      <ReadState status={status} onRetry={onRetry} />
      {sent && read && <Card>
        <Copy variant="sectionTitle" accessibilityLiveRegion="polite" style={{ color: color.successInk }}>{t("mobile.aftercare.ratingReceipt", { count: sent.stars })}</Copy>
        {clocks && <View style={{ gap: space.grid[1] }}>
          <Copy variant="label">{clocks.site}</Copy>
          {clocks.viewer && <Copy variant="supporting" style={{ color: color.muted }}>{clocks.viewer}</Copy>}
        </View>}
      </Card>}
      {read?.status === "unavailable" && <Copy>{t("mobile.aftercare.ratingUnavailable")}</Copy>}
      {read?.status === "eligible" && !sent && <>
        <View accessibilityRole="radiogroup" accessibilityLabel={t("mobile.aftercare.rating")} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.grid[field ? 4 : 2] }}>
          {labels.map((_, index) => {
            const value = index + 1;
            const filled = value <= stars;
            return <Target key={value} accessibilityRole="radio" accessibilityLabel={ratingLabel(value)}
              accessibilityState={{ checked: value === stars, disabled: busy }} onPress={() => onStars(value)} disabled={busy}
              style={({ pressed }) => ({
                width: metrics.rowMinHeight, height: metrics.rowMinHeight, alignItems: "center", justifyContent: "center",
                borderWidth: metrics.controlBorderWidth, borderRadius: radius.input, borderColor: filled ? color.ink : color.outline,
                backgroundColor: filled || pressed ? color.subtle : color.surface,
              })}>
              <Copy variant="pageTitle" aria-hidden style={{ color: busy ? color.muted : color.ink }}>{filled ? "★" : "☆"}</Copy>
            </Target>;
          })}
        </View>
        <Copy accessible accessibilityRole="adjustable" accessibilityLabel={t("mobile.aftercare.rating")}
          accessibilityValue={{ min: 0, max: labels.length, now: stars, text: ratingLabel(stars) }}
          accessibilityState={{ disabled: busy }} accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => {
            if (busy) return;
            const action = event.nativeEvent.actionName;
            if (action === "increment" && stars < labels.length) onStars(stars + 1);
            if (action === "decrement" && stars > 1) onStars(stars - 1);
          }} variant="label">{ratingLabel(stars)}</Copy>
        <TextField label={t("mobile.aftercare.comment")} value={comment} onChangeText={onComment} multiline maxLength={4000} disabled={busy} />
      </>}
      {read && read.status !== "unavailable" && <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.aftercare.private")}</Copy>}
    </Sheet>
  </>;
}
