import { approveChangeVersionRoute, declineChangeVersionRoute, getChangeVersionRoute, type ChangeVersion } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCommand, useRemote } from "../../api";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { Badge, Button, Card, Dock, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ScopeTwin, statusLabel, time } from "../c-06/Screen";
import { confirmAction } from "../s-17/confirmAction";

type CustomerChange = Extract<ChangeVersion, { audience: "customer" }>;
export default function ChangeScreen() {
  const { jobId, versionId } = useLocalSearchParams<{ jobId: string; versionId: string }>(); const router = useRouter();
  const remote = useRemote(getChangeVersionRoute, { params: { j: jobId ?? "", id: versionId ?? "" } }, { enabled: !!jobId && !!versionId });
  const approve = useCommand(approveChangeVersionRoute); const reject = useCommand(declineChangeVersionRoute); const t = useT(); const format = useFormat();
  const read = remote.status === "ready" && remote.data?.audience === "customer" ? remote.data : null;
  const data = remote.status === "ready" ? approve.result ?? reject.result ?? read : null;
  const busy = [approve.state, reject.state].some(s => s === "sending" || s === "checking");
  function decide(kind: "approve" | "decline") {
    if (!read || busy || (kind === "approve" ? !read.actions.approve : !read.actions.decline)) return;
    const actionLabelKey = kind === "approve" ? "mobile.customerQuote.approveChange" : "mobile.customerQuote.reject";
    const label = kind === "approve" ? t("mobile.customerQuote.approveChange") : t("mobile.customerQuote.reject");
    confirmAction(router, { title: label, actionLabel: label, actionLabelKey, item: t("mobile.customerQuote.addition") + " · " + format.money(read.totalMinor, read.currency), actor: read.job.namedApproverDisplayName, role: read.job.placeAlias, effects: [t("mobile.customerQuote.changeEffects"), read.terms.consentText], destructive: kind === "decline", onReview: () => { void remote.refresh(); }, onConfirm: async () => { const input = { params: { id: read.id }, body: { payload: { termsHash: read.terms.hash, ...(read.readingAid.status === "ready" ? { readingArtifactRef: read.readingAid.ref } : {}) } } }; const outcome = kind === "approve" ? await approve.run(input) : await reject.run(input); if (outcome.ok) { void remote.refresh(); return "confirmed"; } if ("delivery" in outcome.error && outcome.error.delivery === "unknown") return "uncertain"; void remote.refresh(); return "invalidated"; } });
  }
  return <ChangeView data={data} status={remote.status} busy={busy} checking={approve.state === "checking" || reject.state === "checking"} failed={approve.state === "failed" || reject.state === "failed"} onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} onApprove={() => decide("approve")} onReject={() => decide("decline")} onOpen={(id) => router.push(`/c/jobs/${jobId}/change/${id}` as Href)} onJob={() => router.replace(`/c/jobs/${jobId}` as Href)} />;
}
export function ChangeView({ data, status, busy, checking, failed, onBack, onRetry, onApprove, onReject, onOpen, onJob }: { data: CustomerChange | null; status: RemoteStatus; busy: boolean; checking: boolean; failed: boolean; onBack: () => void; onRetry: () => void; onApprove: () => void; onReject: () => void; onOpen: (id: string) => void; onJob: () => void }) {
  const t = useT(); const format = useFormat(); const readable = status === "ready" ? data : null;
  const open = readable?.state === "issued";
  const dock = readable && (readable.replacedBy ? <Dock primary={{ label: t("mobile.customerQuote.viewCurrent"), onPress: () => onOpen(readable.replacedBy!.id) }} /> : open ? <Dock context={!readable.viewerIsNamedApprover ? t("mobile.customerQuote.onlyApprover", { name: readable.job.namedApproverDisplayName }) : undefined} primary={{ label: t("mobile.customerQuote.approveAmount", { amount: format.money(readable.totalMinor, readable.currency) }), onPress: onApprove, disabled: !readable.actions.approve || busy }} secondary={{ label: t("mobile.customerQuote.reject"), onPress: onReject, disabled: !readable.actions.decline || busy }} /> : <Dock primary={{ label: t("mobile.customerQuote.job"), onPress: onJob }} />);
  return <Screen title={t("mobile.customerQuote.changeTitle")} navigation={{ kind: "back", label: t("mobile.customerQuote.back"), onPress: onBack }} dock={dock}>
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.customerQuote.loading")}</Copy>}{status === "offline" && <Copy>{t("mobile.customerQuote.offline")}</Copy>}{status === "error" && <><Copy>{t("mobile.customerQuote.error")}</Copy><Button label={t("mobile.customerQuote.retry")} onPress={onRetry} /></>}
    {readable && <><Copy variant="supporting">{readable.job.reference} · {readable.job.jobTitle} · {readable.job.placeAlias}</Copy><Copy>{t("mobile.customerQuote.sent", { name: readable.publisherDisplayName, time: time(format, readable.issuedAt, readable.job.siteZone) })}</Copy><Badge label={statusLabel(t, readable.state)} />{readable.replacedBy && <Copy>{t("mobile.customerQuote.replaced", { number: readable.replacedBy.no })}</Copy>}{readable.decision && <Copy>{t("mobile.customerQuote.decision", { status: statusLabel(t, readable.state), name: readable.decision.actorDisplayName, time: time(format, readable.decision.at, readable.job.siteZone) })}</Copy>}
      <ScopeTwin title={t("mobile.customerQuote.base", { number: readable.approvedBase.no }) + " · " + format.money(readable.approvedBase.totalMinor, readable.currency)} original={readable.approvedBase.scope} originalLocale={readable.approvedBase.originalLocale} status={readable.approvedBase.readingAid.status} translation={readable.approvedBase.readingAid.status === "ready" ? readable.approvedBase.readingAid.scope : undefined} translationLocale={readable.approvedBase.readingAid.status === "ready" ? readable.approvedBase.readingAid.locale : undefined} />
      <ScopeTwin title={t("mobile.customerQuote.addition") + " · " + (readable.deltaMinor > 0 ? "+" : "") + format.money(readable.deltaMinor, readable.currency)} original={readable.originalText} originalLocale={readable.originalLocale} status={readable.readingAid.status} translation={readable.readingAid.status === "ready" ? readable.readingAid.text : undefined} translationLocale={readable.readingAid.status === "ready" ? readable.readingAid.locale : undefined} />
      <Card><Copy variant="sectionTitle">{t("mobile.customerQuote.newTotal")} · {format.money(readable.totalMinor, readable.currency)}</Copy><Copy>{readable.readingAid.status === "ready" ? readable.readingAid.timing : readable.timing}</Copy></Card><Card><Copy variant="sectionTitle">{t("mobile.customerQuote.onHold")}</Copy><Copy>{readable.readingAid.status === "ready" ? readable.readingAid.affectedItems : readable.affectedItems}</Copy><Copy>{t("mobile.customerQuote.validUntil", { time: time(format, readable.expiresAt, readable.job.siteZone) })}</Copy></Card>{checking && <Copy>{t("mobile.customerQuote.checking")}</Copy>}{failed && <Copy>{t("mobile.customerQuote.failed")}</Copy>}
    </>}
  </Screen>;
}
