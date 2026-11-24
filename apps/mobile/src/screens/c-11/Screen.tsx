import { getJobBillRoute, type BillProjection } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { Linking, Share } from "react-native";
import { useRemote } from "../../api";
import { useApiAccess } from "../../api/provider";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { Badge, Button, Card, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { Stamp } from "../../ui/live";
import { ReadState, siteTime } from "../c-10/Screen";

type CustomerBill = Extract<BillProjection, { audience: "customer" }>;
export default function BillScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>(); const router = useRouter(); const { client, isOffline } = useApiAccess();
  const remote = useRemote(getJobBillRoute, { params: { j: jobId ?? "" } }, { enabled: !!jobId });
  const data = remote.status === "ready" && remote.data?.audience === "customer" ? remote.data : null;
  async function openBill() {
    if (!client || !jobId || isOffline()) return;
    const fresh = await client.request(getJobBillRoute, { params: { j: jobId } });
    if (fresh.ok && !isOffline() && fresh.data.audience === "customer") {
      const current = fresh.data.bill;
      if (current && current.id === data?.bill?.id && current.documentUrl) await Linking.openURL(current.documentUrl);
    }
  }
  async function shareReference() {
    if (!client || !jobId || isOffline()) return;
    const fresh = await client.request(getJobBillRoute, { params: { j: jobId } });
    if (fresh.ok && !isOffline() && fresh.data.audience === "customer") {
      const current = fresh.data.bill;
      if (current && current.id === data?.bill?.id && current.outcome.status === "due" && current.paymentInstructions) await Share.share({ message: current.paymentInstructions.reference });
    }
  }
  return <BillView data={data} status={remote.status} onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} onOpen={() => { void openBill(); }} onShare={() => { void shareReference(); }} onNavigate={(path) => router.push(path as Href)} />;
}
export function BillView({ data, status, onBack, onRetry, onOpen, onShare, onNavigate }: { data: CustomerBill | null; status: RemoteStatus; onBack: () => void; onRetry: () => void; onOpen: () => void; onShare: () => void; onNavigate: (path: string) => void }) {
  const t = useT(); const format = useFormat(); const read = status === "ready" ? data : null; const bill = read?.bill; const root = `/c/jobs/${read?.job.jobId ?? ""}`;
  const label = bill?.outcome.status === "paid" ? t("mobile.aftercare.paid") : bill?.outcome.status === "checking" ? t("mobile.aftercare.checkingTransfer") : t("mobile.aftercare.due");
  return <Screen title={t("mobile.aftercare.bill")} navigation={{ kind: "back", label: t("mobile.aftercare.back"), onPress: onBack }}><ReadState status={status} onRetry={onRetry} />
    {read && <><Copy variant="supporting">{read.job.reference} · {read.job.title} · {read.job.placeAlias}</Copy>{!bill ? <Card><Copy>{t("mobile.aftercare.noBill", { provider: read.job.providerDisplayName })}</Copy></Card> : <>
      <Card><Copy variant="label">{read.job.providerDisplayName}</Copy><Badge label={label} tone={bill.outcome.status === "paid" ? "success" : bill.outcome.status === "checking" ? "attention" : "neutral"} /><Copy variant="display">{format.money(bill.totalMinor, bill.currency)}</Copy><Copy>{bill.number}</Copy><Copy>{t("mobile.aftercare.billDates", { sent: siteTime(format, bill.issuedAt, read.job.siteZone), due: siteTime(format, bill.dueAt, read.job.siteZone) })}</Copy>{bill.matchesApprovedScope && <Copy>{t("mobile.aftercare.matches")}</Copy>}{bill.openCases.map(item => <Button key={item.id} variant="quiet" label={t("mobile.aftercare.caseOpen", { reference: item.reference })} onPress={() => onNavigate(`${root}/case/${item.id}`)} />)}</Card>
      <Card><Copy variant="sectionTitle">{t("mobile.aftercare.lines")}</Copy>{bill.lines.map(line => <Card key={line.lineNo}><Copy>{line.labelReading?.status === "ready" ? line.labelReading.text : line.originalLabel} · {format.money(line.netMinor + line.taxMinor, bill.currency)}</Copy>{line.labelReading?.status === "ready" && <><Copy variant="supporting">{t("mobile.aftercare.original", { language: line.originalLanguage })}</Copy><Copy>{line.originalLabel}</Copy></>}</Card>)}</Card>
      {bill.outcome.status === "due" && bill.paymentInstructions && <Card><Copy variant="sectionTitle">{t("mobile.aftercare.payDirect", { provider: read.job.providerDisplayName })}</Copy><Copy selectable>{bill.paymentInstructions.instructions.text}</Copy><Copy selectable>{t("mobile.aftercare.reference", { reference: bill.paymentInstructions.reference })}</Copy><Button variant="quiet" label={t("mobile.aftercare.shareReference")} onPress={onShare} /></Card>}{bill.outcome.status === "checking" && <Card><Copy>{t("mobile.aftercare.checkingTransfer")}</Copy></Card>}{bill.outcome.status === "paid" && <Card><Copy variant="sectionTitle">{t("mobile.aftercare.jobComplete")}</Copy><Copy>{t("mobile.aftercare.paid")}</Copy></Card>}
      {bill.outcome.status === "due" && bill.state === "issued" && !bill.paymentInstructions && !bill.activeDeferral && <Card>
        <Copy variant="sectionTitle">{t("mobile.aftercare.payDirect", { provider: read.job.providerDisplayName })}</Copy>
        <Copy>{t("mobile.aftercare.payUsingBill", { reference: bill.number })}</Copy>
      </Card>}
      <Copy variant="sectionTitle">{t("mobile.aftercare.paymentRecord")}</Copy>{bill.history.map(stamp => <Stamp key={stamp.id} kind="decision" title={stamp.kind === "matched" ? t("mobile.aftercare.paid") : stamp.kind === "no_funds_received" ? t("mobile.aftercare.noFunds") : stamp.kind === "refund_recorded" ? t("mobile.aftercare.refund") : t("mobile.aftercare.recordChecking")} time={siteTime(format, stamp.at, read.job.siteZone)} attribution={t("mobile.aftercare.admin", { name: stamp.actorDisplayName })} detail={"reason" in stamp ? stamp.reason ?? undefined : undefined} {...(stamp.kind === "matched" && stamp.corrected ? { state: "corrected" as const, stateLabel: t("mobile.aftercare.corrected") } : { state: "confirmed" as const })} />)}
      {bill.documentUrl && <Button label={t("mobile.aftercare.openBill")} onPress={onOpen} />}<Button variant="quiet" label={t("mobile.aftercare.askBill")} onPress={() => onNavigate(`${root}/case/new?category=bill&billId=${encodeURIComponent(bill.id)}`)} />
    </>}{read.priorBills.map(item => <Copy key={item.id}>{t("mobile.aftercare.replaced", { number: item.number })}</Copy>)}</>}
  </Screen>;
}
