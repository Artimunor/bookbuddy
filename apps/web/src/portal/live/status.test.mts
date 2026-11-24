import { expect, spyOn, test } from "bun:test";
import { customerLiveVisitSchema } from "@bookbuddy/api-contract";
import { createWebTranslator } from "@bookbuddy/i18n/web";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VisitStatus } from "./status";

const start = Date.parse("2026-11-25T08:10:00Z");
const end = start + 600_000;
const at = start - 300_000;
const arrival = { id: "arrival", kind: "on_the_way", recordedAt: at, sharedByName: "Mateo", band: { startsAt: start, endsAt: end } };
const visit = customerLiveVisitSchema.parse({
  visitId: "visit-1", job: { id: "job-1", reference: "BB-1", title: "plumbing", placeAlias: "Villa" },
  window: { id: "window-1", startsAt: at, endsAt: end + 600_000 },
  siteZone: "Europe/Madrid", providerName: "Reform Archive", foremanName: null, jobThreadId: null, completionId: null,
  confirmedCrewNames: ["Lia Ramos"],
  live: { status: "on_the_way", step: "on_the_way", since: at, source: { at, sharedByName: "Mateo" }, arrival, nextUpdateAt: null },
  moments: [arrival], page: { hasMore: false, cursor: null },
});

test("Live stops announcing the travel stage and removes the crew travel glyph at estimate expiry", () => {
  const { t } = createWebTranslator("en");
  const now = spyOn(Date, "now").mockReturnValue(end - 1);
  const render = (data = visit) => renderToStaticMarkup(createElement(VisitStatus, { visit: data, t, locale: "en", viewer: undefined }));
  try {
    const active = render();
    expect(active).toContain('data-state="live"');
    expect(active).toContain('aria-label="Step 2 of 5: On the way"');
    expect(active).toContain('data-status="on-the-way"');

    now.mockReturnValue(end);
    for (const expired of [render(), render({ ...visit, live: { ...visit.live, status: null, step: "confirmed", arrival: null } })]) {
      expect(expired).toContain('data-state="quiet"');
      expect(expired).toContain("Arrival window passed; no arrival update yet");
      expect(expired).not.toContain('aria-label="Step 2 of 5: On the way"');
      expect(expired).toContain('aria-label="Step 1 of 5: Crew confirmed"');
      expect(expired).not.toContain('data-status="on-the-way"');
      expect(expired).toContain('data-status="confirmed"');
      expect(expired).toContain("Lia Ramos");
    }
  } finally { now.mockRestore(); }
});

test("an expired estimate does not announce a milestone without crew confirmation", () => {
  const { t } = createWebTranslator("en");
  const now = spyOn(Date, "now").mockReturnValue(end);
  try {
    const unconfirmed = { ...visit, confirmedCrewNames: [] };
    for (const data of [unconfirmed, { ...unconfirmed, live: { ...visit.live, status: null, step: null, arrival: null } }]) {
      const expired = renderToStaticMarkup(createElement(VisitStatus, { visit: data, t, locale: "en", viewer: undefined }));
      expect(expired).toContain("Arrival window passed; no arrival update yet");
      expect(expired).not.toContain('data-step="current"');
      expect(expired).not.toContain('aria-label="Step ');
      expect(expired).not.toContain('data-status="confirmed"');
    }
  } finally { now.mockRestore(); }
});
