import { approveQuoteVersionRoute, declineQuoteVersionRoute, getQuoteVersionRoute } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { commandIntentKey, useCommand, useCommandStatus, useRemote } from "../../api";
import type { CommandStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { Button, Card, Dock, Sheet } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { confirmAction } from "../s-17/confirmAction";
import QuoteScreen, { type CustomerQuote } from "../c-06/Screen";

export default function ApproveQuoteScreen() {
  const { jobId, versionId } = useLocalSearchParams<{ jobId: string; versionId: string }>();
  const router = useRouter();
  const pendingApproval = useCommandStatus(versionId ? commandIntentKey(approveQuoteVersionRoute, versionId) : null);
  const pendingDecline = useCommandStatus(versionId ? commandIntentKey(declineQuoteVersionRoute, versionId) : null);
  const remote = useRemote(getQuoteVersionRoute, { params: { j: jobId ?? "", id: versionId ?? "" } }, { enabled: !!jobId && !!versionId });
  const approve = useCommand(approveQuoteVersionRoute, { resourceId: versionId });
  const decline = useCommand(declineQuoteVersionRoute, { resourceId: versionId });
  const t = useT(); const format = useFormat();
  const read = remote.status === "ready" && remote.data?.audience === "customer" ? remote.data : null;
  const data = remote.status === "ready" ? approve.result ?? decline.result ?? read : null;
  const busy = pendingApproval !== "idle" || pendingDecline !== "idle";
  const state = pendingApproval === "sending" || pendingDecline === "sending" ? "sending"
    : busy ? "checking" : approve.state !== "idle" ? approve.state : decline.state;
  async function decide() {
    if (!read || !read.actions.approve || busy) return;
    const outcome = await approve.run({ params: { id: read.id }, body: { payload: { termsHash: read.terms.hash, ...(read.readingAid.status === "ready" ? { readingArtifactRef: read.readingAid.ref } : {}) } } });
    if (outcome.ok) remote.seed(outcome.data, outcome.meta.serverTime);
    else if (outcome.error.code === "CONFLICT" || outcome.error.code === "STALE_REVISION") void remote.refresh();
  }
  function askDecline() {
    if (!read || !read.actions.decline || busy) return;
    confirmAction(router, {
      title: t("mobile.customerQuote.decline"), actionLabel: t("mobile.customerQuote.decline"), actionLabelKey: "mobile.customerQuote.decline",
      item: t("mobile.customerQuote.quoteVersion", { number: read.no, provider: read.job.providerDisplayName }) + " · " + format.money(read.totalMinor, read.currency),
      actor: read.job.namedApproverDisplayName, role: read.job.placeAlias, effects: [t("mobile.customerQuote.effects")],
      destructive: true, onReview: () => { void remote.refresh(); },
      onConfirm: async () => {
        const result = await decline.run({ params: { id: read.id }, body: { payload: { termsHash: read.terms.hash, ...(read.readingAid.status === "ready" ? { readingArtifactRef: read.readingAid.ref } : {}) } } });
        if (result.ok) { remote.seed(result.data, result.meta.serverTime); return "confirmed"; }
        return result.error.code === "INTERNAL_ERROR" || ("delivery" in result.error && result.error.delivery === "unknown") ? "uncertain" : "invalidated";
      },
    });
  }
  return <><QuoteScreen /><ApprovalView data={data} state={state} onClose={() => router.back()} onApprove={() => { void decide(); }} onDecline={askDecline} onCurrent={(id) => router.replace(`/c/jobs/${jobId}/quote/${id}` as Href)} /></>;
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
