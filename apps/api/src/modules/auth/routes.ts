import {
  accountSettingsRoute, emailResendRoute, emailStartRoute, emailStatusRoute, emailVerifyRoute,
  sessionContextRoute, sessionEndRoute, sessionRoute,
} from "@bookbuddy/api-contract";
import type { ErrorBody, ErrorEnvelope, SuccessEnvelope } from "@bookbuddy/api-contract";
import { enabledLocales } from "@bookbuddy/i18n/locales";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ApiEnv } from "../../bindings";
import { openRequestScope } from "../../db/scope";
import { closeRevokedSession } from "../../realtime/topics";
import { changeSettings, endSession, readSession, switchContext } from "./commands";
import { loadOtpKey } from "./crypto";
import { getOtpStatus, sendOtp, verifyOtp } from "./otp";
import type { SendResult } from "./otp";
import { clearSessionCookie, isTrustedOrigin, resolveSession, sessionCookie } from "./session";

export const authRoutes = new Hono<ApiEnv>();
const uiTags = new Set<string>(enabledLocales.map(({ tag }) => tag));
const errorStatus = {
  UNAUTHENTICATED: 401, NOT_FOUND: 404, VALIDATION_FAILED: 422, CONFLICT: 409, STALE_REVISION: 409,
  OPERATION_ID_REUSED: 409, RATE_LIMITED: 429, UNAVAILABLE: 503, INTERNAL_ERROR: 500,
} as const;

function ok<T>(c: Context<ApiEnv>, data: T, serverTime: number) {
  return c.json<SuccessEnvelope<T>>({ ok: true, data, meta: { requestId: c.var.requestId, serverTime } });
}

function fail(c: Context<ApiEnv>, error: ErrorBody) {
  return c.json<ErrorEnvelope>({ ok: false, error, meta: { requestId: c.var.requestId } }, errorStatus[error.code]);
}

async function body(c: Context<ApiEnv>, maxBytes = 16 * 1024): Promise<unknown> {
  if (c.req.header("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return undefined;
  const { raw: request } = c.req;
  if (!request.body || Number(request.headers.get("Content-Length")) > maxBytes) return undefined;
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, json = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return JSON.parse(json + decoder.decode());
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        return undefined;
      }
      json += decoder.decode(value, { stream: true });
    }
  } catch {
    void reader.cancel().catch(() => {});
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

function allowsChallengeTransport(req: Request, mode: "web" | "native"): boolean {
  if (mode === "web") return isTrustedOrigin(req);
  // A browser must not bypass HttpOnly by requesting the native credential.
  // Fetch Metadata and Origin are controlled by the browser, not app scripts.
  return !req.headers.has("Origin") && !req.headers.has("Sec-Fetch-Site");
}

function deliveryOptions(c: Context<ApiEnv>) {
  const { hostname } = new URL(c.req.url);
  return {
    bindings: c.env, source: c.req.header("CF-Connecting-IP") ?? null,
    language: c.req.header("Accept-Language"), local: ["localhost", "127.0.0.1", "[::1]"].includes(hostname),
  };
}

async function wake(c: Context<ApiEnv>, key?: string) {
  if (!key) return;
  // The D1 intent is durable; the due sweep recovers a missed queue wake.
  const send = Promise.resolve().then(() => c.env.EFFECTS.send({ workKeys: [key] })).catch(() => {});
  try { c.executionCtx.waitUntil(send); } catch { await send; }
}

async function sendResponse(c: Context<ApiEnv>, result: SendResult, now: number) {
  if (result.kind === "locked") return fail(c, { code: "RATE_LIMITED", retryAt: result.retryAt });
  if (result.kind === "unavailable") return fail(c, { code: "UNAVAILABLE" });
  if (result.kind === "missing") return fail(c, { code: "NOT_FOUND" });
  if (result.kind !== "ok") return fail(c, { code: "CONFLICT" });
  await wake(c, result.workKey);
  return ok(c, result.attempt, now);
}

authRoutes.post(emailStartRoute.path, async (c) => {
  const input = emailStartRoute.input.safeParse({ body: await body(c) });
  if (!input.success) return fail(c, { code: "VALIDATION_FAILED" });
  const { body: payload } = input.data;
  if (!allowsChallengeTransport(c.req.raw, payload.transport)) return fail(c, { code: "UNAUTHENTICATED" });
  const key = await loadOtpKey(c.env.OTP_HMAC_KEY);
  if (!key) return fail(c, { code: "UNAVAILABLE" });
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  return sendResponse(c, await sendOtp(ctx, key, payload, deliveryOptions(c)), ctx.now);
});

authRoutes.post(emailResendRoute.path, async (c) => {
  const input = emailResendRoute.input.safeParse({ params: c.req.param(), body: await body(c) });
  if (!input.success) return fail(c, { code: "VALIDATION_FAILED" });
  const { params: { attempt }, body: { payload, expectedRevision, operationId } } = input.data;
  if (!allowsChallengeTransport(c.req.raw, payload.transport)) return fail(c, { code: "UNAUTHENTICATED" });
  const key = await loadOtpKey(c.env.OTP_HMAC_KEY);
  if (!key) return fail(c, { code: "UNAVAILABLE" });
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  return sendResponse(c, await sendOtp(ctx, key, payload, deliveryOptions(c), { token: attempt, revision: expectedRevision, operationId }), ctx.now);
});

authRoutes.get(emailStatusRoute.path, async (c) => {
  const input = emailStatusRoute.input.safeParse({ params: c.req.param() });
  if (!input.success) return fail(c, { code: "NOT_FOUND" });
  const key = await loadOtpKey(c.env.OTP_HMAC_KEY);
  if (!key) return fail(c, { code: "UNAVAILABLE" });
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const result = await getOtpStatus(ctx, key, input.data.params.attempt, c.req.header("CF-Connecting-IP") ?? null);
  return result ? ok(c, result, ctx.now) : fail(c, { code: "NOT_FOUND" });
});

authRoutes.post(emailVerifyRoute.path, async (c) => {
  const input = emailVerifyRoute.input.safeParse({ params: c.req.param(), body: await body(c) });
  if (!input.success) return fail(c, { code: "VALIDATION_FAILED" });
  const { transport } = input.data.body.payload;
  if (!allowsChallengeTransport(c.req.raw, transport)) return fail(c, { code: "UNAUTHENTICATED" });
  const key = await loadOtpKey(c.env.OTP_HMAC_KEY);
  if (!key) return fail(c, { code: "UNAVAILABLE" });
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const result = await verifyOtp(ctx, key, input.data.params.attempt, input.data.body, c.req.header("CF-Connecting-IP") ?? null);
  switch (result.kind) {
    case "verified": {
      const { session, credential } = result;
      if (transport === "web") c.header("Set-Cookie", sessionCookie(credential, session.expiresAt, ctx.now));
      return ok(c, { status: "verified" as const, session, ...(transport === "native" ? { credential } : {}) }, ctx.now);
    }
    case "wrong_code": return ok(c, { status: "wrong_code" as const, triesLeft: result.triesLeft }, ctx.now);
    case "expired": return ok(c, { status: "expired" as const }, ctx.now);
    case "locked": return fail(c, { code: "RATE_LIMITED", retryAt: result.retryAt });
    case "consumed": return fail(c, { code: "CONFLICT" });
    case "denied": return fail(c, { code: "UNAUTHENTICATED" });
    default: return fail(c, { code: "NOT_FOUND" });
  }
});

authRoutes.get(sessionRoute.path, async (c) => {
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const access = await resolveSession(c.req.raw, null, ctx.now);
  const session = access && await readSession(ctx, access);
  return session ? ok(c, session, ctx.now) : fail(c, { code: "UNAUTHENTICATED" });
});

authRoutes.post(sessionContextRoute.path, async (c) => {
  const input = sessionContextRoute.input.safeParse({ body: await body(c) });
  if (!input.success) return fail(c, { code: "VALIDATION_FAILED" });
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const access = await resolveSession(c.req.raw, null, ctx.now);
  if (!access) return fail(c, { code: "UNAUTHENTICATED" });
  const { operationId, payload: { contextId } } = input.data.body;
  const result = await switchContext(ctx, access, operationId, contextId);
  return "session" in result ? ok(c, result.session, ctx.now) : fail(c, result.error);
});

authRoutes.post(sessionEndRoute.path, async (c) => {
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const access = await resolveSession(c.req.raw, null, ctx.now);
  const revoked = access && await endSession(ctx, access);
  if (!revoked) return fail(c, { code: "UNAUTHENTICATED" });
  // D1 has revoked access. If the transport is unavailable, short socket leases still expire.
  await closeRevokedSession(c.env.LIVE, revoked).catch(() => {});
  if (!c.req.header("Authorization")) c.header("Set-Cookie", clearSessionCookie);
  return ok(c, { ended: true as const }, ctx.now);
});

authRoutes.patch(accountSettingsRoute.path, async (c) => {
  const input = accountSettingsRoute.input.safeParse({ body: await body(c) });
  if (!input.success) return fail(c, { code: "VALIDATION_FAILED" });
  const { operationId, expectedRevision, payload } = input.data.body;
  if (payload.uiLocale !== undefined && !uiTags.has(payload.uiLocale)) {
    return fail(c, { code: "VALIDATION_FAILED", fieldErrors: [{ path: ["payload", "uiLocale"], code: "INVALID_VALUE" }] });
  }
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const access = await resolveSession(c.req.raw, null, ctx.now);
  if (!access) return fail(c, { code: "UNAUTHENTICATED" });
  const result = await changeSettings(ctx, access, operationId, expectedRevision, payload);
  return "session" in result ? ok(c, result.session, ctx.now) : fail(c, result.error);
});
