import { expect, spyOn, test } from "bun:test";
import { customerLiveVisitSchema, homeProjectionSchema, jobIdSchema } from "@bookbuddy/api-contract";
import { createWebTranslator } from "@bookbuddy/i18n/web";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { createPortalApi } from "../session/api";
import { jobHomeVisitLinks, liveVisitPath, splitUpcomingVisits } from "./navigation";
import { readCustomerLiveVisit } from "./read";
import { VisitSummaryCard } from "./summary";

const job = { jobId: jobIdSchema.parse("job-1042"), journey: { step: "booked", cancelled: false, complete: false } } as const;
const windowAction = { recordId: "proposal-1", at: null, waitingOn: null };

test("Job Home links windows only for a customer decision", () => {
  const whole = { ...job };
  for (const kind of ["pick_window", "review_revised_visit"] as const) {
    expect(jobHomeVisitLinks({ ...whole, nextStep: { ...windowAction, kind } })).toEqual({ live: null, windows: "/portal/jobs/job-1042/windows" });
  }
  for (const kind of ["wait_for_windows", "wait_for_approver", "visit", "review_quote"] as const) {
    expect(jobHomeVisitLinks({ ...whole, nextStep: { ...windowAction, kind } }).windows).toBeNull();
  }
});

test("Job Home links the exact displayed visit only when it is available", () => {
  const whole = { ...job, nextStep: null };
  const { visitId } = customerLiveVisitSchema.parse(afternoonVisit);
  const visit = { visitId, status: null, step: null, arrivalWindow: null, source: null };
  expect(jobHomeVisitLinks({ ...whole, visit }).live).toBe("/portal/jobs/job-1042/live?visit=visit-afternoon");
  expect(jobHomeVisitLinks({ ...whole, todayVisitId: visitId }).live).toBe("/portal/jobs/job-1042/live?visit=visit-afternoon");
  expect(jobHomeVisitLinks(whole).live).toBeNull();
  expect(jobHomeVisitLinks({ ...whole, journey: { ...job.journey, cancelled: true }, visit, todayVisitId: visitId,
    nextStep: { ...windowAction, kind: "pick_window" } })).toEqual({ live: null, windows: null });
});

const at = (time: string) => Date.parse(`2026-11-${time}Z`);
const now = at("24T23:30:00"); // Lisbon is still on the 24th; the Madrid site is already on the 25th.
const window = { startsAt: at("25T08:00:00"), endsAt: at("25T10:00:00") };
const card = { reference: "BB-1042", title: "plumbing", providerName: "Reform Archive", place: { placeId: "villa", alias: "Villa" },
  journey: job.journey, state: "open", nextVisit: { visitId: "visit-1", window }, finalAt: null, nextStep: null, live: false };
const afternoonWindow = { startsAt: at("25T14:00:00"), endsAt: at("25T16:00:00") };
const afternoonVisit = {
  visitId: "visit-afternoon", job: { id: "madrid-today", reference: card.reference, title: card.title, placeAlias: card.place.alias },
  siteZone: "Europe/Madrid", providerName: card.providerName, foremanName: null, jobThreadId: null, completionId: null,
  window: { id: "window-afternoon", ...afternoonWindow }, confirmedCrewNames: [],
  live: { step: null, status: null, since: null, source: null, arrival: null, nextUpdateAt: null },
  moments: [], page: { hasMore: false, cursor: null },
};
const morningVisit = { ...afternoonVisit, visitId: "visit-morning", window: { id: "window-morning", ...window } };
const home = homeProjectionSchema.parse({
  audience: "customer", unreadCount: 0, place: null, recent: [], decisions: [],
  liveVisits: [{ ...card, jobId: "now-live", siteZone: "Europe/Madrid", journey: { ...job.journey, step: "visit" },
    crewName: null, visit: { ...card.nextVisit, window: { startsAt: now - 1_800_000, endsAt: now + 3_600_000 },
      status: "on_the_way", step: "on_the_way", arrival: { startsAt: now + 600_000, endsAt: now + 1_200_000 },
      nextUpdateAt: null, source: { at: now, by: "Mateo" } } }],
  upcoming: [
    { ...card, jobId: "madrid-today", siteZone: "Europe/Madrid", nextVisit: { visitId: afternoonVisit.visitId, window: afternoonWindow } },
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

test("Live and today capsules link to the displayed visit and announce confirmed facts", () => {
  const { t } = createWebTranslator("en");
  const active = home.liveVisits[0]!;
  const today = splitUpcomingVisits(home, now).today[0]!;
  const render = (item: typeof active | typeof today, visitId: string, bookedWindow?: typeof window) => renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(VisitSummaryCard, { item, to: liveVisitPath(item.jobId, visitId), t, locale: "en", bookedWindow })));
  const clock = spyOn(Date, "now").mockReturnValue(now);
  try {
    const liveMarkup = render(active, active.visit.visitId);
    expect(liveMarkup).toContain('href="/portal/jobs/now-live/live?visit=visit-1"');
    expect(liveMarkup).toContain("On the way");
    expect(liveMarkup).toContain('data-step="current"');
    const todayMarkup = render(today, today.nextVisit.visitId, today.nextVisit.window);
    expect(todayMarkup).toContain('href="/portal/jobs/madrid-today/live?visit=visit-afternoon"');
    expect(todayMarkup).toContain('data-state="quiet"');
    expect(todayMarkup).toContain("Visit today");
    expect(todayMarkup).not.toContain("Crew confirmed");
  } finally { clock.mockRestore(); }
});

test("a Now card for the afternoon visit never reads or renders the unfinished morning visit", async () => {
  const [item] = splitUpcomingVisits(home, now).today;
  if (!item) throw new Error("Expected a same-day booking");
  const href = new URL(liveVisitPath(item.jobId, item.nextVisit.visitId), "https://portal.test");
  const requested: string[] = [];
  const api = createPortalApi({
    identity: { sessionId: "session-a", contextId: "context-a" },
    getLocale: () => "en", isCurrent: () => true, onSessionChanged: () => {},
    fetch: async (url) => {
      requested.push(url);
      const data = url === "/api/v1/visits/visit-afternoon/live" ? afternoonVisit : morningVisit;
      return Response.json({ ok: true, data, meta: { serverTime: now, requestId: "live-visit" } });
    },
  });
  const signal = new AbortController().signal;
  const visitId = href.searchParams.get("visit")!;
  const opened = await readCustomerLiveVisit(api, item.jobId, visitId, signal);
  expect(opened).toMatchObject({ visitId: "visit-afternoon", window: afternoonVisit.window });
  expect(requested).toEqual(["/api/v1/visits/visit-afternoon/live"]);
  expect(await readCustomerLiveVisit(api, item.jobId, visitId, signal, "next-page")).toBeNull();
  expect(await readCustomerLiveVisit(api, "different-job", visitId, signal)).toBeNull();
});

test("Job Home quiets the arrival band at the deadline without claiming an arrival", () => {
  const { t } = createWebTranslator("en");
  const active = home.liveVisits[0]!;
  const { startsAt: start, endsAt: end } = active.visit.arrival!;
  const item = { ...active, visit: {
    visitId: active.visit.visitId, status: active.visit.status, step: active.visit.step,
    arrivalWindow: { start, end, siteZone: active.siteZone }, source: { at: now, sharedByName: "Mateo" },
  } };
  const render = () => renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(VisitSummaryCard, { item, to: liveVisitPath(item.jobId, item.visit.visitId), t, locale: "en" })));
  const clock = spyOn(Date, "now").mockReturnValue(end - 1);
  try {
    const current = render();
    expect(current).toContain('data-state="live"');
    expect(current).toContain("On the way");
    expect(current).toContain("00:40");
    clock.mockReturnValue(end);
    const expired = render();
    expect(expired).toContain('data-state="quiet"');
    expect(expired).toContain("Last confirmed update");
    expect(expired).not.toContain("00:40");
    expect(expired).not.toContain("Step 3 of 5: On site");
  } finally { clock.mockRestore(); }
});
