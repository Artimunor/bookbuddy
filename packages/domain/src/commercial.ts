import { isBeforeDeadline } from "./deadlines";
import type { ChangeVersionState, QuoteVersionState } from "./states";

// Customers can read issued history, not even a returned version that was never issued.
export const CUSTOMER_QUOTE_VERSION_STATES = ["issued", "approved", "declined", "superseded", "withdrawn"] as const satisfies readonly QuoteVersionState[];
export const CUSTOMER_CHANGE_VERSION_STATES = ["issued", "approved", "rejected", "superseded", "withdrawn"] as const satisfies readonly ChangeVersionState[];

export const CONTRACT_NOTICE_KINDS = ["early_start_request", "early_start_acknowledgement", "withdrawal"] as const;
export type ContractNoticeKind = (typeof CONTRACT_NOTICE_KINDS)[number];

/** Display only. Commands need the persisted issued state, deadline and live authority in SQL. */
export function commercialDisplayState<State extends QuoteVersionState | ChangeVersionState>(
  state: State,
  expiresAt: number | null,
  serverTime: number,
): State | "expired" {
  return state === "issued" && expiresAt !== null && !isBeforeDeadline(serverTime, expiresAt) ? "expired" : state;
}
