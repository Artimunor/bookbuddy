import type { ErrorCode, ErrorEnvelope } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { ApiEnv } from "./bindings";
import { API_BASE_PATH, PRIVATE_CACHE_CONTROL } from "./config";
import { commercialRoutes } from "./modules/commercial/routes";
import { accessRoutes } from "./modules/access/routes";
import { authRoutes } from "./modules/auth/routes";
import { assignmentBriefingSyncProjection, attendanceRoutes, attendanceSyncOperation, fieldLiveRoutes, workerFieldShiftSyncProjection } from "./modules/field";
import { jobSyncProjections } from "./modules/jobs/projections";
import { jobsCommandRoutes } from "./modules/jobs/routes.commands";
import { jobsReadRoutes } from "./modules/jobs/routes.read";
import { placeSyncProjection } from "./modules/places/read";
import { placesRoutes } from "./modules/places/routes";
import { scheduleRoutes, scheduleSyncProjections } from "./modules/schedule";
import { coverSyncProjection, staffingRoutes } from "./modules/staffing";
import { createTransportRoutes } from "./modules/sync/routes";

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

  app.route(API_BASE_PATH, authRoutes);
  app.route(API_BASE_PATH, jobsCommandRoutes);
  app.route(API_BASE_PATH, jobsReadRoutes);
  app.route(API_BASE_PATH, createTransportRoutes({
    operations: [attendanceSyncOperation],
    projections: [
      placeSyncProjection, ...jobSyncProjections, ...scheduleSyncProjections, coverSyncProjection,
      workerFieldShiftSyncProjection, assignmentBriefingSyncProjection,
    ],
  }));
  app.route(API_BASE_PATH, accessRoutes);
  app.route(API_BASE_PATH, placesRoutes);
  app.route(API_BASE_PATH, commercialRoutes);
  app.route(API_BASE_PATH, scheduleRoutes);
  app.route(API_BASE_PATH, staffingRoutes);
  app.route(API_BASE_PATH, attendanceRoutes);
  app.route(API_BASE_PATH, fieldLiveRoutes);

  // Mount feature routers here via app.basePath(API_BASE_PATH).route("/", routes).
  // Routers' paths are relative to /api/v1, not each module name (see plan §3).
  // Auth, access, places, jobs, commercial, schedule, staffing, field, aftercare,
  // chat, media, sync, notifications, realtime, ops, sessions (gated Later).

  app.notFound((c) => c.json(failure(c.var.requestId, "NOT_FOUND"), 404));
  app.onError((_error, c) => c.json(failure(c.var.requestId, "INTERNAL_ERROR"), 500));

  return app;
}

export const app = createApp();
