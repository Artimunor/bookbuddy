import {
  ATTENDANCE_CORRECTION_REASONS, ATTENDANCE_CORRECTION_STATES, ATTENDANCE_KINDS, ATTENDANCE_REASON_CODES,
  ATTENDANCE_REVIEW_STATES, ATTENDANCE_SOURCES, CUSTOMER_UPDATE_KINDS, SAFETY_HOLD_KINDS, SAFETY_HOLD_STATES,
  TEACH_BACK_OUTCOMES, VISIT_ACTIVITY_KINDS,
} from "@bookbuddy/domain";
import type { TeachBackChecklist } from "@bookbuddy/domain";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { accounts } from "./identity";
import { jobs } from "./jobs";
import { visits } from "./schedule";
import { assignments } from "./staffing";

// SQL-only triggers in 0008 enforce append semantics and cross-row guards.
export const attendanceEvents = sqliteTable("attendance_events", {
  id: text().notNull().primaryKey(),
  assignmentId: text("assignment_id").notNull().references(() => assignments.id),
  actorId: text("actor_id").notNull().references(() => accounts.id),
  kind: text({ enum: ATTENDANCE_KINDS }).notNull(),
  source: text({ enum: ATTENDANCE_SOURCES }).notNull(),
  actualAt: integer("actual_at").notNull(),
  capturedAt: integer("captured_at").notNull(),
  receivedAt: integer("received_at").notNull(),
  reviewState: text("review_state", { enum: ATTENDANCE_REVIEW_STATES }).notNull(),
  correctsId: text("corrects_id"),
  reasonCode: text("reason_code", { enum: ATTENDANCE_REASON_CODES }),
}, (t) => [
  check("attendance_events_kind", sql`${t.kind} IN ('arrival', 'departure')`),
  check("attendance_events_source", sql`${t.source} IN ('self', 'assisted', 'manual')`),
  check("attendance_events_times", sql`typeof(${t.actualAt}) = 'integer' AND typeof(${t.capturedAt}) = 'integer' AND typeof(${t.receivedAt}) = 'integer'`),
  check("attendance_events_state", sql`${t.reviewState} IN ('accepted', 'needs_review')`),
  check("attendance_events_reason", sql`${t.reasonCode} IN ('out_of_window', 'duplicate_event', 'missing_arrival', 'out_of_order', 'disputed', 'correction') OR ${t.reasonCode} IS NULL`),
  unique().on(t.assignmentId, t.id),
  foreignKey({ columns: [t.assignmentId, t.correctsId], foreignColumns: [t.assignmentId, t.id] }),
  uniqueIndex("attendance_events_one_original").on(t.assignmentId, t.kind).where(sql`${t.reviewState} = 'accepted' AND ${t.correctsId} IS NULL`),
  uniqueIndex("attendance_events_accepted_successor").on(t.correctsId).where(sql`${t.reviewState} = 'accepted' AND ${t.correctsId} IS NOT NULL`),
  index("attendance_events_assignment_time").on(t.assignmentId, t.actualAt, t.id),
  index("attendance_events_corrects").on(t.assignmentId, t.correctsId).where(sql`${t.correctsId} IS NOT NULL`),
]);

export const attendanceCorrectionRequests = sqliteTable("attendance_correction_requests", {
  id: text().notNull().primaryKey(),
  assignmentId: text("assignment_id").notNull(),
  attendanceEventId: text("attendance_event_id").notNull(),
  requesterId: text("requester_id").notNull().references(() => accounts.id),
  reasonCode: text("reason_code", { enum: ATTENDANCE_CORRECTION_REASONS }).notNull(),
  proposedActualAt: integer("proposed_actual_at"),
  requestedAt: integer("requested_at").notNull(),
  state: text({ enum: ATTENDANCE_CORRECTION_STATES }).notNull(),
  decidedBy: text("decided_by").references(() => accounts.id),
  decidedAt: integer("decided_at"),
  correctionEventId: text("correction_event_id"),
}, (t) => [
  check("attendance_correction_requests_reason", sql`${t.reasonCode} IN ('wrong_time', 'disputed')`),
  check("attendance_correction_requests_times", sql`typeof(${t.requestedAt}) = 'integer'
    AND (${t.proposedActualAt} IS NULL OR typeof(${t.proposedActualAt}) = 'integer')
    AND (${t.reasonCode} <> 'wrong_time' OR ${t.proposedActualAt} IS NOT NULL)`),
  check("attendance_correction_requests_state", sql`${t.state} IN ('requested', 'accepted', 'declined', 'withdrawn')`),
  check("attendance_correction_requests_decision", sql`
    (${t.state} = 'requested' AND ${t.decidedBy} IS NULL AND ${t.decidedAt} IS NULL
      OR ${t.state} <> 'requested' AND ${t.decidedBy} IS NOT NULL AND typeof(${t.decidedAt}) = 'integer' AND ${t.decidedAt} >= ${t.requestedAt})
    AND (${t.state} = 'accepted') = (${t.correctionEventId} IS NOT NULL)
    AND (${t.correctionEventId} IS NULL OR ${t.correctionEventId} <> ${t.attendanceEventId})`),
  foreignKey({ columns: [t.assignmentId, t.attendanceEventId], foreignColumns: [attendanceEvents.assignmentId, attendanceEvents.id] }),
  foreignKey({ columns: [t.assignmentId, t.correctionEventId], foreignColumns: [attendanceEvents.assignmentId, attendanceEvents.id] }),
  index("attendance_correction_requests_event").on(t.assignmentId, t.attendanceEventId, t.state, t.id),
  index("attendance_correction_requests_requester").on(t.requesterId, t.state, t.requestedAt, t.id),
  index("attendance_correction_requests_correction").on(t.assignmentId, t.correctionEventId).where(sql`${t.correctionEventId} IS NOT NULL`),
]);

export const customerUpdates = sqliteTable("customer_updates", {
  id: text().notNull().primaryKey(),
  visitId: text("visit_id").notNull().references(() => visits.id),
  actorId: text("actor_id").references(() => accounts.id),
  kind: text({ enum: CUSTOMER_UPDATE_KINDS }).notNull(),
  bandStart: integer("band_start"),
  bandEnd: integer("band_end"),
  nextUpdateAt: integer("next_update_at"),
  correctsId: text("corrects_id"),
  caption: text(),
  captionLanguage: text("caption_language"),
  occurredAt: integer("occurred_at"),
  recordedAt: integer("recorded_at").notNull(),
}, (t) => [
  check("customer_updates_kind", sql`${t.kind} IN (
    'crew_confirmed', 'on_the_way', 'arrival_revised', 'arrival_withdrawn', 'on_site', 'working',
    'paused', 'photo', 'cover_arranging', 'crew_updated', 'finished'
  )`),
  check("customer_updates_attribution", sql`(${t.kind} = 'on_site' AND ${t.actorId} IS NULL AND typeof(${t.occurredAt}) = 'integer')
    OR (${t.kind} <> 'on_site' AND ${t.actorId} IS NOT NULL AND ${t.occurredAt} IS NULL)`),
  check("customer_updates_times", sql`typeof(${t.recordedAt}) = 'integer'
    AND (${t.nextUpdateAt} IS NULL OR (${t.kind} IN ('paused', 'cover_arranging') AND typeof(${t.nextUpdateAt}) = 'integer'))
    AND (${t.kind} IN ('on_the_way', 'arrival_revised') AND typeof(${t.bandStart}) = 'integer' AND typeof(${t.bandEnd}) = 'integer' AND ${t.bandStart} < ${t.bandEnd}
      OR ${t.kind} NOT IN ('on_the_way', 'arrival_revised') AND ${t.bandStart} IS NULL AND ${t.bandEnd} IS NULL)`),
  check("customer_updates_correction", sql`(${t.kind} IN ('arrival_revised', 'arrival_withdrawn')) = (${t.correctsId} IS NOT NULL)`),
  check("customer_updates_caption", sql`(${t.caption} IS NULL AND ${t.captionLanguage} IS NULL)
    OR (${t.kind} = 'photo' AND ${t.caption} IS NOT NULL AND ${t.captionLanguage} IS NOT NULL)`),
  unique().on(t.visitId, t.id),
  foreignKey({ columns: [t.visitId, t.correctsId], foreignColumns: [t.visitId, t.id] }),
  index("customer_updates_visit_time").on(t.visitId, t.recordedAt, t.id),
  uniqueIndex("customer_updates_one_on_site").on(t.visitId).where(sql`${t.kind} = 'on_site'`),
  uniqueIndex("customer_updates_one_successor").on(t.visitId, t.correctsId).where(sql`${t.correctsId} IS NOT NULL`),
]);

export const visitActivityEvents = sqliteTable("visit_activity_events", {
  id: text().notNull().primaryKey(),
  visitId: text("visit_id").notNull().references(() => visits.id),
  assignmentId: text("assignment_id").references(() => assignments.id),
  actorId: text("actor_id").notNull().references(() => accounts.id),
  kind: text({ enum: VISIT_ACTIVITY_KINDS }).notNull(),
  at: integer().notNull(),
  capturedAt: integer("captured_at"),
  bandStart: integer("band_start"),
  bandEnd: integer("band_end"),
  safeDetail: text("safe_detail"),
  detailLanguage: text("detail_language"),
  customerUpdateId: text("customer_update_id"),
}, (t) => [
  check("visit_activity_events_kind", sql`${t.kind} IN ('setting_off', 'work_started', 'work_paused', 'work_finished', 'progress_photo', 'arrival_plan_set')`),
  check("visit_activity_events_times", sql`typeof(${t.at}) = 'integer' AND (
    ${t.kind} = 'setting_off' AND typeof(${t.bandStart}) = 'integer' AND typeof(${t.bandEnd}) = 'integer' AND ${t.bandStart} < ${t.bandEnd}
    OR ${t.kind} <> 'setting_off' AND ${t.bandStart} IS NULL AND ${t.bandEnd} IS NULL
  )`),
  check("visit_activity_events_capture", sql`(${t.kind} = 'progress_photo' AND typeof(${t.capturedAt}) = 'integer')
    OR (${t.kind} <> 'progress_photo' AND ${t.capturedAt} IS NULL)`),
  check("visit_activity_events_assignment", sql`${t.kind} NOT IN ('setting_off', 'progress_photo') OR ${t.assignmentId} IS NOT NULL`),
  check("visit_activity_events_detail_language", sql`(${t.detailLanguage} IS NULL OR ${t.safeDetail} IS NOT NULL)
    AND (${t.kind} <> 'arrival_plan_set' OR (${t.safeDetail} IS NOT NULL AND ${t.detailLanguage} IS NOT NULL))`),
  foreignKey({ columns: [t.visitId, t.customerUpdateId], foreignColumns: [customerUpdates.visitId, customerUpdates.id] }),
  index("visit_activity_events_visit_time").on(t.visitId, t.at, t.id),
  index("visit_activity_events_assignment_time").on(t.assignmentId, t.at, t.id).where(sql`${t.assignmentId} IS NOT NULL`),
  index("visit_activity_events_customer_update").on(t.visitId, t.customerUpdateId).where(sql`${t.customerUpdateId} IS NOT NULL`),
]);

export const safetyInstructions = sqliteTable("safety_instructions", {
  id: text().notNull().primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id),
  assignmentId: text("assignment_id").notNull().unique().references(() => assignments.id),
}, (t) => [index("safety_instructions_job").on(t.jobId, t.id)]);

export const safetyVersions = sqliteTable("safety_versions", {
  id: text().notNull().primaryKey(),
  instructionId: text("instruction_id").notNull().references(() => safetyInstructions.id),
  no: integer().notNull(),
  issuerId: text("issuer_id").notNull().references(() => accounts.id),
  original: text().notNull(),
  language: text().notNull(),
  reviewedHumanReadingAid: text("reviewed_human_reading_aid"),
  readingAidLanguage: text("reading_aid_language"),
  issuedAt: integer("issued_at").notNull(),
}, (t) => [
  check("safety_versions_order", sql`typeof(${t.no}) = 'integer' AND ${t.no} > 0 AND typeof(${t.issuedAt}) = 'integer'`),
  check("safety_versions_reading_aid", sql`(${t.reviewedHumanReadingAid} IS NULL) = (${t.readingAidLanguage} IS NULL)`),
  unique().on(t.instructionId, t.no),
]);

export const teachBacks = sqliteTable("teach_backs", {
  id: text().notNull().primaryKey(),
  versionId: text("version_id").notNull().references(() => safetyVersions.id),
  assignmentId: text("assignment_id").notNull().references(() => assignments.id),
  verifiedBy: text("verified_by").notNull().references(() => accounts.id),
  language: text().notNull(),
  interpreterRef: text("interpreter_ref"),
  checklist: text({ mode: "json" }).$type<TeachBackChecklist>().notNull(),
  outcome: text({ enum: TEACH_BACK_OUTCOMES }).notNull(),
  at: integer().notNull(),
}, (t) => [
  check("teach_backs_outcome", sql`${t.outcome} IN ('passed', 'not_understood')`),
  check("teach_backs_time", sql`typeof(${t.at}) = 'integer'`),
  check("teach_backs_checklist", sql`CASE WHEN json_valid(${t.checklist}) THEN
    COALESCE(json_type(${t.checklist}, '$.hazard') IN ('true', 'false')
      AND json_type(${t.checklist}, '$.control') IN ('true', 'false')
      AND json_type(${t.checklist}, '$.response') IN ('true', 'false')
      AND (${t.outcome} <> 'passed' OR (
        json_extract(${t.checklist}, '$.hazard') = 1 AND json_extract(${t.checklist}, '$.control') = 1 AND json_extract(${t.checklist}, '$.response') = 1
      )), 0) ELSE 0 END`),
  unique().on(t.versionId, t.assignmentId, t.id),
  index("teach_backs_latest").on(t.versionId, t.assignmentId, t.at, t.id),
  index("teach_backs_assignment").on(t.assignmentId, t.at, t.id),
]);

export const safetyAcknowledgements = sqliteTable("safety_acknowledgements", {
  versionId: text("version_id").notNull(),
  assignmentId: text("assignment_id").notNull(),
  workerId: text("worker_id").notNull().references(() => accounts.id),
  teachBackId: text("teach_back_id").notNull(),
  at: integer().notNull(),
}, (t) => [
  check("safety_acknowledgements_time", sql`typeof(${t.at}) = 'integer'`),
  primaryKey({ columns: [t.versionId, t.assignmentId] }),
  foreignKey({ columns: [t.versionId, t.assignmentId, t.teachBackId], foreignColumns: [teachBacks.versionId, teachBacks.assignmentId, teachBacks.id] }),
  index("safety_acknowledgements_assignment").on(t.assignmentId, t.at, t.versionId),
]);

export const safetyHolds = sqliteTable("safety_holds", {
  id: text().notNull().primaryKey(),
  assignmentId: text("assignment_id").notNull().references(() => assignments.id),
  versionId: text("version_id").references(() => safetyVersions.id),
  kind: text({ enum: SAFETY_HOLD_KINDS }).notNull(),
  state: text({ enum: SAFETY_HOLD_STATES }).notNull(),
  clearedAt: integer("cleared_at"),
}, (t) => [
  check("safety_holds_kind", sql`${t.kind} IN ('briefing', 'work_rule', 'incident')`),
  check("safety_holds_state", sql`${t.state} IN ('active', 'cleared')`),
  check("safety_holds_clearance", sql`(${t.state} = 'active' AND ${t.clearedAt} IS NULL)
    OR (${t.state} = 'cleared' AND typeof(${t.clearedAt}) = 'integer')`),
  index("safety_holds_assignment").on(t.assignmentId, t.id),
  index("safety_holds_version").on(t.versionId).where(sql`${t.versionId} IS NOT NULL`),
  index("safety_holds_active").on(t.assignmentId, t.kind, t.versionId, t.id).where(sql`${t.state} = 'active'`),
]);

export const safetyQuestions = sqliteTable("safety_questions", {
  id: text().notNull().primaryKey(),
  versionId: text("version_id").notNull().references(() => safetyVersions.id),
  workerId: text("worker_id").notNull().references(() => accounts.id),
  original: text().notNull(),
  language: text().notNull(),
  askedAt: integer("asked_at").notNull(),
}, (t) => [
  check("safety_questions_time", sql`typeof(${t.askedAt}) = 'integer'`),
  index("safety_questions_version_time").on(t.versionId, t.askedAt, t.id),
]);
