const day = 24 * 60 * 60 * 1_000;
export const pendingReviewAfter = 7 * day;
export const pendingHoldAfter = 30 * day;

export function pendingAge(createdAt: number | undefined, now: number, reviewed = false) {
  if (createdAt === undefined || reviewed) return "current";
  if (now >= createdAt + pendingHoldAfter) return "held";
  return now >= createdAt + pendingReviewAfter ? "review" : "current";
}
