import { acceptJobHandoffRoute, declineJobHandoffRoute, getJobRoute, type JobDetail } from "@bookbuddy/api-contract";
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { useCommand, useRemote } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Button, Card, Dock, ListRow, Screen, TextField, TwinCard } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useOffline } from "../s-02/flow";
import { confirmAction } from "../s-17/confirmAction";
import { siteTime } from "../f-01/Screen";

type Intake = Extract<Extract<JobDetail, { audience: "foreman" }>["job"], { view: "intake" }>;
type Status = "idle" | "loading" | "ready" | "error" | "offline";
export default function IntakeScreen() {
  const { handoffId, jobId } = useLocalSearchParams<{ handoffId: string; jobId?: string }>();
  const remote = useRemote(getJobRoute, { params: { j: jobId ?? "" }, query: { view: "intake" } }, { enabled: !!jobId });
  const accept = useCommand(acceptJobHandoffRoute); const decline = useCommand(declineJobHandoffRoute);
  const router = useRouter(); const { bootstrap } = useSession(); const offline = useOffline(); const t = useT();
  const [reason, setReason] = useState(""); const [declining, setDeclining] = useState(false); const [destination, setDestination] = useState<string | null>(null);
  const job = remote.data?.audience === "foreman" && remote.data.job.view === "intake" && remote.data.job.handoff.handoffId === handoffId ? remote.data.job : null;
  useFocusEffect(useCallback(() => { if (destination) { setDestination(null); if (destination === "back") router.back(); else router.replace(destination as Href); } }, [destination, router]));
  function confirm(kind: "accept" | "decline") {
    if (!job || offline || job.reply !== "available" || accept.state === "checking" || decline.state === "checking") return;
    const isTakeover = !!job.handoff.from; const actionLabelKey = kind === "decline" ? "mobile.foremanHome.confirmDecline" : isTakeover ? "mobile.foremanHome.takeoverAction" : "mobile.foremanHome.accept";
    const actionLabel = kind === "decline" ? t("mobile.foremanHome.confirmDecline") : isTakeover ? t("mobile.foremanHome.takeoverAction") : t("mobile.foremanHome.accept");
    confirmAction(router, { title: actionLabel, actionLabel, actionLabelKey, item: `${job.reference} · ${job.title ?? t("mobile.foremanHome.untitled")}`, actor: bootstrap?.account.displayName ?? job.handoff.to.displayName, role: t("mobile.foremanHome.foreman"), effects: [kind === "decline" ? t("mobile.foremanHome.declineEffect") : isTakeover ? t("mobile.foremanHome.takeoverEffect") : t("mobile.foremanHome.effect")], offline,
      onReview: () => { void remote.refresh(); }, onConfirm: async () => {
        const params = { j: job.jobId, h: job.handoff.handoffId };
        const result = kind === "accept" ? await accept.run({ params, body: { expectedRevision: job.revision, payload: {} } }) : await decline.run({ params, body: { expectedRevision: job.revision, payload: reason.trim() ? { reason: reason.trim() } : {} } });
        if (result.ok) { setDestination(kind === "decline" ? "back" : isTakeover ? `/f/jobs/${job.jobId}` : `/f/jobs/${job.jobId}/quote`); return "confirmed"; }
        return "delivery" in result.error && result.error.delivery === "unknown" ? "uncertain" : "invalidated";
      } });
  }
  const state = !jobId ? "error" : remote.status;
  return <IntakeView job={job} status={state} offline={offline} declining={declining} reason={reason} setReason={setReason} onDeclining={setDeclining} busy={[accept.state, decline.state].some(s => s === "sending" || s === "checking")} checking={[accept.state, decline.state].includes("checking")} failed={[accept.state, decline.state].some(s => s === "failed" || s === "conflict")} onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} onAccept={() => confirm("accept")} onDecline={() => confirm("decline")} onNavigate={path => router.push(path as Href)} />;
}
export function IntakeView({ job, status, offline, declining, reason, setReason, onDeclining, busy, checking, failed, onBack, onRetry, onAccept, onDecline, onNavigate }: { job: Intake | null; status: Status; offline: boolean; declining: boolean; reason: string; setReason: (value: string) => void; onDeclining: (value: boolean) => void; busy: boolean; checking: boolean; failed: boolean; onBack: () => void; onRetry: () => void; onAccept: () => void; onDecline: () => void; onNavigate: (path: string) => void }) {
  const t = useT(); const format = useFormat(); const takeover = !!job?.handoff.from;
  const available = !!job && job.reply === "available" && job.handoff.state === "offered" && !offline && !busy;
  const dock = job && status === "ready" && (job.reply === "available" || job.reply === "authority_missing") ? declining ? <Dock context={t("mobile.foremanHome.declineEffect")} primary={{ label: t("mobile.foremanHome.confirmDecline"), onPress: onDecline, disabled: !available }} secondary={{ label: t("mobile.foremanHome.cancel"), onPress: () => onDeclining(false), disabled: busy }} /> : <Dock context={job.reply === "authority_missing" ? t("mobile.foremanHome.authority") : takeover ? t("mobile.foremanHome.takeoverEffect") : t("mobile.foremanHome.effect")} primary={{ label: takeover ? t("mobile.foremanHome.takeoverAction") : t("mobile.foremanHome.accept"), onPress: onAccept, disabled: !available }} secondary={job.chatThreadId ? { label: t("mobile.foremanHome.ask"), onPress: () => onNavigate(`/chat/${job.chatThreadId}`) } : undefined} /> : undefined;
  const originalLabel = job ? t("mobile.foremanHome.original", { language: job.request.originalLanguage ?? t("mobile.foremanHome.unknownLanguage") }) : "";
  return <Screen title={takeover ? t("mobile.foremanHome.takeover") : t("mobile.foremanHome.newJob")} navigation={{ kind: "back", label: t("mobile.foremanHome.back"), onPress: onBack }} dock={dock}>
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.foremanHome.loading")}</Copy>}
    {status === "offline" && <Copy>{t("mobile.foremanHome.offline")}</Copy>}
    {(status === "error" || (status === "ready" && !job)) && <><Copy>{t("mobile.foremanHome.unavailable")}</Copy><Button label={t("mobile.foremanHome.retry")} onPress={onRetry} /></>}
    {job && status === "ready" && <>
      <Copy variant="supporting">{job.reference} · {job.town}</Copy>
      {offline && <Copy>{t("mobile.foremanHome.offline")}</Copy>}{checking && <Copy>{t("mobile.foremanHome.checking")}</Copy>}{failed && !checking && <Copy>{t("mobile.foremanHome.failed")}</Copy>}
      {job.reply === "authority_missing" && <><Copy>{t("mobile.foremanHome.authority")}</Copy><Button variant="quiet" label={t("mobile.foremanHome.help")} onPress={() => onNavigate("/help")} /></>}
      {job.reply === "closed_elsewhere" && <Copy>{t("mobile.foremanHome.closedElsewhere")}</Copy>}{(job.reply === "closed" || job.handoff.state !== "offered") && <Copy>{t("mobile.foremanHome.closed")}</Copy>}
      {takeover && <Card><Copy>{t("mobile.foremanHome.replyBy", { time: siteTime(format, job.handoff.expiresAt, job.siteZone) })}</Copy><Copy>{t("mobile.foremanHome.incumbent", { name: job.handoff.from!.displayName })}</Copy></Card>}
      {job.request.originalText ? job.request.translation?.status === "ready" ? <TwinCard state="translated" title={t("mobile.foremanHome.requestFrom", { name: job.customerName, time: siteTime(format, job.request.submitted.at, job.siteZone) })} original={{ text: job.request.originalText, label: originalLabel }} translation={{ text: job.request.translation.text, label: t("mobile.foremanHome.translation", { language: job.request.translation.language }) }} /> : job.request.translation ? <TwinCard state={job.request.translation.status} title={t("mobile.foremanHome.requestFrom", { name: job.customerName, time: siteTime(format, job.request.submitted.at, job.siteZone) })} original={{ text: job.request.originalText, label: originalLabel }} status={job.request.translation.status === "pending" ? t("mobile.foremanHome.pendingTranslation") : t("mobile.foremanHome.unavailableTranslation")} /> : <TwinCard state="original" title={t("mobile.foremanHome.requestFrom", { name: job.customerName, time: siteTime(format, job.request.submitted.at, job.siteZone) })} original={{ text: job.request.originalText, label: originalLabel }} /> : <Copy>{t("mobile.foremanHome.voiceOnly")}</Copy>}
      <Card>{job.request.photos.map(photo => <ListRow key={photo.attachmentId} label={t("mobile.foremanHome.photos", { count: job.request.photos.length })} onPress={photo.availability === "available" ? () => onNavigate(`/media/${photo.attachmentId}`) : undefined} />)}<ListRow label={job.town} description={t("mobile.foremanHome.addressHidden")} /></Card>
      {job.handoff.offeredBy && <Copy variant="supporting">{t("mobile.foremanHome.offeredBy", { name: job.handoff.offeredBy })}</Copy>}
      {job.reply === "available" && !declining && <Button variant="quiet" label={t("mobile.foremanHome.decline")} onPress={() => onDeclining(true)} disabled={!available} />}
      {declining && <TextField label={t("mobile.foremanHome.reason")} value={reason} onChangeText={setReason} multiline maxLength={500} disabled={busy} />}
    </>}
  </Screen>;
}
