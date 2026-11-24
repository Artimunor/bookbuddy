import {
  cancelVisitRoute, confirmVisitWindowRoute, getBusinessScheduleRoute, getCrewAvailabilityRoute, getJobWindowsRoute, getShiftRoute,
  listShiftsRoute, operationIdHeader, patchCrewAvailabilityRoute, proposeVisitWindowsRoute, requestVisitRescheduleRoute,
  withdrawVisitWindowRoute,
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
import { projectAvailability, projectChangedAvailability, readAvailability } from "./availability";
import { editAvailability } from "./availability-command";
import { cancelVisit, confirmWindow, proposeWindows, requestReschedule, withdrawWindow } from "./commands";
import { projectBusinessSchedule, projectJobWindows, readBusinessSchedule, readJobWindows } from "./read";
import type { ScheduleCommandResult } from "./receipts";
import { agendaPosition, projectShiftAgenda, readShift, readShiftAgenda } from "./shifts";

export const scheduleRoutes = new Hono<ApiEnv>();

type Definition<Input> = {
  path: string;
  input: { safeParse(value: unknown): { success: true; data: Input } | { success: false } };
  output: ResponseSchema;
};

function get<Input>(route: Definition<Input>,
  plan: (session: SessionAccess, now: number, input: Input) => CommandStatement | null,
  project?: (value: unknown, now: number, input: Input) => unknown,
) {
  scheduleRoutes.get(route.path, async (c) => {
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
    const value: unknown = JSON.parse(row.value);
    return transportSuccess(c, route.output.parse(project ? project(value, ctx.now, input.data) : value), ctx.now);
  });
}

function command<Input extends { body: { operationId: string } }>(route: Definition<Input> & { method: "POST" | "PATCH" },
  plan: (ctx: RequestScope, session: SessionAccess, input: Input) => Promise<CommandInput<ScheduleCommandResult>>,
  project?: (value: unknown, input: Input) => unknown,
) {
  scheduleRoutes.on(route.method, route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), body: await boundedBody(c.req.raw) });
    if (!input.success || input.data.body.operationId !== c.req.header(operationIdHeader)) return transportFailure(c, "VALIDATION_FAILED");
    const ctx = openRequestScope(c.env.DB, c.var.requestId);
    const session = await resolveSession(c.req.raw, null, ctx.now);
    if (!session) return transportFailure(c, "UNAUTHENTICATED");
    const { operation, value, error } = await commitCommand(ctx, prepareCommand(ctx, await plan(ctx, session, input.data)));
    if (error) return transportFailure(c, error);
    if (value === null) return transportFailure(c, "NOT_FOUND");
    const decoded: unknown = JSON.parse(value);
    const data = route.output.parse(project ? project(decoded, input.data) : decoded);
    scheduleOperationSignals(c, [operation]);
    return transportSuccess(c, data, ctx.now);
  });
}

get(getJobWindowsRoute, (session, now, { params }) => readJobWindows(session, now, params.j), projectJobWindows);
get(getBusinessScheduleRoute, (session, now, { params, query }) =>
  readBusinessSchedule(session, now, params.b, query.jobId, query.visitId ?? null, query.weekOf ?? null),
(value, now, { query }) => projectBusinessSchedule(value, now, query.weekOf ?? null));
get(listShiftsRoute, (session, now, { query }) => {
  const segment = query?.segment ?? "upcoming";
  const cursor = agendaPosition(query?.cursor, segment);
  return cursor && readShiftAgenda(session, now, segment, cursor);
}, projectShiftAgenda);
get(getShiftRoute, (session, now, { params }) => readShift(session, now, params.s));
get(getCrewAvailabilityRoute, (session, now, { params, query }) => readAvailability(session, now, params.member, query?.weekOf ?? null),
(value, _now, { query }) => projectAvailability(value, query?.weekOf ?? null));

command(proposeVisitWindowsRoute, proposeWindows);
command(confirmVisitWindowRoute, confirmWindow);
command(withdrawVisitWindowRoute, withdrawWindow);
command(cancelVisitRoute, cancelVisit);
command(requestVisitRescheduleRoute, requestReschedule);
command(patchCrewAvailabilityRoute, editAvailability, (value, { body }) => projectChangedAvailability(value, body.payload.date));
