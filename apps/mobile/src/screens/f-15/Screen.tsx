import { createChangeVersionRoute, getChangeVersionRoute, getQuoteVersionRoute, listChangeVersionsRoute, listQuoteVersionsRoute, submitChangeReviewRoute, type ChangeVersion, type QuoteVersion } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useFormat, useLocale, useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Button, Card, Dock, Screen, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { ScopeTwin, time } from "../c-06/Screen";
import { minorAmount, useLocalDraft } from "../f-04/draft";
import { useOffline } from "../s-02/flow";
import { confirmAction } from "../s-17/confirmAction";

type StaffChange = Extract<ChangeVersion, { audience: "foreman" | "reviewer" }>;
type StaffQuote = Extract<QuoteVersion, { audience: "foreman" | "reviewer" }>;
type ChangeDraft = { locale: string; text: string; timing: string; affected: string; amount: string; evidence: string };
const empty: ChangeDraft = { locale: "", text: "", timing: "", affected: "", amount: "", evidence: "" };
export default function ForemanChangeScreen() {
  const { jobId, versionId } = useLocalSearchParams<{ jobId: string; versionId?: string }>();
  const { session } = useSession();
  return <ChangeRoute key={`${session?.sessionId}:${session?.activeContext?.contextId}:${jobId}:${versionId ?? ""}`} jobId={jobId} versionId={versionId} />;
}
function ChangeRoute({ jobId, versionId }: { jobId: string; versionId?: string }) {
  const router = useRouter(); const t = useT(); const format = useFormat(); const offline = useOffline(); const { bootstrap } = useSession();
  const [created, setCreated] = useState<StaffChange | null>(null); const [revision, setRevision] = useState(false);
  const quotes = useRemote(listQuoteVersionsRoute, { params: { j: jobId ?? "" } }, { enabled: !!jobId && (!versionId || revision) });
  const changes = useRemote(listChangeVersionsRoute, { params: { j: jobId ?? "" } }, { enabled: !!jobId && (!versionId || revision) });
  const baseId = quotes.data?.audience === "foreman" ? quotes.data.currentApprovedVersionId : null;
  const versions = changes.data?.audience === "foreman" ? changes.data.versions : [];
  const latest = versions.find(version => version.isCurrentProposal) ?? null;
  const quote = useRemote(getQuoteVersionRoute, { params: { j: jobId ?? "", id: baseId ?? "" } }, { enabled: !!jobId && !!baseId });
  const selectedId = versionId ?? latest?.id;
  const remote = useRemote(getChangeVersionRoute, { params: { j: jobId ?? "", id: selectedId ?? "" } }, { enabled: !!jobId && !!selectedId });
  const base = quote.data?.audience === "foreman" ? quote.data : null; const read = remote.data?.audience === "foreman" ? remote.data : null;
  const create = useCommand(createChangeVersionRoute); const submit = useCommand(submitChangeReviewRoute);
  const local = useLocalDraft<ChangeDraft>(`change:${jobId ?? "missing"}`, empty); const data = created ? (submit.result?.id === created.id ? submit.result : created) : submit.result ?? read;
  const terms = changes.data?.audience === "foreman" ? changes.data.currentTerms : null;
  const busy = [create.state, submit.state].some(s => s === "sending" || s === "checking"); const checking = [create.state, submit.state].includes("checking"); const failed = [create.state, submit.state].some(s => s === "failed" || s === "conflict");
  const editable = (!data || revision) && (!versionId || revision) && (offline || (!!base && quotes.status === "ready" && changes.status === "ready" && (!selectedId || remote.status === "ready")));
  async function prepare() {
    const amount = minorAmount(local.value.amount, true);
    if (!jobId || !terms || !base || offline || busy || amount === null || !local.value.locale.trim() || !local.value.text.trim() || !local.value.timing.trim() || !local.value.affected.trim() || !local.value.evidence.trim()) return;
    const result = await create.run({ params: { j: jobId }, body: { payload: { id: uuid.v4(), proposalId: data?.proposalId ?? uuid.v4(), baseQuoteVersionId: base.id, termsVersionId: terms.id, originalLocale: local.value.locale.trim(), originalText: local.value.text.trim(), timing: local.value.timing.trim(), affectedItems: local.value.affected.trim(), evidence: [], items: [{ originalLabel: local.value.text.trim(), quantity: 1, evidenceRule: local.value.evidence.trim(), netMinor: amount, taxMinor: 0 }] } } });
    if (!result.ok) return; setCreated(result.data); setRevision(false); void local.remove().catch(() => {}); askReview(result.data);
  }
  function askReview(version: StaffChange) {
    if (!version.actions.submitReview || offline || busy) return;
    confirmAction(router, { title: t("mobile.foremanQuote.review"), actionLabel: t("mobile.foremanQuote.review"), actionLabelKey: "mobile.foremanQuote.review", item: [version.job.reference, t("mobile.foremanQuote.version", { number: version.no, status: t("mobile.foremanQuote.draft") }), version.originalText, version.affectedItems, version.timing, format.money(version.deltaMinor, version.currency), format.money(version.totalMinor, version.currency), version.terms.originalText].join("\n"), actor: bootstrap?.account.displayName ?? version.authorDisplayName, role: version.job.providerDisplayName, effects: [t("mobile.foremanQuote.effect"), ...(version.reviewRouting ? [t("mobile.foremanQuote.reviewContext", { name: version.reviewRouting.reviewerDisplayName })] : [])], offline, onReview: () => { void remote.refresh(); }, onConfirm: async () => { const result = await submit.run({ params: { id: version.id }, body: { payload: {} } }); if (result.ok) return "confirmed"; return "delivery" in result.error && result.error.delivery === "unknown" ? "uncertain" : "invalidated"; } });
  }
  const status = versionId && !revision ? remote.status : offline && editable ? "ready" : quotes.status !== "ready" ? quotes.status : changes.status !== "ready" ? changes.status : baseId && !base ? quote.status : selectedId && !data ? remote.status : "ready";
  return <ChangeView base={base} data={revision ? null : data} draft={local.value} change={local.change} editable={editable} saved={local.saved} saveFailed={local.failed} status={status} offline={offline} busy={busy} checking={checking} failed={failed} hasTerms={offline || !!terms} onBack={() => router.back()} onJob={() => router.replace(`/f/jobs/${jobId}` as Href)} onRetry={() => { if (!versionId || revision) { void quotes.refresh(); void changes.refresh(); if (baseId) void quote.refresh(); } if (selectedId) void remote.refresh(); }} onSend={() => { if (data && !revision) askReview(data); else void prepare(); }} onRevision={() => setRevision(true)} />;
}
type Props = { base: StaffQuote | null; data: StaffChange | null; draft: ChangeDraft; change: (draft: ChangeDraft) => void; editable: boolean; saved: boolean; saveFailed: boolean; status: string; offline: boolean; busy: boolean; checking: boolean; failed: boolean; hasTerms: boolean; onBack: () => void; onJob: () => void; onRetry: () => void; onSend: () => void; onRevision: () => void };
export function ChangeView(p: Props) {
  const t = useT(); const format = useFormat(); const { locale } = useLocale();
  const { color, radius, space } = useBeaconTheme();
  const [editing, setEditing] = useState(false);
  const d = p.data; const b = d?.approvedBase ?? p.base; const review = d?.review;
  const job = d?.job ?? p.base?.job;
  const amount = minorAmount(p.draft.amount, true); const valid = amount !== null && !!p.draft.locale.trim() && !!p.draft.text.trim() && !!p.draft.timing.trim() && !!p.draft.affected.trim() && !!p.draft.evidence.trim() && !!b && b.totalMinor + amount >= 0;
  const state = !d ? t("mobile.foremanQuote.draft") : d.state === "approved" ? t("mobile.foremanQuote.approved") : d.state === "issued" ? t("mobile.foremanQuote.sent") : d.state === "rejected" ? t("mobile.foremanQuote.rejected") : d.state === "expired" ? t("mobile.customerQuote.expired") : d.state === "superseded" ? t("mobile.customerQuote.superseded") : d.state === "withdrawn" ? t("mobile.provider.withdrawn") : review?.state === "returned" ? t("mobile.foremanQuote.returned") : review?.state === "pending" ? t("mobile.foremanQuote.inReview") : t("mobile.foremanQuote.draft");
  const submitAllowed = p.editable ? valid && p.hasTerms : !!d?.actions.submitReview;
  const reviewRouting = d?.reviewRouting ?? p.base?.reviewRouting;
  const context = p.offline ? t("mobile.foremanQuote.offline") : reviewRouting ? t("mobile.foremanQuote.reviewContext", { name: reviewRouting.reviewerDisplayName }) : t("mobile.foremanQuote.effect");
  const dock = p.status === "ready" && b ? d && !d.actions.submitReview && !p.editable ? <Dock primary={{ label: t("mobile.foremanQuote.backJob"), onPress: p.onJob }} /> :
    <Dock context={context} primary={{ label: t("mobile.foremanQuote.review"), onPress: p.onSend, disabled: !submitAllowed || p.offline || p.busy, busy: p.busy && !p.checking }} /> : undefined;
  const approval = d?.approvedBase.approval ?? (p.base?.decision?.decision === "approve" ? p.base.decision : null);
  const currency = d?.currency ?? b?.currency ?? "EUR";
  const delta = d?.deltaMinor ?? amount;
  const signedDelta = delta === null ? null : new Intl.NumberFormat(locale, { style: "currency", currency, signDisplay: "exceptZero" }).format(delta / 100);
  const visitEffect = d?.timing ?? p.draft.timing.trim();
  const line = { flexDirection: "row" as const, alignItems: "baseline" as const, justifyContent: "space-between" as const, flexWrap: "wrap" as const, gap: space.grid[2] };
  return <Screen title={t("mobile.foremanQuote.changeTitle")} subtitle={job ? [job.reference, job.jobTitle].filter(Boolean).join(" · ") : undefined}
    navigation={{ kind: "back", label: t("mobile.customerQuote.back"), onPress: p.onBack }} dock={dock}>
    {(p.status === "loading" || p.status === "idle") && <Copy>{t("mobile.customerQuote.loading")}</Copy>}
    {p.status === "offline" && <Copy>{t("mobile.foremanQuote.offline")}</Copy>}
    {p.status === "error" && <><Copy>{t("mobile.customerQuote.error")}</Copy><Button label={t("mobile.customerQuote.retry")} onPress={p.onRetry} /></>}
    {p.status === "ready" && <>
      {p.offline && <Copy>{t("mobile.foremanQuote.offline")}</Copy>}
      {p.checking && <Copy accessibilityLiveRegion="polite">{t("mobile.foremanQuote.checking")}</Copy>}
      {p.failed && !p.checking && <Copy>{t("mobile.foremanQuote.failed")}</Copy>}
      {!b && !p.editable ? <Copy>{t("mobile.foremanQuote.noBase")}</Copy> : <>
        {b && <View style={{ backgroundColor: color.subtle, borderRadius: radius.card, padding: space.grid[4], gap: space.grid[2] }}>
          <View style={line}>
            <Copy variant="caption" style={{ color: color.muted, flexShrink: 1 }}>{t("mobile.foremanQuote.approvedBase", { number: b.no })}</Copy>
            <Copy variant="label" style={{ fontVariant: ["tabular-nums"] }}>{format.money(b.totalMinor, b.currency)}</Copy>
          </View>
          <Copy accessibilityLanguage={b.originalLocale}>{b.scope}{b.exclusions ? ` ${b.exclusions}` : ""}</Copy>
          {approval && job && <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.foremanQuote.approvedBy", { name: approval.actorDisplayName, time: time(format, approval.at, job.siteZone) })}</Copy>}
        </View>}
        {d && <Badge label={t("mobile.foremanQuote.version", { number: d.no, status: state })} tone={d.state === "approved" ? "success" : review?.state === "pending" || d.state === "issued" ? "info" : "neutral"} />}
        {review?.state === "pending" && d && <Card dense>
          <Copy variant="label">{t("mobile.foremanQuote.inReview")}</Copy>
          <Copy>{t("mobile.foremanQuote.withReviewer", { name: review.reviewerDisplayName, time: time(format, review.submittedAt, d.job.siteZone) })}</Copy>
          <Copy>{t("mobile.foremanQuote.notReceived")}</Copy>
        </Card>}
        {review?.state === "returned" && <Card dense><Copy>{t("mobile.foremanQuote.returned")}</Copy><Copy>{review.returnReason}</Copy></Card>}
        {p.editable ? <View style={{ borderWidth: 2, borderColor: color.ink, borderRadius: radius.card, overflow: "hidden", backgroundColor: color.surface }}>
          <View style={{ padding: space.grid[4], gap: space.grid[2] }}>
            <View style={line}>
              <Copy variant="caption" style={{ color: color.infoInk, flexShrink: 1 }}>{t("mobile.foremanQuote.draftAddition")}</Copy>
              <Button variant="navigation" label={editing ? t("shared.action.close") : t("mobile.request.edit")} onPress={() => setEditing(value => !value)} />
            </View>
            {editing ? <>
              <TextField label={t("mobile.foremanQuote.addition")} multiline value={p.draft.text} onChangeText={text => p.change({ ...p.draft, text })} />
              <TextField label={t("mobile.foremanQuote.language")} helper={t("mobile.foremanQuote.languageHelp")} value={p.draft.locale} onChangeText={locale => p.change({ ...p.draft, locale })} />
              <TextField label={t("mobile.foremanQuote.delta")} inputMode="decimal" value={p.draft.amount} onChangeText={amount => p.change({ ...p.draft, amount })} />
              <TextField label={t("mobile.foremanQuote.timing")} value={p.draft.timing} onChangeText={timing => p.change({ ...p.draft, timing })} />
              <TextField label={t("mobile.foremanQuote.affected")} multiline value={p.draft.affected} onChangeText={affected => p.change({ ...p.draft, affected })} />
              <TextField label={t("mobile.foremanQuote.evidenceRule")} value={p.draft.evidence} onChangeText={evidence => p.change({ ...p.draft, evidence })} />
              {!p.hasTerms && <Copy>{t("mobile.foremanQuote.noTerms")}</Copy>}
            </> : <Copy>{p.draft.text.trim() || t("mobile.foremanQuote.writeAddition")}</Copy>}
          </View>
          <View style={{ backgroundColor: color.subtle, padding: space.grid[4], gap: space.grid[1] }}>
            <Copy variant="caption" style={{ color: color.muted }}>{t("mobile.jobControl.preview")}</Copy>
            <Copy variant="supporting">{t("mobile.foremanQuote.previewPending")}</Copy>
          </View>
        </View> : d && <>
          <ScopeTwin title={t("mobile.foremanQuote.addition")} original={d.originalText} originalLocale={d.originalLocale} status={d.readingAid.status}
            translation={d.readingAid.status === "ready" ? d.readingAid.text : undefined} translationLocale={d.readingAid.status === "ready" ? d.readingAid.locale : undefined} />
          {d.actions.createRevision && <Button variant="quiet" label={t("mobile.foremanQuote.editRevision")} onPress={p.onRevision} />}
        </>}
        {p.editable && p.draft.evidence.trim() && !editing && <View style={{ backgroundColor: color.subtle, borderRadius: radius.input, padding: space.grid[3] }}>
          <Copy variant="supporting">{t("mobile.foremanQuote.evidenceSummary", { evidence: p.draft.evidence.trim() })}</Copy>
        </View>}
        {(signedDelta || visitEffect) && <Card dense>
          {signedDelta && <View style={line}><Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.foremanQuote.delta")}</Copy><Copy variant="label" style={{ fontVariant: ["tabular-nums"] }}>{signedDelta}</Copy></View>}
          {b && delta !== null && <View style={line}><Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.foremanQuote.newTotal")}</Copy><Copy variant="sectionTitle" style={{ fontVariant: ["tabular-nums"] }}>{format.money(d?.totalMinor ?? b.totalMinor + delta, currency)}</Copy></View>}
          {visitEffect && <View style={line}><Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.foremanQuote.timing")}</Copy><Copy variant="supporting" style={{ flexShrink: 1 }}>{visitEffect}</Copy></View>}
        </Card>}
        {(p.editable || d?.state === "draft" || d?.state === "issued") && <View style={{ padding: space.grid[4], borderRadius: radius.input, backgroundColor: color.attentionSoft }}><Copy variant="label" style={{ color: color.attentionInk }}>{t("mobile.foremanQuote.hold")}</Copy></View>}
        {p.editable && p.saved && <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.foremanQuote.saveLocal")}</Copy>}
        {p.editable && p.saveFailed && <Copy variant="supporting" style={{ color: color.criticalInk }}>{t("mobile.foremanQuote.saveFailed")}</Copy>}
      </>}
    </>}
  </Screen>;
}
