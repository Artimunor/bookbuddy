import { getJobBillRoute, type BillProjection } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { Linking, Share, View } from "react-native";
import { useRemote } from "../../api";
import { useApiAccess } from "../../api/provider";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { Badge, Button, Card, Dock, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { Stamp } from "../../ui/live";
import { useBeaconTheme } from "../../ui/theme";
import { readingLanguageLabel } from "../s-12/language";
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
  const t = useT(); const format = useFormat(); const { color, space } = useBeaconTheme();
  const read = status === "ready" ? data : null; const bill = read?.bill; const root = `/c/jobs/${read?.job.jobId ?? ""}`;
  const label = bill?.outcome.status === "paid" ? t("mobile.aftercare.paid") : bill?.outcome.status === "checking" ? t("mobile.aftercare.recordChecking") : bill?.activeDeferral ? t("mobile.aftercare.due") : t("mobile.aftercare.billDue");
  const dock = bill?.documentUrl ? <Dock primary={{ label: t("mobile.aftercare.openBill"), glyph: "≋", onPress: onOpen }} /> : undefined;
  return <Screen title={t("mobile.aftercare.bill")} subtitle={read ? [read.job.reference, read.job.title, read.job.placeAlias].filter(Boolean).join(" · ") : undefined} navigation={{ kind: "back", label: t("mobile.aftercare.back"), onPress: onBack }} dock={dock}>
    <ReadState status={status} onRetry={onRetry} />
    {read && <>{!bill ? <Card><Copy>{t("mobile.aftercare.noBill", { provider: read.job.providerDisplayName })}</Copy></Card> : <>
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.grid[2], alignItems: "center", justifyContent: "space-between" }}>
          <Copy variant="supporting">{read.job.providerDisplayName}</Copy>
          <Badge label={label} tone={bill.outcome.status === "paid" ? "success" : "attention"} glyph={bill.outcome.status === "paid" ? "✓" : "◷"} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.grid[2], alignItems: "baseline", justifyContent: "space-between" }}>
          <Copy variant="display" style={{ fontVariant: ["tabular-nums"] }}>{format.money(bill.totalMinor, bill.currency)}</Copy>
          <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.customerQuote.total")}</Copy>
        </View>
        <Copy variant="label">{bill.number}</Copy>
        <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.aftercare.billDates", { sent: format.lines(bill.issuedAt, read.job.siteZone)?.site ?? "", due: format.lines(bill.dueAt, read.job.siteZone)?.site ?? "" })}</Copy>
        {bill.matchesApprovedScope && <Copy variant="supporting" style={{ color: color.successInk }}>✓ {t("mobile.aftercare.matches")}</Copy>}
        {bill.openCases.map(item => <Button key={item.id} variant="quiet" label={t("mobile.aftercare.caseOpen", { reference: item.reference })} onPress={() => onNavigate(`${root}/case/${item.id}`)} />)}
        <Copy variant="label" accessibilityRole="header">{t("mobile.aftercare.lines")}</Copy>
        {bill.lines.map(line => <View key={line.lineNo} style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: space.grid[3], borderTopWidth: 1, borderTopColor: color.separator, paddingTop: space.grid[3] }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Copy>{line.labelReading?.status === "ready" ? line.labelReading.text : line.originalLabel}</Copy>
            {line.labelReading?.status === "ready" && <Copy variant="supporting" style={{ color: color.muted }} accessibilityLabel={`${t("mobile.aftercare.original", { language: readingLanguageLabel(t, line.originalLanguage) })}: ${line.originalLabel}`}>{line.originalLabel}</Copy>}
          </View>
          <Copy variant="label" style={{ fontVariant: ["tabular-nums"] }}>{format.money(line.netMinor + line.taxMinor, bill.currency)}</Copy>
        </View>)}
      </Card>
      {bill.outcome.status === "due" && bill.paymentInstructions && <Card>
        <View><Copy variant="label">{t("mobile.aftercare.payDirect", { provider: read.job.providerDisplayName })}</Copy><Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.aftercare.noInAppPayment")}</Copy></View>
        <Copy selectable>{bill.paymentInstructions.instructions.text}</Copy>
        <Copy selectable>{t("mobile.aftercare.reference", { reference: bill.paymentInstructions.reference })}</Copy>
        <Button variant="quiet" label={t("mobile.aftercare.shareReference")} onPress={onShare} />
      </Card>}
      {bill.outcome.status === "checking" && <Card><Copy>{t("mobile.aftercare.checkingTransfer")}</Copy></Card>}
      {bill.outcome.status === "paid" && <Card><Copy variant="sectionTitle">{t("mobile.aftercare.jobComplete")}</Copy><Copy>{t("mobile.aftercare.paid")}</Copy></Card>}
      {bill.outcome.status === "due" && bill.state === "issued" && !bill.paymentInstructions && !bill.activeDeferral && <Card>
        <View><Copy variant="label">{t("mobile.aftercare.payDirect", { provider: read.job.providerDisplayName })}</Copy><Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.aftercare.noInAppPayment")}</Copy></View>
        <Copy>{t("mobile.aftercare.payUsingBill", { reference: bill.number })}</Copy>
      </Card>}
      <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.aftercare.paymentRecord")}</Copy>
      {!bill.history.length && bill.outcome.status === "due" && <Card><Copy variant="label">{t("mobile.aftercare.due")}</Copy></Card>}
      {bill.history.map(stamp => <Stamp key={stamp.id} kind="decision" title={stamp.kind === "matched" ? t("mobile.aftercare.paid") : stamp.kind === "no_funds_received" ? t("mobile.aftercare.noFunds") : stamp.kind === "refund_recorded" ? t("mobile.aftercare.refund") : t("mobile.aftercare.recordChecking")} time={siteTime(format, stamp.at, read.job.siteZone)} attribution={t("mobile.aftercare.admin", { name: stamp.actorDisplayName })} detail={"reason" in stamp ? stamp.reason ?? undefined : undefined} {...(stamp.kind === "matched" && stamp.corrected ? { state: "corrected" as const, stateLabel: t("mobile.aftercare.corrected") } : { state: "confirmed" as const })} />)}
      <Button variant="quiet" label={t("mobile.aftercare.askBill")} onPress={() => onNavigate(`${root}/case/new?category=bill&billId=${encodeURIComponent(bill.id)}`)} />
    </>}{read.priorBills.map(item => <Copy key={item.id}>{t("mobile.aftercare.replaced", { number: item.number })}</Copy>)}</>}
  </Screen>;
}
