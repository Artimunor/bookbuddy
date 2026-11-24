import type { LinkOpening } from "@bookbuddy/api-contract";

const handoffs = new Map<string, { opening: LinkOpening; sessionId: string; contextId: string | null }>();

export function clearCheckedOpenings() { handoffs.clear(); }
export function storeCheckedOpening(opening: LinkOpening, sessionId: string, contextId: string | null): string {
  handoffs.clear();
  const nonce = crypto.randomUUID();
  handoffs.set(nonce, { opening, sessionId, contextId });
  return nonce;
}
export function takeCheckedOpening(state: unknown, sessionId: string | undefined, contextId: string | null): LinkOpening | null {
  if (!state || typeof state !== "object" || !("checkedNonce" in state) || typeof state.checkedNonce !== "string") return null;
  const item = handoffs.get(state.checkedNonce);
  handoffs.delete(state.checkedNonce);
  return item && item.sessionId === sessionId && item.contextId === contextId ? item.opening : null;
}
