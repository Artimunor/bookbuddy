import { expect, test } from "bun:test";
import { homeProjectionSchema, jobIdSchema } from "@bookbuddy/api-contract";
import { createWebTranslator } from "@bookbuddy/i18n/web";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { jobHomeVisitLinks, liveVisitPath, splitUpcomingVisits } from "./navigation";
import { VisitSummaryCard } from "./summary";

const job = { jobId: jobIdSchema.parse("job-1042"), journey: { step: "booked", cancelled: false, complete: false } } as const;
const windowAction = { recordId: "proposal-1", at: null, waitingOn: null };

test("Job Home links windows only for a customer decision", () => {
  const whole = { ...job, hasTodayView: false, live: false };
  for (const kind of ["pick_window", "review_revised_visit"] as const) {
    expect(jobHomeVisitLinks({ ...whole, nextStep: { ...windowAction, kind } })).toEqual({ live: null, windows: "/portal/jobs/job-1042/windows" });
  }
  for (const kind of ["wait_for_windows", "wait_for_approver", "visit", "review_quote"] as const) {
    expect(jobHomeVisitLinks({ ...whole, nextStep: { ...windowAction, kind } }).windows).toBeNull();
  }
});

test("Job Home links a live or today projection but never a cancelled job", () => {
  const whole = { ...job, nextStep: null };
  expect(jobHomeVisitLinks({ ...whole, hasTodayView: false, live: true }).live).toBe("/portal/jobs/job-1042/live");
  expect(jobHomeVisitLinks({ ...whole, hasTodayView: true, live: false }).live).toBe("/portal/jobs/job-1042/live");
  expect(jobHomeVisitLinks({ ...whole, hasTodayView: false, live: false }).live).toBeNull();
  expect(jobHomeVisitLinks({ ...whole, journey: { ...job.journey, cancelled: true }, hasTodayView: true, live: true,
    nextStep: { ...windowAction, kind: "pick_window" } })).toEqual({ live: null, windows: null });
});

const at = (time: string) => Date.parse(`2026-11-${time}Z`);
const now = at("24T23:30:00"); // Lisbon is still on the 24th; the Madrid site is already on the 25th.
const window = { startsAt: at("25T08:00:00"), endsAt: at("25T10:00:00") };
const card = { reference: "BB-1042", title: "plumbing", providerName: "Reform Archive", place: { placeId: "villa", alias: "Villa" },
  journey: job.journey, state: "open", nextVisit: { visitId: "visit-1", window }, finalAt: null, nextStep: null, live: false };
const home = homeProjectionSchema.parse({
  audience: "customer", unreadCount: 0, place: null, recent: [], decisions: [],
  liveVisits: [{ ...card, jobId: "now-live", siteZone: "Europe/Madrid", journey: { ...job.journey, step: "visit" },
    crewName: null, visit: { ...card.nextVisit, window: { startsAt: now - 1_800_000, endsAt: now + 3_600_000 },
      status: "on_the_way", step: "on_the_way", arrival: { startsAt: now + 600_000, endsAt: now + 1_200_000 },
      nextUpdateAt: null, source: { at: now, by: "Mateo" } } }],
  upcoming: [
    { ...card, jobId: "madrid-today", siteZone: "Europe/Madrid" },
    { ...card, jobId: "lisbon-tomorrow", siteZone: "Europe/Lisbon" },
    { ...card, jobId: "now-live", siteZone: "Europe/Madrid" },
  ],
});
if (home.audience !== "customer") throw new Error("Expected customer fixture");

test("Now promotes upcoming visits by site day and keeps future bookings separate", () => {
  const { today, later } = splitUpcomingVisits(home, now);
  expect(today.map(item => item.jobId)).toEqual(["madrid-today"]);
  expect(later.map(item => item.jobId)).toEqual(["lisbon-tomorrow"]);
});

test("Live and today capsules link to the job's visit and announce confirmed facts", () => {
  const { t } = createWebTranslator("en");
  const active = home.liveVisits[0]!;
  const today = splitUpcomingVisits(home, now).today[0]!;
  const render = (item: typeof active | typeof today, bookedWindow?: typeof window) => renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(VisitSummaryCard, { item, to: liveVisitPath(item.jobId), t, locale: "en", bookedWindow })));
  const liveMarkup = render(active);
  expect(liveMarkup).toContain('href="/portal/jobs/now-live/live"');
  expect(liveMarkup).toContain("On the way");
  expect(liveMarkup).toContain('data-step="current"');
  const todayMarkup = render(today, today.nextVisit?.window);
  expect(todayMarkup).toContain('href="/portal/jobs/madrid-today/live"');
  expect(todayMarkup).toContain('data-state="quiet"');
  expect(todayMarkup).toContain("Visit today");
  expect(todayMarkup).not.toContain("Crew confirmed");
});
