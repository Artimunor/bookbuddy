import { createPlaceRoute, getPlaceRoute, invitePlacePersonRoute, patchPlacePersonRoute, patchPlaceRoute, reissueInvitationRoute, withdrawInvitationRoute, type PlaceDetails, type PlacePersonPatch } from "@bookbuddy/api-contract";
import { looksLikeAccessCode } from "@bookbuddy/domain";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, BookingCard, Button, Card, Dock, ListRow, Screen, SwitchRow, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { JobLine } from "../../ui/live/JobLine";
import { confirmAction, type ConfirmResult } from "../s-17/confirmAction";
import { useOffline } from "../s-02/flow";

type Draft = { alias: string; address: string; note: string };
type Mode = "view" | "edit" | "invite";
type Person = PlaceDetails["people"][number];
type PersonGrant = { view: boolean; message: boolean; approve: boolean; successorAccountId?: Person["accountId"] };

function personGrant(person: Person): PersonGrant {
  return { view: person.isOwner || person.capabilities.includes("view"), message: person.capabilities.includes("message"), approve: person.isNamedApprover };
}

function grantPatch(person: Person, next: PersonGrant): PlacePersonPatch {
  const current = personGrant(person);
  return {
    ...(next.view !== current.view ? { view: next.view } : {}),
    ...(next.message !== current.message ? { message: next.message } : {}),
    ...(next.approve !== current.approve ? { approve: next.approve, ...(next.approve ? {} : { successorAccountId: next.successorAccountId }) } : {}),
  };
}

function canEditPeople(place: PlaceDetails) {
  return place.relationship === "owner" && (place.state === "in_area" || place.state === "out_of_area");
}

export default function PlaceScreen() {
  const router = useRouter();
  const { placeId, returnTo, draftId } = useLocalSearchParams<{ placeId: string; returnTo?: string; draftId?: string }>();
  const isNew = placeId === "new";
  const remote = useRemote(getPlaceRoute, { params: { p: placeId ?? "" } }, { enabled: !!placeId && !isNew });
  const create = useCommand(createPlaceRoute);
  const patch = useCommand(patchPlaceRoute);
  const invite = useCommand(invitePlacePersonRoute);
  const [personDraft, setPersonDraft] = useState<{ source: PlaceDetails; person: Person; value: PersonGrant } | null>(null);
  const patchPerson = useCommand(patchPlacePersonRoute, { resourceId: placeId && personDraft ? [placeId, personDraft.person.accountId] : undefined });
  const reissue = useCommand(reissueInvitationRoute);
  const withdraw = useCommand(withdrawInvitationRoute);
  const { bootstrap } = useSession();
  const t = useT();
  const offline = useOffline();
  const [updated, setUpdated] = useState<{ source: PlaceDetails; value: PlaceDetails } | null>(null);
  const [mode, setMode] = useState<Mode>(isNew ? "edit" : "view");
  const [draft, setDraft] = useState<Draft>({ alias: "", address: "", note: "" });
  const [draftSource, setDraftSource] = useState<PlaceDetails | null>(null);
  const [inviteSource, setInviteSource] = useState<PlaceDetails | null>(null);
  const [email, setEmail] = useState("");
  const [selectedInvite, setSelectedInvite] = useState<string | null>(null);
  const wasOffline = useRef(false);
  useEffect(() => {
    if (offline) { wasOffline.current = true; return; }
    if (wasOffline.current && !isNew) { wasOffline.current = false; void remote.refresh(); }
  }, [offline, isNew, remote.refresh]);
  useEffect(() => {
    if (remote.error?.code === "NOT_FOUND" || remote.error?.code === "UNAUTHENTICATED") router.replace("/help" as Href);
  }, [remote.error, router]);
  const read = remote.status === "ready" && !offline ? remote.data : null;
  const liveRead = useRef<PlaceDetails | null>(read);
  liveRead.current = read;
  useEffect(() => {
    setUpdated(null);
    if (!isNew) {
      setMode("view");
      setDraft({ alias: "", address: "", note: "" });
      setDraftSource(null);
      setInviteSource(null);
      setEmail("");
      setSelectedInvite(null);
      setPersonDraft(null);
    }
  }, [placeId, read, isNew]);
  const place = read ? (updated?.source === read ? updated.value : read) : null;
  const livePlace = useRef(place);
  livePlace.current = place;
  const editor = personDraft && personDraft.source === place && canEditPeople(place) ? personDraft : null;
  const visibleMode = !isNew && ((mode === "edit" && (!read || draftSource !== read)) || (mode === "invite" && (!read || inviteSource !== read))) ? "view" : mode;
  const states = [create.state, patch.state, invite.state, patchPerson.state, reissue.state, withdraw.state];
  const checking = states.includes("checking");
  const busy = checking || states.includes("sending");
  const failed = states.includes("failed") || states.includes("conflict");
  const codeWarning = looksLikeAccessCode(draft.note);
  function edit() { if (place && read) { setDraftSource(read); setDraft({ alias: place.alias, address: place.address ?? "", note: place.safeArrivalNote ?? "" }); setMode("edit"); } }
  async function save() {
    const payload = { alias: draft.alias.trim(), address: draft.address.trim(), safeArrivalNote: draft.note.trim() || null };
    if (!payload.alias || !payload.address || codeWarning || busy) return;
    if (isNew) {
      const result = await create.run({ body: { payload } });
      if (result.ok) router.replace((returnTo === "request" && typeof draftId === "string" ? `/c/request/place?draftId=${encodeURIComponent(draftId)}&placeId=${result.data.id}` : `/c/places/${result.data.id}`) as Href);
    } else if (place && read && draftSource === read) {
      const source = read;
      const result = await patch.run({ params: { p: place.id }, body: { expectedRevision: place.revision, payload } });
      if (result.ok && liveRead.current === source) { setUpdated({ source, value: result.data }); setMode("view"); }
    }
  }
  async function sendInvite() {
    if (!place || !email.trim() || busy) return;
    const result = await invite.run({ params: { p: place.id }, body: { expectedRevision: place.revision, payload: { email: email.trim() } } });
    if (result.ok) { setMode("view"); setEmail(""); await remote.refresh(); }
  }
  async function invitationAction(id: string, action: "reissue" | "withdraw") {
    if (busy) return;
    const result = await (action === "reissue" ? reissue : withdraw).run({ params: { id }, body: { payload: {} } });
    if (result.ok) { setSelectedInvite(null); await remote.refresh(); }
  }
  function editPerson(person: Person) {
    if (!place || !canEditPeople(place) || busy) return;
    setPersonDraft(editor?.person.accountId === person.accountId ? null : { source: place, person, value: personGrant(person) });
  }
  function savePerson() {
    if (!editor || !place || busy) return;
    const payload = grantPatch(editor.person, editor.value);
    if (!Object.keys(payload).length) return;
    const successor = payload.approve === true ? editor.person : payload.approve === false
      ? place.people.find(person => person.accountId === payload.successorAccountId)
      : undefined;
    if (payload.approve !== undefined && (!place.actions.changeApprover || !successor)) return;
    const save = async (): Promise<ConfirmResult> => {
      if (livePlace.current !== place) return "invalidated";
      const result = await patchPerson.run({
        params: { p: place.id, person: editor.person.accountId },
        body: { expectedRevision: place.revision, payload },
      });
      if (result.ok) {
        if (livePlace.current === place) {
          remote.seed(result.data, result.meta.serverTime);
          setPersonDraft(null);
        }
        return "confirmed";
      }
      return ("delivery" in result.error && result.error.delivery === "unknown") || result.error.code === "INTERNAL_ERROR" ? "uncertain" : "invalidated";
    };
    if (!successor) { void save(); return; }
    const label = t("mobile.places.changeApprover");
    confirmAction(router, {
      title: label, actionLabel: label, actionLabelKey: "mobile.places.changeApprover",
      item: `${place.alias} · ${editor.person.displayName}`, actor: bootstrap?.account.displayName ?? place.ownerDisplayName ?? "", role: t("mobile.places.owner"),
      effects: [t("mobile.places.changeEffect"), successor.displayName,
        ...(payload.view === undefined ? [] : [`${editor.person.displayName} · ${payload.view ? t("mobile.places.grantView") : t("mobile.places.removeView")}`]),
        ...(payload.message === undefined ? [] : [`${editor.person.displayName} · ${payload.message ? t("mobile.places.grantMessage") : t("mobile.places.removeMessage")}`])],
      onReview: () => { void remote.refresh(); }, onConfirm: save,
    });
  }
  const status = offline ? "offline" : isNew ? "ready" : remote.status;
  return <PlaceView place={place} isNew={isNew} status={status} mode={visibleMode} draft={draft} setDraft={setDraft} email={email} setEmail={setEmail}
    busy={busy} checking={checking} failed={failed} codeWarning={codeWarning} selectedInvite={selectedInvite} setSelectedInvite={setSelectedInvite}
    onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} onEdit={edit}
    onCancel={() => isNew ? router.back() : setMode("view")} onSave={() => { void save(); }} onInvite={() => { if (read) { setInviteSource(read); setMode("invite"); } }}
    onSend={() => { void sendInvite(); }} onEditPerson={editPerson} onInvitation={(id, action) => { void invitationAction(id, action); }}
    personEditor={editor ? { person: editor.person, value: editor.value, onChange: value => setPersonDraft({ ...editor, value }), onSave: savePerson, onCancel: () => setPersonDraft(null) } : undefined}
    onBooking={(id) => router.push(`/c/jobs/${id}` as Href)} />;
}

type PersonEditor = { person: Person; value: PersonGrant; onChange: (value: PersonGrant) => void; onSave: () => void; onCancel: () => void };

function PersonGrantFields({ editor, place, busy }: { editor: PersonEditor; place: PlaceDetails; busy: boolean }) {
  const t = useT();
  const { person, value, onChange, onSave, onCancel } = editor;
  const patch = grantPatch(person, value);
  const needsSuccessor = person.isNamedApprover && !value.approve;
  const successors = needsSuccessor ? place.people.filter(candidate => candidate.accountId !== person.accountId && personGrant(candidate).view) : [];
  return <Card>
    <Copy variant="sectionTitle">{t("mobile.places.editGrant")}</Copy>
    <SwitchRow label={t("mobile.places.view")} value={value.view} disabled={busy || person.isOwner || value.approve}
      onValueChange={view => onChange({ ...value, view, message: view && value.message })} />
    <SwitchRow label={t("mobile.places.message")} value={value.message} disabled={busy || !value.view}
      onValueChange={message => onChange({ ...value, message })} />
    <SwitchRow label={t("mobile.places.approver")} value={value.approve} disabled={busy || !place.actions.changeApprover || (!value.view && !person.isNamedApprover)}
      onValueChange={approve => onChange({ ...value, approve, view: approve || value.view, successorAccountId: undefined })} />
    {needsSuccessor && <>
      <Copy>{t("mobile.places.chooseSuccessor")}</Copy>
      {successors.map(candidate => <Button key={candidate.accountId} variant={value.successorAccountId === candidate.accountId ? "primary" : "neutral"} label={candidate.displayName}
        disabled={busy} onPress={() => onChange({ ...value, successorAccountId: candidate.accountId })} />)}
    </>}
    <Button label={t("mobile.places.save")} onPress={onSave} disabled={busy || !Object.keys(patch).length || (needsSuccessor && !value.successorAccountId)} />
    <Button variant="quiet" label={t("mobile.places.cancel")} onPress={onCancel} disabled={busy} />
  </Card>;
}

export function PlaceView({ place, isNew, status, mode, draft, setDraft, email, setEmail, busy, checking, failed, codeWarning, selectedInvite, setSelectedInvite, onBack, onRetry, onEdit, onCancel, onSave, onInvite, onSend, onEditPerson, personEditor, onInvitation, onBooking }: {
  place: PlaceDetails | null; isNew: boolean; status: "idle" | "loading" | "ready" | "error" | "offline"; mode: Mode; draft: Draft; setDraft: (value: Draft) => void;
  email: string; setEmail: (value: string) => void; busy: boolean; checking: boolean; failed: boolean; codeWarning: boolean;
  selectedInvite: string | null; setSelectedInvite: (id: string | null) => void;
  onBack: () => void; onRetry: () => void; onEdit: () => void; onCancel: () => void; onSave: () => void; onInvite: () => void; onSend: () => void;
  personEditor?: PersonEditor; onEditPerson: (person: Person) => void; onInvitation: (id: string, action: "reissue" | "withdraw") => void; onBooking: (id: string) => void;
}) {
  const format = useFormat();
  const t = useT();
  const capabilities = { view: t("mobile.places.view"), message: t("mobile.places.message"), request: t("mobile.places.request"), book: t("mobile.places.book"), approve: t("mobile.places.approve"), sign_off: t("mobile.places.signOff"), bill_view: t("mobile.places.billView"), delegate: t("mobile.places.delegate") };
  const stages = [t("mobile.places.requested"), t("mobile.places.quoted"), t("mobile.places.booked"), t("mobile.places.visit"), t("mobile.places.signedOff"), t("mobile.places.paid")] as const;
  const stepNames = ["requested", "quoted", "booked", "visit", "signed_off", "paid"];
  const dock = status !== "ready" ? undefined : mode === "edit" ? <Dock primary={{ label: t("mobile.places.save"), onPress: onSave, disabled: busy || codeWarning || !draft.alias.trim() || !draft.address.trim() }} secondary={{ label: t("mobile.places.cancel"), onPress: onCancel, disabled: busy }} /> : mode === "invite" ? <Dock primary={{ label: t("mobile.places.sendInvite"), onPress: onSend, disabled: busy || !email.trim() }} secondary={{ label: t("mobile.places.cancel"), onPress: onCancel, disabled: busy }} /> : place?.actions.invite ? <Dock primary={{ label: t("mobile.places.invite"), onPress: onInvite, disabled: busy }} /> : undefined;
  return <Screen title={place?.alias ?? (isNew ? t("mobile.places.add") : t("mobile.places.title"))} navigation={{ kind: "back", label: t("mobile.places.back"), onPress: onBack }} dock={dock}>
    {status === "offline" && <Copy>{t("mobile.places.offline")}</Copy>}
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.places.loading")}</Copy>}
    {status === "error" && <><Copy>{t("mobile.places.unavailable")}</Copy><Button label={t("mobile.places.retry")} onPress={onRetry} /></>}
    {status === "ready" && <>
      {checking && <Copy>{t("mobile.places.checking")}</Copy>}{!checking && failed && <Copy>{t("mobile.places.failed")}</Copy>}
      {mode === "edit" && <><TextField label={t("mobile.places.name")} value={draft.alias} onChangeText={(alias) => setDraft({ ...draft, alias })} maxLength={100} disabled={busy} />
        <TextField label={t("mobile.places.address")} value={draft.address} onChangeText={(address) => setDraft({ ...draft, address })} autoComplete="street-address" maxLength={500} disabled={busy} />
        <TextField label={t("mobile.places.note")} value={draft.note} onChangeText={(note) => setDraft({ ...draft, note })} multiline maxLength={500} helper={t("mobile.places.noCodes")} error={codeWarning ? t("mobile.places.codeWarning") : undefined} disabled={busy} /></>}
      {mode === "invite" && <><Copy>{t("mobile.places.inviteInfo")}</Copy><TextField label={t("mobile.places.email")} value={email} onChangeText={setEmail} autoComplete="email" autoCapitalize="none" inputMode="email" disabled={busy} /></>}
      {mode === "view" && place && <>
        <Copy variant="supporting">{[place.areaName, place.siteZone].filter(Boolean).join(" · ")}</Copy>
        {place.relationship !== "owner" && place.ownerDisplayName && <Copy>{t("mobile.places.managed", { name: place.ownerDisplayName })}</Copy>}
        {place.actions.edit && <Button variant="quiet" label={t("mobile.places.edit")} onPress={onEdit} disabled={busy} />}
        <Card><Copy variant="supporting">{t("mobile.places.address")}</Copy><Copy>{place.address}</Copy><Copy variant="supporting">{t("mobile.places.note")}</Copy><Copy>{place.safeArrivalNote}</Copy><Copy variant="supporting">{t("mobile.places.noCodes")}</Copy></Card>
        <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.places.people")}</Copy>
        <Card>{[...place.people].sort((a,b) => Number(b.isOwner || b.isNamedApprover) - Number(a.isOwner || a.isNamedApprover)).map((person) => <View key={person.accountId}>
          <ListRow label={person.displayName} description={[person.isOwner ? t("mobile.places.owner") : null, person.isNamedApprover ? t("mobile.places.approver") : null, ...person.capabilities.map((c) => capabilities[c])].filter(Boolean).join(" · ")}
            onPress={canEditPeople(place) && !busy ? () => onEditPerson(person) : undefined} />
          {personEditor?.person.accountId === person.accountId && <PersonGrantFields editor={personEditor} place={place} busy={busy} />}
        </View>)}
          {place.pendingInvitations?.map((invitation) => <Card key={invitation.id}><ListRow label={invitation.email} description={t("mobile.places.sent", { date: format.lines(invitation.issuedAt, invitation.siteZone)?.site ?? "" })} onPress={() => setSelectedInvite(selectedInvite === invitation.id ? null : invitation.id)} /><Badge label={t("mobile.places.pending")} />
            {selectedInvite === invitation.id && <>{invitation.reissue.status === "available" && <Button variant="quiet" label={t("mobile.places.resend")} onPress={() => onInvitation(invitation.id, "reissue")} disabled={busy} />}{invitation.canWithdraw && <Button variant="quiet" label={t("mobile.places.withdraw")} onPress={() => onInvitation(invitation.id, "withdraw")} disabled={busy} />}</>}</Card>)}
        </Card>
        <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.places.bookings")}</Copy>
        {!place.bookings.length && <Copy>{t("mobile.places.noBookings")}</Copy>}
        {place.bookings.map((booking) => { const index = Math.max(0, stepNames.indexOf(booking.journeyStep)) as 0|1|2|3|4|5; const stage = booking.state === "cancelled" ? t("mobile.places.cancelled") : stages[index]; const label = t("mobile.places.step", { step: index + 1, stage }); return <BookingCard key={booking.jobId} title={booking.title} place={booking.reference} stage={stage} accessibilityLabel={[booking.title, booking.reference, label].join(", ")} onPress={() => onBooking(booking.jobId)} progress={<JobLine kind="journey" steps={stages} current={index} accessibilityLabel={label} activity="quiet" compact pulse={false} />} />; })}
      </>}
    </>}
  </Screen>;
}
