import {
  acceptCoverRoute, closeCoverRoute, confirmCoverRoute, declineCoverRoute, getCoverRoute, issueCoverRoute,
  operationIdHeader, releaseCoverRoute, withdrawCoverRoute,
} from "@bookbuddy/api-contract";
import type { ResponseSchema } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { ApiEnv } from "../../bindings";
import { commitCommand, prepareCommand } from "../../db/commit";
import { openRequestScope } from "../../db/scope";
import { resolveSession } from "../auth/session";
import { boundedBody, scheduleOperationSignals, transportFailure, transportSuccess } from "../sync/http";
import { planCover, readCover } from "./cover";

export const coverRoutes = new Hono<ApiEnv>();

coverRoutes.get(getCoverRoute.path, async (c) => {
  const input = getCoverRoute.input.safeParse({ params: c.req.param() });
  if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const session = await resolveSession(c.req.raw, null, ctx.now);
  if (!session) return transportFailure(c, "UNAUTHENTICATED");
  const { sql, params = [] } = readCover(session, ctx.now, input.data.params.g);
  const row = await ctx.binding.prepare(sql).bind(...params).first<{ value: string | null }>();
  if (!row) return transportFailure(c, "UNAUTHENTICATED");
  if (!row.value) return transportFailure(c, "NOT_FOUND");
  return transportSuccess(c, getCoverRoute.output.parse(JSON.parse(row.value)), ctx.now);
});

type CoverRoute<Input> = {
  path: string;
  input: { safeParse(value: unknown): { success: true; data: Input } | { success: false } };
  output: ResponseSchema;
};

function post<Input extends { params: { g: string }; body: { operationId: string } }>(
  route: CoverRoute<Input>, action: (body: Input["body"]) => Parameters<typeof planCover>[3],
) {
  coverRoutes.post(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), body: await boundedBody(c.req.raw) });
    if (!input.success || input.data.body.operationId !== c.req.header(operationIdHeader)) {
      return transportFailure(c, "VALIDATION_FAILED");
    }
    const ctx = openRequestScope(c.env.DB, c.var.requestId);
    const session = await resolveSession(c.req.raw, null, ctx.now);
    if (!session) return transportFailure(c, "UNAUTHENTICATED");
    const plan = await planCover(ctx, session, input.data.params.g, action(input.data.body));
    const { operation, value, error } = await commitCommand(ctx, prepareCommand(ctx, plan));
    if (error) return transportFailure(c, error);
    if (value === null) throw new Error("Successful cover command has no projection");
    const data = route.output.parse(JSON.parse(value));
    scheduleOperationSignals(c, [operation]);
    return transportSuccess(c, data, ctx.now);
  });
}

post(issueCoverRoute, (body) => ({ verb: "issue", body }));
post(acceptCoverRoute, (body) => ({ verb: "accept", body }));
post(declineCoverRoute, (body) => ({ verb: "decline", body }));
post(withdrawCoverRoute, (body) => ({ verb: "withdraw", body }));
post(releaseCoverRoute, (body) => ({ verb: "release", body }));
post(closeCoverRoute, (body) => ({ verb: "close", body }));
post(confirmCoverRoute, (body) => ({ verb: "confirm", body }));
