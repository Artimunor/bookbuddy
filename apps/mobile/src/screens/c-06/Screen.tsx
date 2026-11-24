import { approveQuoteVersionRoute, declineQuoteVersionRoute, getQuoteVersionRoute, listQuoteVersionsRoute, type QuoteVersion } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { commandIntentKey, useCommandStatus, useRemote } from "../../api";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { useMediaReadBatch } from "../../media/read-batch";
import { useOpenMediaPreview } from "../../media/read";
import { Badge, Button, Card, Dock, ListRow, Screen, Sheet, Thumb, TwinCard } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { readingLanguageLabel } from "../s-12/language";

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
  const source = { text: original, label: t("mobile.customerQuote.original", { language: readingLanguageLabel(t, originalLocale) }), direction: originalLocale === "ar" ? "rtl" as const : "ltr" as const };
  if (status === "ready" && translation && translationLocale) return <TwinCard title={title} state="translated" original={source} translation={{ text: translation, label: t("mobile.customerQuote.translation", { language: readingLanguageLabel(t, translationLocale) }), direction: translationLocale === "ar" ? "rtl" : "ltr" }} />;
  if (status === "pending" || status === "unavailable") return <TwinCard title={title} state={status} original={source} status={status === "pending" ? t("mobile.customerQuote.pending") : t("mobile.customerQuote.unavailable")} />;
  return <TwinCard title={title} state="original" original={source} />;
}
export default function QuoteScreen() {
  const { jobId, versionId } = useLocalSearchParams<{ jobId: string; versionId: string }>();
  const approval = useCommandStatus(versionId ? commandIntentKey(approveQuoteVersionRoute, versionId) : null);
  const decline = useCommandStatus(versionId ? commandIntentKey(declineQuoteVersionRoute, versionId) : null);
  const [showHistory, setShowHistory] = useState(false);
  const remote = useRemote(getQuoteVersionRoute, { params: { j: jobId ?? "", id: versionId ?? "" } }, { enabled: !!jobId && !!versionId });
  const router = useRouter();
  const data = remote.data?.audience === "customer" ? remote.data : null;
  const evidence = remote.status === "ready" ? data?.evidence ?? [] : [];
  const evidenceScope = data ? { caller: "quote" as const, parentScopeId: data.id } : null;
  const evidenceUrls = useMediaReadBatch(evidence.map(item => item.attachmentId), evidenceScope);
  const openEvidence = useOpenMediaPreview();
  const open = (id: string) => router.push(`/c/jobs/${jobId}/quote/${id}` as Href);
  return <>
    <QuoteView data={data} status={remote.status} checking={approval !== "idle" || decline !== "idle"} onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} onOpen={open} onReview={() => router.push(`/c/jobs/${jobId}/quote/${versionId}/approve` as Href)} onHistory={() => setShowHistory(true)}
      photos={evidence.flatMap(({ attachmentId }) => {
        const uri = evidenceUrls.get(attachmentId);
        return uri && evidenceScope ? [{ id: attachmentId, uri, open: () => openEvidence(attachmentId, evidenceScope) }] : [];
      })} />
    {showHistory && jobId && versionId && <QuoteVersionHistory jobId={jobId} versionId={versionId} onClose={() => setShowHistory(false)} onOpen={id => { setShowHistory(false); open(id); }} />}
  </>;
}
export function QuoteView({ data, status, checking = false, onBack, onRetry, onOpen, onReview, onHistory, photos }: { data: CustomerQuote | null; status: RemoteStatus; checking?: boolean; onBack: () => void; onRetry: () => void; onOpen: (id: string) => void; onReview: () => void; onHistory?: () => void; photos?: readonly { id: string; uri: string; open: () => void }[] }) {
  const t = useT(); const format = useFormat(); const { color, space } = useBeaconTheme();
  const readable = status === "ready" ? data : null;
  const active = readable?.state === "issued";
  const dock = readable && (readable.replacedBy ? <Dock primary={{ label: t("mobile.customerQuote.viewCurrent"), onPress: () => onOpen(readable.replacedBy!.id) }} /> : active ? <Dock context={!readable.viewerIsNamedApprover ? t("mobile.customerQuote.onlyApprover", { name: readable.job.namedApproverDisplayName }) : undefined} primary={{ label: readable.viewerIsNamedApprover ? t("mobile.customerQuote.review") : t("mobile.customerQuote.who"), onPress: onReview, disabled: checking }} /> : undefined);
  return <Screen title={t("mobile.customerQuote.title")} subtitle={readable ? [readable.job.reference, readable.job.jobTitle, readable.job.placeAlias].filter(Boolean).join(" · ") : undefined} navigation={{ kind: "back", label: t("mobile.customerQuote.back"), onPress: onBack }} dock={dock}>
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.customerQuote.loading")}</Copy>}
    {status === "offline" && <Copy>{t("mobile.customerQuote.offline")}</Copy>}
    {status === "error" && <><Copy>{t("mobile.customerQuote.error")}</Copy><Button label={t("mobile.customerQuote.retry")} onPress={onRetry} /></>}
    {checking && <Copy variant="supporting" accessibilityLiveRegion="polite">{t("mobile.customerQuote.checking")}</Copy>}
    {readable && <>
      {readable.replacedBy && <Copy>{t("mobile.customerQuote.replaced", { number: readable.replacedBy.no })}</Copy>}
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.grid[2] }}>
          <Copy variant="supporting">{readable.job.providerDisplayName}</Copy>
          <Badge label={t("mobile.customerQuote.version", { number: readable.no, status: statusLabel(t, readable.state) })}
            tone={readable.state === "approved" ? "success" : active ? "info" : "neutral"} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: space.grid[2] }}>
          <Copy variant="pageTitle" style={{ fontVariant: ["tabular-nums"] }}>{format.money(readable.totalMinor, readable.currency)}</Copy>
          <Copy variant="supporting" style={{ color: color.muted }}>{readable.state === "superseded" ? t("mobile.customerQuote.wasTotal") : t("mobile.customerQuote.total")}</Copy>
        </View>
        <View>
          <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.customerQuote.sent", { name: readable.publisherDisplayName, time: format.lines(readable.issuedAt, readable.job.siteZone)?.site ?? readable.job.siteZone })}</Copy>
          <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.customerQuote.validUntil", { time: format.lines(readable.expiresAt, readable.job.siteZone)?.site ?? readable.job.siteZone })}</Copy>
        </View>
        {readable.decision && <Copy>{t("mobile.customerQuote.decision", { status: statusLabel(t, readable.state), name: readable.decision.actorDisplayName, time: time(format, readable.decision.at, readable.job.siteZone) })}</Copy>}
      </Card>
      <Card>
        <Copy variant="label" accessibilityRole="header">{t("mobile.customerQuote.items")}</Copy>
        {readable.items.map((item, index) => {
          const translated = readable.readingAid.status === "ready" ? readable.readingAid.items.find(x => x.lineNo === item.lineNo)?.label : undefined;
          return <View key={item.lineNo} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.grid[3], borderTopWidth: index ? 1 : 0, borderTopColor: color.separator, paddingTop: index ? space.grid[3] : 0 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Copy>{translated ?? item.originalLabel}</Copy>
              {translated && <Copy variant="supporting" style={{ color: color.muted }}>{item.originalLabel}</Copy>}
            </View>
            <Copy variant="label" style={{ fontVariant: ["tabular-nums"] }}>{format.money(item.netMinor + item.taxMinor, readable.currency)}</Copy>
          </View>;
        })}
      </Card>
      <ScopeTwin title={t("mobile.customerQuote.scope")} original={readable.scope} originalLocale={readable.originalLocale} status={readable.readingAid.status} translation={readable.readingAid.status === "ready" ? readable.readingAid.scope : undefined} translationLocale={readable.readingAid.status === "ready" ? readable.readingAid.locale : undefined} />
      {!!readable.exclusions && <ScopeTwin title={t("mobile.customerQuote.exclusions")} original={readable.exclusions} originalLocale={readable.originalLocale} status={readable.readingAid.status} translation={readable.readingAid.status === "ready" ? readable.readingAid.exclusions : undefined} translationLocale={readable.readingAid.status === "ready" ? readable.readingAid.locale : undefined} />}
      {!!photos?.length && <Card><Copy variant="label" accessibilityRole="header">{t("mobile.foremanQuote.attachments")}</Copy>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.grid[3] }}>
          {photos.map(photo => <Thumb key={photo.id} uri={photo.uri} label={t("mobile.aftercare.photo")} onPress={photo.open} />)}
        </View>
      </Card>}
      <Card><Copy variant="sectionTitle">{t("mobile.customerQuote.terms")}</Copy><Copy>{readable.terms.originalText}</Copy></Card>
      {onHistory && <Button variant="quiet" label={t("mobile.customerQuote.history")} onPress={onHistory} />}
    </>}
  </Screen>;
}

function QuoteVersionHistory({ jobId, versionId, onClose, onOpen }: { jobId: string; versionId: string; onClose: () => void; onOpen: (id: string) => void }) {
  const t = useT(); const format = useFormat();
  const [cursors, setCursors] = useState<string[]>([]);
  const remote = useRemote(listQuoteVersionsRoute, { params: { j: jobId }, query: { cursor: cursors.at(-1) } });
  const history = remote.data?.audience === "customer" ? remote.data : null;
  const currentApproved = history?.currentApprovedVersionId;
  const earlier = history?.hasMore ? history.cursor : null;
  return <Sheet visible title={t("mobile.customerQuote.history")} closeLabel={t("shared.action.close")} onClose={onClose}>
    {history ? <>
      {currentApproved && currentApproved !== versionId && <Button variant="quiet" label={t("mobile.customerQuote.viewApproved")} onPress={() => onOpen(currentApproved)} />}
      {history.versions.map(row => <ListRow key={row.id}
        label={t("mobile.customerQuote.version", { number: row.no, status: row.id === currentApproved ? t("mobile.customerQuote.currentApproved") : statusLabel(t, row.state) })}
        description={format.money(row.totalMinor, row.currency)}
        trailing={row.id === versionId ? <Copy variant="supporting" aria-hidden>●</Copy> : undefined} onPress={row.id === versionId ? undefined : () => onOpen(row.id)} />)}
    </> : remote.status === "offline" ? <Copy>{t("mobile.customerQuote.offline")}</Copy> :
      remote.status === "error" ? <><Copy>{t("mobile.customerQuote.error")}</Copy><Button variant="quiet" label={t("shared.action.retry")} onPress={() => { void remote.refresh(); }} /></> :
      <Copy>{t("mobile.customerQuote.loading")}</Copy>}
    {cursors.length > 0 && <Button variant="quiet" label={t("mobile.places.previousPage")} onPress={() => setCursors(cursors.slice(0, -1))} />}
    {earlier && <Button variant="quiet" label={t("mobile.jobHome.earlier")} onPress={() => setCursors([...cursors, earlier])} />}
  </Sheet>;
}
