import { z } from "zod";
import {
  attachmentIdSchema, commandInputSchema, contextRoleSchema, errorBodySchema, idSchema, idSchemaFor, localeTagSchema,
  operationIdSchema, paginationInputSchema, paginationSchema, timestampSchema,
} from "./common";
import { customerUpdateSchema } from "./field";
import { defineRoute } from "./route";
import { syncLimits } from "./sync-envelope";

export const chatThreadIdSchema = idSchemaFor<"chat_thread">();
export const chatMessageIdSchema = idSchemaFor<"chat_message">();
export const chatEntryIdSchema = idSchemaFor<"chat_entry">();
const threadParams = z.strictObject({ id: chatThreadIdSchema });
const entryParams = z.strictObject({ id: chatEntryIdSchema });
const position = z.int().positive();
const readPosition = z.int().nonnegative();
const displayText = z.string().min(1);
const originalText = displayText.max(16_000).refine((text) => text.trim().length > 0);

export const chatAudienceSchema = z.enum(["job", "crew", "session"]);
const threadHeader = {
  id: chatThreadIdSchema,
  writeState: z.enum(["open", "read_only"]),
};
const jobHeading = z.strictObject({
  id: idSchemaFor<"job">(), reference: z.string().regex(/^BB-[A-Z0-9]+$/), title: displayText.nullable(), siteZone: displayText,
});
const sessionHeading = z.strictObject({
  id: idSchemaFor<"session_booking">(), reference: displayText, title: displayText, siteZone: displayText,
});
const actor = z.strictObject({ displayName: displayText, role: contextRoleSchema, isViewer: z.boolean() });
const member = actor.extend({
  isContact: z.boolean(),
  writingLanguage: localeTagSchema.nullable(),
  readingLocale: localeTagSchema.nullable(),
});

// Null means no applicable stored translation (including Original only and same-language reading).
// Only the viewer's preferred target is projected. The original is always a separate field.
export const preferredChatTranslationSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("ready"), targetLocale: localeTagSchema, text: displayText, producedAt: timestampSchema }),
  z.strictObject({ state: z.literal("pending"), targetLocale: localeTagSchema }),
  z.strictObject({ state: z.literal("unavailable"), targetLocale: localeTagSchema, canRetry: z.boolean() }),
]);
const messageContent = {
  sourceLanguage: localeTagSchema.nullable(),
  originalText: originalText.nullable(),
  preferredTranslation: preferredChatTranslationSchema.nullable(),
};
const attachment = z.strictObject({
  attachmentId: attachmentIdSchema,
  kind: z.enum(["photo", "voice"]),
  availability: z.enum(["available", "unavailable"]),
});
const receipt = z.strictObject({
  id: chatEntryIdSchema, rootId: chatMessageIdSchema, revision: z.int().positive(), position, receivedAt: timestampSchema,
});
export const chatEntryProjectionSchema = receipt.extend({
  ...messageContent,
  correctsId: chatEntryIdSchema.nullable(),
  author: actor,
  attachments: z.array(attachment).max(3),
  // Locale labels on the sender's receipt describe preferred reading, not delivery or read status.
  readingLocales: z.array(localeTagSchema).optional(),
}).refine((entry) => entry.originalText !== null || (entry.attachments.length > 0 && entry.preferredTranslation === null));

// S-08: a scoped inbox row; fetching the list does not mark it read.
const threadSummary = {
  ...threadHeader,
  contact: actor.nullable(),
  unreadCount: readPosition,
  latest: z.strictObject({
    ...messageContent, originalText: displayText.max(512).nullable(),
    author: actor, receivedAt: timestampSchema, attachmentKind: z.enum(["photo", "voice"]).nullable(),
  }).refine(({ preferredTranslation }) => preferredTranslation?.state !== "ready" || preferredTranslation.text.length <= 512).nullable(),
};
export const threadSummarySchema = z.discriminatedUnion("audience", [
  z.strictObject({ ...threadSummary, audience: z.literal("job"), job: jobHeading }),
  z.strictObject({ ...threadSummary, audience: z.literal("crew"), job: jobHeading }),
  z.strictObject({ ...threadSummary, audience: z.literal("session"), session: sessionHeading }),
]);

// S-13: current members only, no contact details, profiles or former members.
const threadDetails = {
  ...threadHeader,
  canSend: z.boolean(),
  readOnlyReason: z.enum(["job_closed", "session_closed", "read_only_grant"]).nullable(),
  readPosition,
  lastPosition: readPosition,
  readingLocale: localeTagSchema.nullable(),
  members: z.array(member),
};
export const threadDetailsSchema = z.discriminatedUnion("audience", [
  z.strictObject({ ...threadDetails, audience: z.literal("job"), job: jobHeading }),
  z.strictObject({ ...threadDetails, audience: z.literal("crew"), job: jobHeading, safetyHold: z.boolean() }),
  z.strictObject({ ...threadDetails, audience: z.literal("session"), session: sessionHeading }),
]);

const visitId = idSchemaFor<"visit">();
const jobStamp = z.strictObject({ visitId, update: customerUpdateSchema, isCurrent: z.boolean() });
// Admission to Crew does not expose other workers' attendance; the reader
// gets only their own attendance stamps (or the authorised foreman's view).
const crewStamp = z.strictObject({
  id: idSchema, visitId, at: timestampSchema, isCurrent: z.boolean(), actorName: displayText.nullable(),
  kind: z.enum(["cover_confirmed", "checked_in", "checked_out", "work_started", "work_paused", "work_finished"]),
});
const entryPage = {
  threadId: chatThreadIdSchema,
  // The initial HTTP read includes the checked header and viewer permissions.
  // Older pages and realtime frames with separate details omit this field.
  thread: threadDetailsSchema.optional(),
  entries: z.array(chatEntryProjectionSchema).max(syncLimits.changes),
  page: paginationSchema,
};
// S-10: app-authored stamps have separate sources and never acquire message positions.
export const threadEntriesPageSchema = z.discriminatedUnion("audience", [
  z.strictObject({ ...entryPage, audience: z.literal("job"), stamps: z.array(jobStamp).max(syncLimits.changes) }),
  z.strictObject({ ...entryPage, audience: z.literal("crew"), stamps: z.array(crewStamp).max(syncLimits.changes) }),
  z.strictObject({ ...entryPage, audience: z.literal("session"), stamps: z.tuple([]) }),
]).refine(({ thread, threadId, audience: pageAudience }) => !thread || (thread.id === threadId && thread.audience === pageAudience));

export const appendChatPayloadSchema = z.strictObject({
  // Stable client message ID: the entry ID, also the root ID for a new message.
  id: chatEntryIdSchema,
  correctsId: chatEntryIdSchema.optional(),
  sourceLanguage: localeTagSchema,
  originalText: originalText.optional(),
  attachmentIds: z.array(attachmentIdSchema).max(3).refine((ids) => new Set(ids).size === ids.length).optional(),
}).refine((entry) => entry.originalText !== undefined || !!entry.attachmentIds?.length);
// Commands recheck attachment kind (photo group or one voice note), readiness and scope.
export const chatAppendOperationSchema = commandInputSchema(appendChatPayloadSchema).strict();
export const chatAppendOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    operationId: operationIdSchema, status: z.enum(["committed", "replayed"]),
    receipt: receipt.extend({ readingLocales: z.array(localeTagSchema) }),
  }),
  z.strictObject({ operationId: operationIdSchema, status: z.literal("rejected"), error: errorBodySchema }),
]);

export const listThreadsRoute = defineRoute({
  method: "GET", path: "/threads", auth: "context",
  input: z.strictObject({ query: paginationInputSchema.optional() }),
  output: z.strictObject({ threads: z.array(threadSummarySchema).max(syncLimits.changes), page: paginationSchema }),
});
export const getThreadRoute = defineRoute({
  method: "GET", path: "/threads/:id", auth: "context",
  input: z.strictObject({ params: threadParams }), output: threadDetailsSchema,
});
export const getThreadEntriesRoute = defineRoute({
  method: "GET", path: "/threads/:id/entries", auth: "context",
  input: z.strictObject({ params: threadParams, query: paginationInputSchema.optional() }), output: threadEntriesPageSchema,
});
export const appendThreadEntriesRoute = defineRoute({
  method: "POST", path: "/threads/:id/entries", auth: "context",
  // Each operation carries its own identity (as in sync), not a batch-level operation header.
  input: z.strictObject({
    params: threadParams, body: z.strictObject({ operations: z.array(chatAppendOperationSchema).min(1).max(syncLimits.operations) }),
  }),
  output: z.strictObject({ outcomes: z.array(chatAppendOutcomeSchema).max(syncLimits.operations) }),
});
export const markThreadReadRoute = defineRoute({
  method: "POST", path: "/threads/:id/read-position", auth: "context", command: true,
  input: z.strictObject({ params: threadParams, body: commandInputSchema(z.strictObject({ position: readPosition })).strict() }),
  output: z.strictObject({ threadId: chatThreadIdSchema, position: readPosition }),
});
const translationCommand = z.strictObject({
  params: entryParams, body: commandInputSchema(z.strictObject({ targetLocale: localeTagSchema })).strict(),
});
export const reportTranslationRoute = defineRoute({
  method: "POST", path: "/entries/:id/report-translation", auth: "context", command: true,
  input: translationCommand,
  output: z.strictObject({ entryId: chatEntryIdSchema, targetLocale: localeTagSchema, reportedAt: timestampSchema }),
});
export const requestTranslationRoute = defineRoute({
  method: "POST", path: "/entries/:id/request-translation", auth: "context", command: true,
  // An explicit retry is only eligible for a reviewed pair and a definitely uncharged prior outcome.
  input: translationCommand,
  output: z.strictObject({ entryId: chatEntryIdSchema, preferredTranslation: preferredChatTranslationSchema }),
});

export type ThreadSummary = z.output<typeof threadSummarySchema>;
export type ThreadDetails = z.output<typeof threadDetailsSchema>;
export type ThreadEntriesPage = z.output<typeof threadEntriesPageSchema>;
export type ChatEntryProjection = z.output<typeof chatEntryProjectionSchema>;
export type PreferredChatTranslation = z.output<typeof preferredChatTranslationSchema>;
export type ChatAppendOperation = z.output<typeof chatAppendOperationSchema>;
export type ChatAppendOutcome = z.output<typeof chatAppendOutcomeSchema>;
