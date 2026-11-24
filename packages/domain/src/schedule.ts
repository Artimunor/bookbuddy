import { DAY_MS } from "./units";

export const DIRECT_RESCHEDULE_NOTICE_MS = DAY_MS;

/** Pass the earlier of the booked start and a confirmed actual start. Not statutory withdrawal. */
export function canCancelFeeFree(nowMs: number, visitStartsAtMs: number, workAlreadyPerformed: boolean): boolean {
  return nowMs < visitStartsAtMs && !workAlreadyPerformed;
}

/** The alternative must be current, eligible, provider-authorised and like-for-like. */
export function canConfirmAlternativeWindow(
  nowMs: number,
  visitStartsAtMs: number,
  hasEligibleAlternative: boolean,
): boolean {
  return hasEligibleAlternative && visitStartsAtMs - nowMs >= DIRECT_RESCHEDULE_NOTICE_MS;
}
