import type { MediaCaller } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { Image, Pressable, View } from "react-native";
import { useT } from "../../i18n";
import type { MediaTransfer } from "../../media";
import { Button } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";

export function useAttachNavigation() {
  const router = useRouter();
  return {
    attach: (caller: MediaCaller, parentScopeId: string, stageId: string, mode?: "photo" | "voice") => router.push({ pathname: "/attach", params: { caller, parentScopeId, stageId, ...(mode && { mode }) } } as Href),
    preview: (attachmentId: string) => router.push({ pathname: "/media/[attachmentId]", params: { attachmentId } } as Href),
  };
}

export function PhotoTile({ label, uri, pending = false, onOpen, large = false }: { label: string; uri?: string | null; pending?: boolean; onOpen?: () => void; large?: boolean }) {
  const { color, radius } = useBeaconTheme();
  const contents = <View style={{ height: large ? 174 : 76, width: large ? "100%" : 92, alignItems: "center", justifyContent: "center", backgroundColor: color.subtle, borderRadius: radius.smallTile, borderWidth: pending ? 2 : 1, borderStyle: pending ? "dashed" : "solid", borderColor: pending ? color.attentionInk : color.separator, overflow: "hidden" }}>
    {uri ? <Image source={{ uri }} resizeMode="cover" style={{ width: "100%", height: "100%" }} /> : <Copy variant="sectionTitle">▣</Copy>}
  </View>;
  return onOpen ? <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onOpen}>{contents}</Pressable> : <View accessible accessibilityLabel={label}>{contents}</View>;
}

export function AttachmentTiles({ items, offline, onOpen, onRemove, onRetry }: { items: readonly MediaTransfer[]; offline?: boolean; onOpen?: (id: string) => void; onRemove?: (item: MediaTransfer) => void; onRetry?: (id: string) => void }) {
  const t = useT(); const { space } = useBeaconTheme();
  let photoNumber = 0;
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.grid[3] }}>{items.map(item => {
    const { attachmentId, file, fileUri, state } = item;
    const title = file.kind === "voice" ? t("mobile.media.voiceNote") : t("mobile.photos.number", { number: ++photoNumber });
    const open = fileUri && onOpen ? () => onOpen(attachmentId) : undefined;
    const status = state === "ready" ? t("mobile.media.ready") : state === "failed" ? t("mobile.media.uploadFailed") : state === "verifying" ? t("mobile.media.verifying") : state === "uploading" ? t("mobile.media.uploading") : offline ? t("mobile.media.savedPending") : t("mobile.media.pending");
    return <View key={attachmentId} style={{ gap: space.grid[1], minWidth: 92, maxWidth: 156 }}>
      {file.kind === "photo" ? <PhotoTile label={title} uri={fileUri} pending={offline && state !== "ready"} onOpen={open} /> : open ? <Button variant="quiet" label={title} onPress={open} /> : <Copy variant="label">{title}</Copy>}
      {file.kind === "voice" && <Copy variant="supporting">{t("mobile.photos.voiceLength", { seconds: Math.ceil(file.durationMs / 1000) })}</Copy>}
      <Copy variant="supporting" accessibilityLiveRegion={state === "ready" || state === "failed" ? "polite" : "none"}>{status}</Copy>
      {state === "failed" && !item.terminal && onRetry && <Button variant="quiet" label={t("shared.action.retry")} onPress={() => onRetry(attachmentId)} />}
      {onRemove && <Button variant="quiet" label={t("mobile.media.remove")} accessibilityLabel={t("mobile.photos.removeNamed", { name: title })} onPress={() => onRemove(item)} />}
    </View>;
  })}</View>;
}
