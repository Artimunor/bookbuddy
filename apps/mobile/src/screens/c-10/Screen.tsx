import { getJobCompletionRoute, idSchemaFor, signOffCompletionRoute, type CompletionProjection } from "@bookbuddy/api-contract";
import type { SiteDateTime } from "@bookbuddy/domain";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { useMediaReadBatch } from "../../media/read-batch";
import { useOpenMediaPreview } from "../../media/read";
import { Badge, Button, Card, Dock, Screen, Thumb, TwinCard } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { readingLanguageLabel } from "../s-12/language";
import { confirmAction } from "../s-17/confirmAction";

type Completion = Extract<CompletionProjection, { audience: "customer" }>;
type Authored = Completion["approvedScope"]["scope"];
export function AuthoredText({ value }: { value: Authored }) {
  const t = useT();
  return <>{value.reading?.status === "ready" && <Copy>{value.reading.text}</Copy>}<Copy variant="supporting">{t("mobile.aftercare.original", { language: readingLanguageLabel(t, value.original.language) })}</Copy><Copy>{value.original.text}</Copy></>;
}
export function siteTime(format: { siteTime: (at: number, zone: string) => SiteDateTime }, at: number, zone: string) {
  const result = format.siteTime(at, zone); return result.kind === "available" ? `${result.siteTime} · ${result.site.zoneName ?? zone}` : zone;
}
export function ReadState({ status, onRetry }: { status: RemoteStatus; onRetry: () => void }) {
  const t = useT();
  if (status === "idle" || status === "loading") return <Copy>{t("mobile.aftercare.loading")}</Copy>;
  if (status === "offline") return <Copy>{t("mobile.aftercare.offline")}</Copy>;
  if (status === "error") return <><Copy>{t("mobile.aftercare.unavailable")}</Copy><Button label={t("mobile.aftercare.retry")} onPress={onRetry} /></>;
  return null;
}
export default function CompletionScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>(); const router = useRouter(); const t = useT(); const { preferences } = useSession();
  const remote = useRemote(getJobCompletionRoute, { params: { j: jobId ?? "" } }, { enabled: !!jobId });
  const command = useCommand(signOffCompletionRoute);
  const read = remote.status === "ready" && remote.data?.audience === "customer" ? remote.data : null;
  const data = read && command.result?.signOff?.completionId === read.submission?.id ? command.result : read;
  function sign() {
    if (!read?.submission || !read.actions.signOff || command.state === "checking" || command.state === "sending") return;
    const submission = read.submission;
    confirmAction(router, { title: t("mobile.aftercare.sign"), actionLabel: t("mobile.aftercare.sign"), actionLabelKey: "mobile.aftercare.sign", item: `${read.job.reference} · ${read.job.title ?? read.job.reference} · v${read.approvedScope.version}`, actor: read.namedApproverDisplayName, role: read.job.placeAlias, effects: [t("mobile.aftercare.signEffect")], onReview: () => { void remote.refresh(); }, onConfirm: async () => {
      const result = await command.run({ params: { id: submission.id }, body: { payload: { id: idSchemaFor<"sign_off">().parse(uuid.v4()), termsHash: read.approvedScope.termsHash } } });
      if (result.ok) { void remote.refresh(); return "confirmed"; }
      void remote.refresh(); return "delivery" in result.error && result.error.delivery === "unknown" ? "uncertain" : "invalidated";
    } });
  }
  return <CompletionView data={data} status={remote.status} twoClock={preferences?.twoClock ?? false} busy={command.state === "sending" || command.state === "checking"} checking={command.state === "checking"} onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} onSign={sign} onNavigate={(path) => router.push(path as Href)} evidence={RoutedCompletionEvidence} />;
}
export function CompletionView({ data, status, busy = false, checking = false, twoClock = false, onBack, onRetry, onSign, onNavigate, evidence: Evidence = CompletionEvidence }: { data: Completion | null; status: RemoteStatus; busy?: boolean; checking?: boolean; twoClock?: boolean; onBack: () => void; onRetry: () => void; onSign: () => void; onNavigate: (path: string) => void; evidence?: typeof CompletionEvidence }) {
  const t = useT(); const format = useFormat(); const { color, radius, space } = useBeaconTheme();
  const read = status === "ready" ? data : null; const submission = read?.submission;
  const stampAt = read?.signOff?.at ?? submission?.submitted.at;
  const clocks = stampAt != null && read ? format.lines(stampAt, read.job.siteZone, twoClock ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined) : null;
  const missing = !!submission?.items.some(item => !item.photos.length || item.photos.some(photo => photo.availability === "unavailable"));
  const root = `/c/jobs/${read?.job.jobId ?? ""}`;
  const dock = read && submission ? <Dock context={read.signOff ? undefined : !read.actions.signOff ? t("mobile.aftercare.onlyApprover", { name: read.namedApproverDisplayName, place: read.job.placeAlias }) : missing ? t("mobile.aftercare.missingEvidence") : t("mobile.aftercare.signEffect")} primary={read.signOff ? { label: t("mobile.aftercare.seeBill"), onPress: () => onNavigate(`${root}/bill`), disabled: !read.actions.seeBill } : { label: t("mobile.aftercare.sign"), onPress: onSign, disabled: !read.actions.signOff || busy, busy }} /> : undefined;
  return <Screen title={t("mobile.aftercare.review")} subtitle={read ? [read.job.reference, read.job.title, read.job.placeAlias].filter(Boolean).join(" · ") : undefined} navigation={{ kind: "back", label: t("mobile.aftercare.back"), onPress: onBack }} dock={dock}>
    <ReadState status={status} onRetry={onRetry} />
    {read && <>
      {read.signOff ? <Card><Badge tone="success" label={t("mobile.aftercare.signedBy", { name: read.signOff.actorDisplayName, time: clocks?.site ?? "" })} />
        {clocks?.viewer && <Copy variant="supporting" style={{ color: color.muted }}>{clocks.viewer}</Copy>}</Card>
        : submission ? <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "flex-start", gap: space.grid[3], padding: space.grid[4], borderRadius: radius.card, backgroundColor: color.attentionSoft }}>
          <Copy variant="label" aria-hidden style={{ color: color.attentionInk }}>◷</Copy>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Copy variant="label" style={{ color: color.attentionInk }}>{t("mobile.aftercare.waiting")}</Copy>
            <Copy variant="supporting" style={{ color: color.attentionInk }}>{t("mobile.aftercare.submittedBy", { name: submission.submitted.actorDisplayName, time: clocks?.site ?? "" })}</Copy>
            {clocks?.viewer && <Copy variant="supporting" style={{ color: color.attentionInk }}>{clocks.viewer}</Copy>}
          </View>
        </View> : null}
      <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.aftercare.scope", { version: read.approvedScope.version, amount: format.money(read.approvedScope.totalMinor, read.approvedScope.currency) })}</Copy>
      <Card>{read.approvedScope.lines.map((line, index) => {
        const item = submission?.items.find(entry => JSON.stringify(entry.scope) === JSON.stringify(line.ref));
        const translation = line.label.reading?.status === "ready" ? line.label.reading.text : undefined;
        return <View key={index} style={{ gap: space.grid[2], borderTopWidth: index ? 1 : 0, borderTopColor: color.separator, paddingTop: index ? space.grid[3] : 0 }}>
          <Copy variant="label">{translation ?? line.label.original.text}</Copy>
          {translation && <Copy variant="supporting" style={{ color: color.muted }}>{line.label.original.text}</Copy>}
          {item && <>
            <Badge tone={item.outcome === "done" ? "success" : "attention"} label={item.outcome === "done" ? t("mobile.aftercare.done") : t("mobile.aftercare.notDone")} />
            <AuthoredText value={item.outcome === "done" ? item.result : item.reason} />
            {item.outcome === "done" && item.evidenceAlternative && <AuthoredText value={item.evidenceAlternative} />}
            {item.photos.length ? <Evidence item={item} siteZone={read.job.siteZone} onNavigate={onNavigate} onRetry={onRetry} /> : <Copy variant="supporting">{t("mobile.aftercare.noPhoto")}</Copy>}
          </>}
        </View>;
      })}</Card>
      <CompletionScope value={read.approvedScope.scope} />
      {read.approvedScope.exclusions && <CompletionScope value={read.approvedScope.exclusions} title={t("mobile.aftercare.exclusions", { version: read.approvedScope.version })} />}
      {read.openCases.map(item => <Button key={item.id} variant="quiet" label={t("mobile.aftercare.caseOpen", { reference: item.reference })} onPress={() => onNavigate(`${root}/case/${item.id}`)} />)}{read.actions.reportProblem && <Button variant="quiet" label={t("mobile.aftercare.problem")} onPress={() => onNavigate(`${root}/case/new`)} />}{checking && <Copy>{t("mobile.aftercare.checking")}</Copy>}
    </>}
  </Screen>;
}

function CompletionScope({ value, title }: { value: Authored; title?: string }) {
  const t = useT();
  const original = { text: value.original.text, label: t("mobile.aftercare.original", { language: readingLanguageLabel(t, value.original.language) }), direction: value.original.language === "ar" ? "rtl" as const : "ltr" as const };
  return value.reading?.status === "ready"
    ? <TwinCard title={title} state="translated" original={original} translation={{ text: value.reading.text, label: t("mobile.customerQuote.translation", { language: readingLanguageLabel(t, value.reading.language) }) }} />
    : <TwinCard title={title} state="original" original={original} />;
}

type CompletionItem = NonNullable<Completion["submission"]>["items"][number];
type EvidenceProps = { item: CompletionItem; siteZone: string; onNavigate: (path: string) => void; onRetry: () => void; urls?: ReadonlyMap<string, string>; onOpen?: (id: CompletionItem["photos"][number]["attachmentId"]) => void };

function RoutedCompletionEvidence(props: EvidenceProps) {
  const { item } = props;
  const ids = item.photos.flatMap(photo => photo.availability === "available" ? [photo.attachmentId] : []);
  const scope = { caller: "completion" as const, parentScopeId: item.id };
  const urls = useMediaReadBatch(ids, ids.length ? scope : null);
  const open = useOpenMediaPreview();
  return <CompletionEvidence {...props} urls={urls} onOpen={id => open(id, scope)} />;
}

function CompletionEvidence({ item, siteZone, onNavigate, onRetry, urls, onOpen }: EvidenceProps) {
  const t = useT(); const format = useFormat(); const { color, space } = useBeaconTheme();
  return <View style={{ gap: space.grid[2] }}>
    {item.photos.map(photo => {
      if (photo.availability !== "available") return <Button key={photo.attachmentId} variant="quiet" label={t("mobile.aftercare.photoUnavailable")} onPress={onRetry} />;
      const caption = photo.caption?.reading?.status === "ready" ? photo.caption.reading.text : photo.caption?.original.text;
      const at = photo.capturedAt == null ? null : format.siteTime(photo.capturedAt, siteZone);
      return <View key={photo.attachmentId} style={{ flexDirection: "row", alignItems: "center", gap: space.grid[3] }}>
        <Copy variant="supporting" style={{ color: color.muted, flex: 1 }}>{[caption, at?.kind === "available" ? `${at.site.time} ${format.zoneLabel(siteZone, at.site)}` : null].filter(Boolean).join(" · ") || t("mobile.aftercare.photo")}</Copy>
        <Thumb uri={urls?.get(photo.attachmentId)} label={caption ?? t("mobile.aftercare.photo")} onPress={onOpen ? () => onOpen(photo.attachmentId) : () => onNavigate(`/media/${photo.attachmentId}`)} />
      </View>;
    })}
  </View>;
}
