import {
  acceptInvitationRoute, declineInvitationRoute, getBusinessEligibilityRoute, getBusinessOverviewRoute, getBusinessPeopleRoute, getInvitationRoute,
  inviteBusinessMemberRoute, openLinkRoute, operationIdHeader, reissueInvitationRoute, revokeBusinessMemberRoute, withdrawInvitationRoute,
} from "@bookbuddy/api-contract";
import type { ResponseSchema } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ApiEnv } from "../../bindings";
import { commitCommand, prepareCommand } from "../../db/commit";
import type { CommandInput } from "../../db/commit";
import { openRequestScope } from "../../db/scope";
import type { RequestScope } from "../../db/scope";
import { resolveSession } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { decodeJobRows, projectJobsBusinessOverview, readJobsBusinessOverview } from "../jobs/read";
import { boundedBody, scheduleOperationSignals, transportFailure, transportSuccess } from "../sync/http";
import { decodeBusinessEligibility, decodeBusinessPeople, readBusinessEligibility, readBusinessPeople } from "./businesses";
import { decideInvitation, issueBusinessInvitation, reissueInvitation, revokeBusinessRole, withdrawInvitation } from "./commands";
import type { AccessCommandResult } from "./commands";
import { decodeManagedInvitation, decodeOpening, readInvitation } from "./invitations";
import { decodeLink, readLink } from "./links";
import { invitationMailKeys } from "./mail";
import { accessClock } from "./policy";

export const accessRoutes = new Hono<ApiEnv>();

async function authorize(c: Context<ApiEnv>, mode: "active" | "account" = "active") {
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const session = await resolveSession(c.req.raw, null, ctx.now, undefined, mode);
  return session && { ctx, access: accessClock(session, ctx.now) };
}

accessRoutes.get(openLinkRoute.path, async (c) => {
  const input = openLinkRoute.input.safeParse({ params: c.req.param() });
  if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
  const authorized = await authorize(c);
  if (!authorized) return transportFailure(c, "UNAUTHENTICATED");
  const { ctx, access } = authorized;
  const link = await readLink(access, input.data.params.opaque);
  const row = await commitCommand(ctx, prepareCommand(ctx, {
    statements: [link], decode: ([result]) => result?.results[0] as { invitation: string | null; scoped: string | null } | undefined,
  }));
  return row ? transportSuccess(c, decodeLink(row), ctx.now) : transportFailure(c, "UNAUTHENTICATED");
});

accessRoutes.get(getInvitationRoute.path, async (c) => {
  const input = getInvitationRoute.input.safeParse({ params: c.req.param() });
  if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
  const authorized = await authorize(c);
  if (!authorized) return transportFailure(c, "UNAUTHENTICATED");
  const { ctx, access } = authorized;
  const row = await commitCommand(ctx, prepareCommand(ctx, {
    statements: [readInvitation(access, input.data.params.id)], decode: ([result]) => result?.results[0] as { value: string | null } | undefined,
  }));
  if (!row) return transportFailure(c, "UNAUTHENTICATED");
  return row.value ? transportSuccess(c, decodeOpening(row.value), ctx.now) : transportFailure(c, "NOT_FOUND");
});

accessRoutes.get(getBusinessOverviewRoute.path, async (c) => {
  const input = getBusinessOverviewRoute.input.safeParse({ params: c.req.param() });
  if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
  const authorized = await authorize(c);
  if (!authorized) return transportFailure(c, "UNAUTHENTICATED");
  const { ctx, access } = authorized;
  const row = await commitCommand(ctx, prepareCommand(ctx, {
    statements: [readJobsBusinessOverview(access, input.data.params.b)],
    decode: ([result]) => result?.results[0] as { value: string | null } | undefined,
  }));
  if (!row) return transportFailure(c, "UNAUTHENTICATED");
  const overview = row.value && projectJobsBusinessOverview(decodeJobRows(row.value), ctx.now);
  return overview ? transportSuccess(c, getBusinessOverviewRoute.output.parse(overview), ctx.now) : transportFailure(c, "NOT_FOUND");
});

accessRoutes.get(getBusinessPeopleRoute.path, async (c) => {
  const input = getBusinessPeopleRoute.input.safeParse({ params: c.req.param(), query: c.req.query() });
  if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
  const authorized = await authorize(c);
  if (!authorized) return transportFailure(c, "UNAUTHENTICATED");
  const { ctx, access } = authorized;
  const { params: { b }, query } = input.data;
  const row = await commitCommand(ctx, prepareCommand(ctx, {
    statements: [readBusinessPeople(access, b, query?.view ?? "active", query?.cursor ?? "")],
    decode: ([result]) => result?.results[0] as { value: string | null } | undefined,
  }));
  if (!row) return transportFailure(c, "UNAUTHENTICATED");
  return row.value ? transportSuccess(c, await decodeBusinessPeople(row.value, c.env.EFFECTS_ENCRYPTION_KEY), ctx.now) : transportFailure(c, "NOT_FOUND");
});

accessRoutes.get(getBusinessEligibilityRoute.path, async (c) => {
  const input = getBusinessEligibilityRoute.input.safeParse({ params: c.req.param(), query: c.req.query() });
  if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
  const authorized = await authorize(c);
  if (!authorized) return transportFailure(c, "UNAUTHENTICATED");
  const { ctx, access } = authorized;
  const row = await commitCommand(ctx, prepareCommand(ctx, {
    statements: [readBusinessEligibility(access, input.data.params.b, input.data.query?.cursor ?? "")],
    decode: ([result]) => result?.results[0] as { value: string | null } | undefined,
  }));
  if (!row) return transportFailure(c, "UNAUTHENTICATED");
  return row.value ? transportSuccess(c, decodeBusinessEligibility(row.value), ctx.now) : transportFailure(c, "NOT_FOUND");
});

type CommandRoute<Input> = {
  path: string;
  input: { safeParse(value: unknown): { success: true; data: Input } | { success: false } };
  output: ResponseSchema;
};

function post<Input extends { body: { operationId: string } }>(route: CommandRoute<Input>,
  plan: (ctx: RequestScope, access: SessionAccess, input: Input, c: Context<ApiEnv>) => Promise<CommandInput<AccessCommandResult> | null>,
  mode: "active" | "account" = "active", projection: "json" | "managed" | "accepted" = "json",
) {
  accessRoutes.post(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), body: await boundedBody(c.req.raw) });
    if (!input.success || input.data.body.operationId !== c.req.header(operationIdHeader)) return transportFailure(c, "VALIDATION_FAILED");
    const authorized = await authorize(c, mode);
    if (!authorized) return transportFailure(c, "UNAUTHENTICATED");
    const { ctx, access } = authorized;
    const command = await plan(ctx, access, input.data, c);
    if (!command) return transportFailure(c, "UNAVAILABLE");
    const { error, value, operation } = await commitCommand(ctx, prepareCommand(ctx, command));
    if (error) return transportFailure(c, error);
    scheduleOperationSignals(c, [operation]);
    if (!value) return transportFailure(c, "NOT_FOUND");
    const data: unknown = projection === "managed" ? await decodeManagedInvitation(value, c.env.EFFECTS_ENCRYPTION_KEY) : JSON.parse(value);
    // A replay cannot return the access that the recipient used to hold.
    if (projection === "accepted" && decodeOpening(value).status !== "accepted") return transportFailure(c, "NOT_FOUND");
    return transportSuccess(c, route.output.parse(data), ctx.now);
  });
}

post(inviteBusinessMemberRoute, async (ctx, access, { params, body }, c) => {
  const keys = await invitationMailKeys(c.env);
  return keys && issueBusinessInvitation(ctx, access, keys, params.b, body);
}, "active", "managed");
post(reissueInvitationRoute, async (ctx, access, { params, body }, c) => {
  const keys = await invitationMailKeys(c.env);
  return keys && reissueInvitation(ctx, access, keys, params.id, body);
}, "active", "managed");
post(withdrawInvitationRoute, (ctx, access, { params, body }) => withdrawInvitation(ctx, access, params.id, body));
post(acceptInvitationRoute, (ctx, access, { params, body }) => decideInvitation(ctx, access, params.id, body, "accepted"), "account", "accepted");
post(declineInvitationRoute, (ctx, access, { params, body }) => decideInvitation(ctx, access, params.id, body, "declined"), "account");
post(revokeBusinessMemberRoute, (ctx, access, { params, body }) => revokeBusinessRole(ctx, access, params.member, body));
