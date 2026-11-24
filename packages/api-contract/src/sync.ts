import { ATTENDANCE_KINDS } from "@bookbuddy/domain";
import { z } from "zod";
import {
  accountIdSchema, attachmentIdSchema, commandInputSchema, errorBodySchema, idSchema, localeTagSchema,
  operationIdSchema, revisionSchema, scopeHeaderSchema, timestampSchema,
} from "./common";
import { syncProgressPhotoLimit, syncProgressPhotosSchema } from "./field";
import { defineRoute } from "./route";
import { syncPageSchema, syncRequestSchema } from "./sync-envelope";

// Workers validate decoded claims after verifying the signature. Wire cursors stay opaque to callers.
const cursorClaims = z.object({
  version: z.literal(1), accountId: accountIdSchema, context: scopeHeaderSchema, epoch: revisionSchema, expiresAt: revisionSchema,
  nextExpiry: revisionSchema.nullable(),
  sessionsEpoch: revisionSchema.optional(),
});
export const syncCursorClaimsSchema = z.discriminatedUnion("phase", [
  cursorClaims.extend({ phase: z.literal("delta"), seq: revisionSchema, through: revisionSchema.optional() }),
  cursorClaims.extend({ phase: z.literal("snapshot"), anchor: revisionSchema, kind: idSchema, id: idSchema }),
  cursorClaims.extend({ phase: z.literal("revoked") }),
]);
export type SyncCursor = z.output<typeof syncCursorClaimsSchema>;

export const notificationIdsSchema = z.array(idSchema).min(1).max(100)
  .refine((ids) => new Set(ids).size === ids.length);

export const syncOperationSchema = z.discriminatedUnion("kind", [
  commandInputSchema(z.strictObject({
    id: idSchema, assignmentId: idSchema, kind: z.enum(ATTENDANCE_KINDS),
    actualAt: timestampSchema, capturedAt: timestampSchema,
  })).extend({ kind: z.literal("attendance") }).strict(),
  commandInputSchema(z.strictObject({
    id: idSchema, threadId: idSchema, sourceLanguage: localeTagSchema,
    originalText: z.string().min(1).max(16_000).optional(),
    attachmentIds: z.array(attachmentIdSchema).max(3).optional(),
  }).refine((entry) => entry.originalText !== undefined || !!entry.attachmentIds?.length))
    .extend({ kind: z.literal("chat_append") }).strict(),
  commandInputSchema(z.strictObject({
    assignmentId: idSchema, photos: syncProgressPhotosSchema,
  })).extend({ kind: z.literal("attachment_link") }).strict(),
  commandInputSchema(z.strictObject({ threadId: idSchema, position: z.int().nonnegative() }))
    .extend({ kind: z.literal("chat_read_mark") }).strict(),
  commandInputSchema(z.strictObject({ ids: notificationIdsSchema }))
    .extend({ kind: z.literal("notification_read_mark") }).strict(),
]);

export type SyncOp = z.output<typeof syncOperationSchema>;
export type SyncOpKind = SyncOp["kind"];

const progressPhotoOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({ activityId: idSchema, status: z.enum(["committed", "replayed"]), receivedAt: timestampSchema }),
  z.strictObject({ activityId: idSchema, status: z.literal("rejected"), error: errorBodySchema }),
]);
export type ProgressPhotoOutcome = z.output<typeof progressPhotoOutcomeSchema>;

const operationOutcomeFields = {
  operationId: operationIdSchema,
  photoOutcomes: z.array(progressPhotoOutcomeSchema).min(1).max(syncProgressPhotoLimit).optional(),
};
export const operationOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ ...operationOutcomeFields, status: z.literal("committed"), resultRef: idSchema }),
  z.object({ ...operationOutcomeFields, status: z.literal("replayed"), resultRef: idSchema }),
  z.object({ ...operationOutcomeFields, status: z.literal("unchanged") }),
  z.object({ ...operationOutcomeFields, status: z.literal("rejected"), error: errorBodySchema }),
]);
export type OpOutcome = z.output<typeof operationOutcomeSchema>;

export const syncProjectionSchema = z.object({ kind: idSchema, resourceId: idSchema, value: z.json() });
// A scope removal is a barrier: drop its entire cached partition before applying any page upserts.
export const syncRemovalSchema = z.object({ kind: idSchema, resourceId: idSchema });
export type SyncProjection = z.output<typeof syncProjectionSchema>;
export type SyncRemoval = z.output<typeof syncRemovalSchema>;

export const syncRoute = defineRoute({
  method: "POST",
  path: "/sync",
  auth: "context",
  input: z.object({ body: syncRequestSchema(syncOperationSchema) }),
  output: syncPageSchema({ outcome: operationOutcomeSchema, projection: syncProjectionSchema, removal: syncRemovalSchema }),
});
export type SyncRequest = z.input<typeof syncRoute.input>["body"];
export type SyncPage = z.output<typeof syncRoute.output>;
