import type { ErrorCode, ErrorEnvelope } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { ApiEnv } from "./bindings";
import { API_BASE_PATH, PRIVATE_CACHE_CONTROL } from "./config";
import { transportRoutes } from "./modules/sync/routes";

function failure(requestId: string, code: ErrorCode): ErrorEnvelope {
  return { ok: false, error: { code }, meta: { requestId } };
}

export function createApp() {
  const app = new Hono<ApiEnv>();

  app.use("*", async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    c.header("Cache-Control", PRIVATE_CACHE_CONTROL);
    await next();
  });

  app.route(API_BASE_PATH, transportRoutes);

  // Mount feature routers here via app.basePath(API_BASE_PATH).route("/", routes).
  // Routers' paths are relative to /api/v1, not each module name (see plan §3).
  // Auth, access, places, jobs, commercial, schedule, staffing, field, aftercare,
  // chat, media, sync, notifications, realtime, ops, sessions (gated Later).

  app.notFound((c) => c.json(failure(c.var.requestId, "NOT_FOUND"), 404));
  app.onError((_error, c) => c.json(failure(c.var.requestId, "INTERNAL_ERROR"), 500));

  return app;
}

export const app = createApp();
