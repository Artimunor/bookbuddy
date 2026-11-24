import { CONTEXT_ROLES } from "@bookbuddy/domain";
import type { OpaqueId } from "@bookbuddy/domain";
import { z } from "zod";

// Resource IDs are opaque to the wire. UUIDs and base64url IDs both fit one segment.
export const idSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/);

export function idSchemaFor<Kind extends string>() {
  return idSchema.transform((value) => value as OpaqueId<Kind>);
}

export const accountIdSchema = idSchemaFor<"account">();
export const contextIdSchema = idSchemaFor<"context">();
export const businessIdSchema = idSchemaFor<"business">();
export const attachmentIdSchema = idSchemaFor<"attachment">();
export const operationIdSchema = idSchemaFor<"operation">();
export type OperationId = z.infer<typeof operationIdSchema>;

export const operationIdHeader = "X-Operation-Id";
export const expectedSessionHeader = "X-Expected-Session";
export const expectedContextHeader = "X-Expected-Context";
export const noExpectedContext = "~";

export const timestampSchema = z.int();
export const revisionSchema = z.int().nonnegative();
export const contextRoleSchema = z.enum(CONTEXT_ROLES);

export const activeContextSchema = z.discriminatedUnion("role", [
  z.object({
    contextId: contextIdSchema,
    role: contextRoleSchema.extract(["customer"]),
    businessId: z.null(),
    businessName: z.never().optional(),
    membershipId: z.never().optional(),
  }),
  z.object({
    contextId: contextIdSchema,
    role: contextRoleSchema.exclude(["customer"]),
    businessId: businessIdSchema,
    businessName: z.string().optional(),
    membershipId: idSchemaFor<"membership">().optional(),
  }),
]);
export type ActiveContext = z.infer<typeof activeContextSchema>;

// A context is a UI selection, never proof of current authority.
export const scopeHeaderSchema = activeContextSchema;
export type ScopeHeader = z.infer<typeof scopeHeaderSchema>;

// Cursors are uninterpreted even when they contain a separator for a signature.
export const cursorSchema = z.string().min(1).max(2048).regex(/^[A-Za-z0-9._~-]+$/);
export type Cursor = z.infer<typeof cursorSchema>;

export const paginationInputSchema = z.object({ cursor: cursorSchema.optional() });
export const paginationSchema = z.object({ cursor: cursorSchema.nullable(), hasMore: z.boolean() });
export type PaginationInput = z.infer<typeof paginationInputSchema>;
export type Pagination = z.infer<typeof paginationSchema>;

// Access, availability and any signed read grant belong to the caller's projection.
export const evidenceReferenceSchema = z.object({ attachmentId: attachmentIdSchema });
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;

// Accept saved tags from newer clients without coercing them to this build's catalogs.
export const localeTagSchema = z.string().min(1).max(255).refine((tag) => {
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
});
export const localePreferencesSchema = z.object({
  uiLocale: localeTagSchema.nullable(),
  readingLocale: localeTagSchema.nullable(),
  // Remains optional to accept bootstraps cached before viewer-zone support.
  displayZone: z.string().max(255).regex(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/).nullable().optional(),
});
export type LocalePreferences = z.infer<typeof localePreferencesSchema>;

export const errorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
  "STALE_REVISION",
  "OPERATION_ID_REUSED",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "INTERNAL_ERROR",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const fieldErrorSchema = z.object({
  path: z.array(z.union([z.string(), z.int().nonnegative()])),
  code: z.enum(["REQUIRED", "INVALID_VALUE", "INVALID_FORMAT", "OUT_OF_RANGE"]),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

// Explicit alternatives only: no competing actor, address, payload or free-form detail.
export const safeConflictSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("revision"), revision: revisionSchema }),
  z.strictObject({ kind: z.literal("operation_id_reused") }),
  z.strictObject({ kind: z.literal("session_changed") }),
  z.strictObject({ kind: z.literal("window_unavailable") }),
  z.strictObject({
    kind: z.literal("cover"),
    status: z.enum(["accepted_pending_confirmation", "filled", "closed", "withdrawn", "expired"]),
  }),
]);
export type SafeConflict = z.infer<typeof safeConflictSchema>;

export const errorBodySchema = z.object({
  code: errorCodeSchema,
  fieldErrors: z.array(fieldErrorSchema).optional(),
  retryAt: timestampSchema.optional(),
  current: safeConflictSchema.optional(),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

const requestMetaSchema = z.object({ requestId: z.string().min(1) });
const successMetaSchema = requestMetaSchema.extend({ serverTime: timestampSchema });

export const errorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: errorBodySchema,
  meta: requestMetaSchema,
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export function successEnvelopeSchema<Data extends z.ZodType>(data: Data) {
  return z.object({ ok: z.literal(true), data, meta: successMetaSchema });
}

export function resultSchema<Data extends z.ZodType>(data: Data) {
  return z.discriminatedUnion("ok", [successEnvelopeSchema(data), errorEnvelopeSchema]);
}

export type SuccessEnvelope<T> = { ok: true; data: T; meta: z.infer<typeof successMetaSchema> };
export type Result<T> = SuccessEnvelope<T> | ErrorEnvelope;

const wireResultSchema = resultSchema(z.unknown().refine((data) => data !== undefined));

export function parseResult<Data extends z.ZodType>(schema: Data, input: unknown): Result<z.output<Data>> | null {
  const envelope = wireResultSchema.safeParse(input);
  if (!envelope.success) return null;
  if (!envelope.data.ok) return envelope.data;
  const projection = schema.safeParse(envelope.data.data);
  return projection.success
    ? { ok: true, data: projection.data, meta: envelope.data.meta }
    : null;
}

export function commandInputSchema<Payload extends z.ZodType>(payload: Payload) {
  return z.object({ operationId: operationIdSchema, expectedRevision: revisionSchema.optional(), payload });
}

export type CommandInput<T> = {
  operationId: OperationId;
  expectedRevision?: number;
  payload: T;
};
