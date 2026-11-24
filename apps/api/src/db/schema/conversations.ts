import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { accountContexts } from "./access";
import { changeVersions, quoteVersions } from "./commercial";
import { jobs } from "./jobs";
import { sessionBookings } from "./sessions";

export const chatThreads = sqliteTable("chat_threads", {
  id: text().notNull().primaryKey(),
  jobId: text("job_id").references(() => jobs.id),
  sessionBookingId: text("session_booking_id").references(() => sessionBookings.id),
  audience: text({ enum: ["job", "crew", "session"] }).notNull(),
  writeState: text("write_state", { enum: ["open", "read_only"] }).notNull(),
  lastPosition: integer("last_position").notNull().default(0),
}, (t) => [
  check("chat_threads_audience", sql`${t.audience} IN ('job', 'crew', 'session')`),
  check("chat_threads_parent", sql`(${t.audience} = 'session' AND ${t.sessionBookingId} IS NOT NULL AND ${t.jobId} IS NULL)
    OR (${t.audience} IN ('job', 'crew') AND ${t.jobId} IS NOT NULL AND ${t.sessionBookingId} IS NULL)`),
  check("chat_threads_write_state", sql`${t.writeState} IN ('open', 'read_only')`),
  check("chat_threads_last_position", sql`typeof(${t.lastPosition}) = 'integer' AND ${t.lastPosition} >= 0`),
  unique().on(t.jobId, t.audience),
  unique().on(t.sessionBookingId),
]);

export const chatMembers = sqliteTable("chat_members", {
  threadId: text("thread_id").notNull().references(() => chatThreads.id),
  contextId: text("context_id").notNull().references(() => accountContexts.id),
  canSend: integer("can_send", { mode: "boolean" }).notNull(),
  visibleFrom: integer("visible_from").notNull(),
  revokedAt: integer("revoked_at"),
}, (t) => [
  check("chat_members_can_send", sql`${t.canSend} IN (0, 1)`),
  check("chat_members_visible_from", sql`typeof(${t.visibleFrom}) = 'integer' AND ${t.visibleFrom} >= 1`),
  check("chat_members_revoked_at", sql`${t.revokedAt} IS NULL OR typeof(${t.revokedAt}) = 'integer'`),
  primaryKey({ columns: [t.threadId, t.contextId] }),
  index("chat_members_scope").on(t.contextId, t.revokedAt, t.threadId),
]);

export const chatMessages = sqliteTable("chat_messages", {
  id: text().notNull().primaryKey(),
  threadId: text("thread_id").notNull(),
  authorContextId: text("author_context_id").notNull(),
}, (t) => [
  foreignKey({ columns: [t.threadId, t.authorContextId], foreignColumns: [chatMembers.threadId, chatMembers.contextId] }),
  unique().on(t.id, t.threadId),
  index("chat_messages_author").on(t.threadId, t.authorContextId),
]);

// Append-only and predecessor guards are in 0010_conversations.sql.
export const chatEntries = sqliteTable("chat_entries", {
  id: text().notNull().primaryKey(),
  rootId: text("root_id").notNull(),
  threadId: text("thread_id").notNull(),
  revision: integer().notNull(),
  position: integer().notNull(),
  correctsId: text("corrects_id"),
  sourceLanguage: text("source_language"),
  originalText: text("original_text"),
  receivedAt: integer("received_at").notNull(),
}, (t) => [
  check("chat_entries_revision", sql`typeof(${t.revision}) = 'integer' AND ${t.revision} >= 1`),
  check("chat_entries_position", sql`typeof(${t.position}) = 'integer' AND ${t.position} >= 1`),
  check("chat_entries_original", sql`${t.originalText} IS NULL OR length(trim(${t.originalText}, char(9, 10, 11, 12, 13, 32))) > 0`),
  check("chat_entries_received_at", sql`typeof(${t.receivedAt}) = 'integer'`),
  check("chat_entries_correction", sql`(${t.revision} = 1) = (${t.correctsId} IS NULL) AND (${t.correctsId} IS NULL OR ${t.correctsId} <> ${t.id})`),
  foreignKey({ columns: [t.rootId, t.threadId], foreignColumns: [chatMessages.id, chatMessages.threadId] }),
  foreignKey({ columns: [t.correctsId, t.rootId], foreignColumns: [t.id, t.rootId] }),
  unique().on(t.id, t.rootId),
  unique().on(t.rootId, t.revision),
  unique().on(t.threadId, t.position),
  index("chat_entries_corrects").on(t.correctsId, t.rootId).where(sql`${t.correctsId} IS NOT NULL`),
]);

export const messageTranslations = sqliteTable("message_translations", {
  rootId: text("root_id").notNull(),
  revision: integer().notNull(),
  targetLocale: text("target_locale").notNull(),
  sourceLocale: text("source_locale").notNull(),
  state: text({ enum: ["pending", "ready", "unavailable"] }).notNull(),
  translatedText: text("translated_text"),
  provider: text(),
  model: text(),
  producedAt: integer("produced_at"),
}, (t) => [
  check("message_translations_state", sql`${t.state} IN ('pending', 'ready', 'unavailable')`),
  check("message_translations_locales", sql`length(${t.sourceLocale}) > 0 AND length(${t.targetLocale}) > 0 AND ${t.sourceLocale} <> ${t.targetLocale}`),
  check("message_translations_result", sql`
    (${t.state} = 'ready' AND ${t.translatedText} IS NOT NULL AND length(trim(${t.translatedText})) > 0
      AND ${t.provider} IS NOT NULL AND length(${t.provider}) > 0 AND ${t.model} IS NOT NULL AND length(${t.model}) > 0 AND typeof(${t.producedAt}) = 'integer')
    OR (${t.state} <> 'ready' AND ${t.translatedText} IS NULL AND ${t.producedAt} IS NULL)`),
  primaryKey({ columns: [t.rootId, t.revision, t.targetLocale] }),
  foreignKey({ columns: [t.rootId, t.revision], foreignColumns: [chatEntries.rootId, chatEntries.revision] }),
]);

export const readingArtifacts = sqliteTable("reading_artifacts", {
  id: text().notNull().primaryKey(),
  quoteVersionId: text("quote_version_id").references(() => quoteVersions.id),
  changeVersionId: text("change_version_id").references(() => changeVersions.id),
  targetLocale: text("target_locale").notNull(),
  translatedText: text("translated_text").notNull(),
  reviewedByContextId: text("reviewed_by_context_id").notNull().references(() => accountContexts.id),
  reviewedAt: integer("reviewed_at").notNull(),
}, (t) => [
  check("reading_artifacts_text", sql`length(trim(${t.translatedText})) > 0`),
  check("reading_artifacts_reviewed_at", sql`typeof(${t.reviewedAt}) = 'integer'`),
  check("reading_artifacts_scope", sql`(${t.quoteVersionId} IS NULL) <> (${t.changeVersionId} IS NULL)`),
  index("reading_artifacts_quote").on(t.quoteVersionId, t.targetLocale, t.reviewedAt, t.id).where(sql`${t.quoteVersionId} IS NOT NULL`),
  index("reading_artifacts_change").on(t.changeVersionId, t.targetLocale, t.reviewedAt, t.id).where(sql`${t.changeVersionId} IS NOT NULL`),
  index("reading_artifacts_reviewer").on(t.reviewedByContextId),
]);

export const threadReads = sqliteTable("thread_reads", {
  threadId: text("thread_id").notNull(),
  contextId: text("context_id").notNull(),
  position: integer().notNull(),
}, (t) => [
  check("thread_reads_position", sql`typeof(${t.position}) = 'integer' AND ${t.position} >= 0`),
  primaryKey({ columns: [t.threadId, t.contextId] }),
  foreignKey({ columns: [t.threadId, t.contextId], foreignColumns: [chatMembers.threadId, chatMembers.contextId] }),
]);

export const translationReports = sqliteTable("translation_reports", {
  entryId: text("entry_id").notNull().references(() => chatEntries.id),
  contextId: text("context_id").notNull().references(() => accountContexts.id),
  targetLocale: text("target_locale").notNull(),
  reportedAt: integer("reported_at").notNull(),
}, (t) => [
  check("translation_reports_reported_at", sql`typeof(${t.reportedAt}) = 'integer'`),
  primaryKey({ columns: [t.entryId, t.contextId] }),
  index("translation_reports_scope").on(t.contextId, t.entryId),
]);
