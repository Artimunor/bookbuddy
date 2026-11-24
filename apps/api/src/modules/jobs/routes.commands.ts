import {
  acceptJobHandoffRoute, declineJobHandoffRoute, getOperationRoute, offerJobHandoffRoute, operationIdHeader,
  submitRequestRoute, submitSupportRoute, withdrawJobHandoffRoute,
} from "@bookbuddy/api-contract";
import type { ErrorBody, ResponseSchema } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ApiEnv } from "../../bindings";
import { commitCommand, prepareCommand } from "../../db/commit";
import type { CommandInput } from "../../db/commit";
import { openRequestScope } from "../../db/scope";
import type { RequestScope } from "../../db/scope";
import { accessClock } from "../access/policy";
import { loadOtpKey } from "../auth/crypto";
import { isTrustedOrigin, resolveSession, sessionCookieName } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { boundedBody, scheduleOperationSignals, transportFailure, transportSuccess } from "../sync/http";
import { planHandoffDecision, planHandoffOffer, planRequest, planSupport, readOperation } from "./commands";
import type { JobCommandResult } from "./commands";

export const jobsCommandRoutes = new Hono<ApiEnv>();

type CommandPlan = CommandInput<JobCommandResult>;
type CommandRoute<Input> = {
  path: string;
  input: { safeParse(value: unknown): { success: true; data: Input } | { success: false } };
  output: ResponseSchema;
};

async function respond(c: Context<ApiEnv>, ctx: RequestScope, plan: CommandPlan, schema: ResponseSchema) {
  const { operation, error, value } = await commitCommand(ctx, prepareCommand(ctx, plan));
  if (error) return transportFailure(c, error);
  if (!value) return transportFailure(c, "NOT_FOUND");
  const data = schema.parse(JSON.parse(value));
  scheduleOperationSignals(c, [operation]);
  return transportSuccess(c, data, ctx.now);
}

function post<Input extends { body: { operationId: string } }>(route: CommandRoute<Input>,
  plan: (ctx: RequestScope, access: SessionAccess, input: Input) => Promise<CommandPlan> | ErrorBody,
) {
  jobsCommandRoutes.post(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), body: await boundedBody(c.req.raw) });
    if (!input.success || input.data.body.operationId !== c.req.header(operationIdHeader)) return transportFailure(c, "VALIDATION_FAILED");
    const ctx = openRequestScope(c.env.DB, c.var.requestId);
    const session = await resolveSession(c.req.raw, null, ctx.now);
    if (!session) return transportFailure(c, "UNAUTHENTICATED");
    const command = await plan(ctx, accessClock(session, ctx.now), input.data);
    return "code" in command ? transportFailure(c, command) : respond(c, ctx, command, route.output);
  });
}

post(submitRequestRoute, (ctx, access, { body }) => planRequest(ctx, access, body));
post(offerJobHandoffRoute, (ctx, access, { params, body }) => planHandoffOffer(ctx, access, params.j, body));
post(acceptJobHandoffRoute, (ctx, access, { params, body }) => planHandoffDecision(ctx, access, params.j, params.h, body, "accepted"));
post(declineJobHandoffRoute, (ctx, access, { params, body }) => planHandoffDecision(ctx, access, params.j, params.h, body, "declined"));
post(withdrawJobHandoffRoute, (ctx, access, { params, body }) => planHandoffDecision(ctx, access, params.j, params.h, body, "withdrawn"));

jobsCommandRoutes.get(getOperationRoute.path, async (c) => {
  const input = getOperationRoute.input.safeParse({ params: c.req.param(), query: c.req.query() });
  if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const access = await resolveSession(c.req.raw, null, ctx.now);
  if (!access) return transportFailure(c, "UNAUTHENTICATED");
  const operationId = input.data.params.id;
  const result = await commitCommand(ctx, prepareCommand(ctx, readOperation(access, operationId, ctx.now, input.data.query?.resource === "1")));
  if (!result) return transportFailure(c, "UNAUTHENTICATED");
  if (!result.context_id || result.committedAt === null) return transportFailure(c, "NOT_FOUND");
  return transportSuccess(c, getOperationRoute.output.parse({ operationId, status: "committed", committedAt: result.committedAt,
    ...(result.resourceKind && result.resourceId ? { resource: { kind: result.resourceKind, id: result.resourceId } } : {}),
  }), ctx.now);
});

jobsCommandRoutes.post(submitSupportRoute.path, async (c) => {
  const request = c.req.raw;
  const input = submitSupportRoute.input.safeParse({ body: await boundedBody(request) });
  if (!input.success || input.data.body.operationId !== c.req.header(operationIdHeader)) return transportFailure(c, "VALIDATION_FAILED");
  if (request.headers.has("Origin") && !isTrustedOrigin(request)) return transportFailure(c, "UNAUTHENTICATED");
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const hasSession = request.headers.has("Authorization") || request.headers.get("Cookie")?.split(";")
    .some((cookie) => cookie.trimStart().startsWith(`${sessionCookieName}=`));
  let access: SessionAccess | { lookup: CryptoKey; source: string };
  if (hasSession) {
    // Account-wide intake also works after the user's staff scope was revoked.
    const session = await resolveSession(request, null, ctx.now, undefined, "account");
    if (!session) return transportFailure(c, "UNAUTHENTICATED");
    access = session;
  } else {
    const source = c.req.header("CF-Connecting-IP");
    if (!source || !/^[0-9a-f:.]{1,45}$/i.test(source)) return transportFailure(c, "UNAVAILABLE");
    const lookup = await loadOtpKey(c.env.OTP_HMAC_KEY);
    if (!lookup) return transportFailure(c, "UNAVAILABLE");
    access = { lookup, source: source.toLowerCase() };
  }
  const plan = await planSupport(ctx, access, input.data.body, c.env.EFFECTS_ENCRYPTION_KEY);
  return plan ? respond(c, ctx, plan, submitSupportRoute.output) : transportFailure(c, "UNAVAILABLE");
});
