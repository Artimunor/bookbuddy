import { approveChangeVersionRoute, declineChangeVersionRoute, getChangeVersionRoute, listChangeVersionsRoute, type ChangeVersion } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { commandIntentKey, useCommand, useCommandStatus, useRemote } from "../../api";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Button, Card, Dock, Screen, StatusBanner } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { ScopeTwin, statusLabel } from "../c-06/Screen";
import { confirmAction } from "../s-17/confirmAction";

type CustomerChange = Extract<ChangeVersion, { audience: "customer" }>;
export default function ChangeScreen() {
  const { jobId, versionId } = useLocalSearchParams<{ jobId: string; versionId: string }>(); const router = useRouter();
  const { preferences } = useSession();
  const remote = useRemote(getChangeVersionRoute, { params: { j: jobId ?? "", id: versionId ?? "" } }, { enabled: !!jobId && !!versionId });
  const approve = useCommand(approveChangeVersionRoute, { resourceId: versionId });
  const reject = useCommand(declineChangeVersionRoute, { resourceId: versionId });
  const pendingApproval = useCommandStatus(versionId ? commandIntentKey(approveChangeVersionRoute, versionId) : null);
  const pendingRejection = useCommandStatus(versionId ? commandIntentKey(declineChangeVersionRoute, versionId) : null);
  const t = useT(); const format = useFormat();
  const read = remote.data?.audience === "customer" ? remote.data : null;
  const checking = pendingApproval !== "idle" || pendingRejection !== "idle";
  const [opening, setOpening] = useState<{ versionId: string; proposalId: string; fallback: string } | null>(null);
  const lookingUpCurrent = !!opening && opening.versionId === versionId;
  const versions = useRemote(listChangeVersionsRoute, { params: { j: jobId ?? "" } }, { enabled: !!jobId, loadOnMount: false });
  useEffect(() => {
    if (!opening || !jobId || !lookingUpCurrent) return;
    if (versions.status === "idle" || versions.status === "loading") return;
    const list = versions.data?.audience === "customer" ? versions.data.versions : [];
    let current: (typeof list)[number] | undefined;
    for (const candidate of list) {
      if (candidate.proposalId === opening.proposalId && candidate.isCurrentProposal &&
        (!current || candidate.createdAt > current.createdAt)) current = candidate;
    }
    setOpening(null);
    // The exact version read can name a replacement outside the first list page.
    const target = current?.id ?? opening.fallback;
    router.push(`/c/jobs/${jobId}/change/${target}` as Href);
  }, [jobId, lookingUpCurrent, opening, router, versions.status, versions.data]);
  function decide(kind: "approve" | "decline") {
    if (!read || checking || (kind === "approve" ? !read.actions.approve : !read.actions.decline)) return;
    const actionLabelKey = kind === "approve" ? "mobile.customerQuote.approveChange" : "mobile.customerQuote.reject";
    const label = kind === "approve" ? t("mobile.customerQuote.approveChange") : t("mobile.customerQuote.reject");
    confirmAction(router, {
      title: label, actionLabel: label, actionLabelKey,
      item: t("mobile.customerQuote.addition") + " · " + format.money(read.totalMinor, read.currency),
      actor: read.job.namedApproverDisplayName, role: read.job.placeAlias,
      effects: [t("mobile.customerQuote.changeEffects"), read.terms.consentText], destructive: kind === "decline",
      onReview: () => { void remote.refresh(); },
      onConfirm: async () => {
        const input = { params: { id: read.id }, body: { payload: { termsHash: read.terms.hash, ...(read.readingAid.status === "ready" ? { readingArtifactRef: read.readingAid.ref } : {}) } } };
        const outcome = kind === "approve" ? await approve.run(input) : await reject.run(input);
        if (outcome.ok) { remote.seed(outcome.data, outcome.meta.serverTime); return "confirmed"; }
        return outcome.error.code === "INTERNAL_ERROR" || ("delivery" in outcome.error && outcome.error.delivery === "unknown") ? "uncertain" : "invalidated";
      },
    });
  }
  return <ChangeView data={read} status={remote.status} twoClock={preferences?.twoClock} busy={checking || lookingUpCurrent} checking={checking} failed={approve.state === "failed" || reject.state === "failed"} onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} onApprove={() => decide("approve")} onReject={() => decide("decline")}
    onOpen={fallback => {
      if (!read || lookingUpCurrent) return;
      setOpening({ versionId: read.id, proposalId: read.proposalId, fallback });
      void versions.refresh();
    }}
    onJob={() => router.replace(`/c/jobs/${jobId}` as Href)} />;
}
export function ChangeView({ data, status, twoClock = false, busy, checking, failed, onBack, onRetry, onApprove, onReject, onOpen, onJob }: { data: CustomerChange | null; status: RemoteStatus; twoClock?: boolean; busy: boolean; checking: boolean; failed: boolean; onBack: () => void; onRetry: () => void; onApprove: () => void; onReject: () => void; onOpen: (id: string) => void; onJob: () => void }) {
  const t = useT();
  const format = useFormat();
  const { color, radius, space } = useBeaconTheme();
  const readable = status === "ready" ? data : null;
  const open = readable?.state === "issued";
  const replacement = readable?.replacedBy;
  const total = readable ? format.money(readable.totalMinor, readable.currency) : "";
  const viewerZone = twoClock ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const issued = readable ? format.lines(readable.issuedAt, readable.job.siteZone, viewerZone) : null;
  const deadline = readable && open ? format.lines(readable.expiresAt, readable.job.siteZone, viewerZone) : null;
  const decision = readable?.decision ? format.lines(readable.decision.at, readable.job.siteZone, viewerZone) : null;
  const dock = readable && (replacement ? <Dock primary={{ label: t("mobile.customerQuote.viewCurrent"), busy, onPress: () => onOpen(replacement.id) }} /> : open ? <Dock
    context={readable.viewerIsNamedApprover ? t("mobile.customerQuote.namedApprover", { name: readable.job.namedApproverDisplayName, place: readable.job.placeAlias })
      : t("mobile.customerQuote.onlyApprover", { name: readable.job.namedApproverDisplayName })}
    primary={{ label: t("mobile.customerQuote.approveAmount", { amount: total }), onPress: onApprove, disabled: !readable.actions.approve || busy }}
    secondary={{ label: t("mobile.customerQuote.reject"), onPress: onReject, disabled: !readable.actions.decline || busy }} />
    : <Dock primary={{ label: t("mobile.customerQuote.job"), onPress: onJob }} />);
  return <Screen title={t("mobile.customerQuote.changeTitle")} subtitle={readable ? `${readable.job.reference} · ${readable.job.jobTitle} · ${readable.job.placeAlias}` : undefined}
    navigation={{ kind: "back", label: t("mobile.customerQuote.back"), onPress: onBack }} dock={dock}>
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.customerQuote.loading")}</Copy>}
    {status === "offline" && <Copy>{t("mobile.customerQuote.offline")}</Copy>}
    {status === "error" && <><Copy>{t("mobile.customerQuote.error")}</Copy><Button label={t("mobile.customerQuote.retry")} onPress={onRetry} /></>}
    {checking && <StatusBanner state="last-confirmed" label={t("mobile.customerQuote.checking")} />}
    {readable && <>
      <View style={{ gap: space.grid[1] }}>
        <Copy variant="supporting">{issued ? t("mobile.customerQuote.sent", { name: readable.publisherDisplayName, time: issued.site }) : readable.publisherDisplayName}</Copy>
        {issued?.viewer && <Copy variant="supporting" style={{ color: color.muted }}>{issued.viewer}</Copy>}
      </View>
      {!open && <Badge tone={readable.state === "approved" ? "success" : "neutral"} label={statusLabel(t, readable.state)} />}
      {replacement && <Copy>{t("mobile.customerQuote.replaced", { number: replacement.no })}</Copy>}
      {readable.decision && decision && <View style={{ gap: space.grid[1] }}>
        <Copy>{t("mobile.customerQuote.decision", { status: statusLabel(t, readable.state), name: readable.decision.actorDisplayName, time: decision.site })}</Copy>
        {decision.viewer && <Copy variant="supporting" style={{ color: color.muted }}>{decision.viewer}</Copy>}
      </View>}
      <ScopeTwin title={t("mobile.customerQuote.base", { number: readable.approvedBase.no }) + " · " + format.money(readable.approvedBase.totalMinor, readable.currency)} original={readable.approvedBase.scope} originalLocale={readable.approvedBase.originalLocale} status={readable.approvedBase.readingAid.status} translation={readable.approvedBase.readingAid.status === "ready" ? readable.approvedBase.readingAid.scope : undefined} translationLocale={readable.approvedBase.readingAid.status === "ready" ? readable.approvedBase.readingAid.locale : undefined} />
      <ScopeTwin title={t("mobile.customerQuote.addition") + " · " + (readable.deltaMinor > 0 ? "+" : "") + format.money(readable.deltaMinor, readable.currency)} original={readable.originalText} originalLocale={readable.originalLocale} status={readable.readingAid.status} translation={readable.readingAid.status === "ready" ? readable.readingAid.text : undefined} translationLocale={readable.readingAid.status === "ready" ? readable.readingAid.locale : undefined} />
      <Card dense>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: space.grid[2] }}>
          <Copy variant="label">{t("mobile.customerQuote.newTotal")}</Copy>
          <Copy variant="sectionTitle" style={{ fontVariant: ["tabular-nums"] }}>{total}</Copy>
        </View>
        <Copy>{readable.readingAid.status === "ready" ? readable.readingAid.timing ?? readable.timing : readable.timing}</Copy>
      </Card>
      {open && <View style={{ borderRadius: radius.card, backgroundColor: color.attentionSoft, padding: space.grid[4], gap: space.grid[1] }}>
        <Copy variant="label" style={{ color: color.attentionInk }}>{t("mobile.customerQuote.onHold")}</Copy>
        <Copy style={{ color: color.attentionInk }}>{readable.readingAid.status === "ready" ? readable.readingAid.affectedItems ?? readable.affectedItems : readable.affectedItems}</Copy>
        {deadline && <Copy variant="label" style={{ color: color.attentionInk }}>{t("mobile.customerQuote.validUntil", { time: deadline.site })}</Copy>}
        {deadline?.viewer && <Copy variant="supporting" style={{ color: color.attentionInk }}>{deadline.viewer}</Copy>}
      </View>}
      {failed && open && <StatusBanner state="not-sent" label={t("mobile.customerQuote.failed")} />}
    </>}
  </Screen>;
}
