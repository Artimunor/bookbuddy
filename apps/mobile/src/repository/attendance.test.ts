import { operationIdSchema, scopeHeaderSchema } from "@bookbuddy/api-contract";
import type { SyncProjection, SyncRequest } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { SyncRunner } from "../sync/runner";
import type { AttendanceCapture } from "./attendance";
import { accountId, context, page, testRepository } from "./sqlite.test-kit";

const worker = scopeHeaderSchema.parse({ contextId: context.contextId, role: "worker", businessId: "business" });
const arrival = { kind: "attendance", assignmentId: "assignment", event: "arrival", actualAt: 800, capturedAt: 810, operationId: "arrival-op" } satisfies AttendanceCapture;
const departure = { ...arrival, event: "departure", actualAt: 850, capturedAt: 865, operationId: "departure-op" } satisfies AttendanceCapture;
const arrivalStamp = { id: arrival.operationId, assignmentId: arrival.assignmentId, kind: "arrival", source: "self",
  actualAt: arrival.actualAt, capturedAt: arrival.capturedAt, receivedAt: 920, reviewState: "accepted",
  correctsId: null, reasonCode: null, recordedByName: "Worker" };

function shift(arrival: typeof arrivalStamp | null = null, pendingReviewEventIds: string[] = []): SyncProjection {
  return { kind: "worker_field_shift", resourceId: "assignment", value: {
    id: "assignment", shiftId: "shift", visitId: "visit", job: { id: "job", reference: "BB-WORK", title: "Plumbing", placeAlias: "do-not-store" },
    address: "do-not-store", arrivalPlan: { details: "do-not-store" },
    siteZone: "Europe/Lisbon", bookedWindow: { id: "window", startsAt: 700, endsAt: 900 }, task: "Plumbing", state: "confirmed",
    isLead: true, foremanName: "Foreman", crewThreadId: null, estimate: null, holds: [], work: null, nextAction: "check_in",
    attendance: { arrival, departure: null, hasPendingReview: pendingReviewEventIds.length > 0, pendingReviewEventIds },
  } };
}

test("attendance saves first, sends the original IDs, and waits for an exact event on a later page", async () => {
  const { database, mobile, repository } = await testRepository();
  try {
    await repository.applySyncPage(page("opening", { context: worker, upserts: [shift(null, ["different-event"])] }), 900);
    expect(await repository.enqueueOperation(arrival)).toBe(arrival.operationId);
    expect((await repository.getAttendanceStatus(arrival.assignmentId)).arrival?.status).toBe("saved_on_device");
    const sent: SyncRequest[] = [];
    const runner = new SyncRunner(async (request) => {
      sent.push(request);
      const local = await repository.getAttendanceStatus(arrival.assignmentId);
      expect(local.arrival?.status).toBe(sent.length === 1 ? "checking" : "sent");
      return sent.length === 1 ? { ok: true, data: page("ack", { context: worker, hasMore: true, outcomes: [
        { status: "committed", operationId: operationIdSchema.parse(request.operations[0]?.operationId), resultRef: arrival.operationId },
      ] }), meta: { serverTime: 925, requestId: "request-1" } } : {
        ok: true, data: page("projected", { context: worker, upserts: [shift(arrivalStamp, ["different-event"])] }),
        meta: { serverTime: 945, requestId: "request-2" },
      };
    });
    expect(await runner.refresh(repository)).toEqual({ status: "confirmed" });
    expect(sent).toMatchObject([
      { cursor: "opening", operations: [{ kind: "attendance", operationId: arrival.operationId,
        payload: { id: arrival.operationId, assignmentId: arrival.assignmentId, kind: "arrival", actualAt: 800, capturedAt: 810 } }] },
      { cursor: "ack", operations: [] },
    ]);
    const restored = mobile.openScope({ accountId, contextId: worker.contextId });
    expect(await restored.getAttendanceStatus(arrival.assignmentId)).toMatchObject({
      arrival: { status: "recorded", eventId: arrival.operationId, operationId: arrival.operationId, receivedAt: 920 }, lastConfirmedAt: 945,
    });
    expect(await restored.enqueueOperation(arrival)).toBe(arrival.operationId);
    expect(await restored.listOutbox()).toEqual([]);
    await expect(restored.enqueueOperation({ ...arrival, actualAt: 811 })).rejects.toThrow("reused");
    expect(await restored.getProjection("worker_field_shift", arrival.assignmentId)).toMatchObject({ data: { id: arrival.assignmentId, job: { id: "job" } } });
    expect(database.query<{ value: string }, []>("SELECT value FROM projection").get()!.value).not.toContain("do-not-store");
  } finally { database.close(); }
});

test("review and conflict are distinguished from delivery uncertainty and unrelated review", async () => {
  const { database, repository } = await testRepository();
  try {
    const arrivalId = await repository.enqueueOperation(arrival);
    const departureId = await repository.enqueueOperation(departure);
    const runner = new SyncRunner(async () => ({ ok: false, error: { code: "NETWORK_ERROR", delivery: "unknown" } }));
    expect(await runner.refresh(repository)).toMatchObject({ status: "checking" });
    expect(await repository.getAttendanceStatus(arrival.assignmentId)).toMatchObject({ arrival: { status: "checking" }, departure: { status: "checking" } });
    await repository.applySyncPage(page("replay", { context: worker, upserts: [shift(null, [arrivalId])], outcomes: [
      { status: "replayed", operationId: arrivalId, resultRef: arrivalId },
      { status: "rejected", operationId: departureId, error: { code: "CONFLICT" } },
    ] }), 935);
    expect(await repository.getAttendanceStatus(arrival.assignmentId)).toMatchObject({
      arrival: { status: "needs_review", eventId: arrivalId }, departure: { status: "conflict", error: { code: "CONFLICT" } },
    });
    expect((await repository.prepareSyncBatch()).operations).toHaveLength(0);
    await repository.applySyncPage(page("revoked", { context: worker, mode: "reset", removals: [{ kind: "scope", resourceId: worker.contextId }] }), 955);
    expect(await repository.getProjection("worker_field_shift", arrival.assignmentId)).toBeNull();
    expect(await repository.getAttendanceStatus(arrival.assignmentId)).toMatchObject({ arrival: { status: "sent" }, lastConfirmedAt: null });
  } finally { database.close(); }
});

test("attendance acknowledgement rolls back with its projection and cursor", async () => {
  const { database, repository } = await testRepository();
  try {
    await repository.applySyncPage(page("before", { context: worker, upserts: [shift()] }), 905);
    const operationId = await repository.enqueueOperation(arrival);
    await repository.prepareSyncBatch();
    database.exec("CREATE TRIGGER reject_cursor BEFORE UPDATE ON sync_state BEGIN SELECT RAISE(ABORT, 'offline write failed'); END");
    await expect(repository.applySyncPage(page("after", { context: worker, upserts: [shift(arrivalStamp)],
      outcomes: [{ status: "committed", operationId, resultRef: operationId }],
    }), 940)).rejects.toThrow("offline write failed");
    expect(await repository.getAttendanceStatus(arrival.assignmentId)).toMatchObject({ arrival: { status: "checking" }, lastConfirmedAt: 905 });
    expect(database.query("SELECT * FROM attendance_receipts").all()).toEqual([]);
    expect(await repository.prepareSyncBatch()).toMatchObject({ cursor: "before", operations: [{ operationId }] });
  } finally { database.close(); }
});
