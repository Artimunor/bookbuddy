import {
  appendCaseEventRoute, confirmNoFundsRoute, correctPaymentRoute, deferCollectionRoute, getJobBillRoute, getProblemCaseRoute,
  issueBillRoute, listJobCasesRoute, operationIdHeader, recordCheckingRoute, recordPaidRoute, releaseDeferralRoute, submitProblemCaseRoute,
} from "@bookbuddy/api-contract";
import type { ErrorBody, ResponseSchema } from "@bookbuddy/api-contract";
import { looksLikeAccessCode } from "@bookbuddy/domain";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ApiEnv } from "../../bindings";
import { commitCommand, prepareCommand } from "../../db/commit";
import type { CommandInput, CommandStatement } from "../../db/commit";
import type { OperationResult } from "../../db/operations";
import { openRequestScope } from "../../db/scope";
import type { RequestScope } from "../../db/scope";
import { resolveSession } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { boundedBody, scheduleOperationSignals, transportFailure, transportSuccess } from "../sync/http";
import { changeBillPayment, deferCollection, issueBill, readBill, releaseDeferral } from "./bills";
import { withCaseSteward } from "./case-policy";
import { appendCaseEvent, readJobCases, readProblemCase, submitProblemCase } from "./cases";

export const billingRoutes = new Hono<ApiEnv>();

type Route<Input> = {
  path: string;
  input: { safeParse(value: unknown): { success: true; data: Input } | { success: false } };
  output: ResponseSchema;
};
interface BillingResult { operation: OperationResult; value: string | null; error?: ErrorBody }

async function authorize(c: Context<ApiEnv>) {
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const session = await resolveSession(c.req.raw, null, ctx.now);
  return session && { ctx, session: withCaseSteward(session, c.env.CASE_STEWARD_ACCOUNT_ID) };
}

function get<Input>(route: Route<Input>, read: (session: SessionAccess, now: number, input: Input) => CommandStatement | null) {
  billingRoutes.get(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), query: c.req.query() });
    if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
    const actor = await authorize(c);
    if (!actor) return transportFailure(c, "UNAUTHENTICATED");
    const { ctx, session } = actor;
    const statement = read(session, ctx.now, input.data);
    if (!statement) return transportFailure(c, "VALIDATION_FAILED");
    const row = await ctx.binding.prepare(statement.sql).bind(...statement.params ?? []).first<{ value: string | null }>();
    if (!row) return transportFailure(c, "UNAUTHENTICATED");
    return row.value ? transportSuccess(c, route.output.parse(JSON.parse(row.value)), ctx.now) : transportFailure(c, "NOT_FOUND");
  });
}

function post<Input extends { body: { operationId: string } }>(route: Route<Input>,
  plan: (ctx: RequestScope, session: SessionAccess, input: Input, env: ApiEnv["Bindings"]) => Promise<CommandInput<BillingResult>>,
  validText?: (input: Input) => boolean,
) {
  billingRoutes.post(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), body: await boundedBody(c.req.raw) });
    if (!input.success || input.data.body.operationId !== c.req.header(operationIdHeader) || validText?.(input.data) === false) {
      return transportFailure(c, "VALIDATION_FAILED");
    }
    const actor = await authorize(c);
    if (!actor) return transportFailure(c, "UNAUTHENTICATED");
    const { ctx, session } = actor;
    const command = await plan(ctx, session, input.data, c.env);
    const { operation, error, value } = await commitCommand(ctx, prepareCommand(ctx, command));
    if (error) return transportFailure(c, error);
    scheduleOperationSignals(c, [operation]);
    return value ? transportSuccess(c, route.output.parse(JSON.parse(value)), ctx.now) : transportFailure(c, "NOT_FOUND");
  });
}

get(getJobBillRoute, readBill);
get(listJobCasesRoute, readJobCases);
get(getProblemCaseRoute, readProblemCase);
post(issueBillRoute, issueBill);
post(recordPaidRoute, (ctx, session, input) => changeBillPayment(ctx, session, input, "matched"));
post(correctPaymentRoute, (ctx, session, input) => changeBillPayment(ctx, session, input, "corrected"));
post(recordCheckingRoute, (ctx, session, input) => changeBillPayment(ctx, session, input, "checking"));
post(confirmNoFundsRoute, (ctx, session, input) => changeBillPayment(ctx, session, input, "no_funds_received"));
post(deferCollectionRoute, deferCollection);
post(releaseDeferralRoute, releaseDeferral);
post(submitProblemCaseRoute, submitProblemCase,
  ({ body }) => !looksLikeAccessCode(body.payload.description.text, "label-only"));
post(appendCaseEventRoute, appendCaseEvent, ({ body }) =>
  !body.payload.content || !looksLikeAccessCode(body.payload.content.text, "label-only"));
