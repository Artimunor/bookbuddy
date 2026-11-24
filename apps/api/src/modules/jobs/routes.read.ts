import { getHandoffRoute, getHomeRoute, getJobRoute, getJobsRoute } from "@bookbuddy/api-contract";
import type { ResponseSchema } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ApiEnv } from "../../bindings";
import { commitCommand, prepareCommand } from "../../db/commit";
import type { CommandStatement } from "../../db/commit";
import { openRequestScope } from "../../db/scope";
import { accessClock } from "../access/policy";
import { resolveSession } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { transportFailure, transportSuccess } from "../sync/http";
import { decodeJobRows, jobPosition, projectHandoff, projectHome, projectJob, projectJobs, readHandoff, readHome, readJob, readJobs } from "./read";

export const jobsReadRoutes = new Hono<ApiEnv>();

async function readResponse(
  c: Context<ApiEnv>,
  plan: (access: SessionAccess) => CommandStatement,
  project: (value: string, now: number) => unknown,
  schema: ResponseSchema,
) {
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const access = await resolveSession(c.req.raw, null, ctx.now);
  if (!access) return transportFailure(c, "UNAUTHENTICATED");

  const row = await commitCommand(ctx, prepareCommand(ctx, {
    statements: [plan(accessClock(access, ctx.now))],
    decode: ([result]) => result?.results[0] as { value: string | null } | undefined,
  }));
  if (!row) return transportFailure(c, "UNAUTHENTICATED");
  if (row.value === null) return transportFailure(c, "NOT_FOUND");
  const data = project(row.value, ctx.now);
  return data ? transportSuccess(c, schema.parse(data), ctx.now) : transportFailure(c, "NOT_FOUND");
}

jobsReadRoutes.get(getHomeRoute.path, (c) => {
  const input = getHomeRoute.input.safeParse({ query: c.req.query() });
  if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
  return readResponse(c, (access) => readHome(access, input.data.query.placeId),
    (value, now) => projectHome(decodeJobRows(value), now), getHomeRoute.output);
});

jobsReadRoutes.get(getJobsRoute.path, (c) => {
  const input = getJobsRoute.input.safeParse({ query: c.req.query() });
  if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
  const { segment = "active", cursor, placeId } = input.data.query;
  const position = jobPosition(cursor);
  if (!position) return transportFailure(c, "VALIDATION_FAILED");
  return readResponse(c, (access) => readJobs(access, segment, position, placeId),
    (value, now) => projectJobs(decodeJobRows(value), segment, now), getJobsRoute.output);
});

jobsReadRoutes.get(getJobRoute.path, (c) => {
  const input = getJobRoute.input.safeParse({ params: c.req.param(), query: c.req.query() });
  if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
  const { params: { j }, query: { view, cursor } } = input.data;
  const position = jobPosition(cursor);
  if (!position) return transportFailure(c, "VALIDATION_FAILED");
  return readResponse(c, (access) => readJob(access, j, view, position),
    (value, now) => projectJob(decodeJobRows(value), view, now), getJobRoute.output);
});

jobsReadRoutes.get(getHandoffRoute.path, (c) => {
  const input = getHandoffRoute.input.safeParse({ params: c.req.param() });
  if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
  return readResponse(c, (access) => readHandoff(access, input.data.params.h), projectHandoff, getHandoffRoute.output);
});
