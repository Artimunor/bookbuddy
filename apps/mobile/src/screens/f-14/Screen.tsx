import { completionIdSchema, completionItemIdSchema, getJobCompletionRoute, submitCompletionRoute, type CompletionProjection, type CompletionSubmissionInput } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCommand, useRemote } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Button, Card, Dock, Screen, SegmentedControl, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { time } from "../c-06/Screen";
import { useLocalDraft } from "../f-04/draft";
import { useOffline } from "../s-02/flow";
import { confirmAction } from "../s-17/confirmAction";

type ForemanCompletion = Extract<CompletionProjection, { audience: "foreman" }>;
type Line = ForemanCompletion["approvedScope"]["lines"][number];
type DraftItem = { outcome: string; note: string; alternative: string };
type Draft = { items: { [key: string]: DraftItem } };
const empty: Draft = { items: {} };
function lineKey(line: Line) { const ref = line.ref; return ref.kind === "quote" ? `q:${ref.quoteVersionId}:${ref.lineNo}` : `c:${ref.changeVersionId}:${ref.lineNo}`; }
export default function WrapUpScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>(); const { session } = useSession();
  return <WrapUpRoute key={`${session?.sessionId}:${session?.activeContext?.contextId}:${jobId}`} />;
}
function WrapUpRoute() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>(); const router = useRouter(); const t = useT(); const { bootstrap } = useSession(); const offline = useOffline();
  const remote = useRemote(getJobCompletionRoute, { params: { j: jobId ?? "" } }, { enabled: !!jobId }); const command = useCommand(submitCompletionRoute);
  const local = useLocalDraft<Draft>(`wrapup:${jobId ?? "missing"}`, empty);
  const data = (command.result ?? remote.data)?.audience === "foreman" ? (command.result ?? remote.data) as ForemanCompletion : null;
  const busy = command.state === "sending" || command.state === "checking";
  function submit() {
    if (!jobId || !data || !data.actions.submit || offline || busy) return;
    const items: CompletionSubmissionInput["items"] = [];
    for (const line of data.approvedScope.lines) {
      const item = local.value.items[lineKey(line)]; if (!item || !item.note.trim() || (item.outcome !== "done" && item.outcome !== "not_done") || (item.outcome === "done" && !line.evidenceAlternative)) return;
      const common = { id: completionItemIdSchema.parse(uuid.v4()), scope: line.ref, originalLanguage: line.label.original.language, photos: [] };
      items.push(item.outcome === "done" ? { ...common, outcome: "done", resultNote: item.note.trim(), evidenceAlternative: line.evidenceAlternative! } : { ...common, outcome: "not_done", reason: item.note.trim() });
    }
    if (!items.length) return;
    const payload: CompletionSubmissionInput = { id: completionIdSchema.parse(uuid.v4()), baseQuoteVersionId: data.approvedScope.quoteVersionId, expectedCompletionId: data.submission?.id ?? null, items };
    confirmAction(router, { title: t("mobile.wrapUp.submit"), actionLabel: t("mobile.wrapUp.submit"), actionLabelKey: "mobile.wrapUp.submit", item: [data.job.reference, t("mobile.wrapUp.version", { number: data.approvedScope.version }), ...data.approvedScope.lines.map(line => `${line.label.original.text} · ${local.value.items[lineKey(line)]?.outcome === "done" ? t("mobile.wrapUp.done") : t("mobile.wrapUp.notDone")}`)].join("\n"), actor: bootstrap?.account.displayName ?? "", role: data.job.providerDisplayName, effects: [t("mobile.wrapUp.submitEffect")], onReview: () => { void remote.refresh(); }, onConfirm: async () => { const result = await command.run({ params: { j: jobId }, body: { payload } }); if (result.ok) { void local.remove().catch(() => {}); return "confirmed"; } if (result.error.code === "CONFLICT" || result.error.code === "STALE_REVISION" || result.error.code === "NOT_FOUND") { await remote.refresh(); return "invalidated"; } return "uncertain"; } });
  }
  return <WrapUpView data={data} status={remote.status} draft={local.value} change={local.change} saved={local.saved} saveFailed={local.failed} offline={offline} busy={busy} failed={command.state === "failed" || command.state === "conflict"} onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} onSubmit={submit} onJob={() => router.replace(`/f/jobs/${jobId}` as Href)} />;
}
type Props = { data: ForemanCompletion | null; status: string; draft: Draft; change: (d: Draft) => void; saved: boolean; saveFailed: boolean; offline: boolean; busy: boolean; failed: boolean; onBack: () => void; onRetry: () => void; onSubmit: () => void; onJob: () => void };
export function WrapUpView(p: Props) {
  const t = useT(); const format = useFormat(); const d = p.data; const editable = !!d?.actions.submit; const valid = !!d?.approvedScope.lines.length && d.approvedScope.lines.every(line => { const x = p.draft.items[lineKey(line)]; return !!x && (x.outcome === "done" || x.outcome === "not_done") && !!x.note.trim() && (x.outcome !== "done" || !!line.evidenceAlternative); });
  const set = (line: Line, patch: Partial<DraftItem>) => { const key = lineKey(line); p.change({ items: { ...p.draft.items, [key]: { outcome: "", note: "", alternative: "", ...p.draft.items[key], ...patch } } }); };
  return <Screen title={t("mobile.wrapUp.title")} navigation={{ kind: "back", label: t("mobile.wrapUp.back"), onPress: p.onBack }} dock={d ? <Dock context={editable ? t("mobile.wrapUp.submitEffect") : t("mobile.wrapUp.waiting", { name: d.namedApproverDisplayName })} primary={editable ? { label: t("mobile.wrapUp.submit"), onPress: p.onSubmit, disabled: !valid || p.offline || p.busy || p.status !== "ready", busy: p.busy, live: true } : { label: t("mobile.wrapUp.job"), onPress: p.onJob }} /> : undefined}>
    {(p.status === "loading" || p.status === "idle") && <Copy>{t("mobile.wrapUp.loading")}</Copy>}{(p.status === "error" || p.status === "offline") && <><Copy>{t("mobile.wrapUp.unavailable")}</Copy><Button label={t("mobile.wrapUp.retry")} onPress={p.onRetry} /></>}{p.offline && <Copy>{t("mobile.wrapUp.offline")}</Copy>}{p.saved && editable && <Copy>{t("mobile.wrapUp.saved")}</Copy>}{p.saveFailed && <Copy>{t("mobile.wrapUp.saveFailed")}</Copy>}{p.busy && <Copy>{t("mobile.wrapUp.checking")}</Copy>}{p.failed && <Copy>{t("mobile.wrapUp.failed")}</Copy>}
    {d && <><Copy variant="supporting">{d.job.reference} · {d.job.title} · {d.job.siteZone}</Copy>{d.work && <Card><Copy>{t("mobile.wrapUp.finishedAt", { time: time(format, d.work.finishedAt, d.job.siteZone) })}</Copy>{d.work.crewCheckedOutAt && <Copy>{t("mobile.wrapUp.checkedOutAt", { time: time(format, d.work.crewCheckedOutAt, d.job.siteZone) })}</Copy>}</Card>}{d.correction && <Card><Copy variant="sectionTitle">{t("mobile.wrapUp.returned")}</Copy><Copy>{d.correction.reason.original.text}</Copy></Card>}{d.submission && <Card><Copy variant="sectionTitle">{t("mobile.wrapUp.submitted")}</Copy><Copy>{!d.correction && t("mobile.wrapUp.waiting", { name: d.namedApproverDisplayName })} · {time(format, d.submission.submitted.at, d.job.siteZone)}</Copy></Card>}
    <Card><Copy variant="sectionTitle">{t("mobile.wrapUp.scope")}</Copy><Copy>{t("mobile.wrapUp.version", { number: d.approvedScope.version })} · {format.money(d.approvedScope.totalMinor, d.approvedScope.currency)}</Copy><Copy>{d.approvedScope.scope.original.text}</Copy>{d.approvedScope.exclusions && <Copy>{t("mobile.wrapUp.excluded")}: {d.approvedScope.exclusions.original.text}</Copy>}</Card>
    {d.approvedScope.lines.map(line => { const item = p.draft.items[lineKey(line)] ?? { outcome: "", note: "", alternative: "" }; const submitted = d.submission?.items.find(x => JSON.stringify(x.scope) === JSON.stringify(line.ref)); return <Card key={lineKey(line)}><Copy variant="sectionTitle">{line.label.original.text}</Copy><Copy variant="supporting">{line.evidenceRule}</Copy>{editable ? <><SegmentedControl label={t("mobile.wrapUp.outcome")} options={[{ value: "done", label: t("mobile.wrapUp.done") }, { value: "not_done", label: t("mobile.wrapUp.notDone") }]} value={item.outcome} onChange={outcome => set(line, { outcome })} />{item.outcome !== "" && <TextField label={item.outcome === "done" ? t("mobile.wrapUp.result") : t("mobile.wrapUp.reason")} multiline value={item.note} onChangeText={note => set(line, { note })} />}{item.outcome === "done" && (line.evidenceAlternative ? <><Copy>{t("mobile.wrapUp.alternative")}</Copy><Copy>{line.evidenceAlternative}</Copy></> : <Copy>{t("mobile.wrapUp.photoRequired")}</Copy>)}</> : submitted && <><Copy>{submitted.outcome === "done" ? t("mobile.wrapUp.done") : t("mobile.wrapUp.notDone")}</Copy><Copy>{submitted.outcome === "done" ? submitted.result.original.text : submitted.reason.original.text}</Copy>{submitted.photos.map(photo => <Copy key={photo.attachmentId}>{photo.caption?.original.text} · {photo.attachmentId} · {photo.availability}</Copy>)}</>}</Card>; })}
    <Card><Copy>{t("mobile.wrapUp.customerSees")}</Copy><Copy>{t("mobile.wrapUp.directBill")}</Copy></Card></>}
  </Screen>;
}
