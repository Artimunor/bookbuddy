import { mediaScopeSchema } from "@bookbuddy/api-contract";
import { useAudioRecorderState } from "expo-audio";
import type { AudioRecorder } from "expo-audio";
import { useLocalSearchParams, usePreventRemove, useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { useT } from "../../i18n";
import { isSentDraft, SentDraftMedia, useAttach } from "../../media";
import type { PickResult } from "../../media";
import { allowsVoice } from "../../media/types";
import type { AttachmentId, MediaTransfer } from "../../media/types";
import { useRepository } from "../../repository/hooks";
import { Button, Dialog } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { AttachPanel, CaptureSourceRow, RecordingCard, RecordingDock } from "./View";
import { useVoiceCapture } from "./useVoiceCapture";

type Source = "camera" | "library" | "voice";
const silent = Array<number>(38).fill(0);

export default function AttachScreen() {
  const { caller, parentScopeId, stageId, mode } = useLocalSearchParams<{ caller?: string; parentScopeId?: string; stageId?: string; mode?: string }>();
  const scope = mediaScopeSchema.safeParse({ caller, parentScopeId }).data;
  const repository = useRepository();
  const router = useRouter();
  const t = useT();
  const { color, radius, space } = useBeaconTheme();
  const { pick, items, retry } = useAttach(scope?.caller, scope?.parentScopeId, stageId);
  const [denied, setDenied] = useState<Partial<Record<Source, boolean>>>({});
  const [notice, setNotice] = useState<"tooLarge" | "draftLimit" | "unavailable" | null>(null);
  const [picking, setPicking] = useState(false);
  const [discard, setDiscard] = useState(false);
  const pendingPhoto = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const voice = useVoiceCapture(pick, (result, mode) => {
    setDiscard(false);
    showOutcome("voice", result, mode === "review");
  });
  const recording = voice.phase === "recording" || voice.phase === "stopping";
  const disablePrevention = usePreventRemove(voice.phase !== "idle", () => {
    if (voice.phase === "recording") void voice.finish("review");
  });
  const showPhotos = mode === undefined || mode === "photo";
  const showVoice = !!scope && allowsVoice(scope.caller) && (mode === undefined || mode === "voice");
  const canCapture = !!scope && !!repository?.isActive && (showPhotos || showVoice);
  const visibleItems = mode === undefined ? items : items.filter(({ file }) => file.kind === mode);
  const busy = picking || voice.phase !== "idle";

  function review(attachmentId: AttachmentId) {
    disablePrevention();
    router.replace({ pathname: "/media/[attachmentId]", params: { attachmentId } } as Href);
  }
  function close() {
    if (voice.phase === "recording") { void voice.finish("review"); return; }
    if (!busy) {
      if (router.canGoBack()) router.back();
      else router.replace("/help" as Href);
    }
  }
  function showOutcome(source: Source, result: PickResult, open: boolean) {
    if (!mounted.current) return;
    if (result.status === "denied") setDenied((current) => ({ ...current, [source]: true }));
    else if (result.status === "staged") {
      setDenied((current) => ({ ...current, [source]: false }));
      if (open && repository?.isActive) review(result.item.attachmentId);
    } else if (result.status !== "cancelled") setNotice(result.status);
  }
  async function choose(source: "camera" | "library") {
    if (pendingPhoto.current || !showPhotos || !canCapture || busy) return;
    pendingPhoto.current = true;
    setNotice(null);
    setPicking(true);
    try { showOutcome(source, await pick(source), true); }
    finally { pendingPhoto.current = false; if (mounted.current) setPicking(false); }
  }
  const settings = Platform.OS === "web" ? undefined : () => {
    void Linking.openSettings().catch(() => setNotice("unavailable"));
  };
  const error = notice === "tooLarge" ? t("mobile.media.tooLarge") : notice === "draftLimit" ? t("mobile.media.draftLimit")
    : notice === "unavailable" ? t("mobile.media.captureFailed") : null;

  return <>
    <AttachPanel title={recording ? t("mobile.media.voiceNote") : t("mobile.media.attachTitle")}
      destination={caller === "chat" ? t("mobile.media.destinationChat") : t("mobile.media.destinationRecord")}
      onClose={close} closeDisabled={picking || voice.phase === "stopping" || voice.phase === "starting"}
      dock={recording ? <RecordingDock onDiscard={() => setDiscard(true)} onStop={() => { void voice.finish("review"); }} busy={voice.phase === "stopping"} /> : undefined}>
      {recording ? <>
        <LiveRecordingCard recorder={voice.recorder} />
        <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.media.recordingNote")}</Copy>
      </> : canCapture ? <>
        <View style={{ borderWidth: 1, borderColor: color.separator, borderRadius: radius.card, backgroundColor: color.surface, overflow: "hidden" }}>
          {showPhotos && <>
            <CaptureSourceRow name="camera" first title={t("mobile.media.takePhoto")}
              description={denied.camera ? t("mobile.media.cameraDenied") : t("mobile.media.cameraDescription")}
              onPress={() => { void choose("camera"); }} disabled={busy} denied={denied.camera} onSettings={settings} />
            <CaptureSourceRow name="library" title={t("mobile.media.choosePhoto")}
              description={denied.library ? t("mobile.media.libraryDenied") : t("mobile.media.libraryDescription")}
              onPress={() => { void choose("library"); }} disabled={busy} denied={denied.library} onSettings={settings} />
          </>}
          {showVoice && <CaptureSourceRow name="voice" first={!showPhotos} title={t("mobile.media.recordVoice")}
            description={denied.voice ? (Platform.OS === "web" ? t("mobile.media.microphoneDeniedWeb") : t("mobile.media.microphoneDenied")) : t("mobile.media.voiceDescription")}
            onPress={() => { setNotice(null); void voice.start(); }} disabled={busy} denied={denied.voice} onSettings={settings} />}
        </View>
        <Copy variant="supporting" style={{ color: color.muted }}>{caller === "chat" ? t("mobile.media.privacyChat") : t("mobile.media.privacyRecord")}</Copy>
        {visibleItems.filter((item) => !item.selected && item.fileUri).map((item) =>
          <Button key={item.attachmentId} variant="neutral" disabled={busy}
            label={item.file.kind === "voice" ? t("mobile.media.reviewRecording") : t("mobile.media.reviewPhoto")} onPress={() => review(item.attachmentId)} />)}
        {visibleItems.filter((item) => item.selected).map((item) => isSentDraft(item)
          ? <SentDraftMedia key={item.attachmentId} kind={item.file.kind} /> :
          <View key={item.attachmentId} style={{ gap: space.grid[2], alignItems: "flex-start" }}>
            <Copy variant="supporting" style={{ color: item.state === "failed" ? color.criticalInk : color.muted }}>
              <TransferStatus state={item.state} />
            </Copy>
            {item.state === "failed" && !item.terminal && <Button variant="quiet" label={t("shared.action.retry")} onPress={() => {
              void retry(item.attachmentId).catch(() => setNotice("unavailable"));
            }} />}
          </View>)}
      </> : <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.media.attachUnavailable")}</Copy>}
      {error && <Copy accessibilityRole="alert" style={{ color: color.criticalInk }}>{error}</Copy>}
    </AttachPanel>
    <Dialog visible={discard && voice.phase === "recording"} title={t("mobile.media.discardQuestion")}
      closeLabel={t("shared.action.close")} onClose={() => setDiscard(false)}
      cancel={{ label: t("shared.action.cancel"), onPress: () => setDiscard(false) }}
      confirm={{ label: t("mobile.media.discard"), variant: "destructive", onPress: () => { setDiscard(false); void voice.finish("discard"); } }}>
      <Copy>{t("mobile.media.discardExplanation")}</Copy>
    </Dialog>
  </>;
}

function LiveRecordingCard({ recorder }: { recorder: AudioRecorder }) {
  const { durationMillis, metering } = useAudioRecorderState(recorder, 125);
  const [samples, setSamples] = useState(silent);
  useEffect(() => {
    const level = Math.max(0, Math.min(1, ((metering ?? -60) + 60) / 60));
    setSamples((current) => [...current.slice(1), level]);
  }, [metering, durationMillis]);
  return <RecordingCard elapsedMs={durationMillis} samples={samples} />;
}

function TransferStatus({ state }: { state: MediaTransfer["state"] }) {
  const t = useT();
  switch (state) {
    case "queued": return Platform.OS === "web" ? t("mobile.media.pending") : t("mobile.media.savedPending");
    case "uploading": return t("mobile.media.uploading");
    case "verifying": return t("mobile.media.verifying");
    case "ready": return t("mobile.media.ready");
    case "failed": return t("mobile.media.uploadFailed");
  }
}
