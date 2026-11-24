import {
  acceptOfferRoute, declineOfferRoute, dropoutAssignmentRoute, getCrewMemberRoute, getOfferRoute, getShiftCandidatesRoute,
  issueAssignmentOfferRoute, listCrewRoute, operationIdHeader, withdrawOfferRoute,
} from "@bookbuddy/api-contract";
import type { ResponseSchema } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { ApiEnv } from "../../bindings";
import { commitCommand, prepareCommand } from "../../db/commit";
import type { CommandStatement } from "../../db/commit";
import { openRequestScope } from "../../db/scope";
import { resolveSession } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { boundedBody, scheduleOperationSignals, transportFailure, transportSuccess } from "../sync/http";
import { projectCrew, projectCrewMember, readCrew, readCrewMember, readShiftCandidates } from "./crew";
import { planOrdinary, readAssignmentOffer } from "./ordinary";

export const ordinaryRoutes = new Hono<ApiEnv>();

type Route<Input> = {
  path: string;
  input: { safeParse(value: unknown): { success: true; data: Input } | { success: false } };
  output: ResponseSchema;
};

function get<Input>(route: Route<Input>, read: (session: SessionAccess, now: number, input: Input) => CommandStatement | null,
  project?: (value: unknown, now: number, input: Input) => unknown) {
  ordinaryRoutes.get(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), query: c.req.query() });
    if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
    const ctx = openRequestScope(c.env.DB, c.var.requestId);
    const session = await resolveSession(c.req.raw, null, ctx.now);
    if (!session) return transportFailure(c, "UNAUTHENTICATED");
    const query = read(session, ctx.now, input.data);
    if (!query) return transportFailure(c, "VALIDATION_FAILED");
    const row = await ctx.binding.prepare(query.sql).bind(...query.params ?? []).first<{ value: string | null }>();
    if (!row) return transportFailure(c, "UNAUTHENTICATED");
    if (row.value === null) return transportFailure(c, "NOT_FOUND");
    const value = JSON.parse(row.value) as unknown;
    return transportSuccess(c, route.output.parse(project ? project(value, ctx.now, input.data) : value), ctx.now);
  });
}

get(listCrewRoute, (s, now, { query }) => readCrew(s, now, query), projectCrew);
get(getCrewMemberRoute, (s, now, { params: { id }, query }) => readCrewMember(s, now, id, query.shiftId ?? null, query.weekOf ?? null),
  (value, now, { query }) => projectCrewMember(value, now, query.weekOf ?? null));
get(getShiftCandidatesRoute, (session, now, { params: { s } }) => readShiftCandidates(session, now, s));
get(getOfferRoute, (s, now, { params: { id } }) => readAssignmentOffer(s, now, id));

function post<Input extends { params: { id: string }; body: { operationId: string } }>(route: Route<Input>,
  action: (body: Input["body"]) => Parameters<typeof planOrdinary>[3]) {
  ordinaryRoutes.post(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), body: await boundedBody(c.req.raw) });
    if (!input.success || input.data.body.operationId !== c.req.header(operationIdHeader)) {
      return transportFailure(c, "VALIDATION_FAILED");
    }
    const ctx = openRequestScope(c.env.DB, c.var.requestId);
    const session = await resolveSession(c.req.raw, null, ctx.now);
    if (!session) return transportFailure(c, "UNAUTHENTICATED");
    const plan = await planOrdinary(ctx, session, input.data.params.id, action(input.data.body));
    const { operation, value, error } = await commitCommand(ctx, prepareCommand(ctx, plan));
    if (error) return transportFailure(c, error);
    if (value === null) throw new Error("Successful staffing command has no projection");
    const result = route.output.parse(JSON.parse(value));
    scheduleOperationSignals(c, [operation]);
    return transportSuccess(c, result, ctx.now);
  });
}

post(issueAssignmentOfferRoute, (body) => ({ verb: "issue", body }));
post(acceptOfferRoute, (body) => ({ verb: "accept", body }));
post(declineOfferRoute, (body) => ({ verb: "decline", body }));
post(withdrawOfferRoute, (body) => ({ verb: "withdraw", body }));
post(dropoutAssignmentRoute, (body) => ({ verb: "dropout", body }));
