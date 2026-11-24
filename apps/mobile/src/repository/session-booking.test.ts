import { scopeHeaderSchema } from "@bookbuddy/api-contract";
import type { SyncProjection } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { context, page, testRepository } from "./sqlite.test-kit";

const bookingId = "booking";
const booking = {
  bookingId, listingTitle: "Mat Pilates", category: "pilates", slotStart: 2000, slotEnd: 2900, siteZone: "Europe/Lisbon", partySize: 2,
  state: "booked", hostDisplayName: "Host Name", substituteHost: true, pendingChange: { kind: "proposal", respondBy: 1500 },
  price: { amountMinor: 800, currency: "EUR", basis: "per_person" }, venue: { publicName: "Mar Studio", locality: "Cascais" },
};
const projection: SyncProjection = { kind: "session_booking", resourceId: bookingId, value: booking };

test("a customer booking persists only the designated booker projection fields", async () => {
  const { database, repository } = await testRepository();
  try {
    await repository.applySyncPage(page("booked", { upserts: [projection] }), 940);
    expect((await repository.getProjection("session_booking", bookingId))?.data).toEqual(booking);
    const row = database.query<{ value: string }, []>("SELECT value FROM projection WHERE kind = 'session_booking'").get();
    expect(JSON.parse(row!.value)).toEqual(booking);
    expect(row!.value).not.toMatch(/private|paymentMethod|pay_provider|actions|terms-hash|canGiveFeedback/);

    const confirmedWithoutChange = { ...booking, hostDisplayName: null, substituteHost: false, pendingChange: null };
    await repository.applySyncPage(page("expired-change", { upserts: [{ ...projection, value: confirmedWithoutChange }] }), 950);
    expect((await repository.getProjection("session_booking", bookingId))?.data).toEqual({
      ...confirmedWithoutChange,
    });

    const injected = { ...booking, venue: { ...booking.venue, address: "7 Private Street", accessNote: "private gate code" } };
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
