import {
  changeSessionHostRoute, getBusinessPeopleRoute, getSessionRosterRoute, getSessionRoute, listBusinessSessionsRoute,
  publishSessionRoute, sessionListingIdSchema, sessionSlotIdSchema, updateSessionRosterRoute,
  type ProviderSessionDetail, type ProviderSessionRoster,
} from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { Redirect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { useCommand, useRemote, useSeedRemote, type CommandInput } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Button, Card, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { confirmAction, type PlainMobileKey } from "../s-17/confirmAction";
import { RosterView, type RosterAction } from "./RosterView";
import { SlotEditor } from "./SlotEditor";

const minute = 60_000;
const unavailable = "/help?reason=removed" as Href;

/** Discovery is a bootstrap capability, not a read performed from Now. */
function useManagedSessions() {
  const { session, bootstrap, status } = useSession();
  const context = session?.activeContext;
  const scope = bootstrap?.capabilities?.sessions;
  const role = context?.role === "provider_admin" || context?.role === "foreman" ? context.role : null;
  return {
    businessId: role && context && "businessId" in context && scope && "businessId" in scope && scope.businessId === context.businessId ? scope.businessId : null,
    role, loading: status === "loading", actor: bootstrap?.account.displayName ?? bootstrap?.account.email ?? "",
  };
}

export function SessionListingsScreen() {
  const access = useManagedSessions();
  const router = useRouter();
  const t = useT();
  const format = useFormat();
  const [cursor, setCursor] = useState<string>();
  const remote = useRemote(listBusinessSessionsRoute, { params: { b: access.businessId ?? "" }, query: cursor ? { cursor } : undefined }, { enabled: !!access.businessId });
  if (access.loading) return null;
  if (!access.businessId || remote.error?.code === "NOT_FOUND" || remote.error?.code === "UNAUTHENTICATED") return <Redirect href={unavailable} />;
  const root = access.role === "foreman" ? "/f" : "/p";
  const nextPage = remote.data?.page.cursor;
  return <Screen title={t("mobile.sessionSetup.sessions")} navigation={{ kind: "back", label: t("shared.action.back"), onPress: () => router.canGoBack() ? router.back() : router.replace(`${root}/now` as Href) }}>
    {remote.status === "ready" ? <>
      {!remote.data.sessions.length && <Copy>{t("mobile.sessionSetup.emptyListings")}</Copy>}
      {remote.data.sessions.map(listing => {
        const next = listing.nextSlots[0];
        const at = next ? format.lines(next.startsAt, next.siteZone)?.site : null;
        return <Card key={listing.id} accessibilityLabel={[listing.version.title, at].filter(Boolean).join(" · ")}
          onPress={() => router.push(`${root}/sessions/${listing.id}/roster${next ? `?slotId=${encodeURIComponent(next.id)}` : ""}` as Href)}>
          <Copy variant="sectionTitle">{listing.version.title}</Copy>
          <Copy>{listing.version.venue.name} · {listing.version.venue.locality}</Copy>
          {at && <Copy variant="supporting">{at}</Copy>}
        </Card>;
      })}
      {nextPage && <Button variant="neutral" label={t("mobile.sessionSetup.nextPage")} onPress={() => setCursor(nextPage)} />}
      {cursor && <Button variant="quiet" label={t("mobile.sessionSetup.firstPage")} onPress={() => setCursor(undefined)} />}
    </> : remote.status === "idle" || remote.status === "loading" ? <Copy>{t("mobile.provider.loading")}</Copy>
      : <Button label={t("mobile.provider.retry")} onPress={() => void remote.refresh()} />}
  </Screen>;
}

type PublishPayload = CommandInput<typeof publishSessionRoute.input>["body"]["payload"];
type RosterPayload = CommandInput<typeof updateSessionRosterRoute.input>["body"]["payload"];
type ChangePayload = CommandInput<typeof changeSessionHostRoute.input>["body"]["payload"];
type Slot = ProviderSessionRoster["slot"];

type Reviewed = { label: string; key: PlainMobileKey; effect: string; item?: string; destructive?: boolean };

export default function SessionRosterScreen() { return <SessionWorkspace />; }
export function SessionEditorScreen() { return <SessionWorkspace editor />; }

function SessionWorkspace({ editor = false }: { editor?: boolean }) {
  const url = useLocalSearchParams<{ id: string; slotId?: string; mode?: string }>();
  const access = useManagedSessions();
  const router = useRouter();
  const t = useT();
  const format = useFormat();
  const id = sessionListingIdSchema.safeParse(url.id);
  const requestedSlot = sessionSlotIdSchema.safeParse(url.slotId);
  const enabled = !!access.businessId && id.success && (url.slotId === undefined || requestedSlot.success) && (!editor || access.role === "provider_admin");
  const [slotCursor, setSlotCursor] = useState<string>();
  const [attendeeCursor, setAttendeeCursor] = useState<string>();
  const [directory, setDirectory] = useState(false);
  const [peopleCursor, setPeopleCursor] = useState<string>();
  const [newSlotId] = useState(() => editor ? uuid.v4() : null);
  const seedRemote = useSeedRemote();
  const params = { id: id.data ?? "" };
  const detailInput = { params, query: requestedSlot.success || slotCursor ? { rosterSlotId: requestedSlot.data, cursor: slotCursor } : undefined };
  const detailRead = useRemote(getSessionRoute, detailInput, { enabled });
  const detail = detailRead.data?.audience === "provider" && detailRead.data.provider.id === access.businessId ? detailRead.data : null;
  const slot = detail?.roster?.slot ?? (requestedSlot.success ? detail?.slots.find(item => item.id === requestedSlot.data) : detail?.slots[0]);
  const rosterInput = { params, query: { slotId: slot?.id ?? "", cursor: attendeeCursor } };
  const rosterRead = useRemote(getSessionRosterRoute, rosterInput, { enabled: !!slot && !editor && (!detail?.roster || !!attendeeCursor) });
  const roster = attendeeCursor ? rosterRead.data : detail?.roster ?? rosterRead.data;
  const currentSlot = roster?.slot ?? slot;
  const people = useRemote(getBusinessPeopleRoute, { params: { b: access.businessId ?? "" }, query: { view: "active", cursor: peopleCursor } }, { enabled: !!detail && directory });
  const publish = useCommand(publishSessionRoute, { resourceId: params.id });
  const update = useCommand(updateSessionRosterRoute, { resourceId: params.id });
  const change = useCommand(changeSessionHostRoute, { resourceId: params.id });
  const busy = [publish.state, update.state, change.state].some(state => state === "sending" || state === "checking");
  const checking = [publish.state, update.state, change.state].includes("checking");
  const denied = detailRead.error?.code === "NOT_FOUND" || detailRead.error?.code === "UNAUTHENTICATED" || rosterRead.error?.code === "NOT_FOUND" || rosterRead.error?.code === "UNAUTHENTICATED";
  if (access.loading) return null;
  if (!enabled || denied || (detailRead.status === "ready" && !detail) || (requestedSlot.success && detail && !currentSlot)) return <Redirect href={unavailable} />;
  const root = access.role === "foreman" ? "/f" : "/p";
  const rosterPath = `${root}/sessions/${params.id}/roster`;
  const back = () => router.canGoBack() ? router.back() : router.replace(`${root}/sessions` as Href);
  const ready = !!detail && detailRead.status === "ready" && (!currentSlot || !!roster || editor);
  const refresh = () => {
    if (detailRead.status !== "ready" || detail?.roster || !slot || editor) void detailRead.refresh();
    else void rosterRead.refresh();
  };
  const role = access.role === "foreman" ? t("mobile.sessionSetup.coordinatorRole") : t("mobile.provider.admin");
  const zone = detail?.version?.venue.siteZone ?? "";
  const time = (at: number) => format.lines(at, zone)?.site ?? zone;
  function confirm(review: Reviewed, action: () => Promise<"confirmed" | "invalidated" | "uncertain">) {
    if (!ready || busy || !detail) return;
    confirmAction(router, { title: review.label, actionLabel: review.label, actionLabelKey: review.key,
      item: review.item ?? detail.version?.title ?? detail.provider.name, actor: access.actor, role,
      effects: [review.effect], destructive: review.destructive, onConfirm: action, onReview: refresh });
  }
  const saveResult = (data: ProviderSessionDetail, serverTime: number) => {
    detailRead.seed(data, serverTime);
    if (data.roster) {
      const slotId = data.roster.slot.id;
      seedRemote(getSessionRoute, { params, query: { rosterSlotId: slotId } }, data, serverTime);
      seedRemote(getSessionRosterRoute, { params, query: { slotId } }, data.roster, serverTime);
    }
  };
  async function runPublish(payload: PublishPayload) {
    const result = await publish.run({ params, body: { payload } });
    if (result.ok) { saveResult(result.data, result.meta.serverTime); return "confirmed" as const; }
    if (result.error.code === "INTERNAL_ERROR" || ("delivery" in result.error && result.error.delivery === "unknown")) return "uncertain" as const;
    refresh();
    return "invalidated" as const;
  }
  function acceptRoster(next: ProviderSessionRoster, serverTime: number) {
    if (!detail) return;
    const newDetail = { ...detail, roster: next, slots: detail.slots.map(item => item.id === next.slot.id ? next.slot : item) };
    detailRead.seed(newDetail, serverTime);
    seedRemote(getSessionRosterRoute, { params, query: { slotId: next.slot.id } }, next, serverTime);
    setAttendeeCursor(undefined);
  }
  async function runRoster(payload: RosterPayload | Extract<ChangePayload, { kind: "propose_change" }>) {
    const result = payload.kind === "propose_change" ? await change.run({ params, body: { payload } }) : await update.run({ params, body: { payload } });
    if (result.ok) { acceptRoster(result.data, result.meta.serverTime); return "confirmed" as const; }
    if (result.error.code === "INTERNAL_ERROR" || ("delivery" in result.error && result.error.delivery === "unknown")) return "uncertain" as const;
    refresh();
    return "invalidated" as const;
  }
  function act(action: RosterAction) {
    if (!detail || !currentSlot) return;
    const target = { slotId: currentSlot.id, slotRevision: currentSlot.revision };
    if (action.kind === "publish") {
      confirm({ key: "mobile.sessionSetup.publish", label: t("mobile.sessionSetup.publish"), effect: t("mobile.sessionSetup.publishEffect") },
        () => runPublish({ kind: "publish", ...target, listingVersionId: currentSlot.listingVersionId }));
    } else if (action.kind === "cancel") {
      confirm({ key: "mobile.sessionSetup.cancel", label: t("mobile.sessionSetup.cancel"), effect: t("mobile.sessionSetup.cancelEffect"), destructive: true },
        () => runPublish({ kind: "cancel", ...target }));
    } else if (action.kind === "propose_change") {
      const proposed = action.slot;
      const respondBy = Math.min(Date.now() + 24 * 60 * minute, currentSlot.startsAt, proposed.startsAt);
      confirm({ key: "mobile.sessionSetup.propose", label: t("mobile.sessionSetup.propose"), item: `${detail.version?.title ?? ""} · ${time(proposed.startsAt)}`,
        effect: t("mobile.sessionSetup.proposalEffect", { time: time(respondBy) }) }, () => runRoster({ kind: "propose_change", ...target,
          proposedSlotId: proposed.id, proposedListingVersionId: proposed.listingVersionId, respondBy }));
    } else if (action.kind === "propose_host") {
      const cover = currentSlot.state !== "draft";
      const label = cover ? t("mobile.sessionSetup.offer") : t("mobile.sessionSetup.proposeHost");
      const offerExpiresAt = cover ? Math.min(Date.now() + 15 * minute, currentSlot.startsAt - 5 * minute) : undefined;
      if (offerExpiresAt !== undefined && offerExpiresAt - Date.now() < 5 * minute) return;
      confirm({ key: cover ? "mobile.sessionSetup.offer" : "mobile.sessionSetup.proposeHost", label, item: action.name,
        effect: offerExpiresAt ? t("mobile.sessionSetup.offerEffect", { time: time(offerExpiresAt) }) : t("mobile.sessionSetup.hostEffect") },
      () => runRoster({ kind: "propose_host", ...target, id: uuid.v4(), membershipId: action.membershipId, position: action.position,
        roleLabel: t("mobile.sessionSetup.hostRole"), language: action.language, offerExpiresAt }));
    } else if (action.kind === "confirm_stage") {
      confirm({ key: "mobile.sessionSetup.confirmStage", label: t("mobile.sessionSetup.confirmStage"), item: action.label, effect: t("mobile.sessionSetup.stageEffect") },
        () => runRoster({ kind: "confirm_stage", ...target, stage: action.stage }));
    } else {
      const releasing = action.kind === "release_host";
      confirm({ key: releasing ? "mobile.sessionSetup.releaseHost" : "mobile.sessionSetup.confirmHost", item: action.assignment.name,
        label: releasing ? t("mobile.sessionSetup.releaseHost") : t("mobile.sessionSetup.confirmHost"), destructive: releasing,
        effect: releasing ? t("mobile.sessionSetup.releaseEffect") : t("mobile.sessionSetup.confirmEffect") },
      () => runRoster({ kind: action.kind, ...target, assignmentId: action.assignment.id }));
    }
  }
  const edit = (mode: "new" | "edit") => router.push(`/p/sessions/${params.id}/editor?${new URLSearchParams({ mode, ...(currentSlot && { slotId: currentSlot.id }) })}` as Href);
  if (editor && ready && detail?.version) {
    return <SlotEditor key={`${params.id}:${slot?.id}:${url.mode}`} version={detail.version} slot={url.mode === "new" ? undefined : slot}
      directory={people.data} directoryStatus={people.status} onDirectory={() => directory ? void people.refresh() : setDirectory(true)}
      onDirectoryPage={cursor => setPeopleCursor(cursor)}
      onBack={back} busy={busy} onSave={async input => {
        const slotId = url.mode === "new" || !slot ? newSlotId! : slot.id;
        const result = await runPublish({ kind: "save_slot", ...input, slotId, slotRevision: url.mode === "new" ? null : slot?.revision ?? null });
        if (result === "confirmed") router.dismissTo(`${rosterPath}?slotId=${encodeURIComponent(slotId)}` as Href);
        return result;
      }} />;
  }
  return <RosterView key={currentSlot?.id ?? params.id} detail={detail} slot={currentSlot} roster={roster} role={role}
    status={detail && slot && !roster ? rosterRead.status : detailRead.status} busy={busy} checking={checking}
    directory={directory ? people.data : undefined} directoryStatus={directory ? people.status : undefined}
    onOpenDirectory={() => directory ? void people.refresh() : setDirectory(true)}
    onPeoplePage={cursor => setPeopleCursor(cursor)} onAction={act} onBack={back} onRetry={refresh}
    onAttendeesPage={cursor => setAttendeeCursor(cursor)} attendeesPaged={attendeeCursor !== undefined}
    onSlotsPage={cursor => { setSlotCursor(cursor); if (requestedSlot.success) router.setParams({ slotId: undefined }); }} slotsPaged={slotCursor !== undefined}
    onChooseSlot={id => { setAttendeeCursor(undefined); setSlotCursor(undefined); router.setParams({ slotId: id }); }} onEdit={edit}
    onHelp={() => router.push("/help?reason=pending" as Href)} />;
}

export type { Slot };
