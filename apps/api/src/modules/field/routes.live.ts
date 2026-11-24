import {
  acknowledgeSafetyInstructionRoute, askSafetyQuestionRoute, finishVisitWorkRoute, getAssignmentBriefingRoute, getSafetyInstructionRoute,
  getVisitLiveRoute, issueSafetyInstructionRoute, operationIdHeader, publishVisitUpdateRoute, recordSafetyTeachBackRoute, startVisitWorkRoute,
} from "@bookbuddy/api-contract";
import type { ResponseSchema } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { ApiEnv } from "../../bindings";
import { commitCommand, prepareCommand } from "../../db/commit";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { openRequestScope } from "../../db/scope";
import type { RequestScope } from "../../db/scope";
import { resolveSession } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { boundedBody, scheduleOperationSignals, transportFailure, transportSuccess } from "../sync/http";
import { changeWork, publishUpdate, readVisitLive } from "./live";
import { acknowledgeInstruction, askQuestion, fieldPosition, issueInstruction, readAssignmentBriefing, readSafetyInstruction, recordTeachBack } from "./safety";
import type { FieldCommandResult } from "./safety";

export const fieldLiveRoutes = new Hono<ApiEnv>();

type Definition<Input> = {
  path: string;
  input: { safeParse(value: unknown): { success: true; data: Input } | { success: false } };
  output: ResponseSchema;
};

function get<Input>(route: Definition<Input>, plan: (session: SessionAccess, now: number, input: Input) => CommandStatement | null) {
  fieldLiveRoutes.get(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), query: c.req.query() });
    if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
    const ctx = openRequestScope(c.env.DB, c.var.requestId);
    const session = await resolveSession(c.req.raw, null, ctx.now);
    if (!session) return transportFailure(c, "UNAUTHENTICATED");
    const statement = plan(session, ctx.now, input.data);
    if (!statement) return transportFailure(c, "VALIDATION_FAILED");
    const row = await ctx.binding.prepare(statement.sql).bind(...statement.params ?? []).first<{ value: string | null }>();
    if (!row) return transportFailure(c, "UNAUTHENTICATED");
    if (row.value === null) return transportFailure(c, "NOT_FOUND");
    return transportSuccess(c, route.output.parse(JSON.parse(row.value)), ctx.now);
  });
}

function command<Input extends { body: { operationId: string } }>(route: Definition<Input>,
  plan: (ctx: RequestScope, session: SessionAccess, input: Input) => Promise<CommandInput<FieldCommandResult>>,
) {
  fieldLiveRoutes.post(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), body: await boundedBody(c.req.raw) });
    if (!input.success || input.data.body.operationId !== c.req.header(operationIdHeader)) return transportFailure(c, "VALIDATION_FAILED");
    const ctx = openRequestScope(c.env.DB, c.var.requestId);
    const session = await resolveSession(c.req.raw, null, ctx.now);
    if (!session) return transportFailure(c, "UNAUTHENTICATED");
    const { operation, value, error } = await commitCommand(ctx, prepareCommand(ctx, await plan(ctx, session, input.data)));
    if (error) return transportFailure(c, error);
    if (value === null) return transportFailure(c, "NOT_FOUND");
    const data = route.output.parse(JSON.parse(value));
    scheduleOperationSignals(c, [operation]);
    return transportSuccess(c, data, ctx.now);
  });
}

get(getVisitLiveRoute, (session, now, { params, query }) => readVisitLive(session, now, params.id, query?.cursor));
get(getAssignmentBriefingRoute, (session, now, { params }) => readAssignmentBriefing(session, now, params.id));
get(getSafetyInstructionRoute, (session, now, { params, query }) => {
  const position = fieldPosition(query?.cursor);
  return position && readSafetyInstruction(session, now, params.id, query?.versionId, position);
});
command(startVisitWorkRoute, (ctx, session, input) => changeWork(ctx, session, input, "start"));
command(finishVisitWorkRoute, (ctx, session, input) => changeWork(ctx, session, input, "finish"));
command(publishVisitUpdateRoute, publishUpdate);
command(issueSafetyInstructionRoute, issueInstruction);
command(recordSafetyTeachBackRoute, recordTeachBack);
command(acknowledgeSafetyInstructionRoute, acknowledgeInstruction);
command(askSafetyQuestionRoute, askQuestion);
