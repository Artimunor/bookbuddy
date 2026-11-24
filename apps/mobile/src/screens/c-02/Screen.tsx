import { listPlacesRoute, localeTagSchema } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { useRemote } from "../../api";
import type { MediaTransfer } from "../../media";
import { useT } from "../../i18n";
import { Button, Card, Dock, Screen, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useOffline } from "../s-02/flow";
import { confirmAction } from "../s-17/confirmAction";
import { AttachmentTiles } from "./attachments";
import { requestDraftHref, type RequestDraft, useRequestDraft } from "./draft";
import { useRequestMedia } from "./request-media";

export default function DescribeScreen() {
  const router = useRouter(); const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const local = useRequestDraft(); const offline = useOffline(); const t = useT();
  const places = useRemote(listPlacesRoute, { query: {} }, { enabled: local.loaded && !local.value.placeId && !local.value.pendingOperation });
  const defaultPlace = places.data?.places.find(place => place.state === "in_area")?.id;
  const media = useRequestMedia(local, defaultPlace);
  const [mediaFailed, setMediaFailed] = useState(false);
  const action = (task: Promise<unknown>) => { setMediaFailed(false); void task.catch(() => setMediaFailed(true)); };
  const add = (mode: "photo" | "voice") => {
    if (media.placeId) action(media.add(mode));
    else router.push(requestDraftHref("place", local.draftId));
  };
  const remove = (item: MediaTransfer) => {
    if (item.file.kind !== "voice" || local.value.description.trim()) { action(media.remove(item)); return; }
    const label = t("mobile.media.remove");
    confirmAction(router, { title: t("mobile.photos.removeOnlyVoice"), actionLabel: label, actionLabelKey: "mobile.media.remove", item: t("mobile.media.voiceNote"), actor: "", role: "", effects: [], serverAction: false, destructive: true, onReview: () => {}, onConfirm: async () => {
      try { await media.remove(item); return "confirmed"; } catch { return "invalidated"; }
    } });
  };
  const next = returnTo === "review" ? "review" : "place";
  if (!local.loaded) return <Screen title={t("mobile.request.describeTitle")}><Copy>{local.failed ? t("mobile.request.saveFailed") : t("mobile.request.loading")}</Copy></Screen>;
  if (local.value.pendingOperation) return <Screen title={t("mobile.request.describeTitle")}><Copy>{t("mobile.request.checking")}</Copy><Button label={t("mobile.request.review")} onPress={() => router.replace(requestDraftHref("review", local.draftId))} /></Screen>;
  return <DescribeView draft={local.value} saved={local.saved} failed={local.failed || mediaFailed} warn={local.warn} offline={offline} items={media.items} wrongPlace={media.wrongPlace} choosePlace={!media.placeId} onAdd={add} onOpen={media.preview} onRemove={remove} onRetry={id => action(media.retry(id))} onChange={draft => { void local.change(draft).catch(() => {}); }} onBack={() => router.back()} onContinue={() => { void local.change({ ...local.value, step: next, ...(media.placeId && { placeId: media.placeId }) }).then(() => router.push(requestDraftHref(next, local.draftId))).catch(() => {}); }} />;
}

export function DescribeView({ draft, saved, failed, warn = false, offline, items = [], wrongPlace = false, choosePlace = false, onAdd, onOpen, onRemove, onRetry, onChange, onBack, onContinue }: { draft: RequestDraft; saved: boolean; failed: boolean; warn?: boolean; offline: boolean; items?: readonly MediaTransfer[]; wrongPlace?: boolean; choosePlace?: boolean; onAdd: (mode: "photo" | "voice") => void; onOpen?: (id: string) => void; onRemove?: (item: MediaTransfer) => void; onRetry?: (id: string) => void; onChange: (draft: RequestDraft) => void; onBack: () => void; onContinue: () => void }) {
  const t = useT(); const voice = items.some(item => item.file.kind === "voice");
  const valid = (!!draft.description.trim() || voice) && !wrongPlace && (!draft.language.trim() || localeTagSchema.safeParse(draft.language.trim()).success);
  const reason = wrongPlace ? t("mobile.photos.placeChanged") : valid ? t("mobile.request.nextPlace") : t("mobile.request.describeRequired");
  const photos = items.filter(item => item.file.kind === "photo").length;
  const addActions: ReactNode = choosePlace ? <Button variant="neutral" label={t("mobile.photos.pickPlace")} onPress={() => onAdd("photo")} /> : <>
    <Button variant="neutral" label={t("mobile.photos.addPhoto")} onPress={() => onAdd("photo")} disabled={wrongPlace || photos >= 5} />
    <Button variant="neutral" label={t("mobile.photos.addVoice")} onPress={() => onAdd("voice")} disabled={wrongPlace || voice} />
  </>;
  return <Screen title={t("mobile.request.describeTitle")} navigation={{ kind: "back", label: t("mobile.request.back"), onPress: onBack }} dock={<Dock context={reason} primary={{ label: t("mobile.request.continue"), onPress: onContinue, disabled: !valid }} />}>
    <Copy variant="supporting">{t("mobile.request.stepOne")}</Copy><Copy>{t("mobile.request.languageLine")}</Copy>
    {warn && <Copy>{t("mobile.request.expiryWarning")}</Copy>}
    <Card><TextField label={t("mobile.request.description")} multiline maxLength={16000} placeholder={t("mobile.request.example")} value={draft.description} onChangeText={description => onChange({ ...draft, description })} />
    <TextField label={t("mobile.request.language")} helper={t("mobile.request.languageHelp")} value={draft.language} autoCapitalize="none" maxLength={255} onChangeText={language => onChange({ ...draft, language })} /></Card>
    {saved && <Copy variant="supporting">{offline ? t("mobile.request.savedOffline") : t("mobile.request.saved")}</Copy>}{failed && <Copy>{t("mobile.request.saveFailed")}</Copy>}
    <Card><Copy variant="sectionTitle">{t("mobile.photos.photosAndVoice")}</Copy><AttachmentTiles items={items} offline={offline} onOpen={onOpen} onRemove={onRemove} onRetry={onRetry} />{addActions}</Card>
    <Copy variant="supporting">{t("mobile.request.visibility")}</Copy>
    <Copy variant="supporting">{t("mobile.request.noCodes")}</Copy>
  </Screen>;
}
