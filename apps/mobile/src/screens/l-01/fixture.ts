import { customerSessionBookingSchema, customerSessionCardSchema, customerSessionDetailSchema, sessionHoldProjectionSchema } from "@bookbuddy/api-contract";

export const viewerZone = "Europe/London";
export const siteZone = "Europe/Madrid";
export const startsAt = Date.UTC(2026, 10, 28, 9);
const endsAt = startsAt + 45 * 60_000;
const bookedAt = Date.UTC(2026, 10, 23, 9, 42);
export const heldAt = Date.UTC(2026, 10, 23, 9, 41);
const provider = { id: "studio", name: "Estudi Mar Pilates" };
const host = { name: "Elena Costa", language: "en", confirmed: { at: Date.UTC(2026, 10, 23, 8, 30), byName: "Marina Serra" } };
const listing = { id: "mat-pilates", category: "pilates", provider };
const venue = { id: "estudi-mar", name: provider.name, locality: "Xàbia", siteZone, accessNote: "Step-free entry" };
const cardVersion = { id: "version-1", title: "Mat Pilates", venue, durationMs: 45 * 60_000, format: "group", language: "en",
  price: { currency: "EUR", unitMinor: 1600, basis: "per_person", paymentMethod: "pay_provider" } };
const version = { ...cardVersion, venue: { ...venue, address: "Carrer del Mar, 12", arrivalNote: "Check in at reception. Arrive by 09:50." },
  description: "An open-level mat Pilates class.", originalLocale: "en", hostGuaranteed: false,
  terms: { text: "Pay at the studio. You can move or cancel for free before the session starts.", locale: "en", cancellationNoticeMs: 0, hash: "terms-1" } };
const firstSlot = { id: "morning", listingVersionId: version.id, startsAt, endsAt, capacity: 8, placesLeft: 3, state: "published" };
const laterSlot = { ...firstSlot, id: "late-morning", startsAt: startsAt + 90 * 60_000, endsAt: endsAt + 90 * 60_000, placesLeft: 5 };
const sundaySlot = { ...firstSlot, id: "sunday", startsAt: startsAt + 86_400_000, endsAt: endsAt + 86_400_000, placesLeft: 4 };
const slots = [firstSlot, laterSlot, sundaySlot].map(slot => ({ ...slot, host, freeCancellationUntil: slot.startsAt }));
export const detail = customerSessionDetailSchema.parse({ ...listing, audience: "customer", availability: "available", nextSlotId: firstSlot.id,
  versions: [version], slots, page: { cursor: null, hasMore: false } });
export const fullDetail = customerSessionDetailSchema.parse({ ...detail, availability: "full", slots: slots.map(slot => ({ ...slot, placesLeft: 0 })) });
export const pausedDetail = customerSessionDetailSchema.parse({ ...detail, availability: "paused", slots: slots.map(slot => ({ ...slot, state: "paused" })) });
export const categories = ["pilates", "massage", "sport-coaching", "tours"];
export const cards = [
  customerSessionCardSchema.parse({ ...listing, version: cardVersion, nextSlot: firstSlot }),
  ...[
    { id: "massage", title: "Relaxation massage", name: "Calma Massage", unitMinor: 4800, format: "private", language: "es", duration: 60, start: Date.UTC(2026, 10, 28, 15) },
    { id: "sport-coaching", title: "Tennis coaching", name: "Arenal Tennis", unitMinor: 3200, format: "private", language: "en", duration: 45, start: Date.UTC(2026, 10, 29, 8) },
    { id: "tours", title: "Old town walking tour", name: "Rutes Xàbia", unitMinor: 2200, format: "group", language: "en", duration: 80, start: Date.UTC(2026, 10, 29, 9) },
  ].map(({ id, name, title, unitMinor, format, language, start, duration }) => customerSessionCardSchema.parse({ id, category: id, provider: { id, name },
    version: { ...cardVersion, id: `${id}-version`, title, format, language, durationMs: duration * 60_000, venue: { ...venue, id, name },
      price: { ...cardVersion.price, unitMinor, basis: format === "private" ? "per_appointment" : "per_person" } },
    nextSlot: { ...firstSlot, id: `${id}-slot`, listingVersionId: `${id}-version`, startsAt: start, endsAt: start + duration * 60_000,
      capacity: format === "private" ? 1 : 8, placesLeft: format === "private" ? 1 : 4 },
  })),
];
const agreement = { slotId: firstSlot.id, startsAt, endsAt, version, places: 1, totalMinor: 1600, freeCancellationUntil: startsAt };
export const hold = sessionHoldProjectionSchema.parse({ status: "held", id: "held-place", listingId: listing.id, provider, bookerName: "Claire Martin",
  expiresAt: heldAt + 7 * 60_000, agreement, host, moveFrom: null });
export const booking = customerSessionBookingSchema.parse({ id: "booked-place", reference: "BB-S1042", listingId: listing.id, provider, revision: 1,
  state: "booked", bookerName: hold.bookerName, bookedAt, original: { slotId: firstSlot.id, listingVersionId: version.id, termsHash: version.terms.hash }, agreement,
  day: null, host: { status: "confirmed", host, isSubstitute: false }, coordinatorName: "Marina Serra", threadId: "session-04413edc7996425fadb02bd82f312949", proposal: null, cancellation: null,
  actions: { move: true, cancel: true, respond: false, leaveFeedback: false } });
export const todayBooking = customerSessionBookingSchema.parse({ ...booking, day: { stage: "today", at: startsAt - 90 * 60_000, byName: host.name } });
export const substituteBooking = customerSessionBookingSchema.parse({ ...booking, host: { status: "confirmed", isSubstitute: true,
  host: { name: "Lucía Vidal", language: "en", confirmed: { at: Date.UTC(2026, 10, 27, 17, 10), byName: "Marina Serra" } } } });
export const proposedBooking = customerSessionBookingSchema.parse({ ...booking, actions: { move: false, cancel: true, respond: true, leaveFeedback: false },
  proposal: { id: "proposal-1", version: 1, state: "pending", respondBy: Date.UTC(2026, 10, 27, 9),
    proposed: { ...agreement, slotId: laterSlot.id, startsAt: laterSlot.startsAt, endsAt: laterSlot.endsAt, freeCancellationUntil: laterSlot.startsAt },
    sent: { at: Date.UTC(2026, 10, 26, 9, 30), byName: "Marina Serra" }, decidedAt: null } });
export const noop = () => undefined;
