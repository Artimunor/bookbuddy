import { getPlaceRoute, submitRequestPayloadSchema, submitRequestRoute, type PlaceDetails, type RequestReceipt } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import * as Haptics from "expo-haptics";
import { useRouter, type Href } from "expo-router";
import { useRef, useState } from "react";
import { useCommand, useRemote } from "../../api";
import { useFormat, useT } from "../../i18n";
import type { MediaTransfer } from "../../media";
import { useSession } from "../../session";
import { Button, Card, Dock, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { TwoClock } from "../../ui/live/TwoClock";
import { AttachmentTiles } from "../c-02/attachments";
import { requestDraftHref, type RequestDraft, useRequestDraft } from "../c-02/draft";
import { useRequestMedia } from "../c-02/request-media";
import { useOffline } from "../s-02/flow";

function payload(d: RequestDraft, items: readonly MediaTransfer[]) {
  const originalText = d.description.trim() ? d.description : undefined;
  if (!originalText && !items.some(item => item.file.kind === "voice" && item.state === "ready")) return null;
  if (items.length > 6 || items.filter(item => item.file.kind === "photo").length > 5 || items.filter(item => item.file.kind === "voice").length > 1) return null;
  return submitRequestPayloadSchema.safeParse({ placeId: d.placeId, originalText, ...(d.language.trim() ? { originalLanguage: d.language.trim() } : {}), attachmentIds: items.map(item => item.attachmentId), arrivalArrangement: d.arrivalArrangement, ...(d.arrivalArrangement === "someone_else" ? { arrivalContactName: d.arrivalContactName.trim() } : {}), ...(d.safeNote.trim() ? { safeNote: d.safeNote.trim() } : {}) });
}
export default function RequestReviewScreen() {
  const router = useRouter(); const local = useRequestDraft(); const offline = useOffline(); const command = useCommand(submitRequestRoute, { resourceId: local.draftId }); const t = useT(); const { preferences } = useSession();
  const place = useRemote(getPlaceRoute, { params: { p: local.value.placeId } }, { enabled: !!local.value.placeId });
  const media = useRequestMedia(local);
  const awaitingMedia = !media.loaded || media.items.some(item => item.state !== "ready");
  const [receipt, setReceipt] = useState<RequestReceipt | null>(null); const [failure, setFailure] = useState(false); const locked = useRef(false);
  async function send() {
    if (locked.current || offline || awaitingMedia || media.wrongPlace) return;
    const d = local.value; const parsed = payload(d, media.items); if (!parsed?.success) return;
    const pending = d.pendingOperation ?? (place.status === "ready" && place.data.state === "in_area" ? { id: uuid.v4(), revision: place.data.revision } : null);
    if (!pending) return;
    locked.current = true; setFailure(false);
    try {
      if (!d.pendingOperation) await local.change({ ...d, pendingOperation: pending });
      const result = await command.run({ body: { operationId: pending.id, expectedRevision: pending.revision, payload: parsed.data } });
      if (result.ok) { setReceipt(result.data); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); await local.remove(); }
      else if (!("delivery" in result.error && result.error.delivery === "unknown") && result.error.code !== "INTERNAL_ERROR") {
        const changed = result.error.code === "STALE_REVISION" || result.error.code === "CONFLICT";
        await local.change({ ...d, pendingOperation: null, step: changed ? "place" : "review" });
        if (changed) router.replace(requestDraftHref("place", local.draftId, { changed: "1" })); else setFailure(true);
      }
    } catch { setFailure(true); }
    finally { locked.current = false; }
  }
  const checking = !!local.value.pendingOperation || command.state === "checking";
  if (!local.loaded && !receipt) return <Screen title={t("mobile.request.reviewTitle")}><Copy>{local.failed ? t("mobile.request.saveFailed") : t("mobile.request.loading")}</Copy></Screen>;
  return <ReviewRequestView draft={local.value} place={place.data} offline={offline} status={command.state} checking={checking} failed={failure || local.failed} warn={local.warn} twoClock={preferences?.twoClock ?? false} receipt={receipt} items={media.items} awaitingMedia={awaitingMedia} wrongPlace={media.wrongPlace} onOpenAttachment={media.preview} onRemoveAttachment={item => { void media.remove(item).catch(() => setFailure(true)); }} onRetryAttachment={id => { void media.retry(id).catch(() => setFailure(true)); }} onBack={() => router.back()} onEditDescription={() => router.push(requestDraftHref("describe", local.draftId, { returnTo: "review" }))} onEditPlace={() => router.push(requestDraftHref("place", local.draftId, { returnTo: "review" }))} onSend={() => { void send(); }} onOpenJob={() => { if (receipt) { router.dismissTo("/c/(tabs)/now" as Href); router.push(`/c/jobs/${receipt.jobId}` as Href); } }} onClose={() => router.dismissTo("/c/(tabs)/now" as Href)} />;
}

type CommandState = "idle" | "sending" | "done" | "conflict" | "checking" | "failed";
export function ReviewRequestView({ draft, place, offline, status, checking, failed, warn = false, twoClock = false, receipt, items = [], awaitingMedia = false, wrongPlace = false, onOpenAttachment, onRemoveAttachment, onRetryAttachment, onBack, onEditDescription, onEditPlace, onSend, onOpenJob, onClose }: { draft: RequestDraft; place: PlaceDetails | null; offline: boolean; status: CommandState; checking: boolean; failed: boolean; warn?: boolean; twoClock?: boolean; receipt: RequestReceipt | null; items?: readonly MediaTransfer[]; awaitingMedia?: boolean; wrongPlace?: boolean; onOpenAttachment?: (id: string) => void; onRemoveAttachment?: (item: MediaTransfer) => void; onRetryAttachment?: (id: string) => void; onBack: () => void; onEditDescription: () => void; onEditPlace: () => void; onSend: () => void; onOpenJob: () => void; onClose: () => void }) {
  const t = useT(); const format = useFormat();
  if (receipt) { const at = format.twoClock(receipt.submittedAt, receipt.siteZone, twoClock ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined); return <Screen title={receipt.reference} navigation={{ kind: "close", label: t("mobile.request.close"), onPress: onClose }} dock={<Dock primary={{ label: t("mobile.request.openJob"), onPress: onOpenJob }} />}><Copy variant="display" accessibilityRole="header">{t("mobile.request.sent")}</Copy><Copy variant="sectionTitle">{t("mobile.request.notYetBooking")}</Copy>{at.kind === "available" && <TwoClock siteTime={at.siteTime} siteZone={receipt.siteZone} viewerLine={at.viewerTime ? t("mobile.visitWindow.yourTime", { time: at.viewerTime }) : undefined} />}<Card><Copy variant="sectionTitle">{t("mobile.request.requested")}</Copy><Copy>{t("mobile.request.notYetBooking")}</Copy></Card><Card><Copy variant="sectionTitle">{t("mobile.request.next")}</Copy><Copy>{t("mobile.request.nextBody")}</Copy></Card></Screen>; }
  const sending = status === "sending"; const ready = !!payload(draft, items)?.success && !awaitingMedia && !wrongPlace && place?.state === "in_area" && !offline;
  const context = checking ? t("mobile.request.checking") : wrongPlace ? t("mobile.photos.placeChanged") : offline ? t("mobile.request.offline") : awaitingMedia ? t("mobile.photos.wait") : !ready ? (place?.state === "out_of_area" ? t("mobile.request.outsideArea") : place?.state !== "in_area" ? t("mobile.request.areaUnknown") : t("mobile.request.describeRequired")) : t("mobile.request.free");
  const who = draft.arrivalArrangement === "nobody" ? t("mobile.request.nobody") : draft.arrivalArrangement === "requester" ? t("mobile.request.me") : draft.arrivalContactName;
  return <Screen title={t("mobile.request.reviewTitle")} navigation={{ kind: "back", label: t("mobile.request.back"), onPress: onBack }} dock={<Dock context={context} primary={{ label: checking ? t("mobile.request.checkStatus") : t("mobile.request.send"), onPress: onSend, busy: sending, disabled: sending || offline || awaitingMedia || wrongPlace || (!checking && !ready) }} />}>
    <Copy variant="supporting">{t("mobile.request.stepThree")}</Copy><Card><Copy variant="sectionTitle">{checking ? t("mobile.request.checking") : offline ? t("mobile.request.offline") : t("mobile.request.notBooking")}</Copy>{failed && !checking && <Copy>{t("mobile.request.failed")}</Copy>}</Card>
    {warn && <Copy>{t("mobile.request.expiryWarning")}</Copy>}
    <Card><Copy variant="sectionTitle">{t("mobile.request.job")}</Copy>{!!draft.description.trim() && <Copy>{draft.description}</Copy>}{!!draft.language && <Copy variant="supporting">{draft.language}</Copy>}
      {!!items.length && <AttachmentTiles items={items} offline={offline} onOpen={onOpenAttachment} onRemove={checking || sending ? undefined : onRemoveAttachment} onRetry={checking || sending ? undefined : onRetryAttachment} />}
      <Button variant="quiet" label={t("mobile.request.edit")} onPress={onEditDescription} disabled={checking || sending} />
    </Card>
    <Card><Copy variant="sectionTitle">{t("mobile.request.placeTitle")}</Copy><Copy>{place?.alias ?? draft.placeId}</Copy>{!!place?.address && <Copy>{place.address}</Copy>}{!!draft.safeNote && <Copy>{draft.safeNote}</Copy>}<Copy>{who}</Copy><Button variant="quiet" label={t("mobile.request.edit")} onPress={onEditPlace} disabled={checking || sending} /></Card><Copy variant="supporting">{t("mobile.request.visibility")}</Copy>
  </Screen>;
}
