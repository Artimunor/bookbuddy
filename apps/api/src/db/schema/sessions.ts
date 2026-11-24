import {
  CURRENCIES, SESSIONS_FEATURE_FLAG, SESSION_ATTENDANCE_RESULTS, SESSION_BOOKING_STATES, SESSION_CHANGE_STATES,
  SESSION_DAY_STAGES, SESSION_FORMATS, SESSION_HOLD_STATES, SESSION_HOST_ASSIGNMENT_STATES, SESSION_PRICE_BASES,
  SESSION_SLOT_STATES, SESSION_VENUE_STATES,
} from "@bookbuddy/domain";
import { sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { businesses, memberships, operatingAreas } from "./access";
import { accounts } from "./identity";
import { featureFlags } from "./transport";

/** Compose into the scoped read/command, not a separate D1 call. Absence is false. */
export function sessionFeatureFlagPredicate(scopeKey: string | SQLWrapper) {
  return sql<boolean>`EXISTS (SELECT 1 FROM ${featureFlags} WHERE ${featureFlags.key} = ${SESSIONS_FEATURE_FLAG}
    AND ${featureFlags.scopeKey} = ${scopeKey} AND ${featureFlags.enabled} = 1)`.mapWith(Boolean);
}

// The handwritten migration also contains the snapshot, admission and append-only triggers.
export const venues = sqliteTable("venues", {
  id: text().notNull().primaryKey(),
  businessId: text("business_id").notNull().references(() => businesses.id),
  areaId: text("area_id").notNull(),
  siteZone: text("site_zone").notNull(),
  name: text().notNull(),
  locality: text().notNull(),
  address: text().notNull(),
  accessNote: text("access_note").notNull(),
  arrivalNote: text("arrival_note").notNull(),
  state: text({ enum: SESSION_VENUE_STATES }).notNull(),
  approvedAt: integer("approved_at"),
}, (t) => [
  check("venues_name", sql`length(trim(${t.name})) > 0`),
  check("venues_locality", sql`length(trim(${t.locality})) > 0`),
  check("venues_address", sql`length(trim(${t.address})) > 0`),
  check("venues_access_note", sql`length(trim(${t.accessNote})) > 0`),
  check("venues_arrival_note", sql`length(trim(${t.arrivalNote})) > 0`),
  check("venues_state", sql`${t.state} IN ('pending', 'approved', 'retired')`),
  check("venues_approval", sql`(${t.approvedAt} IS NULL OR typeof(${t.approvedAt}) = 'integer')
    AND (${t.state} <> 'approved' OR ${t.approvedAt} IS NOT NULL)`),
  foreignKey({ columns: [t.areaId, t.siteZone], foreignColumns: [operatingAreas.id, operatingAreas.siteZone] }),
  unique().on(t.id, t.businessId),
  index("venues_area_locality").on(t.areaId, t.locality, t.state, t.id),
  index("venues_business_state").on(t.businessId, t.state, t.id),
]);

export const sessionListings = sqliteTable("session_listings", {
  id: text().notNull().primaryKey(),
  businessId: text("business_id").notNull().references(() => businesses.id),
  category: text().notNull(),
  revision: integer().notNull().default(0),
}, (t) => [
  check("session_listings_category", sql`length(${t.category}) BETWEEN 1 AND 64 AND ${t.category} NOT GLOB '*[^a-z0-9_-]*'`),
  check("session_listings_revision", sql`typeof(${t.revision}) = 'integer' AND ${t.revision} >= 0`),
  unique().on(t.id, t.businessId),
  index("session_listings_business_category").on(t.businessId, t.category, t.id),
]);

export const sessionListingVersions = sqliteTable("session_listing_versions", {
  id: text().notNull().primaryKey(),
  listingId: text("listing_id").notNull(),
  businessId: text("business_id").notNull(),
  no: integer().notNull(),
  venueId: text("venue_id").notNull(),
  title: text().notNull(),
  description: text().notNull(),
  originalLocale: text("original_locale").notNull(),
  language: text().notNull(),
  format: text({ enum: SESSION_FORMATS }).notNull(),
  durationMs: integer("duration_ms").notNull(),
  guaranteedHostMembershipId: text("guaranteed_host_membership_id"),
  priceMinor: integer("price_minor").notNull(),
  currency: text({ enum: CURRENCIES }).notNull(),
  priceBasis: text("price_basis", { enum: SESSION_PRICE_BASES }).notNull(),
  termsText: text("terms_text").notNull(),
  termsLocale: text("terms_locale").notNull(),
  termsHash: text("terms_hash").notNull(),
  cancellationNoticeMs: integer("cancellation_notice_ms").notNull(),
  createdById: text("created_by_id").notNull().references(() => accounts.id),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  check("session_listing_versions_no", sql`typeof(${t.no}) = 'integer' AND ${t.no} > 0`),
  check("session_listing_versions_title", sql`length(trim(${t.title})) > 0`),
  check("session_listing_versions_description", sql`length(trim(${t.description})) > 0`),
  check("session_listing_versions_original_locale", sql`length(${t.originalLocale}) > 0`),
  check("session_listing_versions_language", sql`length(${t.language}) > 0`),
  check("session_listing_versions_format", sql`${t.format} IN ('group', 'private')`),
  check("session_listing_versions_duration", sql`typeof(${t.durationMs}) = 'integer' AND ${t.durationMs} > 0`),
  check("session_listing_versions_price", sql`typeof(${t.priceMinor}) = 'integer' AND ${t.priceMinor} >= 0`),
  check("session_listing_versions_currency", sql`${t.currency} = 'EUR'`),
  check("session_listing_versions_price_basis", sql`${t.priceBasis} IN ('per_person', 'per_appointment')`),
  check("session_listing_versions_terms_text", sql`length(trim(${t.termsText})) > 0`),
  check("session_listing_versions_terms_locale", sql`length(${t.termsLocale}) > 0`),
  check("session_listing_versions_terms_hash", sql`length(${t.termsHash}) BETWEEN 1 AND 128`),
  check("session_listing_versions_cancellation_notice", sql`typeof(${t.cancellationNoticeMs}) = 'integer' AND ${t.cancellationNoticeMs} >= 0`),
  check("session_listing_versions_created_at", sql`typeof(${t.createdAt}) = 'integer'`),
  check("session_listing_versions_format_basis", sql`(${t.format} = 'private') = (${t.priceBasis} = 'per_appointment')`),
  foreignKey({ columns: [t.listingId, t.businessId], foreignColumns: [sessionListings.id, sessionListings.businessId] }),
  foreignKey({ columns: [t.venueId, t.businessId], foreignColumns: [venues.id, venues.businessId] }),
  foreignKey({ columns: [t.businessId, t.guaranteedHostMembershipId], foreignColumns: [memberships.businessId, memberships.id] }),
  unique().on(t.listingId, t.no),
  unique().on(t.id, t.listingId),
  unique().on(t.id, t.listingId, t.termsHash),
  index("session_listing_versions_venue").on(t.venueId, t.businessId),
]);

export const sessionSlots = sqliteTable("session_slots", {
  id: text().notNull().primaryKey(),
  listingId: text("listing_id").notNull(),
  listingVersionId: text("listing_version_id").notNull(),
  businessId: text("business_id").notNull(),
  startsAt: integer("starts_at").notNull(),
  endsAt: integer("ends_at").notNull(),
  capacity: integer().notNull(),
  hostsRequired: integer("hosts_required").notNull(),
  coordinatorMembershipId: text("coordinator_membership_id"),
  state: text({ enum: SESSION_SLOT_STATES }).notNull(),
  dayStage: text("day_stage", { enum: SESSION_DAY_STAGES }),
  stageAt: integer("stage_at"),
  stageById: text("stage_by_id").references(() => accounts.id),
  updatedAt: integer("updated_at").notNull(),
  revision: integer().notNull().default(0),
}, (t) => [
  check("session_slots_capacity", sql`typeof(${t.capacity}) = 'integer' AND ${t.capacity} > 0`),
  check("session_slots_hosts_required", sql`typeof(${t.hostsRequired}) = 'integer' AND ${t.hostsRequired} > 0`),
  check("session_slots_state", sql`${t.state} IN ('draft', 'published', 'paused', 'cancelled', 'finished')`),
  check("session_slots_day_stage_value", sql`${t.dayStage} IN ('today', 'doors_open', 'in_session', 'done')`),
  check("session_slots_updated_at", sql`typeof(${t.updatedAt}) = 'integer'`),
  check("session_slots_revision", sql`typeof(${t.revision}) = 'integer' AND ${t.revision} >= 0`),
  check("session_slots_time", sql`typeof(${t.startsAt}) = 'integer' AND typeof(${t.endsAt}) = 'integer' AND ${t.endsAt} > ${t.startsAt}`),
  check("session_slots_coordinator", sql`${t.state} IN ('draft', 'cancelled') OR ${t.coordinatorMembershipId} IS NOT NULL`),
  check("session_slots_day_stage", sql`(${t.state} = 'finished') = (${t.dayStage} IS 'done') AND (
    (${t.dayStage} IS NULL AND ${t.stageAt} IS NULL AND ${t.stageById} IS NULL)
    OR (${t.dayStage} IS NOT NULL AND typeof(${t.stageAt}) = 'integer' AND ${t.stageById} IS NOT NULL))`),
  foreignKey({ columns: [t.listingId, t.businessId], foreignColumns: [sessionListings.id, sessionListings.businessId] }),
  foreignKey({ columns: [t.listingVersionId, t.listingId], foreignColumns: [sessionListingVersions.id, sessionListingVersions.listingId] }),
  foreignKey({ columns: [t.businessId, t.coordinatorMembershipId], foreignColumns: [memberships.businessId, memberships.id] }),
  unique().on(t.id, t.listingId),
  unique().on(t.id, t.businessId),
  index("session_slots_listing_start").on(t.listingId, t.startsAt, t.id),
  uniqueIndex("session_slots_published_start").on(t.listingId, t.startsAt).where(sql`${t.state} = 'published'`),
]);

export const sessionHolds = sqliteTable("session_holds", {
  id: text().notNull().primaryKey(),
  slotId: text("slot_id").notNull(),
  listingId: text("listing_id").notNull(),
  listingVersionId: text("listing_version_id").notNull(),
  termsHash: text("terms_hash").notNull(),
  bookerId: text("booker_id").notNull().references(() => accounts.id),
  moveBookingId: text("move_booking_id").references((): AnySQLiteColumn => sessionBookings.id),
  places: integer().notNull(),
  heldAt: integer("held_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  state: text({ enum: SESSION_HOLD_STATES }).notNull(),
  resolvedAt: integer("resolved_at"),
}, (t) => [
  check("session_holds_places", sql`typeof(${t.places}) = 'integer' AND ${t.places} > 0`),
  check("session_holds_state", sql`${t.state} IN ('held', 'consumed', 'released')`),
  check("session_holds_deadline", sql`typeof(${t.heldAt}) = 'integer' AND typeof(${t.expiresAt}) = 'integer' AND ${t.expiresAt} > ${t.heldAt}`),
  check("session_holds_resolution", sql`(${t.state} = 'held' AND ${t.resolvedAt} IS NULL) OR (${t.state} <> 'held'
    AND typeof(${t.resolvedAt}) = 'integer' AND ${t.resolvedAt} >= ${t.heldAt} AND (${t.state} <> 'consumed' OR ${t.resolvedAt} < ${t.expiresAt}))`),
  foreignKey({ columns: [t.slotId, t.listingId], foreignColumns: [sessionSlots.id, sessionSlots.listingId] }),
  foreignKey({ columns: [t.listingVersionId, t.listingId, t.termsHash],
    foreignColumns: [sessionListingVersions.id, sessionListingVersions.listingId, sessionListingVersions.termsHash] }),
  uniqueIndex("session_holds_booker_current").on(t.bookerId).where(sql`${t.state} = 'held'`),
  index("session_holds_slot_deadline").on(t.slotId, t.expiresAt, t.id).where(sql`${t.state} = 'held'`),
]);

export const sessionBookings = sqliteTable("session_bookings", {
  id: text().notNull().primaryKey(),
  reference: text().notNull().unique(),
  bookerId: text("booker_id").notNull().references(() => accounts.id),
  listingId: text("listing_id").notNull(),
  originalHoldId: text("original_hold_id").notNull().unique().references(() => sessionHolds.id),
  originalSlotId: text("original_slot_id").notNull(),
  originalListingVersionId: text("original_listing_version_id").notNull(),
  originalTermsHash: text("original_terms_hash").notNull(),
  slotId: text("slot_id").notNull(),
  listingVersionId: text("listing_version_id").notNull(),
  termsHash: text("terms_hash").notNull(),
  places: integer().notNull(),
  state: text({ enum: SESSION_BOOKING_STATES }).notNull(),
  bookedAt: integer("booked_at").notNull(),
  cancelledAt: integer("cancelled_at"),
  cancelledById: text("cancelled_by_id").references(() => accounts.id),
  completedAt: integer("completed_at"),
  revision: integer().notNull().default(0),
}, (t) => [
  check("session_bookings_places", sql`typeof(${t.places}) = 'integer' AND ${t.places} > 0`),
  check("session_bookings_state", sql`${t.state} IN ('booked', 'cancelled', 'completed')`),
  check("session_bookings_booked_at", sql`typeof(${t.bookedAt}) = 'integer'`),
  check("session_bookings_revision", sql`typeof(${t.revision}) = 'integer' AND ${t.revision} >= 0`),
  check("session_bookings_cancellation", sql`(${t.state} <> 'cancelled' AND ${t.cancelledAt} IS NULL AND ${t.cancelledById} IS NULL) OR
    (${t.state} = 'cancelled' AND typeof(${t.cancelledAt}) = 'integer' AND ${t.cancelledAt} >= ${t.bookedAt} AND ${t.cancelledById} IS NOT NULL)`),
  check("session_bookings_completion", sql`(${t.state} <> 'completed' AND ${t.completedAt} IS NULL) OR
    (${t.state} = 'completed' AND typeof(${t.completedAt}) = 'integer' AND ${t.completedAt} >= ${t.bookedAt})`),
  foreignKey({ columns: [t.originalSlotId, t.listingId], foreignColumns: [sessionSlots.id, sessionSlots.listingId] }),
  foreignKey({ columns: [t.originalListingVersionId, t.listingId, t.originalTermsHash],
    foreignColumns: [sessionListingVersions.id, sessionListingVersions.listingId, sessionListingVersions.termsHash] }),
  foreignKey({ columns: [t.slotId, t.listingId], foreignColumns: [sessionSlots.id, sessionSlots.listingId] }),
  foreignKey({ columns: [t.listingVersionId, t.listingId, t.termsHash],
    foreignColumns: [sessionListingVersions.id, sessionListingVersions.listingId, sessionListingVersions.termsHash] }),
  unique().on(t.id, t.listingId),
  index("session_bookings_booker").on(t.bookerId, t.bookedAt, t.id),
  index("session_bookings_slot_state").on(t.slotId, t.state, t.id),
]);

export const sessionChangeProposals = sqliteTable("session_change_proposals", {
  id: text().notNull().primaryKey(),
  bookingId: text("booking_id").notNull(),
  listingId: text("listing_id").notNull(),
  version: integer().notNull(),
  bookedSlotId: text("booked_slot_id").notNull(),
  bookedListingVersionId: text("booked_listing_version_id").notNull(),
  proposedSlotId: text("proposed_slot_id").notNull(),
  proposedListingVersionId: text("proposed_listing_version_id").notNull(),
  proposedById: text("proposed_by_id").notNull().references(() => accounts.id),
  proposedAt: integer("proposed_at").notNull(),
  respondBy: integer("respond_by").notNull(),
  state: text({ enum: SESSION_CHANGE_STATES }).notNull(),
  resolvedAt: integer("resolved_at"),
  resolvedById: text("resolved_by_id").references(() => accounts.id),
}, (t) => [
  check("session_change_proposals_version", sql`typeof(${t.version}) = 'integer' AND ${t.version} > 0`),
  check("session_change_proposals_state", sql`${t.state} IN ('pending', 'accepted', 'declined', 'withdrawn')`),
  check("session_change_proposals_deadline", sql`typeof(${t.proposedAt}) = 'integer' AND typeof(${t.respondBy}) = 'integer' AND ${t.respondBy} > ${t.proposedAt}`),
  check("session_change_proposals_resolution", sql`(${t.state} = 'pending' AND ${t.resolvedAt} IS NULL AND ${t.resolvedById} IS NULL) OR (
    ${t.state} <> 'pending' AND typeof(${t.resolvedAt}) = 'integer' AND ${t.resolvedAt} >= ${t.proposedAt}
    AND ${t.resolvedById} IS NOT NULL AND (${t.state} = 'withdrawn' OR ${t.resolvedAt} < ${t.respondBy}))`),
  foreignKey({ columns: [t.bookingId, t.listingId], foreignColumns: [sessionBookings.id, sessionBookings.listingId] }),
  foreignKey({ columns: [t.bookedSlotId, t.listingId], foreignColumns: [sessionSlots.id, sessionSlots.listingId] }),
  foreignKey({ columns: [t.bookedListingVersionId, t.listingId], foreignColumns: [sessionListingVersions.id, sessionListingVersions.listingId] }),
  foreignKey({ columns: [t.proposedSlotId, t.listingId], foreignColumns: [sessionSlots.id, sessionSlots.listingId] }),
  foreignKey({ columns: [t.proposedListingVersionId, t.listingId], foreignColumns: [sessionListingVersions.id, sessionListingVersions.listingId] }),
  unique().on(t.bookingId, t.version),
  uniqueIndex("session_change_proposals_pending").on(t.bookingId).where(sql`${t.state} = 'pending'`),
  index("session_change_proposals_due").on(t.respondBy, t.id).where(sql`${t.state} = 'pending'`),
  index("session_change_proposals_target").on(t.proposedSlotId, t.respondBy).where(sql`${t.state} = 'pending'`),
]);

export const sessionHostAssignments = sqliteTable("session_host_assignments", {
  id: text().notNull().primaryKey(),
  slotId: text("slot_id").notNull(),
  businessId: text("business_id").notNull(),
  membershipId: text("membership_id").notNull(),
  position: integer().notNull(),
  roleLabel: text("role_label").notNull(),
  language: text().notNull(),
  state: text({ enum: SESSION_HOST_ASSIGNMENT_STATES }).notNull(),
  changedAt: integer("changed_at").notNull(),
  changedById: text("changed_by_id").notNull().references(() => accounts.id),
  confirmedAt: integer("confirmed_at"),
  offerExpiresAt: integer("offer_expires_at"),
  offerRespondedAt: integer("offer_responded_at"),
  offerDecision: text("offer_decision", { enum: ["accepted", "declined"] }),
}, (t) => [
  check("session_host_assignments_position", sql`typeof(${t.position}) = 'integer' AND ${t.position} > 0`),
  check("session_host_assignments_role_label", sql`length(trim(${t.roleLabel})) > 0`),
  check("session_host_assignments_language", sql`length(${t.language}) > 0`),
  check("session_host_assignments_state", sql`${t.state} IN ('proposed', 'confirmed', 'released')`),
  check("session_host_assignments_changed_at", sql`typeof(${t.changedAt}) = 'integer'`),
  check("session_host_assignments_confirmation", sql`(${t.state} <> 'confirmed' OR ${t.confirmedAt} IS NOT NULL)
    AND (${t.confirmedAt} IS NULL OR (typeof(${t.confirmedAt}) = 'integer' AND ${t.confirmedAt} <= ${t.changedAt}
      AND ${t.state} <> 'proposed'))`),
  check("session_host_assignments_offer", sql`
    (${t.offerExpiresAt} IS NULL OR typeof(${t.offerExpiresAt}) = 'integer') AND (
      (${t.offerRespondedAt} IS NULL AND ${t.offerDecision} IS NULL)
      OR (${t.offerExpiresAt} IS NOT NULL AND typeof(${t.offerRespondedAt}) = 'integer'
        AND ${t.offerRespondedAt} < ${t.offerExpiresAt} AND ${t.offerRespondedAt} <= ${t.changedAt}
        AND ${t.offerDecision} IS NOT NULL AND ${t.offerDecision} IN ('accepted', 'declined'))
    ) AND (${t.confirmedAt} IS NULL OR ${t.offerExpiresAt} IS NULL OR ${t.offerDecision} IS 'accepted')`),
  foreignKey({ columns: [t.slotId, t.businessId], foreignColumns: [sessionSlots.id, sessionSlots.businessId] }),
  foreignKey({ columns: [t.businessId, t.membershipId], foreignColumns: [memberships.businessId, memberships.id] }),
  uniqueIndex("session_hosts_confirmed_position").on(t.slotId, t.position).where(sql`${t.state} = 'confirmed'`),
  uniqueIndex("session_hosts_current_member").on(t.slotId, t.membershipId).where(
    sql`${t.state} IN ('proposed', 'confirmed') AND ${t.offerDecision} IS NOT 'declined'`),
  uniqueIndex("session_hosts_cover_reservation").on(t.slotId, t.position).where(
    sql`${t.state} = 'proposed' AND ${t.offerDecision} = 'accepted'`),
  index("session_hosts_roster").on(t.slotId, t.state, t.id),
]);

export const sessionAttendance = sqliteTable("session_attendance", {
  id: text().notNull().primaryKey(),
  bookingId: text("booking_id").notNull().references(() => sessionBookings.id),
  result: text({ enum: SESSION_ATTENDANCE_RESULTS }).notNull(),
  placesAttended: integer("places_attended").notNull(),
  recordedById: text("recorded_by_id").notNull().references(() => accounts.id),
  recordedAt: integer("recorded_at").notNull(),
  correctsId: text("corrects_id").unique(),
  correctionReason: text("correction_reason"),
}, (t) => [
  check("session_attendance_recorded_at", sql`typeof(${t.recordedAt}) = 'integer'`),
  check("session_attendance_result", sql`${t.result} IN ('attended', 'absent')`),
  check("session_attendance_result_count", sql`typeof(${t.placesAttended}) = 'integer' AND (
    (${t.result} = 'attended' AND ${t.placesAttended} > 0) OR (${t.result} = 'absent' AND ${t.placesAttended} = 0))`),
  check("session_attendance_correction", sql`(${t.correctsId} IS NULL AND ${t.correctionReason} IS NULL) OR (
    ${t.correctsId} IS NOT NULL AND ${t.correctsId} <> ${t.id} AND ${t.correctionReason} IS NOT NULL AND length(trim(${t.correctionReason})) > 0)`),
  foreignKey({ columns: [t.correctsId, t.bookingId], foreignColumns: [t.id, t.bookingId] }),
  unique().on(t.id, t.bookingId),
  uniqueIndex("session_attendance_one_verified").on(t.bookingId).where(sql`${t.correctsId} IS NULL`),
  index("session_attendance_history").on(t.bookingId, t.recordedAt, t.id),
]);

export const sessionBookingFeedback = sqliteTable("session_booking_feedback", {
  bookingId: text("booking_id").notNull().primaryKey().references(() => sessionBookings.id),
  stars: integer().notNull(),
  comment: text(),
  submittedAt: integer("submitted_at").notNull(),
}, (t) => [
  check("session_booking_feedback_stars", sql`typeof(${t.stars}) = 'integer' AND ${t.stars} BETWEEN 1 AND 5`),
  check("session_booking_feedback_comment", sql`${t.comment} IS NULL OR length(trim(${t.comment})) > 0`),
  check("session_booking_feedback_submitted_at", sql`typeof(${t.submittedAt}) = 'integer'`),
]);

export const sessionThreads = sqliteTable("session_threads", {
  id: text().notNull().primaryKey(),
  bookingId: text("booking_id").notNull().references(() => sessionBookings.id),
  audience: text({ enum: ["session"] }).notNull(),
  writeState: text("write_state", { enum: ["open", "read_only"] }).notNull(),
  lastPosition: integer("last_position").notNull().default(0),
}, (t) => [
  check("session_threads_audience", sql`${t.audience} = 'session'`),
  check("session_threads_write_state", sql`${t.writeState} IN ('open', 'read_only')`),
  check("session_threads_last_position", sql`typeof(${t.lastPosition}) = 'integer' AND ${t.lastPosition} >= 0`),
  unique().on(t.bookingId, t.audience),
]);
