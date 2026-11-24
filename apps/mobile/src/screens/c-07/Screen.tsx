import { approveQuoteVersionRoute, declineQuoteVersionRoute, getQuoteVersionRoute } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCommand, useRemote } from "../../api";
import type { CommandStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { Button, Card, Dock, Sheet } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { confirmAction } from "../s-17/confirmAction";
import QuoteScreen, { type CustomerQuote } from "../c-06/Screen";
import { setApprovalChecking, useApprovalState } from "../c-06/approvalState";

export default function ApproveQuoteScreen() {
  const { jobId, versionId } = useLocalSearchParams<{ jobId: string; versionId: string }>();
  const router = useRouter();
  const approvalState = useApprovalState(jobId ?? "", versionId ?? "");
  const remote = useRemote(getQuoteVersionRoute, { params: { j: jobId ?? "", id: versionId ?? "" } }, { enabled: !!jobId && !!versionId });
  const approve = useCommand(approveQuoteVersionRoute); const decline = useCommand(declineQuoteVersionRoute);
  const t = useT(); const format = useFormat();
  const read = remote.status === "ready" && remote.data?.audience === "customer" ? remote.data : null;
  const data = remote.status === "ready" ? approve.result ?? decline.result ?? read : null;
  async function decide() {
    if (!read || !read.actions.approve || approvalState === "checking" || approve.state === "sending" || approve.state === "checking") return;
    setApprovalChecking(jobId ?? "", versionId ?? "", true);
    const outcome = await approve.run({ params: { id: read.id }, body: { payload: { termsHash: read.terms.hash, ...(read.readingAid.status === "ready" ? { readingArtifactRef: read.readingAid.ref } : {}) } } });
    const uncertain = !outcome.ok && (outcome.error.code === "INTERNAL_ERROR" || ("delivery" in outcome.error && outcome.error.delivery === "unknown"));
    if (outcome.ok || (!outcome.ok && (outcome.error.code === "CONFLICT" || outcome.error.code === "STALE_REVISION"))) await remote.refresh();
    if (!uncertain) setApprovalChecking(jobId ?? "", versionId ?? "", false);
  }
  function askDecline() {
    if (!read || !read.actions.decline) return;
    confirmAction(router, { title: t("mobile.customerQuote.decline"), actionLabel: t("mobile.customerQuote.decline"), actionLabelKey: "mobile.customerQuote.decline", item: t("mobile.customerQuote.quoteVersion", { number: read.no, provider: read.job.providerDisplayName }) + " · " + format.money(read.totalMinor, read.currency), actor: read.job.namedApproverDisplayName, role: read.job.placeAlias, effects: [t("mobile.customerQuote.effects")], destructive: true, onReview: () => router.back(), onConfirm: async () => { const result = await decline.run({ params: { id: read.id }, body: { payload: { termsHash: read.terms.hash, ...(read.readingAid.status === "ready" ? { readingArtifactRef: read.readingAid.ref } : {}) } } }); if (result.ok) { void remote.refresh(); return "confirmed"; } return "delivery" in result.error && result.error.delivery === "unknown" ? "uncertain" : "invalidated"; } });
  }
  return <><QuoteScreen /><ApprovalView data={data} state={approvalState === "checking" && approve.state !== "sending" ? "checking" : approve.state} onClose={() => router.back()} onApprove={() => { void decide(); }} onDecline={askDecline} onCurrent={(id) => router.replace(`/c/jobs/${jobId}/quote/${id}` as Href)} /></>;
}
export function ApprovalView({ data, state, onClose, onApprove, onDecline, onCurrent }: { data: CustomerQuote | null; state: CommandStatus; onClose: () => void; onApprove: () => void; onDecline: () => void; onCurrent: (id: string) => void }) {
  const t = useT(); const format = useFormat();
  const approved = data?.state === "approved";
  const changed = state === "conflict" || !!data?.replacedBy;
  const busy = state === "sending" || state === "checking";
  const primary = approved ? { label: t("mobile.customerQuote.done"), onPress: onClose } : changed && data?.replacedBy ? { label: t("mobile.customerQuote.viewCurrent"), onPress: () => onCurrent(data.replacedBy!.id) } : { label: data ? t("mobile.customerQuote.approveAmount", { amount: format.money(data.totalMinor, data.currency) }) : t("mobile.customerQuote.approveChange"), onPress: onApprove, disabled: !data?.actions.approve || busy || changed, busy: state === "sending" };
  return <Sheet visible title={data && !data.viewerIsNamedApprover ? t("mobile.customerQuote.approvesTitle", { name: data.job.namedApproverDisplayName }) : t("mobile.customerQuote.approveTitle")} closeLabel={t("mobile.customerQuote.close")} onClose={onClose} dock={<Dock primary={primary} context={data && !data.viewerIsNamedApprover ? t("mobile.customerQuote.onlyApprover", { name: data.job.namedApproverDisplayName }) : undefined} />}>
    {data ? <><Copy variant="supporting">{data.job.reference} · {data.job.jobTitle} · {data.job.placeAlias}</Copy><Card><Copy>{t("mobile.customerQuote.namedApprover", { name: data.job.namedApproverDisplayName, place: data.job.placeAlias })}</Copy></Card><Card><Copy variant="sectionTitle">{t("mobile.customerQuote.quoteVersion", { number: data.no, provider: data.job.providerDisplayName })}</Copy><Copy variant="sectionTitle">{format.money(data.totalMinor, data.currency)}</Copy></Card><Copy>{t("mobile.customerQuote.effects")}</Copy><Copy>{t("mobile.customerQuote.recorded")}</Copy><Copy>{data.terms.consentText}</Copy><Copy variant="sectionTitle">{t("mobile.customerQuote.terms")}</Copy><Copy>{data.terms.originalText}</Copy>{approved && <Copy>{t("mobile.customerQuote.approved")}</Copy>}{changed && <Copy>{t("mobile.customerQuote.changed")}</Copy>}{state === "checking" && <Copy>{t("mobile.customerQuote.checking")}</Copy>}{state === "failed" && <Copy>{t("mobile.customerQuote.failed")}</Copy>}{data.actions.decline && !busy && !changed && <Button variant="quiet" label={t("mobile.customerQuote.decline")} onPress={onDecline} />}</> : <Copy>{t("mobile.customerQuote.loading")}</Copy>}
  </Sheet>;
}
