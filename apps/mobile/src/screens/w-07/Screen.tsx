import { idSchemaFor, localeTagSchema } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { SymbolView } from "expo-symbols";
import { View } from "react-native";
import { useFormat, useLocale, useT } from "../../i18n";
import { useAttach, useOpenMediaPreview } from "../../media";
import { useDraft, useOutbox, useProgressReceipts } from "../../repository/hooks";
import { Button, Card, Dock, Screen, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { BeaconThemeProvider, useBeaconTheme } from "../../ui/theme";
import { PhotoTile, useAttachNavigation } from "../c-02/attachments";
import { confirmAction } from "../s-17/confirmAction";
import { useFieldShift, type FieldShift } from "../w-04/Screen";

const activityId = idSchemaFor<"visit_activity_event">();
type Note = { text: string; language: string; capturedAt: number; queuedAt?: number; omitted?: boolean };
type ProgressDraft = { notes: Record<string, Note> };
const empty: ProgressDraft = { notes: {} };
type Status = "review" | "queued" | "uploading" | "checking" | "failed" | "sent";
export type ProgressPhoto = { id: string; uri?: string | null; note: Note; status: Status; queuedAt?: number; receivedAt?: number; open?: () => void; remove?: () => void; retry?: () => void };

export default function ProgressPhotosScreen() {
  const shift = useFieldShift();
  return <BeaconThemeProvider field><ProgressRoute key={shift.assignmentId} shift={shift} /></BeaconThemeProvider>;
}
function ProgressRoute({ shift: f }: { shift: { assignmentId: string; shiftId: string; data: FieldShift | null; lastConfirmedAt: number | null; offline: boolean; loading: boolean; error: boolean; refresh: () => Promise<void> } }) {
  const t = useT(); const format = useFormat(); const { locale } = useLocale(); const router = useRouter(); const navigate = useAttachNavigation(); const open = useOpenMediaPreview();
  const d = f.data; const receipts = useProgressReceipts(f.assignmentId);
  const local = useDraft<ProgressDraft>(d ? `progress:${f.assignmentId}` : null);
  const transfer = useAttach(d ? "progress" : undefined, d?.id, d?.id);
  const outbox = useOutbox({ retryMedia: transfer.retry });
  const selected = transfer.items.filter(item => item.selected && item.file.kind === "photo");
  const [notes, setNotes] = useState<ProgressDraft | null>(null);
  const latest = useRef<ProgressDraft | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const guarding = useRef(false);
  const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  const canCapture = d?.state === "confirmed" && !!d.attendance.arrival && !d.attendance.departure && d.work?.kind === "work_started" && !d.holds.some(hold => hold.state === "active");
  const back = () => router.canGoBack() ? router.back() : router.replace(`/w/shifts/${f.shiftId}?assignmentId=${encodeURIComponent(f.assignmentId)}` as Href);
  function save(next: ProgressDraft) {
    latest.current = next; setNotes(next);
    const saved = saveQueue.current.catch(() => {}).then(() => local.save(next));
    saveQueue.current = saved;
    return saved;
  }
  useEffect(() => {
    if (!d || !local.loaded || !transfer.loaded) return;
    const current = latest.current ?? local.draft?.value ?? empty;
    const missing = selected.filter(item => !current.notes[item.attachmentId]);
    if (missing.length === 0) { if (!latest.current) { latest.current = current; setNotes(current); } return; }
    const additions = Object.fromEntries(missing.map(item => [item.attachmentId, { text: "", language: locale, capturedAt: item.capturedAt ?? Date.now() }]));
    void save({ notes: { ...current.notes, ...additions } }).catch(() => setFailed(true));
  }, [d, local.loaded, local.draft, transfer.loaded, transfer.items, locale]);
  const result = f.data && notes ? selected.flatMap((item): ProgressPhoto[] => {
    const id = item.attachmentId; const note = notes.notes[id];
    if (!note || note.omitted) return [];
    const operationId = item.operationId;
    const entry = outbox.entries.find(row => row.operation.operationId === operationId);
    const receipt = receipts.find(row => row.operationId === operationId);
    const recorded = receipt?.photoOutcomes.find(photo => photo.activityId === id && photo.status !== "rejected");
    const status: Status = recorded ? "sent" : receipt?.state === "rejected" || entry?.status === "rejected" || entry?.status === "conflict" || item.state === "failed" ? "failed" : entry?.status === "checking" || receipt?.state === "sent" ? "checking" : entry || note.queuedAt !== undefined ? f.offline || item.state === "queued" ? "queued" : "uploading" : "review";
    const openPhoto = status === "sent" ? () => open(id, { caller: "progress", parentScopeId: f.shiftId }, { titleContext: d?.job.reference, ...(note.text.trim() && { caption: { original: note.text, originalLanguage: note.language } }) }) : item.fileUri ? () => navigate.preview(id) : undefined;
    async function remove() {
      const current = latest.current;
      const currentNote = current?.notes[id];
      if (!current || !currentNote) return "invalidated" as const;
      if ((entry?.status === "queued" || entry?.status === "failed" || (!entry && currentNote.queuedAt !== undefined && !receipt)) && !await outbox.remove(operationId)) return "uncertain" as const;
      await transfer.remove(id);
      await save({ notes: { ...current.notes, [id]: { ...currentNote, omitted: true } } });
      return "confirmed" as const;
    }
    return [{ id, uri: item.fileUri, note, status, queuedAt: entry?.createdAt ?? note.queuedAt, receivedAt: recorded && recorded.status !== "rejected" ? recorded.receivedAt : undefined, open: openPhoto,
      remove: status === "sent" || status === "checking" || busy ? undefined : () => {
        if (!entry && note.queuedAt === undefined) { void remove().catch(() => setFailed(true)); return; }
        const label = t("mobile.media.remove");
        confirmAction(router, { title: t("mobile.photos.cancelQueue"), actionLabel: label, actionLabelKey: "mobile.media.remove", item: note.text || t("mobile.jobControl.photo"), actor: "", role: "", effects: [], serverAction: false, destructive: true, onReview: () => {}, onConfirm: async () => { try { return await remove(); } catch { return "invalidated"; } } });
      }, retry: f.offline ? undefined : entry?.status === "checking" || entry?.status === "failed" ? () => { void outbox.retry(operationId).catch(() => setFailed(true)); } : !entry && !receipt && item.state === "failed" && !item.terminal ? () => { void transfer.retry(id).catch(() => setFailed(true)); } : undefined }];
  }) : [];
  const review = result.filter(item => item.status === "review");
  const invalidLanguage = review.some(item => item.note.text.trim() && !localeTagSchema.safeParse(item.note.language.trim()).success);
  async function send() {
    if (!d || !transfer.loaded || !review.length || guarding.current || invalidLanguage) return;
    guarding.current = true; setBusy(true); setFailed(false);
    try {
      await saveQueue.current;
      let readyOperation: string | undefined;
      for (const item of review) {
        const source = selected.find(candidate => candidate.attachmentId === item.id);
        if (!source) continue;
        const caption = item.note.text.trim() ? { language: item.note.language.trim(), text: item.note.text } : undefined;
        const operationId = await outbox.enqueueOperation({ kind: "attachment_link", operationId: source.operationId, payload: { assignmentId: d.id, photos: [{ activityId: activityId.parse(source.attachmentId), attachmentId: source.attachmentId, capturedAt: item.note.capturedAt, ...(caption && { caption }) }] } });
        const current = latest.current;
        if (current) await save({ notes: { ...current.notes, [item.id]: { ...item.note, queuedAt: Date.now() } } });
        if (source.state === "ready") readyOperation = operationId;
      }
      if (!f.offline && readyOperation) await outbox.retry(readyOperation);
    } catch { setFailed(true); }
    finally { guarding.current = false; setBusy(false); }
  }
  const time = (value: number) => d ? format.lines(value, d.siteZone)?.site ?? "" : "";
  return <ProgressPhotosView job={d ? `${d.job.reference} · ${d.job.title ?? d.task}` : null} recipient={d?.foremanName ?? ""} offline={f.offline} confirmedTime={f.lastConfirmedAt !== null ? time(f.lastConfirmedAt) : undefined} time={time} items={result} canAdd={!!canCapture && transfer.loaded && transfer.items.length < 6} busy={busy} failed={failed || f.error} loading={f.loading} invalidLanguage={invalidLanguage} onBack={back} onReload={() => { void f.refresh(); }} onAdd={() => { if (d && canCapture) navigate.attach("progress", d.id, d.id); }} onSend={() => { void send(); }} onNote={(id, update) => {
    const current = latest.current; const note = current?.notes[id];
    if (current && note && !guarding.current) void save({ notes: { ...current.notes, [id]: { ...note, ...update } } }).catch(() => setFailed(true));
  }} />;
}

export function ProgressPhotosView(p: { job: string | null; recipient: string; offline: boolean; confirmedTime?: string; time: (at: number) => string; items: readonly ProgressPhoto[]; canAdd: boolean; busy?: boolean; failed?: boolean; loading?: boolean; invalidLanguage?: boolean; onBack: () => void; onReload?: () => void; onAdd: () => void; onSend: () => void; onNote: (id: string, update: Partial<Pick<Note, "text" | "language">>) => void }) {
  const t = useT(); const { color, radius, space } = useBeaconTheme();
  const review = p.items.filter(item => item.status === "review");
  const queue = p.items.filter(item => item.status !== "review" && item.status !== "sent");
  const waiting = queue.filter(item => item.status === "queued").length;
  const sent = p.items.filter(item => item.status === "sent");
  const add = !p.items.length ? t("mobile.photos.addPhoto") : t("mobile.photos.another");
  const primary = review.length ? { label: p.offline ? t("mobile.photos.queue", { count: review.length }) : t("mobile.photos.send", { count: review.length, name: p.recipient }), onPress: p.onSend, busy: p.busy, disabled: p.invalidLanguage }
    : p.items.length || !p.canAdd ? { label: t("mobile.liveShift.backToShift"), onPress: p.onBack } : { label: add, onPress: p.onAdd };
  const context = p.invalidLanguage ? t("mobile.photos.invalidLanguage") : !p.job ? undefined : waiting && p.offline && !review.length ? t("mobile.photos.awaiting", { count: waiting, name: p.recipient }) : t("mobile.photos.destination", { name: p.recipient });
  return <Screen title={t("mobile.photos.progressTitle")} subtitle={p.job ?? undefined} navigation={{ kind: "back", label: t("mobile.liveShift.back"), onPress: p.onBack }} dock={<Dock primary={primary} context={context} />}>
    {!p.job && <Copy>{p.loading ? t("mobile.liveShift.loading") : t("mobile.liveShift.unavailable")}</Copy>}
    {p.failed && <><Copy accessibilityRole="alert">{t("mobile.photos.failed")}</Copy>{!p.job && p.onReload && <Button label={t("shared.action.retry")} onPress={p.onReload} />}</>}
    {p.job && <>
      {p.offline && <View style={{ padding: space.grid[4], gap: space.grid[1], backgroundColor: color.attentionSoft, borderRadius: radius.card }}><Copy variant="sectionTitle" style={{ color: color.attentionInk }}>{p.confirmedTime ? t("mobile.liveShift.offlineAt", { time: p.confirmedTime }) : t("mobile.liveShift.offline")}</Copy>{waiting > 0 && <Copy style={{ color: color.attentionInk }}>{t("mobile.photos.waiting", { count: waiting })}</Copy>}</View>}
      {(!p.offline || !queue.length) && <View style={{ flexDirection: "row", gap: space.grid[3], alignItems: "flex-start", backgroundColor: color.infoSoft, borderRadius: radius.card, padding: space.grid[4] }}>
        <SymbolView name={{ ios: "lock", android: "lock", web: "lock" }} size={24} tintColor={color.infoInk} accessible={false} />
        <View style={{ flex: 1, gap: space.grid[1] }}>
          <Copy variant="label" style={{ color: color.infoInk }}>{t("mobile.photos.forRecipient", { name: p.recipient })}</Copy>
          <Copy variant="supporting" style={{ color: color.infoInk }}>{t("mobile.photos.privacy")}</Copy>
        </View>
      </View>}
      {review.map((item, i) => <Card dense key={item.id}>
        <PhotoTile large label={t("mobile.photos.number", { number: i + 1 })} uri={item.uri} onOpen={item.open} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.grid[2] }}>
          <Copy variant="supporting" style={{ color: color.muted, flex: 1 }}>{t("mobile.photos.taken", { time: p.time(item.note.capturedAt) })} · {t("mobile.photos.review")}</Copy>
          {item.remove && <Button variant="quiet" label={t("mobile.media.remove")} accessibilityLabel={t("mobile.photos.removeNamed", { name: t("mobile.photos.number", { number: i + 1 }) })} onPress={item.remove} />}
        </View>
        <TextField label={t("mobile.photos.caption")} maxLength={500} value={item.note.text} disabled={p.busy} onChangeText={text => p.onNote(item.id, { text })} />
        {!!item.note.text.trim() && <TextField label={t("mobile.request.language")} value={item.note.language} autoCapitalize="none" maxLength={255} disabled={p.busy} onChangeText={language => p.onNote(item.id, { language })} />}
      </Card>)}
      {queue.length > 0 && <Card><Copy variant="sectionTitle">{t("mobile.photos.uploadQueue")}</Copy>{waiting > 0 && <Copy variant="supporting">{t("mobile.photos.waiting", { count: waiting })}</Copy>}{queue.map((item, i) => <View key={item.id} style={{ gap: space.grid[2] }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.grid[3], alignItems: "center" }}><PhotoTile label={t("mobile.photos.number", { number: i + 1 })} uri={item.uri} pending={item.status === "queued"} onOpen={item.open} /><View style={{ flex: 1, minWidth: 100 }}>
          {!!item.note.text && <Copy accessibilityLanguage={item.note.language}>{item.note.text}</Copy>}
          <Copy variant="supporting">{t("mobile.photos.taken", { time: p.time(item.note.capturedAt) })}{item.queuedAt !== undefined ? ` · ${t("mobile.photos.queuedAt", { time: p.time(item.queuedAt) })}` : ""}</Copy>
        </View></View>
        <Copy variant="label" accessibilityLiveRegion={item.status === "failed" ? "polite" : "none"} style={{ color: item.status === "failed" ? color.criticalInk : color.attentionInk }}>{item.status === "queued" ? t("mobile.media.savedPending") : item.status === "checking" ? t("mobile.photos.checking") : item.status === "failed" ? t("mobile.photos.failed") : t("mobile.media.uploading")}</Copy>
        {item.status === "queued" && <Copy variant="supporting">{t("mobile.photos.notReceived", { name: p.recipient })}</Copy>}
        {item.remove && <Button variant="quiet" label={t("mobile.media.remove")} onPress={item.remove} />}
        {item.retry && <Button variant="quiet" label={t("shared.action.retry")} onPress={item.retry} />}
      </View>)}</Card>}
      {p.offline && waiting > 0 && <Copy variant="supporting">{t("mobile.photos.reconnect")}</Copy>}
      {sent.map((item, i) => <Card key={item.id}><PhotoTile label={t("mobile.photos.number", { number: i + 1 })} uri={item.uri} onOpen={item.open} />{item.note.text && <Copy accessibilityLanguage={item.note.language}>{item.note.text}</Copy>}<Copy accessibilityLiveRegion="polite">{t("mobile.photos.received", { name: p.recipient, time: item.receivedAt !== undefined ? p.time(item.receivedAt) : "" })}</Copy></Card>)}
      {p.canAdd && p.items.length > 0 && <Button variant="neutral" label={add} glyph="+" onPress={p.onAdd} disabled={p.busy} />}
      {!p.canAdd && !p.items.length && <Copy variant="supporting">{t("mobile.photos.captureUnavailable")}</Copy>}
    </>}
  </Screen>;
}
