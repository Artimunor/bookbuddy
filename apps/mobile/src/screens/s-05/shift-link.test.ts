import { shiftLinkDetailSchema } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { shiftLinkDestination } from "./shift-link";

const shift = {
  id: "shift-1", visitId: "visit-1", job: { id: "job-1", reference: "BB-1042", title: "Terrace door repair" },
  startsAt: 1_000, endsAt: 2_000, siteZone: "Europe/Madrid", placeAlias: "Villa Mar", task: "Fit door",
  skill: "Door fitting", briefingLanguage: "es", state: "planned",
};
const roster = { shift, holds: [], slots: [], customerUpdate: { state: "not_shared" }, crewThreadId: null, nextAction: null };

test("authorized shift links open the record in each projection's role", () => {
  const worker = shiftLinkDetailSchema.parse({ view: "worker", shift, holds: [], crewThreadId: null,
    assignment: { id: "assignment-1", source: "ordinary", state: "confirmed", confirmedAt: 500 } });
  const foreman = shiftLinkDetailSchema.parse({ ...roster, view: "foreman" });
  const provider = shiftLinkDetailSchema.parse({ ...roster, view: "provider_admin" });
  expect(shiftLinkDestination(worker)).toEqual({ pathname: "/w/shifts/[shiftId]", params: { shiftId: "shift-1", assignmentId: "assignment-1" } });
  expect(shiftLinkDestination(foreman)).toEqual({ pathname: "/f/shifts/[shiftId]", params: { shiftId: "shift-1" } });
  expect(shiftLinkDestination(provider)).toEqual({ pathname: "/p/jobs", params: { jobId: "job-1" } });
});
