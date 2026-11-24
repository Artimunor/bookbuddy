import { PUSH_INSTALLATION_STATES, PUSH_PLATFORMS } from "@bookbuddy/domain";
import { z } from "zod";
import { commandInputSchema, contextIdSchema, idSchema, paginationInputSchema, paginationSchema, revisionSchema, timestampSchema } from "./common";
import { linkTokenSchema } from "./links";
import { defineRoute } from "./route";
import { notificationIdsSchema, operationOutcomeSchema } from "./sync";

export const notificationSchema = z.strictObject({
  id: idSchema,
  kind: idSchema,
  linkToken: linkTokenSchema.nullable(),
  createdAt: timestampSchema,
  readAt: timestampSchema.nullable(),
});
export type NotificationProjection = z.output<typeof notificationSchema>;

export const notificationsRoute = defineRoute({
  method: "GET",
  path: "/notifications",
  auth: "context",
  input: z.object({ query: paginationInputSchema.extend({ contextId: contextIdSchema }) }),
  output: z.object({ items: z.array(notificationSchema).max(50), page: paginationSchema }),
});

const readCutoff = z.strictObject({ createdAt: timestampSchema, id: idSchema });
export const notificationReadPayloadSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("ids"), ids: notificationIdsSchema }),
  z.strictObject({ mode: z.literal("all"), through: readCutoff }),
]);
export type NotificationReadPayload = z.output<typeof notificationReadPayloadSchema>;
export const notificationReadRoute = defineRoute({
  method: "POST",
  path: "/notifications/read",
  auth: "context",
  command: true,
  input: z.object({ body: commandInputSchema(notificationReadPayloadSchema).extend({ contextId: contextIdSchema }) }),
  output: operationOutcomeSchema,
});

const installationParams = z.object({ id: idSchema });
const expectedEpoch = revisionSchema.max(Number.MAX_SAFE_INTEGER - 1);
const installationOutput = z.object({
  id: idSchema,
  tokenEpoch: z.int().positive(),
  state: z.enum(PUSH_INSTALLATION_STATES),
  status: z.enum(["committed", "replayed", "unchanged"]),
});
export const putPushInstallationRoute = defineRoute({
  method: "PUT",
  path: "/push/installations/:id",
  auth: "session",
  command: true,
  input: z.object({ params: installationParams, body: commandInputSchema(z.strictObject({
    token: z.string().min(1).max(256).regex(/^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/),
    platform: z.enum(PUSH_PLATFORMS),
  })).extend({ expectedRevision: expectedEpoch }) }),
  output: installationOutput,
});
export const deletePushInstallationRoute = defineRoute({
  method: "DELETE",
  path: "/push/installations/:id",
  auth: "session",
  command: true,
  input: z.object({ params: installationParams, body: commandInputSchema(z.strictObject({})).extend({ expectedRevision: expectedEpoch }) }),
  output: installationOutput,
});
export type RegisterPushInstallation = z.output<typeof putPushInstallationRoute.input>["body"];
export type RevokePushInstallation = z.output<typeof deletePushInstallationRoute.input>["body"];
