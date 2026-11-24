import {
  ARRIVAL_ARRANGEMENTS, HANDOFF_POLICIES, HANDOFF_STATES, JOB_GRANT_CAPABILITIES, JOB_ORIGINS,
  JOB_STATES, SUPPORT_CASE_KINDS, SUPPORT_CASE_STATES,
} from "@bookbuddy/domain";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { accountContexts, businesses, memberships, placePeople, places } from "./access";
import { accounts } from "./identity";

export const jobs = sqliteTable("jobs", {
  id: text().notNull().primaryKey(),
  reference: text().notNull().unique(),
  businessId: text("business_id").notNull().references(() => businesses.id),
  placeId: text("place_id").notNull().references(() => places.id),
  requesterId: text("requester_id").notNull().references(() => accounts.id),
  requestOperationId: text("request_operation_id"),
  accountableForemanMembershipId: text("accountable_foreman_membership_id"),
  trade: text(),
  origin: text({ enum: JOB_ORIGINS }).notNull(),
  state: text({ enum: JOB_STATES }).notNull(),
  revision: integer().notNull().default(0),
}, (t) => [
  check("jobs_reference", sql`${t.reference} GLOB 'BB-[A-Z0-9]*' AND substr(${t.reference}, 4) NOT GLOB '*[^A-Z0-9]*'`),
  check("jobs_origin", sql`${t.origin} IN ('bookbuddy', 'provider')`),
  check("jobs_state", sql`${t.state} IN ('open', 'cancelled', 'closed')`),
  check("jobs_revision", sql`typeof(${t.revision}) = 'integer' AND ${t.revision} >= 0`),
  unique().on(t.id, t.businessId),
  unique().on(t.id, t.placeId),
  foreignKey({ columns: [t.businessId, t.accountableForemanMembershipId], foreignColumns: [memberships.businessId, memberships.id] }),
  foreignKey({ columns: [t.placeId, t.requesterId], foreignColumns: [placePeople.placeId, placePeople.accountId] }),
  index("jobs_business_state").on(t.businessId, t.state, t.id),
  index("jobs_place_state").on(t.placeId, t.state, t.id),
  index("jobs_foreman_state").on(t.accountableForemanMembershipId, t.state, t.id),
  uniqueIndex("jobs_request_operation").on(t.requesterId, t.requestOperationId).where(sql`${t.requestOperationId} IS NOT NULL`),
]);

export const requests = sqliteTable("requests", {
  jobId: text("job_id").notNull().primaryKey().references(() => jobs.id),
  originalText: text("original_text"),
  originalLanguage: text("original_language"),
  arrivalArrangement: text("arrival_arrangement", { enum: ARRIVAL_ARRANGEMENTS }).notNull(),
  arrivalContactName: text("arrival_contact_name"),
  safeNote: text("safe_note"),
  submittedAt: integer("submitted_at").notNull(),
}, (t) => [
  check("requests_text", sql`${t.originalText} IS NULL OR length(trim(${t.originalText}, char(9, 10, 11, 12, 13, 32))) > 0`),
  check("requests_arrival", sql`${t.arrivalArrangement} IN ('nobody', 'requester', 'someone_else', 'to_be_arranged')
    AND (${t.arrivalArrangement} = 'someone_else') = (${t.arrivalContactName} IS NOT NULL)
    AND (${t.arrivalContactName} IS NULL OR length(trim(${t.arrivalContactName}, char(9, 10, 11, 12, 13, 32))) > 0)
    AND (${t.arrivalArrangement} <> 'nobody' OR ${t.safeNote} IS NOT NULL)
    AND (${t.safeNote} IS NULL OR length(trim(${t.safeNote}, char(9, 10, 11, 12, 13, 32))) > 0)`),
  check("requests_submitted_at", sql`typeof(${t.submittedAt}) = 'integer'`),
]);

export const jobHandoffs = sqliteTable("job_handoffs", {
  id: text().notNull().primaryKey(),
  jobId: text("job_id").notNull(),
  businessId: text("business_id").notNull(),
  incumbentId: text("incumbent_id"),
  recipientId: text("recipient_id").notNull(),
  issuerId: text("issuer_id").references(() => accounts.id),
  reofferOfId: text("reoffer_of_id"),
  policy: text({ enum: HANDOFF_POLICIES }).notNull(),
  callConfirmedAt: integer("call_confirmed_at"),
  offeredAt: integer("offered_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  endedAt: integer("ended_at"),
  declineReason: text("decline_reason"),
  state: text({ enum: HANDOFF_STATES }).notNull(),
  reofferableId: text("reofferable_id").generatedAlwaysAs(sql`CASE WHEN reoffer_of_id IS NULL AND state IN ('declined', 'expired') THEN id END`, { mode: "virtual" }),
}, (t) => [
  check("job_handoffs_state", sql`${t.state} IN ('offered', 'accepted', 'declined', 'expired', 'withdrawn')`),
  check("job_handoffs_distinct", sql`${t.incumbentId} IS NULL OR ${t.incumbentId} <> ${t.recipientId}`),
  check("job_handoffs_policy", sql`(${t.policy} = 'standard' AND ${t.callConfirmedAt} IS NULL)
    OR (${t.policy} = 'urgent' AND typeof(${t.callConfirmedAt}) = 'integer' AND ${t.callConfirmedAt} <= ${t.offeredAt})`),
  check("job_handoffs_issuer", sql`${t.issuerId} IS NOT NULL OR (${t.policy} = 'standard' AND ${t.incumbentId} IS NULL AND ${t.reofferOfId} IS NULL)`),
  check("job_handoffs_resolution", sql`typeof(${t.offeredAt}) = 'integer' AND typeof(${t.expiresAt}) = 'integer' AND ${t.expiresAt} > ${t.offeredAt}
    AND (${t.state} = 'offered') = (${t.endedAt} IS NULL)
    AND (${t.endedAt} IS NULL OR (typeof(${t.endedAt}) = 'integer' AND ${t.endedAt} >= ${t.offeredAt}))
    AND (${t.state} NOT IN ('accepted', 'declined') OR ${t.endedAt} < ${t.expiresAt})
    AND (${t.state} <> 'expired' OR ${t.endedAt} >= ${t.expiresAt})
    AND (${t.declineReason} IS NULL OR (${t.state} = 'declined' AND length(trim(${t.declineReason}, char(9, 10, 11, 12, 13, 32))) > 0))`),
  unique().on(t.jobId, t.reofferableId),
  foreignKey({ columns: [t.jobId, t.businessId], foreignColumns: [jobs.id, jobs.businessId] }),
  foreignKey({ columns: [t.businessId, t.incumbentId], foreignColumns: [memberships.businessId, memberships.id] }),
  foreignKey({ columns: [t.businessId, t.recipientId], foreignColumns: [memberships.businessId, memberships.id] }),
  foreignKey({ columns: [t.jobId, t.reofferOfId], foreignColumns: [t.jobId, t.reofferableId] }),
  uniqueIndex("job_handoffs_one_offered").on(t.jobId).where(sql`${t.state} = 'offered'`),
  uniqueIndex("job_handoffs_one_reoffer").on(t.reofferOfId).where(sql`${t.reofferOfId} IS NOT NULL`),
  index("job_handoffs_job_history").on(t.jobId, t.offeredAt, t.id),
  index("job_handoffs_recipient_due").on(t.recipientId, t.state, t.expiresAt, t.id),
  index("job_handoffs_due").on(t.expiresAt, t.id).where(sql`${t.state} = 'offered'`),
]);

export const jobGrants = sqliteTable("job_grants", {
  jobId: text("job_id").notNull().references(() => jobs.id),
  contextId: text("context_id").notNull().references(() => accountContexts.id),
  capability: text({ enum: JOB_GRANT_CAPABILITIES }).notNull(),
  validFrom: integer("valid_from").notNull(),
  validUntil: integer("valid_until").notNull(),
  revokedAt: integer("revoked_at"),
}, (t) => [
  primaryKey({ columns: [t.jobId, t.contextId, t.capability, t.validFrom] }),
  check("job_grants_capability", sql`${t.capability} IN ('intake', 'reviewer', 'backup', 'rectification')`),
  check("job_grants_term", sql`typeof(${t.validFrom}) = 'integer' AND typeof(${t.validUntil}) = 'integer' AND ${t.validUntil} > ${t.validFrom}
    AND (${t.revokedAt} IS NULL OR (typeof(${t.revokedAt}) = 'integer' AND ${t.revokedAt} >= ${t.validFrom}))`),
  uniqueIndex("job_grants_current").on(t.jobId, t.contextId, t.capability).where(sql`${t.revokedAt} IS NULL`),
  index("job_grants_context").on(t.contextId, t.jobId, t.capability),
  index("job_grants_due").on(t.validUntil, t.jobId, t.contextId, t.capability).where(sql`${t.revokedAt} IS NULL`),
]);

export const supportCases = sqliteTable("support_cases", {
  id: text().notNull().primaryKey(),
  reporterId: text("reporter_id").references(() => accounts.id),
  operationId: text("operation_id"),
  kind: text({ enum: SUPPORT_CASE_KINDS }).notNull(),
  state: text({ enum: SUPPORT_CASE_STATES }).notNull(),
  message: text().notNull(),
  reportedReference: text("reported_reference"),
  replyEmailCiphertext: text("reply_email_ciphertext"),
  receivedAt: integer("received_at").notNull(),
}, (t) => [
  check("support_cases_kind", sql`${t.kind} IN ('sign_in', 'access', 'eligibility', 'property', 'other')`),
  check("support_cases_state", sql`${t.state} IN ('open', 'responded', 'closed')`),
  check("support_cases_message", sql`length(trim(${t.message}, char(9, 10, 11, 12, 13, 32))) BETWEEN 1 AND 2000`),
  check("support_cases_received_at", sql`typeof(${t.receivedAt}) = 'integer'`),
  index("support_cases_reporter").on(t.reporterId, t.receivedAt, t.id).where(sql`${t.reporterId} IS NOT NULL`),
  index("support_cases_state_received").on(t.state, t.receivedAt, t.id),
  uniqueIndex("support_cases_operation").on(t.reporterId, t.operationId).where(sql`${t.operationId} IS NOT NULL`),
]);

export const anonymousSupportReceipts = sqliteTable("anonymous_support_receipts", {
  sourceKey: text("source_key").notNull(),
  operationId: text("operation_id").notNull(),
  inputHash: text("input_hash").notNull(),
  caseId: text("case_id").notNull().unique().references(() => supportCases.id),
  committedAt: integer("committed_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.sourceKey, t.operationId] }),
  index("anonymous_support_receipts_source_time").on(t.sourceKey, t.committedAt),
  check("anonymous_support_receipts_committed_at", sql`typeof(${t.committedAt}) = 'integer'`),
]);
