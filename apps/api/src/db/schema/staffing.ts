import {
  ASSIGNMENT_OFFER_STATES, ASSIGNMENT_SOURCES, ASSIGNMENT_STATES, COVER_DISPATCH_STATES, COVER_GAP_STATES,
  COVER_OFFER_STATES, COVER_ROUND_STATES, DROPOUT_REASONS, DROPOUT_SOURCES, OFFER_DECLINE_REASONS,
} from "@bookbuddy/domain";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { SQLiteTableExtraConfigValue } from "drizzle-orm/sqlite-core";
import { memberships } from "./access";
import { accounts } from "./identity";
import { shiftSlots, visitWindows } from "./schedule";

export const assignments = sqliteTable("assignments", {
  id: text().notNull().primaryKey(),
  slotId: text("slot_id").notNull().references(() => shiftSlots.id),
  workerMembershipId: text("worker_membership_id").notNull().references(() => memberships.id),
  coverGapId: text("cover_gap_id"),
  source: text({ enum: ASSIGNMENT_SOURCES }).notNull(),
  state: text({ enum: ASSIGNMENT_STATES }).notNull(),
  confirmedBy: text("confirmed_by").notNull().references(() => accounts.id),
  confirmedAt: integer("confirmed_at").notNull(),
  startsAt: integer("starts_at").notNull(),
  endsAt: integer("ends_at").notNull(),
  droppedAt: integer("dropped_at"),
  dropoutReportedBy: text("dropout_reported_by").references(() => accounts.id),
  dropoutSource: text("dropout_source", { enum: DROPOUT_SOURCES }),
  dropoutReason: text("dropout_reason", { enum: DROPOUT_REASONS }),
}, (t): SQLiteTableExtraConfigValue[] => [
  check("assignments_state", sql`${t.state} IN ('confirmed', 'dropped', 'released', 'completed')`),
  check("assignments_source", sql`(${t.source} = 'ordinary' AND ${t.coverGapId} IS NULL)
    OR (${t.source} = 'cover' AND ${t.coverGapId} IS NOT NULL)`),
  check("assignments_times", sql`typeof(${t.confirmedAt}) = 'integer' AND typeof(${t.startsAt}) = 'integer'
    AND typeof(${t.endsAt}) = 'integer' AND ${t.startsAt} < ${t.endsAt}`),
  check("assignments_dropout", sql`(${t.state} = 'dropped' AND typeof(${t.droppedAt}) = 'integer' AND ${t.droppedAt} >= ${t.confirmedAt}
    AND ${t.dropoutReportedBy} IS NOT NULL AND ${t.dropoutSource} IS NOT NULL AND ${t.dropoutSource} IN ('self', 'phone_report')
    AND (${t.dropoutReason} IS NULL OR ${t.dropoutReason} IN ('transport', 'another_job', 'personal')))
    OR (${t.state} <> 'dropped' AND ${t.droppedAt} IS NULL AND ${t.dropoutReportedBy} IS NULL
      AND ${t.dropoutSource} IS NULL AND ${t.dropoutReason} IS NULL)`),
  unique().on(t.slotId, t.id),
  foreignKey({ columns: [t.slotId, t.coverGapId], foreignColumns: [coverGaps.slotId, coverGaps.id] }),
  uniqueIndex("assignments_one_live_slot").on(t.slotId).where(sql`${t.state} = 'confirmed'`),
  uniqueIndex("assignments_one_cover_gap").on(t.coverGapId).where(sql`${t.coverGapId} IS NOT NULL`),
  index("assignments_worker_active_interval").on(t.workerMembershipId, t.startsAt, t.endsAt, t.id).where(sql`${t.state} = 'confirmed'`),
]);

export const assignmentOffers = sqliteTable("assignment_offers", {
  id: text().notNull().primaryKey(),
  slotId: text("slot_id").notNull().references(() => shiftSlots.id),
  recipientId: text("recipient_id").notNull().references(() => memberships.id),
  issuedBy: text("issued_by").notNull().references(() => accounts.id),
  issuedAt: integer("issued_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  state: text({ enum: ASSIGNMENT_OFFER_STATES }).notNull(),
  resolvedAt: integer("resolved_at"),
  assignmentId: text("assignment_id").unique(),
  declineReason: text("decline_reason", { enum: OFFER_DECLINE_REASONS }),
}, (t) => [
  check("assignment_offers_state", sql`${t.state} IN ('offered', 'confirmed', 'declined', 'withdrawn', 'expired')`),
  check("assignment_offers_times", sql`typeof(${t.issuedAt}) = 'integer' AND typeof(${t.expiresAt}) = 'integer' AND ${t.issuedAt} < ${t.expiresAt}
    AND ((${t.state} = 'offered' AND ${t.resolvedAt} IS NULL)
      OR (${t.state} <> 'offered' AND typeof(${t.resolvedAt}) = 'integer' AND ${t.issuedAt} <= ${t.resolvedAt}
        AND (${t.state} = 'expired') = (${t.resolvedAt} >= ${t.expiresAt})) )`),
  check("assignment_offers_assignment", sql`(${t.state} = 'confirmed') = (${t.assignmentId} IS NOT NULL)`),
  check("assignment_offers_decline_reason", sql`${t.declineReason} IS NULL
    OR (${t.state} = 'declined' AND ${t.declineReason} IN ('busy_then', 'too_far_away'))`),
  foreignKey({ columns: [t.slotId, t.assignmentId], foreignColumns: [assignments.slotId, assignments.id] }),
  uniqueIndex("assignment_offers_one_live_slot").on(t.slotId).where(sql`${t.state} = 'offered'`),
  index("assignment_offers_slot_issued").on(t.slotId, t.issuedAt, t.id),
  index("assignment_offers_recipient_state").on(t.recipientId, t.state, t.expiresAt, t.id),
  index("assignment_offers_due").on(t.expiresAt, t.id).where(sql`${t.state} = 'offered'`),
]);

export const coverGaps = sqliteTable("cover_gaps", {
  id: text().notNull().primaryKey(),
  slotId: text("slot_id").notNull().references(() => shiftSlots.id),
  priorAssignmentId: text("prior_assignment_id").notNull().unique(),
  safeCutoff: integer("safe_cutoff").notNull(),
  currentRoundNo: integer("current_round_no"),
  state: text({ enum: COVER_GAP_STATES }).notNull(),
  revision: integer().notNull().default(0),
  closedAt: integer("closed_at"),
  revisedWindowId: text("revised_window_id").references(() => visitWindows.id),
}, (t): SQLiteTableExtraConfigValue[] => [
  check("cover_gaps_state", sql`${t.state} IN ('open', 'accepted_pending_confirmation', 'filled', 'closed')`),
  check("cover_gaps_revision", sql`typeof(${t.revision}) = 'integer' AND ${t.revision} >= 0`),
  check("cover_gaps_cutoff", sql`typeof(${t.safeCutoff}) = 'integer'`),
  check("cover_gaps_round", sql`${t.currentRoundNo} IS NOT NULL OR ${t.state} IN ('open', 'closed')`),
  check("cover_gaps_close", sql`(${t.state} = 'closed' AND typeof(${t.closedAt}) = 'integer')
    OR (${t.state} <> 'closed' AND ${t.closedAt} IS NULL AND ${t.revisedWindowId} IS NULL)`),
  unique().on(t.slotId, t.id),
  foreignKey({ columns: [t.slotId, t.priorAssignmentId], foreignColumns: [assignments.slotId, assignments.id] }),
  foreignKey({ columns: [t.id, t.currentRoundNo], foreignColumns: [coverRounds.gapId, coverRounds.roundNo] }),
  uniqueIndex("cover_gaps_one_open_slot").on(t.slotId).where(sql`${t.state} IN ('open', 'accepted_pending_confirmation')`),
  index("cover_gaps_due").on(t.safeCutoff, t.id).where(sql`${t.state} IN ('open', 'accepted_pending_confirmation')`),
]);

export const coverDispatches = sqliteTable("cover_dispatches", {
  gapId: text("gap_id").notNull().references(() => coverGaps.id),
  dispatchNo: integer("dispatch_no").notNull(),
  issuedBy: text("issued_by").notNull().references(() => accounts.id),
  issuedAt: integer("issued_at").notNull(),
  replyUntil: integer("reply_until").notNull(),
  state: text({ enum: COVER_DISPATCH_STATES }).notNull(),
  closedAt: integer("closed_at"),
}, (t) => [
  primaryKey({ columns: [t.gapId, t.dispatchNo] }),
  check("cover_dispatches_number", sql`typeof(${t.dispatchNo}) = 'integer' AND ${t.dispatchNo} BETWEEN 1 AND 2`),
  check("cover_dispatches_reply", sql`typeof(${t.issuedAt}) = 'integer' AND typeof(${t.replyUntil}) = 'integer'
    AND ${t.replyUntil} - ${t.issuedAt} BETWEEN 300000 AND 900000`),
  check("cover_dispatches_state", sql`(${t.state} = 'open' AND ${t.closedAt} IS NULL)
    OR (${t.state} = 'closed' AND typeof(${t.closedAt}) = 'integer' AND ${t.issuedAt} <= ${t.closedAt})`),
  uniqueIndex("cover_dispatches_one_open").on(t.gapId).where(sql`${t.state} = 'open'`),
  index("cover_dispatches_due").on(t.replyUntil, t.gapId, t.dispatchNo).where(sql`${t.state} = 'open'`),
]);

export const coverOffers = sqliteTable("cover_offers", {
  id: text().notNull().primaryKey(),
  gapId: text("gap_id").notNull(),
  dispatchNo: integer("dispatch_no").notNull(),
  recipientId: text("recipient_id").notNull().references(() => memberships.id),
  expiresAt: integer("expires_at").notNull(),
  state: text({ enum: COVER_OFFER_STATES }).notNull(),
  respondedAt: integer("responded_at"),
  declineReason: text("decline_reason", { enum: OFFER_DECLINE_REASONS }),
}, (t) => [
  check("cover_offers_expiry", sql`typeof(${t.expiresAt}) = 'integer'`),
  check("cover_offers_state", sql`(${t.state} = 'offered' AND ${t.respondedAt} IS NULL)
    OR (${t.state} IN ('declined', 'withdrawn') AND typeof(${t.respondedAt}) = 'integer')`),
  check("cover_offers_decline_reason", sql`${t.declineReason} IS NULL
    OR (${t.state} = 'declined' AND ${t.declineReason} IN ('busy_then', 'too_far_away'))`),
  unique().on(t.gapId, t.dispatchNo, t.recipientId),
  unique().on(t.gapId, t.dispatchNo, t.id),
  foreignKey({ columns: [t.gapId, t.dispatchNo], foreignColumns: [coverDispatches.gapId, coverDispatches.dispatchNo] }),
  index("cover_offers_recipient_expiry").on(t.recipientId, t.expiresAt, t.id),
]);

// The migration also installs winner-immutability triggers; Drizzle has no trigger declaration.
export const coverRounds = sqliteTable("cover_rounds", {
  gapId: text("gap_id").notNull(),
  roundNo: integer("round_no").notNull(),
  dispatchNo: integer("dispatch_no").notNull(),
  state: text({ enum: COVER_ROUND_STATES }).notNull(),
  openedAt: integer("opened_at").notNull(),
  winnerOfferId: text("winner_offer_id"),
  acceptedAt: integer("accepted_at"),
  confirmBy: integer("confirm_by"),
  endedAt: integer("ended_at"),
}, (t): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [t.gapId, t.roundNo] }),
  check("cover_rounds_number", sql`typeof(${t.roundNo}) = 'integer' AND ${t.roundNo} >= 1`),
  check("cover_rounds_state", sql`${t.state} IN ('open', 'accepted_pending_confirmation', 'confirmed', 'closed')`),
  check("cover_rounds_winner", sql`(${t.winnerOfferId} IS NULL AND ${t.acceptedAt} IS NULL AND ${t.confirmBy} IS NULL AND ${t.state} IN ('open', 'closed'))
    OR (${t.winnerOfferId} IS NOT NULL AND ${t.state} <> 'open' AND typeof(${t.acceptedAt}) = 'integer' AND typeof(${t.confirmBy}) = 'integer'
      AND ${t.openedAt} <= ${t.acceptedAt} AND ${t.acceptedAt} < ${t.confirmBy} AND ${t.confirmBy} - ${t.acceptedAt} <= 300000)`),
  check("cover_rounds_times", sql`typeof(${t.openedAt}) = 'integer' AND (
    (${t.state} IN ('open', 'accepted_pending_confirmation') AND ${t.endedAt} IS NULL)
    OR (${t.state} IN ('closed', 'confirmed') AND typeof(${t.endedAt}) = 'integer'
      AND ${t.endedAt} >= coalesce(${t.acceptedAt}, ${t.openedAt}) AND (${t.state} = 'closed' OR ${t.endedAt} < ${t.confirmBy})))`),
  foreignKey({ columns: [t.gapId, t.dispatchNo], foreignColumns: [coverDispatches.gapId, coverDispatches.dispatchNo] }),
  foreignKey({ columns: [t.gapId, t.dispatchNo, t.winnerOfferId], foreignColumns: [coverOffers.gapId, coverOffers.dispatchNo, coverOffers.id] }),
  uniqueIndex("cover_rounds_one_live_gap").on(t.gapId).where(sql`${t.state} IN ('open', 'accepted_pending_confirmation')`),
  index("cover_rounds_dispatch").on(t.gapId, t.dispatchNo, t.roundNo),
  index("cover_rounds_winner_offer").on(t.gapId, t.dispatchNo, t.winnerOfferId).where(sql`${t.winnerOfferId} IS NOT NULL`),
  index("cover_rounds_due").on(t.confirmBy, t.gapId, t.roundNo).where(sql`${t.state} = 'accepted_pending_confirmation'`),
]);
