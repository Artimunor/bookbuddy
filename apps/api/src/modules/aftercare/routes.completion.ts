import {
  getJobCompletionRoute, getJobRatingEligibilityRoute, operationIdHeader, returnCompletionRoute, signOffCompletionRoute,
  submitCompletionRoute, submitRatingRoute,
} from "@bookbuddy/api-contract";
import type { ResponseSchema } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ApiEnv } from "../../bindings";
import { commitCommand, prepareCommand } from "../../db/commit";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { openRequestScope } from "../../db/scope";
import type { RequestScope } from "../../db/scope";
import { resolveSession } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { boundedBody, scheduleOperationSignals, transportFailure, transportSuccess } from "../sync/http";
import { readCompletion, returnCompletion, signOffCompletion, submitCompletion } from "./completion";
import type { AftercareReceiptResult } from "./completion";
import { readRatingEligibility, submitRating } from "./rating";

export const completionRoutes = new Hono<ApiEnv>();

type Route<Input> = {
  path: string;
  input: { safeParse(value: unknown): { success: true; data: Input } | { success: false } };
  output: ResponseSchema;
};

async function authorize(c: Context<ApiEnv>) {
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const session = await resolveSession(c.req.raw, null, ctx.now);
  return session && { ctx, session };
}

function get<Input>(route: Route<Input>, read: (session: SessionAccess, now: number, input: Input) => CommandStatement,
  withQuery = false,
) {
  completionRoutes.get(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), ...(withQuery ? { query: c.req.query() } : {}) });
    if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
    const actor = await authorize(c);
    if (!actor) return transportFailure(c, "UNAUTHENTICATED");
    const { ctx, session } = actor;
    const { sql, params } = read(session, ctx.now, input.data);
    const row = await ctx.binding.prepare(sql).bind(...params ?? []).first<{ value: string | null }>();
    if (!row) return transportFailure(c, "UNAUTHENTICATED");
    return row.value ? transportSuccess(c, route.output.parse(JSON.parse(row.value)), ctx.now) : transportFailure(c, "NOT_FOUND");
  });
}

function post<Input extends { body: { operationId: string } }>(route: Route<Input>,
  plan: (ctx: RequestScope, session: SessionAccess, input: Input) => Promise<CommandInput<AftercareReceiptResult>>,
) {
  completionRoutes.post(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), body: await boundedBody(c.req.raw) });
    if (!input.success || input.data.body.operationId !== c.req.header(operationIdHeader)) return transportFailure(c, "VALIDATION_FAILED");
    const actor = await authorize(c);
    if (!actor) return transportFailure(c, "UNAUTHENTICATED");
    const { ctx, session } = actor;
    const command = await plan(ctx, session, input.data);
    const { operation, error, value } = await commitCommand(ctx, prepareCommand(ctx, command));
    if (error) return transportFailure(c, error);
    scheduleOperationSignals(c, [operation]);
    return value ? transportSuccess(c, route.output.parse(JSON.parse(value)), ctx.now) : transportFailure(c, "NOT_FOUND");
  });
}

get(getJobCompletionRoute, readCompletion, true);
get(getJobRatingEligibilityRoute, (session, now, { params }) => readRatingEligibility(session, now, params.j));
post(submitCompletionRoute, submitCompletion);
post(returnCompletionRoute, returnCompletion);
post(signOffCompletionRoute, signOffCompletion);
post(submitRatingRoute, submitRating);
