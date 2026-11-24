import { acceptJobHandoffRoute, declineJobHandoffRoute, getHandoffRoute, type RouteResponse } from "@bookbuddy/api-contract";
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { useCommand, useRemote } from "../../api";
import { useFormat, useLocale, useT } from "../../i18n";
import { useSession } from "../../session";
import { Button, Card, Dock, ListRow, Screen, StatusBanner, TextField, TwinCard } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { useOffline } from "../s-02/flow";
import { confirmAction } from "../s-17/confirmAction";
import { siteTime } from "../f-01/Screen";

type Intake = RouteResponse<typeof getHandoffRoute.output>["job"];
type Status = "idle" | "loading" | "ready" | "error" | "offline";
export default function IntakeScreen() {
  const { handoffId } = useLocalSearchParams<{ handoffId: string }>();
  const remote = useRemote(getHandoffRoute, { params: { h: handoffId ?? "" } }, { enabled: !!handoffId });
  const accept = useCommand(acceptJobHandoffRoute, { resourceId: handoffId });
  const decline = useCommand(declineJobHandoffRoute, { resourceId: handoffId });
  const router = useRouter(); const { bootstrap } = useSession(); const offline = useOffline(); const t = useT();
  const [reason, setReason] = useState(""); const [declining, setDeclining] = useState(false); const [destination, setDestination] = useState<string | null>(null);
  const job = remote.data?.job.handoff.handoffId === handoffId ? remote.data?.job ?? null : null;
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
  const state = !handoffId ? "error" : remote.status;
  return <IntakeView job={job} status={state} offline={offline} declining={declining} reason={reason} setReason={setReason} onDeclining={setDeclining} busy={[accept.state, decline.state].some(s => s === "sending" || s === "checking")} checking={[accept.state, decline.state].includes("checking")} failed={[accept.state, decline.state].some(s => s === "failed" || s === "conflict")} onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} onAccept={() => confirm("accept")} onDecline={() => confirm("decline")} onNavigate={path => router.push(path as Href)} />;
}
export function IntakeView({ job, status, offline, declining, reason, setReason, onDeclining, busy, checking, failed, onBack, onRetry, onAccept, onDecline, onNavigate }: { job: Intake | null; status: Status; offline: boolean; declining: boolean; reason: string; setReason: (value: string) => void; onDeclining: (value: boolean) => void; busy: boolean; checking: boolean; failed: boolean; onBack: () => void; onRetry: () => void; onAccept: () => void; onDecline: () => void; onNavigate: (path: string) => void }) {
  const t = useT(); const format = useFormat(); const { locale } = useLocale();
  const { color, radius, space } = useBeaconTheme();
  const takeover = job?.handoff.from;
  const chat = job?.chatThreadId;
  const available = !!job && job.reply === "available" && job.handoff.state === "offered" && !offline && !busy;
  const dock = job && status === "ready" && (job.reply === "available" || job.reply === "authority_missing") ?
    declining ? <Dock context={t("mobile.foremanHome.declineEffect")} primary={{ label: t("mobile.foremanHome.confirmDecline"), onPress: onDecline, disabled: !available }} secondary={{ label: t("mobile.foremanHome.cancel"), onPress: () => onDeclining(false), disabled: busy }} /> :
    <Dock context={offline ? t("mobile.foremanHome.offline") : job.reply === "authority_missing" ? t("mobile.foremanHome.authority") : takeover ? t("mobile.foremanHome.takeoverEffect") : t("mobile.foremanHome.acceptNamed", { name: job.customerName })}
      primary={{ label: takeover ? t("mobile.foremanHome.takeoverAction") : t("mobile.foremanHome.accept"), onPress: onAccept, disabled: !available }}
      secondary={takeover && available ? { label: t("mobile.foremanHome.confirmDecline"), onPress: () => onDeclining(true) } : chat ? { label: t("mobile.foremanHome.askNamed", { name: job.customerName }), onPress: () => onNavigate(`/chat/${chat}`) } : undefined} /> : undefined;
  const request = job?.request;
  const translation = request?.translation;
  const languages = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(locale, { type: "language", fallback: "none" }) : null;
  const language = (tag: string | null | undefined) => {
    try { return tag ? languages?.of(tag) : undefined; } catch { return undefined; }
  };
  const originalName = language(request?.originalLanguage);
  const translationName = translation?.status === "ready" ? language(translation.language) : undefined;
  const unknownLanguage = t("mobile.foremanHome.unknownLanguage");
  const requestTitle = job && request ? t("mobile.foremanHome.requestFrom", { name: job.customerName, time: siteTime(format, request.submitted.at, job.siteZone) }) : undefined;
  const original = { text: request?.originalText ?? "", label: t("mobile.foremanHome.original", { language: originalName ?? unknownLanguage }) };
  const expiry = job ? format.lines(job.handoff.expiresAt, job.siteZone)?.site : null;
  return <Screen title={takeover ? t("mobile.foremanHome.takeover") : t("mobile.foremanHome.newJob")} subtitle={job ? `${job.reference} · ${job.town}` : undefined} navigation={{ kind: "back", label: t("mobile.foremanHome.back"), onPress: onBack }} dock={dock}>
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.foremanHome.loading")}</Copy>}
    {status === "offline" && <Copy>{t("mobile.foremanHome.offline")}</Copy>}
    {(status === "error" || (status === "ready" && !job)) && <><Copy>{t("mobile.foremanHome.unavailable")}</Copy><Button label={t("mobile.foremanHome.retry")} onPress={onRetry} /></>}
    {job && status === "ready" && <>
      {offline && <StatusBanner state="offline" label={t("mobile.foremanHome.offline")} />}{checking && <Copy accessibilityLiveRegion="polite">{t("mobile.foremanHome.checking")}</Copy>}{failed && !checking && <Copy>{t("mobile.foremanHome.failed")}</Copy>}
      {job.reply === "authority_missing" && <StatusBanner state="not-sent" label={t("mobile.foremanHome.authority")} action={{ label: t("mobile.foremanHome.help"), onPress: () => onNavigate("/help") }} />}
      {job.reply === "closed_elsewhere" && <Copy>{t("mobile.foremanHome.closedElsewhere")}</Copy>}{(job.reply === "closed" || job.handoff.state !== "offered") && <Copy>{t("mobile.foremanHome.closed")}</Copy>}
      {takeover && <><StatusBanner state="offline" label={expiry ? t("mobile.foremanHome.replyBy", { time: expiry }) : t("mobile.foremanHome.takeover")} /><Card dense><Copy>{t("mobile.foremanHome.incumbent", { name: takeover.displayName })}</Copy></Card></>}
      {originalName && translationName && <Copy variant="supporting" style={{ color: color.muted, backgroundColor: color.subtle, borderRadius: radius.input, padding: space.grid[3] }}>
        {t("mobile.foremanHome.requestLanguages", { readerLanguage: translationName, name: job.customerName, originalLanguage: originalName })}
      </Copy>}
      {request && (request.originalText ? translation?.status === "ready" ?
        <TwinCard state="translated" title={requestTitle} original={original} translation={{ text: translation.text, label: t("mobile.foremanHome.translation", { language: translationName ?? unknownLanguage }) }} /> :
        translation ? <TwinCard state={translation.status} title={requestTitle} original={original} status={translation.status === "pending" ? t("mobile.foremanHome.pendingTranslation") : t("mobile.foremanHome.unavailableTranslation")} /> :
        <TwinCard state="original" title={requestTitle} original={original} /> : <Copy>{t("mobile.foremanHome.voiceOnly")}</Copy>)}
      <Card dense>
        {request?.photos.map((photo, index) => <ListRow key={photo.attachmentId} glyph="▧" label={t("mobile.foremanHome.requestPhoto", { number: index + 1, count: request.photos.length })}
          onPress={photo.availability === "available" ? () => onNavigate(`/media/${photo.attachmentId}`) : undefined} />)}
        <ListRow glyph="⌖" label={job.town} description={t("mobile.foremanHome.addressHidden")} />
      </Card>
      {job.reply === "available" && !declining && !takeover && <Button variant="quiet" label={t("mobile.foremanHome.decline")} onPress={() => onDeclining(true)} disabled={!available} />}
      {job.handoff.offeredBy && <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.foremanHome.offeredBy", { name: job.handoff.offeredBy })}</Copy>}
      {declining && <TextField label={t("mobile.foremanHome.reason")} value={reason} onChangeText={setReason} multiline maxLength={500} disabled={busy} />}
    </>}
  </Screen>;
}
