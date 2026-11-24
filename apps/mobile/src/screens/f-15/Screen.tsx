import { createChangeVersionRoute, getChangeVersionRoute, getQuoteVersionRoute, listChangeVersionsRoute, listQuoteVersionsRoute, submitChangeReviewRoute, type ChangeVersion, type QuoteVersion } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { useCommand, useRemote } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Button, Card, Dock, Screen, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ScopeTwin, time } from "../c-06/Screen";
import { minorAmount, useLocalDraft } from "../f-04/draft";
import { useOffline } from "../s-02/flow";
import { confirmAction } from "../s-17/confirmAction";

type StaffChange = Extract<ChangeVersion, { audience: "foreman" | "reviewer" }>;
type StaffQuote = Extract<QuoteVersion, { audience: "foreman" | "reviewer" }>;
type ChangeDraft = { locale: string; text: string; timing: string; affected: string; amount: string; evidence: string };
const empty: ChangeDraft = { locale: "", text: "", timing: "", affected: "", amount: "", evidence: "" };
export default function ForemanChangeScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { session } = useSession();
  return <ChangeRoute key={`${session?.sessionId}:${session?.activeContext?.contextId}:${jobId}`} />;
}
function ChangeRoute() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>(); const router = useRouter(); const t = useT(); const format = useFormat(); const offline = useOffline(); const { bootstrap } = useSession();
  const quotes = useRemote(listQuoteVersionsRoute, { params: { j: jobId ?? "" } }, { enabled: !!jobId });
  const changes = useRemote(listChangeVersionsRoute, { params: { j: jobId ?? "" } }, { enabled: !!jobId });
  const quoteVersions = quotes.data?.audience === "foreman" ? quotes.data.versions : [];
  const baseSummary = quoteVersions.filter(x => x.state === "approved").reduce<(typeof quoteVersions)[number] | null>((a, b) => !a || b.no > a.no ? b : a, null);
  const versions = changes.data?.audience === "foreman" ? changes.data.versions : [];
  const latest = versions.reduce<(typeof versions)[number] | null>((a, b) => !a || b.no > a.no ? b : a, null);
  const quote = useRemote(getQuoteVersionRoute, { params: { j: jobId ?? "", id: baseSummary?.id ?? "" } }, { enabled: !!jobId && !!baseSummary });
  const remote = useRemote(getChangeVersionRoute, { params: { j: jobId ?? "", id: latest?.id ?? "" } }, { enabled: !!jobId && !!latest });
  const base = quote.data?.audience === "foreman" ? quote.data : null; const read = remote.data?.audience === "foreman" ? remote.data : null;
  const create = useCommand(createChangeVersionRoute); const submit = useCommand(submitChangeReviewRoute);
  const [created, setCreated] = useState<StaffChange | null>(null); const [revision, setRevision] = useState(false);
  const local = useLocalDraft<ChangeDraft>(`change:${jobId ?? "missing"}`, empty); const data = created ? (submit.result?.id === created.id ? submit.result : created) : submit.result ?? read;
  const terms = changes.data?.audience === "foreman" ? changes.data.currentTerms : null;
  const busy = [create.state, submit.state].some(s => s === "sending" || s === "checking"); const checking = [create.state, submit.state].includes("checking"); const failed = [create.state, submit.state].some(s => s === "failed" || s === "conflict");
  const editable = (!data || revision) && (offline || (!!base && quotes.status === "ready" && changes.status === "ready" && (!latest || remote.status === "ready")));
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
  const status = offline && editable ? "ready" : quotes.status !== "ready" ? quotes.status : changes.status !== "ready" ? changes.status : baseSummary && !base ? quote.status : latest && !data ? remote.status : "ready";
  return <ChangeView base={base} data={revision ? null : data} draft={local.value} change={local.change} editable={editable} saved={local.saved} saveFailed={local.failed} status={status} offline={offline} busy={busy} checking={checking} failed={failed} hasTerms={offline || !!terms} onBack={() => router.back()} onJob={() => router.replace(`/f/jobs/${jobId}` as Href)} onRetry={() => { void quotes.refresh(); void changes.refresh(); if (baseSummary) void quote.refresh(); if (latest) void remote.refresh(); }} onSend={() => { if (data && !revision) askReview(data); else void prepare(); }} onRevision={() => setRevision(true)} />;
}
type Props = { base: StaffQuote | null; data: StaffChange | null; draft: ChangeDraft; change: (draft: ChangeDraft) => void; editable: boolean; saved: boolean; saveFailed: boolean; status: string; offline: boolean; busy: boolean; checking: boolean; failed: boolean; hasTerms: boolean; onBack: () => void; onJob: () => void; onRetry: () => void; onSend: () => void; onRevision: () => void };
export function ChangeView(p: Props) {
  const t = useT(); const format = useFormat(); const d = p.data; const b = d?.approvedBase ?? p.base; const review = d?.review;
  const amount = minorAmount(p.draft.amount, true); const valid = amount !== null && !!p.draft.locale.trim() && !!p.draft.text.trim() && !!p.draft.timing.trim() && !!p.draft.affected.trim() && !!p.draft.evidence.trim() && !!b && b.totalMinor + amount >= 0;
  const state = !d ? t("mobile.foremanQuote.draft") : d.state === "approved" ? t("mobile.foremanQuote.approved") : d.state === "issued" ? t("mobile.foremanQuote.sent") : d.state === "rejected" ? t("mobile.foremanQuote.rejected") : d.state === "expired" ? t("mobile.customerQuote.expired") : d.state === "superseded" ? t("mobile.customerQuote.superseded") : d.state === "withdrawn" ? t("mobile.provider.withdrawn") : review?.state === "returned" ? t("mobile.foremanQuote.returned") : review?.state === "pending" ? t("mobile.foremanQuote.inReview") : t("mobile.foremanQuote.draft");
  const submitAllowed = p.editable ? valid && p.hasTerms : !!d?.actions.submitReview;
  const dock = p.status === "ready" && b ? d && !d.actions.submitReview && !p.editable ? <Dock primary={{ label: t("mobile.foremanQuote.backJob"), onPress: p.onJob }} /> : <Dock context={d?.reviewRouting ? t("mobile.foremanQuote.reviewContext", { name: d.reviewRouting.reviewerDisplayName }) : t("mobile.foremanQuote.effect")} primary={{ label: t("mobile.foremanQuote.review"), onPress: p.onSend, disabled: !submitAllowed || p.offline || p.busy }} /> : undefined;
  const approval = d?.approvedBase.approval ?? (p.base?.decision?.decision === "approve" ? p.base.decision : null);
  return <Screen title={t("mobile.foremanQuote.changeTitle")} navigation={{ kind: "back", label: t("mobile.customerQuote.back"), onPress: p.onBack }} dock={dock}>
    {(p.status === "loading" || p.status === "idle") && <Copy>{t("mobile.customerQuote.loading")}</Copy>}{p.status === "offline" && <Copy>{t("mobile.foremanQuote.offline")}</Copy>}{p.status === "error" && <><Copy>{t("mobile.customerQuote.error")}</Copy><Button label={t("mobile.customerQuote.retry")} onPress={p.onRetry} /></>}
    {p.status === "ready" && <>{d && <Copy variant="supporting">{d.job.reference} · {d.job.jobTitle}</Copy>}{p.offline && <Copy>{t("mobile.foremanQuote.offline")}</Copy>}{p.checking && <Copy>{t("mobile.foremanQuote.checking")}</Copy>}{p.failed && !p.checking && <Copy>{t("mobile.foremanQuote.failed")}</Copy>}{!b && !p.editable ? <Copy>{t("mobile.foremanQuote.noBase")}</Copy> : <>{b && <Card><Copy variant="sectionTitle">{t("mobile.foremanQuote.approvedBase", { number: b.no })}</Copy><Copy>{format.money(b.totalMinor, b.currency)}</Copy><Copy>{b.scope}</Copy>{!!b.exclusions && <Copy>{b.exclusions}</Copy>}{approval && <Copy>{t("mobile.foremanQuote.approvedBy", { name: approval.actorDisplayName, time: time(format, approval.at, d?.job.siteZone ?? p.base!.job.siteZone) })}</Copy>}</Card>}
      <Badge label={d ? t("mobile.foremanQuote.version", { number: d.no, status: state }) : state} tone="neutral" />{review?.state === "pending" && <Card><Copy variant="sectionTitle">{t("mobile.foremanQuote.inReview")}</Copy><Copy>{t("mobile.foremanQuote.withReviewer", { name: review.reviewerDisplayName, time: time(format, review.submittedAt, d!.job.siteZone) })}</Copy><Copy>{t("mobile.foremanQuote.notReceived")}</Copy></Card>}{review?.state === "returned" && <Card><Copy>{t("mobile.foremanQuote.returned")}</Copy><Copy>{review.returnReason}</Copy></Card>}
      {p.editable ? <Card><TextField label={t("mobile.foremanQuote.language")} helper={t("mobile.foremanQuote.languageHelp")} value={p.draft.locale} onChangeText={locale => p.change({ ...p.draft, locale })} /><TextField label={t("mobile.foremanQuote.addition")} multiline value={p.draft.text} onChangeText={text => p.change({ ...p.draft, text })} /><Copy>{t("mobile.foremanQuote.previewPending")}</Copy><TextField label={t("mobile.foremanQuote.delta")} inputMode="decimal" value={p.draft.amount} onChangeText={amount => p.change({ ...p.draft, amount })} /><TextField label={t("mobile.foremanQuote.timing")} value={p.draft.timing} onChangeText={timing => p.change({ ...p.draft, timing })} /><TextField label={t("mobile.foremanQuote.affected")} multiline value={p.draft.affected} onChangeText={affected => p.change({ ...p.draft, affected })} /><TextField label={t("mobile.foremanQuote.evidenceRule")} value={p.draft.evidence} onChangeText={evidence => p.change({ ...p.draft, evidence })} />{p.saved && <Copy>{t("mobile.foremanQuote.saveLocal")}</Copy>}{p.saveFailed && <Copy>{t("mobile.foremanQuote.saveFailed")}</Copy>}{!p.hasTerms && <Copy>{t("mobile.foremanQuote.noTerms")}</Copy>}</Card> : d && <><ScopeTwin title={t("mobile.foremanQuote.addition")} original={d.originalText} originalLocale={d.originalLocale} status={d.readingAid.status} translation={d.readingAid.status === "ready" ? d.readingAid.text : undefined} translationLocale={d.readingAid.status === "ready" ? d.readingAid.locale : undefined} /><Copy>{d.timing}</Copy>{d.actions.createRevision && <Button variant="quiet" label={t("mobile.foremanQuote.editRevision")} onPress={p.onRevision} />}</>}
      <Card><Copy>{t("mobile.foremanQuote.delta")} · {format.money(d?.deltaMinor ?? amount ?? 0, "EUR")}</Copy>{b && <Copy variant="sectionTitle">{t("mobile.foremanQuote.newTotal")} · {format.money(d?.totalMinor ?? b.totalMinor + (amount ?? 0), "EUR")}</Copy>}</Card><Card><Copy>{t("mobile.foremanQuote.hold")}</Copy></Card></>}</>}
  </Screen>;
}
