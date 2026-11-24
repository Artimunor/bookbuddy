import { businessPeopleSchema, providerSessionDetailSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { RosterView } from "./RosterView";
import { SlotEditor } from "./SlotEditor";

const minute = 60_000;
const start = Date.UTC(2026, 10, 28, 9);
const now = Date.UTC(2026, 10, 27, 17, 5);
const confirmed = { at: Date.UTC(2026, 10, 25, 10), byName: "Marina Serra" };
const slot = { id: "pilates-sat10", listingVersionId: "pilates-v1", startsAt: start, endsAt: start + 45 * minute, capacity: 8,
  state: "published", day: null, revision: 1, hostsRequired: 1, heldPlaces: 0, bookedPlaces: 6, placesLeft: 2,
  coordinator: { membershipId: "marina", name: "Marina Serra" } } as const;
const elena = { id: "elena-assignment", membershipId: "elena", name: "Elena Costa", position: 1, roleLabel: "Host", language: "en", state: "confirmed", changed: confirmed, cover: null } as const;
const lucia = { id: "lucia-assignment", membershipId: "lucia", name: "Lucía Vidal", position: 1, roleLabel: "Host", language: "en", state: "released", changed: { at: now - 13 * minute, byName: "Lucía Vidal" }, cover: { status: "declined", expiresAt: now - 3 * minute, repliedAt: now - 13 * minute } } as const;
const laterSlot = { ...slot, id: "pilates-sun10", startsAt: start + 24 * 60 * minute, endsAt: start + (24 * 60 + 45) * minute, placesLeft: 8, bookedPlaces: 0 };
const model = {
  id: "pilates", provider: { id: "estudi-mar", name: "Estudi Mar Pilates" }, category: "pilates", audience: "provider", revision: 1,
  version: { id: "pilates-v1", no: 1, title: "Mat Pilates", description: "Small group mat class", originalLocale: "en", language: "en",
    format: "group", durationMs: 45 * minute, hostGuaranteed: false, guaranteedHostMembershipId: null,
    venue: { id: "estudi-venue", name: "Estudi Mar Pilates", locality: "Xàbia", siteZone: "Europe/Madrid", accessNote: "Step-free entry", address: "Estudi Mar, Xàbia", arrivalNote: "Check in at reception" },
    price: { currency: "EUR", unitMinor: 1600, basis: "per_person", paymentMethod: "pay_provider" },
    terms: { text: "Free to cancel or move until 24 hours before.", locale: "en", hash: "terms-v1", cancellationNoticeMs: 24 * 60 * minute },
  },
  page: { cursor: null, hasMore: false }, slots: [slot, laterSlot],
  actions: { publish: true, roster: true, changeHost: true, recordAttendance: true },
};
const attendees = [{ id: "booking-s1042", bookerName: "Claire Martin", places: 1, attendance: null }, { id: "booking-s1043", bookerName: "Helena Santos", places: 3, attendance: null }, { id: "booking-s1044", bookerName: "Luis Torres", places: 2, attendance: null }];
const roster = { slot, assignments: [elena], attendees, attendeesPage: { cursor: null, hasMore: false } };
const gap = { ...slot, state: "paused", placesLeft: 0, revision: 3 } as const;
const released = { ...elena, state: "released", changed: { at: now - 35 * minute, byName: "Elena Costa" } } as const;
const directory = businessPeopleSchema.parse({ audience: "foreman", businessId: "estudi-mar", members: [], hasMore: false, cursor: null });
const web = globalThis as typeof globalThis & { history?: { back: () => void } };
const back = () => { web.history?.back(); };
const stay = () => {};
const props = { role: "Provider admin", status: "ready", busy: false, now, onAction: stay, onBack: back, onRetry: stay,
  onOpenDirectory: stay, onPeoplePage: stay, onSlotsPage: stay, onAttendeesPage: stay, onChooseSlot: stay, onEdit: stay, onHelp: stay } as const;
function view(current: unknown, assignments: unknown, mode: "admin" | "coordinator" = "admin", exhausted = false) {
  const parsed = providerSessionDetailSchema.parse({ ...model, slots: mode === "coordinator" ? [current] : [current, laterSlot],
    roster: { ...roster, slot: current, assignments }, actions: { ...model.actions, publish: mode === "admin" } });
  return <RosterView {...props} detail={parsed} slot={parsed.roster?.slot} roster={parsed.roster}
    role={mode === "coordinator" ? "Coordinator" : props.role}
    directoryStatus={exhausted ? "ready" : undefined} directory={exhausted ? directory : undefined} />;
}
export const previews: ScreenPreview[] = [
  { id: "L-06", state: "published", render: () => view(slot, [elena]) },
  { id: "L-06", state: "full", render: () => view({ ...slot, placesLeft: 0, bookedPlaces: 8 }, [elena]) },
  { id: "L-06", state: "draft", render: () => view({ ...slot, state: "draft", bookedPlaces: 0, placesLeft: 8, coordinator: null }, []) },
  { id: "L-06", state: "needs-approval", render: () => view({ ...slot, state: "draft", bookedPlaces: 0, placesLeft: 8 }, [elena]) },
  { id: "L-06", state: "cover-unavailable", render: () => view(gap, [released, lucia], "coordinator", true) },
  { id: "L-06", state: "offers-out", render: () => view(gap, [released, { ...lucia, state: "proposed", cover: { status: "offered", expiresAt: now + 10 * minute, repliedAt: null } }], "coordinator") },
  { id: "L-06", state: "accepted", render: () => view(gap, [released, { ...lucia, state: "proposed", cover: { status: "accepted", expiresAt: now + 10 * minute, repliedAt: now } }], "coordinator") },
  { id: "L-06", state: "slot-editor", render: () => {
    const detail = providerSessionDetailSchema.parse({ ...model, roster });
    return <SlotEditor version={detail.version!} slot={detail.slots[0]} busy={false} onBack={back} onDirectory={stay} onSave={async () => "invalidated"} />;
  } },
];
