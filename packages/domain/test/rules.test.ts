import { describe, expect, test } from "bun:test";
import {
  attendanceReviewState, canCancelFeeFree, canConfirmAlternativeWindow, canIssuePlaceInvitation,
  canReissueInvitation, changeExpiresAt, coverConfirmationDeadline, coverReplyDeadline,
  invitationExpiresAt, isBeforeDeadline, JOURNEY_STEPS, projectJourney, projectVisit,
  quoteExpiresAt, VISIT_STEPS,
} from "../src/index";
import type { CustomerUpdateKind, JourneyFacts } from "../src/index";

const min = 60_000;
const hour = 60 * min;
const day = 24 * hour;
const madrid = "Europe/Madrid";

const arrival = { kind: "arrival", shiftStartsAtMs: hour } as const;
const departure = { kind: "departure", acceptedArrivalAtMs: hour, shiftEndsAtMs: 2 * hour } as const;

describe("commercial deadlines", () => {
  test("quote expiry is the same site-local wall clock seven dates later", () => {
    const spring = Date.parse("2026-03-22T08:00:00.123Z");
    const autumn = Date.parse("2026-10-18T07:00:00.123Z");
    expect(quoteExpiresAt(spring, madrid)).toBe(spring + 167 * hour);
    expect(quoteExpiresAt(autumn, madrid)).toBe(autumn + 169 * hour);
    expect(quoteExpiresAt(autumn, "UTC")).toBe(autumn + 7 * day);
    expect(() => quoteExpiresAt(autumn, "")).toThrow(RangeError);
  });

  test("spring gap expires at the first valid clock time and autumn fold at the first occurrence", () => {
    const spring = Date.parse("2026-03-22T01:30:00.501Z"); // 02:30 Madrid; not a valid clock time next Sunday.
    const autumn = Date.parse("2026-10-18T00:30:00.501Z"); // 02:30 Madrid; repeated next Sunday.
    expect(quoteExpiresAt(spring, madrid)).toBe(Date.parse("2026-03-29T01:00:00Z"));
    expect(quoteExpiresAt(autumn, madrid)).toBe(Date.parse("2026-10-25T00:30:00.501Z"));
  });

  test("change expiry is 72 elapsed hours or earlier affected start, never later", () => {
    const issued = Date.parse("2026-03-27T08:00:00Z");
    const deadline = issued + 72 * hour;
    expect(changeExpiresAt(issued, null)).toBe(Date.parse("2026-03-30T08:00:00Z"));
    expect(changeExpiresAt(issued, deadline + 1)).toBe(deadline);
    expect(changeExpiresAt(issued, deadline)).toBe(deadline);
    expect(changeExpiresAt(issued, deadline - 1)).toBe(deadline - 1);
    expect(isBeforeDeadline(deadline - 1, deadline)).toBe(true);
    expect(isBeforeDeadline(deadline, deadline)).toBe(false);
    expect(isBeforeDeadline(deadline + 1, deadline)).toBe(false);
  });
});

describe("cover and attendance", () => {
  const dispatch = { issuedAtMs: hour, safeCutoffMs: 2 * hour, shiftStartsAtMs: 3 * hour, recipientCount: 3, dispatchesUsed: 1 };

  test("cover dispatch has at most three recipients and no third dispatch", () => {
    expect(coverReplyDeadline(dispatch)).toBe(hour + 15 * min);
    expect(coverReplyDeadline({ ...dispatch, recipientCount: 1, dispatchesUsed: 0 })).toBe(hour + 15 * min);
    expect(coverReplyDeadline({ ...dispatch, recipientCount: 0 })).toBeNull();
    expect(coverReplyDeadline({ ...dispatch, recipientCount: 4 })).toBeNull();
    expect(coverReplyDeadline({ ...dispatch, dispatchesUsed: 2 })).toBeNull();
  });

  test("shorter dispatch must leave at least five minutes each for reply and confirmation", () => {
    expect(coverReplyDeadline({ ...dispatch, safeCutoffMs: hour + 19 * min })).toBe(hour + 14 * min);
    expect(coverReplyDeadline({ ...dispatch, safeCutoffMs: hour + 10 * min })).toBe(hour + 5 * min);
    expect(coverReplyDeadline({ ...dispatch, safeCutoffMs: hour + 10 * min - 1 })).toBeNull();
    expect(coverReplyDeadline({ ...dispatch, shiftStartsAtMs: hour + 10 * min })).toBe(hour + 5 * min);
  });

  test("provisional acceptance expires at the first of five minutes, cutoff and shift start", () => {
    expect(coverConfirmationDeadline(hour, 2 * hour, 3 * hour)).toBe(hour + 5 * min);
    expect(coverConfirmationDeadline(hour, hour + 5 * min - 1, 3 * hour)).toBe(hour + 5 * min - 1);
    expect(coverConfirmationDeadline(hour, 2 * hour, hour + 1)).toBe(hour + 1);
    expect(coverConfirmationDeadline(hour, hour, 3 * hour)).toBeNull();
    expect(coverConfirmationDeadline(hour, 2 * hour, hour)).toBeNull();
  });

  test("arrival review includes exactly 30 minutes before through 60 minutes after start", () => {
    for (const [actualAtMs, expected] of [
      [30 * min - 1, "needs_review"], [30 * min, "accepted"],
      [2 * hour, "accepted"], [2 * hour + 1, "needs_review"],
    ] as const) {
      expect(attendanceReviewState({ ...arrival, actualAtMs })).toBe(expected);
    }
    expect(attendanceReviewState({ ...arrival, actualAtMs: hour, disputed: true })).toBe("needs_review");
  });

  test("departure review runs from accepted arrival through two hours after end", () => {
    for (const [actualAtMs, expected] of [
      [hour - 1, "needs_review"], [hour, "accepted"],
      [4 * hour, "accepted"], [4 * hour + 1, "needs_review"],
    ] as const) {
      expect(attendanceReviewState({ ...departure, actualAtMs })).toBe(expected);
    }
    expect(attendanceReviewState({ ...departure, actualAtMs: 2 * hour, acceptedArrivalAtMs: null })).toBe("needs_review");
    expect(attendanceReviewState({ ...departure, actualAtMs: 2 * hour, disputed: true })).toBe("needs_review");
  });
});

describe("invitation and cancellation policy", () => {
  const now = 10 * day;

  test("invitations expire at 48 hours and place invites cap pending total and recipient", () => {
    const issued = Date.parse("2026-03-28T08:00:00Z");
    const expires = invitationExpiresAt(issued);
    expect(expires).toBe(Date.parse("2026-03-30T08:00:00Z"));
    expect(isBeforeDeadline(expires - 1, expires)).toBe(true);
    expect(isBeforeDeadline(expires, expires)).toBe(false);
    expect(canIssuePlaceInvitation(4, 0)).toBe(true);
    expect(canIssuePlaceInvitation(5, 0)).toBe(false);
    expect(canIssuePlaceInvitation(4, 1)).toBe(false);
  });

  test("provider reissues are 24 hours apart; place reissues are 15 minutes apart", () => {
    expect(canReissueInvitation("provider", now, [now - day + 1])).toBe(false);
    expect(canReissueInvitation("provider", now, [now - day])).toBe(true);
    expect(canReissueInvitation("place", now, [now - 15 * min + 1])).toBe(false);
    expect(canReissueInvitation("place", now, [now - 15 * min])).toBe(true);
  });

  test("both invitation scopes allow at most two reissues in a rolling seven-day window", () => {
    for (const scope of ["provider", "place"] as const) {
      expect(canReissueInvitation(scope, now, [])).toBe(true);
      expect(canReissueInvitation(scope, now, [now - day, now - 7 * day + 1])).toBe(false);
      expect(canReissueInvitation(scope, now, [now - day, now - 7 * day])).toBe(true);
    }
  });

  test("cancellation is fee-free strictly before start and before any prior work", () => {
    expect(canCancelFeeFree(now, now + 1, false)).toBe(true);
    expect(canCancelFeeFree(now, now, false)).toBe(false);
    expect(canCancelFeeFree(now, now - 1, false)).toBe(false);
    expect(canCancelFeeFree(now, now + 1, true)).toBe(false);
  });

  test("only an eligible alternative at least 24 hours ahead can be directly confirmed", () => {
    expect(canConfirmAlternativeWindow(now, now + day - 1, true)).toBe(false);
    expect(canConfirmAlternativeWindow(now, now + day, true)).toBe(true);
    expect(canConfirmAlternativeWindow(now, now + day + 1, false)).toBe(false);
  });
});

describe("journey projections", () => {
  test("six job milestones depend on confirmed facts, with cancellation separate", () => {
    const requested: JourneyFacts = {
      jobState: "open", quoteIssued: false, windowConfirmed: false, visitReached: false,
      signedOff: false, paymentMatched: false,
    };
    const quoted = { ...requested, quoteIssued: true };
    const booked = { ...quoted, windowConfirmed: true };
    const visit = { ...booked, visitReached: true };
    const signedOff = { ...visit, signedOff: true };
    const paid = { ...signedOff, paymentMatched: true };
    const stages = [requested, quoted, booked, visit, signedOff, paid];
    expect(stages.map((facts) => projectJourney(facts).step)).toEqual([...JOURNEY_STEPS]);
    expect(projectJourney(paid)).toEqual({ step: "paid", cancelled: false, complete: true });
    expect(projectJourney({ ...visit, paymentMatched: true }).step).toBe("visit");
    expect(projectJourney({ ...booked, jobState: "cancelled" })).toEqual({ step: "booked", cancelled: true, complete: false });
    expect(projectJourney({ ...signedOff, jobState: "closed" }).step).toBe("signed_off");
  });

  test("five visit milestones use only effective crew-level stamps", () => {
    const stamps = ["crew_confirmed", "on_the_way", "on_site", "working", "finished"] satisfies CustomerUpdateKind[];
    expect(projectVisit([])).toEqual({ step: null, complete: false });
    expect(stamps.map((_, index) => projectVisit(stamps.slice(0, index + 1)).step)).toEqual([...VISIT_STEPS]);
    expect(projectVisit(stamps)).toEqual({ step: "finished", complete: true });
    expect(projectVisit(["crew_confirmed", "on_the_way", "arrival_revised"]).step).toBe("on_the_way");
    expect(projectVisit(["crew_confirmed", "arrival_revised"]).step).toBe("on_the_way");
    expect(projectVisit(["crew_confirmed", "on_the_way", "arrival_withdrawn"]).step).toBe("confirmed");
    expect(projectVisit(["crew_confirmed", "cover_arranging"]).step).toBeNull();
    expect(projectVisit(["crew_confirmed", "cover_arranging", "crew_updated"]).step).toBe("confirmed");
    expect(projectVisit(["crew_confirmed", "on_site", "arrival_withdrawn"]).step).toBe("on_site");
    expect(projectVisit(["on_site", "working", "paused", "photo", "cover_arranging"]).step).toBe("working");
  });
});
