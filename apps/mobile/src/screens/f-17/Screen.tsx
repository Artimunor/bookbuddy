import { attachmentIdSchema, getJobRoute, getVisitLiveRoute, idSchema, localeTagSchema, publishVisitUpdateRoute, type ForemanVisitControl } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { useCommand, useRemote } from "../../api";
import type { CommandStatus, RemoteStatus } from "../../api/requests";
import { useFormat, useLocale, useT } from "../../i18n";
import { useAttach, useOpenMediaPreview, type MediaTransfer } from "../../media";
import { useRepository, useVisibilityGeneration } from "../../repository/hooks";
import type { ScopedRepository } from "../../repository";
import { useSession } from "../../session";
import { Button, Card, Dock, Sheet, StatusBanner, TextField } from "../../ui/controls";
import { Copy, Target, controlMetrics } from "../../ui/controls/shared";
import { LiveCapsule, Stamp } from "../../ui/live";
import { useBeaconTheme } from "../../ui/theme";
import { AttachmentTiles, PhotoTile, useAttachNavigation } from "../c-02/attachments";
import { useLocalDraft } from "../f-04/draft";
import { foremanWindow } from "../f-06/clock";
import { confirmAction } from "../s-17/confirmAction";

type Kind = "on_the_way" | "arrival_revised" | "paused" | "photo";
type PhotoPayload = { kind: "photo"; attachmentId: string; progressEventId?: string; caption?: { text: string; language: string } };
type Payload = { kind: "on_the_way"; band: { startsAt: number; endsAt: number } } | { kind: "arrival_revised"; correctsId: string; band: { startsAt: number; endsAt: number } } | { kind: "arrival_withdrawn"; correctsId: string } | { kind: "paused" } | PhotoPayload;
type PhotoDraft = { stage: string; previousStage?: string; caption: string; language: string };
const emptyPhoto: PhotoDraft = { stage: "", caption: "", language: "" };
type PhotoView = {
  source?: { attachmentId: string; progressEventId?: string; uri?: string | null; at: number; ready: boolean };
  upload?: MediaTransfer; caption: string; language: string; author?: string; error?: boolean;
  onAdd?: () => void; onOpen?: () => void; onRetry?: () => void;
  onCaption: (caption: string) => void; onLanguage: (language: string) => void;
};
export default function ShareUpdateScreen() {
  const { jobId, visitId: rawVisit, progressEventId: rawProgress, attachmentId: rawAttachment, shiftId: rawShift } = useLocalSearchParams<{ jobId: string; visitId?: string; progressEventId?: string; attachmentId?: string; shiftId?: string }>();
  const router = useRouter(); const { bootstrap, session } = useSession(); const t = useT(); const [focused, setFocused] = useState(false);
  const repo = useRepository(); const visibility = useVisibilityGeneration(repo);
  const { locale } = useLocale(); const navigation = useAttachNavigation(); const open = useOpenMediaPreview();
  const hint = idSchema.safeParse(rawVisit).data;
  const progressId = idSchema.safeParse(rawProgress).data; const progressAttachment = attachmentIdSchema.safeParse(rawAttachment).data; const shiftId = idSchema.safeParse(rawShift).data;
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const jobRead = useRemote(getJobRoute, { params: { j: jobId ?? "" }, query: { view: "whole" } }, { enabled: !!jobId && !hint });
  const job = jobRead.data?.audience === "foreman" && jobRead.data.job.view === "whole" ? jobRead.data.job : null;
  const visitId = hint ?? job?.nextVisit?.visitId;
  const visitRead = useRemote(getVisitLiveRoute, { params: { id: visitId ?? "" } }, { enabled: !!visitId });
  const current = visitRead.data && "workGate" in visitRead.data && visitRead.data.job.id === jobId ? visitRead.data : null;
  const status = hint ? visitRead.status : jobRead.status !== "ready" ? jobRead.status : !visitId ? "error" : visitRead.status;
  const [last, setLast] = useState<{ data: ForemanVisitControl; repo: ScopedRepository | null; visibility: number }>();
  useEffect(() => { if (current) setLast({ data: current, repo, visibility }); }, [current, repo, visibility]);
  const data = current ?? (status === "offline" && last?.repo === repo && last?.visibility === visibility && last.data.job.id === jobId ? last.data : null);
  const photoDraft = useLocalDraft<PhotoDraft>(`share-photo:${data?.visitId ?? visitId ?? "missing"}:${progressId ?? "direct"}`, emptyPhoto);
  const { stage, previousStage } = photoDraft.value;
  const media = useAttach(data && stage ? "update" : undefined, stage ? data?.visitId : undefined);
  const selected = media.items.filter(item => item.selected && item.file.kind === "photo");
  const upload = selected.find(item => item.stageId === stage) ?? selected.find(item => item.stageId === previousStage);
  const useProgress = !upload && !!(progressId && progressAttachment && shiftId);
  const command = useCommand(publishVisitUpdateRoute, { resourceId: data?.visitId ?? visitId });
  const [mediaFailed, setMediaFailed] = useState(false);
  const photo: PhotoView = {
    source: useProgress ? { attachmentId: progressAttachment!, progressEventId: progressId, at: Date.now(), ready: true } : upload ? { attachmentId: upload.attachmentId, uri: upload.fileUri, at: upload.capturedAt ?? Date.now(), ready: media.loaded && upload.state === "ready" } : undefined,
    upload: useProgress ? undefined : upload, caption: photoDraft.value.caption, language: photoDraft.value.language || locale, author: bootstrap?.account.displayName ?? undefined, error: mediaFailed || photoDraft.failed,
    onCaption: caption => photoDraft.change({ ...photoDraft.value, caption }), onLanguage: language => photoDraft.change({ ...photoDraft.value, language }),
    onOpen: useProgress ? () => open(progressAttachment!, { caller: "progress", parentScopeId: shiftId! }, { titleContext: data?.job.reference }) : upload?.fileUri ? () => navigation.preview(upload.attachmentId) : undefined,
    onRetry: upload?.state === "failed" && !upload.terminal ? () => { void media.retry(upload.attachmentId).catch(() => setMediaFailed(true)); } : undefined,
    onAdd: data?.permittedUpdates.includes("photo") ? () => {
      const next = !stage || upload?.stageId === stage ? uuid.v4() : stage;
      photoDraft.change({ ...photoDraft.value, stage: next, previousStage: upload?.stageId });
      navigation.attach("update", data.visitId, next);
    } : undefined,
  };
  async function publish(payload: Payload) {
    if (!current || status !== "ready" || command.state === "sending" || (command.state === "checking" && payload.kind !== "photo") || !current.permittedUpdates.includes(payload.kind)) return false;
    const result = await command.run({ params: { id: current.visitId }, body: { expectedRevision: current.revision, payload: { ...payload, id: payload.kind === "photo" ? payload.attachmentId : uuid.v4() } } });
    if (result.ok) { if (payload.kind === "photo") await photoDraft.remove().catch(() => {}); router.back(); return true; }
    return false;
  }
  function retract() {
    const arrival = data?.customerPreview.live.arrival; if (!data || !arrival || status !== "ready" || !data.permittedUpdates.includes("arrival_withdrawn")) return;
    confirmAction(router, { title: t("mobile.jobControl.retracted"), actionLabel: t("mobile.jobControl.retracted"), actionLabelKey: "mobile.jobControl.retracted", item: data.job.reference, actor: bootstrap?.account.displayName ?? "", role: session?.activeContext?.businessName ?? "", effects: [t("mobile.jobControl.append")], destructive: true, onReview: () => {}, onConfirm: async () => { const result = await command.run({ params: { id: data.visitId }, body: { expectedRevision: data.revision, payload: { id: uuid.v4(), kind: "arrival_withdrawn", correctsId: arrival.id } } }); if (result.ok) { await visitRead.refresh(); return "confirmed"; } return result.error.code === "INTERNAL_ERROR" || ("delivery" in result.error && result.error.delivery === "unknown") ? "uncertain" : "invalidated"; } });
  }
  return <ShareUpdateView key={data?.visitId ?? "loading"} visible={focused} data={data} status={status} commandState={command.state} initialKind={useProgress || upload ? "photo" : undefined} photo={photo} author={bootstrap?.account.displayName ?? undefined} providerName={session?.activeContext?.businessName ?? undefined} onClose={() => router.back()} onRetry={() => { if (!hint && !visitId) void jobRead.refresh(); else if (visitId) void visitRead.refresh(); }} onSend={payload => { void publish(payload); }} onRetract={retract} />;
}
export function ShareUpdateView({ visible = true, data, status, commandState, onClose, onRetry, onSend, onRetract, photo, initialKind, initialBand, now: fixedNow, author, providerName }: {
  visible?: boolean; data: ForemanVisitControl | null; status: RemoteStatus; commandState: CommandStatus;
  onClose: () => void; onRetry: () => void; onSend: (payload: Payload) => void; onRetract: () => void; photo?: PhotoView;
  initialKind?: Kind; initialBand?: { startsAt: number; endsAt: number }; now?: number; author?: string; providerName?: string;
}) {
  const t = useT(); const format = useFormat();
  const { color, radius, field, space } = useBeaconTheme();
  const { fontScale } = useWindowDimensions();
  const previous = data?.customerPreview.live.arrival;
  const now = fixedNow ?? Date.now();
  const [kind, setKind] = useState<Kind>(initialKind ?? (previous && data?.permittedUpdates.includes("arrival_revised") ? "arrival_revised" : data?.permittedUpdates.includes("on_the_way") ? "on_the_way" : "paused"));
  useEffect(() => { if (initialKind === "photo") setKind("photo"); }, [initialKind]);
  const [band, setBand] = useState(() => initialBand ?? previous?.band ?? { startsAt: Math.ceil(now / 300000) * 300000 + 600000, endsAt: Math.ceil(now / 300000) * 300000 + 1200000 });
  const timing = data ? foremanWindow(format, band, data.siteZone, data.customerZone) : null;
  const beforeTiming = data && previous ? foremanWindow(format, previous.band, data.siteZone, data.customerZone) : null;
  const at = (instant: number) => {
    const value = format.siteTime(instant, data?.siteZone);
    return value.kind === "available" ? value.site.time : "";
  };
  const options: { kind: Kind; label: string; glyph: string }[] = [
    { kind: "on_the_way", label: t("mobile.jobControl.onWay"), glyph: "»" }, { kind: "arrival_revised", label: t("mobile.jobControl.late"), glyph: "◷" },
    { kind: "paused", label: t("mobile.jobControl.paused"), glyph: "Ⅱ" }, { kind: "photo", label: t("mobile.jobControl.photo"), glyph: "▧" },
  ];
  const label = options.find(option => option.kind === kind)?.label ?? "";
  const caption = photo?.caption.trim() ?? ""; const language = photo?.language.trim() ?? "";
  const captionValid = !caption || localeTagSchema.safeParse(language).success;
  const source = photo?.source;
  const locked = commandState === "sending" || commandState === "checking";
  const allowed = !!data && data.permittedUpdates.includes(kind) && (kind !== "arrival_revised" || !!previous) && status === "ready" && commandState !== "sending" &&
    (kind === "photo" ? !!source?.ready && captionValid : commandState !== "checking" && (kind === "paused" || band.endsAt > now));
  const send = () => {
    if (!allowed) return;
    if (kind === "on_the_way") onSend({ kind, band });
    else if (kind === "arrival_revised" && previous) onSend({ kind, band, correctsId: previous.id });
    else if (kind === "paused") onSend({ kind });
    else if (kind === "photo" && source) onSend({ kind, attachmentId: source.attachmentId, ...(source.progressEventId && { progressEventId: source.progressEventId }), ...(caption && { caption: { text: caption, language } }) });
  };
  const context = status === "offline" ? t("mobile.photos.connectShare") : kind !== "photo" ? !allowed && !locked ? t("mobile.jobControl.unavailableType") : t("mobile.jobControl.shareLive") : !data?.permittedUpdates.includes("photo") ? t("mobile.jobControl.unavailableType") : !captionValid ? t("mobile.photos.invalidLanguage") : !source ? t("mobile.photos.addPhoto") : !source.ready ? t("mobile.photos.wait") : t("mobile.photos.sharePrivacy");
  const actionLabel = kind === "photo" ? commandState === "checking" ? t("mobile.request.checkStatus") : t("mobile.photos.sharePhoto") :
    kind === "arrival_revised" ? t("mobile.jobControl.shareNewTime") : t("mobile.jobControl.shareKind", { kind: label });
  const steps = [t("mobile.liveVisit.stepConfirmed"), t("mobile.liveVisit.stepWay"), t("mobile.liveVisit.stepSite"), t("mobile.liveVisit.working"), t("mobile.liveVisit.stepFinished")] as const;
  const stage = kind !== "paused" ? 1 : data?.customerPreview.live.step === "finished" ? 4 : data?.customerPreview.live.step === "working" ? 3 : data?.customerPreview.live.step === "on_site" ? 2 : data?.customerPreview.live.step === "on_the_way" ? 1 : 0;
  const step = t("mobile.liveVisit.step", { step: stage + 1, stage: steps[stage] });
  const provenance = author ? t("mobile.liveVisit.shared", { name: author, time: at(now) }) : "";
  const viewer = timing?.customerTime ? t("mobile.liveVisit.yourTime", { time: timing.customerTime }) : null;
  const customerTime = timing?.customerTime && data ? t("mobile.jobControl.forCustomerTime", { time: timing.customerTime, name: data.customerName }) : null;
  const subtitle = data ? `${t("mobile.jobControl.to", { name: data.customerName })} · ${data.job.reference}` : undefined;
  return <Sheet visible={visible} title={t("mobile.jobControl.shareTitle")} subtitle={subtitle} closeLabel={t("mobile.crew.close")} onClose={onClose} dock={data ? <Dock context={context} primary={{ label: actionLabel, onPress: send, disabled: !allowed, busy: commandState === "sending", live: true }} /> : undefined}>
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.foremanHome.loading")}</Copy>}
    {(status === "error" || status === "offline") && <StatusBanner state={status === "offline" ? "offline" : "not-sent"} label={status === "offline" ? t("mobile.foremanHome.offline") : t("mobile.jobControl.error")} action={{ label: t("mobile.foremanHome.retry"), onPress: onRetry }} />}
    {commandState === "checking" && <Copy accessibilityLiveRegion="polite">{t("mobile.jobControl.checking")}</Copy>}{(commandState === "failed" || commandState === "conflict") && <Copy>{t("mobile.jobControl.failed")}</Copy>}
    {commandState === "done" && <Copy>{t("mobile.jobControl.sent")}</Copy>}
    {data && <>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("mobile.jobControl.shareTitle")} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.grid[field ? 4 : 2] }}>
        {options.map(option => {
          const selected = option.kind === kind;
          const unavailable = !data.permittedUpdates.includes(option.kind);
          const disabled = locked || unavailable;
          return <Target key={option.kind} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} accessibilityLabel={option.label}
            accessibilityHint={unavailable ? t("mobile.jobControl.unavailableType") : undefined} disabled={disabled} onPress={() => setKind(option.kind)}
            style={({ pressed }) => ({ flexGrow: 1, flexBasis: fontScale >= 1.25 ? "100%" : "44%", minHeight: controlMetrics(field).primaryActionMinHeight, borderRadius: radius.input, borderWidth: controlMetrics(field).controlBorderWidth, borderColor: selected ? color.brand : color.outline, backgroundColor: selected ? pressed ? color.brandPressed : color.brand : unavailable || pressed ? color.subtle : color.surface, paddingHorizontal: space.grid[3], paddingVertical: space.grid[2], flexDirection: "row", alignItems: "center", gap: space.grid[2] })}>
            <Copy aria-hidden variant="label" style={{ color: selected ? color.onBrand : color.muted }}>{option.glyph}</Copy>
            <Copy variant="supporting" style={{ color: selected ? color.onBrand : unavailable ? color.muted : color.ink, flexShrink: 1 }}>{option.label}</Copy>
          </Target>;
        })}
      </View>
    {kind === "photo" ? <>
      <Card dense>
        {source && <><PhotoTile label={t("mobile.jobControl.photo")} uri={source.uri} onOpen={photo?.onOpen} />
          {!source.progressEventId && <Copy variant="supporting">{t("mobile.photos.taken", { time: at(source.at) })}</Copy>}
        </>}
        {photo?.onAdd && <Button variant="neutral" label={source ? t("mobile.photos.replacePhoto") : t("mobile.photos.addPhoto")} onPress={photo.onAdd} disabled={locked} />}
        {photo?.upload && !source?.ready && <AttachmentTiles items={[photo.upload]} offline={status === "offline"} onRetry={locked || !photo.onRetry ? undefined : photo.onRetry} />}
        {photo && <TextField label={t("mobile.photos.caption")} multiline maxLength={500} value={photo.caption} onChangeText={photo.onCaption} disabled={locked} />}
        {photo && !!caption && <TextField label={t("mobile.request.language")} value={photo.language} autoCapitalize="none" maxLength={255} onChangeText={photo.onLanguage} disabled={locked} />}
        {photo?.error && <Copy accessibilityRole="alert">{t("mobile.photos.failed")}</Copy>}
      </Card>
      {source && <><Copy variant="sectionTitle">{t("mobile.jobControl.preview")}</Copy>
        <Stamp kind="photo" title={t("mobile.photos.photoShared")} time={at(now)} attribution={photo?.author} detail={caption}
          photo={source.uri ? { source: { uri: source.uri }, accessibilityLabel: t("mobile.jobControl.photo") } : undefined} />
        {!!caption && <Copy variant="supporting">{t("mobile.photos.captionOriginal")}</Copy>}
      </>}
      {status === "offline" && source && <Copy variant="supporting">{t("mobile.photos.notShared")}</Copy>}
      <Copy variant="supporting">{t("mobile.photos.sharePrivacy")}</Copy>
    </> : kind === "paused" ? <Card dense><Copy>{t("mobile.jobControl.pauseNotice")}</Copy></Card> : <>
      {kind === "arrival_revised" && previous && beforeTiming && <View style={{ borderRadius: radius.input, backgroundColor: color.subtle, padding: space.grid[3], gap: space.grid[1] }}>
        <Copy variant="label">{t("mobile.jobControl.was")}</Copy>
        <Copy variant="supporting">{beforeTiming.time} · {t("mobile.jobControl.sharedAt", { name: previous.sharedByName, time: at(previous.recordedAt) })}</Copy>
      </View>}
      <Card dense>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.grid[2] }}>
          <View style={{ flex: 1, minWidth: 120 }}>
            <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.jobControl.arriving")}</Copy>
            <Copy variant="pageTitle" style={{ fontVariant: ["tabular-nums"] }}>{timing?.time}</Copy>
          </View>
          <Button variant="neutral" label={t("mobile.jobControl.earlier")} glyph="−" iconOnly disabled={locked} onPress={() => setBand(current => ({ startsAt: current.startsAt - 300000, endsAt: current.endsAt - 300000 }))} />
          <Button variant="neutral" label={t("mobile.jobControl.later")} glyph="+" iconOnly disabled={locked} onPress={() => setBand(current => ({ startsAt: current.startsAt + 300000, endsAt: current.endsAt + 300000 }))} />
        </View>
        <Copy variant="supporting" style={{ color: color.muted }}>{[timing?.zone, customerTime].filter(Boolean).join(" · ")}</Copy>
        {kind === "arrival_revised" && data.permittedUpdates.includes("arrival_withdrawn") && <Button variant="quiet" label={t("mobile.jobControl.retracted")} disabled={locked || status !== "ready"} onPress={onRetract} />}
      </Card>
    </>}
    {kind !== "photo" && <>
      <Copy variant="sectionTitle">{t("mobile.jobControl.preview")}</Copy>
      <LiveCapsule state={kind === "paused" ? "paused" : "onTheWay"} stateLabel={kind === "paused" ? t("mobile.liveVisit.paused") : t("mobile.liveVisit.onWay")}
        source={providerName ?? data.job.title ?? data.job.reference} reference={data.job.reference} time={kind === "paused" ? undefined : timing?.time}
        zoneLine={kind === "paused" ? timing?.zone : [timing?.zone, viewer].filter(Boolean).join(" · ")} provenance={provenance}
        accessibilityLabel={[label, kind === "paused" ? undefined : timing?.time, timing?.zone, kind === "paused" ? undefined : viewer, step, provenance].filter(Boolean).join(", ")}
        line={{ kind: "visit", steps, ...(stage === 1 ? { current: 1 as const } : { current: stage }), accessibilityLabel: step, compact: true }} />
    </>}
    <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.jobControl.noLocation")}</Copy><Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.jobControl.append")}</Copy></>}
  </Sheet>;
}
