import { DAY_MS } from "./units";
import type { VisitState, VisitWindowState } from "./states";

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

export const WINDOW_CONFIRMATION_MODES = ["booking", "direct_reschedule", "agreed_reschedule"] as const;
export type WindowConfirmationMode = (typeof WINDOW_CONFIRMATION_MODES)[number];

export type WindowConfirmationInput = {
  nowMs: number;
  startsAtMs: number;
  expiresAtMs: number;
  state: VisitWindowState;
  visitState: VisitState;
  replacesWindowId: string | null;
  bookedWindow: { id: string; startsAtMs: number } | null;
  visitStarted: boolean;
  providerAuthorized: boolean;
  capacityAvailable: boolean;
  requiredApprovalCurrent: boolean;
  unchangedScopeAndPrice: boolean;
  /** An explicit agreement for this replacement; a general authorisation does not count. */
  providerAgreedReplacement: boolean;
};

/** Evaluate current facts, not permission to commit: commands recheck scope, revision and these predicates atomically. */
export function windowConfirmationMode(input: WindowConfirmationInput): WindowConfirmationMode | null {
  if (input.state !== "proposed" || input.nowMs >= input.expiresAtMs || input.nowMs >= input.startsAtMs
    || input.visitStarted || !input.providerAuthorized || !input.capacityAvailable || !input.requiredApprovalCurrent) {
    return null;
  }
  const { bookedWindow } = input;
  if (bookedWindow === null) return input.visitState === "planned" && input.replacesWindowId === null ? "booking" : null;
  if (input.visitState !== "booked" || input.replacesWindowId !== bookedWindow.id) return null;
  if (input.providerAgreedReplacement) return "agreed_reschedule";
  return canConfirmAlternativeWindow(input.nowMs, bookedWindow.startsAtMs, input.unchangedScopeAndPrice)
    ? "direct_reschedule"
    : null;
}
