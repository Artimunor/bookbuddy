import type { LinkOpening } from "@bookbuddy/api-contract";

const handoffs = new Map<string, { opening: LinkOpening; sessionId: string; contextId: string | null }>();

export function requiresNativeApp(opening: LinkOpening, customerContext: boolean) {
  return opening.kind === "shift" || opening.kind === "cover" || opening.kind === "assignment_offer" ||
    opening.kind === "crew_availability" || opening.kind === "business_overview" || opening.kind === "business_member" ||
    opening.kind === "business_eligibility" || (opening.kind === "completion" && opening.completion.audience !== "customer") ||
    (opening.kind === "bill" && opening.bill.audience !== "customer") || (opening.kind === "problem_case" && !customerContext) ||
    (opening.kind === "switch_context" && opening.choices.every(choice => choice.scope.role !== "customer"));
}

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
