import type { CustomerSessionBooking, SessionHoldProjection } from "@bookbuddy/api-contract";
import type { Href } from "expo-router";
import { useSession } from "../../session";

export type Checkout = {
  scope: string;
  hold: SessionHoldProjection;
  clockOffset: number;
  bookingId: string;
  moveRevision?: CustomerSessionBooking["revision"];
};

// A hold receipt belongs to the active customer and never goes in a URL or on disk.
let current: Checkout | null = null;

export function useCheckoutScope() {
  const { session } = useSession();
  const context = session?.activeContext;
  return session && context?.role === "customer" ? `${session.sessionId}:${context.contextId}` : null;
}

export function enterCheckout(checkout: Checkout): Href {
  current = checkout;
  return { pathname: "/c/sessions/[listingId]/book", params: { listingId: checkout.hold.listingId, holdId: checkout.hold.id } } as Href;
}

export function readCheckout(scope: string | null, listingId: string, holdId: string) {
  if (current?.scope === scope && current.hold.listingId === listingId && current.hold.id === holdId) return current;
  return null;
}

export function clearCheckout(checkout: Checkout) {
  if (current === checkout) current = null;
}
