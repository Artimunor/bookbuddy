import { describe, expect, test } from "bun:test";
import { formatMoney, formatReference, formatSiteDateTime, formatSyncAge, formatTwoClock, parseReference } from "../src/index";

const madrid = "Europe/Madrid";
const london = "Europe/London";
const clocks = (instant: string) => formatTwoClock(Date.parse(instant), madrid, london, "en-GB");

describe("site and viewer clocks", () => {
  test("places the site date and time first, with viewer time only when dates match", () => {
    const instant = Date.parse("2026-11-24T08:10:00Z");
    const site = formatSiteDateTime(instant, madrid, "en-GB");
    const both = clocks("2026-11-24T08:10:00Z");
    expect(both.kind).toBe("available");
    if (both.kind !== "available" || site.kind !== "available") throw new Error("Expected both clocks");
    expect(both.siteTime).toBe(site.siteTime);
    expect(site.siteTime).toMatch(/24 Nov 2026.*09:10.*(?:CET|GMT\+1)/);
    expect(both.viewerTime).toMatch(/^08:10.*GMT(?:\+0)?$/);
    expect(both.viewerDateDiffers).toBe(false);
  });

  test("omits the second clock only when off or the zone is the same", () => {
    const instant = Date.parse("2026-01-24T08:10:00Z");
    for (const viewerZone of [null, madrid]) {
      expect(formatTwoClock(instant, madrid, viewerZone, "en-GB")).toMatchObject({
        kind: "available", viewerTime: null, viewerDateDiffers: false,
      });
    }
    // Date and offset can match even though the time zones differ.
    expect(formatTwoClock(instant, london, "Atlantic/Reykjavik", "en-GB")).toMatchObject({
      kind: "available", viewerTime: expect.stringContaining("08:10"),
    });
  });

  test("reports unavailable site time, even with a valid viewer zone", () => {
    for (const zone of [undefined, null, "", "Not/AZone"]) {
      const instant = Date.parse("2026-11-24T08:10:00Z");
      expect(formatSiteDateTime(instant, zone, "en")).toEqual({ kind: "site_time_unavailable" });
      expect(formatTwoClock(instant, zone, london, "en")).toEqual({ kind: "site_time_unavailable" });
    }
  });

  test("includes the viewer date when Madrid has passed midnight but London has not", () => {
    const both = clocks("2026-08-01T22:30:00Z");
    expect(both).toMatchObject({
      kind: "available", viewerDateDiffers: true,
      siteTime: expect.stringMatching(/2 Aug 2026.*00:30/),
      viewerTime: expect.stringMatching(/1 Aug 2026.*23:30/),
    });
    expect(clocks("2026-08-01T23:00:00Z")).toMatchObject({
      kind: "available", viewerDateDiffers: false, viewerTime: expect.stringMatching(/^00:00/),
    });
  });

  test("skips the missing hour on 29 March 2026", () => {
    expect(clocks("2026-03-29T00:30:00Z")).toMatchObject({
      siteTime: expect.stringContaining("01:30"), viewerTime: expect.stringContaining("00:30"),
    });
    expect(clocks("2026-03-29T01:30:00Z")).toMatchObject({
      siteTime: expect.stringContaining("03:30"), viewerTime: expect.stringContaining("02:30"),
    });
  });

  test("shows the repeated hour with its different zone on 25 October 2026", () => {
    const early = clocks("2026-10-25T00:30:00Z");
    const late = clocks("2026-10-25T01:30:00Z");
    expect(early).toMatchObject({
      siteTime: expect.stringMatching(/02:30.*(?:CEST|GMT\+2)/),
      viewerTime: expect.stringMatching(/01:30.*(?:BST|GMT\+1)/),
    });
    expect(late).toMatchObject({
      siteTime: expect.stringMatching(/02:30.*(?:CET|GMT\+1)/),
      viewerTime: expect.stringMatching(/01:30.*GMT(?:\+0)?$/),
    });
  });
});

describe("money, sync age and public references", () => {
  test("formats the same EUR minor units in both launch locales", () => {
    expect(formatMoney(1_234_567, "EUR", "en")).toBe("€12,345.67");
    expect(formatMoney(1_234_567, "EUR", "pt-PT").replace(/[\u00a0\u202f]/g, " ")).toBe("12 345,67 €");
    expect(formatMoney(-1, "EUR", "en")).toBe("-€0.01");
    expect(formatMoney(0, "EUR", "en")).toBe("€0.00");
    expect(formatMoney(Number.MAX_SAFE_INTEGER, "EUR", "en")).toBe("€90,071,992,547,409.91");
    expect(formatMoney(-Number.MAX_SAFE_INTEGER + 2, "EUR", "en")).toBe("-€90,071,992,547,409.89");
    expect(() => formatMoney(0.01, "EUR", "en")).toThrow(RangeError);
    expect(() => formatMoney(Number.MAX_SAFE_INTEGER + 1, "EUR", "en")).toThrow(RangeError);
  });

  test("shows elapsed sync age with whole units and no future age", () => {
    const now = Date.parse("2026-11-24T08:00:00Z");
    const age = (elapsed: number, locale = "en") => formatSyncAge(now - elapsed, now, locale);
    expect(age(-1)).toBe("now");
    expect(age(999)).toBe("now");
    expect(age(1_000)).toBe("1 second ago");
    expect(age(59_999)).toBe("59 seconds ago");
    expect(age(60_000)).toBe("1 minute ago");
    expect(age(3_599_999)).toBe("59 minutes ago");
    expect(age(3_600_000)).toBe("1 hour ago");
    expect(age(86_399_999)).toBe("23 hours ago");
    expect(age(86_400_000)).toBe("yesterday");
    expect(age(172_800_000, "pt-PT")).toBe("anteontem");
  });

  test("formats and parses canonical construction and session labels", () => {
    expect(formatReference("1042")).toBe("BB-1042");
    expect(formatReference("S1042")).toBe("BB-S1042");
    expect(parseReference("BB-0012")).toBe("BB-0012");
    for (const invalid of ["bb-1042", "BB-", "BB-S 1042", "BB-1042\n", "RR-0412"]) {
      expect(parseReference(invalid)).toBeNull();
    }
    expect(() => formatReference("BB-1042")).toThrow(RangeError);
  });
});
