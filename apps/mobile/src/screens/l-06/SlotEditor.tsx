import type { BusinessPeople, ProviderSessionDetail, ProviderSessionRoster } from "@bookbuddy/api-contract";
import { useState } from "react";
import type { RemoteStatus } from "../../api";
import { useFormat, useT } from "../../i18n";
import { Button, Card, Dock, ListRow, Screen, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";

type Slot = ProviderSessionRoster["slot"];
type Version = NonNullable<ProviderSessionDetail["version"]>;
type SlotDraft = {
  listingVersionId: string; startsAt: number; endsAt: number; capacity: number; hostsRequired: number;
  coordinatorMembershipId: string | null;
};

function venueTime(at: number, zone: string) {
  const result = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "longOffset",
  }).formatToParts(at);
  const parts = Object.fromEntries(result.map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}${parts.timeZoneName === "GMT" ? "+00:00" : parts.timeZoneName?.slice(3)}`;
}

export function SlotEditor({ version, slot, directory, directoryStatus, busy, onBack, onDirectory, onDirectoryPage, onSave }: {
  version: Version; slot?: Slot; directory?: BusinessPeople | null; directoryStatus?: RemoteStatus; busy: boolean;
  onBack: () => void; onDirectory: () => void; onDirectoryPage?: (cursor: string) => void;
  onSave: (input: SlotDraft) => Promise<"confirmed" | "invalidated" | "uncertain">;
}) {
  const t = useT();
  const format = useFormat();
  const zone = version.venue.siteZone;
  const isPrivate = version.format === "private" && (!slot || slot.listingVersionId === version.id);
  const lockedTime = !!slot && slot.state !== "draft";
  const lockedStaffing = slot?.state === "published";
  const [start, setStart] = useState(() => slot ? venueTime(slot.startsAt, zone) : "");
  const [capacity, setCapacity] = useState(String(slot?.capacity ?? (isPrivate ? 1 : 8)));
  const [hosts, setHosts] = useState(String(slot?.hostsRequired ?? 1));
  const [coordinator, setCoordinator] = useState(slot?.coordinator ?? null);
  const [choosing, setChoosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState<"invalidated" | "uncertain" | null>(null);
  const savingNow = saving || busy;
  const staff = directory?.audience === "provider_admin" && directory.view === "active"
    ? directory.members.filter(member => member.roles.some(grant => grant.role === "foreman")) : [];
  const at = lockedTime ? slot.startsAt : Date.parse(start);
  const validTime = lockedTime || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(start) &&
    Number.isFinite(at) && venueTime(at, zone) === start);
  const spaces = Number(capacity);
  const minimum = slot ? slot.bookedPlaces + slot.heldPlaces : 0;
  const validCapacity = /^\d+$/.test(capacity) && Number.isSafeInteger(spaces) && spaces >= Math.max(1, minimum) && (!isPrivate || spaces === 1);
  const staffing = lockedStaffing ? slot.hostsRequired : Number(hosts);
  const validStaffing = /^\d+$/.test(hosts) && Number.isSafeInteger(staffing) && staffing > 0;
  const duration = slot ? slot.endsAt - slot.startsAt : version.durationMs;
  const end = validTime ? format.lines(at + duration, zone)?.site : null;
  const title = slot ? t("mobile.sessionSetup.edit") : t("mobile.sessionSetup.newSlot");
  const valid = validTime && at > Date.now() && validCapacity && validStaffing && (!lockedTime || !!coordinator);
  const editField = (set: (value: string) => void) => (value: string) => { set(value); setAttempt(null); };
  async function save() {
    if (!valid || savingNow) return;
    setSaving(true);
    try {
      const result = await onSave({ listingVersionId: slot?.listingVersionId ?? version.id, startsAt: at, endsAt: at + duration,
        capacity: spaces, hostsRequired: staffing, coordinatorMembershipId: coordinator?.membershipId ?? null });
      if (result !== "confirmed") setAttempt(result);
    } finally { setSaving(false); }
  }
  return <Screen title={title} navigation={{ kind: "back", label: t("shared.action.back"), onPress: onBack }}
    dock={<Dock primary={{ label: t("mobile.sessionSetup.saveSlot"), onPress: () => void save(), disabled: !valid, busy: savingNow }} context={lockedTime ? t("mobile.sessionSetup.changesAreProposals") : undefined} />}>
    <Copy variant="supporting">{version.title} · {version.venue.name}</Copy>
    <Card>
      <TextField label={t("mobile.sessionSetup.startTime")} value={start} onChangeText={editField(setStart)} autoCapitalize="none" readOnly={lockedTime || savingNow} />
      {!lockedTime && <Copy variant="supporting">{t("mobile.sessionSetup.startFormat", { zone })}</Copy>}
      {end && <Copy variant="supporting">{t("mobile.sessionSetup.endsAt", { time: end })}</Copy>}
      <TextField label={t("mobile.sessionSetup.capacityField")} value={capacity} onChangeText={editField(setCapacity)} inputMode="numeric" readOnly={isPrivate || savingNow} />
      {minimum > 0 && <Copy variant="supporting">{t("mobile.sessionSetup.minimumCapacity", { count: minimum })}</Copy>}
      <TextField label={t("mobile.sessionSetup.hostsField")} value={hosts} onChangeText={editField(setHosts)} inputMode="numeric" readOnly={lockedStaffing || savingNow} />
      <ListRow label={t("mobile.sessionSetup.coordinatorField")} description={coordinator?.name ?? t("mobile.sessionSetup.missingCoordinator")}
        onPress={savingNow ? undefined : () => { setChoosing(!choosing); if (!choosing && directory == null) onDirectory(); }} />
      {choosing && <>
        {directoryStatus === "loading" && <Copy>{t("mobile.provider.loading")}</Copy>}
        {(directoryStatus === "error" || directoryStatus === "offline") && <Button variant="quiet" label={t("mobile.provider.retry")} onPress={onDirectory} />}
        {directoryStatus === "ready" && !staff.length && <Copy>{t("mobile.sessionSetup.noCoordinators")}</Copy>}
        {staff.map(member => <ListRow key={member.id} label={member.displayName} onPress={() => {
          setCoordinator({ membershipId: member.id, name: member.displayName }); setChoosing(false); setAttempt(null);
        }} />)}
        {directory?.cursor && onDirectoryPage && <Button variant="quiet" label={t("mobile.sessionSetup.nextPage")} onPress={() => onDirectoryPage(directory.cursor!)} />}
      </>}
    </Card>
    {attempt && <Copy accessibilityLiveRegion="polite">{attempt === "uncertain" ? t("mobile.cover.checking") : t("mobile.sessionSetup.reviewSlot")}</Copy>}
  </Screen>;
}
