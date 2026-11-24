import { getQuoteVersionRoute, type QuoteVersion } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useRemote } from "../../api";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { Badge, Button, Card, Dock, Screen, TwinCard } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useApprovalState } from "./approvalState";

export type CustomerQuote = Extract<QuoteVersion, { audience: "customer" }>;
type T = ReturnType<typeof useT>;
export function time(format: ReturnType<typeof useFormat>, at: number, zone: string) { const result = format.siteTime(at, zone); return result.kind === "available" ? result.siteTime : zone; }
export function statusLabel(t: T, state: string) {
  if (state === "superseded") return t("mobile.customerQuote.superseded");
  if (state === "expired") return t("mobile.customerQuote.expired");
  if (state === "approved") return t("mobile.customerQuote.approved");
  if (state === "declined" || state === "rejected") return t("mobile.customerQuote.declined");
  return t("mobile.customerQuote.current");
}
export function ScopeTwin({ original, originalLocale, translation, translationLocale, status, title }: { original: string; originalLocale: string; translation?: string; translationLocale?: string; status: string; title: string }) {
  const t = useT();
  const source = { text: original, label: t("mobile.customerQuote.original", { language: originalLocale }), direction: "ltr" as const };
  if (status === "ready" && translation && translationLocale) return <TwinCard title={title} state="translated" original={source} translation={{ text: translation, label: t("mobile.customerQuote.translation", { language: translationLocale }) }} />;
  if (status === "pending" || status === "unavailable") return <TwinCard title={title} state={status} original={source} status={status === "pending" ? t("mobile.customerQuote.pending") : t("mobile.customerQuote.unavailable")} />;
  return <TwinCard title={title} state="original" original={source} />;
}
export default function QuoteScreen() {
  const { jobId, versionId } = useLocalSearchParams<{ jobId: string; versionId: string }>();
  const approvalState = useApprovalState(jobId ?? "", versionId ?? "");
  const remote = useRemote(getQuoteVersionRoute, { params: { j: jobId ?? "", id: versionId ?? "" } }, { enabled: !!jobId && !!versionId });
  const router = useRouter();
  const data = remote.data?.audience === "customer" ? remote.data : null;
  return <QuoteView data={data} status={remote.status} checking={approvalState === "checking"} onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} onOpen={(id) => router.push(`/c/jobs/${jobId}/quote/${id}` as Href)} onReview={() => router.push(`/c/jobs/${jobId}/quote/${versionId}/approve` as Href)} />;
}
export function QuoteView({ data, status, checking = false, onBack, onRetry, onOpen, onReview }: { data: CustomerQuote | null; status: RemoteStatus; checking?: boolean; onBack: () => void; onRetry: () => void; onOpen: (id: string) => void; onReview: () => void }) {
  const t = useT(); const format = useFormat();
  const readable = status === "ready" ? data : null;
  const active = readable?.state === "issued";
  const dock = readable && (readable.replacedBy ? <Dock primary={{ label: t("mobile.customerQuote.viewCurrent"), onPress: () => onOpen(readable.replacedBy!.id) }} /> : active ? <Dock context={checking ? t("mobile.customerQuote.checking") : !readable.viewerIsNamedApprover ? t("mobile.customerQuote.onlyApprover", { name: readable.job.namedApproverDisplayName }) : undefined} primary={{ label: readable.viewerIsNamedApprover ? t("mobile.customerQuote.review") : t("mobile.customerQuote.who"), onPress: onReview, disabled: checking }} /> : undefined);
  return <Screen title={t("mobile.customerQuote.title")} navigation={{ kind: "back", label: t("mobile.customerQuote.back"), onPress: onBack }} dock={dock}>
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.customerQuote.loading")}</Copy>}
    {status === "offline" && <Copy>{t("mobile.customerQuote.offline")}</Copy>}
    {status === "error" && <><Copy>{t("mobile.customerQuote.error")}</Copy><Button label={t("mobile.customerQuote.retry")} onPress={onRetry} /></>}
    {readable && <>
      <Copy variant="supporting">{readable.job.reference} · {readable.job.jobTitle} · {readable.job.placeAlias}</Copy>
      {readable.replacedBy && <Copy>{t("mobile.customerQuote.replaced", { number: readable.replacedBy.no })}</Copy>}
      <Card><Copy variant="sectionTitle">{readable.job.providerDisplayName}</Copy><Badge label={t("mobile.customerQuote.version", { number: readable.no, status: statusLabel(t, readable.state) })} tone={readable.state === "approved" ? "success" : "neutral"} /><Copy>{readable.state === "superseded" ? t("mobile.customerQuote.wasTotal") : t("mobile.customerQuote.total")}</Copy><Copy variant="sectionTitle">{format.money(readable.totalMinor, readable.currency)}</Copy><Copy variant="supporting">{t("mobile.customerQuote.sent", { name: readable.publisherDisplayName, time: time(format, readable.issuedAt, readable.job.siteZone) })}</Copy><Copy variant="supporting">{t("mobile.customerQuote.validUntil", { time: time(format, readable.expiresAt, readable.job.siteZone) })}</Copy>{readable.decision && <Copy>{t("mobile.customerQuote.decision", { status: statusLabel(t, readable.state), name: readable.decision.actorDisplayName, time: time(format, readable.decision.at, readable.job.siteZone) })}</Copy>}</Card>
      <Card><Copy variant="sectionTitle">{t("mobile.customerQuote.items")}</Copy>{readable.items.map(item => { const translated = readable.readingAid.status === "ready" ? readable.readingAid.items.find(x => x.lineNo === item.lineNo)?.label : undefined; return <Copy key={item.lineNo}>{translated ? `${translated}\n${item.originalLabel}` : item.originalLabel} · {format.money(item.netMinor + item.taxMinor, readable.currency)}</Copy>; })}</Card>
      <ScopeTwin title={t("mobile.customerQuote.scope")} original={readable.scope} originalLocale={readable.originalLocale} status={readable.readingAid.status} translation={readable.readingAid.status === "ready" ? readable.readingAid.scope : undefined} translationLocale={readable.readingAid.status === "ready" ? readable.readingAid.locale : undefined} />
      {!!readable.exclusions && <ScopeTwin title={t("mobile.customerQuote.exclusions")} original={readable.exclusions} originalLocale={readable.originalLocale} status={readable.readingAid.status} translation={readable.readingAid.status === "ready" ? readable.readingAid.exclusions : undefined} translationLocale={readable.readingAid.status === "ready" ? readable.readingAid.locale : undefined} />}
      <Card><Copy variant="sectionTitle">{t("mobile.customerQuote.terms")}</Copy><Copy>{readable.terms.originalText}</Copy></Card>
    </>}
  </Screen>;
}
