import { DAY_MS, HOUR_MS, MINUTE_MS } from "./units";

export const INVITATION_POLICY = {
  validityMs: 48 * HOUR_MS,
  reissueWindowMs: 7 * DAY_MS,
  maxReissuesPerWindow: 2,
  providerReissueCooldownMs: DAY_MS,
  placeReissueCooldownMs: 15 * MINUTE_MS,
  maxOutstandingPerPlace: 5,
  maxOutstandingPerRecipientPerPlace: 1,
} as const;

export function invitationExpiresAt(issuedAtMs: number): number {
  return issuedAtMs + INVITATION_POLICY.validityMs;
}

/** Count only unexpired pending invitations; exclude a link replaced in the same operation. */
export function canIssuePlaceInvitation(outstandingAtPlace: number, outstandingForRecipientAtPlace: number): boolean {
  return Number.isInteger(outstandingAtPlace) && outstandingAtPlace >= 0
    && outstandingAtPlace < INVITATION_POLICY.maxOutstandingPerPlace
    && Number.isInteger(outstandingForRecipientAtPlace) && outstandingForRecipientAtPlace >= 0
    && outstandingForRecipientAtPlace < INVITATION_POLICY.maxOutstandingPerRecipientPerPlace;
}

/** History is successful reissues for this recipient and business/place, excluding the original issue. */
export function canReissueInvitation(scope: "provider" | "place", nowMs: number, reissuedAtMs: readonly number[]): boolean {
  const cooldown = scope === "provider" ? INVITATION_POLICY.providerReissueCooldownMs : INVITATION_POLICY.placeReissueCooldownMs;
  let count = 0;
  for (const reissue of reissuedAtMs) {
    const ageMs = nowMs - reissue;
    if (ageMs < cooldown) return false;
    if (ageMs < INVITATION_POLICY.reissueWindowMs && ++count >= INVITATION_POLICY.maxReissuesPerWindow) return false;
  }
  return true;
}
