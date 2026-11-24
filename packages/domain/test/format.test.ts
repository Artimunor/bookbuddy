import { describe, expect, test } from "bun:test";
import { formatMoney, formatReference, formatSiteDateTime, formatSyncAge, formatTwoClock, formatZoneName, parseReference } from "../src/index";

const madrid = "Europe/Madrid";
const london = "Europe/London";
const clocks = (instant: string) => formatTwoClock(Date.parse(instant), madrid, london, "en-GB");

describe("site and viewer clocks", () => {
  test("places the compact site date and 24-hour time first with translatable zone parts", () => {
    const instant = Date.parse("2026-11-23T07:15:00Z");
    const site = formatSiteDateTime(instant, madrid, "en");
    expect(site).toEqual({
      kind: "available", siteTime: "Mon 23 Nov · 08:15",
      site: { date: "Mon 23 Nov", time: "08:15", zoneLabelKind: "site", zoneName: "Central European Time" },
    });
    expect(formatTwoClock(instant, madrid, london, "en")).toMatchObject({
      ...site, viewerTime: "07:15", viewerDateDiffers: false,
      viewer: { date: null, time: "07:15", zoneLabelKind: "viewer", zoneName: expect.any(String) },
    });
    expect(formatZoneName(instant, madrid, "en")).toBe("Central European Time");
    expect(formatZoneName(instant, london, "en")).not.toBe(london);
    expect(formatZoneName(instant, null, "en")).toBeNull();
    expect(formatZoneName(instant, "Not/AZone", "en")).toBeNull();
  });

  test("uses a weekday and day/month in European Portuguese and a 24-hour clock in English", () => {
    const instant = Date.parse("2026-11-23T19:15:00Z");
    expect(formatSiteDateTime(instant, madrid, "pt-PT")).toMatchObject({
      kind: "available", siteTime: expect.stringMatching(/^(?:seg\.?|segunda(?:-feira)?),? 23\/11 · 20:15$/i),
      site: { time: "20:15", zoneLabelKind: "site", zoneName: expect.any(String) },
    });
    expect(formatSiteDateTime(instant, madrid, "en-US")).toMatchObject({ siteTime: "Mon 23 Nov · 20:15" });
  });

  test("omits the second clock only when off or the zone is the same", () => {
    const instant = Date.parse("2026-01-24T08:10:00Z");
    for (const viewerZone of [null, madrid]) {
      expect(formatTwoClock(instant, madrid, viewerZone, "en-GB")).toMatchObject({
        kind: "available", viewerTime: null, viewerDateDiffers: false, viewer: null,
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
      siteTime: "Sun 2 Aug · 00:30",
      viewerTime: "Sat 1 Aug · 23:30",
      site: { date: "Sun 2 Aug", time: "00:30", zoneLabelKind: "site" },
      viewer: { date: "Sat 1 Aug", time: "23:30", zoneLabelKind: "viewer" },
    });
    expect(clocks("2026-08-01T23:00:00Z")).toMatchObject({
      kind: "available", viewerDateDiffers: false, viewerTime: "00:00", viewer: { date: null, time: "00:00" },
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

  test("distinguishes the repeated hour on 25 October 2026 when offsets are requested", () => {
    const earlyMs = Date.parse("2026-10-25T00:30:00Z");
    const lateMs = Date.parse("2026-10-25T01:30:00Z");
    const options = { showOffset: true };
    const early = formatTwoClock(earlyMs, madrid, london, "en-GB", options);
    const late = formatTwoClock(lateMs, madrid, london, "en-GB", options);
    expect(early).toMatchObject({
      site: { time: expect.stringMatching(/^02:30.*GMT\+2$/) },
      viewer: { time: expect.stringMatching(/^01:30.*GMT\+1$/) },
    });
    expect(late).toMatchObject({
      site: { time: expect.stringMatching(/^02:30.*GMT\+1$/) },
      viewer: { time: expect.stringMatching(/^01:30.*GMT(?:\+0)?$/) },
    });
    for (const instantMs of [earlyMs, lateMs]) {
      expect(formatZoneName(instantMs, madrid, "en")).toMatch(/^Central European Time(?: \(Spain\))?$/);
    }
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
