/// <reference lib="es2024.promise" />
import type { ApiResult } from "@bookbuddy/api-client";
import { operationIdSchema } from "@bookbuddy/api-contract";
import type { SyncPage, SyncRequest } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { notification, page, testRepository } from "../repository/sqlite.test-kit";
import { SyncRunner } from "./runner";

const readOperation = { kind: "notification_read_mark" as const, payload: { ids: ["notice"] } };

test("an unknown response retains both cursor and IDs: the next trigger reconciles the same operation", async () => {
  const { database, repository } = await testRepository();
  try {
    await repository.applySyncPage(page("before"), 910);
    const operationId = await repository.enqueueOperation(readOperation);
    const sent: SyncRequest[] = [];
    const runner = new SyncRunner(async (request) => {
      sent.push(request);
      if (sent.length === 1) return { ok: false, error: { code: "NETWORK_ERROR", delivery: "unknown" } };
      return { ok: true, data: page("after", { outcomes: [{ operationId, status: "replayed", resultRef: "receipt" }] }),
        meta: { requestId: "reply", serverTime: 970 } };
    });
    expect(await runner.refresh(repository)).toEqual({ status: "checking", code: "NETWORK_ERROR" });
    expect(sent).toHaveLength(1);
    expect(await repository.listOutbox()).toMatchObject([{ operation: { operationId }, status: "checking" }]);
    expect((await repository.getLastConfirmed())?.confirmedAt).toBe(910);
    expect(await runner.refresh(repository)).toEqual({ status: "confirmed" });
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[1]).toMatchObject({ cursor: "before", operations: [{ operationId }] });
    expect(await repository.listOutbox()).toEqual([]);
  } finally { database.close(); }
});

test("a proven unsent batch does not promote queued IDs to Checking or downgrade earlier unknown IDs", async () => {
  const { database, repository } = await testRepository();
  try {
    const checking = await repository.enqueueOperation(readOperation);
    const first = new SyncRunner(async () => ({ ok: false, error: { code: "NETWORK_ERROR", delivery: "unknown" } }));
    await first.refresh(repository);
    const queued = await repository.enqueueOperation(readOperation);
    const runner = new SyncRunner(async () => ({ ok: false, error: { code: "REQUEST_SETUP_FAILED", delivery: "not_sent" } }));
    expect(await runner.refresh(repository)).toEqual({ status: "unsent", code: "REQUEST_SETUP_FAILED" });
    expect(await repository.listOutbox()).toMatchObject([
      { operation: { operationId: checking }, status: "checking" }, { operation: { operationId: queued }, status: "queued" },
    ]);
  } finally { database.close(); }
});

test("concurrent triggers share one flight and pages drain in bounded batches", async () => {
  const { database, repository } = await testRepository();
  try {
    for (let i = 0; i < 9; i++) await repository.enqueueOperation(readOperation);
    const arrival = Promise.withResolvers<SyncRequest>();
    const response = Promise.withResolvers<ApiResult<SyncPage>>();
    const requests: SyncRequest[] = [];
    const runner = new SyncRunner(async (request) => {
      requests.push(request);
      if (requests.length === 1) { arrival.resolve(request); return response.promise; }
      return { ok: true, data: page("done", { outcomes: request.operations.map(({ operationId }) => ({ operationId: operationIdSchema.parse(operationId), status: "unchanged" })) }),
        meta: { requestId: "reply-2", serverTime: 990 } };
    });
    const first = runner.refresh(repository);
    expect(runner.refresh(repository)).toBe(first);
    const request = await arrival.promise;
    expect(requests).toHaveLength(1);
    expect(request.operations).toHaveLength(8);
    response.resolve({ ok: true, data: page("partial", { hasMore: true,
      outcomes: request.operations.map(({ operationId }) => ({ operationId: operationIdSchema.parse(operationId), status: "unchanged" })) }), meta: { requestId: "reply-1", serverTime: 980 } });
    expect(await first).toEqual({ status: "confirmed" });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.cursor).toEqual("partial");
    expect(requests[1]?.operations).toHaveLength(1);
    expect(await repository.listOutbox()).toEqual([]);
  } finally { database.close(); }
});

test("out-of-scope replies purge the snapshot but keep authored work", async () => {
  const { database, repository } = await testRepository();
  try {
    await repository.applySyncPage(page("before", { upserts: [notification("notice", null)] }), 910);
    const operationId = await repository.enqueueOperation(readOperation);
    const runner = new SyncRunner(async () => ({ ok: false, error: { code: "NOT_FOUND" }, meta: { requestId: "reply" } }));
    expect(await runner.refresh(repository)).toEqual({ status: "blocked", code: "NOT_FOUND" });
    expect(await repository.getProjection("notification", "notice")).toBeNull();
    expect(database.query("SELECT cursor FROM sync_state").get()).toEqual({ cursor: "before" });
    expect(await repository.listOutbox()).toMatchObject([{ operation: { operationId }, status: "queued" }]);
  } finally { database.close(); }
});
