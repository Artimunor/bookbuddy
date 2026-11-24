import { createQuoteVersionRoute, getQuoteVersionRoute, issueQuoteVersionRoute, listQuoteVersionsRoute, submitQuoteReviewRoute, type QuoteVersion } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { useCommand, useRemote } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Button, Card, Dock, Screen, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ScopeTwin, time } from "../c-06/Screen";
import { useOffline } from "../s-02/flow";
import { confirmAction } from "../s-17/confirmAction";
import { minorAmount, useLocalDraft } from "./draft";

export type StaffQuote = Extract<QuoteVersion, { audience: "foreman" | "reviewer" }>;
export type QuoteDraft = { scope: string; exclusions: string; locale: string; lines: { label: string; amount: string; evidence: string }[] };
export const emptyQuote: QuoteDraft = { scope: "", exclusions: "", locale: "", lines: [{ label: "", amount: "", evidence: "" }] };

export default function ForemanQuoteScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { session } = useSession();
  return <QuoteRoute key={`${session?.sessionId}:${session?.activeContext?.contextId}:${jobId}`} />;
}
function QuoteRoute() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>(); const router = useRouter(); const t = useT(); const format = useFormat();
  const list = useRemote(listQuoteVersionsRoute, { params: { j: jobId ?? "" } }, { enabled: !!jobId });
  const versions = list.data?.audience === "foreman" ? list.data.versions : [];
  const latest = versions.reduce<(typeof versions)[number] | null>((a, b) => !a || b.no > a.no ? b : a, null);
  const remote = useRemote(getQuoteVersionRoute, { params: { j: jobId ?? "", id: latest?.id ?? "" } }, { enabled: !!jobId && !!latest });
  const read = remote.data?.audience === "foreman" ? remote.data : null;
  const create = useCommand(createQuoteVersionRoute);
  const submit = useCommand(submitQuoteReviewRoute);
  const issue = useCommand(issueQuoteVersionRoute);
  const [written, setWritten] = useState<StaffQuote | null>(null);
  const [revision, setRevision] = useState(false);
  const local = useLocalDraft<QuoteDraft>(`quote:${jobId ?? "missing"}`, emptyQuote);
  const offline = useOffline(); const { bootstrap } = useSession();
  const data = written ?? read;
  const terms = list.data?.audience === "foreman" ? list.data.currentTerms : null;
  const states = [create.state, submit.state, issue.state];
  const busy = states.includes("sending") || states.includes("checking");
  const checking = states.includes("checking");
  const failed = states.includes("failed") || states.includes("conflict");
  const editable = (!data || revision) && (offline || (list.status === "ready" && (!latest || remote.status === "ready")));
  async function prepare() {
    if (!jobId || !terms || offline || busy) return;
    const items = local.value.lines.map(line => ({ originalLabel: line.label.trim(), netMinor: minorAmount(line.amount), taxMinor: 0, quantity: 1, evidenceRule: line.evidence.trim() }));
    if (!local.value.scope.trim() || !local.value.locale.trim() || items.some(x => !x.originalLabel || !x.evidenceRule || x.netMinor === null) || items.reduce((n, x) => n + (x.netMinor ?? 0), 0) <= 0) return;
    const result = await create.run({ params: { j: jobId }, body: { payload: { id: uuid.v4(), termsVersionId: terms.id, originalLocale: local.value.locale.trim(), scope: local.value.scope.trim(), exclusions: local.value.exclusions.trim(), evidence: [], items: items.map(x => ({ ...x, netMinor: x.netMinor! })) } } });
    if (!result.ok) return;
    setWritten(result.data);
    setRevision(false);
    void local.remove().catch(() => {});
    confirmNext(result.data);
  }
  function refresh() {
    setWritten(null);
    void list.refresh();
    if (latest) void remote.refresh();
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
        ...version.items.map(item => `${item.originalLabel} · ${format.money(item.netMinor + item.taxMinor, version.currency)}`),
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
  const status = offline && editable ? "ready" : list.status !== "ready" ? list.status : latest && !data && remote.status !== "ready" ? remote.status : "ready";
  return <QuoteView data={revision ? null : data} draft={local.value} change={local.change} editable={editable} saved={local.saved} saveFailed={local.failed} status={status} offline={offline} busy={busy} checking={checking} failed={failed} hasTerms={offline || !!terms} onBack={() => router.back()} onJob={() => router.replace(`/f/jobs/${jobId}` as Href)} onRetry={refresh} onSend={() => { if (data && !revision) confirmNext(data); else void prepare(); }} onRevision={() => setRevision(true)} onChange={() => router.push(`/f/jobs/${jobId}/change` as Href)} />;
}

type Props = { data: StaffQuote | null; draft: QuoteDraft; change: (draft: QuoteDraft) => void; editable: boolean; saved: boolean; saveFailed: boolean; status: string; offline: boolean; busy: boolean; checking: boolean; failed: boolean; hasTerms: boolean; onBack: () => void; onJob: () => void; onRetry: () => void; onSend: () => void; onRevision: () => void; onChange: () => void };
export function QuoteView(p: Props) {
  const t = useT(); const format = useFormat(); const d = p.data; const review = d?.review;
  const state = !d ? t("mobile.foremanQuote.draft") : d.state === "approved" ? t("mobile.foremanQuote.approved") : d.state === "issued" ? t("mobile.foremanQuote.sent") : d.state === "declined" ? t("mobile.foremanQuote.rejected") : d.state === "expired" ? t("mobile.customerQuote.expired") : d.state === "superseded" ? t("mobile.customerQuote.superseded") : d.state === "withdrawn" ? t("mobile.provider.withdrawn") : review?.state === "returned" ? t("mobile.foremanQuote.returned") : review?.state === "pending" ? t("mobile.foremanQuote.inReview") : t("mobile.foremanQuote.draft");
  const amount = p.draft.lines.reduce((sum, line) => sum + (minorAmount(line.amount) ?? 0), 0);
  const valid = !!p.draft.scope.trim() && !!p.draft.locale.trim() && p.draft.lines.every(x => !!x.label.trim() && !!x.evidence.trim() && minorAmount(x.amount) !== null) && amount > 0;
  const submitAllowed = p.editable ? valid && p.hasTerms : d?.actions.issue || d?.actions.submitReview;
  const actionLabel = p.editable ? t("mobile.foremanQuote.reviewDraft") : d?.actions.issue ? t("mobile.foremanQuote.issue") : t("mobile.foremanQuote.review");
  const actionContext = d?.actions.issue ? t("mobile.foremanQuote.issueEffect") : d?.reviewRouting
    ? t("mobile.foremanQuote.reviewContext", { name: d.reviewRouting.reviewerDisplayName }) : undefined;
  const dock = p.status !== "ready" ? undefined
    : d?.state === "approved" ? <Dock primary={{ label: t("mobile.foremanQuote.newChange"), onPress: p.onChange }} />
    : d && !submitAllowed && !p.editable ? <Dock primary={{ label: t("mobile.foremanQuote.backJob"), onPress: p.onJob }} />
    : <Dock context={actionContext} primary={{ label: actionLabel, onPress: p.onSend, disabled: !submitAllowed || p.offline || p.busy }} />;
  return <Screen title={t("mobile.foremanQuote.title")} navigation={{ kind: "back", label: t("mobile.customerQuote.back"), onPress: p.onBack }} dock={dock}>
    {(p.status === "loading" || p.status === "idle") && <Copy>{t("mobile.customerQuote.loading")}</Copy>}{p.status === "offline" && <Copy>{t("mobile.foremanQuote.offline")}</Copy>}{p.status === "error" && <><Copy>{t("mobile.customerQuote.error")}</Copy><Button label={t("mobile.customerQuote.retry")} onPress={p.onRetry} /></>}
    {p.status === "ready" && <>{d && <Copy variant="supporting">{d.job.reference} · {d.job.jobTitle}</Copy>}<Badge label={d ? t("mobile.foremanQuote.version", { number: d.no, status: state }) : state} tone="neutral" />
      {p.offline && <Copy>{t("mobile.foremanQuote.offline")}</Copy>}{p.checking && <Copy>{t("mobile.foremanQuote.checking")}</Copy>}{p.failed && !p.checking && <Copy>{t("mobile.foremanQuote.failed")}</Copy>}
      {review?.state === "pending" && <Card><Copy variant="sectionTitle">{t("mobile.foremanQuote.inReview")}</Copy><Copy>{t("mobile.foremanQuote.withReviewer", { name: review.reviewerDisplayName, time: time(format, review.submittedAt, d!.job.siteZone) })}</Copy><Copy>{t("mobile.foremanQuote.notReceived")}</Copy></Card>}
      {review?.state === "returned" && <Card><Copy variant="sectionTitle">{t("mobile.foremanQuote.returned")}</Copy><Copy>{review.returnReason}</Copy></Card>}
      {p.editable ? <><Card><TextField label={t("mobile.foremanQuote.language")} helper={t("mobile.foremanQuote.languageHelp")} value={p.draft.locale} onChangeText={locale => p.change({ ...p.draft, locale })} /><TextField label={t("mobile.foremanQuote.scope")} multiline value={p.draft.scope} onChangeText={scope => p.change({ ...p.draft, scope })} /><TextField label={t("mobile.foremanQuote.exclusions")} multiline value={p.draft.exclusions} onChangeText={exclusions => p.change({ ...p.draft, exclusions })} /><Copy variant="supporting">{t("mobile.foremanQuote.previewPending")}</Copy>{p.saved && <Copy>{t("mobile.foremanQuote.saveLocal")}</Copy>}{p.saveFailed && <Copy>{t("mobile.foremanQuote.saveFailed")}</Copy>}</Card>
        <Card><Copy variant="sectionTitle">{t("mobile.foremanQuote.lines")}</Copy>{p.draft.lines.map((line, index) => { const update = (patch: Partial<typeof line>) => p.change({ ...p.draft, lines: p.draft.lines.map((x, i) => i === index ? { ...x, ...patch } : x) }); return <Card key={index}><TextField label={t("mobile.foremanQuote.description")} value={line.label} onChangeText={label => update({ label })} /><TextField label={t("mobile.foremanQuote.amount")} value={line.amount} inputMode="decimal" onChangeText={amount => update({ amount })} /><TextField label={t("mobile.foremanQuote.evidenceRule")} value={line.evidence} onChangeText={evidence => update({ evidence })} />{p.draft.lines.length > 1 && <Button variant="quiet" label={t("mobile.foremanQuote.removeLine", { number: index + 1 })} onPress={() => p.change({ ...p.draft, lines: p.draft.lines.filter((_, i) => i !== index) })} />}</Card>; })}<Button variant="quiet" label={t("mobile.foremanQuote.addLine")} onPress={() => p.change({ ...p.draft, lines: [...p.draft.lines, { label: "", amount: "", evidence: "" }] })} /><Copy variant="sectionTitle">{t("mobile.foremanQuote.total")} · {format.money(amount, "EUR")}</Copy></Card>{!valid && <Copy>{t("mobile.foremanQuote.invalid")}</Copy>}{!p.hasTerms && <Copy>{t("mobile.foremanQuote.noTerms")}</Copy>}</> : d && <><ScopeTwin title={t("mobile.foremanQuote.scope")} original={d.scope} originalLocale={d.originalLocale} status={d.readingAid.status} translation={d.readingAid.status === "ready" ? d.readingAid.scope : undefined} translationLocale={d.readingAid.status === "ready" ? d.readingAid.locale : undefined} />{!!d.exclusions && <Copy>{d.exclusions}</Copy>}<Card>{d.items.map(item => <Copy key={item.lineNo}>{item.originalLabel}{d.readingAid.status === "ready" && d.readingAid.items.find(x => x.lineNo === item.lineNo) ? ` · ${d.readingAid.items.find(x => x.lineNo === item.lineNo)!.label}` : ""} · {format.money(item.netMinor + item.taxMinor, d.currency)}</Copy>)}<Copy variant="sectionTitle">{t("mobile.foremanQuote.total")} · {format.money(d.totalMinor, d.currency)}</Copy>{d.expiresAt && <Copy>{t("mobile.foremanQuote.validUntil", { time: time(format, d.expiresAt, d.job.siteZone) })}</Copy>}{d.decision?.decision === "approve" && <Copy>{t("mobile.foremanQuote.approvedBy", { name: d.decision.actorDisplayName, time: time(format, d.decision.at, d.job.siteZone) })}</Copy>}</Card>{d.actions.createRevision && <Button variant="quiet" label={t("mobile.foremanQuote.editRevision")} onPress={p.onRevision} />}</>}
    </>}
  </Screen>;
}
