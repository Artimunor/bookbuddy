import { createQuoteVersionRoute, getQuoteVersionRoute, issueQuoteVersionRoute, listQuoteVersionsRoute, submitQuoteReviewRoute, type QuoteVersion } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Image, View } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useAttach, useOpenMediaPreview, type MediaTransfer } from "../../media";
import { useMediaReadBatch } from "../../media/read-batch";
import { useSession } from "../../session";
import { Badge, Button, Card, Dock, ListRow, Screen, TextField, Thumb } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { ScopeTwin, time } from "../c-06/Screen";
import { useOffline } from "../s-02/flow";
import { confirmAction } from "../s-17/confirmAction";
import { minorAmount, useLocalDraft } from "./draft";

export type StaffQuote = Extract<QuoteVersion, { audience: "foreman" | "reviewer" }>;
export type QuoteDraft = {
  scope: string; exclusions: string; locale: string;
  lines: { label: string; amount: string; evidence: string; evidenceAlternative?: string }[];
  mediaStageId?: string; excludedAttachments?: string[];
};
export const emptyQuote: QuoteDraft = { scope: "", exclusions: "", locale: "", lines: [{ label: "", amount: "", evidence: "" }] };

export default function ForemanQuoteScreen() {
  const { jobId, versionId } = useLocalSearchParams<{ jobId: string; versionId?: string }>();
  const { session } = useSession();
  return <QuoteRoute key={`${session?.sessionId}:${session?.activeContext?.contextId}:${jobId}:${versionId ?? ""}`} jobId={jobId} versionId={versionId} />;
}
function QuoteRoute({ jobId, versionId }: { jobId: string; versionId?: string }) {
  const router = useRouter(); const t = useT(); const format = useFormat();
  const [revision, setRevision] = useState(false);
  const list = useRemote(listQuoteVersionsRoute, { params: { j: jobId ?? "" } }, { enabled: !!jobId && (!versionId || revision) });
  const versions = list.data?.audience === "foreman" ? list.data.versions : [];
  const latest = versions.reduce<(typeof versions)[number] | null>((a, b) => !a || b.no > a.no ? b : a, null);
  const selectedId = versionId ?? latest?.id;
  const remote = useRemote(getQuoteVersionRoute, { params: { j: jobId ?? "", id: selectedId ?? "" } }, { enabled: !!jobId && !!selectedId });
  const read = remote.data?.audience === "foreman" ? remote.data : null;
  const create = useCommand(createQuoteVersionRoute);
  const submit = useCommand(submitQuoteReviewRoute);
  const issue = useCommand(issueQuoteVersionRoute);
  const [written, setWritten] = useState<StaffQuote | null>(null);
  const [submittedStageId, setSubmittedStageId] = useState<string>();
  const local = useLocalDraft<QuoteDraft>(`quote:${jobId ?? "missing"}`, emptyQuote);
  const offline = useOffline(); const { bootstrap } = useSession();
  const data = written ?? read;
  const terms = list.data?.audience === "foreman" ? list.data.currentTerms : null;
  const states = [create.state, submit.state, issue.state];
  const busy = states.includes("sending") || states.includes("checking");
  const checking = states.includes("checking");
  const failed = states.includes("failed") || states.includes("conflict");
  const editable = (!data || revision) && (!versionId || revision) && (offline || (list.status === "ready" && (!selectedId || remote.status === "ready")));
  const stageId = local.value.mediaStageId !== submittedStageId ? local.value.mediaStageId : undefined;
  const media = useAttach(stageId && editable ? "quote" : undefined, jobId, stageId);
  const openMediaPreview = useOpenMediaPreview();
  const attachments = media.items.filter(item => item.selected && !local.value.excludedAttachments?.includes(item.attachmentId));
  const mediaReady = !stageId || (media.loaded && attachments.every(item => item.state === "ready"));
  function attach() {
    const nextStage = stageId ?? uuid.v4();
    if (!stageId) local.change({ ...local.value, mediaStageId: nextStage, excludedAttachments: [] });
    router.push({ pathname: "/attach", params: { caller: "quote", parentScopeId: jobId, stageId: nextStage } } as Href);
  }
  async function prepare() {
    if (!jobId || !terms || offline || busy || !mediaReady) return;
    const items = local.value.lines.map(line => ({
      originalLabel: line.label.trim(), netMinor: minorAmount(line.amount), taxMinor: 0, quantity: 1,
      evidenceRule: line.evidence.trim(), evidenceAlternative: line.evidenceAlternative?.trim() || undefined,
    }));
    if (!local.value.scope.trim() || !local.value.locale.trim() || items.some(x => !x.originalLabel || !x.evidenceRule || x.netMinor === null) || items.reduce((n, x) => n + (x.netMinor ?? 0), 0) <= 0) return;
    const evidence = attachments.map(({ attachmentId }) => ({ attachmentId }));
    const result = await create.run({ params: { j: jobId }, body: { payload: { id: uuid.v4(), termsVersionId: terms.id, originalLocale: local.value.locale.trim(), scope: local.value.scope.trim(), exclusions: local.value.exclusions.trim(), evidence, items: items.map(x => ({ ...x, netMinor: x.netMinor! })) } } });
    if (!result.ok) return;
    setWritten(result.data);
    setSubmittedStageId(stageId);
    setRevision(false);
    void local.remove().catch(() => {});
    confirmNext(result.data);
  }
  function refresh() {
    setWritten(null);
    if (!versionId || revision) void list.refresh();
    if (selectedId) void remote.refresh();
  }
  function confirmNext(version: StaffQuote) {
    const publishing = version.actions.issue;
    if ((!publishing && !version.actions.submitReview) || offline || busy) return;
    const actionLabelKey = publishing ? "mobile.foremanQuote.issue" : "mobile.foremanQuote.review";
    const actionLabel = publishing ? t("mobile.foremanQuote.issue") : t("mobile.foremanQuote.review");
    confirmAction(router, {
      title: actionLabel, actionLabel, actionLabelKey,
      item: [
        version.job.reference,
        t("mobile.foremanQuote.version", { number: version.no, status: t("mobile.foremanQuote.draft") }),
        t("mobile.foremanQuote.namedApprover", { name: version.job.namedApproverDisplayName }),
        version.scope, version.exclusions,
        version.evidence.length ? t("mobile.foremanQuote.attachmentCount", { count: version.evidence.length }) : "",
        ...version.items.flatMap(item => [
          `${item.originalLabel} · ${format.money(item.netMinor + item.taxMinor, version.currency)}`,
          ...(item.evidenceAlternative ? [`${t("mobile.foremanQuote.evidenceAlternative")}: ${item.evidenceAlternative}`] : []),
        ]),
        format.money(version.totalMinor, version.currency), version.terms.originalText,
      ].filter(Boolean).join("\n"),
      actor: bootstrap?.account.displayName ?? version.authorDisplayName,
      role: version.job.providerDisplayName,
      effects: publishing ? [t("mobile.foremanQuote.issueEffect")]
        : [t("mobile.foremanQuote.effect"), ...(version.reviewRouting ? [t("mobile.foremanQuote.reviewContext", { name: version.reviewRouting.reviewerDisplayName })] : [])],
      offline, onReview: refresh,
      onConfirm: async () => {
        const params = { id: version.id };
        const result = publishing
          ? await issue.run({ params, body: { payload: { termsHash: version.terms.hash } } })
          : await submit.run({ params, body: { payload: {} } });
        if (result.ok) { setWritten(result.data); return "confirmed"; }
        return "delivery" in result.error && result.error.delivery === "unknown" ? "uncertain" : "invalidated";
      },
    });
  }
  const status = versionId && !revision ? remote.status : offline && editable ? "ready" : list.status !== "ready" ? list.status : selectedId && !data && remote.status !== "ready" ? remote.status : "ready";
  const savedEvidence = status === "ready" && !revision && !editable && data ? data.evidence : [];
  const evidenceUrls = useMediaReadBatch(savedEvidence.map(item => item.attachmentId), savedEvidence.length && data ? { caller: "quote", parentScopeId: data.id } : null);
  return <QuoteView data={revision ? null : data} draft={local.value} change={local.change} editable={editable} saved={local.saved} saveFailed={local.failed}
    status={status} offline={offline} busy={busy} checking={checking} failed={failed} hasTerms={offline || !!terms}
    draftMedia={editable && jobId ? {
      attachments, ready: mediaReady, onAttach: attach,
      onOpen: attachmentId => router.push({ pathname: "/media/[attachmentId]", params: { attachmentId } } as Href),
      onExclude: attachmentId => local.change({ ...local.value, excludedAttachments: [...(local.value.excludedAttachments ?? []), attachmentId] }),
      onRetry: attachmentId => { void media.retry(attachmentId).catch(() => {}); },
    } : undefined}
    onOpenEvidence={data ? attachmentId => openMediaPreview(attachmentId, { caller: "quote", parentScopeId: data.id }) : undefined}
    evidenceUrls={evidenceUrls}
    onBack={() => router.back()} onJob={() => router.replace(`/f/jobs/${jobId}` as Href)} onRetry={refresh}
    onSend={() => { if (data && !revision) confirmNext(data); else void prepare(); }}
    onRevision={() => setRevision(true)} onChange={() => router.push(`/f/jobs/${jobId}/change` as Href)} />;
}

type DraftMedia = {
  attachments: MediaTransfer[]; ready: boolean; onAttach: () => void;
  onOpen: (id: string) => void; onExclude: (id: string) => void; onRetry: (id: string) => void;
};
type Props = {
  data: StaffQuote | null; draft: QuoteDraft; change: (draft: QuoteDraft) => void; editable: boolean; saved: boolean; saveFailed: boolean; status: string;
  offline: boolean; busy: boolean; checking: boolean; failed: boolean; hasTerms: boolean; draftMedia?: DraftMedia;
  onOpenEvidence?: (id: StaffQuote["evidence"][number]["attachmentId"]) => void;
  evidenceUrls?: ReadonlyMap<string, string>;
  onBack: () => void; onJob: () => void; onRetry: () => void; onSend: () => void; onRevision: () => void; onChange: () => void;
};
export function QuoteView(p: Props) {
  const t = useT(); const format = useFormat(); const { color, space } = useBeaconTheme(); const d = p.data; const review = d?.review;
  const state = !d ? t("mobile.foremanQuote.draft") : d.state === "approved" ? t("mobile.foremanQuote.approved") : d.state === "issued" ? t("mobile.foremanQuote.sent") : d.state === "declined" ? t("mobile.foremanQuote.rejected") : d.state === "expired" ? t("mobile.customerQuote.expired") : d.state === "superseded" ? t("mobile.customerQuote.superseded") : d.state === "withdrawn" ? t("mobile.provider.withdrawn") : review?.state === "returned" ? t("mobile.foremanQuote.returned") : review?.state === "pending" ? t("mobile.foremanQuote.inReview") : t("mobile.foremanQuote.draft");
  const amount = p.draft.lines.reduce((sum, line) => sum + (minorAmount(line.amount) ?? 0), 0);
  const valid = !!p.draft.scope.trim() && !!p.draft.locale.trim() && p.draft.lines.every(x => !!x.label.trim() && !!x.evidence.trim() && minorAmount(x.amount) !== null) && amount > 0;
  const submitAllowed = p.editable ? valid && p.hasTerms && (p.draftMedia?.ready ?? true) : d?.actions.issue || d?.actions.submitReview;
  const actionLabel = p.editable ? t("mobile.foremanQuote.reviewDraft") : d?.actions.issue ? t("mobile.foremanQuote.issue") : t("mobile.foremanQuote.review");
  const actionContext = d?.actions.issue ? t("mobile.foremanQuote.issueEffect") : d?.reviewRouting
    ? t("mobile.foremanQuote.reviewContext", { name: d.reviewRouting.reviewerDisplayName }) : undefined;
  const dock = p.status !== "ready" ? undefined
    : d?.state === "approved" ? <Dock primary={{ label: t("mobile.foremanQuote.newChange"), onPress: p.onChange }} />
    : d && !submitAllowed && !p.editable ? <Dock primary={{ label: t("mobile.foremanQuote.backJob"), onPress: p.onJob }} />
    : <Dock context={actionContext} primary={{ label: actionLabel, onPress: p.onSend, disabled: !submitAllowed || p.offline || p.busy }} />;
  return <Screen title={t("mobile.foremanQuote.title")} subtitle={d ? [d.job.reference, d.job.jobTitle].filter(Boolean).join(" · ") : undefined} navigation={{ kind: "back", label: t("mobile.customerQuote.back"), onPress: p.onBack }} dock={dock}
    trailing={p.status === "ready" ? <Badge label={d ? t("mobile.foremanQuote.version", { number: d.no, status: state }) : state} tone={d?.state === "approved" ? "success" : d?.state === "issued" || review?.state === "pending" ? "info" : "attention"} /> : undefined}>
    {(p.status === "loading" || p.status === "idle") && <Copy>{t("mobile.customerQuote.loading")}</Copy>}{p.status === "offline" && <Copy>{t("mobile.foremanQuote.offline")}</Copy>}{p.status === "error" && <><Copy>{t("mobile.customerQuote.error")}</Copy><Button label={t("mobile.customerQuote.retry")} onPress={p.onRetry} /></>}
    {p.status === "ready" && <>
      {p.offline && <Copy>{t("mobile.foremanQuote.offline")}</Copy>}{p.checking && <Copy>{t("mobile.foremanQuote.checking")}</Copy>}{p.failed && !p.checking && <Copy>{t("mobile.foremanQuote.failed")}</Copy>}
      {review?.state === "pending" && <Card><Copy variant="sectionTitle">{t("mobile.foremanQuote.inReview")}</Copy><Copy>{t("mobile.foremanQuote.withReviewer", { name: review.reviewerDisplayName, time: time(format, review.submittedAt, d!.job.siteZone) })}</Copy><Copy>{t("mobile.foremanQuote.notReceived")}</Copy></Card>}
      {review?.state === "returned" && <Card><Copy variant="sectionTitle">{t("mobile.foremanQuote.returned")}</Copy><Copy>{review.returnReason}</Copy></Card>}
      {p.editable ? <>
        <Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: space.grid[2] }}>
            <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.customerQuote.scope")}</Copy>
            {p.saved && <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.foremanQuote.saveLocal")}</Copy>}
          </View>
          <TextField label={t("mobile.foremanQuote.scope")} multiline value={p.draft.scope} onChangeText={scope => p.change({ ...p.draft, scope })} />
          <TextField label={t("mobile.foremanQuote.exclusions")} multiline value={p.draft.exclusions} onChangeText={exclusions => p.change({ ...p.draft, exclusions })} />
          <TextField label={t("mobile.foremanQuote.language")} helper={t("mobile.foremanQuote.languageHelp")} value={p.draft.locale} onChangeText={locale => p.change({ ...p.draft, locale })} />
          <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.foremanQuote.previewPending")}</Copy>
          {p.saveFailed && <Copy>{t("mobile.foremanQuote.saveFailed")}</Copy>}
        </Card>
        <Card><Copy variant="sectionTitle">{t("mobile.foremanQuote.lines")}</Copy>{p.draft.lines.map((line, index) => {
          const update = (patch: Partial<typeof line>) => p.change({ ...p.draft, lines: p.draft.lines.map((x, i) => i === index ? { ...x, ...patch } : x) });
          return <View key={index} style={{ gap: space.grid[3], borderTopWidth: 1, borderTopColor: color.separator, paddingTop: space.grid[3] }}>
            <TextField label={t("mobile.foremanQuote.description")} value={line.label} onChangeText={label => update({ label })} />
            <TextField label={t("mobile.foremanQuote.amount")} value={line.amount} inputMode="decimal" onChangeText={amount => update({ amount })} />
            <TextField label={t("mobile.foremanQuote.evidenceRule")} value={line.evidence} onChangeText={evidence => update({ evidence })} />
            <TextField label={t("mobile.foremanQuote.evidenceAlternative")} helper={t("mobile.foremanQuote.evidenceAlternativeHelp")}
              value={line.evidenceAlternative ?? ""} onChangeText={evidenceAlternative => update({ evidenceAlternative })} maxLength={500} multiline />
            {p.draft.lines.length > 1 && <Button variant="quiet" label={t("mobile.foremanQuote.removeLine", { number: index + 1 })} onPress={() => p.change({ ...p.draft, lines: p.draft.lines.filter((_, i) => i !== index) })} />}
          </View>;
        })}<Button variant="quiet" label={t("mobile.foremanQuote.addLine")} onPress={() => p.change({ ...p.draft, lines: [...p.draft.lines, { label: "", amount: "", evidence: "" }] })} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: space.grid[2] }}>
            <Copy variant="label">{t("mobile.foremanQuote.total")}</Copy><Copy variant="sectionTitle" style={{ fontVariant: ["tabular-nums"] }}>{format.money(amount, "EUR")}</Copy>
          </View>
        </Card>
        {!valid && <Copy>{t("mobile.foremanQuote.invalid")}</Copy>}{!p.hasTerms && <Copy>{t("mobile.foremanQuote.noTerms")}</Copy>}
        {p.draftMedia && <DraftAttachments media={p.draftMedia} busy={p.busy} />}
      </> : d && <>
        <ScopeTwin title={t("mobile.foremanQuote.scope")} original={d.scope} originalLocale={d.originalLocale} status={d.readingAid.status} translation={d.readingAid.status === "ready" ? d.readingAid.scope : undefined} translationLocale={d.readingAid.status === "ready" ? d.readingAid.locale : undefined} />
        {!!d.exclusions && <Copy>{d.exclusions}</Copy>}
        <Card>{d.items.map(item => {
          const label = d.readingAid.status === "ready" ? d.readingAid.items.find(x => x.lineNo === item.lineNo)?.label : null;
          return <View key={item.lineNo} style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: space.grid[2] }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Copy variant="label">{item.originalLabel}</Copy>
              {label && <Copy variant="supporting" style={{ color: color.muted }}>{label}</Copy>}
            </View>
            <Copy variant="label" style={{ fontVariant: ["tabular-nums"] }}>{format.money(item.netMinor + item.taxMinor, d.currency)}</Copy>
            {item.evidenceAlternative && <Copy variant="supporting">{t("mobile.foremanQuote.evidenceAlternative")}: {item.evidenceAlternative}</Copy>}
          </View>;
        })}<Copy variant="sectionTitle">{t("mobile.foremanQuote.total")} · {format.money(d.totalMinor, d.currency)}</Copy>
        {d.expiresAt && <Copy>{t("mobile.foremanQuote.validUntil", { time: time(format, d.expiresAt, d.job.siteZone) })}</Copy>}
        {d.decision?.decision === "approve" && <Copy>{t("mobile.foremanQuote.approvedBy", { name: d.decision.actorDisplayName, time: time(format, d.decision.at, d.job.siteZone) })}</Copy>}</Card>
        {!!d.evidence.length && p.onOpenEvidence && <Card>
          <Copy variant="sectionTitle">{t("mobile.foremanQuote.attachments")}</Copy>
          {d.evidence.map(({ attachmentId }, index) => {
            const label = t("mobile.foremanQuote.openAttachment", { number: index + 1 });
            const uri = p.evidenceUrls?.get(attachmentId);
            const open = () => p.onOpenEvidence?.(attachmentId);
            return uri ? <Thumb key={attachmentId} uri={uri} label={label} onPress={open} /> : <ListRow key={attachmentId} glyph="▣" label={label} onPress={open} />;
          })}
        </Card>}
        {d.actions.createRevision && <Button variant="quiet" label={t("mobile.foremanQuote.editRevision")} onPress={p.onRevision} />}
      </>}
    </>}
  </Screen>;
}

function DraftAttachments({ media, busy }: { media: DraftMedia; busy: boolean }) {
  const t = useT();
  const status = {
    queued: t("mobile.media.savedPending"), uploading: t("mobile.media.uploading"), verifying: t("mobile.media.verifying"),
    ready: t("mobile.media.ready"), failed: t("mobile.media.uploadFailed"),
  };
  return <Card>
    <Copy variant="sectionTitle">{t("mobile.foremanQuote.attachments")}</Copy>
    <Button variant="neutral" label={t("mobile.media.attachTitle")} onPress={media.onAttach} disabled={busy} />
    {media.attachments.map(item => <View key={item.attachmentId}>
      <ListRow label={item.file.kind === "photo" ? t("mobile.media.photo") : t("mobile.media.voiceNote")}
        description={status[item.state]} onPress={item.fileUri ? () => media.onOpen(item.attachmentId) : undefined}
        trailing={item.fileUri && item.file.kind === "photo" ? <Image source={{ uri: item.fileUri }} style={{ width: 48, height: 48, borderRadius: 8 }} /> : undefined} />
      {item.state === "failed" && !item.terminal && <Button variant="quiet" label={t("shared.action.retry")} onPress={() => media.onRetry(item.attachmentId)} disabled={busy} />}
      <Button variant="quiet" label={t("mobile.foremanQuote.excludeAttachment")} onPress={() => media.onExclude(item.attachmentId)} disabled={busy} />
    </View>)}
    {!media.ready && <Copy variant="supporting">{t("mobile.foremanQuote.waitAttachments")}</Copy>}
  </Card>;
}
