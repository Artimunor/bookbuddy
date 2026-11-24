import {
  getChangeVersionRoute, getQuoteVersionRoute, issueChangeVersionRoute, issueQuoteVersionRoute,
  returnChangeVersionRoute, returnQuoteVersionRoute, submitChangeReviewRoute, submitQuoteReviewRoute,
  type ChangeVersion, type QuoteVersion,
} from "@bookbuddy/api-contract";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { BackHandler } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Button, Card, Screen, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ReadState, useProviderFormat as useFormat } from "../p-01/shared";
import { useOffline } from "../s-02/flow";
import { confirmAction } from "../s-17/confirmAction";

type StaffVersion = Exclude<QuoteVersion | ChangeVersion, { audience: "customer" }>;
export type ReviewTarget = { kind: "quote" | "change"; jobId: string; versionId: string };
type Action = "return" | "issue" | "submitReview";

export function CommercialReview({ target, onClose, onChanged }: { target: ReviewTarget; onClose: () => void; onChanged: () => void }) {
  const { kind, jobId, versionId } = target;
  const isQuote = kind === "quote";
  const params = { j: jobId, id: versionId };
  const quote = useRemote(getQuoteVersionRoute, { params }, { enabled: isQuote });
  const change = useRemote(getChangeVersionRoute, { params }, { enabled: !isQuote });
  const quoteSubmit = useCommand(submitQuoteReviewRoute, { resourceId: isQuote ? versionId : undefined });
  const quoteReturn = useCommand(returnQuoteVersionRoute, { resourceId: isQuote ? versionId : undefined });
  const quoteIssue = useCommand(issueQuoteVersionRoute, { resourceId: isQuote ? versionId : undefined });
  const changeSubmit = useCommand(submitChangeReviewRoute, { resourceId: !isQuote ? versionId : undefined });
  const changeReturn = useCommand(returnChangeVersionRoute, { resourceId: !isQuote ? versionId : undefined });
  const changeIssue = useCommand(issueChangeVersionRoute, { resourceId: !isQuote ? versionId : undefined });
  const remote = isQuote ? quote : change;
  const version = remote.data && remote.data.audience !== "customer" ? remote.data : null;
  const { bootstrap } = useSession();
  const t = useT();
  const format = useFormat();
  const router = useRouter();
  const offline = useOffline();
  const [reason, setReason] = useState("");
  const latest = useRef(version);
  latest.current = version;
  const states = isQuote ? [quoteSubmit.state, quoteReturn.state, quoteIssue.state] : [changeSubmit.state, changeReturn.state, changeIssue.state];
  const checking = states.includes("checking");
  const busy = checking || states.includes("sending");
  const ready = remote.status === "ready" && !offline && !busy;
  const cleanReason = reason.trim();
  const issueLabel = isQuote ? t("mobile.foremanQuote.issue") : t("mobile.provider.issueChange");
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => listener.remove();
  }, [onClose]);

  function confirm(action: Action) {
    if (!version || !ready || !version.actions[action] || (action === "return" && !cleanReason)) return;
    const label = action === "return" ? t("mobile.provider.returnReview") : action === "submitReview" ? t("mobile.foremanQuote.review") : issueLabel;
    const versionLabel = isQuote ? t("mobile.provider.reviewQuoteVersion", { number: version.no }) : t("mobile.provider.reviewChangeVersion", { number: version.no });
    confirmAction(router, {
      title: label, actionLabel: label,
      actionLabelKey: action === "return" ? "mobile.provider.returnReview" : action === "submitReview" ? "mobile.foremanQuote.review" : isQuote ? "mobile.foremanQuote.issue" : "mobile.provider.issueChange",
      item: `${version.job.reference} · ${version.job.jobTitle} · ${versionLabel} · ${format.money(version.totalMinor, version.currency)}`,
      actor: bootstrap?.account.displayName ?? "", role: version.job.providerDisplayName,
      effects: action === "return" ? [t("mobile.provider.returnReviewEffect", { name: version.authorDisplayName }), cleanReason]
        : action === "submitReview" ? [t("mobile.foremanQuote.effect")]
        : [isQuote ? t("mobile.foremanQuote.issueEffect") : t("mobile.provider.issueChangeEffect"), version.job.namedApproverDisplayName, version.terms.originalText],
      offline, onReview: () => { void remote.refresh(); },
      onConfirm: async () => {
        if (latest.current !== version) return "invalidated";
        const commandParams = { id: version.id };
        const input = { params: commandParams, body: { payload: {} } };
        const returned = { params: commandParams, body: { payload: { reason: cleanReason } } };
        const issued = { params: commandParams, body: { payload: { termsHash: version.terms.hash } } };
        const result = isQuote
          ? await (action === "return" ? quoteReturn.run(returned) : action === "issue" ? quoteIssue.run(issued) : quoteSubmit.run(input))
          : await (action === "return" ? changeReturn.run(returned) : action === "issue" ? changeIssue.run(issued) : changeSubmit.run(input));
        if (result.ok) {
          if ("approvedBase" in result.data) change.seed(result.data, result.meta.serverTime);
          else quote.seed(result.data, result.meta.serverTime);
          setReason("");
          onChanged();
          return "confirmed";
        }
        return ("delivery" in result.error && result.error.delivery === "unknown") || result.error.code === "INTERNAL_ERROR" ? "uncertain" : "invalidated";
      },
    });
  }

  return <Screen title={t("mobile.provider.reviewDetail")} navigation={{ kind: "back", label: t("mobile.provider.back"), onPress: onClose }}>
    {!version ? <ReadState status={remote.status === "ready" ? "error" : remote.status} retry={() => { void remote.refresh(); }} /> : <>
      <ReviewVersion version={version} />
      {version.actions.return && <>
        <TextField label={t("mobile.provider.reviewReturnReason")} value={reason} onChangeText={setReason} maxLength={500} multiline disabled={!ready} />
        <Button variant="neutral" label={t("mobile.provider.returnReview")} disabled={!ready || !cleanReason} onPress={() => confirm("return")} />
      </>}
      {version.actions.issue && <Button label={issueLabel} disabled={!ready} onPress={() => confirm("issue")} />}
      {version.actions.submitReview && <Button label={t("mobile.foremanQuote.review")} disabled={!ready} onPress={() => confirm("submitReview")} />}
      {checking && <Copy accessibilityLiveRegion="polite">{t("mobile.provider.checking")}</Copy>}
    </>}
  </Screen>;
}

export function ReviewVersion({ version }: { version: StaffVersion }) {
  const t = useT();
  const format = useFormat();
  const review = version.review;
  const change = "approvedBase" in version;
  const state = review?.state === "returned" ? t("mobile.foremanQuote.returned") : review?.state === "issued" || version.state === "issued"
    ? t("mobile.foremanQuote.sent") : review?.state === "pending" ? t("mobile.foremanQuote.inReview") : null;
  return <>
    <Copy variant="sectionTitle">{version.job.jobTitle}</Copy>
    <Copy variant="supporting">{version.job.reference} · {version.job.placeAlias} · {version.job.providerDisplayName}</Copy>
    <Copy variant="label">{change ? t("mobile.provider.reviewChangeVersion", { number: version.no }) : t("mobile.provider.reviewQuoteVersion", { number: version.no })}</Copy>
    {state && <Badge label={state} tone={review?.state === "pending" ? "attention" : "neutral"} />}
    <Copy>{review ? t("mobile.provider.reviewVersion", { version: version.no, person: version.authorDisplayName, time: format.siteTime(review.submittedAt, version.job.siteZone) }) : version.authorDisplayName}</Copy>
    {review?.state === "returned" && <Copy>{review.returnReason}</Copy>}
    {change ? <>
      <Card><Copy variant="sectionTitle">{t("mobile.customerQuote.base", { number: version.approvedBase.no })}</Copy>
        <Copy>{format.money(version.approvedBase.totalMinor, version.approvedBase.currency)}</Copy><Copy>{version.approvedBase.scope}</Copy>
        {version.approvedBase.exclusions && <><Copy variant="label">{t("mobile.customerQuote.exclusions")}</Copy><Copy>{version.approvedBase.exclusions}</Copy></>}
      </Card>
      <Card><Copy variant="sectionTitle">{t("mobile.customerQuote.addition")}</Copy><Copy>{version.originalText}</Copy>
        <Copy>{format.money(version.deltaMinor, version.currency)}</Copy>
        <Copy variant="label">{t("mobile.foremanQuote.affected")}</Copy><Copy>{version.affectedItems}</Copy>
        <Copy variant="label">{t("mobile.foremanQuote.timing")}</Copy><Copy>{version.timing}</Copy>
      </Card>
    </> : <Card>
      <Copy variant="sectionTitle">{t("mobile.customerQuote.scope")}</Copy><Copy>{version.scope}</Copy>
      {version.exclusions && <><Copy variant="label">{t("mobile.customerQuote.exclusions")}</Copy><Copy>{version.exclusions}</Copy></>}
    </Card>}
    <Card>
      {version.items.map(item => <Copy key={item.lineNo}>{item.quantity} × {item.originalLabel} · {format.money(item.netMinor + item.taxMinor, version.currency)} · {item.evidenceRule}{item.evidenceAlternative ? ` · ${item.evidenceAlternative}` : ""}</Copy>)}
      <Copy variant="sectionTitle">{t("mobile.provider.reviewTotal", { amount: format.money(version.totalMinor, version.currency) })}</Copy>
    </Card>
    <Card><Copy variant="sectionTitle">{t("mobile.customerQuote.terms")}</Copy><Copy>{version.terms.providerLegalSnapshot} · {version.terms.contractLocale}</Copy><Copy>{version.terms.originalText}</Copy></Card>
  </>;
}
