import { cachedWorkerFieldShiftSchema, notificationSchema } from "@bookbuddy/api-contract";
import type { NotificationProjection, SyncProjection, WorkerFieldShift } from "@bookbuddy/api-contract";

export const day = 24 * 60 * 60 * 1000;
export const snapshotWindow = 3 * day;
export const draftWarnAfter = 11 * day;
export const draftExpiresAfter = 14 * day;

type Scalar = string | number | boolean | null;
export type Field = true | { readonly [key: string]: Field };
export type SelectFields<T, Rule> = T extends Scalar ? T : T extends readonly (infer Item)[] ? SelectFields<Item, Rule>[] : {
  [K in keyof T as K extends keyof Rule ? K : never]: K extends keyof Rule ? SelectFields<T[K], Rule[K]> : never;
};

export function selectFields(value: unknown, rule: Field): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((item) => selectFields(item, rule));
  if (rule === true) return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
  if (typeof value !== "object") return undefined;
  const projected: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(rule)) {
    if (!Object.hasOwn(value, key)) continue;
    const kept = selectFields((value as Record<string, unknown>)[key], child);
    if (kept !== undefined) projected[key] = kept;
  }
  return projected;
}

// Persist only explicitly selected fields, even as the wire schema grows.
const cachedNotification = notificationSchema.pick({ id: true, kind: true, createdAt: true, readAt: true }).strip();

const stampFields = {
  id: true, assignmentId: true, kind: true, source: true, actualAt: true, capturedAt: true, receivedAt: true,
  reviewState: true, correctsId: true, reasonCode: true, recordedByName: true,
} as const;
const bandFields = { startsAt: true, endsAt: true } as const;
const workerFields = {
  id: true, shiftId: true, visitId: true, job: { id: true, reference: true, title: true }, siteZone: true,
  bookedWindow: { id: true, ...bandFields }, task: true, state: true, isLead: true, foremanName: true, crewThreadId: true,
  estimate: { id: true, band: bandFields, at: true, audience: true, foremanName: true },
  attendance: { arrival: stampFields, departure: stampFields, hasPendingReview: true, pendingReviewEventIds: true },
  holds: { id: true, kind: true, state: true, clearedAt: true, instruction: { instructionId: true,
    version: { id: true, no: true, issuedByName: true, issuedAt: true } } },
  work: { id: true, kind: true, at: true, byName: true }, nextAction: true,
} as const;
const cachedFieldShift = cachedWorkerFieldShiftSchema.extend({
  job: cachedWorkerFieldShiftSchema.shape.job.pick({ id: true, reference: true, title: true }).strip(),
}).strip();

export type CachedWorkerFieldShift = SelectFields<WorkerFieldShift, typeof workerFields>;
export interface CachedProjections {
  notification: Pick<NotificationProjection, "id" | "kind" | "createdAt" | "readAt">;
  worker_field_shift: CachedWorkerFieldShift;
}
export type ProjectionKind = keyof CachedProjections;

export function cacheableValue({ kind, resourceId, value }: SyncProjection): CachedProjections[ProjectionKind] | null {
  if (kind === "notification") {
    const parsed = cachedNotification.safeParse(value);
    return parsed.success && parsed.data.id === resourceId ? parsed.data : null;
  }
  if (kind === "worker_field_shift") {
    const parsed = cachedFieldShift.safeParse(value);
    if (!parsed.success || parsed.data.id !== resourceId) return null;
    const { arrival, departure } = parsed.data.attendance;
    if ((arrival && arrival.assignmentId !== resourceId) || (departure && departure.assignmentId !== resourceId)) return null;
    return selectFields(parsed.data, workerFields) as CachedWorkerFieldShift;
  }
  return null;
}
