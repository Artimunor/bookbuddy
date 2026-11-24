import { notificationSchema } from "@bookbuddy/api-contract";
import type { NotificationProjection, SyncProjection } from "@bookbuddy/api-contract";

export const day = 24 * 60 * 60 * 1000;
export const snapshotWindow = 3 * day;
export const draftWarnAfter = 11 * day;
export const draftExpiresAfter = 14 * day;

// Transport registers only the safe notification projection for offline use.
// Do not persist its link token, or cache any other kind without an explicit
// server allowlist and matching field schema here. Never store a raw DTO.
const cachedNotification = notificationSchema.pick({ id: true, kind: true, createdAt: true, readAt: true }).strip();
export interface CachedProjections {
  notification: Pick<NotificationProjection, "id" | "kind" | "createdAt" | "readAt">;
}
export type ProjectionKind = keyof CachedProjections;

export function cacheableValue({ kind, resourceId, value }: SyncProjection): CachedProjections[ProjectionKind] | null {
  if (kind !== "notification") return null;
  const parsed = cachedNotification.safeParse(value);
  return parsed.success && parsed.data.id === resourceId ? parsed.data : null;
}
