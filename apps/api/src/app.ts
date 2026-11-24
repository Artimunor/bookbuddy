import type { ErrorCode, ErrorEnvelope } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { ApiEnv } from "./bindings";
import { API_BASE_PATH, PRIVATE_CACHE_CONTROL } from "./config";
import { commercialRoutes } from "./modules/commercial/routes";
import { accessRoutes } from "./modules/access/routes";
import { billingRoutes, completionRoutes } from "./modules/aftercare";
import { cookieSessionChanged } from "./modules/auth/session";
import { authRoutes } from "./modules/auth/routes";
import { chatThreadSyncProjection } from "./modules/chat/read";
import { chatRoutes } from "./modules/chat/routes";
import { chatAppendSyncOperation, chatReadSyncOperation } from "./modules/chat/sync";
import {
  assignmentBriefingSyncProjection, attendanceRoutes, attendanceSyncOperation, fieldLiveRoutes, progressAttachmentSyncOperation,
  workerFieldShiftSyncProjection,
} from "./modules/field";
import { jobSyncProjections } from "./modules/jobs/projections";
import { jobsCommandRoutes } from "./modules/jobs/routes.commands";
import { jobsReadRoutes } from "./modules/jobs/routes.read";
import { liveRoutes } from "./modules/live/routes";
import { mediaRoutes } from "./modules/media/routes";
import { placeSyncProjection } from "./modules/places/read";
import { placesRoutes } from "./modules/places/routes";
import { scheduleRoutes, scheduleSyncProjections } from "./modules/schedule";
import { sessionBookingSyncProjection, sessionsRoutes } from "./modules/sessions";
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
    if (c.res.status === 401 && await cookieSessionChanged(c.req.raw, c.env.DB)) {
      c.res = c.json<ErrorEnvelope>({
        ok: false, error: { code: "CONFLICT", current: { kind: "session_changed" } }, meta: { requestId },
      }, 409);
    }
  });

  app.route(API_BASE_PATH, authRoutes);
  app.route(API_BASE_PATH, jobsCommandRoutes);
  app.route(API_BASE_PATH, jobsReadRoutes);
  app.route(API_BASE_PATH, createTransportRoutes({
    operations: [attendanceSyncOperation, progressAttachmentSyncOperation, chatAppendSyncOperation, chatReadSyncOperation],
    projections: [
      placeSyncProjection, ...jobSyncProjections,
      ...scheduleSyncProjections.map((reader) => ({ ...reader, roles: ["worker"] as const })),
      { ...coverSyncProjection, roles: ["foreman", "worker"] },
      { ...workerFieldShiftSyncProjection, roles: ["worker"] },
      { ...assignmentBriefingSyncProjection, roles: ["worker"] },
      chatThreadSyncProjection, sessionBookingSyncProjection,
    ],
  }));
  app.route(API_BASE_PATH, accessRoutes);
  app.route(API_BASE_PATH, placesRoutes);
  app.route(API_BASE_PATH, commercialRoutes);
  app.route(API_BASE_PATH, scheduleRoutes);
  app.route(API_BASE_PATH, staffingRoutes);
  app.route(API_BASE_PATH, attendanceRoutes);
  app.route(API_BASE_PATH, fieldLiveRoutes);
  app.route(API_BASE_PATH, mediaRoutes);
  app.route(API_BASE_PATH, completionRoutes);
  app.route(API_BASE_PATH, billingRoutes);
  app.route(API_BASE_PATH, chatRoutes);
  app.route(API_BASE_PATH, liveRoutes);
  app.route(API_BASE_PATH, sessionsRoutes);

  // Mount feature routers here via app.basePath(API_BASE_PATH).route("/", routes).
  // Routers' paths are relative to /api/v1, not each module name (see plan §3).
  // Auth, access, places, jobs, commercial, schedule, staffing, field, aftercare,
  // chat, media, sync, notifications, realtime, ops, sessions (gated Later).

  app.notFound((c) => c.json(failure(c.var.requestId, "NOT_FOUND"), 404));
  app.onError((_error, c) => c.json(failure(c.var.requestId, "INTERNAL_ERROR"), 500));

  return app;
}

export const app = createApp();
