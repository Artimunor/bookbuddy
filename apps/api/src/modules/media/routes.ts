import { createMediaGrantsRoute, createMediaReadGrantsRoute, recoverMediaRoute, settleMediaRoute } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { ApiEnv, Bindings } from "../../bindings";
import { openRequestScope } from "../../db/scope";
import type { RequestScope } from "../../db/scope";
import { withCaseSteward } from "../aftercare/case-policy";
import { resolveSession } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { boundedBody, transportFailure, transportSuccess } from "../sync/http";
import { readMedia } from "./read";
import { grantMedia, recoverMedia, settleMedia } from "./transfer";
import type { MediaFailure } from "./transfer";

export const mediaRoutes = new Hono<ApiEnv>();

function post<Body>(route: {
  path: string;
  input: { safeParse(input: unknown): { success: true; data: { body: Body } } | { success: false } };
  output: { parse(input: unknown): unknown };
}, run: (ctx: RequestScope, access: SessionAccess, env: Bindings, body: Body) => Promise<Record<string, unknown> | MediaFailure>) {
  mediaRoutes.post(route.path, async (c) => {
    const parsed = route.input.safeParse({ body: await boundedBody(c.req.raw) });
    if (!parsed.success) return transportFailure(c, "VALIDATION_FAILED");
    const ctx = openRequestScope(c.env.DB, c.var.requestId);
    const access = await resolveSession(c.req.raw, null, ctx.now);
    if (!access) return transportFailure(c, "UNAUTHENTICATED");
    const outcome = await run(ctx, withCaseSteward(access, c.env.CASE_STEWARD_ACCOUNT_ID), c.env, parsed.data.body);
    if (typeof outcome === "string") return transportFailure(c, outcome);
    return transportSuccess(c, route.output.parse(outcome), ctx.now);
  });
}

post(createMediaGrantsRoute, async (ctx, access, env, body) => {
  const grants = await grantMedia(ctx, access, env, body);
  return typeof grants === "string" ? grants : { stageId: body.stageId, grants };
});
post(settleMediaRoute, async (ctx, access, env, body) => {
  const acknowledgements = await settleMedia(ctx, access, env, body);
  return typeof acknowledgements === "string" ? acknowledgements : { stageId: body.stageId, acknowledgements };
});
post(createMediaReadGrantsRoute, async (ctx, access, env, body) => {
  const grants = await readMedia(ctx, access, env, body);
  return typeof grants === "string" ? grants : { grants };
});
post(recoverMediaRoute, async (ctx, access, env, body) => {
  const files = await recoverMedia(ctx, access, env, body);
  return typeof files === "string" ? files : { stageId: body.stageId, files };
});
