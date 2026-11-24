import { syncLimits } from "@bookbuddy/api-contract";
import type { ErrorBody, ErrorCode, ErrorEnvelope, SuccessEnvelope } from "@bookbuddy/api-contract";
import type { Context } from "hono";
import type { ApiEnv } from "../../bindings";
import type { OperationResult } from "../../db/operations";

const statusByCode = {
  UNAUTHENTICATED: 401, NOT_FOUND: 404, VALIDATION_FAILED: 422, CONFLICT: 409, STALE_REVISION: 409,
  OPERATION_ID_REUSED: 409, RATE_LIMITED: 429, UNAVAILABLE: 503, INTERNAL_ERROR: 500,
} as const satisfies Record<ErrorCode, number>;

export function transportFailure(c: Context<ApiEnv>, error: ErrorCode | ErrorBody) {
  const body = typeof error === "string" ? { code: error } : error;
  const response: ErrorEnvelope = { ok: false, error: body, meta: { requestId: c.var.requestId } };
  return c.json(response, statusByCode[body.code]);
}

export function transportSuccess<T>(c: Context<ApiEnv>, data: T, now: number) {
  const response: SuccessEnvelope<T> = { ok: true, data, meta: { requestId: c.var.requestId, serverTime: now } };
  return c.json(response);
}

export async function boundedBody(request: Request): Promise<unknown> {
  if (!request.body || Number(request.headers.get("Content-Length")) > syncLimits.requestBytes) return undefined;
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let size = 0, body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(body + decoder.decode());
      size += value.byteLength;
      if (size > syncLimits.requestBytes) {
        await reader.cancel();
        return undefined;
      }
      body += decoder.decode(value, { stream: true });
    }
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

export function scheduleOperationSignals(c: Context<ApiEnv>, results: readonly OperationResult[]): void {
  const workKeys = new Set<string>();
  const topics = new Set<string>();
  for (const result of results) {
    for (const key of result.workKeys) workKeys.add(key);
    for (const topic of result.topics) topics.add(`${topic.kind}:${topic.opaqueId}`);
  }
  if (!workKeys.size && !topics.size) return;
  // Launch only after commit. The durable outbox remains authoritative if a wake fails.
  const tasks: Promise<unknown>[] = [];
  if (workKeys.size) tasks.push(c.env.EFFECTS.send({ workKeys: [...workKeys] }));
  for (const name of topics) tasks.push(c.env.LIVE.getByName(name).publishInvalidation());
  c.executionCtx.waitUntil(Promise.allSettled(tasks));
}
