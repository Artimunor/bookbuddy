import { mediaScopeSchema } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Href } from "expo-router";
import type { ComponentRef, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Platform, ScrollView, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useT } from "../../i18n";
import { SentDraftMedia, useMediaRead } from "../../media";
import { useDraftMediaActions } from "../../media/attach";
import type { MediaPreviewText } from "../../media/provider";
import { useMediaPreviewDetails } from "../../media/read";
import { Button } from "../../ui/controls";
import { Stamp } from "../../ui/live/Stamp";
import { readingLanguageLabel } from "../s-12/language";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { PhotoPreview } from "./Photo";
import { VoicePreview } from "./Voice";

export default function MediaPreviewScreen() {
  const { attachmentId, caller, parentScopeId } = useLocalSearchParams<{ attachmentId?: string; caller?: string; parentScopeId?: string }>();
  const scope = caller === undefined && parentScopeId === undefined ? undefined : mediaScopeSchema.safeParse({ caller, parentScopeId }).data ?? null;
  const router = useRouter();
  const t = useT();
  const { color, space } = useBeaconTheme();
  const { result, refresh } = useMediaRead(attachmentId, scope);
  const media = result.status === "ready" ? result : null;
  const details = useMediaPreviewDetails(attachmentId, scope ?? null);
  const { useInDraft, removeFromDraft } = useDraftMediaActions();
  const [failureUri, setFailureUri] = useState<string | null>(null);
  const [assetAttempt, setAssetAttempt] = useState(0);
  const [draftError, setDraftError] = useState(false);
  const [saving, setSaving] = useState(false);
  const action = useRef(false);
  const uri = media?.uri;
  const onMediaError = useCallback(() => { if (uri) setFailureUri(uri); }, [uri]);
  const voice = media?.file.kind === "voice";
  const close = () => { if (router.canGoBack()) router.back(); else router.replace("/help" as Href); };

  async function modifyDraft(remove: boolean) {
    if (action.current || !media?.draft) return;
    action.current = true;
    setSaving(true);
    setDraftError(false);
    try {
      const saved = await (remove ? removeFromDraft : useInDraft)(media.draft.attachmentId);
      if (saved) close(); else setDraftError(true);
    } catch { setDraftError(true); }
    finally { action.current = false; setSaving(false); }
  }

  const dock = media?.draft && (!media.draft.selected || !media.draft.started) ? (
    <View style={{ padding: space.contentInset, gap: space.grid[2], borderTopWidth: 1, borderTopColor: color.separator, backgroundColor: color.surface }}>
      {!!draftError && <Copy accessibilityRole="alert" style={{ color: color.criticalInk }}>{t("mobile.media.draftActionFailed")}</Copy>}
      {!media.draft.selected && <Button label={voice ? t("mobile.media.useRecording") : t("mobile.media.usePhoto")}
        onPress={() => { void modifyDraft(false); }} busy={saving} disabled={failureUri === uri} />}
      {!media.draft.started && <Button label={t("mobile.media.remove")} variant="quiet" disabled={saving} onPress={() => { void modifyDraft(true); }} />}
      <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.media.notSent")}</Copy>
    </View>
  ) : undefined;

  const caption = details?.caption;
  const description = caption?.translation ?? caption?.original ?? t("mobile.media.photo");
  return <PreviewFrame title={media ? (voice ? t("mobile.media.voiceNote") : t("mobile.media.photo")) : t("mobile.media.preview")}
    context={media ? details?.titleContext : undefined} close={close} dock={dock}>
    {result.status === "sent" ? <SentDraftMedia kind={result.kind} /> : !media ? <View style={{ alignItems: "flex-start", gap: space.grid[3] }}>
      {result.status === "loading" && <ActivityIndicator color={color.ink} accessibilityLabel={t("mobile.media.loading")} />}
      <Copy variant="supporting" accessibilityRole={result.status === "loading" ? undefined : "alert"}>
        {result.status === "loading" ? t("mobile.media.loading") : result.status === "offline" ? t("mobile.media.previewOffline")
          : result.status === "error" ? t("mobile.media.previewFailed") : t("mobile.media.previewUnavailable")}
      </Copy>
      {result.status === "error" && <Button label={t("shared.action.retry")} variant="neutral" onPress={refresh} />}
    </View> : failureUri === media.uri ? <View style={{ alignItems: "flex-start", gap: space.grid[3] }}>
      <Copy accessibilityRole="alert">{t("mobile.media.previewFailed")}</Copy>
      <Button label={t("shared.action.retry")} variant="neutral" onPress={() => { setFailureUri(null); setAssetAttempt((count) => count + 1); }} />
    </View> : media.file.kind === "photo" ? <>
      <PhotoPreview key={assetAttempt} uri={media.uri} description={details?.author ? t("mobile.media.photoBy", { description, author: details.author }) : description} onError={onMediaError} />
      <PhotoContext author={details?.author} time={details?.time} caption={caption} />
    </> : <>
      {(details?.author || details?.time) && <Panel>
        {!!details.author && <Copy variant="label">{details.author}</Copy>}
        {!!details.time && <Copy variant="supporting" style={{ color: color.muted }}>{details.time}</Copy>}
      </Panel>}
      <VoicePreview key={assetAttempt} uri={media.uri} durationMs={media.file.durationMs}
        language={details?.originalLanguage ?? details?.transcript?.originalLanguage} onError={onMediaError} />
      {details?.transcript ? <Panel><TwinText value={details.transcript} title={t("mobile.media.transcript")} /></Panel> : <>
        <Panel>
          <Copy variant="label">{t("mobile.media.transcriptUnavailable")}</Copy>
          <View style={{ borderTopWidth: 1, borderTopColor: color.separator, paddingTop: space.grid[3], gap: space.grid[1] }}>
            <Copy variant="label">{t("mobile.media.noTranslation")}</Copy>
            <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.media.translationExplanation")}</Copy>
          </View>
        </Panel>
        <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.media.transcriptExplanation")}</Copy>
      </>}
    </>}
  </PreviewFrame>;
}

export function PreviewFrame({ title, context, close, children, dock }: {
  title: string; context?: string; close: () => void; children: ReactNode; dock?: ReactNode;
}) {
  const t = useT();
  const { color, space } = useBeaconTheme();
  const { fontScale, height } = useWindowDimensions();
  const scrollDock = fontScale >= 1.5 || height < 520;
  const heading = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    if (Platform.OS !== "web" && heading.current) AccessibilityInfo.sendAccessibilityEvent(heading.current, "focus");
  }, []);
  return <SafeAreaView accessibilityViewIsModal style={{ flex: 1, backgroundColor: color.canvas }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.contentInset,
      paddingVertical: space.grid[2], gap: space.grid[3] }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View ref={heading} accessible accessibilityRole="header" accessibilityLabel={title}>
          <Copy accessible={false} variant="sectionTitle">{title}</Copy>
        </View>
        {!!context && <Copy variant="supporting" style={{ color: color.muted }}>{context}</Copy>}
      </View>
      <Button label={t("shared.action.close")} glyph="×" iconOnly variant="neutral" onPress={close} />
    </View>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.contentInset, gap: space.grid[4] }}>
      {children}
      {scrollDock && dock}
    </ScrollView>
    {!scrollDock && dock}
  </SafeAreaView>;
}

export function PhotoContext({ author, time, caption }: { author?: string; time?: string; caption?: MediaPreviewText }) {
  const t = useT(); const { space } = useBeaconTheme();
  if (!author && !time && !caption) return null;
  return <View style={{ gap: space.grid[2] }}>
    {(author || time) && <Stamp kind="photo" title={t("mobile.media.photoShared")} attribution={author} time={time ?? ""} />}
    {caption && <Panel><TwinText value={caption} title={t("mobile.media.caption")} /></Panel>}
  </View>;
}

function Panel({ children }: { children: ReactNode }) {
  const { color, space, radius } = useBeaconTheme();
  return <View style={{ borderWidth: 1, borderColor: color.separator, borderRadius: radius.card, backgroundColor: color.surface,
    padding: space.grid[4], gap: space.grid[3] }}>{children}</View>;
}

function TwinText({ value, title }: { value: MediaPreviewText; title: string }) {
  const t = useT();
  const { color, space } = useBeaconTheme();
  return <View style={{ gap: space.grid[2] }}>
    <Copy variant="caption" style={{ color: color.muted }}>{title}</Copy>
    {!!value.translation && <>
      <Copy variant="caption" style={{ color: color.infoInk }}>{value.translationLanguage ? t("mobile.briefing.translation", { language: readingLanguageLabel(t, value.translationLanguage) }) : t("mobile.media.translation")}</Copy>
      <Copy accessibilityLanguage={value.translationLanguage}>{value.translation}</Copy>
    </>}
    <View style={{ padding: space.grid[3], gap: space.grid[1], backgroundColor: color.subtle }}>
      <Copy variant="caption" style={{ color: color.muted }}>{value.originalLanguage ? t("mobile.media.originalLanguage", { language: readingLanguageLabel(t, value.originalLanguage) }) : t("mobile.media.original")}</Copy>
      <Copy accessibilityLanguage={value.originalLanguage}>{value.original}</Copy>
    </View>
  </View>;
}
