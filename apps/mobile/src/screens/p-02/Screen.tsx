import { getJobRoute, getJobsRoute, idSchema, issueBillRoute, offerJobHandoffRoute, recordPaidRoute, withdrawJobHandoffRoute, type RouteResponse } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useCommand, useRemote } from "../../api";
import { useLocale, useT } from "../../i18n";
import { Badge, BookingCard, Button, Card, Dock, ListRow, SegmentedControl, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ProviderScreen, ReadState, useProvider, useProviderFormat as useFormat, useProviderLabels } from "../p-01/shared";
import { Journey } from "../c-01/common";
import { ChoiceRadio } from "../s-12/ChoiceRadio";
import { useOffline } from "../s-02/flow";
import { confirmAction } from "../s-17/confirmAction";
import { CommercialReview, type ReviewTarget } from "./Review";

type Segment = "needs_you" | "active" | "past";
type UnpaidBill = Extract<RouteResponse<typeof getJobsRoute.output>, { audience: "provider_admin" }>["unpaidBills"][number];
type ProviderJob = Extract<Extract<RouteResponse<typeof getJobRoute.output>, { audience: "provider_admin" }>["job"], { view: "whole" }>;

function IssueBill({ job, draft, actor, ready, onChanged }: {
  job: ProviderJob; draft: NonNullable<ProviderJob["readyBill"]>; actor: string; ready: boolean; onChanged: () => void;
}) {
  const router = useRouter(); const t = useT(); const format = useFormat(); const offline = useOffline(); const { locale } = useLocale();
  const issue = useCommand(issueBillRoute, { resourceId: job.jobId });
  const [number, setNumber] = useState(draft.number);
  const [document, setDocument] = useState("");
  const [instructions, setInstructions] = useState("");
  const [reference, setReference] = useState("");
  const busy = issue.state === "checking" || issue.state === "sending";
  const disabled = !ready || offline || busy;
  const billNumber = number.trim(), providerDocumentRef = document.trim(), paymentReference = reference.trim(), paymentText = instructions.trim();
  const canConfirm = !disabled && !!billNumber && idSchema.safeParse(providerDocumentRef).success && !!paymentReference && !!paymentText;
  const label = t("mobile.provider.issueBill");
  const item = t("mobile.provider.bill", { number: billNumber, amount: format.money(draft.total.minor, draft.total.currency) });
  function confirm() {
    if (!canConfirm) return;
    confirmAction(router, {
      title: label, actionLabel: label, actionLabelKey: "mobile.provider.issueBill",
      item: `${job.reference} · ${item}`, actor, role: t("mobile.provider.admin"),
      effects: [t("mobile.wrapUp.directBill")], onReview: onChanged,
      onConfirm: async () => {
        const result = await issue.run({ params: { j: job.jobId }, body: { expectedRevision: job.revision, payload: {
          id: uuid.v4(), replacesId: null, number: billNumber, currency: "EUR", providerDocumentRef, lines: draft.lines,
          paymentInstructions: { reference: paymentReference, instructions: { language: locale, text: paymentText } },
        } } });
        if (result.ok) { onChanged(); return "confirmed"; }
        return "delivery" in result.error && result.error.delivery === "unknown" ? "uncertain" : "invalidated";
      },
    });
  }
  return <Card>
    <Copy>{item}</Copy>
    {draft.lines.map((line, index) => <Copy key={index}>{line.originalLabel} · {format.money(line.netMinor + line.taxMinor, draft.total.currency)}</Copy>)}
    <TextField label={t("mobile.provider.billNumber")} value={number} onChangeText={setNumber} maxLength={500} disabled={disabled} autoCapitalize="none" />
    <TextField label={t("mobile.provider.billDocument")} value={document} onChangeText={setDocument} maxLength={256} disabled={disabled} autoCapitalize="none" />
    <TextField label={t("mobile.provider.paymentInstructions")} value={instructions} onChangeText={setInstructions} maxLength={4_000} disabled={disabled} multiline />
    <TextField label={t("mobile.provider.paymentReference")} value={reference} onChangeText={setReference} maxLength={500} disabled={disabled} autoCapitalize="none" />
    <Button label={label} onPress={confirm} disabled={!canConfirm} />
    {issue.state === "checking" && <Copy>{t("mobile.provider.checking")}</Copy>}
  </Card>;
}

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
  const params = useLocalSearchParams<{ jobId?: string; segment?: string; reviewKind?: string; reviewVersionId?: string; fromSwitch?: string }>();
  const router = useRouter();
  if (params.jobId && params.reviewVersionId && (params.reviewKind === "quote" || params.reviewKind === "change")) {
    return <CommercialReview key={`${params.jobId}:${params.reviewKind}:${params.reviewVersionId}`}
      target={{ jobId: params.jobId, kind: params.reviewKind, versionId: params.reviewVersionId }}
      onClose={() => router.canGoBack() ? router.back() : router.replace("/you")} onChanged={() => {}} />;
  }
  return <ProviderJobs jobId={params.jobId} initialSegment={params.segment} fromSwitch={params.fromSwitch === "1"} />;
}

function ProviderJobs({ jobId, initialSegment, fromSwitch }: { jobId?: string; initialSegment?: string; fromSwitch: boolean }) {
  const router = useRouter(); const t = useT(); const format = useFormat(); const labels = useProviderLabels(); const { actor } = useProvider();
  const [segment, setSegment] = useState<Segment>(initialSegment === "needs_you" ? "needs_you" : jobId ? "active" : "needs_you");
  const [selected, setSelected] = useState<string | null>(jobId ?? null); const [recipient, setRecipient] = useState<string | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const [review, setReview] = useState<ReviewTarget | null>(null);
  const reviewChanged = useRef(false);
  useEffect(() => {
    if (!jobId) return;
    setSegment(initialSegment === "needs_you" ? "needs_you" : "active");
    setSelected(jobId); setCursors([]); setRecipient(null);
  }, [jobId, initialSegment]);
  const jobs = useRemote(getJobsRoute, { query: { segment, ...(cursors.at(-1) ? { cursor: cursors.at(-1) } : {}) } });
  const detail = useRemote(getJobRoute, { params: { j: selected ?? "" }, query: { view: "whole" } }, { enabled: !!selected });
  useFocusEffect(useCallback(() => {
    if (!fromSwitch || selected !== jobId || detail.error?.code !== "NOT_FOUND") return;
    // This tab stays mounted when navigating to Now; do not reopen the denied record.
    setSelected(null);
    router.setParams({ jobId: undefined, fromSwitch: undefined });
    router.replace("/p/now");
  }, [detail.error?.code, fromSwitch, jobId, router, selected]));
  const offer = useCommand(offerJobHandoffRoute); const withdraw = useCommand(withdrawJobHandoffRoute);
  const page = jobs.data?.audience === "provider_admin" ? jobs.data : null;
  const job = detail.data?.audience === "provider_admin" && detail.data.job.view === "whole" ? detail.data.job : null;
  const items = page ? job && !page.items.some((item) => item.jobId === job.jobId) ? [job, ...page.items] : page.items : [];
  const unpaid = page?.unpaidBills.find(bill => bill.jobId === selected);
  const preview = job?.handoffPreview;
  const handoff = job?.handoff;
  const candidate = preview?.eligibleForemen.find((person) => person.membershipId === recipient);
  const deadlines = preview && job ? {
    standard: t("mobile.provider.standardReplyBy", { time: format.siteTime(preview.deadlines.standard, job.siteZone) }),
    urgent: t("mobile.provider.urgentReplyBy", { time: format.siteTime(preview.deadlines.urgent, job.siteZone) }),
  } : null;
  const canWithdraw = !!handoff && job?.canWithdrawHandoff;
  const busy = [offer.state, withdraw.state].some((state) => state === "sending" || state === "checking");
  function confirm(kind: "standard" | "urgent" | "withdraw") {
    if (!job || busy || (kind === "withdraw" ? !canWithdraw : !candidate || !deadlines)) return;
    const actionLabelKey = kind === "withdraw" ? "mobile.provider.withdrawOffer"
      : kind === "urgent" ? "mobile.provider.urgentCall" : "mobile.provider.offer";
    const label = kind === "withdraw" ? t("mobile.provider.withdrawOffer")
      : kind === "urgent" ? t("mobile.provider.urgentCall") : t("mobile.provider.offer");
    const effects = [t("mobile.provider.offerEffect")];
    if (kind !== "withdraw" && deadlines) effects.unshift(deadlines[kind]);
    if (kind === "urgent") effects.unshift(t("mobile.provider.urgentHelp"));
    confirmAction(router, { title: kind === "urgent" ? t("mobile.provider.urgentOffer") : label,
      actionLabel: label, actionLabelKey, item: `${job.title ?? job.reference} · ${job.reference}${candidate ? ` · ${candidate.displayName}` : ""}`,
      actor, role: t("mobile.provider.admin"), effects, onReview: () => { void detail.refresh(); }, onConfirm: async () => {
      const result = kind !== "withdraw" && candidate && preview ? await offer.run({ params: { j: job.jobId }, body: {
        expectedRevision: job.revision, payload: {
          recipientMembershipId: candidate.membershipId,
          ...(preview.reofferOfId ? { reofferOfId: preview.reofferOfId } : {}),
          ...(kind === "urgent" ? { urgentCallConfirmed: true as const } : {}),
        },
      } }) : kind === "withdraw" && handoff ? await withdraw.run({ params: { j: job.jobId, h: handoff.handoffId },
        body: { expectedRevision: job.revision, payload: {} } }) : null;
      if (result?.ok) {
        setRecipient(null);
        void detail.refresh();
        void jobs.refresh();
        return "confirmed";
      }
      return result && "delivery" in result.error && result.error.delivery === "unknown" ? "uncertain" : "invalidated";
    } });
  }
  if (review) return <CommercialReview target={review} onChanged={() => { reviewChanged.current = true; }} onClose={() => {
    setReview(null);
    if (reviewChanged.current) {
      reviewChanged.current = false;
      void detail.refresh();
    }
  }} />;
  const handoffAction = canWithdraw ? { label: t("mobile.provider.withdrawOffer"), disabled: busy, onPress: () => confirm("withdraw") }
    : preview ? {
      label: candidate ? t("mobile.provider.offerTo", { name: candidate.displayName }) : t("mobile.provider.offer"),
      disabled: !candidate || busy, onPress: () => confirm("standard"),
    } : null;
  return <ProviderScreen title={t("mobile.provider.jobs")} business={page?.businessName}
    dock={handoffAction ? <Dock context={t("mobile.provider.offerEffect")} primary={handoffAction}
      secondary={!canWithdraw && preview ? {
        label: t("mobile.provider.urgentOffer"), disabled: !candidate || busy, onPress: () => confirm("urgent"),
      } : undefined} /> : undefined}>
    <SegmentedControl label={t("mobile.provider.segment")} value={segment} onChange={(value) => { setSegment(value); setCursors([]); setSelected(null); }} options={[{ value: "needs_you", label: `${t("mobile.provider.needsYou")} ${page?.needsYouCount ?? ""}` }, { value: "active", label: `${t("mobile.provider.active")} ${page?.activeCount ?? ""}` }, { value: "past", label: `${t("mobile.provider.past")} ${page?.pastCount ?? ""}` }]} />
    <ReadState status={jobs.status} retry={() => { void jobs.refresh(); }} />
    {items.map((item) => {
      const title = item.title ?? item.reference;
      const place = `${item.reference} · ${item.place.alias}`;
      const stage = labels.journey(item.journey.step, item.journey.cancelled);
      const foreman = item.accountableForeman ? t("mobile.provider.foreman", { name: item.accountableForeman.displayName }) : t("mobile.provider.noForeman");
      const chosen = selected === item.jobId;
      const booking = <BookingCard title={title} place={place} stage={stage} next={foreman}
        progress={<Journey journey={item.journey} />} accessibilityLabel={[title, place, stage, foreman].join(" · ")}
        onPress={() => { setSelected(chosen ? null : item.jobId); setRecipient(null); }} />;
      if (!chosen && !item.readyToBill) return <Fragment key={item.jobId}>{booking}</Fragment>;
      return <Card dense key={item.jobId}>{booking}
      {item.readyToBill && <Badge label={t("mobile.provider.readyToBill")} tone="neutral" />}
      {selected === item.jobId && <><ReadState status={detail.status} retry={() => { void detail.refresh(); }} />{job && <>
        {job.handoff && <><Badge label={job.handoff.state === "expired" || job.handoff.state === "declined" ? t("mobile.provider.handoffStuck") : job.handoff.state === "accepted" ? t("mobile.provider.accepted") : job.handoff.state === "withdrawn" ? t("mobile.provider.withdrawn") : t("mobile.provider.offered")} tone={job.handoff.state === "expired" || job.handoff.state === "declined" ? "critical" : "neutral"} /><Copy>{t("mobile.provider.offeredTo", { name: job.handoff.to.displayName })}</Copy><Copy>{t("mobile.provider.replyBy", { time: format.siteTime(job.handoff.expiresAt, job.siteZone) })}</Copy></>}
        {job.commercialReview && <ListRow label={t("mobile.provider.review")} description={t("mobile.provider.reviewVersion", {
          version: job.commercialReview.version, person: job.commercialReview.submitted.by ?? "", time: format.siteTime(job.commercialReview.submitted.at, job.siteZone),
        })} onPress={() => {
          const record = job.commercialReview;
          if (record) setReview({ jobId: job.jobId, kind: record.kind, versionId: record.versionId });
        }} />}
        {job.readyBill && <IssueBill key={job.jobId} job={job} draft={job.readyBill} actor={actor} ready={detail.status === "ready"}
          onChanged={() => { void jobs.refresh(); void detail.refresh(); }} />}
        {job.bill?.outcome.status === "paid" && <>
          <Copy>{t("mobile.provider.bill", { number: job.bill.number, amount: format.money(job.bill.total.minor, job.bill.total.currency) })}</Copy>
          <Copy>{t("mobile.provider.paid", { amount: format.money(job.bill.outcome.matched.minor, job.bill.outcome.matched.currency),
            person: job.bill.outcome.recorded.by ?? "", time: format.siteTime(job.bill.outcome.recorded.at, job.siteZone) })}</Copy>
        </>}
        {preview && deadlines && <>
          <Copy variant="label">{t("mobile.provider.selectForeman")}</Copy>
          {preview.eligibleForemen.map((person) => <ChoiceRadio key={person.membershipId} selected={recipient === person.membershipId} label={person.displayName} onPress={() => setRecipient(person.membershipId)} />)}
          <Copy variant="supporting">{deadlines.standard}</Copy>
          <Copy variant="supporting">{deadlines.urgent}</Copy>
        </>}
        {(offer.state === "checking" || withdraw.state === "checking") && <Copy>{t("mobile.provider.checking")}</Copy>}
      </>}</>}
      {selected === item.jobId && unpaid && <RecordPayment key={unpaid.billId} bill={unpaid} actor={actor} ready={jobs.status === "ready"}
        onChanged={() => { void jobs.refresh(); void detail.refresh(); }} />}
    </Card>; })}
    {page && !items.length && <Copy>{t("mobile.provider.empty")}</Copy>}
    {cursors.length > 0 && <Button variant="quiet" label={t("mobile.provider.previous")} onPress={() => setCursors((v) => v.slice(0, -1))} />}
    {page?.page.hasMore && page.page.cursor && <Button variant="quiet" label={t("mobile.provider.next")} onPress={() => setCursors((v) => [...v, page.page.cursor!])} />}
  </ProviderScreen>;
}
