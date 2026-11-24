import { getHomeRoute, listShiftsRoute, type HomeProjection, type ShiftAgenda, type WorkerSessionHostOffer } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { useRemote, type CachedRead } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useOutbox } from "../../repository/hooks";
import { useSession } from "../../session";
import { Badge, Button, Card, Dock, IdentityChip, ListRow, Screen, StatusBanner } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { HoldBanner } from "../../ui/live/HoldBanner";
import { LiveCapsule } from "../../ui/live/LiveCapsule";
import { useBeaconTheme } from "../../ui/theme";
import { siteWindow } from "../c-01/clock";
import { readingLanguageLabel } from "../s-12/language";
import { useSessionHostOffers } from "../w-03/SessionOffer";
import { Deadline, useClock } from "../w-03/Screen";

type Home = Extract<HomeProjection, { audience: "worker" }>;
type CachedHome = Extract<CachedRead<"home">, { audience: "worker" }>;
type Status = "idle" | "loading" | "ready" | "error" | "offline";
function sameDay(a: number, b: number, zone: string) { const f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }); return f.format(a) === f.format(b); }
export default function NowScreen() {
  const home = useRemote(getHomeRoute, { query: {} }, { cache: { kind: "home" } });
  const agenda = useRemote(listShiftsRoute, { query: { segment: "upcoming" } }, { cache: { kind: "shift_agenda" } });
  const { remote: hostOffers } = useSessionHostOffers();
  const router = useRouter(); const { bootstrap } = useSession(); const { entries } = useOutbox(); const data = home.data?.audience === "worker" ? home.data : null;
  return <NowView data={data} status={home.status} lastConfirmedAt={home.lastConfirmedAt} agenda={agenda.data}
    hostOffers={hostOffers.status === "ready" ? hostOffers.data.offers : undefined}
    pendingCount={entries.filter(entry => entry.status === "queued").length} name={bootstrap?.account.displayName ?? ""} now={useClock()}
    onRetry={() => void home.refresh()} onNavigate={path => router.push(path as Href)} />;
}
export function NowView(p: { data: Home | CachedHome | null; status: Status; lastConfirmedAt: number | null; agenda: ShiftAgenda | CachedRead<"shift_agenda"> | null; hostOffers?: readonly WorkerSessionHostOffer[]; pendingCount?: number; name: string; now: number; onRetry: () => void; onNavigate: (path: string) => void }) {
  const t = useT(); const format = useFormat(); const { color, field, radius, space } = useBeaconTheme(); const d = p.data; const zone = d?.siteZone;
  const current = d?.assignment && d.assignment.assignment.state === "confirmed" && sameDay(d.assignment.assignment.window.startsAt, p.now, d.assignment.siteZone) ? d.assignment : null;
  const upcoming = !current && p.agenda?.segment === "upcoming" ? p.agenda.rows.filter(row => sameDay(row.shift.startsAt, p.now, row.shift.siteZone)) : [];
  const urgent = upcoming.find(row => row.nextAction === "check_in" || row.nextAction === "check_out" || row.nextAction === "check_briefing");
  const offer = !current && !urgent ? d?.offers[0] : null;
  const shift = urgent ?? (!offer ? upcoming[0] : null);
  const hostOffers = p.hostOffers?.filter(item => item.cover.expiresAt > p.now);
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
  const when = current ? siteWindow(format, current.assignment.window.startsAt, current.assignment.window.endsAt, current.siteZone) : shift ? siteWindow(format, shift.shift.startsAt, shift.shift.endsAt, shift.shift.siteZone) : null;
  const offerWindow = offer ? siteWindow(format, offer.window.startsAt, offer.window.endsAt, offer.siteZone) : null;
  const clock = format.siteTime(p.now, zone);
  const subtitle = clock.kind === "available" ? [clock.site.date, format.zoneLabel(zone, clock.site)].filter(Boolean).join(" · ") : undefined;
  const activeOffer = !!offer && !offer.awaitingConfirmationUntil && p.status === "ready" && p.now < offer.replyBy;
  const offerLabel = offer?.awaitingConfirmationUntil ? t("mobile.workerOffer.waiting") : offer?.kind === "cover" ? t("mobile.workerOffer.offer") : t("mobile.workerOffer.assignmentOffer");
  const offerEffect = offer?.awaitingConfirmationUntil ? t("mobile.workerOffer.noTravel") : offer?.kind === "cover" ? t("mobile.workerOffer.provisional") : t("mobile.workerOffer.ordinaryEffect");
  const offerDeadline = offer ? format.lines(offer.awaitingConfirmationUntil ?? offer.replyBy, offer.siteZone)?.site : null;
  const offerDeadlineLabel = offerDeadline ? offer?.awaitingConfirmationUntil ? t("mobile.workerOffer.confirmBy", { time: offerDeadline }) : t("mobile.workerOffer.replyBy", { time: offerDeadline }) : null;
  const offerInk = activeOffer && field ? color.onLive : color.ink;
  const showShiftAction = () => p.onNavigate(p.status === "offline" && shiftAction.path === "depart" ? `/w/shifts/${shiftId}${assignmentQuery}` : shiftPath);
  const coverUntil = d?.openToCoverUntil ? format.lines(d.openToCoverUntil, d.siteZone)?.site : null;
  const steps: [string, string, string, string, string] = [t("mobile.liveShift.confirmed"), t("mobile.liveShift.onWay"), t("mobile.liveShift.onSite"), t("mobile.liveShift.working"), t("mobile.liveShift.departed")];
  const step = onSite ? 2 : 0;
  const dock = offer && p.status === "ready" ? <Dock
    primary={{ label: offer.awaitingConfirmationUntil ? t("mobile.workerOffer.open") : t("mobile.workerOffer.accept"), live: activeOffer, onPress: () => p.onNavigate(`${offerPath}${offerGap ? "&" : "?"}${offer.awaitingConfirmationUntil ? "" : "accept=1"}`) }}
    secondary={{ label: offer.awaitingConfirmationUntil ? t("mobile.workerOffer.withdraw") : t("mobile.workerOffer.decline"), onPress: () => p.onNavigate(`${offerPath}${offerGap ? "&" : "?"}decision=${offer.awaitingConfirmationUntil ? "withdraw" : "decline"}`) }} />
    : shiftId ? <Dock primary={{ label: p.status === "offline" && shiftAction.path === "depart" ? t("mobile.workerOffer.openShift") : shiftAction.label, live: p.status === "ready" && (shiftAction.path === "depart" || shiftAction.path === "attendance"), onPress: showShiftAction }} /> : undefined;
  return <Screen title={t("mobile.workerOffer.now")} subtitle={subtitle} dock={dock}
    identity={<IdentityChip name={p.name || t("mobile.workerOffer.worker")} initials={p.name.split(/\s+/).map(part => part[0]).join("").slice(0, 2)} person="personD" context={[t("mobile.workerOffer.worker"), d?.businessName].filter(Boolean).join(" · ")} accessibilityLabel={t("mobile.foremanHome.profile")} onPress={() => p.onNavigate("/you")} />}
    bell={<Button variant="neutral" iconOnly glyph="🔔︎" label={t("mobile.workerOffer.notifications")} onPress={() => p.onNavigate("/notifications")} />}>
    {(p.status === "idle" || p.status === "loading") && <Copy>{t("mobile.workerOffer.loading")}</Copy>}{p.status === "error" && <><Copy>{t("mobile.workerOffer.error")}</Copy><Button label={t("mobile.workerOffer.retry")} onPress={p.onRetry} /></>}
    {p.status === "offline" && <>
      <StatusBanner state="offline" label={t("mobile.workerOffer.offline")} detail={p.lastConfirmedAt !== null && zone ? t("shared.status.lastConfirmed", { time: format.lines(p.lastConfirmedAt, zone)?.site ?? "" }) : undefined} />
      {!!p.pendingCount && <Copy>{t("mobile.workerOffer.pendingEvents", { count: p.pendingCount })}</Copy>}
    </>}
    {offer && <Pressable accessibilityRole="button" accessibilityLabel={[offerLabel, "task" in offer ? offer.task : null, offerWindow?.date, offerWindow?.time, offerWindow?.zone, offer.town, offer.skill, t("mobile.workerOffer.language", { language: readingLanguageLabel(t, offer.briefingLanguage) }), offerDeadlineLabel, offerEffect].filter(Boolean).join(" · ")} onPress={openOffer}
      style={({ pressed }) => ({ backgroundColor: activeOffer && field ? pressed ? color.livePressed : color.live : pressed ? color.subtle : color.surface, borderColor: activeOffer && field ? color.onLive : color.outline, borderWidth: activeOffer && field ? 2 : 1, borderRadius: radius.capsule, padding: space.cardPadding, gap: space.grid[3] })}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space.grid[2], alignItems: "center" }}>
        <Badge label={offerLabel} tone={activeOffer && !field ? "attention" : "neutral"} />
        {!!d?.businessName && <Copy variant="supporting" style={{ color: offerInk }}>{d.businessName}</Copy>}
      </View>
      {offerWindow && <View>
        <Copy variant="pageTitle" style={{ color: offerInk, fontVariant: ["tabular-nums"] }}>{offerWindow.time}</Copy>
        <Copy variant="supporting" style={{ color: offerInk }}>{[offerWindow.date, offerWindow.zone].filter(Boolean).join(" · ")}</Copy>
      </View>}
      <View>
        {"task" in offer && typeof offer.task === "string" && <Copy variant="label" style={{ color: offerInk }}>{offer.task}</Copy>}
        <Copy variant="supporting" style={{ color: offerInk }}>{offer.town} · {offer.skill} · {t("mobile.workerOffer.language", { language: readingLanguageLabel(t, offer.briefingLanguage) })}</Copy>
      </View>
      <View style={{ borderTopWidth: 1, borderColor: activeOffer && field ? color.onLive : color.separator, paddingTop: space.grid[3] }}>
        <Deadline deadline={offer.awaitingConfirmationUntil ?? offer.replyBy} starts={offer.awaitingConfirmationUntil ?? offer.replyBy} zone={offer.siteZone} now={p.now} confirmation={!!offer.awaitingConfirmationUntil} field={activeOffer && field} />
      </View>
      <Copy variant="supporting" style={{ color: offerInk }}>{offerEffect}</Copy>
    </Pressable>}
    {shiftId && <>
      <LiveCapsule size="hero" state={p.status === "offline" ? "quiet" : onSite ? "onSite" : "crewConfirmed"} stateLabel={steps[step]} source={title} reference={current?.reference ?? shift?.shift.job.reference}
        time={when?.time} zoneLine={[when?.date, when?.zone].filter(Boolean).join(" · ")} provenance={t("mobile.liveShift.confirmedSource")}
        line={{ kind: "visit", steps, current: step, accessibilityLabel: t("mobile.liveVisit.step", { step: step + 1, stage: steps[step] }) }}
        accessibilityLabel={[title, when?.time, when?.zone, steps[step]].filter(Boolean).join(" · ")} onPress={() => p.onNavigate(`/w/shifts/${shiftId}${assignmentQuery}`)} />
      {current?.assignment.safetyHold && <><HoldBanner state="briefingRequired" label={t("mobile.workerOffer.briefingHold")} blocked={t("mobile.workerOffer.holdEffect")} action={t("mobile.workerOffer.openBriefing")} /><Button label={t("mobile.workerOffer.openBriefing")} variant="quiet" onPress={() => p.onNavigate(`/w/shifts/${shiftId}/briefing${assignmentQuery}`)} /></>}
    </>}
    {shiftId && (next === "travel" || next === "depart") && <Button label={t("mobile.workerOffer.alreadyOnSite")} variant="quiet" onPress={() => p.onNavigate(`/w/shifts/${shiftId}/attendance${assignmentQuery}`)} />}
    {!!hostOffers?.length && <View style={{ gap: space.grid[3] }}>
      <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.sessionHostOffer.section")}</Copy>
      {hostOffers.map(item => {
        const clock = siteWindow(format, item.startsAt, item.endsAt, item.siteZone);
        const when = clock ? [clock.date, `${clock.time} ${clock.zone}`].filter(Boolean).join(" · ") : "";
        const path = `/w/offers/${item.id}?sessionHost=1&listingId=${encodeURIComponent(item.listingId)}&slotId=${encodeURIComponent(item.slotId)}`;
        return <Card key={item.id} accessibilityLabel={`${item.title} · ${item.roleLabel} · ${when}`} onPress={() => p.onNavigate(path)}>
          <Copy variant="label">{item.title}</Copy><Copy>{item.roleLabel}</Copy><Copy variant="supporting">{when}</Copy>
        </Card>;
      })}
    </View>}
    {p.status === "ready" && d && !offer && !shiftId && !hostOffers?.length && <Card><Copy>{t("mobile.workerOffer.empty")}</Copy></Card>}
    {d && <Card><ListRow glyph="◷" label={t("mobile.workerOffer.availability")} description={coverUntil ? t("mobile.workerOffer.coverUntil", { time: coverUntil }) : undefined} onPress={() => p.onNavigate("/w/availability")} /></Card>}
  </Screen>;
}
