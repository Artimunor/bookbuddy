import {
  approveChangeVersionRoute, approveQuoteVersionRoute, createChangeVersionRoute, createQuoteVersionRoute,
  declineChangeVersionRoute, declineQuoteVersionRoute, getChangeVersionRoute, getQuoteVersionRoute,
  issueChangeVersionRoute, issueQuoteVersionRoute, listChangeVersionsRoute, listQuoteVersionsRoute,
  operationIdHeader, requestEarlyStartRoute, returnChangeVersionRoute, returnQuoteVersionRoute,
  submitChangeReviewRoute, submitQuoteReviewRoute, withdrawContractRoute,
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
import { createVersion, transitionVersion } from "./commands";
import { recordContractNotice } from "./notices";
import { decodeVersionList, readVersion, readVersionList } from "./read";
import type { CommercialResult } from "./receipts";

export const commercialRoutes = new Hono<ApiEnv>();

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

function get<Input>(route: Route<Input>, statement: (session: SessionAccess, time: number, input: Input) => CommandStatement | null,
  decode: (value: string) => unknown = JSON.parse,
) {
  commercialRoutes.get(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), query: c.req.query() });
    if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
    const authorized = await authorize(c);
    if (!authorized) return transportFailure(c, "UNAUTHENTICATED");
    const { ctx, session } = authorized;
    const query = statement(session, ctx.now, input.data);
    if (!query) return transportFailure(c, "VALIDATION_FAILED");
    const bound = ctx.binding.prepare(query.sql).bind(...query.params ?? []);
    const row = await bound.first<{ value: string | null }>();
    if (!row) return transportFailure(c, "UNAUTHENTICATED");
    return row.value ? transportSuccess(c, route.output.parse(decode(row.value)), ctx.now) : transportFailure(c, "NOT_FOUND");
  });
}

function post<Input extends { body: { operationId: string } }>(route: Route<Input>,
  plan: (ctx: RequestScope, session: SessionAccess, input: Input) => Promise<CommandInput<CommercialResult>> | null,
) {
  commercialRoutes.post(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), body: await boundedBody(c.req.raw) });
    if (!input.success || input.data.body.operationId !== c.req.header(operationIdHeader)) return transportFailure(c, "VALIDATION_FAILED");
    const authorized = await authorize(c);
    if (!authorized) return transportFailure(c, "UNAUTHENTICATED");
    const { ctx, session } = authorized;
    const command = await plan(ctx, session, input.data);
    if (!command) return transportFailure(c, "VALIDATION_FAILED");
    const { operation, error, value } = await commitCommand(ctx, prepareCommand(ctx, command));
    if (error) return transportFailure(c, error);
    scheduleOperationSignals(c, [operation]);
    return value ? transportSuccess(c, route.output.parse(JSON.parse(value)), ctx.now) : transportFailure(c, "NOT_FOUND");
  });
}

get(listQuoteVersionsRoute, (session, now, { params, query }) => readVersionList(session, now, "quote", params.j, query?.cursor), decodeVersionList);
get(listChangeVersionsRoute, (session, now, { params, query }) => readVersionList(session, now, "change", params.j, query?.cursor), decodeVersionList);
get(getQuoteVersionRoute, (session, now, { params }) => readVersion(session, now, "quote", params.j, params.id));
get(getChangeVersionRoute, (session, now, { params }) => readVersion(session, now, "change", params.j, params.id));

post(createQuoteVersionRoute, (ctx, session, { params, body }) => createVersion(ctx, session, params.j, { kind: "quote", body }));
post(createChangeVersionRoute, (ctx, session, { params, body }) => createVersion(ctx, session, params.j, { kind: "change", body }));
post(submitQuoteReviewRoute, (ctx, session, { params, body }) => transitionVersion(ctx, session, "quote", params.id, { action: "submit_review", body }));
post(submitChangeReviewRoute, (ctx, session, { params, body }) => transitionVersion(ctx, session, "change", params.id, { action: "submit_review", body }));
post(returnQuoteVersionRoute, (ctx, session, { params, body }) => transitionVersion(ctx, session, "quote", params.id, { action: "return", body }));
post(returnChangeVersionRoute, (ctx, session, { params, body }) => transitionVersion(ctx, session, "change", params.id, { action: "return", body }));
post(issueQuoteVersionRoute, (ctx, session, { params, body }) => transitionVersion(ctx, session, "quote", params.id, { action: "issue", body }));
post(issueChangeVersionRoute, (ctx, session, { params, body }) => transitionVersion(ctx, session, "change", params.id, { action: "issue", body }));
post(approveQuoteVersionRoute, (ctx, session, { params, body }) => transitionVersion(ctx, session, "quote", params.id, { action: "approve", body }));
post(approveChangeVersionRoute, (ctx, session, { params, body }) => transitionVersion(ctx, session, "change", params.id, { action: "approve", body }));
post(declineQuoteVersionRoute, (ctx, session, { params, body }) => transitionVersion(ctx, session, "quote", params.id, { action: "decline", body }));
post(declineChangeVersionRoute, (ctx, session, { params, body }) => transitionVersion(ctx, session, "change", params.id, { action: "decline", body }));
post(requestEarlyStartRoute, (ctx, session, { params, body }) => recordContractNotice(ctx, session, params.j, { action: "early_start", body }));
post(withdrawContractRoute, (ctx, session, { params, body }) => recordContractNotice(ctx, session, params.j, { action: "withdrawal", body }));
