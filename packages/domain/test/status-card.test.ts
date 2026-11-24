import { describe, expect, test } from "bun:test";
import { projectStatusCard, STATUS_CARD_MAX_AGE_MS, statusCardText, type StatusCardCopy, type StatusCardFacts } from "../src/status-card";

const now = 1_700_000_000_000;
const arrivalBand = { startsAt: now + 48_003, endsAt: now + 89_003, id: "PRIVATE_BAND_ID", address: "PRIVATE_ADDRESS" };
const copy: StatusCardCopy = {
  visitTitle: "BookBuddy visit", shiftTitle: "BookBuddy shift", appTitle: "BookBuddy", open: "Open app",
  visitStage: stage => stage, arrival: (start, end) => `${start}–${end}`, sinceCheckIn: at => `Since check-in ${at}`,
  onSite: "On site", safetyHold: "Safety hold", openBeforeWorking: "Attendance only",
  coverStage: stage => stage, coverDeadline: (stage, at) => `${stage} until ${at}`,
  coverCounts: ({ offersOut, accepted, confirmed, noCover }) => `${offersOut} out / ${accepted} accepted / ${confirmed} confirmed / ${noCover} no cover`,
};
const neverVisible = {
  address: "PRIVATE_ADDRESS", access: "PRIVATE_CODE", position: "PRIVATE_LOCATION", price: "PRIVATE_PRICE",
  job: { reference: "PRIVATE_JOB", title: "PRIVATE_TITLE" }, message: "PRIVATE_MESSAGE", worker: { name: "PRIVATE_PERSON" },
};

describe("status cards", () => {
  test("customer defaults to its stage and never carries source data into spoken or visible text", () => {
    const facts = { ...neverVisible, kind: "customer_visit", stage: "on_the_way", arrivalBand, publishedCrewName: "Published crew" } as const;
    const hidden = projectStatusCard(facts, now)!;
    expect(hidden).toEqual({ kind: "customer_visit", preview: "generic", stage: "on_the_way" });
    expect(statusCardText(hidden, copy)).toEqual({ title: "BookBuddy visit", summary: "on_the_way", expanded: null, accessibilityLabel: "BookBuddy visit, on_the_way" });
    const details = projectStatusCard(facts, now, "details")!;
    expect(details).toEqual({ kind: "customer_visit", preview: "details", stage: "on_the_way", arrivalBand: { startsAt: arrivalBand.startsAt, endsAt: arrivalBand.endsAt }, crewName: "Published crew" });
    expect(statusCardText(details, copy).accessibilityLabel).toBe(`on_the_way, ${arrivalBand.startsAt}–${arrivalBand.endsAt}, Published crew`);
    expect(JSON.stringify([details, statusCardText(details, copy)])).not.toContain("PRIVATE_");
    expect(projectStatusCard({ ...facts, publishedCrewName: null }, now, "details")).toMatchObject({ crewName: null });
    expect(projectStatusCard(facts, arrivalBand.endsAt, "details")).toMatchObject({ stage: "no_arrival_update", arrivalBand: null });
    expect(projectStatusCard(facts, arrivalBand.endsAt)).toMatchObject({ stage: "no_arrival_update" });
  });

  test("worker hidden preview is invariant across check-in times and holds; the timer expires without check-out", () => {
    const facts = { ...neverVisible, kind: "worker_shift", checkedInAt: now - 60_000, checkedOut: false, safetyHold: true, holdText: "PRIVATE_INSTRUCTION" } as const;
    const hidden = projectStatusCard(facts, now)!;
    expect(hidden).toEqual(projectStatusCard({ ...facts, checkedInAt: now - 300_000, safetyHold: false }, now));
    expect(statusCardText(hidden, copy)).toEqual({ title: "BookBuddy shift", summary: "Open app", expanded: null, accessibilityLabel: "BookBuddy shift, Open app" });
    const details = projectStatusCard(facts, now, "details")!;
    expect(details).toEqual({ kind: "worker_shift", preview: "details", checkedInAt: facts.checkedInAt, safetyHold: true });
    expect(statusCardText(details, copy).accessibilityLabel).toBe(`Safety hold, Since check-in ${facts.checkedInAt}, Attendance only`);
    expect(JSON.stringify([details, statusCardText(details, copy)])).not.toContain("PRIVATE_");
    expect(projectStatusCard({ ...facts, checkedInAt: null }, now)).toBeNull();
    expect(projectStatusCard({ ...facts, checkedOut: true }, now)).toBeNull();
    expect(projectStatusCard(facts, facts.checkedInAt + STATUS_CARD_MAX_AGE_MS)).toBeNull();
    expect(projectStatusCard(facts, facts.checkedInAt + STATUS_CARD_MAX_AGE_MS - 1)).not.toBeNull();
  });

  test("foreman hides the existence, counts and deadline of the search in spoken and visible text", () => {
    const counts = { offersOut: 1, accepted: 1, confirmed: 0, noCover: 1, candidate: "PRIVATE_CANDIDATE" };
    const facts = { ...neverVisible, kind: "foreman_cover", stage: "accepted", counts, deadline: now + 15_007 } as const;
    const hidden = projectStatusCard(facts, now)!;
    expect(hidden).toEqual(projectStatusCard({ ...facts, stage: "no_cover", deadline: null }, now));
    expect(statusCardText(hidden, copy)).toEqual({ title: "BookBuddy", summary: "Open app", expanded: null, accessibilityLabel: "BookBuddy, Open app" });
    const details = projectStatusCard(facts, now, "details")!;
    expect(details).toEqual({ kind: "foreman_cover", preview: "details", stage: "accepted", counts: { offersOut: 1, accepted: 1, confirmed: 0, noCover: 1 }, deadline: facts.deadline });
    expect(statusCardText(details, copy).accessibilityLabel).toBe(`accepted, accepted until ${facts.deadline}, 1 out / 1 accepted / 0 confirmed / 1 no cover`);
    expect(JSON.stringify([details, statusCardText(details, copy)])).not.toContain("PRIVATE_");
    expect(projectStatusCard({ ...facts, stage: "confirmed" }, now, "details")).toMatchObject({ deadline: null });
  });

  test("runtime values cannot smuggle hidden data through an enumerated stage", () => {
    const facts = { kind: "customer_visit", stage: "PRIVATE_PERSON", arrivalBand, publishedCrewName: null } as unknown as StatusCardFacts;
    expect(projectStatusCard(facts, now)).toEqual({ kind: "customer_visit", preview: "generic", stage: "update" });
  });
});
