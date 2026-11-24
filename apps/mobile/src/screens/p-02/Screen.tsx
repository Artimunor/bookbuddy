import { getJobRoute, getJobsRoute, offerJobHandoffRoute, recordPaidRoute, withdrawJobHandoffRoute, type RouteResponse } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useCommand, useRemote } from "../../api";
import { useT } from "../../i18n";
import { Badge, BookingCard, Button, Card, SegmentedControl, SwitchRow, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ProviderScreen, ReadState, useProvider, useProviderFormat as useFormat, useProviderLabels } from "../p-01/shared";
import { useOffline } from "../s-02/flow";
import { confirmAction } from "../s-17/confirmAction";

type Segment = "needs_you" | "active" | "past";
type UnpaidBill = Extract<RouteResponse<typeof getJobsRoute.output>, { audience: "provider_admin" }>["unpaidBills"][number];

function RecordPayment({ bill, actor, ready, onChanged }: { bill: UnpaidBill; actor: string; ready: boolean; onChanged: () => void }) {
  const router = useRouter(); const t = useT(); const format = useFormat(); const offline = useOffline();
  const payment = useCommand(recordPaidRoute, { resourceId: bill.billId });
  const [reference, setReference] = useState("");
  const label = t("mobile.provider.recordPayment");
  const verifiedReference = reference.trim();
  const busy = payment.state === "checking" || payment.state === "sending";
  const canConfirm = ready && !offline && !busy && bill.canRecordPaid && !!verifiedReference;
  const billLabel = t("mobile.provider.bill", { number: bill.number, amount: format.money(bill.total.minor, bill.total.currency) });
  function confirm() {
    if (!canConfirm) return;
    confirmAction(router, {
      title: label, actionLabel: label, actionLabelKey: "mobile.provider.recordPayment",
      item: `${bill.reference} · ${billLabel}`, actor, role: t("mobile.provider.admin"),
      effects: [t("mobile.provider.recordPaymentEffect")], onReview: onChanged,
      onConfirm: async () => {
        const result = await payment.run({ params: { id: bill.billId }, body: {
          payload: { id: uuid.v4(), expectedPriorId: bill.expectedPriorId, amountMinor: bill.total.minor, verifiedReference },
        } });
        if (result.ok) { setReference(""); onChanged(); return "confirmed"; }
        return "delivery" in result.error && result.error.delivery === "unknown" ? "uncertain" : "invalidated";
      },
    });
  }
  return <Card>
    <Copy>{billLabel}</Copy>
    <Copy>{bill.status === "checking" ? t("mobile.aftercare.checkingTransfer") : t("mobile.aftercare.due")}</Copy>
    {bill.canRecordPaid && <>
      <TextField label={t("mobile.provider.verifiedTransferReference")} value={reference} maxLength={500} onChangeText={setReference}
        disabled={!ready || offline || busy} autoCapitalize="none" autoCorrect={false} />
      <Button label={label} onPress={confirm} disabled={!canConfirm} />
    </>}
    {payment.state === "checking" && <Copy>{t("mobile.provider.checking")}</Copy>}
  </Card>;
}

export default function ProviderJobsScreen() {
  const router = useRouter(); const t = useT(); const format = useFormat(); const labels = useProviderLabels(); const { actor } = useProvider();
  const params = useLocalSearchParams<{ jobId?: string; segment?: string }>();
  const [segment, setSegment] = useState<Segment>(params.segment === "needs_you" ? "needs_you" : params.jobId ? "active" : "needs_you");
  const [selected, setSelected] = useState<string | null>(params.jobId ?? null); const [recipient, setRecipient] = useState<string | null>(null); const [urgentCalled, setUrgentCalled] = useState(false);
  const [cursors, setCursors] = useState<string[]>([]);
  useEffect(() => {
    if (!params.jobId) return;
    setSegment(params.segment === "needs_you" ? "needs_you" : "active");
    setSelected(params.jobId); setCursors([]); setRecipient(null); setUrgentCalled(false);
  }, [params.jobId, params.segment]);
  const jobs = useRemote(getJobsRoute, { query: { segment, ...(cursors.at(-1) ? { cursor: cursors.at(-1) } : {}) } });
  const detail = useRemote(getJobRoute, { params: { j: selected ?? "" }, query: { view: "whole" } }, { enabled: !!selected });
  const offer = useCommand(offerJobHandoffRoute); const withdraw = useCommand(withdrawJobHandoffRoute);
  const page = jobs.data?.audience === "provider_admin" ? jobs.data : null;
  const job = detail.data?.audience === "provider_admin" && detail.data.job.view === "whole" ? detail.data.job : null;
  const items = page ? job && !page.items.some((item) => item.jobId === job.jobId) ? [job, ...page.items] : page.items : [];
  const unpaid = page?.unpaidBills.find(bill => bill.jobId === selected);
  const candidate = job?.handoffPreview?.eligibleForemen.find((person) => person.membershipId === recipient);
  const busy = [offer.state, withdraw.state].some((state) => state === "sending" || state === "checking");
  function confirm(kind: "offer" | "withdraw") {
    if (!job || busy || (kind === "offer" && (!candidate || (job.handoffPreview?.policy === "urgent" && !urgentCalled)))) return;
    const label = kind === "offer" ? t("mobile.provider.offer") : t("mobile.provider.withdrawOffer");
    confirmAction(router, { title: label, actionLabel: label, actionLabelKey: kind === "offer" ? "mobile.provider.offer" : "mobile.provider.withdrawOffer", item: `${job.title ?? job.reference} · ${job.reference}${candidate ? ` · ${candidate.displayName}` : ""}`, actor, role: t("mobile.provider.admin"), effects: [t("mobile.provider.offerEffect")], onReview: () => { void detail.refresh(); }, onConfirm: async () => {
      const result = kind === "offer" && candidate ? await offer.run({ params: { j: job.jobId }, body: { expectedRevision: job.revision, payload: { recipientMembershipId: candidate.membershipId, ...(job.handoffPreview?.reofferOfId ? { reofferOfId: job.handoffPreview.reofferOfId } : {}), ...(job.handoffPreview?.policy === "urgent" && urgentCalled ? { urgentCallConfirmed: true as const } : {}) } } }) : job.handoff ? await withdraw.run({ params: { j: job.jobId, h: job.handoff.handoffId }, body: { expectedRevision: job.revision, payload: {} } }) : null;
      if (result?.ok) { void detail.refresh(); void jobs.refresh(); return "confirmed"; }
      return result && "delivery" in result.error && result.error.delivery === "unknown" ? "uncertain" : "invalidated";
    } });
  }
  return <ProviderScreen title={t("mobile.provider.jobs")} business={page?.businessName}>
    <SegmentedControl label={t("mobile.provider.segment")} value={segment} onChange={(value) => { setSegment(value); setCursors([]); setSelected(null); }} options={[{ value: "needs_you", label: `${t("mobile.provider.needsYou")} ${page?.needsYouCount ?? ""}` }, { value: "active", label: `${t("mobile.provider.active")} ${page?.activeCount ?? ""}` }, { value: "past", label: `${t("mobile.provider.past")} ${page?.pastCount ?? ""}` }]} />
    <ReadState status={jobs.status} retry={() => { void jobs.refresh(); }} />
    {items.map((item) => <Card key={item.jobId}><BookingCard title={item.title ?? item.reference} place={`${item.reference} · ${item.place.alias}`} stage={labels.journey(item.journey.step, item.journey.cancelled)} next={item.accountableForeman ? t("mobile.provider.foreman", { name: item.accountableForeman.displayName }) : t("mobile.provider.noForeman")} accessibilityLabel={`${item.title ?? item.reference} · ${item.reference} · ${item.place.alias} · ${labels.journey(item.journey.step, item.journey.cancelled)}`} onPress={() => { setSelected(selected === item.jobId ? null : item.jobId); setRecipient(null); setUrgentCalled(false); }} />
      {selected === item.jobId && <><ReadState status={detail.status} retry={() => { void detail.refresh(); }} />{job && <>
        {job.handoff && <><Badge label={job.handoff.state === "expired" || job.handoff.state === "declined" ? t("mobile.provider.handoffStuck") : job.handoff.state === "accepted" ? t("mobile.provider.accepted") : job.handoff.state === "withdrawn" ? t("mobile.provider.withdrawn") : t("mobile.provider.offered")} tone={job.handoff.state === "expired" || job.handoff.state === "declined" ? "critical" : "neutral"} /><Copy>{t("mobile.provider.offeredTo", { name: job.handoff.to.displayName })}</Copy><Copy>{t("mobile.provider.replyBy", { time: format.siteTime(job.handoff.expiresAt, job.siteZone) })}</Copy></>}
        {job.commercialReview && <><Badge label={t("mobile.provider.review")} tone="attention" /><Copy>{t("mobile.provider.reviewVersion", { version: job.commercialReview.version, person: job.commercialReview.submitted.by ?? "", time: format.siteTime(job.commercialReview.submitted.at, job.siteZone) })}</Copy></>}
        {job.bill?.outcome.status === "paid" && <>
          <Copy>{t("mobile.provider.bill", { number: job.bill.number, amount: format.money(job.bill.total.minor, job.bill.total.currency) })}</Copy>
          <Copy>{t("mobile.provider.paid", { amount: format.money(job.bill.outcome.matched.minor, job.bill.outcome.matched.currency),
            person: job.bill.outcome.recorded.by ?? "", time: format.siteTime(job.bill.outcome.recorded.at, job.siteZone) })}</Copy>
        </>}
        {job.handoffPreview && <><Copy variant="label">{t("mobile.provider.selectForeman")}</Copy>{job.handoffPreview.eligibleForemen.map((person) => <Button key={person.membershipId} variant={recipient === person.membershipId ? "primary" : "neutral"} label={person.displayName} onPress={() => setRecipient(person.membershipId)} />)}<Copy>{t("mobile.provider.replyBy", { time: format.siteTime(job.handoffPreview.expiresAt, job.siteZone) })}</Copy><Copy>{t("mobile.provider.offerEffect")}</Copy>{job.handoffPreview.policy === "urgent" && <><Copy>{t("mobile.provider.urgentHelp")}</Copy><SwitchRow label={t("mobile.provider.urgentCall")} value={urgentCalled} onValueChange={setUrgentCalled} /></>}<Button label={t("mobile.provider.offer")} disabled={!candidate || busy || (job.handoffPreview.policy === "urgent" && !urgentCalled)} onPress={() => confirm("offer")} /></>}
        {job.canWithdrawHandoff && <Button label={t("mobile.provider.withdrawOffer")} variant="neutral" disabled={busy} onPress={() => confirm("withdraw")} />}
        {(offer.state === "checking" || withdraw.state === "checking") && <Copy>{t("mobile.provider.checking")}</Copy>}
      </>}</>}
      {selected === item.jobId && unpaid && <RecordPayment key={unpaid.billId} bill={unpaid} actor={actor} ready={jobs.status === "ready"}
        onChanged={() => { void jobs.refresh(); void detail.refresh(); }} />}
    </Card>)}
    {page && !items.length && <Copy>{t("mobile.provider.empty")}</Copy>}
    {cursors.length > 0 && <Button variant="quiet" label={t("mobile.provider.previous")} onPress={() => setCursors((v) => v.slice(0, -1))} />}
    {page?.page.hasMore && page.page.cursor && <Button variant="quiet" label={t("mobile.provider.next")} onPress={() => setCursors((v) => [...v, page.page.cursor!])} />}
  </ProviderScreen>;
}
