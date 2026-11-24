import { getCrewMemberRoute, type CrewMember } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useRemote } from "../../api";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { Badge, Button, Card, Dock, ListRow, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { readingLanguageLabel } from "../s-12/language";
type Eligibility = CrewMember["eligibility"];
type Fit = NonNullable<CrewMember["shiftFit"]>["fit"];
export function useCrewLabels(zone: string) {
  const t = useT(); const format = useFormat();
  const time = (at: number) => { const clock = format.siteTime(at, zone); return clock.kind === "available" ? clock.site.time : ""; };
  const date = (at: number) => { const clock = format.siteTime(at, zone); return clock.kind === "available" ? clock.site.date : ""; };
  const zoneName = (at: number, siteZone: string) => { const clock = format.siteTime(at, siteZone); return clock.kind === "available" ? format.zoneLabel(siteZone, clock.site) : ""; };
  const eligibility = (value: Eligibility) => {
    const status = value.state === "approved" ? t("mobile.crew.eligible") : value.state === "expiring" ? t("mobile.crew.expiring") : value.state === "pending" ? t("mobile.crew.pending") : value.state === "expired" ? t("mobile.crew.expired") : value.state === "suspended" ? t("mobile.crew.suspended") : t("mobile.crew.rejected");
    return value.validUntil === null ? status : t("mobile.crew.validUntil", { status, date: date(value.validUntil) });
  };
  const availability = (value: Fit["availability"]) => value.state === "free" ? t("mobile.crew.free") : value.state === "unavailable" ? t("mobile.crew.unavailable") : value.state === "busy" ? t("mobile.crew.busy", { start: time(value.window.startsAt), end: time(value.window.endsAt) }) : t("mobile.crew.unknown");
  const result = (value: Fit) => value.result === "available" ? t("mobile.crew.available") : value.result === "conflict" ? t("mobile.crew.conflict") : value.result === "checking" ? t("mobile.crew.checking") : t("mobile.crew.ineligible");
  return { time, date, zoneName, eligibility, availability, result, language: (value: string) => readingLanguageLabel(t, value) };
}
export function fitEligible(fit: Fit) { return fit.result === "available" && fit.skillMatches && fit.briefingLanguageMatches && fit.availability.state === "free" && (fit.eligibility.state === "approved" || fit.eligibility.state === "expiring"); }

export default function CrewMemberScreen() {
  const { memberId, shiftId, jobId } = useLocalSearchParams<{ memberId: string; shiftId?: string; jobId?: string }>(); const router = useRouter();
  const remote = useRemote(getCrewMemberRoute, { params: { id: memberId ?? "" }, query: shiftId ? { shiftId } : {} }, { enabled: !!memberId });
  const select = () => { if (jobId && shiftId && memberId) router.navigate(`/f/jobs/${jobId}/assign?shiftId=${encodeURIComponent(shiftId)}&selected=${encodeURIComponent(memberId)}` as Href); };
  return <CrewMemberView data={remote.data} status={remote.status} onBack={() => router.back()} onRetry={() => void remote.refresh()} onSelect={jobId ? select : undefined} onMessage={id => router.push({ pathname: "/threads/[threadId]", params: { threadId: id } } as Href)} onReview={() => router.push("/help?reason=eligibility" as Href)} />;
}
export function CrewMemberView({ data, status, onBack, onRetry, onSelect, onMessage, onReview }: { data: CrewMember | null; status: RemoteStatus; onBack: () => void; onRetry: () => void; onSelect?: () => void; onMessage: (id: string) => void; onReview: () => void }) {
  const t = useT(); const labels = useCrewLabels(data?.siteZone ?? "UTC"); const fit = data?.shiftFit; const member = data?.member;
  const crewThreadId = fit?.crewThreadId;
  const dock = fit && onSelect ? <Dock context={t("mobile.crew.selectEffect")} primary={{ label: t("mobile.crew.select"), onPress: onSelect, disabled: status !== "ready" || !fitEligible(fit.fit) }} /> : undefined;
  return <Screen title={t("mobile.crew.member")} subtitle={data?.businessName} navigation={{ kind: "back", label: t("mobile.crew.back"), onPress: onBack }} dock={dock}>
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.crew.loading")}</Copy>}
    {(status === "error" || status === "offline") && <><Copy>{status === "offline" ? t("mobile.crew.offline") : t("mobile.crew.error")}</Copy><Button label={t("mobile.crew.retry")} onPress={onRetry} /></>}
    {data && member && <><Card><Copy variant="sectionTitle">{member.displayName}</Copy><Copy>{member.skills.join(" · ")}</Copy><Copy>{member.workingLanguages.map(labels.language).join(" · ")}</Copy><Copy>{member.openToCoverUntil === null ? t("mobile.crew.notOpen") : t("mobile.crew.openUntil", { time: labels.time(member.openToCoverUntil) })}</Copy></Card>
      {fit ? <Card><Copy variant="sectionTitle">{fit.shift.reference} · {labels.time(fit.shift.window.startsAt)}–{labels.time(fit.shift.window.endsAt)} · {labels.zoneName(fit.shift.window.startsAt, fit.shift.siteZone)}</Copy><Badge label={labels.result(fit.fit)} tone={fitEligible(fit.fit) ? "success" : "attention"} /><Copy>{t("mobile.crew.skills")}: {fit.fit.skillMatches ? t("mobile.crew.skillMatch") : t("mobile.crew.skillMismatch")} · {fit.shift.skill}</Copy><Copy>{t("mobile.crew.languages")}: {fit.fit.briefingLanguageMatches ? t("mobile.crew.languageMatch") : t("mobile.crew.languageMismatch", { language: labels.language(fit.shift.briefingLanguage) })}</Copy><Copy>{t("mobile.crew.availability")}: {labels.availability(fit.fit.availability)}</Copy><Copy>{t("mobile.crew.eligibility")}: {labels.eligibility(fit.fit.eligibility)}</Copy><Copy variant="supporting">{t("mobile.crew.checked", { time: labels.time(fit.fit.checkedAt) })}</Copy>{fit.fit.result === "not_eligible" && <Button variant="quiet" label={t("mobile.crew.askReview")} onPress={onReview} />}</Card> : <><Card><Copy variant="sectionTitle">{t("mobile.crew.eligibility")}</Copy><Copy>{labels.eligibility(data.eligibility)}</Copy></Card><Card><Copy variant="sectionTitle">{t("mobile.crew.availability")}</Copy>{data.availability.map(day => <Copy key={day.date}>{day.date}: {day.available.length ? day.available.map(w => `${labels.time(w.startsAt)}–${labels.time(w.endsAt)}`).join(", ") : t("mobile.crew.noWindows")}{day.busy.map(w => ` · ${t("mobile.crew.busy", { start: labels.time(w.startsAt), end: labels.time(w.endsAt) })}`)}</Copy>)}</Card></>}
      {status === "ready" && crewThreadId && <ListRow label={t("mobile.crew.message")} onPress={() => onMessage(crewThreadId)} />}
      <Copy variant="supporting">{t("mobile.crew.privacy")}</Copy></>}
  </Screen>;
}
