import { getOperationRoute, getPlaceRoute, operationIdSchema, submitRequestPayloadSchema, submitRequestRoute, type PlaceDetails, type RequestReceipt } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import * as Haptics from "expo-haptics";
import { useRouter, type Href } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useApiAccess } from "../../api/provider";
import { useFormat, useLocale, useT } from "../../i18n";
import type { MediaTransfer } from "../../media";
import { useRepository } from "../../repository/hooks";
import { useSession } from "../../session";
import { Badge, Button, Card, Dock, ListRow, Screen, StatusBanner } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { TwoClock } from "../../ui/live/TwoClock";
import { useBeaconTheme } from "../../ui/theme";
import { Journey } from "../c-01/common";
import { AttachmentTiles } from "../c-02/attachments";
import { requestDraftHref, type RequestDraft, useRequestDraft } from "../c-02/draft";
import { originalLanguageName } from "../c-02/language";
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
  const repo = useRepository(); const { client, requests } = useApiAccess();
  const place = useRemote(getPlaceRoute, { params: { p: local.value.placeId } }, { enabled: !!local.value.placeId && !local.reconciliation });
  const media = useRequestMedia(local);
  const awaitingMedia = !media.loaded || media.items.some(item => item.state !== "ready");
  const [receipt, setReceipt] = useState<RequestReceipt | null>(null);
  const [committed, setCommitted] = useState(false);
  const [failure, setFailure] = useState(false);
  const [working, setWorking] = useState(false);
  const locked = useRef(false);
  async function send() {
    if (locked.current || offline || !local.loaded || !repo?.isActive || !client || !requests.allows("context", repo)) return;
    const prior = local.reconciliation;
    const draft = local.value;
    let body = prior?.body;
    if (!prior) {
      if (awaitingMedia || media.wrongPlace || place.status !== "ready" || place.data.state !== "in_area") return;
      const parsed = payload(draft, media.items);
      if (!parsed?.success) return;
      body = { operationId: operationIdSchema.parse(uuid.v4()), expectedRevision: place.data.revision, payload: parsed.data };
    }
    locked.current = true; setWorking(true); setFailure(false);
    try {
      if (!body) {
        if (!prior) return;
        // Older clients saved the ID without the exact body. Check the
        // receipt; never guess at a previously submitted payload.
        const result = await client.request(getOperationRoute, { params: { id: prior.operationId } });
        if (!requests.allows("context", repo)) return;
        if (!result.ok) { setFailure(true); return; }
        await local.finish(prior.operationId);
        setCommitted(true);
        return;
      }
      const frozen = prior ? { body, created: false } : await local.begin(body);
      const result = await command.run({ body: frozen.body });
      if (!requests.allows("context", repo)) return;
      if (result.ok) {
        setReceipt(result.data);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        await local.finish(frozen.body.operationId);
      } else {
        const { code } = result.error;
        const changed = code === "STALE_REVISION" || code === "CONFLICT";
        const notSent = "delivery" in result.error && result.error.delivery === "not_sent";
        // Replays may encounter a changed place or a pruned receipt. Only a
        // definitive first-attempt rejection returns to editing with a new ID.
        if (frozen.created && (changed || notSent || code === "INVALID_INPUT" || code === "VALIDATION_FAILED")) {
          await local.finish(frozen.body.operationId, { ...draft, pendingOperation: null, step: changed ? "place" : "review" });
          if (changed) router.replace(requestDraftHref("place", local.draftId, { changed: "1" }));
          else setFailure(true);
        } else if (!("delivery" in result.error && result.error.delivery === "unknown") && code !== "INTERNAL_ERROR") {
          setFailure(true);
        }
      }
    } catch { setFailure(true); }
    finally { locked.current = false; setWorking(false); }
  }
  const checking = !!local.reconciliation || command.state === "checking";
  if (committed) return <Screen title={t("mobile.request.sent")} dock={<Dock primary={{
    label: t("mobile.customerHome.bookings"), onPress: () => router.dismissTo("/c/(tabs)/bookings" as Href),
  }} />}><Copy>{t("mobile.request.nextBody")}</Copy></Screen>;
  if (!local.loaded && !receipt) return <Screen title={t("mobile.request.reviewTitle")}><Copy>{local.failed ? t("mobile.request.saveFailed") : t("mobile.request.loading")}</Copy></Screen>;
  return <ReviewRequestView draft={local.value} place={place.data} offline={offline} status={working ? "sending" : command.state} checking={checking} failed={failure || local.failed} warn={local.warn} twoClock={preferences?.twoClock ?? false} receipt={receipt} items={media.items} awaitingMedia={awaitingMedia} wrongPlace={media.wrongPlace} onOpenAttachment={media.preview} onRemoveAttachment={item => { void media.remove(item).catch(() => setFailure(true)); }} onRetryAttachment={id => { void media.retry(id).catch(() => setFailure(true)); }} onBack={() => router.back()} onEditDescription={() => router.push(requestDraftHref("describe", local.draftId, { returnTo: "review" }))} onEditPlace={() => router.push(requestDraftHref("place", local.draftId, { returnTo: "review" }))} onSend={() => { void send(); }} onOpenJob={() => { if (receipt) { router.dismissTo("/c/(tabs)/now" as Href); router.push(`/c/jobs/${receipt.jobId}` as Href); } }} onClose={() => router.dismissTo("/c/(tabs)/now" as Href)} />;
}

type CommandState = "idle" | "sending" | "done" | "conflict" | "checking" | "failed";
export function ReviewRequestView({ draft, place, offline, status, checking, failed, warn = false, twoClock = false, receipt, items = [], awaitingMedia = false, wrongPlace = false, onOpenAttachment, onRemoveAttachment, onRetryAttachment, onBack, onEditDescription, onEditPlace, onSend, onOpenJob, onClose }: { draft: RequestDraft; place: PlaceDetails | null; offline: boolean; status: CommandState; checking: boolean; failed: boolean; warn?: boolean; twoClock?: boolean; receipt: RequestReceipt | null; items?: readonly MediaTransfer[]; awaitingMedia?: boolean; wrongPlace?: boolean; onOpenAttachment?: (id: string) => void; onRemoveAttachment?: (item: MediaTransfer) => void; onRetryAttachment?: (id: string) => void; onBack: () => void; onEditDescription: () => void; onEditPlace: () => void; onSend: () => void; onOpenJob: () => void; onClose: () => void }) {
  const t = useT();
  const format = useFormat();
  const { locale } = useLocale();
  const { color, space } = useBeaconTheme();
  if (receipt) {
    const viewerZone = twoClock ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
    const at = format.twoClock(receipt.submittedAt, receipt.siteZone, viewerZone);
    return <Screen title={receipt.reference} navigation={{ kind: "close", label: t("mobile.request.close"), onPress: onClose }}
      dock={<Dock primary={{ label: t("mobile.request.openJob"), onPress: onOpenJob }} />}>
      <Card>
        <Badge tone="success" label={t("mobile.request.sent")} />
        <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.request.notYetBooking")}</Copy>
        {at.kind === "available" && <TwoClock siteTime={at.siteTime} siteZone={format.zoneLabel(receipt.siteZone, at.site)}
          viewerLine={at.viewer && at.viewerTime ? `${at.viewerTime} ${format.zoneLabel(viewerZone, at.viewer)}` : undefined} />}
        <Journey journey={receipt.journey} />
      </Card>
      <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.request.next")}</Copy>
      <Card dense>
        <ListRow glyph="▤" label={t("mobile.request.receiptQuote")} />
        <ListRow glyph="✓" label={t("mobile.request.receiptDecision")} />
        <ListRow glyph="◷" label={t("mobile.request.receiptWindow")} />
      </Card>
    </Screen>;
  }
  const sending = status === "sending"; const ready = !!payload(draft, items)?.success && !awaitingMedia && !wrongPlace && place?.state === "in_area" && !offline;
  const context = checking ? t("mobile.request.checking") : wrongPlace ? t("mobile.photos.placeChanged") : offline ? t("mobile.request.offline") : awaitingMedia ? t("mobile.photos.wait") : !ready ? (place?.state === "out_of_area" ? t("mobile.request.outsideArea") : place?.state !== "in_area" ? t("mobile.request.areaUnknown") : t("mobile.request.describeRequired")) : t("mobile.request.free");
  const who = draft.arrivalArrangement === "nobody" ? t("mobile.request.nobody") : draft.arrivalArrangement === "requester" ? t("mobile.request.me") : draft.arrivalContactName;
  const language = originalLanguageName(draft.language, locale);
  const cardHeading = { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" } as const;
  return <Screen title={t("mobile.request.reviewTitle")} subtitle={t("mobile.request.stepThree")} navigation={{ kind: "back", label: t("mobile.request.back"), onPress: onBack }} dock={<Dock context={context} primary={{ label: checking ? t("mobile.request.checkStatus") : t("mobile.request.send"), onPress: onSend, busy: sending, disabled: sending || offline || (!checking && !ready) }} />}>
    <StatusBanner state={offline ? "offline" : failed ? "not-sent" : "last-confirmed"}
      label={checking ? t("mobile.request.checking") : offline ? t("mobile.request.offline") : failed ? t("mobile.request.failed") : t("mobile.request.notBooking")}
      detail={failed && checking ? t("mobile.pending.reviewFailed") : !checking && !offline && !failed ? t("mobile.request.quoteFirst") : undefined} />
    {warn && <Copy>{t("mobile.request.expiryWarning")}</Copy>}
    <Card dense>
      <View style={cardHeading}><Copy variant="label">{t("mobile.request.job")}</Copy>
        <Button variant="quiet" label={t("mobile.request.edit")} onPress={onEditDescription} disabled={checking || sending} />
      </View>
      {!!draft.description.trim() && <Copy>{draft.description}</Copy>}
      {language && <Badge tone="info" label={t("mobile.customerQuote.original", { language })} />}
      {!!items.length && <AttachmentTiles items={items} offline={offline} onOpen={onOpenAttachment} onRemove={checking || sending ? undefined : onRemoveAttachment} onRetry={checking || sending ? undefined : onRetryAttachment} />}
    </Card>
    <Card dense>
      <View style={cardHeading}><Copy variant="label">{t("mobile.request.placeTitle")}</Copy>
        <Button variant="quiet" label={t("mobile.request.edit")} onPress={onEditPlace} disabled={checking || sending} />
      </View>
      {place && <Copy variant="label">{[place.alias, place.areaName].filter(Boolean).join(" · ")}</Copy>}
      {!!place?.address && <Copy variant="supporting" style={{ color: color.muted }}>{place.address}</Copy>}
      <View style={{ gap: space.grid[1], paddingTop: space.grid[2], borderTopWidth: 1, borderTopColor: color.separator }}>
        {!!draft.safeNote && <Copy>{draft.safeNote}</Copy>}
        <Copy variant="supporting">{who}</Copy>
      </View>
    </Card>
    <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.request.visibility")}</Copy>
  </Screen>;
}
