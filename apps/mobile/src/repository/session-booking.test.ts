import { scopeHeaderSchema } from "@bookbuddy/api-contract";
import type { SyncProjection } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { context, page, testRepository } from "./sqlite.test-kit";

const bookingId = "booking";
const venue = { id: "venue", name: "Mar Studio", locality: "Cascais", siteZone: "Europe/Lisbon",
  accessNote: "private gate code", address: "7 Private Street", arrivalNote: "private arrival message" };
const version = { id: "version", title: "Mat Pilates", venue,
  price: { currency: "EUR", unitMinor: 800, basis: "per_person", paymentMethod: "pay_provider" },
  format: "group", durationMs: 900, language: "en", description: "private booking description", originalLocale: "en", hostGuaranteed: false,
  terms: { text: "private terms", locale: "en", cancellationNoticeMs: 450, hash: "terms-hash" } };
const agreement = { slotId: "slot", startsAt: 2000, endsAt: 2900, version, places: 2, totalMinor: 1600, freeCancellationUntil: 1550 };
const booking = { id: bookingId, reference: "BB-S1042", listingId: "listing", category: "pilates", provider: { id: "provider", name: "Mar Studio" },
  revision: 2, state: "booked", bookerName: "private booker name", bookedAt: 850,
  original: { slotId: "slot", listingVersionId: "version", termsHash: "terms-hash" }, agreement, day: null,
  host: { status: "confirmed", host: { name: "Host Name", language: "en", confirmed: { at: 880, byName: "private confirmer name" } }, isSubstitute: true },
  coordinatorName: "private coordinator name", threadId: "thread", cancellation: null,
  proposal: { id: "proposal", version: 1, state: "pending", respondBy: 1500,
    proposed: { ...agreement, startsAt: 3000, endsAt: 3900 }, sent: { at: 890, byName: "private sender name" }, decidedAt: null },
  canGiveFeedback: false, actions: { move: true, cancel: true, respond: true } };
const projection: SyncProjection = { kind: "session_booking", resourceId: bookingId, value: booking };

const expected = {
  bookingId, listingTitle: "Mat Pilates", category: "pilates", slotStart: 2000, slotEnd: 2900, siteZone: "Europe/Lisbon", partySize: 2,
  state: "booked", hostDisplayName: "Host Name", substituteHost: true, pendingChange: { kind: "proposal", respondBy: 1500 },
  price: { amountMinor: 800, currency: "EUR", basis: "per_person" }, venue: { publicName: "Mar Studio", locality: "Cascais" },
};

test("a customer booking persists only the designated booker projection fields", async () => {
  const { database, repository } = await testRepository();
  try {
    await repository.applySyncPage(page("booked", { upserts: [projection] }), 940);
    expect((await repository.getProjection("session_booking", bookingId))?.data).toEqual(expected);
    const row = database.query<{ value: string }, []>("SELECT value FROM projection WHERE kind = 'session_booking'").get();
    expect(JSON.parse(row!.value)).toEqual(expected);
    expect(row!.value).not.toMatch(/private|paymentMethod|pay_provider|actions|terms-hash|canGiveFeedback/);

    const confirmedWithoutChange = { ...booking, host: { status: "arranging", nextUpdateAt: 1600 },
      proposal: { ...booking.proposal, state: "expired" } };
    await repository.applySyncPage(page("expired-change", { upserts: [{ ...projection, value: confirmedWithoutChange }] }), 950);
    expect((await repository.getProjection("session_booking", bookingId))?.data).toEqual({
      ...expected, hostDisplayName: null, substituteHost: false, pendingChange: null,
    });

    const injected = { ...booking, agreement: { ...agreement, version: { ...version, venue: { ...venue, attendeeContacts: ["private email"] } } } };
    await repository.applySyncPage(page("injected", { upserts: [{ ...projection, value: injected }] }), 960);
    expect(await repository.getProjection("session_booking", bookingId)).toBeNull();
    expect(database.query("SELECT value FROM projection").all()).toEqual([]);
  } finally { database.close(); }
});

test("a booking projection requires a customer scope, category, and exact resource ID", async () => {
  const { database, repository } = await testRepository();
  try {
    const worker = scopeHeaderSchema.parse({ contextId: context.contextId, role: "worker", businessId: "business" });
    await repository.applySyncPage(page("wrong-role", { context: worker, upserts: [projection] }), 970);
    expect(await repository.getProjection("session_booking", bookingId)).toBeNull();
    await repository.applySyncPage(page("wrong-id", { upserts: [{ ...projection, resourceId: "another-booking" }] }), 980);
    expect(await repository.getProjection("session_booking", "another-booking")).toBeNull();
    const { category: _category, ...withoutCategory } = booking;
    await repository.applySyncPage(page("missing-category", { upserts: [{ ...projection, value: withoutCategory }] }), 990);
    expect(await repository.getProjection("session_booking", bookingId)).toBeNull();
    expect(database.query("SELECT value FROM projection").all()).toEqual([]);
  } finally { database.close(); }
});
