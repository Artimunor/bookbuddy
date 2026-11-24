import type { AttendanceReviewState } from "./states";
import { MINUTE_MS } from "./units";

export const COVER_POLICY = {
  maxRecipientsPerDispatch: 3,
  maxDispatchesPerGap: 2,
  defaultReplyMs: 15 * MINUTE_MS,
  minimumReplyMs: 5 * MINUTE_MS,
  confirmationMs: 5 * MINUTE_MS,
} as const;

export type CoverDispatchInput = {
  readonly issuedAtMs: number;
  readonly safeCutoffMs: number;
  readonly shiftStartsAtMs: number;
  /** Distinct eligible recipients for this dispatch. */
  readonly recipientCount: number;
  /** Dispatches already issued for this gap, not acceptance rounds. */
  readonly dispatchesUsed: number;
};

/** Null means no safe timed dispatch; authority and eligibility are checked by the caller. */
export function coverReplyDeadline(input: CoverDispatchInput): number | null {
  const { issuedAtMs, safeCutoffMs, shiftStartsAtMs, recipientCount, dispatchesUsed } = input;
  if (!Number.isInteger(recipientCount) || recipientCount < 1 || recipientCount > COVER_POLICY.maxRecipientsPerDispatch
    || !Number.isInteger(dispatchesUsed) || dispatchesUsed < 0 || dispatchesUsed >= COVER_POLICY.maxDispatchesPerGap) {
    return null;
  }
  const replyUntil = Math.min(
    issuedAtMs + COVER_POLICY.defaultReplyMs,
    Math.min(safeCutoffMs, shiftStartsAtMs) - COVER_POLICY.confirmationMs,
  );
  return replyUntil - issuedAtMs >= COVER_POLICY.minimumReplyMs ? replyUntil : null;
}

/** For an otherwise valid recorded reply; null means there is no time to confirm. */
export function coverConfirmationDeadline(acceptedAtMs: number, safeCutoffMs: number, shiftStartsAtMs: number): number | null {
  const deadline = Math.min(acceptedAtMs + COVER_POLICY.confirmationMs, safeCutoffMs, shiftStartsAtMs);
  return acceptedAtMs < deadline ? deadline : null;
}

export const ATTENDANCE_REVIEW_POLICY = {
  arrivalBeforeStartMs: 30 * MINUTE_MS,
  arrivalAfterStartMs: 60 * MINUTE_MS,
  departureAfterEndMs: 120 * MINUTE_MS,
} as const;

export type AttendanceReviewInput = {
  readonly actualAtMs: number;
  readonly disputed?: boolean;
} & (
  | { readonly kind: "arrival"; readonly shiftStartsAtMs: number }
  | { readonly kind: "departure"; readonly shiftEndsAtMs: number; readonly acceptedArrivalAtMs: number | null }
);

/** Inclusive review bounds on actual time, independent of capture, receipt and safety holds. */
export function attendanceReviewState(input: AttendanceReviewInput): AttendanceReviewState {
  if (input.disputed) return "needs_review";
  const { actualAtMs } = input;
  if (input.kind === "arrival") {
    return actualAtMs >= input.shiftStartsAtMs - ATTENDANCE_REVIEW_POLICY.arrivalBeforeStartMs
      && actualAtMs <= input.shiftStartsAtMs + ATTENDANCE_REVIEW_POLICY.arrivalAfterStartMs
      ? "accepted" : "needs_review";
  }
  return input.acceptedArrivalAtMs !== null && actualAtMs >= input.acceptedArrivalAtMs
    && actualAtMs <= input.shiftEndsAtMs + ATTENDANCE_REVIEW_POLICY.departureAfterEndMs
    ? "accepted" : "needs_review";
}
