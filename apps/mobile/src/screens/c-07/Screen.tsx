import { approveQuoteVersionRoute, declineQuoteVersionRoute, getQuoteVersionRoute } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { commandIntentKey, useCommand, useCommandStatus, useRemote } from "../../api";
import type { CommandStatus, RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Button, Card, Dock, Sheet, StatusBanner } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
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
  const { preferences } = useSession();
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
  return <><QuoteScreen /><ApprovalView data={data} readStatus={remote.status} state={state} twoClock={preferences?.twoClock}
    onClose={() => router.back()} onApprove={() => { void decide(); }} onDecline={askDecline}
    onWindows={() => router.replace(`/c/jobs/${jobId}/windows` as Href)}
    onCurrent={(id) => router.replace(`/c/jobs/${jobId}/quote/${id}` as Href)} /></>;
}
export function ApprovalView({ data, state, readStatus = "ready", twoClock = false, onClose, onApprove, onDecline, onCurrent, onWindows }: {
  data: CustomerQuote | null; state: CommandStatus; readStatus?: RemoteStatus; twoClock?: boolean; onClose: () => void; onApprove: () => void;
  onDecline: () => void; onCurrent: (id: string) => void; onWindows?: () => void;
}) {
  const t = useT();
  const format = useFormat();
  const { color, radius, space } = useBeaconTheme();
  const [termsVersion, setTermsVersion] = useState<string | null>(null);
  const approved = data?.state === "approved";
  const changed = state === "conflict" || !!data?.replacedBy;
  const busy = state === "sending" || state === "checking";
  const primary = approved
    ? data.hasProposedWindows && onWindows ? { label: t("mobile.customerHome.pickWindow"), onPress: onWindows } : { label: t("mobile.customerQuote.done"), onPress: onClose }
    : changed && data?.replacedBy ? { label: t("mobile.customerQuote.viewCurrent"), onPress: () => onCurrent(data.replacedBy!.id) }
      : { label: data ? t("mobile.customerQuote.approveAmount", { amount: format.money(data.totalMinor, data.currency) }) : t("mobile.customerQuote.approveChange"), onPress: onApprove, disabled: !data?.actions.approve || busy || changed, busy: state === "sending" };
  const context = readStatus === "offline" ? t("mobile.customerQuote.offline") : data && !data.viewerIsNamedApprover && !approved && !changed
    ? t("mobile.customerQuote.onlyApprover", { name: data.job.namedApproverDisplayName }) : undefined;
  const decisionAt = approved && data.decision ? format.lines(data.decision.at, data.job.siteZone,
    twoClock ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined) : null;
  const showTerms = data !== null && termsVersion === data.id;
  return <Sheet visible
    title={approved ? t("mobile.customerQuote.approvalReceipt") : data && !data.viewerIsNamedApprover
      ? t("mobile.customerQuote.approvesTitle", { name: data.job.namedApproverDisplayName }) : t("mobile.customerQuote.approveTitle")}
    subtitle={data ? `${data.job.reference} · ${data.job.jobTitle} · ${data.job.placeAlias}` : undefined}
    closeLabel={t("mobile.customerQuote.close")} onClose={onClose} dock={<Dock primary={primary} context={context} />}>
    {changed && <StatusBanner state="last-confirmed" label={t("mobile.customerQuote.changed")} />}
    {state === "checking" && <StatusBanner state="last-confirmed" label={t("mobile.customerQuote.checking")} />}
    {state === "failed" && <StatusBanner state="not-sent" label={t("mobile.customerQuote.failed")} />}
    {data ? <>
      {approved && decisionAt && <View style={{ gap: space.grid[1] }} accessibilityLiveRegion="polite">
        <Copy variant="label" style={{ color: color.successInk }}>{decisionAt.site}</Copy>
        {decisionAt.viewer && <Copy variant="supporting">{decisionAt.viewer}</Copy>}
      </View>}
      <View style={{ backgroundColor: color.subtle, borderRadius: radius.card, padding: space.grid[4] }}>
        <Copy variant="label">{t("mobile.customerQuote.namedApprover", { name: data.job.namedApproverDisplayName, place: data.job.placeAlias })}</Copy>
      </View>
      <Card dense>
        <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.customerQuote.quoteVersion", { number: data.no, provider: data.job.providerDisplayName })}</Copy>
        <Copy variant="pageTitle" style={{ fontVariant: ["tabular-nums"] }}>{format.money(data.totalMinor, data.currency)}</Copy>
      </Card>
      {!approved && <>
        <Copy variant="supporting">{t("mobile.customerQuote.effects")}</Copy>
        {data.viewerIsNamedApprover && <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.customerQuote.recorded")}</Copy>}
        <Copy>{data.terms.consentText}</Copy>
      </>}
      <View style={{ alignSelf: "flex-start" }}><Button variant="quiet" label={t("mobile.customerQuote.terms")}
        onPress={() => setTermsVersion(showTerms ? null : data.id)} /></View>
      {showTerms && <Card dense><Copy>{data.terms.originalText}</Copy></Card>}
      {data.actions.decline && !busy && !changed && <View style={{ alignSelf: "flex-start" }}>
        <Button variant="quiet" label={t("mobile.customerQuote.decline")} onPress={onDecline} />
      </View>}
    </> : <Copy>{readStatus === "offline" ? t("mobile.customerQuote.offline") : readStatus === "error" ? t("mobile.customerQuote.error") : t("mobile.customerQuote.loading")}</Copy>}
  </Sheet>;
}
