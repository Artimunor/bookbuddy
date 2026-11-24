import {
  bookSessionHoldRoute, cancelSessionBookingRoute, createSessionHoldRoute, getSessionBookingRoute, getSessionRoute,
  listSessionsRoute, moveSessionBookingRoute, operationIdHeader, releaseSessionHoldRoute, respondToSessionChangeRoute,
} from "@bookbuddy/api-contract";
import type { OperationId, ResponseSchema, RouteResponse } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ApiEnv } from "../../bindings";
import { commitCommand, prepareCommand } from "../../db/commit";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { openRequestScope } from "../../db/scope";
import type { RequestScope } from "../../db/scope";
import { accessClock, scopedStatement } from "../access/policy";
import { resolveSession } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { boundedBody, scheduleOperationSignals, transportFailure, transportSuccess } from "../sync/http";
import {
  customerSessionValue, planBookSession, planCancelSessionBooking, planMoveSessionBooking, planReleaseSessionHold,
  planRespondToSessionChange, planSessionHold, readSessionBooking, readSessions, sessionPosition,
} from "./booking";
import type { SessionCommandResult } from "./booking";

export function createSessionsBookingRoutes(providerValue: (input: RouteResponse<typeof getSessionRoute.input>) => CommandStatement | null) {
  const routes = new Hono<ApiEnv>();
  type Definition<Input> = {
    path: string;
    input: { safeParse(value: unknown): { success: true; data: Input } | { success: false } };
    output: ResponseSchema;
  };

  function get<Input>(route: Definition<Input>, request: (c: Context<ApiEnv>) => unknown,
    plan: (access: SessionAccess, now: number, input: Input) => CommandStatement | null) {
    routes.get(route.path, async (c) => {
      const parsed = route.input.safeParse(request(c));
      if (!parsed.success) return transportFailure(c, "VALIDATION_FAILED");
      const ctx = openRequestScope(c.env.DB, c.var.requestId);
      const access = await resolveSession(c.req.raw, null, ctx.now);
      if (!access) return transportFailure(c, "UNAUTHENTICATED");
      const read = plan(access, ctx.now, parsed.data);
      if (!read) return transportFailure(c, "VALIDATION_FAILED");
      const row = await ctx.binding.prepare(read.sql).bind(...read.params ?? []).first<{ value: string | null; invalid_cursor?: number }>();
      if (row === null) return transportFailure(c, "UNAUTHENTICATED");
      if (row.invalid_cursor) return transportFailure(c, "VALIDATION_FAILED");
      if (row.value === null) return transportFailure(c, "NOT_FOUND");
      return transportSuccess(c, route.output.parse(JSON.parse(row.value)), ctx.now);
    });
  }

  function post<Input extends { params: { id: string }; body: { operationId: OperationId; expectedRevision?: number; payload: unknown } }>(
    route: Definition<Input>, plan: (ctx: RequestScope, access: SessionAccess, id: string, body: Input["body"]) => Promise<CommandInput<SessionCommandResult>>,
  ) {
    routes.post(route.path, async (c) => {
      const parsed = route.input.safeParse({ params: c.req.param(), body: await boundedBody(c.req.raw) });
      if (!parsed.success || parsed.data.body.operationId !== c.req.header(operationIdHeader)) return transportFailure(c, "VALIDATION_FAILED");
      const { params, body } = parsed.data;
      const { expectedRevision, payload } = body;
      if (expectedRevision !== undefined && typeof payload === "object" && payload !== null && "bookingRevision" in payload
        && payload.bookingRevision !== expectedRevision) return transportFailure(c, "VALIDATION_FAILED");
      const ctx = openRequestScope(c.env.DB, c.var.requestId);
      const access = await resolveSession(c.req.raw, null, ctx.now);
      if (!access) return transportFailure(c, "UNAUTHENTICATED");
      const { operation, value, error } = await commitCommand(ctx, prepareCommand(ctx, await plan(ctx, access, params.id, body)));
      if (error) return transportFailure(c, error);
      if (value === null) return transportFailure(c, "NOT_FOUND");
      const data = route.output.parse(JSON.parse(value));
      scheduleOperationSignals(c, [operation]);
      return transportSuccess(c, data, ctx.now);
    });
  }

  get(listSessionsRoute, (c) => ({ query: c.req.query() }), (session, now, { query }) => {
    const position = sessionPosition(query.cursor);
    return position && readSessions(session, now, query, position);
  });
  get(getSessionRoute, (c) => ({ params: c.req.param(), query: c.req.query() }), (session, now, input) => {
    const position = sessionPosition(input.query?.cursor);
    const customer = position && customerSessionValue(input.params.id, position);
    const staff = providerValue(input);
    return scopedStatement(accessClock(session, now), `SELECT CASE
      WHEN scope.role = 'customer' THEN (${customer?.sql ?? "NULL"})
      WHEN scope.role IN ('provider_admin', 'foreman') THEN (${staff?.sql ?? "NULL"}) END AS value,
      CASE WHEN scope.role = 'customer' THEN ${customer ? 0 : 1}
        WHEN scope.role IN ('provider_admin', 'foreman') THEN ${staff ? 0 : 1} END AS invalid_cursor
      FROM acting_session s LEFT JOIN live_scope scope ON scope.account_id = s.account_id`, ...customer?.params ?? [], ...staff?.params ?? []);
  });
  get(getSessionBookingRoute, (c) => ({ params: c.req.param() }), (session, now, { params }) => readSessionBooking(session, now, params.id));

  post(createSessionHoldRoute, planSessionHold);
  post(bookSessionHoldRoute, planBookSession);
  post(releaseSessionHoldRoute, planReleaseSessionHold);
  post(moveSessionBookingRoute, planMoveSessionBooking);
  post(cancelSessionBookingRoute, planCancelSessionBooking);
  post(respondToSessionChangeRoute, planRespondToSessionChange);
  return routes;
}
