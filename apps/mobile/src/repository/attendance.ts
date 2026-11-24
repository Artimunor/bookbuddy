import type { ErrorBody, SyncOp } from "@bookbuddy/api-contract";
import type { CachedWorkerFieldShift } from "./cache";
import type { OutboxStatus } from "./schema";

export type AttendanceOperation = Extract<SyncOp, { kind: "attendance" }>;
export type AttendanceEventKind = AttendanceOperation["payload"]["kind"];
export type AttendanceCapture = {
  kind: "attendance";
  assignmentId: string;
  event: AttendanceEventKind;
  actualAt: number;
  capturedAt: number;
  operationId?: string;
};
export type AttendanceProgress = {
  status: "saved_on_device" | "checking" | "sent" | "recorded" | "needs_review" | "conflict" | "failed";
  operationId: string | null;
  eventId: string;
  actualAt: number;
  capturedAt: number;
  receivedAt: number | null;
  error: ErrorBody | null;
};
type Stamps = Record<AttendanceEventKind, AttendanceProgress | null>;
export type AttendanceStatus = Stamps & { lastConfirmedAt: number | null };
export type AttendanceSnapshot = AttendanceStatus & { local: Stamps; expiresAt: number | null };

export type LocalAttendance = {
  operation: AttendanceOperation;
  createdAt: number;
} & ({ status: "sent"; resultRef: string | null } | { status: OutboxStatus; error: ErrorBody | null });

type ConfirmedAttendance = CachedWorkerFieldShift["attendance"];

export function attendanceProgress(kind: AttendanceEventKind, local: LocalAttendance | undefined, confirmed?: ConfirmedAttendance): AttendanceProgress | null {
  const accepted = confirmed?.[kind];
  if (local && local.status !== "sent") {
    const { id, actualAt, capturedAt } = local.operation.payload;
    return { status: local.status === "queued" ? "saved_on_device" : local.status === "rejected" ? "failed" : local.status,
      operationId: local.operation.operationId, eventId: id, actualAt, capturedAt, receivedAt: null, error: local.error };
  }
  const submitted = local?.operation.payload;
  const eventId = local && submitted ? local.resultRef ?? submitted.id : null;
  // `unchanged` has no resultRef. The server only deduplicates a different
  // event ID against an accepted self-record with this exact kind/time.
  if (accepted && (!submitted || accepted.id === eventId || accepted.correctsId === eventId ||
    (local?.resultRef === null && accepted.source === "self" && accepted.actualAt === submitted.actualAt))) {
    return { status: "recorded", operationId: local?.operation.operationId ?? null, eventId: accepted.id,
      actualAt: accepted.actualAt, capturedAt: accepted.capturedAt, receivedAt: accepted.receivedAt, error: null };
  }
  if (!local || !submitted || eventId === null) return null;
  return { status: confirmed?.pendingReviewEventIds?.some((id) => id === eventId) ? "needs_review" : "sent",
    operationId: local.operation.operationId, eventId, actualAt: submitted.actualAt, capturedAt: submitted.capturedAt,
    receivedAt: null, error: null };
}
