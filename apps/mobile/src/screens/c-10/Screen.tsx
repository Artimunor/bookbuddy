import { getJobCompletionRoute, idSchemaFor, signOffCompletionRoute, type CompletionProjection } from "@bookbuddy/api-contract";
import type { SiteDateTime } from "@bookbuddy/domain";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCommand, useRemote } from "../../api";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Button, Card, Dock, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { confirmAction } from "../s-17/confirmAction";

type Completion = Extract<CompletionProjection, { audience: "customer" }>;
type Authored = Completion["approvedScope"]["scope"];
export function AuthoredText({ value }: { value: Authored }) {
  const t = useT();
  return <>{value.reading?.status === "ready" && <Copy>{value.reading.text}</Copy>}<Copy variant="supporting">{t("mobile.aftercare.original", { language: value.original.language })}</Copy><Copy>{value.original.text}</Copy></>;
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
  return <CompletionView data={data} status={remote.status} twoClock={preferences?.twoClock ?? false} busy={command.state === "sending" || command.state === "checking"} checking={command.state === "checking"} onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} onSign={sign} onNavigate={(path) => router.push(path as Href)} />;
}
export function CompletionView({ data, status, busy = false, checking = false, twoClock = false, onBack, onRetry, onSign, onNavigate }: { data: Completion | null; status: RemoteStatus; busy?: boolean; checking?: boolean; twoClock?: boolean; onBack: () => void; onRetry: () => void; onSign: () => void; onNavigate: (path: string) => void }) {
  const t = useT(); const format = useFormat(); const read = status === "ready" ? data : null; const submission = read?.submission;
  const stampAt = read?.signOff?.at ?? submission?.submitted.at;
  const clocks = twoClock && stampAt && read ? format.twoClock(stampAt, read.job.siteZone, Intl.DateTimeFormat().resolvedOptions().timeZone) : null;
  const missing = !!submission?.items.some(item => !item.photos.length || item.photos.some(photo => photo.availability === "unavailable"));
  const root = `/c/jobs/${read?.job.jobId ?? ""}`;
  const dock = read && submission ? <Dock context={read.signOff ? undefined : !read.actions.signOff ? t("mobile.aftercare.onlyApprover", { name: read.namedApproverDisplayName, place: read.job.placeAlias }) : missing ? t("mobile.aftercare.missingEvidence") : t("mobile.aftercare.signEffect")} primary={read.signOff ? { label: t("mobile.aftercare.seeBill"), onPress: () => onNavigate(`${root}/bill`), disabled: !read.actions.seeBill } : { label: t("mobile.aftercare.sign"), onPress: onSign, disabled: !read.actions.signOff || busy, busy }} /> : undefined;
  return <Screen title={t("mobile.aftercare.review")} navigation={{ kind: "back", label: t("mobile.aftercare.back"), onPress: onBack }} dock={dock}>
    <ReadState status={status} onRetry={onRetry} />
    {read && <><Copy variant="supporting">{read.job.reference} · {read.job.title} · {read.job.placeAlias}</Copy>
      {read.signOff ? <Card><Badge tone="success" label={t("mobile.aftercare.signedBy", { name: read.signOff.actorDisplayName, time: siteTime(format, read.signOff.at, read.job.siteZone) })} /></Card> : submission && <Card><Badge label={t("mobile.aftercare.waiting")} /><Copy>{t("mobile.aftercare.submittedBy", { name: submission.submitted.actorDisplayName, time: siteTime(format, submission.submitted.at, read.job.siteZone) })}</Copy></Card>}
      {clocks?.kind === "available" && clocks.viewerTime && <Copy variant="supporting">{t("mobile.jobHome.yourTime", { time: clocks.viewerTime })}</Copy>}
      <Copy variant="sectionTitle">{t("mobile.aftercare.scope", { version: read.approvedScope.version, amount: format.money(read.approvedScope.totalMinor, read.approvedScope.currency) })}</Copy>
      <Card>{read.approvedScope.lines.map((line, index) => { const item = submission?.items.find(entry => JSON.stringify(entry.scope) === JSON.stringify(line.ref)); return <Card key={index}><AuthoredText value={line.label} />{item && <><Badge label={item.outcome === "done" ? t("mobile.aftercare.done") : t("mobile.aftercare.notDone")} /><AuthoredText value={item.outcome === "done" ? item.result : item.reason} />{item.outcome === "done" && item.evidenceAlternative && <AuthoredText value={item.evidenceAlternative} />}{!item.photos.length && <Copy>{t("mobile.aftercare.noPhoto")}</Copy>}{item.photos.map(photo => <Button key={photo.attachmentId} variant="quiet" label={photo.availability === "available" ? photo.caption?.reading?.status === "ready" ? photo.caption.reading.text : photo.caption?.original.text ?? t("mobile.aftercare.photo") : t("mobile.aftercare.photoUnavailable")} onPress={photo.availability === "available" ? () => onNavigate(`/media/${photo.attachmentId}`) : onRetry} />)}</>}</Card>; })}<AuthoredText value={read.approvedScope.scope} />{read.approvedScope.exclusions && <><Copy variant="label">{t("mobile.aftercare.exclusions", { version: read.approvedScope.version })}</Copy><AuthoredText value={read.approvedScope.exclusions} /></>}</Card>
      {read.openCases.map(item => <Button key={item.id} variant="quiet" label={t("mobile.aftercare.caseOpen", { reference: item.reference })} onPress={() => onNavigate(`${root}/case/${item.id}`)} />)}{read.actions.reportProblem && <Button variant="quiet" label={t("mobile.aftercare.problem")} onPress={() => onNavigate(`${root}/case/new`)} />}{checking && <Copy>{t("mobile.aftercare.checking")}</Copy>}
    </>}
  </Screen>;
}
