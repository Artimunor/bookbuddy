import { deletePushInstallationRoute, notificationReadRoute, notificationsRoute, operationIdHeader, putPushInstallationRoute } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ApiEnv } from "../../bindings";
import { commitCommand, prepareCommand } from "../../db/commit";
import { openRequestScope } from "../../db/scope";
import { resolveSession } from "../auth/session";
import { boundedBody, scheduleOperationSignals, transportFailure, transportSuccess } from "../sync/http";
import { planNotificationRead, planPushInstallation } from "./commands";
import { decodeNotifications, notificationCursor, readNotifications } from "./read";

export const notificationRoutes = new Hono<ApiEnv>();

notificationRoutes.get(notificationsRoute.path, async (c) => {
  const parsed = notificationsRoute.input.safeParse({ query: c.req.query() });
  if (!parsed.success) return transportFailure(c, "VALIDATION_FAILED");
  const { contextId, cursor } = parsed.data.query;
  const position = cursor === undefined ? null : notificationCursor(cursor);
  if (cursor !== undefined && !position) return transportFailure(c, "VALIDATION_FAILED");
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const access = await resolveSession(c.req.raw, contextId, ctx.now);
  if (!access) return transportFailure(c, "UNAUTHENTICATED");
  const page = await commitCommand(ctx, prepareCommand(ctx, {
    statements: [readNotifications(access, ctx.now, position)],
    decode: (results) => decodeNotifications(results[0]?.results ?? []),
  }));
  return typeof page === "string" ? transportFailure(c, page) : transportSuccess(c, page, ctx.now);
});

notificationRoutes.post(notificationReadRoute.path, async (c) => {
  const parsed = notificationReadRoute.input.safeParse({ body: await boundedBody(c.req.raw) });
  if (!parsed.success || parsed.data.body.operationId !== c.req.header(operationIdHeader)) {
    return transportFailure(c, "VALIDATION_FAILED");
  }
  const { contextId, ...operation } = parsed.data.body;
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const access = await resolveSession(c.req.raw, contextId, ctx.now);
  if (!access) return transportFailure(c, "UNAUTHENTICATED");
  const plan = await planNotificationRead({ now: ctx.now, requestId: ctx.requestId, contextId, access }, operation);
  const result = await commitCommand(ctx, prepareCommand(ctx, plan));
  if (result.outcome.status === "rejected") return transportFailure(c, result.outcome.error);
  scheduleOperationSignals(c, [result]);
  return transportSuccess(c, result.outcome, ctx.now);
});

async function pushInstallation(c: Context<ApiEnv>, method: "PUT" | "DELETE") {
  const input = { params: c.req.param(), body: await boundedBody(c.req.raw) };
  const put = method === "PUT" ? putPushInstallationRoute.input.safeParse(input) : undefined;
  const revoke = method === "DELETE" ? deletePushInstallationRoute.input.safeParse(input) : undefined;
  const command = put?.success ? { id: put.data.params.id, operation: { method: "PUT" as const, body: put.data.body } }
    : revoke?.success ? { id: revoke.data.params.id, operation: { method: "DELETE" as const, body: revoke.data.body } } : null;
  if (!command || command.operation.body.operationId !== c.req.header(operationIdHeader)) {
    return transportFailure(c, "VALIDATION_FAILED");
  }
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const access = await resolveSession(c.req.raw, null, ctx.now);
  if (!access) return transportFailure(c, "UNAUTHENTICATED");
  const { id, operation } = command;
  const plan = await planPushInstallation({ now: ctx.now, access }, id, operation);
  const { outcome } = await commitCommand(ctx, prepareCommand(ctx, plan));
  if (outcome.status === "rejected") return transportFailure(c, outcome.error);
  return transportSuccess(c, {
    id, tokenEpoch: outcome.status === "unchanged" ? operation.body.expectedRevision : Number(outcome.resultRef),
    state: method === "PUT" ? "active" : "revoked", status: outcome.status,
  }, ctx.now);
}

notificationRoutes.put(putPushInstallationRoute.path, (c) => pushInstallation(c, "PUT"));
notificationRoutes.delete(deletePushInstallationRoute.path, (c) => pushInstallation(c, "DELETE"));
