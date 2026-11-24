import { completionIdSchema, completionItemIdSchema, getJobCompletionRoute, submitCompletionRoute, type CompletionProjection, type CompletionSubmissionInput } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { useCommand, useRemote } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useAttach, useOpenMediaPreview, type MediaTransfer } from "../../media";
import { useSession } from "../../session";
import { Button, Card, Dock, Screen, SegmentedControl, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { AttachmentTiles, PhotoTile, useAttachNavigation } from "../c-02/attachments";
import { time } from "../c-06/Screen";
import { minorAmount, useLocalDraft } from "../f-04/draft";
import { useOffline } from "../s-02/flow";
import { confirmAction } from "../s-17/confirmAction";

type ForemanCompletion = Extract<CompletionProjection, { audience: "foreman" }>;
type Line = ForemanCompletion["approvedScope"]["lines"][number];
type DraftItem = { outcome: string; note: string; alternative: string; photoStage?: string };
type Draft = { items: { [key: string]: DraftItem }; billReference?: string; billAmount?: string };
const empty: Draft = { items: {} };
function lineKey(line: Line) { const ref = line.ref; return ref.kind === "quote" ? `q:${ref.quoteVersionId}:${ref.lineNo}` : `c:${ref.changeVersionId}:${ref.lineNo}`; }
type PhotosByLine = Record<string, readonly MediaTransfer[]>;
type PublishedItem = NonNullable<ForemanCompletion["submission"]>["items"][number];
const emptyLine: DraftItem = { outcome: "", note: "", alternative: "" };
function patchItem(draft: Draft, key: string, patch: Partial<DraftItem>): Draft {
  return { ...draft, items: { ...draft.items, [key]: { ...emptyLine, ...draft.items[key], ...patch } } };
}

function invoiceDraft(draft: Draft, total: number) {
  const billReference = draft.billReference?.trim() ?? "";
  const amount = draft.billAmount?.trim() ?? "";
  if (!billReference && !amount) return {};
  const billAmountMinor = minorAmount(amount);
  return billReference && billReference.length <= 500 && billAmountMinor === total && total > 0
    ? { billReference, billAmountMinor } : null;
}
export default function WrapUpScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>(); const { session } = useSession();
  return <WrapUpRoute key={`${session?.sessionId}:${session?.activeContext?.contextId}:${jobId}`} />;
}
function WrapUpRoute() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>(); const router = useRouter(); const t = useT(); const { bootstrap } = useSession(); const offline = useOffline();
  const format = useFormat();
  const remote = useRemote(getJobCompletionRoute, { params: { j: jobId ?? "" } }, { enabled: !!jobId }); const command = useCommand(submitCompletionRoute);
  const local = useLocalDraft<Draft>(`wrapup:${jobId ?? "missing"}`, empty);
  const data = (command.result ?? remote.data)?.audience === "foreman" ? (command.result ?? remote.data) as ForemanCompletion : null;
  const transfer = useAttach(jobId ? "completion" : undefined, jobId);
  const navigation = useAttachNavigation(); const preview = useOpenMediaPreview();
  const [photoError, setPhotoError] = useState(false);
  const photos: PhotosByLine = {};
  for (const [key, item] of Object.entries(local.value.items)) {
    if (item.photoStage) photos[key] = transfer.items.filter(photo => photo.selected && photo.stageId === item.photoStage);
  }
  const waitingPhotos = !transfer.loaded || Object.entries(photos).some(([key, items]) => local.value.items[key]?.outcome === "done" && items.some(item => item.state !== "ready"));
  const photoCount = Object.entries(photos).reduce((n, [key, items]) => n + (local.value.items[key]?.outcome === "done" ? items.length : 0), 0);
  const busy = command.state === "sending" || command.state === "checking";
  function submit() {
    if (!jobId || !data || !data.actions.submit || offline || busy || waitingPhotos || photoCount > 8) return;
    const invoice = invoiceDraft(local.value, data.approvedScope.totalMinor);
    if (!invoice) return;
    const items: CompletionSubmissionInput["items"] = [];
    for (const line of data.approvedScope.lines) {
      const key = lineKey(line); const item = local.value.items[key];
      if (!item || !item.note.trim() || (item.outcome !== "done" && item.outcome !== "not_done")) return;
      const evidence = item.outcome === "done" ? photos[key] ?? [] : [];
      if (item.outcome === "done" && !evidence.length && !line.evidenceAlternative) return;
      const common = { id: completionItemIdSchema.parse(uuid.v4()), scope: line.ref, originalLanguage: line.label.original.language, photos: evidence.map(photo => ({ attachmentId: photo.attachmentId })) };
      items.push(item.outcome === "done" ? { ...common, outcome: "done", resultNote: item.note.trim(), ...(!evidence.length && line.evidenceAlternative && { evidenceAlternative: line.evidenceAlternative }) } : { ...common, outcome: "not_done", reason: item.note.trim() });
    }
    if (!items.length) return;
    const payload: CompletionSubmissionInput = { id: completionIdSchema.parse(uuid.v4()), baseQuoteVersionId: data.approvedScope.quoteVersionId,
      expectedCompletionId: data.submission?.id ?? null, items, ...invoice };
    const label = t("mobile.wrapUp.submit");
    const review = [data.job.reference, t("mobile.wrapUp.version", { number: data.approvedScope.version }),
      ...data.approvedScope.lines.map(line => `${line.label.original.text} · ${local.value.items[lineKey(line)]?.outcome === "done"
        ? t("mobile.wrapUp.done") : t("mobile.wrapUp.notDone")}`)];
    const effects = [t("mobile.wrapUp.submitEffect"), t("mobile.photos.completionCount", { count: photoCount })];
    if (invoice.billReference && invoice.billAmountMinor !== undefined) {
      review.push(`${invoice.billReference} · ${format.money(invoice.billAmountMinor, data.approvedScope.currency)}`);
      effects.push(data.actions.canIssueBill ? t("mobile.wrapUp.billAfterSignOff") : t("mobile.wrapUp.billForProvider"));
    }
    confirmAction(router, { title: label, actionLabel: label, actionLabelKey: "mobile.wrapUp.submit", item: review.join("\n"),
      actor: bootstrap?.account.displayName ?? "", role: data.job.providerDisplayName, effects, onReview: () => { void remote.refresh(); },
      onConfirm: async () => {
        const result = await command.run({ params: { j: jobId }, body: { payload } });
        if (result.ok) { void local.remove().catch(() => {}); return "confirmed"; }
        return "delivery" in result.error && result.error.delivery === "unknown" ? "uncertain" : "invalidated";
      } });
  }
  return <WrapUpView data={data} status={remote.status} draft={local.value} change={local.change} saved={local.saved} saveFailed={local.failed} offline={offline} busy={busy} failed={photoError || command.state === "failed" || command.state === "conflict"} photos={photos} photoCount={photoCount} waitingPhotos={waitingPhotos}
    onAddPhoto={line => {
      if (!jobId || !data?.actions.submit || busy || photoCount >= 8) return;
      const key = lineKey(line); const existing = local.value.items[key]?.photoStage; const stage = existing ?? uuid.v4();
      if (!existing) local.change(patchItem(local.value, key, { photoStage: stage }));
      navigation.attach("completion", jobId, stage);
    }} onRemovePhoto={(line, photo) => {
      if (busy) return;
      const key = lineKey(line);
      void transfer.remove(photo.attachmentId).then(removed => {
        if (!removed) local.change(patchItem(local.value, key, { photoStage: uuid.v4() }));
      }).catch(() => setPhotoError(true));
    }} onRetryPhoto={id => { void transfer.retry(id).catch(() => setPhotoError(true)); }} onOpenDraft={navigation.preview}
    onOpenPhoto={(item, photo) => preview(photo.attachmentId, { caller: "completion", parentScopeId: item.id }, { titleContext: data?.job.reference, ...(photo.caption && { caption: { original: photo.caption.original.text, originalLanguage: photo.caption.original.language } }) })}
    onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} onSubmit={submit} onJob={() => router.replace(`/f/jobs/${jobId}` as Href)} />;
}
type Props = { data: ForemanCompletion | null; status: string; draft: Draft; change: (d: Draft) => void; saved: boolean; saveFailed: boolean; offline: boolean; busy: boolean; failed: boolean; photos?: PhotosByLine; photoCount?: number; waitingPhotos?: boolean; onAddPhoto?: (line: Line) => void; onRemovePhoto?: (line: Line, photo: MediaTransfer) => void; onRetryPhoto?: (id: string) => void; onOpenDraft?: (id: string) => void; onOpenPhoto?: (item: PublishedItem, photo: PublishedItem["photos"][number]) => void; onBack: () => void; onRetry: () => void; onSubmit: () => void; onJob: () => void };
export function WrapUpView(p: Props) {
  const t = useT(); const format = useFormat(); const d = p.data; const editable = !!d?.actions.submit;
  const invoice = d ? invoiceDraft(p.draft, d.approvedScope.totalMinor) : null;
  const valid = invoice !== null && !p.waitingPhotos && (p.photoCount ?? 0) <= 8 && !!d?.approvedScope.lines.length && d.approvedScope.lines.every(line => {
    const key = lineKey(line); const x = p.draft.items[key];
    return !!x && !!x.note.trim() && (x.outcome === "not_done" || (x.outcome === "done" && (!!p.photos?.[key]?.length || !!line.evidenceAlternative)));
  });
  const set = (line: Line, patch: Partial<DraftItem>) => p.change(patchItem(p.draft, lineKey(line), patch));
  return <Screen title={t("mobile.wrapUp.title")} navigation={{ kind: "back", label: t("mobile.wrapUp.back"), onPress: p.onBack }} dock={d ? <Dock context={editable ? p.waitingPhotos ? t("mobile.photos.wait") : t("mobile.wrapUp.submitEffect") : t("mobile.wrapUp.waiting", { name: d.namedApproverDisplayName })} primary={editable ? { label: t("mobile.wrapUp.submit"), onPress: p.onSubmit, disabled: !valid || p.offline || p.busy || p.status !== "ready", busy: p.busy, live: true } : { label: t("mobile.wrapUp.job"), onPress: p.onJob }} /> : undefined}>
    {(p.status === "loading" || p.status === "idle") && <Copy>{t("mobile.wrapUp.loading")}</Copy>}{(p.status === "error" || p.status === "offline") && <><Copy>{t("mobile.wrapUp.unavailable")}</Copy><Button label={t("mobile.wrapUp.retry")} onPress={p.onRetry} /></>}{p.offline && <Copy>{t("mobile.wrapUp.offline")}</Copy>}{p.saved && editable && <Copy>{t("mobile.wrapUp.saved")}</Copy>}{p.saveFailed && <Copy>{t("mobile.wrapUp.saveFailed")}</Copy>}{p.busy && <Copy>{t("mobile.wrapUp.checking")}</Copy>}{p.failed && <Copy>{t("mobile.wrapUp.failed")}</Copy>}
    {d && <><Copy variant="supporting">{d.job.reference} · {d.job.title} · {d.job.siteZone}</Copy>{d.work && <Card><Copy>{t("mobile.wrapUp.finishedAt", { time: time(format, d.work.finishedAt, d.job.siteZone) })}</Copy>{d.work.crewCheckedOutAt && <Copy>{t("mobile.wrapUp.checkedOutAt", { time: time(format, d.work.crewCheckedOutAt, d.job.siteZone) })}</Copy>}</Card>}
    {d.submission?.state === "returned" ? <Card><Copy variant="sectionTitle">{t("mobile.wrapUp.returned")}</Copy>{d.correction && <Copy>{d.correction.reason.original.text}</Copy>}</Card>
      : d.submission && <Card><Copy variant="sectionTitle">{t("mobile.wrapUp.submitted")}</Copy><Copy>{d.submission.state === "submitted" && `${t("mobile.wrapUp.waiting", { name: d.namedApproverDisplayName })} · `}{time(format, d.submission.submitted.at, d.job.siteZone)}</Copy></Card>}
    <Card><Copy variant="sectionTitle">{t("mobile.wrapUp.scope")}</Copy><Copy>{t("mobile.wrapUp.version", { number: d.approvedScope.version })} · {format.money(d.approvedScope.totalMinor, d.approvedScope.currency)}</Copy><Copy>{d.approvedScope.scope.original.text}</Copy>{d.approvedScope.exclusions && <Copy>{t("mobile.wrapUp.excluded")}: {d.approvedScope.exclusions.original.text}</Copy>}</Card>
    {d.approvedScope.lines.map(line => {
      const key = lineKey(line);
      const item = p.draft.items[key] ?? emptyLine;
      const photos = p.photos?.[key] ?? [];
      const submitted = d.submission?.items.find(x => JSON.stringify(x.scope) === JSON.stringify(line.ref));
      return <Card key={key}><Copy variant="sectionTitle">{line.label.original.text}</Copy><Copy variant="supporting">{line.evidenceRule}</Copy>
        {editable ? <>
          <SegmentedControl label={t("mobile.wrapUp.outcome")} options={[{ value: "done", label: t("mobile.wrapUp.done") }, { value: "not_done", label: t("mobile.wrapUp.notDone") }]} value={item.outcome} disabled={p.busy} onChange={outcome => set(line, { outcome })} />
          {item.outcome !== "" && <TextField label={item.outcome === "done" ? t("mobile.wrapUp.result") : t("mobile.wrapUp.reason")} multiline value={item.note} disabled={p.busy} onChangeText={note => set(line, { note })} />}
          {item.outcome === "done" && <>
            <AttachmentTiles items={photos} offline={p.offline} onOpen={p.onOpenDraft} onRetry={p.busy ? undefined : p.onRetryPhoto} onRemove={p.busy || !p.onRemovePhoto ? undefined : photo => p.onRemovePhoto?.(line, photo)} />
            {!photos.length && <>{line.evidenceAlternative ? <><Copy>{t("mobile.wrapUp.alternative")}</Copy><Copy>{line.evidenceAlternative}</Copy></> : <Copy>{t("mobile.wrapUp.photoRequired")}</Copy>}
              {p.onAddPhoto && <Button variant="neutral" label={t("mobile.photos.addPhoto")} onPress={() => p.onAddPhoto?.(line)} disabled={p.busy || (p.photoCount ?? 0) >= 8} />}</>}
          </>}
        </> : submitted && <><Copy>{submitted.outcome === "done" ? t("mobile.wrapUp.done") : t("mobile.wrapUp.notDone")}</Copy><Copy>{submitted.outcome === "done" ? submitted.result.original.text : submitted.reason.original.text}</Copy>
          {submitted.photos.map(photo => photo.availability === "available" ? <PhotoTile key={photo.attachmentId} label={photo.caption?.original.text ?? t("mobile.case.evidencePhoto")} onOpen={p.onOpenPhoto ? () => p.onOpenPhoto?.(submitted, photo) : undefined} /> : <Copy key={photo.attachmentId}>{t("mobile.case.evidenceUnavailable")}</Copy>)}
        </>}
      </Card>;
    })}
    {editable && !!p.photoCount && <Copy variant="supporting">{t("mobile.photos.completionCount", { count: p.photoCount })}</Copy>}
    {editable ? <Card>
      <TextField label={t("mobile.wrapUp.billReference")} value={p.draft.billReference ?? ""} maxLength={500}
        onChangeText={billReference => p.change({ ...p.draft, billReference })} />
      <TextField label={t("mobile.wrapUp.billAmount")} inputMode="decimal" value={p.draft.billAmount ?? ""}
        onChangeText={billAmount => p.change({ ...p.draft, billAmount })} />
      <Copy>{t("mobile.wrapUp.billApproved", { amount: format.money(d.approvedScope.totalMinor, d.approvedScope.currency) })}</Copy>
      <Copy variant="supporting">{invoice === null ? t("mobile.wrapUp.billMismatch")
        : d.actions.canIssueBill ? t("mobile.wrapUp.billAfterSignOff") : t("mobile.wrapUp.billForProvider")}</Copy>
    </Card> : d.submission?.billReference && d.submission.billAmountMinor !== null && <Card>
      <Copy>{t("mobile.aftercare.reference", { reference: d.submission.billReference })}</Copy>
      <Copy>{format.money(d.submission.billAmountMinor, d.approvedScope.currency)}</Copy>
    </Card>}
    <Card><Copy>{t("mobile.wrapUp.customerSees")}</Copy><Copy>{t("mobile.wrapUp.directBill")}</Copy></Card></>}
  </Screen>;
}
