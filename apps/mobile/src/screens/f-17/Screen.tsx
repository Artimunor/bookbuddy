import { attachmentIdSchema, getJobRoute, getVisitLiveRoute, idSchema, localeTagSchema, publishVisitUpdateRoute, type ForemanVisitControl } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import type { CommandStatus, RemoteStatus } from "../../api/requests";
import { useLocale, useT } from "../../i18n";
import { useAttach, useOpenMediaPreview, type MediaTransfer } from "../../media";
import { useRepository, useVisibilityGeneration } from "../../repository/hooks";
import type { ScopedRepository } from "../../repository";
import { useSession } from "../../session";
import { Button, Card, Dock, Sheet, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ArrivalBand, LiveCapsule, Stamp } from "../../ui/live";
import { AttachmentTiles, PhotoTile, useAttachNavigation } from "../c-02/attachments";
import { useLocalDraft } from "../f-04/draft";
import { clockTime } from "../f-05/Screen";
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
  return <ShareUpdateView key={data?.visitId ?? "loading"} visible={focused} data={data} status={status} commandState={command.state} initialKind={useProgress || upload ? "photo" : undefined} photo={photo} onClose={() => router.back()} onRetry={() => { if (!hint && !visitId) void jobRead.refresh(); else if (visitId) void visitRead.refresh(); }} onSend={payload => { void publish(payload); }} onRetract={retract} />;
}
export function ShareUpdateView({ visible = true, data, status, commandState, onClose, onRetry, onSend, onRetract, photo, initialKind, initialBand }: { visible?: boolean; data: ForemanVisitControl | null; status: RemoteStatus; commandState: CommandStatus; onClose: () => void; onRetry: () => void; onSend: (payload: Payload) => void; onRetract: () => void; photo?: PhotoView; initialKind?: Kind; initialBand?: { startsAt: number; endsAt: number } }) {
  const t = useT(), { locale } = useLocale(); const previous = data?.customerPreview.live.arrival;
  const [kind, setKind] = useState<Kind>(initialKind ?? (previous && data?.permittedUpdates.includes("arrival_revised") ? "arrival_revised" : data?.permittedUpdates.includes("on_the_way") ? "on_the_way" : "paused"));
  useEffect(() => { if (initialKind === "photo") setKind("photo"); }, [initialKind]);
  const [band, setBand] = useState(() => initialBand ?? previous?.band ?? { startsAt: Math.ceil(Date.now() / 300000) * 300000 + 600000, endsAt: Math.ceil(Date.now() / 300000) * 300000 + 1200000 });
  const at = (time: number) => clockTime(time, data?.siteZone ?? "UTC", locale); const range = `${at(band.startsAt)} – ${at(band.endsAt)}`;
  const options: { kind: Kind; label: string }[] = [{ kind: "on_the_way", label: t("mobile.jobControl.onWay") }, { kind: "arrival_revised", label: t("mobile.jobControl.late") }, { kind: "paused", label: t("mobile.jobControl.paused") }, { kind: "photo", label: t("mobile.jobControl.photo") }];
  const label = options.find(option => option.kind === kind)?.label ?? "";
  const caption = photo?.caption.trim() ?? ""; const language = photo?.language.trim() ?? "";
  const captionValid = !caption || localeTagSchema.safeParse(language).success;
  const source = photo?.source;
  const locked = commandState === "sending" || commandState === "checking";
  const allowed = !!data && data.permittedUpdates.includes(kind) && (kind !== "arrival_revised" || !!previous) && status === "ready" && commandState !== "sending" &&
    (kind === "photo" ? !!source?.ready && captionValid : commandState !== "checking" && (kind === "paused" || band.endsAt > Date.now()));
  const send = () => {
    if (!allowed) return;
    if (kind === "on_the_way") onSend({ kind, band });
    else if (kind === "arrival_revised" && previous) onSend({ kind, band, correctsId: previous.id });
    else if (kind === "paused") onSend({ kind });
    else if (kind === "photo" && source) onSend({ kind, attachmentId: source.attachmentId, ...(source.progressEventId && { progressEventId: source.progressEventId }), ...(caption && { caption: { text: caption, language } }) });
  };
  const context = status === "offline" ? t("mobile.photos.connectShare") : kind !== "photo" ? !allowed ? t("mobile.jobControl.unavailableType") : t("mobile.jobControl.noLocation") : !data?.permittedUpdates.includes("photo") ? t("mobile.jobControl.unavailableType") : !captionValid ? t("mobile.photos.invalidLanguage") : !source ? t("mobile.photos.addPhoto") : !source.ready ? t("mobile.photos.wait") : t("mobile.photos.sharePrivacy");
  return <Sheet visible={visible} title={t("mobile.jobControl.shareTitle")} closeLabel={t("mobile.crew.close")} onClose={onClose} dock={data ? <Dock context={context} primary={{ label: kind === "photo" ? commandState === "checking" ? t("mobile.request.checkStatus") : t("mobile.photos.sharePhoto") : t("mobile.jobControl.send"), onPress: send, disabled: !allowed, busy: commandState === "sending", live: true }} /> : undefined}>
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.foremanHome.loading")}</Copy>}{(status === "error" || status === "offline") && <><Copy>{status === "offline" ? t("mobile.foremanHome.offline") : t("mobile.jobControl.error")}</Copy><Button label={t("mobile.foremanHome.retry")} onPress={onRetry} /></>}
    {commandState === "checking" && <Copy>{t("mobile.jobControl.checking")}</Copy>}{(commandState === "failed" || commandState === "conflict") && <Copy>{t("mobile.jobControl.failed")}</Copy>}
    {commandState === "done" && <Copy>{t("mobile.jobControl.sent")}</Copy>}
    {data && <><Copy>{t("mobile.jobControl.to", { name: data.customerName })} · {data.job.reference}</Copy><View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{options.map(option => <Button key={option.kind} label={option.label} variant={option.kind === kind ? "primary" : "neutral"} disabled={locked || !data.permittedUpdates.includes(option.kind)} onPress={() => setKind(option.kind)} />)}</View>
    {kind === "photo" ? <>
      <Card>
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
        {source.uri ? <Stamp kind="photo" title={t("mobile.photos.photoShared")} time={at(Date.now())} attribution={photo?.author} detail={caption} photo={{ source: { uri: source.uri }, accessibilityLabel: t("mobile.jobControl.photo") }} /> :
          <Card><Copy variant="label">{t("mobile.photos.photoShared")} · {at(Date.now())}</Copy>{photo?.author && <Copy variant="supporting">{photo.author}</Copy>}{caption && <Copy accessibilityLanguage={language}>{caption}</Copy>}</Card>}
        {!!caption && <Copy variant="supporting">{t("mobile.photos.captionOriginal")}</Copy>}
      </>}
      {status === "offline" && source && <Copy variant="supporting">{t("mobile.photos.notShared")}</Copy>}
      <Copy variant="supporting">{t("mobile.photos.sharePrivacy")}</Copy>
    </> : kind === "paused" ? <Card><Copy>{t("mobile.jobControl.pauseNotice")}</Copy></Card> : <><Card>{kind === "arrival_revised" && previous && <><Copy variant="label">{t("mobile.jobControl.was")}</Copy><Copy>{at(previous.band.startsAt)} – {at(previous.band.endsAt)}</Copy><Copy>{t("mobile.jobControl.sharedAt", { name: previous.sharedByName, time: at(previous.recordedAt) })}</Copy></>}<ArrivalBand state="onTheWay" label={t("mobile.jobControl.arriving")} time={{ siteTime: range, siteZone: data.siteZone }} /><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}><Button variant="neutral" label={t("mobile.jobControl.earlier")} onPress={() => setBand(current => ({ startsAt: current.startsAt - 300000, endsAt: current.endsAt - 300000 }))} /><Button variant="neutral" label={t("mobile.jobControl.later")} onPress={() => setBand(current => ({ startsAt: current.startsAt + 300000, endsAt: current.endsAt + 300000 }))} /></View>{kind === "arrival_revised" && data.permittedUpdates.includes("arrival_withdrawn") && <Button variant="quiet" label={t("mobile.jobControl.retracted")} onPress={onRetract} />}</Card></>}
    {kind !== "photo" && <><Copy variant="sectionTitle">{t("mobile.jobControl.preview")}</Copy><LiveCapsule state={kind === "paused" ? "paused" : "onTheWay"} stateLabel={kind === "paused" ? t("mobile.jobControl.paused") : t("mobile.jobControl.onWay")} source={data.job.title ?? data.job.reference} reference={data.job.reference} time={kind === "paused" ? undefined : range} zoneLine={data.siteZone} provenance="" accessibilityLabel={`${label}, ${kind === "paused" ? "" : range}`} /></>}
    <Copy variant="supporting">{t("mobile.jobControl.noLocation")}</Copy><Copy variant="supporting">{t("mobile.jobControl.append")}</Copy></>}
  </Sheet>;
}
