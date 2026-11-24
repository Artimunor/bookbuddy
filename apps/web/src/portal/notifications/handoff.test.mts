import { expect, test } from "bun:test";
import { linkOpeningSchema } from "@bookbuddy/api-contract";
import { requiresNativeApp } from "./handoff";

const shift = {
  id: "shift-1", visitId: "visit-1", job: { id: "job-1", reference: "BB-1001", title: "Door repair" },
  startsAt: 1_000, endsAt: 2_000, siteZone: "Europe/Madrid", placeAlias: "Villa Mar",
  task: "Door repair", skill: "Door fitting", briefingLanguage: "es", state: "planned",
};

test.each(["worker", "foreman", "provider_admin"] as const)("a %s shift notice hands off to the native app", view => {
  const opening = linkOpeningSchema.parse({ kind: "shift", shift: {
    view, shift, holds: [], crewThreadId: null,
    ...(view === "worker" ? { assignment: { id: "assignment-1", source: "ordinary", state: "confirmed", confirmedAt: 0 } }
      : { slots: [], nextAction: null, customerUpdate: { state: "not_shared" } }),
  } });
  expect(requiresNativeApp(opening, true)).toBe(true);
});
