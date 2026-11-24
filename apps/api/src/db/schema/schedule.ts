import {
  AVAILABILITY_KINDS, AVAILABILITY_SOURCES, RESCHEDULE_REQUEST_STATES, SHIFT_STATES,
  VISIT_KINDS, VISIT_STATES, VISIT_WINDOW_STATES,
} from "@bookbuddy/domain";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { memberships } from "./access";
import { accounts } from "./identity";
import { jobs } from "./jobs";

export const visits = sqliteTable("visits", {
  id: text().notNull().primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id),
  kind: text({ enum: VISIT_KINDS }).notNull(),
  state: text({ enum: VISIT_STATES }).notNull(),
  revision: integer().notNull().default(0),
  cancelledAt: integer("cancelled_at"),
  cancelledBy: text("cancelled_by").references(() => accounts.id),
}, (t) => [
  check("visits_kind", sql`${t.kind} IN ('assessment', 'work')`),
  check("visits_state", sql`${t.state} IN ('planned', 'booked', 'cancelled', 'finished')`),
  check("visits_revision", sql`typeof(${t.revision}) = 'integer' AND ${t.revision} >= 0`),
  check("visits_cancellation", sql`(${t.state} = 'cancelled' AND typeof(${t.cancelledAt}) = 'integer' AND ${t.cancelledBy} IS NOT NULL)
    OR (${t.state} <> 'cancelled' AND ${t.cancelledAt} IS NULL AND ${t.cancelledBy} IS NULL)`),
  index("visits_job_state").on(t.jobId, t.state, t.id),
]);

export const rescheduleRequests = sqliteTable("reschedule_requests", {
  id: text().notNull().primaryKey(),
  visitId: text("visit_id").notNull().references(() => visits.id),
  requesterId: text("requester_id").notNull().references(() => accounts.id),
  state: text({ enum: RESCHEDULE_REQUEST_STATES }).notNull(),
  requestedAt: integer("requested_at").notNull(),
  replyBy: integer("reply_by").notNull(),
}, (t) => [
  check("reschedule_requests_state", sql`${t.state} IN ('requested', 'proposed', 'accepted', 'declined', 'withdrawn')`),
  check("reschedule_requests_reply", sql`typeof(${t.requestedAt}) = 'integer' AND typeof(${t.replyBy}) = 'integer' AND ${t.replyBy} >= ${t.requestedAt}`),
  unique().on(t.visitId, t.id),
  index("reschedule_requests_visit_state").on(t.visitId, t.state, t.requestedAt, t.id),
  index("reschedule_requests_due").on(t.replyBy, t.id).where(sql`${t.state} = 'requested'`),
]);

export const visitWindows = sqliteTable("visit_windows", {
  id: text().notNull().primaryKey(),
  visitId: text("visit_id").notNull().references(() => visits.id),
  replacesWindowId: text("replaces_window_id"),
  rescheduleRequestId: text("reschedule_request_id"),
  startsAt: integer("starts_at").notNull(),
  endsAt: integer("ends_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  providerAuthorized: integer("provider_authorized", { mode: "boolean" }).notNull(),
  proposedAt: integer("proposed_at").notNull(),
  proposedBy: text("proposed_by").notNull().references(() => accounts.id),
  confirmedAt: integer("confirmed_at"),
  confirmedBy: text("confirmed_by").references(() => accounts.id),
  state: text({ enum: VISIT_WINDOW_STATES }).notNull(),
}, (t) => [
  check("visit_windows_state", sql`${t.state} IN ('proposed', 'confirmed', 'withdrawn', 'superseded', 'cancelled')`),
  check("visit_windows_times", sql`typeof(${t.proposedAt}) = 'integer' AND typeof(${t.startsAt}) = 'integer'
    AND typeof(${t.endsAt}) = 'integer' AND typeof(${t.expiresAt}) = 'integer'
    AND ${t.proposedAt} < ${t.expiresAt} AND ${t.expiresAt} <= ${t.startsAt} AND ${t.startsAt} < ${t.endsAt}`),
  check("visit_windows_authorization", sql`typeof(${t.providerAuthorized}) = 'integer' AND ${t.providerAuthorized} IN (0, 1)`),
  check("visit_windows_confirmation", sql`
    (${t.confirmedAt} IS NULL AND ${t.confirmedBy} IS NULL AND ${t.state} NOT IN ('confirmed', 'superseded'))
    OR (typeof(${t.confirmedAt}) = 'integer' AND ${t.confirmedBy} IS NOT NULL AND ${t.providerAuthorized} = 1
      AND ${t.proposedAt} <= ${t.confirmedAt} AND ${t.confirmedAt} < ${t.expiresAt}
      AND ${t.state} IN ('confirmed', 'superseded', 'cancelled'))`),
  check("visit_windows_replacement", sql`${t.replacesWindowId} IS NULL OR ${t.replacesWindowId} <> ${t.id}`),
  unique().on(t.visitId, t.id),
  foreignKey({ columns: [t.visitId, t.replacesWindowId], foreignColumns: [t.visitId, t.id] }),
  foreignKey({ columns: [t.visitId, t.rescheduleRequestId], foreignColumns: [rescheduleRequests.visitId, rescheduleRequests.id] }),
  uniqueIndex("visit_windows_one_confirmed").on(t.visitId).where(sql`${t.state} = 'confirmed'`),
  index("visit_windows_visit_start").on(t.visitId, t.startsAt, t.id),
  index("visit_windows_due").on(t.expiresAt, t.id).where(sql`${t.state} = 'proposed'`),
  index("visit_windows_replaces").on(t.visitId, t.replacesWindowId).where(sql`${t.replacesWindowId} IS NOT NULL`),
  index("visit_windows_request").on(t.visitId, t.rescheduleRequestId).where(sql`${t.rescheduleRequestId} IS NOT NULL`),
]);

export const shifts = sqliteTable("shifts", {
  id: text().notNull().primaryKey(),
  visitId: text("visit_id").notNull().references(() => visits.id),
  startsAt: integer("starts_at").notNull(),
  endsAt: integer("ends_at").notNull(),
  skill: text().notNull(),
  briefingLanguage: text("briefing_language").notNull(),
  state: text({ enum: SHIFT_STATES }).notNull(),
}, (t) => [
  check("shifts_times", sql`typeof(${t.startsAt}) = 'integer' AND typeof(${t.endsAt}) = 'integer' AND ${t.startsAt} < ${t.endsAt}`),
  check("shifts_state", sql`${t.state} IN ('planned', 'active', 'finished', 'cancelled')`),
  index("shifts_visit_start").on(t.visitId, t.startsAt, t.id),
]);

export const shiftSlots = sqliteTable("shift_slots", {
  id: text().notNull().primaryKey(),
  shiftId: text("shift_id").notNull().references(() => shifts.id),
  number: integer().notNull(),
  isLead: integer("is_lead", { mode: "boolean" }).notNull().default(false),
}, (t) => [
  check("shift_slots_number", sql`typeof(${t.number}) = 'integer' AND ${t.number} >= 1`),
  check("shift_slots_lead", sql`typeof(${t.isLead}) = 'integer' AND ${t.isLead} IN (0, 1)`),
  unique().on(t.shiftId, t.number),
  uniqueIndex("shift_slots_one_lead").on(t.shiftId).where(sql`${t.isLead} = 1`),
]);

export const availabilityIntervals = sqliteTable("availability_intervals", {
  id: text().notNull().primaryKey(),
  membershipId: text("membership_id").notNull().references(() => memberships.id),
  weekDayOrDate: text("week_day_or_date").notNull(),
  startsAt: integer("starts_at"),
  endsAt: integer("ends_at"),
  startsOffsetMs: integer("starts_offset_ms"),
  endsOffsetMs: integer("ends_offset_ms"),
  kind: text({ enum: AVAILABILITY_KINDS }).notNull(),
  source: text({ enum: AVAILABILITY_SOURCES }).notNull(),
  openToCover: integer("open_to_cover", { mode: "boolean" }).notNull().default(false),
  recordedBy: text("recorded_by").notNull().references(() => accounts.id),
  recordedAt: integer("recorded_at").notNull(),
  revision: integer().notNull().default(0),
}, (t) => [
  check("availability_intervals_kind", sql`${t.kind} IN ('available', 'unavailable', 'duty')`),
  check("availability_intervals_source", sql`${t.source} IN ('worker', 'employer') AND (${t.kind} <> 'duty' OR ${t.source} = 'employer')`),
  check("availability_intervals_cover", sql`typeof(${t.openToCover}) = 'integer' AND ${t.openToCover} IN (0, 1)
    AND (${t.openToCover} = 0 OR ${t.kind} = 'available')`),
  check("availability_intervals_record", sql`typeof(${t.recordedAt}) = 'integer' AND typeof(${t.revision}) = 'integer' AND ${t.revision} >= 0`),
  check("availability_intervals_period", sql`
    (${t.weekDayOrDate} IN ('1', '2', '3', '4', '5', '6', '7')
      AND ${t.startsAt} IS NULL AND ${t.endsAt} IS NULL
      AND typeof(${t.startsOffsetMs}) = 'integer' AND typeof(${t.endsOffsetMs}) = 'integer'
      AND 0 <= ${t.startsOffsetMs} AND ${t.startsOffsetMs} < ${t.endsOffsetMs} AND ${t.endsOffsetMs} <= 86400000)
    OR (${t.weekDayOrDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(${t.weekDayOrDate}, '+0 days') IS ${t.weekDayOrDate}
      AND typeof(${t.startsAt}) = 'integer' AND typeof(${t.endsAt}) = 'integer' AND ${t.startsAt} < ${t.endsAt}
      AND ${t.startsOffsetMs} IS NULL AND ${t.endsOffsetMs} IS NULL)`),
  index("availability_intervals_member_day").on(t.membershipId, t.weekDayOrDate, t.startsAt, t.id),
]);
