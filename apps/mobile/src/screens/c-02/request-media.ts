import { uuid } from "expo";
import { useAttach, type MediaTransfer } from "../../media";
import { useAttachNavigation } from "./attachments";
import type { RequestDraft } from "./draft";

export function useRequestMedia(local: { value: RequestDraft; draftId: string; loaded: boolean; change: (next: RequestDraft) => Promise<void> }, defaultPlaceId?: string) {
  const draft = local.value;
  const placeId = draft.placeId || defaultPlaceId;
  const parent = draft.mediaPlaceId || placeId;
  const transfers = useAttach(parent ? "request" : undefined, parent);
  const navigation = useAttachNavigation();
  const stages = draft.mediaStages ?? [local.draftId];
  const items = transfers.items.filter(item => item.selected && stages.includes(item.stageId) && !draft.omittedMedia?.includes(item.attachmentId));
  const wrongPlace = !!items.length && !!placeId && !!draft.mediaPlaceId && draft.mediaPlaceId !== placeId;
  async function add(mode: "photo" | "voice") {
    const cap = mode === "photo" ? 5 : 1;
    if (!placeId || !local.loaded || !transfers.loaded || draft.pendingOperation || wrongPlace || items.filter(item => item.file.kind === mode).length >= cap) return;
    const samePlace = draft.mediaPlaceId === placeId;
    const useStages = samePlace ? stages : draft.mediaPlaceId ? [...stages, uuid.v4()] : [local.draftId];
    if (!samePlace || !draft.placeId) await local.change({ ...draft, placeId, mediaPlaceId: placeId, mediaStages: useStages });
    navigation.attach("request", placeId, useStages[useStages.length - 1]!, mode);
  }
  async function remove(item: MediaTransfer) {
    if (draft.pendingOperation || !local.loaded) return;
    if (await transfers.remove(item.attachmentId)) return;
    // A cancelled reservation may still count against its server stage.
    await local.change({ ...draft, mediaStages: [...stages, uuid.v4()] });
  }
  return { items, loaded: !parent || transfers.loaded, placeId, wrongPlace, add, remove, preview: navigation.preview, retry: transfers.retry };
}
