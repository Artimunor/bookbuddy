import type { BusinessPeople, ProviderSessionDetail, ProviderSessionRoster } from "@bookbuddy/api-contract";
import { useEffect, useState } from "react";
import { View } from "react-native";
import type { RemoteStatus } from "../../api";
import { useFormat, useLocale, useT } from "../../i18n";
import { Badge, Button, Card, Dock, ListRow, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { CrewDots, type CrewMember } from "../../ui/live/CrewDots";
import { LiveCapsule } from "../../ui/live/LiveCapsule";
import { OfferClock } from "../../ui/live/OfferClock";
import { useBeaconTheme } from "../../ui/theme";
import { Separator, SessionFact } from "../l-01/common";

type Slot = ProviderSessionRoster["slot"];
type Assignment = ProviderSessionRoster["assignments"][number];
type DayStage = NonNullable<Slot["day"]>["stage"];
export type RosterAction =
  | { kind: "publish" }
  | { kind: "cancel" }
  | { kind: "propose_change"; slot: Slot }
  | { kind: "propose_host"; position: number; membershipId: Assignment["membershipId"]; name: string; language: string }
  | { kind: "confirm_host"; assignment: Assignment }
  | { kind: "release_host"; assignment: Assignment }
  | { kind: "confirm_stage"; stage: DayStage; label: string };

const minute = 60_000;
const stageStep = { today: 1, doors_open: 2, in_session: 3, done: 4 } as const;
const nextStage = { today: "doors_open", doors_open: "in_session", in_session: "done", done: null } as const;

export function RosterView({ detail, roster, slot, role, status, busy, checking, directory, directoryStatus, slotsPaged, attendeesPaged,
  now: fixedNow, onOpenDirectory, onPeoplePage, onAction, onBack, onRetry, onSlotsPage, onAttendeesPage, onChooseSlot, onEdit, onHelp }: {
  detail: ProviderSessionDetail | null; roster: ProviderSessionRoster | null; slot?: Slot; role: string; status: RemoteStatus;
  busy: boolean; checking?: boolean; directory?: BusinessPeople | null; directoryStatus?: RemoteStatus;
  slotsPaged?: boolean; attendeesPaged?: boolean; now?: number;
  onBack: () => void; onRetry: () => void; onEdit: (mode: "new" | "edit") => void; onHelp: () => void;
  onAction: (action: RosterAction) => void; onOpenDirectory: () => void; onChooseSlot: (id: string) => void;
  onPeoplePage: (cursor: string) => void; onSlotsPage: (cursor?: string) => void; onAttendeesPage: (cursor?: string) => void;
}) {
  const t = useT();
  const format = useFormat();
  const { locale } = useLocale();
  const { color, space, radius } = useBeaconTheme();
  const [showAttendees, setShowAttendees] = useState(false);
  const [showProposal, setShowProposal] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const assignments = roster?.assignments ?? [];
  const offered = assignments.find(item => item.cover?.status === "accepted") ?? assignments.find(item => item.cover?.status === "offered");
  useEffect(() => {
    if (!offered || fixedNow !== undefined || status !== "ready") return;
    const tick = setInterval(() => setClock(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, [offered, fixedNow, status]);
  const now = fixedNow ?? (offered ? Math.max(clock, Date.now()) : Date.now());
  const version = detail?.version;
  const zone = version?.venue.siteZone ?? "";
  const stamp = (at: number) => format.siteTime(at, zone);
  const absolute = (at: number) => format.lines(at, zone)?.site ?? zone;
  const time = (at: number) => { const value = stamp(at); return value.kind === "available" ? value.site.time : zone; };
  const language = (tag: string) => {
    try { return new Intl.DisplayNames(locale, { type: "language" }).of(tag) ?? tag; }
    catch { return tag; }
  };
  const title = detail?.actions.publish ? t("mobile.sessionSetup.title") : t("mobile.sessionSetup.roster");
  const navigation = { kind: "back" as const, label: t("shared.action.back"), onPress: onBack };
  const allowed = status === "ready" && !busy;
  const admin = detail?.actions.publish === true;
  const future = !!slot && slot.startsAt > now;
  const paused = slot?.state === "paused";
  const draft = slot?.state === "draft";
  const published = slot?.state === "published";
  const active = draft || paused || published;
  const confirmed = assignments.filter(item => item.state === "confirmed");
  const vacancy = slot ? Array.from({ length: Math.min(slot.hostsRequired, confirmed.length + 1) }, (_, position) => position + 1)
    .find(position => !confirmed.some(item => item.position === position)) : undefined;
  let dropped: Assignment | undefined;
  for (const item of assignments) {
    if (item.state === "released" && !item.cover && (!dropped || item.changed.at > dropped.changed.at)) dropped = item;
  }
  const cover = !!roster && paused && vacancy !== undefined;
  const deadline = offered?.cover?.expiresAt;
  const ownTeamStatus = deadline && deadline > now ? offered?.cover?.status === "accepted" ? t("mobile.sessionSetup.accepted") : t("mobile.cover.offersOut") : t("mobile.cover.noCover");
  const coverSafe = !!slot && slot.startsAt - now >= 10 * minute;
  const setupMatches = !!version && (!slot || slot.listingVersionId === version.id);
  const proposalWindows = (detail?.slots ?? []).filter(other => other.id !== slot?.id && other.state === "published" && other.startsAt > now && other.placesLeft >= (slot?.bookedPlaces ?? 1));
  const day = slot?.day;
  const stages = [t("mobile.sessionSetup.published"), t("mobile.sessionSetup.today"), t("mobile.sessionSetup.doorsOpen"), t("mobile.sessionSetup.inSession"), t("mobile.sessionSetup.done")] as const;
  const nextStageId = day ? nextStage[day.stage] : "today";
  const start = slot && stamp(slot.startsAt);
  const today = stamp(now);
  const sameDay = start && start.kind === "available" && today.kind === "available" && start.site.date === today.site.date;
  const canAdvance = published && nextStageId && sameDay && !!slot && (nextStageId !== "in_session" || !future);
  const canPublish = !!slot?.coordinator && vacancy === undefined && !!roster && admin && future && (draft || paused);
  const canEdit = admin && (draft || ((published || paused) && !!slot?.coordinator)) && future && !!slot;
  const people = directory?.audience === "foreman" ? directory.members.filter(member => member.roles.includes("worker") &&
    member.skills.includes(detail?.category ?? "") && member.workLanguages.some(tag => tag.toLowerCase() === version?.language.toLowerCase()))
    : directory?.audience === "provider_admin" && directory.view === "active" ? directory.members.filter(member => member.roles.some(grant => grant.role === "worker")) : [];
  const candidates = people.filter(member => !assignments.some(item => item.membershipId === member.id &&
    (item.state === "confirmed" || item.state === "proposed" && !item.cover || !!item.cover)) &&
    (vacancy !== 1 || !version?.guaranteedHostMembershipId || version.guaranteedHostMembershipId === member.id));
  const noMoreCandidates = directoryStatus === "ready" && candidates.length === 0 && !directory?.cursor;
  const canChooseHost = !!roster && !!version && setupMatches && !!detail?.actions.roster && vacancy !== undefined && future &&
    (draft || cover && coverSafe) && !offered && !noMoreCandidates;
  const proposalAllowed = cover && future && !offered && (noMoreCandidates || !coverSafe || !setupMatches) && !!slot?.bookedPlaces && detail?.actions.changeHost;
  const dock = !detail ? undefined : cover && !canPublish ? <Dock context={offered ? ownTeamStatus : t("mobile.sessionSetup.customersAnswer")}
    primary={{ label: t("mobile.sessionSetup.propose"), onPress: () => setShowProposal(value => !value), disabled: !allowed || !proposalAllowed, busy }} />
    : canPublish ? <Dock primary={{ label: t("mobile.sessionSetup.publish"), onPress: () => onAction({ kind: "publish" }), disabled: !allowed, busy }} />
      : canEdit ? <Dock context={draft ? undefined : t("mobile.sessionSetup.changesAreProposals")}
        primary={{ label: t("mobile.sessionSetup.edit"), onPress: () => onEdit("edit"), disabled: !allowed, busy }} />
        : admin && !slot ? <Dock primary={{ label: t("mobile.sessionSetup.newSlot"), onPress: () => onEdit("new"), disabled: !allowed, busy }} /> : undefined;
  const capsuleLabel = !slot ? "" : cover ? t("mobile.sessionSetup.hostNeeded") : draft ? t("mobile.sessionSetup.draft")
    : slot.state === "cancelled" ? t("mobile.sessionSetup.cancelled") : t("mobile.sessionSetup.booked", { count: slot.bookedPlaces });
  const capacity = slot ? cover ? t("mobile.sessionSetup.capacityGap", { booked: slot.bookedPlaces, capacity: slot.capacity })
    : t("mobile.sessionSetup.capacity", { capacity: slot.capacity, open: slot.placesLeft }) : "";
  const bookingStatus = published ? t("mobile.sessionSetup.bookingsOn") : paused ? t("mobile.sessionSetup.paused") : "";
  const provenance = cover && dropped ? t("mobile.sessionSetup.hostOut", { host: dropped.name, actor: dropped.changed.byName, time: absolute(dropped.changed.at) })
    : day ? t("mobile.sessionSetup.confirmedBy", { actor: day.byName, time: absolute(day.at) })
      : confirmed[0] ? t("mobile.sessionSetup.confirmedBy", { actor: confirmed[0].changed.byName, time: absolute(confirmed[0].changed.at) }) : bookingStatus;
  const zoneLabel = start && start.kind === "available" ? format.zoneLabel(zone, start.site) : zone;
  const offerLabel = (item: Assignment) => {
    const state = item.cover?.status;
    if (state === "declined") return t("mobile.sessionSetup.declined", { time: time(item.cover?.repliedAt ?? item.changed.at) });
    if (state === "accepted") return t("mobile.sessionSetup.accepted");
    if (state === "offered") return t("mobile.cover.offered");
    if (state === "expired") return t("mobile.cover.expired");
    if (state === "withdrawn" || item.state === "released") return t("mobile.cover.withdrawn");
    return item.state === "confirmed" ? t("mobile.sessionSetup.confirmedBy", { actor: item.changed.byName, time: time(item.changed.at) }) : t("mobile.sessionSetup.proposedHost");
  };
  const crewRow = (item: Assignment): CrewMember => ({ id: item.id, initials: item.name.split(/\s+/).slice(0, 2).map(part => part[0]).join(""),
    name: item.name, role: `${item.roleLabel} · ${language(item.language)}`, status: item.state === "confirmed" ? "confirmed" : item.state === "released" ? "gap" : "hold", statusLabel: offerLabel(item) });

  return <Screen title={title} subtitle={detail ? `${detail.provider.name} · ${role}` : undefined} navigation={navigation} dock={dock}>
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.provider.loading")}</Copy>}
    {(status === "offline" || status === "error") && <><Copy>{status === "offline" ? t("mobile.sessionSetup.offline") : t("mobile.provider.unavailable")}</Copy><Button label={t("mobile.provider.retry")} onPress={onRetry} /></>}
    {checking && <Copy accessibilityLiveRegion="polite">{t("mobile.cover.checking")}</Copy>}
    {detail && !slot && <Card><Copy variant="sectionTitle">{version?.title ?? title}</Copy><Badge label={t("mobile.sessionSetup.draft")} />
      <Copy>{t("mobile.sessionSetup.noSlot")}</Copy></Card>}
    {detail && slot && <>
      <LiveCapsule source={version?.title ?? title} stateLabel={capsuleLabel}
        reference={start && start.kind === "available" ? start.site.date : undefined}
        state={slot.state === "finished" ? "finished" : cover ? "quiet" : !day ? published ? "booked" : "quiet" : day.stage === "in_session" ? "working" : "crewConfirmed"}
        pulse={!!day && published && allowed} time={`${time(slot.startsAt)}–${time(slot.endsAt)}`}
        zoneLine={[zoneLabel, capacity, !cover && bookingStatus].filter(Boolean).join(" · ")} provenance={provenance}
        sessionLine={!draft && slot.state !== "cancelled" ? { steps: stages, current: day ? stageStep[day.stage] : 0, accessibilityLabel: stages[day ? stageStep[day.stage] : 0] } : undefined}
        accessibilityLabel={[version?.title, capsuleLabel, absolute(slot.startsAt), time(slot.endsAt), capacity, provenance].filter(Boolean).join(". ")} />
      {cover ? <>
        <Card><View style={{ paddingStart: 29, gap: space.grid[2] }}>
        <View pointerEvents="none" aria-hidden style={{ position: "absolute", top: 14, bottom: 53, start: 8, width: 3, backgroundColor: color.subtle }} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: space.grid[2] }}>
          <View aria-hidden style={{ position: "absolute", start: -29, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: color.criticalSoft }}>
            <Copy variant="caption" style={{ color: color.criticalInk }}>{offered ? "·" : "×"}</Copy>
          </View>
          <Copy variant="sectionTitle">{t("mobile.sessionSetup.ownTeam")}</Copy>
          <Badge label={directoryStatus === "ready" || assignments.some(item => item.cover) ? ownTeamStatus : t("mobile.sessionSetup.hostNeeded")} tone={offered ? "attention" : "critical"} />
        </View>
          <CrewDots audience="foreman" people={assignments.filter(item => item.cover !== null).map(crewRow)} />
          {offered && deadline !== undefined && (deadline > now ? <OfferClock state="running" remaining={t("mobile.cover.minutes", { count: Math.ceil((deadline - now) / minute) })}
            fraction={Math.min(1, (deadline - now) / (15 * minute))} deadline={t("mobile.cover.replyBy", { time: time(deadline) })} />
            : <Button variant="quiet" label={t("mobile.provider.retry")} onPress={onRetry} />)}
          {offered?.cover?.status === "accepted" && deadline && deadline > now && <Button variant="live" label={t("mobile.sessionSetup.confirmHost")} disabled={!allowed} onPress={() => onAction({ kind: "confirm_host", assignment: offered })} />}
          {noMoreCandidates && !offered && <Copy variant="supporting">{t("mobile.sessionSetup.noOtherHosts")}</Copy>}
          <View style={{ gap: space.grid[1] }}>
            <View aria-hidden style={{ position: "absolute", start: -29, top: 3, width: 18, height: 18, borderRadius: 9, borderWidth: 1,
              borderColor: color.outline, backgroundColor: proposalAllowed ? color.ink : color.surface }} />
            <Copy variant="sectionTitle">{t("mobile.sessionSetup.changeRung")}</Copy>
            <Copy>{offered ? t("mobile.sessionSetup.waitCover") : t("mobile.sessionSetup.changeRungDetail", { count: slot.bookedPlaces })}</Copy>
          </View>
        </View>
        </Card>
        <View style={{ backgroundColor: color.attentionSoft, borderRadius: radius.card, padding: space.cardPadding }}><Copy variant="label" style={{ color: color.attentionInk }}>{t("mobile.sessionSetup.paused")}</Copy></View>
        <Copy variant="supporting">{t("mobile.sessionSetup.customerView")}</Copy>
        {future && !offered && <Button variant="destructive" label={t("mobile.sessionSetup.cancel")} disabled={!allowed} onPress={() => onAction({ kind: "cancel" })} />}
      </> : <>
        {version && setupMatches ? <Card dense>
          <SessionFact glyph="◎" title={version.format === "private" ? t("mobile.sessionSetup.private", { count: slot.capacity }) : t("mobile.sessionSetup.group", { count: slot.capacity })}
            detail={[t("mobile.laterCustomer.shortMinutes", { count: Math.round(version.durationMs / minute) }),
              t("mobile.sessionSetup.taughtIn", { language: language(version.language) }), version.venue.accessNote].join(" · ")} />
          <Separator />
          <SessionFact glyph="€" title={version.price.basis === "per_person" ? t("mobile.sessionSetup.perPerson", { price: format.money(version.price.unitMinor, version.price.currency) }) : t("mobile.sessionSetup.perAppointment", { price: format.money(version.price.unitMinor, version.price.currency) })}
            detail={`${t("mobile.sessionSetup.payProvider")} · ${version.terms.text}`} />
        </Card> : <Copy variant="supporting">{t("mobile.sessionSetup.earlierVersion")}</Copy>}
        {draft && <Card><Badge tone="attention" label={t("mobile.sessionSetup.approval")} />
          <Copy>{!slot.coordinator ? t("mobile.sessionSetup.missingCoordinator") : vacancy !== undefined ? t("mobile.sessionSetup.missingHosts") : t("mobile.sessionSetup.approvalChecks")}</Copy>
          <Button variant="quiet" label={t("mobile.sessionSetup.help")} onPress={onHelp} /></Card>}
        <Card dense>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: space.grid[2] }}>
            <Copy variant="sectionTitle">{t("mobile.sessionSetup.roster")}</Copy>
            <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.sessionSetup.hostCount", { count: confirmed.length, needed: slot.hostsRequired })}</Copy>
          </View>
          <CrewDots audience="foreman" people={assignments.map(crewRow)} />
          {slot.coordinator && <Copy>{t("mobile.sessionSetup.coordinator", { name: slot.coordinator.name })}</Copy>}
          {active && future && assignments.filter(item => item.state === "confirmed" || item.state === "proposed" && !item.cover).map(item =>
            <Button key={item.id} variant="quiet" label={item.state === "confirmed" ? t("mobile.sessionSetup.releaseNamed", { name: item.name }) : t("mobile.sessionSetup.confirmHost")}
              disabled={!allowed} onPress={() => onAction({ kind: item.state === "confirmed" ? "release_host" : "confirm_host", assignment: item })} />)}
          {canAdvance && <Button variant="neutral" label={stages[stageStep[nextStageId]]} disabled={!allowed} onPress={() => onAction({ kind: "confirm_stage", stage: nextStageId, label: stages[stageStep[nextStageId]] })} />}
        </Card>
      </>}
      {showProposal && proposalAllowed && <Card><Copy variant="sectionTitle">{t("mobile.sessionSetup.propose")}</Copy>
        {!proposalWindows.length && <Copy>{t("mobile.sessionSetup.noProposalWindows")}</Copy>}
        {proposalWindows.map(other => <ListRow key={other.id} label={absolute(other.startsAt)} description={t("mobile.sessionSetup.bookablePlaces", { count: other.placesLeft })}
          onPress={allowed ? () => onAction({ kind: "propose_change", slot: other }) : undefined} />)}
      </Card>}
      {canChooseHost && <Card><Copy variant="sectionTitle">{t("mobile.sessionSetup.ownTeam")}</Copy>
        {!directoryStatus && <Button variant="quiet" label={t("mobile.sessionSetup.findTeam")} disabled={!allowed} onPress={onOpenDirectory} />}
        {directoryStatus === "loading" && <Copy>{t("mobile.provider.loading")}</Copy>}
        {(directoryStatus === "error" || directoryStatus === "offline") && <Button variant="quiet" label={t("mobile.provider.retry")} onPress={onOpenDirectory} />}
        {candidates.map(member => <ListRow key={member.id}
          label={member.displayName} description={t("mobile.sessionSetup.eligibilityRecheck")} onPress={allowed ? () => onAction({ kind: "propose_host", membershipId: member.id, name: member.displayName, position: vacancy, language: version.language }) : undefined} />)}
        {directory?.cursor && <Button variant="quiet" label={t("mobile.sessionSetup.nextPage")} onPress={() => onPeoplePage(directory.cursor!)} />}
      </Card>}
      {roster && <Card><ListRow label={t("mobile.sessionSetup.booked", { count: slot.bookedPlaces })} description={t("mobile.sessionSetup.attendees")}
        onPress={() => { if (showAttendees && attendeesPaged) onAttendeesPage(); setShowAttendees(value => !value); }} />
        {showAttendees && <>
          {roster.attendees.map(attendee => <ListRow key={attendee.id} label={attendee.bookerName} description={t("mobile.sessionSetup.bookablePlaces", { count: attendee.places })} />)}
          {!roster.attendees.length && <Copy>{t("mobile.sessionSetup.noAttendees")}</Copy>}
          {roster.attendeesPage.cursor && <Button variant="quiet" label={t("mobile.sessionSetup.nextPage")} onPress={() => onAttendeesPage(roster.attendeesPage.cursor ?? undefined)} />}
          {attendeesPaged && <Button variant="quiet" label={t("mobile.sessionSetup.firstPage")} onPress={() => onAttendeesPage()} />}
        </>}
      </Card>}
    </>}
    {detail && (detail.slots.length > 1 || detail.page.hasMore || slotsPaged || admin && !!slot) && <Card>
      <Copy variant="sectionTitle">{t("mobile.sessionSetup.sessionTimes")}</Copy>
      {detail.slots.filter(item => item.id !== slot?.id).map(item => <ListRow key={item.id} label={absolute(item.startsAt)} onPress={() => onChooseSlot(item.id)} />)}
      {detail.page.cursor && <Button variant="quiet" label={t("mobile.sessionSetup.nextPage")} onPress={() => onSlotsPage(detail.page.cursor ?? undefined)} />}
      {slotsPaged && <Button variant="quiet" label={t("mobile.sessionSetup.firstPage")} onPress={() => onSlotsPage()} />}
      {admin && !!slot && <Button variant="neutral" label={t("mobile.sessionSetup.newSlot")} onPress={() => onEdit("new")} disabled={!allowed} />}
    </Card>}
  </Screen>;
}
