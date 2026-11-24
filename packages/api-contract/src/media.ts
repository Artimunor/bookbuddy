import { z } from "zod";
import { attachmentIdSchema, idSchema, idSchemaFor, timestampSchema } from "./common";
import { defineRoute } from "./route";

export const mediaLimits = {
  batch: 8,
  photoBytes: 5 * 1024 * 1024,
  // 90 s at the app recorder's 64 kb/s is 720 kB; allow 80 kB of encoder/container overhead.
  voiceBytes: 800_000,
  voiceDurationMs: 90_000,
  pendingBytes: 100 * 1024 * 1024,
  parts: 20, // Up to 100 MiB with non-final R2 parts of at least 5 MiB.
} as const;

export const mediaCallerSchema = z.enum(["request", "chat", "progress", "update", "quote", "change", "completion", "case"]);
export const attachmentStateSchema = z.enum(["reserved", "preparing", "uploading", "verifying", "ready", "rejected", "expired"]);
export const mediaStageIdSchema = idSchemaFor<"media_stage">();
export const mediaScopeSchema = z.strictObject({ caller: mediaCallerSchema, parentScopeId: idSchema });

const photoMime = z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const voiceMime = z.enum(["audio/mp4", "audio/aac", "audio/mpeg", "audio/ogg", "audio/webm"]);
const photo = z.strictObject({ kind: z.literal("photo"), mime: photoMime, bytes: z.int().positive().max(mediaLimits.photoBytes) });
const voice = z.strictObject({
  kind: z.literal("voice"), mime: voiceMime, bytes: z.int().positive().max(mediaLimits.voiceBytes),
  durationMs: z.int().positive().max(mediaLimits.voiceDurationMs),
});
// Bytes always go directly to private R2. No file names, captions or access notes in grants.
export const mediaFileSchema = z.discriminatedUnion("kind", [photo, voice]);

const uploadGeneration = z.int().positive();
const partNumber = z.int().min(1).max(mediaLimits.parts);
const partNumbers = z.array(partNumber).max(mediaLimits.parts).refine((parts) => new Set(parts).size === parts.length);
const eTag = z.string().min(1).max(128).regex(/^[\x21-\x7e]+$/);
const completedPart = z.strictObject({ partNumber, etag: eTag });
const completedParts = z.array(completedPart).max(mediaLimits.parts)
  .refine((parts) => new Set(parts.map((part) => part.partNumber)).size === parts.length);
const signedUrl = z.url({ protocol: /^https$/ });
const reservation = z.strictObject({ attachmentId: attachmentIdSchema, uploadGeneration });
const stage = { stageId: mediaStageIdSchema };
const otherStates = z.enum(["reserved", "preparing", "verifying", "ready", "rejected", "expired"]);
const acknowledgement = reservation.extend({ state: attachmentStateSchema });

function batch<Item extends z.ZodType<{ attachmentId: string }>>(item: Item) {
  return z.array(item).min(1).max(mediaLimits.batch)
    .refine((items) => new Set(items.map(({ attachmentId }) => attachmentId)).size === items.length);
}

const grantFile = z.strictObject({
  attachmentId: attachmentIdSchema,
  file: mediaFileSchema,
  // New IDs reserve once; a refresh fences the already-known generation.
  refresh: z.strictObject({
    uploadGeneration,
    missingPartNumbers: partNumbers.refine((parts) => parts.length > 0).optional(),
  }).optional(),
});
const grantsInput = z.strictObject({ ...stage, scope: mediaScopeSchema, files: batch(grantFile) })
  .refine(({ scope, files }) => {
    const voices = files.filter(({ file }) => file.kind === "voice").length;
    const photos = files.length - voices;
    switch (scope.caller) {
      case "chat": return voices === 0 ? photos <= 3 : voices === 1 && photos === 0;
      case "progress": return voices === 0 && photos <= 6;
      case "update": return voices === 0 && photos === 1;
      case "completion": return voices === 0 && photos <= 8;
      default: return voices <= 1 && photos <= 5;
    }
  }, { path: ["files"], error: "Media count or kind exceeds the caller's limit" });

const uploadPart = z.strictObject({
  partNumber, url: signedUrl, offset: z.int().nonnegative(), bytes: z.int().positive(),
});
export const mediaUploadGrantSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("single"), method: z.literal("PUT"), url: signedUrl, expiresAt: timestampSchema,
    headers: z.strictObject({
      "If-None-Match": z.literal("*"),
      "Content-Type": z.union([photoMime, voiceMime]),
      "Cache-Control": z.literal("private, no-store"),
    }),
  }),
  z.strictObject({
    kind: z.literal("multipart"), method: z.literal("PUT"), expiresAt: timestampSchema,
    parts: z.array(uploadPart).min(1).max(mediaLimits.parts)
      .refine((parts) => new Set(parts.map((part) => part.partNumber)).size === parts.length),
  }),
]);
const grantOutcome = z.discriminatedUnion("state", [
  reservation.extend({ state: z.literal("uploading"), grant: mediaUploadGrantSchema }),
  reservation.extend({ state: otherStates }),
]);

export const createMediaGrantsRoute = defineRoute({
  method: "POST", path: "/media/grants", auth: "context",
  // Recheck the caller's total scoped media and the account/device pending cap with the reservation.
  input: z.strictObject({ body: grantsInput }),
  output: z.strictObject({ ...stage, grants: z.array(grantOutcome).max(mediaLimits.batch) }),
});

const settlement = z.discriminatedUnion("kind", [
  reservation.extend({ kind: z.literal("single") }),
  reservation.extend({ kind: z.literal("multipart"), parts: completedParts.refine((parts) => parts.length > 0) }),
]);
export const settleMediaRoute = defineRoute({
  method: "POST", path: "/media/settle", auth: "context",
  // Already-ready IDs replay their acknowledgements without R2; other files are settled in one batch.
  input: z.strictObject({ body: z.strictObject({ ...stage, files: batch(settlement) }) }),
  output: z.strictObject({ ...stage, acknowledgements: z.array(acknowledgement).max(mediaLimits.batch) }),
});

export const mediaReadGrantSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("ready"), attachmentId: attachmentIdSchema,
    file: z.discriminatedUnion("kind", [photo, voice.extend({ transcriptState: z.literal("unavailable") })]),
    method: z.literal("GET"), url: signedUrl, expiresAt: timestampSchema,
  }),
  z.strictObject({ state: z.literal("unavailable"), attachmentId: attachmentIdSchema }),
]);
export const createMediaReadGrantsRoute = defineRoute({
  method: "POST", path: "/media/read-grants", auth: "context",
  // The scope names a specific authorised parent link, not the original upload stage.
  input: z.strictObject({ body: z.strictObject({
    scope: mediaScopeSchema,
    attachmentIds: z.array(attachmentIdSchema).min(1).max(mediaLimits.batch).refine((ids) => new Set(ids).size === ids.length),
  }) }),
  output: z.strictObject({ grants: z.array(mediaReadGrantSchema).max(mediaLimits.batch) }),
});

const recovery = z.discriminatedUnion("state", [
  reservation.extend({
    state: z.literal("uploading"),
    transfer: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("single"), object: z.literal("missing") }),
      z.strictObject({ kind: z.literal("multipart"), completedParts, missingPartNumbers: partNumbers }),
    ]),
  }),
  reservation.extend({ state: otherStates }),
]);
export const recoverMediaRoute = defineRoute({
  method: "POST", path: "/media/recover", auth: "context",
  // For an ambiguous transfer only. Probe a known reservation, never list a bucket or duplicate a known OS task.
  input: z.strictObject({ body: z.strictObject({
    ...stage, files: batch(reservation.extend({ unknown: z.enum(["put", "parts", "completion"]) })),
  }) }),
  output: z.strictObject({ ...stage, files: z.array(recovery).max(mediaLimits.batch) }),
});

export type MediaCaller = z.output<typeof mediaCallerSchema>;
export type AttachmentState = z.output<typeof attachmentStateSchema>;
export type MediaFile = z.output<typeof mediaFileSchema>;
export type MediaUploadGrant = z.output<typeof mediaUploadGrantSchema>;
export type MediaReadGrant = z.output<typeof mediaReadGrantSchema>;
export type MediaSettlement = z.output<typeof settlement>;
export type MediaRecovery = z.output<typeof recovery>;
