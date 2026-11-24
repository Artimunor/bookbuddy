import { isBeforeDeadline } from "./deadlines";
import type { Currency } from "./format";
import type { SessionHoldState } from "./states";

export const SESSIONS_FEATURE_FLAG = "sessions";
export const SESSION_VENUE_STATES = ["pending", "approved", "retired"] as const;
export const SESSION_FORMATS = ["group", "private"] as const;
export const SESSION_CHANGE_STATES = ["pending", "accepted", "declined", "withdrawn"] as const;
export const SESSION_ATTENDANCE_RESULTS = ["attended", "absent"] as const;
export const SESSION_DAY_STAGES = ["today", "doors_open", "in_session", "done"] as const;
export const SESSION_PRICE_BASES = ["per_person", "per_appointment"] as const;
export const SESSION_PAYMENT_METHOD = "pay_provider";

export type SessionPriceBasis = (typeof SESSION_PRICE_BASES)[number];

/** Flag scope is market/category. IDs and category slugs cannot contain the separator. */
export function sessionFeatureScopeKey(areaId: string, category: string): string {
  return `${areaId}:${category}`;
}

/** Hold length is category policy. No hold can extend past the slot start. */
export function sessionHoldExpiresAt(nowMs: number, startsAtMs: number, holdDurationMs: number): number | null {
  return holdDurationMs > 0 && nowMs < startsAtMs ? Math.min(nowMs + holdDurationMs, startsAtMs) : null;
}

export function isSessionHoldActive(hold: { state: SessionHoldState; expiresAt: number }, nowMs: number): boolean {
  return hold.state === "held" && isBeforeDeadline(nowMs, hold.expiresAt);
}

export type SessionPrice = { basis: SessionPriceBasis; unitMinor: number; currency: Currency };

/** The total due to the provider; a private appointment always has a quantity of one. */
export function sessionTotalMinor(price: SessionPrice, places: number): number | null {
  if (!Number.isSafeInteger(places) || places < 1 || (price.basis === "per_appointment" && places !== 1)) return null;
  const total = price.unitMinor * places;
  return Number.isSafeInteger(price.unitMinor) && Number.isSafeInteger(total) && total >= 0 ? total : null;
}

export type SessionCommitment = {
  startsAt: number;
  endsAt: number;
  venueId: string;
  /** The advertised delivery language, stored as a canonical tag. */
  language: string;
  /** The promised host, if any; not the ID of a merely confirmed assignee. */
  guaranteedHostId: string | null;
  price: SessionPrice;
  termsHash: string;
};

/** An equally qualified substitute is informational only if none of the agreed terms change. */
export function requiresSessionChangeConsent(booked: SessionCommitment, proposed: SessionCommitment): boolean {
  return booked.startsAt !== proposed.startsAt || booked.endsAt !== proposed.endsAt
    || booked.venueId !== proposed.venueId || booked.language !== proposed.language
    || booked.guaranteedHostId !== proposed.guaranteedHostId
    || booked.price.basis !== proposed.price.basis || booked.price.unitMinor !== proposed.price.unitMinor
    || booked.price.currency !== proposed.price.currency || booked.termsHash !== proposed.termsHash;
}
