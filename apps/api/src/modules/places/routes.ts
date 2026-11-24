import {
  archivePlaceRoute, changePlaceApproverRoute, createPlaceRoute, getPlaceRoute, invitePlacePersonRoute,
  listPlacesRoute, operationIdHeader, patchPlacePersonRoute, patchPlaceRoute, transferPlaceRoute, verifyPlacePinRoute,
} from "@bookbuddy/api-contract";
import type { ResponseSchema } from "@bookbuddy/api-contract";
import { looksLikeAccessCode } from "@bookbuddy/domain";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ApiEnv } from "../../bindings";
import { commitCommand, prepareCommand } from "../../db/commit";
import type { CommandInput } from "../../db/commit";
import { openRequestScope } from "../../db/scope";
import type { RequestScope } from "../../db/scope";
import { decodeManagedInvitation } from "../access/invitations";
import { invitationMailKeys } from "../access/mail";
import { accessClock } from "../access/policy";
import { resolveSession } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { boundedBody, scheduleOperationSignals, transportFailure, transportSuccess } from "../sync/http";
import { archivePlace, changePlaceApprover, createPlace, issuePlaceInvitation, patchPlace, patchPlacePerson, verifyPlacePin } from "./commands";
import type { PlaceCommandResult } from "./commands";
import { decodePlace, decodePlaceCursor, decodePlaces, readPlace, readPlaces } from "./read";

export const placesRoutes = new Hono<ApiEnv>();

async function authorize(c: Context<ApiEnv>) {
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const base = await resolveSession(c.req.raw, null, ctx.now);
  return base && { ctx, access: accessClock(base, ctx.now) };
}

placesRoutes.get(listPlacesRoute.path, async (c) => {
  const input = listPlacesRoute.input.safeParse({ query: c.req.query() });
  if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
  const { cursor, q } = input.data.query ?? {};
  const position = cursor ? decodePlaceCursor(cursor) : null;
  if (cursor && !position) return transportFailure(c, "VALIDATION_FAILED");
  const authorized = await authorize(c);
  if (!authorized) return transportFailure(c, "UNAUTHENTICATED");
  const { ctx, access } = authorized;
  const places = await commitCommand(ctx, prepareCommand(ctx, {
    statements: [readPlaces(access, q?.normalize("NFC") ?? "", position)], decode: ([result]) => decodePlaces(result?.results ?? []),
  }));
  return typeof places === "string" ? transportFailure(c, places) : transportSuccess(c, places, ctx.now);
});

placesRoutes.get(getPlaceRoute.path, async (c) => {
  const input = getPlaceRoute.input.safeParse({ params: c.req.param() });
  if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
  const authorized = await authorize(c);
  if (!authorized) return transportFailure(c, "UNAUTHENTICATED");
  const { ctx, access } = authorized;
  const row = await commitCommand(ctx, prepareCommand(ctx, {
    statements: [readPlace(access, input.data.params.p)],
    decode: ([result]) => result?.results[0] as { value: string | null } | undefined,
  }));
  if (!row) return transportFailure(c, "UNAUTHENTICATED");
  return row.value ? transportSuccess(c, await decodePlace(row.value, c.env.EFFECTS_ENCRYPTION_KEY), ctx.now)
    : transportFailure(c, "NOT_FOUND");
});

type CommandRoute<Input> = {
  path: string;
  method: "POST" | "PATCH";
  input: { safeParse(value: unknown): { success: true; data: Input } | { success: false } };
  output: ResponseSchema;
};

type TextFields = { alias?: string; address?: string; safeArrivalNote?: string | null };
const entryFields = ["alias", "address", "safeArrivalNote"] as const;
function command<Input extends { body: { operationId: string } }>(route: CommandRoute<Input>,
  plan: (ctx: RequestScope, access: SessionAccess, input: Input, c: Context<ApiEnv>) => Promise<CommandInput<PlaceCommandResult> | null>,
  projection: "place" | "invite" | "json" = "place", text?: (input: Input) => TextFields,
) {
  placesRoutes.on(route.method, route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), body: await boundedBody(c.req.raw) });
    if (!input.success || input.data.body.operationId !== c.req.header(operationIdHeader)) return transportFailure(c, "VALIDATION_FAILED");
    if (text) {
      const fields = text(input.data);
      for (const key of entryFields) {
        const value = fields[key];
        if (value && looksLikeAccessCode(value)) {
          return transportFailure(c, { code: "VALIDATION_FAILED", fieldErrors: [{ path: ["payload", key], code: "INVALID_VALUE" }] });
        }
      }
    }
    const authorized = await authorize(c);
    if (!authorized) return transportFailure(c, "UNAUTHENTICATED");
    const { ctx, access } = authorized;
    const prepared = await plan(ctx, access, input.data, c);
    if (!prepared) return transportFailure(c, "UNAVAILABLE");
    const { operation, value, error } = await commitCommand(ctx, prepareCommand(ctx, prepared));
    if (error) return transportFailure(c, error);
    scheduleOperationSignals(c, [operation]);
    if (!value) return transportFailure(c, "NOT_FOUND");
    const key = c.env.EFFECTS_ENCRYPTION_KEY;
    const data = projection === "place" ? await decodePlace(value, key)
      : projection === "invite" ? await decodeManagedInvitation(value, key) : JSON.parse(value) as unknown;
    return transportSuccess(c, route.output.parse(data), ctx.now);
  });
}

command(createPlaceRoute, (ctx, access, { body }) => createPlace(ctx, access, body), "place", ({ body }) => body.payload);
command(patchPlaceRoute, (ctx, access, { params, body }) => patchPlace(ctx, access, params.p, body), "place", ({ body }) => body.payload);
command(patchPlacePersonRoute, (ctx, access, { params, body }) => patchPlacePerson(ctx, access, params.p, params.person, body));
command(verifyPlacePinRoute, (ctx, access, { params, body }) => verifyPlacePin(ctx, access, params.p, body));
command(changePlaceApproverRoute, (ctx, access, { params, body }) => changePlaceApprover(ctx, access, params.p, body));
command(archivePlaceRoute, (ctx, access, { params, body }) => archivePlace(ctx, access, params.p, body), "json");
command(invitePlacePersonRoute, async (ctx, access, { params, body }, c) => {
  const keys = await invitationMailKeys(c.env);
  return keys && issuePlaceInvitation(ctx, access, keys, params.p, body);
}, "invite");
command(transferPlaceRoute, async (ctx, access, { params, body }, c) => {
  const keys = await invitationMailKeys(c.env);
  return keys && issuePlaceInvitation(ctx, access, keys, params.p, body);
}, "invite");
