import { scopeHeaderSchema } from "@bookbuddy/api-contract";
import type { SyncProjection } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { context, page, testRepository } from "./sqlite.test-kit";

const worker = scopeHeaderSchema.parse({ contextId: context.contextId, role: "worker", businessId: "business" });
const assignmentId = "field-assignment";
const briefing = {
  assignmentId, siteZone: "Europe/Lisbon", bookedWindow: { id: "visit-window", startsAt: 1_500, endsAt: 2_000 },
  hasActiveHold: true,
  instruction: {
    instructionId: "safety-instruction", version: { id: "safety-version", no: 2, issuedByName: "Foreman", issuedAt: 940 },
    state: "awaiting_teach_back", original: { language: "en", text: "Disconnect power before starting work." },
    reviewedHumanReadingAid: { language: "pt-PT", text: "Desligue a alimentação antes de começar a trabalhar." },
  },
};
const projection: SyncProjection = { kind: "assignment_briefing", resourceId: assignmentId, value: briefing };

test("briefing cache requires a worker scope and matching assignment, and rejects arrival plan fields", async () => {
  const { database, repository } = await testRepository();
  try {
    await repository.applySyncPage(page("worker", { context: worker, upserts: [projection] }), 950);
    expect((await repository.getProjection("assignment_briefing", assignmentId))?.data).toEqual(briefing);

    await repository.applySyncPage(page("injected", { context: worker, upserts: [{ ...projection, value: {
      ...briefing, arrivalPlan: { original: { language: "en", text: "private-entry-instructions" } },
    } }] }), 960);
    expect(await repository.getProjection("assignment_briefing", assignmentId)).toBeNull();
    expect(database.query("SELECT value FROM projection WHERE kind = 'assignment_briefing'").all()).toEqual([]);

    await repository.applySyncPage(page("mismatched", { context: worker, upserts: [{ ...projection, resourceId: "different-assignment" }] }), 970);
    expect(await repository.getProjection("assignment_briefing", "different-assignment")).toBeNull();
    await repository.applySyncPage(page("customer", { upserts: [projection] }), 980);
    expect(await repository.getProjection("assignment_briefing", assignmentId)).toBeNull();
  } finally { database.close(); }
});
