import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { accountContexts } from "./access";
import { caseEvents, completionItems } from "./aftercare";
import { changeVersions, quoteVersions } from "./commercial";
import { chatEntries } from "./conversations";
import { customerUpdates, visitActivityEvents } from "./field";
import { jobs, requests } from "./jobs";
import { shifts } from "./schedule";

export const mediaStages = sqliteTable("media_stages", {
  id: text().notNull().primaryKey(),
  contextId: text("context_id").notNull().references(() => accountContexts.id),
  caller: text({ enum: ["request", "chat", "progress", "update", "quote", "change", "completion", "case"] }).notNull(),
  parentScopeId: text("parent_scope_id").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [
  check("media_stages_caller", sql`${t.caller} IN ('request', 'chat', 'progress', 'update', 'quote', 'change', 'completion', 'case')`),
  check("media_stages_created_at", sql`typeof(${t.createdAt}) = 'integer'`),
  check("media_stages_expires_at", sql`typeof(${t.expiresAt}) = 'integer' AND ${t.expiresAt} > ${t.createdAt}`),
  index("media_stages_scope").on(t.contextId, t.caller, t.parentScopeId, t.expiresAt, t.id),
  index("media_stages_due").on(t.expiresAt, t.id),
]);

// The state transition and settled-object guards are in 0011_evidence.sql.
export const attachments = sqliteTable("attachments", {
  id: text().notNull().primaryKey(),
  stageId: text("stage_id").notNull().references(() => mediaStages.id),
  objectKey: text("object_key").notNull().unique(),
  uploadGeneration: integer("upload_generation").notNull().default(1),
  mime: text().notNull(),
  bytes: integer().notNull(),
  durationMs: integer("duration_ms"),
  r2UploadId: text("r2_upload_id"),
  state: text({ enum: ["reserved", "preparing", "uploading", "verifying", "ready", "rejected", "expired"] }).notNull(),
  leaseUntil: integer("lease_until"),
  etag: text(),
  retentionClass: text("retention_class", { enum: ["unlinked", "progress", "ordinary", "decision", "case", "safety"] }).notNull(),
  deleteAfter: integer("delete_after"),
}, (t) => [
  check("attachments_generation", sql`typeof(${t.uploadGeneration}) = 'integer' AND ${t.uploadGeneration} >= 1`),
  check("attachments_bytes", sql`typeof(${t.bytes}) = 'integer' AND ${t.bytes} > 0`),
  check("attachments_duration", sql`${t.durationMs} IS NULL OR (typeof(${t.durationMs}) = 'integer' AND ${t.durationMs} > 0)`),
  check("attachments_state", sql`${t.state} IN ('reserved', 'preparing', 'uploading', 'verifying', 'ready', 'rejected', 'expired')`),
  check("attachments_lease", sql`${t.leaseUntil} IS NULL OR (typeof(${t.leaseUntil}) = 'integer' AND ${t.state} IN ('preparing', 'verifying'))`),
  check("attachments_retention_class", sql`${t.retentionClass} IN ('unlinked', 'progress', 'ordinary', 'decision', 'case', 'safety')`),
  check("attachments_delete_after", sql`${t.deleteAfter} IS NULL OR typeof(${t.deleteAfter}) = 'integer'`),
  check("attachments_ready", sql`${t.state} <> 'ready' OR (${t.etag} IS NOT NULL AND length(${t.etag}) > 0)`),
  index("attachments_stage_state").on(t.stageId, t.state, t.id),
  index("attachments_due").on(t.deleteAfter, t.id).where(sql`${t.deleteAfter} IS NOT NULL`),
]);

export const requestAttachments = sqliteTable("request_attachments", {
  jobId: text("job_id").notNull().references(() => requests.jobId),
  attachmentId: text("attachment_id").notNull().references(() => attachments.id),
}, (t) => [
  primaryKey({ columns: [t.jobId, t.attachmentId] }),
  index("request_attachments_attachment").on(t.attachmentId),
]);

export const entryAttachments = sqliteTable("entry_attachments", {
  entryId: text("entry_id").notNull().references(() => chatEntries.id),
  attachmentId: text("attachment_id").notNull().references(() => attachments.id),
}, (t) => [
  primaryKey({ columns: [t.entryId, t.attachmentId] }),
  index("entry_attachments_attachment").on(t.attachmentId),
]);

export const shiftEvidence = sqliteTable("shift_evidence", {
  shiftId: text("shift_id").notNull().references(() => shifts.id),
  attachmentId: text("attachment_id").notNull().references(() => attachments.id),
  activityEventId: text("activity_event_id").notNull().unique().references(() => visitActivityEvents.id),
}, (t) => [
  primaryKey({ columns: [t.shiftId, t.attachmentId] }),
  index("shift_evidence_attachment").on(t.attachmentId),
]);

export const updateAttachments = sqliteTable("update_attachments", {
  updateId: text("update_id").notNull().references(() => customerUpdates.id),
  attachmentId: text("attachment_id").notNull().references(() => attachments.id),
}, (t) => [
  primaryKey({ columns: [t.updateId, t.attachmentId] }),
  index("update_attachments_attachment").on(t.attachmentId),
]);

export const quoteAttachments = sqliteTable("quote_attachments", {
  quoteVersionId: text("quote_version_id").notNull().references(() => quoteVersions.id),
  attachmentId: text("attachment_id").notNull().references(() => attachments.id),
}, (t) => [
  primaryKey({ columns: [t.quoteVersionId, t.attachmentId] }),
  index("quote_attachments_attachment").on(t.attachmentId),
]);

export const changeAttachments = sqliteTable("change_attachments", {
  changeVersionId: text("change_version_id").notNull().references(() => changeVersions.id),
  attachmentId: text("attachment_id").notNull().references(() => attachments.id),
}, (t) => [
  primaryKey({ columns: [t.changeVersionId, t.attachmentId] }),
  index("change_attachments_attachment").on(t.attachmentId),
]);

export const completionAttachments = sqliteTable("completion_attachments", {
  completionId: text("completion_id").notNull(),
  completionItemId: text("completion_item_id").notNull(),
  attachmentId: text("attachment_id").notNull().references(() => attachments.id),
  caption: text(),
  captionLanguage: text("caption_language"),
}, (t) => [
  primaryKey({ columns: [t.completionId, t.completionItemId, t.attachmentId] }),
  foreignKey({ columns: [t.completionItemId, t.completionId], foreignColumns: [completionItems.id, completionItems.completionId] }),
  index("completion_attachments_attachment").on(t.attachmentId),
  check("completion_attachments_caption", sql`(${t.caption} IS NULL) = (${t.captionLanguage} IS NULL)
    AND (${t.caption} IS NULL OR length(trim(${t.caption}, char(9, 10, 11, 12, 13, 32))) > 0)`),
]);

export const caseAttachments = sqliteTable("case_attachments", {
  caseId: text("case_id").notNull(),
  caseEventId: text("case_event_id").notNull(),
  attachmentId: text("attachment_id").notNull().references(() => attachments.id),
}, (t) => [
  primaryKey({ columns: [t.caseId, t.caseEventId, t.attachmentId] }),
  foreignKey({ columns: [t.caseEventId, t.caseId], foreignColumns: [caseEvents.id, caseEvents.caseId] }),
  index("case_attachments_attachment").on(t.attachmentId),
]);

// The purpose view and the close/share trigger logic live in 0011_evidence.sql.
export const jobMediaDeadlines = sqliteTable("job_media_deadlines", {
  jobId: text("job_id").notNull().references(() => jobs.id),
  attachmentId: text("attachment_id").notNull().references(() => attachments.id),
  purpose: text({ enum: ["progress", "ordinary"] }).notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [
  check("job_media_deadlines_purpose", sql`${t.purpose} IN ('progress', 'ordinary')`),
  check("job_media_deadlines_expiry", sql`typeof(${t.expiresAt}) = 'integer'`),
  primaryKey({ columns: [t.jobId, t.attachmentId, t.purpose] }),
  index("job_media_deadlines_attachment").on(t.attachmentId, t.expiresAt),
]);

export const retentionHolds = sqliteTable("retention_holds", {
  id: text().notNull().primaryKey(),
  recordKind: text("record_kind").notNull(),
  recordId: text("record_id").notNull(),
  reason: text().notNull(),
  reviewAt: integer("review_at").notNull(),
  releasedAt: integer("released_at"),
}, (t) => [
  check("retention_holds_record_kind", sql`length(${t.recordKind}) > 0`),
  check("retention_holds_record_id", sql`length(${t.recordId}) > 0`),
  check("retention_holds_reason", sql`length(trim(${t.reason})) > 0`),
  check("retention_holds_review_at", sql`typeof(${t.reviewAt}) = 'integer'`),
  check("retention_holds_released_at", sql`${t.releasedAt} IS NULL OR typeof(${t.releasedAt}) = 'integer'`),
  index("retention_holds_record").on(t.recordKind, t.recordId).where(sql`${t.releasedAt} IS NULL`),
  index("retention_holds_review").on(t.reviewAt, t.id).where(sql`${t.releasedAt} IS NULL`),
]);
