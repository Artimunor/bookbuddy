import { getJobRatingEligibilityRoute, idSchemaFor, submitRatingRoute, type RatingEligibility, type RatingReceipt } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import type { CommandStatus, RemoteStatus } from "../../api/requests";
import { useFormat, useLocale, useT } from "../../i18n";
import { Button, Dock, Screen, Sheet, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ReadState, siteTime } from "../c-10/Screen";

export default function RatingScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>(); const router = useRouter(); const { locale } = useLocale();
  const remote = useRemote(getJobRatingEligibilityRoute, { params: { j: jobId ?? "" } }, { enabled: !!jobId }); const command = useCommand(submitRatingRoute);
  const [stars, setStars] = useState(0); const [comment, setComment] = useState("");
  const data = remote.status === "ready" ? remote.data : null;
  async function send() {
    if (!jobId || data?.status !== "eligible" || !stars || command.state === "sending" || command.state === "checking") return;
    await command.run({ params: { j: jobId }, body: { payload: { id: idSchemaFor<"rating">().parse(uuid.v4()), stars, ...(comment.trim() ? { comment: { language: locale, text: comment } } : {}) } } });
  }
  return <RatingView data={data} status={remote.status} receipt={command.result} commandState={command.state} stars={stars} comment={comment} onStars={setStars} onComment={setComment} onSend={() => { void send(); }} onClose={() => router.back()} onRetry={() => { void remote.refresh(); }} />;
}
export function RatingView({ data, status, receipt, commandState, stars, comment, onStars, onComment, onSend, onClose, onRetry }: { data: RatingEligibility | null; status: RemoteStatus; receipt: RatingReceipt | null; commandState: CommandStatus; stars: number; comment: string; onStars: (value: number) => void; onComment: (value: string) => void; onSend: () => void; onClose: () => void; onRetry: () => void }) {
  const t = useT(); const format = useFormat(); const read = status === "ready" ? data : null; const sent = receipt ?? (read?.status === "submitted" ? read.rating : null); const busy = commandState === "sending" || commandState === "checking";
  return <><Screen title={read?.job.title ?? t("mobile.aftercare.rating")}><Copy>{read?.job.reference}</Copy></Screen><Sheet visible title={t("mobile.aftercare.rating")} closeLabel={t("mobile.aftercare.close")} onClose={onClose} dock={<Dock context={sent ? undefined : commandState === "failed" ? t("mobile.aftercare.failed") : commandState === "checking" ? t("mobile.aftercare.checking") : stars ? t("mobile.aftercare.optional") : t("mobile.aftercare.choose")} primary={sent ? { label: t("mobile.aftercare.doneAction"), onPress: onClose } : { label: t("mobile.aftercare.send"), onPress: onSend, disabled: read?.status !== "eligible" || !stars || busy, busy: commandState === "sending" }} />}>
    <ReadState status={status} onRetry={onRetry} />{read && <Copy variant="supporting">{read.job.reference} · {read.job.title} · {read.job.providerDisplayName}</Copy>}
    {sent && read && <Copy accessibilityLiveRegion="polite">{t("mobile.aftercare.sent", { count: sent.stars, time: siteTime(format, sent.submittedAt, read.job.siteZone) })}</Copy>}
    {read?.status === "unavailable" && <Copy>{t("mobile.aftercare.ratingUnavailable")}</Copy>}
    {read?.status === "eligible" && !sent && <><View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>{[1, 2, 3, 4, 5].map(value => <Button key={value} variant={value === stars ? "primary" : "neutral"} label={`★ ${value}`} accessibilityLabel={t("mobile.aftercare.stars", { count: value })} onPress={() => onStars(value)} disabled={busy} />)}</View>{stars > 0 && <Copy>{t("mobile.aftercare.stars", { count: stars })}</Copy>}<TextField label={t("mobile.aftercare.comment")} value={comment} onChangeText={onComment} multiline maxLength={4000} disabled={busy} /></>}
    {read && read.status !== "unavailable" && <Copy>{t("mobile.aftercare.private")}</Copy>}
  </Sheet></>;
}
