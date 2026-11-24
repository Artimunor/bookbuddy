import { getHomeRoute, listShiftsRoute, type HomeProjection, type ShiftAgenda } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { useRemote, type CachedRead } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useOutbox } from "../../repository/hooks";
import { useSession } from "../../session";
import { Button, Card, Dock, IdentityChip, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { HoldBanner } from "../../ui/live/HoldBanner";
import { LiveCapsule } from "../../ui/live/LiveCapsule";
import { useBeaconTheme } from "../../ui/theme";
import { siteTime } from "../f-01/Screen";
import { Deadline, useClock } from "../w-03/Screen";

type Home = Extract<HomeProjection, { audience: "worker" }>;
type CachedHome = Extract<CachedRead<"home">, { audience: "worker" }>;
type Status = "idle" | "loading" | "ready" | "error" | "offline";
function sameDay(a: number, b: number, zone: string) { const f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }); return f.format(a) === f.format(b); }
export default function NowScreen() {
  const home = useRemote(getHomeRoute, { query: {} }, { cache: { kind: "home" } });
  const agenda = useRemote(listShiftsRoute, { query: { segment: "upcoming" } }, { cache: { kind: "shift_agenda" } });
  const router = useRouter(); const { bootstrap } = useSession(); const { entries } = useOutbox(); const data = home.data?.audience === "worker" ? home.data : null;
  return <NowView data={data} status={home.status} lastConfirmedAt={home.lastConfirmedAt} agenda={agenda.data} pendingCount={entries.filter(entry => entry.status === "queued").length} name={bootstrap?.account.displayName ?? ""} now={useClock()} onRetry={() => void home.refresh()} onNavigate={path => router.push(path as Href)} />;
}
export function NowView(p: { data: Home | CachedHome | null; status: Status; lastConfirmedAt: number | null; agenda: ShiftAgenda | CachedRead<"shift_agenda"> | null; pendingCount?: number; name: string; now: number; onRetry: () => void; onNavigate: (path: string) => void }) {
  const t = useT(); const format = useFormat(); const { color, radius, space } = useBeaconTheme(); const d = p.data; const zone = d?.siteZone ?? "";
  const current = d?.assignment && d.assignment.assignment.state === "confirmed" && sameDay(d.assignment.assignment.window.startsAt, p.now, d.assignment.siteZone) ? d.assignment : null;
  const upcoming = !current && p.agenda?.segment === "upcoming" ? p.agenda.rows.filter(row => sameDay(row.shift.startsAt, p.now, row.shift.siteZone)) : [];
  const urgent = upcoming.find(row => row.nextAction === "check_in" || row.nextAction === "check_out" || row.nextAction === "check_briefing");
  const offer = !current && !urgent ? d?.offers[0] : null;
  const shift = urgent ?? (!offer ? upcoming[0] : null);
  const shiftId = current?.assignment.shiftId ?? shift?.shift.id; const next = current?.assignment.nextStep ?? shift?.nextAction;
  const onSite = next === "check_out";
  const shiftAction = next === "travel" || next === "depart" ? { label: t("mobile.workerOffer.onWay"), path: "depart" } : next === "check_in" ? { label: t("mobile.workerOffer.checkIn"), path: "attendance" } : next === "check_out" ? { label: t("mobile.workerOffer.checkOut"), path: "attendance" } : next === "open_briefing" || next === "check_briefing" ? { label: t("mobile.workerOffer.openBriefing"), path: "briefing" } : { label: t("mobile.workerOffer.openShift"), path: "" };
  const assignmentId = current?.assignment.assignmentId ?? shift?.assignment.id;
  const assignmentQuery = assignmentId ? `?assignmentId=${encodeURIComponent(assignmentId)}` : "";
  const shiftPath = `/w/shifts/${shiftId}${shiftAction.path ? `/${shiftAction.path}` : ""}${assignmentQuery}`;
  const offerGap = offer && "gapId" in offer && typeof offer.gapId === "string" ? offer.gapId : null;
  const offerPath = offer ? `/w/offers/${offer.offerId}${offerGap ? `?gapId=${encodeURIComponent(offerGap)}` : ""}` : "";
  const openOffer = () => p.onNavigate(offerPath);
  const title = current?.title ?? shift?.shift.job.title ?? t("mobile.workerOffer.shift");
  const when = current ? `${siteTime(format, current.assignment.window.startsAt, current.siteZone)} – ${siteTime(format, current.assignment.window.endsAt, current.siteZone)} · ${current.siteZone}` : shift ? `${siteTime(format, shift.shift.startsAt, shift.shift.siteZone)} – ${siteTime(format, shift.shift.endsAt, shift.shift.siteZone)} · ${shift.shift.siteZone}` : "";
  return <Screen title={t("mobile.workerOffer.now")} identity={<IdentityChip name={p.name || t("mobile.workerOffer.worker")} initials={p.name.split(/\s+/).map(part => part[0]).join("").slice(0, 2)} context={[t("mobile.workerOffer.worker"), d?.businessName].filter(Boolean).join(" · ")} accessibilityLabel={t("mobile.foremanHome.profile")} onPress={() => p.onNavigate("/you")} />} bell={<Button variant="quiet" label={t("mobile.workerOffer.notifications")} onPress={() => p.onNavigate("/notifications")} />} dock={offer && p.status === "ready" ? <Dock primary={{ label: offer.awaitingConfirmationUntil ? t("mobile.workerOffer.open") : t("mobile.workerOffer.accept"), onPress: () => p.onNavigate(`${offerPath}${offerGap ? "&" : "?"}${offer.awaitingConfirmationUntil ? "" : "accept=1"}`) }} secondary={{ label: offer.awaitingConfirmationUntil ? t("mobile.workerOffer.withdraw") : t("mobile.workerOffer.decline"), onPress: () => p.onNavigate(`${offerPath}${offerGap ? "&" : "?"}decision=${offer.awaitingConfirmationUntil ? "withdraw" : "decline"}`) }} /> : shiftId ? <Dock primary={{ label: p.status === "offline" && shiftAction.path === "depart" ? t("mobile.workerOffer.openShift") : shiftAction.label, onPress: () => p.onNavigate(p.status === "offline" && shiftAction.path === "depart" ? `/w/shifts/${shiftId}${assignmentQuery}` : shiftPath) }} /> : undefined}>
    {(p.status === "idle" || p.status === "loading") && <Copy>{t("mobile.workerOffer.loading")}</Copy>}{p.status === "error" && <><Copy>{t("mobile.workerOffer.error")}</Copy><Button label={t("mobile.workerOffer.retry")} onPress={p.onRetry} /></>}
    {p.status === "offline" && <><Copy>{t("mobile.workerOffer.offline")}</Copy>{p.lastConfirmedAt !== null && zone && <Copy>{t("shared.status.lastConfirmed", { time: `${siteTime(format, p.lastConfirmedAt, zone)} · ${zone}` })}</Copy>}{!!p.pendingCount && <Copy>{t("mobile.workerOffer.pendingEvents", { count: p.pendingCount })}</Copy>}</>}
    {offer && <Pressable accessibilityRole="button" onPress={openOffer} style={{ backgroundColor: color.live, borderRadius: radius.card, padding: space.cardPadding, gap: space.grid[3] }}><Copy variant="sectionTitle" style={{ color: color.onLive }}>{offer.awaitingConfirmationUntil ? t("mobile.workerOffer.waiting") : offer.kind === "cover" ? t("mobile.workerOffer.offer") : t("mobile.workerOffer.assignmentOffer")}</Copy>{"task" in offer && typeof offer.task === "string" && <Copy style={{ color: color.onLive }}>{offer.task}</Copy>}<Copy style={{ color: color.onLive }}>{offer.town} · {offer.skill}</Copy><Copy style={{ color: color.onLive }}>{siteTime(format, offer.window.startsAt, offer.siteZone)} – {siteTime(format, offer.window.endsAt, offer.siteZone)} · {offer.siteZone}</Copy><Copy style={{ color: color.onLive }}>{t("mobile.workerOffer.language", { language: offer.briefingLanguage })}</Copy><Deadline deadline={offer.awaitingConfirmationUntil ?? offer.replyBy} starts={offer.awaitingConfirmationUntil ?? offer.replyBy} zone={offer.siteZone} now={p.now} confirmation={!!offer.awaitingConfirmationUntil} field />{offer.awaitingConfirmationUntil && <Copy style={{ color: color.onLive }}>{t("mobile.workerOffer.noTravel")}</Copy>}</Pressable>}
    {offer && !offer.awaitingConfirmationUntil && <Copy>{offer.kind === "cover" ? t("mobile.workerOffer.provisional") : t("mobile.workerOffer.ordinaryEffect")}</Copy>}
    {shiftId && <><LiveCapsule size="hero" state={onSite ? "onSite" : "crewConfirmed"} stateLabel={onSite ? t("mobile.workerOffer.onSite") : t("mobile.workerOffer.confirmed")} source={title} reference={current?.reference ?? shift?.shift.job.reference} time={when} provenance={t("mobile.workerOffer.confirmed")} accessibilityLabel={`${title} · ${when} · ${t("mobile.workerOffer.confirmed")}`} onPress={() => p.onNavigate(`/w/shifts/${shiftId}${assignmentQuery}`)} />{current?.assignment.safetyHold && <><HoldBanner state="briefingRequired" label={t("mobile.workerOffer.briefingHold")} blocked={t("mobile.workerOffer.holdEffect")} action={t("mobile.workerOffer.openBriefing")} /><Button label={t("mobile.workerOffer.openBriefing")} variant="quiet" onPress={() => p.onNavigate(`/w/shifts/${shiftId}/briefing${assignmentQuery}`)} /></>}</>}
    {shiftId && (next === "travel" || next === "depart") && <Button label={t("mobile.workerOffer.alreadyOnSite")} variant="quiet" onPress={() => p.onNavigate(`/w/shifts/${shiftId}/attendance${assignmentQuery}`)} />}
    {p.status === "ready" && d && !offer && !shiftId && <Card><Copy>{t("mobile.workerOffer.empty")}</Copy></Card>}
    {d && <View><Button variant="quiet" label={d.openToCoverUntil ? t("mobile.workerOffer.coverUntil", { time: `${siteTime(format, d.openToCoverUntil, d.siteZone)} · ${d.siteZone}` }) : t("mobile.workerOffer.availability")} onPress={() => p.onNavigate("/w/availability")} /></View>}
  </Screen>;
}
