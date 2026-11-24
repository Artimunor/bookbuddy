import {
  BUSINESS_CAPABILITIES, BUSINESS_STATES, CONTEXT_ROLES, ELIGIBILITY_STATES, INVITATION_STATES,
  MEMBERSHIP_ROLES, MEMBERSHIP_STATES, PLACE_CAPABILITIES, PLACE_STATES,
} from "@bookbuddy/domain";
import { sql } from "drizzle-orm";
import {
  check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { accounts } from "./identity";

type GeoPosition = readonly [longitude: number, latitude: number];
type PlacePin = { latitude: number; longitude: number };
type GrantSnapshot =
  | { kind: "business_role"; role: "worker" | "foreman" }
  | { kind: "place_view" }
  | { kind: "place_transfer" };

export const operatingAreas = sqliteTable("operating_areas", {
  id: text().notNull().primaryKey(),
  name: text().notNull(),
  siteZone: text("site_zone").notNull(),
  polygon: text({ mode: "json" }).$type<readonly (readonly GeoPosition[])[]>().notNull(),
}, (t) => [
  unique().on(t.id, t.siteZone),
  check("operating_areas_polygon", sql`CASE WHEN json_valid(${t.polygon}) THEN json_type(${t.polygon}) = 'array' AND json_array_length(${t.polygon}) > 0 ELSE 0 END`),
]);

export const staffedCalendar = sqliteTable("staffed_calendar", {
  id: text().notNull().primaryKey(),
  areaId: text("area_id").notNull().references(() => operatingAreas.id),
  weekday: integer(),
  localDate: text("local_date"),
  opensMinute: integer("opens_minute"),
  closesMinute: integer("closes_minute"),
}, (t) => [
  check("staffed_calendar_day", sql`(${t.weekday} IS NULL) <> (${t.localDate} IS NULL)
    AND (${t.weekday} IS NULL OR (typeof(${t.weekday}) = 'integer' AND ${t.weekday} BETWEEN 1 AND 7))
    AND (${t.localDate} IS NULL OR date(${t.localDate}, '+0 days') IS ${t.localDate})`),
  check("staffed_calendar_hours", sql`(${t.weekday} IS NULL AND ${t.opensMinute} IS NULL AND ${t.closesMinute} IS NULL)
    OR (typeof(${t.opensMinute}) = 'integer' AND typeof(${t.closesMinute}) = 'integer'
      AND ${t.opensMinute} >= 0 AND ${t.closesMinute} <= 1440 AND ${t.opensMinute} < ${t.closesMinute})`),
  uniqueIndex("staffed_calendar_weekday").on(t.areaId, t.weekday).where(sql`${t.weekday} IS NOT NULL`),
  uniqueIndex("staffed_calendar_date").on(t.areaId, t.localDate).where(sql`${t.localDate} IS NOT NULL`),
]);

export const businesses = sqliteTable("businesses", {
  id: text().notNull().primaryKey(),
  legalName: text("legal_name").notNull(),
  publicName: text("public_name").notNull(),
  verifiedWorkContact: text("verified_work_contact").notNull(),
  catchmentId: text("catchment_id").notNull().references(() => operatingAreas.id),
  defaultForemanId: text("default_foreman_id"),
  state: text({ enum: BUSINESS_STATES }).notNull(),
}, (t) => [
  check("businesses_state", sql`${t.state} IN ('pending', 'approved', 'suspended', 'closed')`),
  foreignKey({ columns: [t.id, t.defaultForemanId], foreignColumns: [memberships.businessId, memberships.id] }),
  index("businesses_catchment_state").on(t.catchmentId, t.state, t.id),
]);

export const memberships = sqliteTable("memberships", {
  id: text().notNull().primaryKey(),
  businessId: text("business_id").notNull().references((): AnySQLiteColumn => businesses.id),
  accountId: text("account_id").notNull().references(() => accounts.id),
  state: text({ enum: MEMBERSHIP_STATES }).notNull(),
}, (t) => [
  check("memberships_state", sql`${t.state} IN ('active', 'revoked', 'suspended')`),
  unique().on(t.businessId, t.accountId),
  unique().on(t.businessId, t.id),
  unique().on(t.id, t.businessId, t.accountId),
  index("memberships_business_state").on(t.businessId, t.state, t.id),
  index("memberships_account_state").on(t.accountId, t.state, t.id),
]);

export const membershipRoles = sqliteTable("membership_roles", {
  id: text().notNull().primaryKey(),
  membershipId: text("membership_id").notNull(),
  businessId: text("business_id").notNull(),
  accountId: text("account_id").notNull(),
  role: text({ enum: MEMBERSHIP_ROLES }).notNull(),
  grantedAt: integer("granted_at").notNull(),
  revokedAt: integer("revoked_at"),
  revokedBy: text("revoked_by").references(() => accounts.id),
}, (t) => [
  check("membership_roles_role", sql`${t.role} IN ('worker', 'foreman', 'provider_admin')`),
  check("membership_roles_revocation", sql`(${t.revokedAt} IS NULL AND ${t.revokedBy} IS NULL)
    OR (${t.revokedAt} >= ${t.grantedAt} AND ${t.revokedBy} IS NOT NULL AND ${t.revokedAt} IS NOT NULL)`),
  unique().on(t.id, t.businessId, t.accountId, t.role),
  foreignKey({ columns: [t.membershipId, t.businessId, t.accountId], foreignColumns: [memberships.id, memberships.businessId, memberships.accountId] }),
  uniqueIndex("membership_roles_current").on(t.membershipId, t.role).where(sql`${t.revokedAt} IS NULL`),
  index("membership_roles_membership_history").on(t.membershipId, t.role, t.grantedAt, t.id),
  index("membership_roles_business_revoked").on(t.businessId, t.revokedAt, t.id).where(sql`${t.revokedAt} IS NOT NULL`),
]);

// A context selects a role; authorization still checks that its grant and membership are live.
export const accountContexts = sqliteTable("account_contexts", {
  id: text().notNull().primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  role: text({ enum: CONTEXT_ROLES }).notNull(),
  businessId: text("business_id").references(() => businesses.id),
  roleGrantId: text("role_grant_id"),
}, (t) => [
  check("account_contexts_role", sql`${t.role} IN ('customer', 'worker', 'foreman', 'provider_admin')`),
  check("account_contexts_scope", sql`(${t.role} = 'customer' AND ${t.businessId} IS NULL AND ${t.roleGrantId} IS NULL)
    OR (${t.role} <> 'customer' AND ${t.businessId} IS NOT NULL AND ${t.roleGrantId} IS NOT NULL)`),
  unique().on(t.id, t.accountId),
  foreignKey({
    columns: [t.roleGrantId, t.businessId, t.accountId, t.role],
    foreignColumns: [membershipRoles.id, membershipRoles.businessId, membershipRoles.accountId, membershipRoles.role],
  }),
  uniqueIndex("account_contexts_customer").on(t.accountId).where(sql`${t.role} = 'customer'`),
  uniqueIndex("account_contexts_business_role").on(t.accountId, t.role, t.businessId).where(sql`${t.businessId} IS NOT NULL`),
  index("account_contexts_account").on(t.accountId, t.id),
  index("account_contexts_role_grant").on(t.roleGrantId).where(sql`${t.roleGrantId} IS NOT NULL`),
]);

export const places = sqliteTable("places", {
  id: text().notNull().primaryKey(),
  ownerId: text("owner_id").notNull().references(() => accounts.id),
  namedApproverId: text("named_approver_id"),
  alias: text().notNull(),
  normalizedAddress: text("normalized_address").notNull(),
  pin: text({ mode: "json" }).$type<PlacePin>(),
  siteZone: text("site_zone"),
  areaId: text("area_id"),
  safeArrivalNote: text("safe_arrival_note"),
  revision: integer().notNull().default(0),
  state: text({ enum: PLACE_STATES }).notNull(),
}, (t) => [
  check("places_state", sql`${t.state} IN ('pending_verification', 'in_area', 'out_of_area', 'restricted', 'archived')`),
  check("places_revision", sql`${t.revision} >= 0`),
  check("places_verified", sql`(${t.state} NOT IN ('in_area', 'out_of_area')
    OR (${t.pin} IS NOT NULL AND ${t.siteZone} IS NOT NULL AND ${t.namedApproverId} IS NOT NULL))
    AND (${t.state} <> 'in_area' OR ${t.areaId} IS NOT NULL) AND (${t.areaId} IS NULL OR ${t.siteZone} IS NOT NULL)`),
  check("places_pin", sql`CASE WHEN ${t.pin} IS NULL THEN 1 WHEN json_valid(${t.pin}) THEN COALESCE(
    json_type(${t.pin}) = 'object'
    AND json_type(${t.pin}, '$.latitude') IN ('integer', 'real') AND json_extract(${t.pin}, '$.latitude') BETWEEN -90 AND 90
    AND json_type(${t.pin}, '$.longitude') IN ('integer', 'real') AND json_extract(${t.pin}, '$.longitude') BETWEEN -180 AND 180,
    0
  ) ELSE 0 END`),
  foreignKey({ columns: [t.areaId, t.siteZone], foreignColumns: [operatingAreas.id, operatingAreas.siteZone] }),
  foreignKey({ columns: [t.id, t.namedApproverId], foreignColumns: [placePeople.placeId, placePeople.currentAccountId] }),
  index("places_owner_state").on(t.ownerId, t.state, t.id),
  index("places_area_state").on(t.areaId, t.state, t.id),
]);

export const placePeople = sqliteTable("place_people", {
  placeId: text("place_id").notNull().references((): AnySQLiteColumn => places.id),
  accountId: text("account_id").notNull().references(() => accounts.id),
  verifiedFrom: integer("verified_from").notNull(),
  historyFrom: integer("history_from").notNull(),
  endsAt: integer("ends_at"),
  currentAccountId: text("current_account_id").generatedAlwaysAs(sql`CASE WHEN ends_at IS NULL THEN account_id END`, { mode: "virtual" }),
}, (t) => [
  primaryKey({ columns: [t.placeId, t.accountId] }),
  unique().on(t.placeId, t.currentAccountId),
  check("place_people_end", sql`${t.endsAt} IS NULL OR ${t.endsAt} >= ${t.verifiedFrom}`),
  index("place_people_account_current").on(t.accountId, t.placeId).where(sql`${t.endsAt} IS NULL`),
]);

export const authorityVerifications = sqliteTable("authority_verifications", {
  id: text().notNull().primaryKey(),
  businessId: text("business_id").references(() => businesses.id),
  placeId: text("place_id").references(() => places.id),
  subjectAccountId: text("subject_account_id").references(() => accounts.id),
  kind: text().notNull(),
  verifiedBy: text("verified_by").notNull().references(() => accounts.id),
  verifiedAt: integer("verified_at").notNull(),
}, (t) => [
  check("authority_verifications_scope", sql`(${t.businessId} IS NOT NULL AND ${t.placeId} IS NULL AND ${t.kind} IN ('business', 'membership', 'business_grant'))
    OR (${t.businessId} IS NULL AND ${t.placeId} IS NOT NULL AND ${t.kind} IN ('place_pin', 'place_owner', 'place_approver', 'place_transfer', 'place_grant'))`),
  check("authority_verifications_independent", sql`${t.subjectAccountId} IS NULL OR ${t.subjectAccountId} <> ${t.verifiedBy}`),
  unique().on(t.id, t.businessId),
  unique().on(t.id, t.placeId),
  index("authority_verifications_business_subject").on(t.businessId, t.subjectAccountId, t.kind, t.verifiedAt, t.id).where(sql`${t.businessId} IS NOT NULL`),
  index("authority_verifications_place_subject").on(t.placeId, t.subjectAccountId, t.kind, t.verifiedAt, t.id).where(sql`${t.placeId} IS NOT NULL`),
]);

export const businessGrants = sqliteTable("business_grants", {
  id: text().notNull().primaryKey(),
  businessId: text("business_id").notNull(),
  membershipId: text("membership_id").notNull(),
  capability: text({ enum: BUSINESS_CAPABILITIES }).notNull(),
  issuerId: text("issuer_id").notNull().references(() => accounts.id),
  approvalVerificationId: text("approval_verification_id"),
  validFrom: integer("valid_from").notNull(),
  validUntil: integer("valid_until"),
  revokedAt: integer("revoked_at"),
}, (t) => [
  check("business_grants_capability", sql`${t.capability} IN ('handoff', 'backup_foreman', 'review_commercial', 'publish_commercial',
    'issue_bill', 'record_paid', 'billing_deferral', 'membership_admin', 'schedule_correction', 'feedback_lead')`),
  check("business_grants_term", sql`(${t.validUntil} IS NULL OR ${t.validUntil} > ${t.validFrom}) AND (${t.revokedAt} IS NULL OR ${t.revokedAt} >= ${t.validFrom})`),
  foreignKey({ columns: [t.businessId, t.membershipId], foreignColumns: [memberships.businessId, memberships.id] }),
  foreignKey({ columns: [t.approvalVerificationId, t.businessId], foreignColumns: [authorityVerifications.id, authorityVerifications.businessId] }),
  uniqueIndex("business_grants_current").on(t.membershipId, t.capability).where(sql`${t.revokedAt} IS NULL`),
  index("business_grants_scope").on(t.businessId, t.capability, t.id),
  index("business_grants_due").on(t.validUntil, t.id).where(sql`${t.revokedAt} IS NULL AND ${t.validUntil} IS NOT NULL`),
]);

export const placeGrants = sqliteTable("place_grants", {
  id: text().notNull().primaryKey(),
  placeId: text("place_id").notNull(),
  accountId: text("account_id").notNull(),
  capability: text({ enum: PLACE_CAPABILITIES }).notNull(),
  issuerId: text("issuer_id").notNull().references(() => accounts.id),
  approvalVerificationId: text("approval_verification_id"),
  validFrom: integer("valid_from").notNull(),
  validUntil: integer("valid_until"),
  revokedAt: integer("revoked_at"),
}, (t) => [
  check("place_grants_capability", sql`${t.capability} IN ('view', 'message', 'request', 'book', 'approve', 'sign_off', 'bill_view', 'delegate')`),
  check("place_grants_term", sql`(${t.validUntil} IS NULL OR ${t.validUntil} > ${t.validFrom}) AND (${t.revokedAt} IS NULL OR ${t.revokedAt} >= ${t.validFrom})`),
  foreignKey({ columns: [t.placeId, t.accountId], foreignColumns: [placePeople.placeId, placePeople.accountId] }),
  foreignKey({ columns: [t.approvalVerificationId, t.placeId], foreignColumns: [authorityVerifications.id, authorityVerifications.placeId] }),
  uniqueIndex("place_grants_current").on(t.placeId, t.accountId, t.capability).where(sql`${t.revokedAt} IS NULL`),
  uniqueIndex("place_grants_current_approver").on(t.placeId).where(sql`${t.capability} = 'approve' AND ${t.revokedAt} IS NULL`),
  index("place_grants_grantee").on(t.accountId, t.placeId, t.id).where(sql`${t.revokedAt} IS NULL`),
  index("place_grants_scope").on(t.placeId, t.accountId, t.id),
  index("place_grants_due").on(t.validUntil, t.id).where(sql`${t.revokedAt} IS NULL AND ${t.validUntil} IS NOT NULL`),
]);

export const eligibilityChecks = sqliteTable("eligibility_checks", {
  id: text().notNull().primaryKey(),
  businessId: text("business_id").notNull().references(() => businesses.id),
  membershipId: text("membership_id"),
  trade: text().notNull(),
  workLanguage: text("work_language").notNull(),
  scope: text().notNull(),
  state: text({ enum: ELIGIBILITY_STATES }).notNull(),
  checkedBy: text("checked_by").references(() => accounts.id),
  checkedAt: integer("checked_at"),
  validUntil: integer("valid_until"),
  reviewBy: integer("review_by"),
}, (t) => [
  check("eligibility_checks_state", sql`${t.state} IN ('pending', 'approved', 'suspended', 'rejected')`),
  check("eligibility_checks_review", sql`(${t.checkedAt} IS NULL) = (${t.checkedBy} IS NULL)
    AND (${t.state} = 'pending' OR ${t.checkedAt} IS NOT NULL)
    AND (${t.state} <> 'approved' OR ${t.validUntil} IS NOT NULL OR ${t.reviewBy} IS NOT NULL)
    AND (${t.validUntil} IS NULL OR (${t.checkedAt} IS NOT NULL AND ${t.validUntil} > ${t.checkedAt}))
    AND (${t.reviewBy} IS NULL OR ${t.checkedAt} IS NULL OR ${t.reviewBy} > ${t.checkedAt})`),
  foreignKey({ columns: [t.businessId, t.membershipId], foreignColumns: [memberships.businessId, memberships.id] }),
  index("eligibility_checks_subject").on(t.businessId, t.membershipId, t.trade, t.workLanguage, t.checkedAt, t.id),
  index("eligibility_checks_expiry").on(t.validUntil, t.id).where(sql`${t.state} = 'approved' AND ${t.validUntil} IS NOT NULL`),
  index("eligibility_checks_review_due").on(t.state, t.reviewBy, t.id).where(sql`${t.reviewBy} IS NOT NULL`),
]);

export const memberSkills = sqliteTable("member_skills", {
  membershipId: text("membership_id").notNull().references(() => memberships.id),
  tag: text().notNull(),
}, (t) => [
  primaryKey({ columns: [t.membershipId, t.tag] }),
  index("member_skills_tag").on(t.tag, t.membershipId),
]);

export const memberLanguages = sqliteTable("member_languages", {
  membershipId: text("membership_id").notNull().references(() => memberships.id),
  tag: text().notNull(),
}, (t) => [
  primaryKey({ columns: [t.membershipId, t.tag] }),
  index("member_languages_tag").on(t.tag, t.membershipId),
]);

export const accessAudit = sqliteTable("access_audit", {
  id: text().notNull().primaryKey(),
  businessId: text("business_id").references(() => businesses.id),
  placeId: text("place_id").references(() => places.id),
  actorId: text("actor_id").notNull().references(() => accounts.id),
  subjectAccountId: text("subject_account_id").references(() => accounts.id),
  verificationId: text("verification_id"),
  kind: text().notNull(),
  at: integer().notNull(),
}, (t) => [
  check("access_audit_scope", sql`(${t.businessId} IS NULL) <> (${t.placeId} IS NULL)`),
  check("access_audit_kind", sql`${t.kind} IN ('role_granted', 'role_revoked', 'grant_issued', 'grant_revoked', 'membership_suspended',
    'eligibility_reviewed', 'place_verified', 'approver_changed', 'owner_transferred', 'place_archived',
    'invitation_issued', 'invitation_reissued', 'invitation_accepted', 'invitation_declined', 'invitation_withdrawn')`),
  foreignKey({ columns: [t.verificationId, t.businessId], foreignColumns: [authorityVerifications.id, authorityVerifications.businessId] }),
  foreignKey({ columns: [t.verificationId, t.placeId], foreignColumns: [authorityVerifications.id, authorityVerifications.placeId] }),
  index("access_audit_business").on(t.businessId, t.at, t.id).where(sql`${t.businessId} IS NOT NULL`),
  index("access_audit_place").on(t.placeId, t.at, t.id).where(sql`${t.placeId} IS NOT NULL`),
  index("access_audit_subject").on(t.subjectAccountId, t.at, t.id).where(sql`${t.subjectAccountId} IS NOT NULL`),
]);

export const invitations = sqliteTable("invitations", {
  id: text().notNull().primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  recipientKey: text("recipient_key").notNull(),
  recipientEmailCiphertext: text("recipient_email_ciphertext"),
  businessId: text("business_id").references(() => businesses.id),
  placeId: text("place_id").references(() => places.id),
  inviterId: text("inviter_id").notNull().references(() => accounts.id),
  grantSnapshot: text("grant_snapshot", { mode: "json" }).$type<GrantSnapshot>().notNull(),
  verificationId: text("verification_id"),
  issuedAt: integer("issued_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  endedAt: integer("ended_at"),
  recipientId: text("recipient_id").references(() => accounts.id),
  supersedesId: text("supersedes_id").unique(),
  pendingSlot: integer("pending_slot"),
  state: text({ enum: INVITATION_STATES }).notNull(),
}, (t) => [
  check("invitations_state", sql`${t.state} IN ('pending', 'accepted', 'declined', 'withdrawn', 'expired')`),
  check("invitations_scope", sql`(${t.businessId} IS NULL) <> (${t.placeId} IS NULL)`),
  check("invitations_lifetime", sql`${t.expiresAt} = ${t.issuedAt} + 172800000`),
  check("invitations_resolution", sql`(${t.state} = 'pending') = (${t.endedAt} IS NULL)
    AND (${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.issuedAt})
    AND (${t.state} <> 'pending' OR ${t.recipientEmailCiphertext} IS NOT NULL)
    AND (${t.state} NOT IN ('accepted', 'declined') OR (${t.recipientId} IS NOT NULL AND ${t.endedAt} < ${t.expiresAt}))`),
  check("invitations_slot", sql`(${t.pendingSlot} IS NULL OR (${t.placeId} IS NOT NULL AND typeof(${t.pendingSlot}) = 'integer' AND ${t.pendingSlot} BETWEEN 1 AND 5))
    AND (${t.placeId} IS NULL OR ${t.state} <> 'pending' OR ${t.pendingSlot} IS NOT NULL)`),
  check("invitations_snapshot", sql`CASE WHEN json_valid(${t.grantSnapshot}) THEN COALESCE(
    (${t.businessId} IS NOT NULL AND json_extract(${t.grantSnapshot}, '$.kind') = 'business_role'
      AND json_extract(${t.grantSnapshot}, '$.role') IN ('worker', 'foreman'))
    OR (${t.placeId} IS NOT NULL AND json_extract(${t.grantSnapshot}, '$.kind') = 'place_view')
    OR (${t.placeId} IS NOT NULL AND json_extract(${t.grantSnapshot}, '$.kind') = 'place_transfer' AND ${t.verificationId} IS NOT NULL),
    0
  ) ELSE 0 END`),
  check("invitations_reissue", sql`${t.supersedesId} IS NULL OR ${t.supersedesId} <> ${t.id}`),
  unique().on(t.businessId, t.recipientKey, t.id),
  unique().on(t.placeId, t.recipientKey, t.id),
  foreignKey({ columns: [t.verificationId, t.businessId], foreignColumns: [authorityVerifications.id, authorityVerifications.businessId] }),
  foreignKey({ columns: [t.verificationId, t.placeId], foreignColumns: [authorityVerifications.id, authorityVerifications.placeId] }),
  foreignKey({ columns: [t.businessId, t.recipientKey, t.supersedesId], foreignColumns: [t.businessId, t.recipientKey, t.id] }),
  foreignKey({ columns: [t.placeId, t.recipientKey, t.supersedesId], foreignColumns: [t.placeId, t.recipientKey, t.id] }),
  uniqueIndex("invitations_business_pending_recipient").on(t.businessId, t.recipientKey).where(sql`${t.state} = 'pending' AND ${t.businessId} IS NOT NULL`),
  uniqueIndex("invitations_place_pending_recipient").on(t.placeId, t.recipientKey).where(sql`${t.state} = 'pending' AND ${t.placeId} IS NOT NULL`),
  uniqueIndex("invitations_place_pending_slot").on(t.placeId, t.pendingSlot).where(sql`${t.state} = 'pending' AND ${t.placeId} IS NOT NULL`),
  index("invitations_business_reissue").on(t.businessId, t.recipientKey, t.issuedAt, t.id).where(sql`${t.supersedesId} IS NOT NULL AND ${t.businessId} IS NOT NULL`),
  index("invitations_place_reissue").on(t.placeId, t.recipientKey, t.issuedAt, t.id).where(sql`${t.supersedesId} IS NOT NULL AND ${t.placeId} IS NOT NULL`),
  index("invitations_business_state").on(t.businessId, t.state, t.issuedAt, t.id).where(sql`${t.businessId} IS NOT NULL`),
  index("invitations_place_state").on(t.placeId, t.state, t.issuedAt, t.id).where(sql`${t.placeId} IS NOT NULL`),
  index("invitations_pending_due").on(t.expiresAt, t.id).where(sql`${t.state} = 'pending'`),
  index("invitations_recipient").on(t.recipientId, t.issuedAt, t.id).where(sql`${t.recipientId} IS NOT NULL`),
]);
