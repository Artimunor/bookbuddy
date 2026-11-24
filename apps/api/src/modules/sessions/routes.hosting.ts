import {
  changeSessionHostRoute, getSessionBookingFeedbackRoute, getSessionHostOffersRoute, getSessionRosterRoute, listBusinessSessionsRoute,
  listMySessionHostOffersRoute, operationIdHeader, publishSessionRoute, recordSessionAttendanceRoute, replyToSessionHostOfferRoute,
  updateSessionRosterRoute,
} from "@bookbuddy/api-contract";
import type { ResponseSchema } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { ApiEnv } from "../../bindings";
import { commitCommand, prepareCommand } from "../../db/commit";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { openRequestScope } from "../../db/scope";
import { resolveSession } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { boundedBody, scheduleOperationSignals, transportFailure, transportSuccess } from "../sync/http";
import { recordSessionAttendance } from "./attendance";
import {
  changeSessionHost, publishSession, readBusinessSessions, readMySessionHostOffers, readProviderSessionRoster, readSessionBookingFeedback,
  readSessionHostOffers, replyToSessionHostOffer, updateSessionRoster,
} from "./hosting";
import type { HostingResult } from "./hosting";

export const sessionsHostingRoutes = new Hono<ApiEnv>();

type Definition<Input> = {
  path: string;
  input: { safeParse(value: unknown): { success: true; data: Input } | { success: false } };
  output: ResponseSchema;
};

function get<Input>(route: Definition<Input>, plan: (session: SessionAccess, now: number, input: Input) => CommandStatement | null) {
  sessionsHostingRoutes.get(route.path, async (c) => {
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
  plan: (now: number, session: SessionAccess, input: Input) => Promise<CommandInput<HostingResult>>) {
  sessionsHostingRoutes.post(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), body: await boundedBody(c.req.raw) });
    if (!input.success || input.data.body.operationId !== c.req.header(operationIdHeader)) return transportFailure(c, "VALIDATION_FAILED");
    const ctx = openRequestScope(c.env.DB, c.var.requestId);
    const session = await resolveSession(c.req.raw, null, ctx.now);
    if (!session) return transportFailure(c, "UNAUTHENTICATED");
    const { operation, value } = await commitCommand(ctx, prepareCommand(ctx, await plan(ctx.now, session, input.data)));
    if (operation.outcome.status === "rejected") return transportFailure(c, operation.outcome.error);
    if (value === null) return transportFailure(c, "NOT_FOUND");
    scheduleOperationSignals(c, [operation]);
    return transportSuccess(c, route.output.parse(JSON.parse(value)), ctx.now);
  });
}

get(listBusinessSessionsRoute, readBusinessSessions);
get(getSessionRosterRoute, readProviderSessionRoster);
get(getSessionBookingFeedbackRoute, readSessionBookingFeedback);
get(getSessionHostOffersRoute, readSessionHostOffers);
get(listMySessionHostOffersRoute, readMySessionHostOffers);
command(publishSessionRoute, publishSession);
command(updateSessionRosterRoute, updateSessionRoster);
command(replyToSessionHostOfferRoute, replyToSessionHostOffer);
command(changeSessionHostRoute, changeSessionHost);
command(recordSessionAttendanceRoute, recordSessionAttendance);
