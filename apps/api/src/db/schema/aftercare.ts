import {
  BILL_DEFERRAL_DISPOSITIONS, BILL_STATES, CASE_EVENT_AUDIENCES, CASE_EVENT_KINDS, CASE_PROVIDER_AUDIENCES,
  COMPLETION_ITEM_OUTCOMES, COMPLETION_STATES, PAID_RECORD_KINDS, PROBLEM_CASE_CATEGORIES, PROBLEM_CASE_STATES, RATING_STATES,
} from "@bookbuddy/domain";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { accountContexts, businessGrants, placeGrants } from "./access";
import { changeItems, quoteItems, quoteVersions } from "./commercial";
import { accounts } from "./identity";
import { jobs } from "./jobs";

// The guarded transitions, append-only history and live authority triggers are in 0009_aftercare.sql.
export const completions = sqliteTable("completions", {
  id: text().notNull().primaryKey(),
  jobId: text("job_id").notNull(),
  baseQuoteVersionId: text("base_quote_version_id").notNull(),
  no: integer().notNull(),
  submitterId: text("submitter_id").notNull().references(() => accounts.id),
  finishedAt: integer("finished_at").notNull(),
  submittedAt: integer("submitted_at").notNull(),
  billReferenceHint: text("bill_reference_hint"),
  billAmountMinor: integer("bill_amount_minor"),
  state: text({ enum: COMPLETION_STATES }).notNull(),
}, (t) => [
  check("completions_no", sql`typeof(${t.no}) = 'integer' AND ${t.no} > 0`),
  check("completions_finished", sql`typeof(${t.finishedAt}) = 'integer'`),
  check("completions_submitted", sql`typeof(${t.submittedAt}) = 'integer' AND ${t.submittedAt} >= ${t.finishedAt}`),
  check("completions_bill", sql`(${t.billReferenceHint} IS NULL AND ${t.billAmountMinor} IS NULL)
    OR (${t.billReferenceHint} IS NOT NULL AND length(trim(${t.billReferenceHint})) BETWEEN 1 AND 500
      AND typeof(${t.billAmountMinor}) = 'integer' AND ${t.billAmountMinor} BETWEEN 1 AND 9007199254740991)`),
  check("completions_state", sql`${t.state} IN ('submitted', 'returned', 'superseded', 'signed_off')`),
  foreignKey({ columns: [t.baseQuoteVersionId, t.jobId], foreignColumns: [quoteVersions.id, quoteVersions.jobId] }),
  unique().on(t.id, t.jobId),
  unique().on(t.jobId, t.no),
  uniqueIndex("completions_current").on(t.jobId).where(sql`${t.state} <> 'superseded'`),
  index("completions_base_quote").on(t.baseQuoteVersionId, t.jobId),
  index("completions_pending_bill_reference").on(t.billReferenceHint, t.jobId)
    .where(sql`${t.state} = 'submitted' AND ${t.billReferenceHint} IS NOT NULL`),
]);

export const completionItems = sqliteTable("completion_items", {
  id: text().notNull().primaryKey(),
  completionId: text("completion_id").notNull().references(() => completions.id),
  quoteVersionId: text("quote_version_id"),
  changeVersionId: text("change_version_id"),
  lineNo: integer("line_no").notNull(),
  outcome: text({ enum: COMPLETION_ITEM_OUTCOMES }).notNull(),
  originalLanguage: text("original_language").notNull(),
  resultNote: text("result_note"),
  notDoneReason: text("not_done_reason"),
  evidenceAlternative: text("evidence_alternative"),
}, (t) => [
  check("completion_items_line", sql`typeof(${t.lineNo}) = 'integer' AND ${t.lineNo} > 0`),
  check("completion_items_outcome", sql`${t.outcome} IN ('done', 'not_done')`),
  check("completion_items_source", sql`(${t.quoteVersionId} IS NULL) <> (${t.changeVersionId} IS NULL)`),
  check("completion_items_explanation", sql`
    (${t.outcome} = 'done' AND ${t.resultNote} IS NOT NULL AND length(trim(${t.resultNote}, char(9, 10, 11, 12, 13, 32))) > 0 AND ${t.notDoneReason} IS NULL)
    OR (${t.outcome} = 'not_done' AND ${t.notDoneReason} IS NOT NULL AND length(trim(${t.notDoneReason}, char(9, 10, 11, 12, 13, 32))) > 0
      AND ${t.resultNote} IS NULL AND ${t.evidenceAlternative} IS NULL)`),
  check("completion_items_alternative", sql`${t.evidenceAlternative} IS NULL OR length(trim(${t.evidenceAlternative}, char(9, 10, 11, 12, 13, 32))) > 0`),
  foreignKey({ columns: [t.quoteVersionId, t.lineNo], foreignColumns: [quoteItems.versionId, quoteItems.lineNo] }),
  foreignKey({ columns: [t.changeVersionId, t.lineNo], foreignColumns: [changeItems.versionId, changeItems.lineNo] }),
  unique().on(t.id, t.completionId),
  uniqueIndex("completion_items_quote").on(t.completionId, t.lineNo).where(sql`${t.quoteVersionId} IS NOT NULL`),
  uniqueIndex("completion_items_change").on(t.completionId, t.changeVersionId, t.lineNo).where(sql`${t.changeVersionId} IS NOT NULL`),
  index("completion_items_completion").on(t.completionId, t.id),
  index("completion_items_quote_source").on(t.quoteVersionId, t.lineNo).where(sql`${t.quoteVersionId} IS NOT NULL`),
  index("completion_items_change_source").on(t.changeVersionId, t.lineNo).where(sql`${t.changeVersionId} IS NOT NULL`),
]);

export const signOffs = sqliteTable("sign_offs", {
  id: text().notNull().primaryKey(),
  jobId: text("job_id").notNull().unique(),
  completionId: text("completion_id").notNull(),
  approverId: text("approver_id").notNull().references(() => accounts.id),
  grantId: text("grant_id").notNull().references(() => placeGrants.id),
  termsHash: text("terms_hash").notNull(),
  at: integer().notNull(),
}, (t) => [
  check("sign_offs_hash", sql`length(${t.termsHash}) > 0`),
  check("sign_offs_at", sql`typeof(${t.at}) = 'integer'`),
  foreignKey({ columns: [t.completionId, t.jobId], foreignColumns: [completions.id, completions.jobId] }),
  index("sign_offs_completion").on(t.completionId, t.jobId),
  index("sign_offs_grant").on(t.grantId),
]);

export const bills = sqliteTable("bills", {
  id: text().notNull().primaryKey(),
  jobId: text("job_id").notNull(),
  businessId: text("business_id").notNull(),
  number: text().notNull(),
  version: integer().notNull(),
  replacesId: text("replaces_id"),
  netMinor: integer("net_minor").notNull(),
  taxMinor: integer("tax_minor").notNull(),
  totalMinor: integer("total_minor").notNull(),
  currency: text({ enum: ["EUR"] }).notNull(),
  providerDocumentRef: text("provider_document_ref"),
  paymentInstructions: text("payment_instructions"),
  lineItems: text("line_items").notNull(),
  issuedAt: integer("issued_at").notNull(),
  dueAt: integer("due_at").notNull(),
  state: text({ enum: BILL_STATES }).notNull(),
}, (t) => [
  check("bills_number", sql`length(trim(${t.number})) > 0`),
  check("bills_version", sql`typeof(${t.version}) = 'integer' AND ${t.version} > 0`),
  check("bills_net", sql`typeof(${t.netMinor}) = 'integer' AND ${t.netMinor} >= 0`),
  check("bills_tax", sql`typeof(${t.taxMinor}) = 'integer' AND ${t.taxMinor} >= 0`),
  check("bills_total", sql`typeof(${t.totalMinor}) = 'integer' AND ${t.totalMinor} > 0 AND ${t.totalMinor} = ${t.netMinor} + ${t.taxMinor}`),
  check("bills_currency", sql`${t.currency} = 'EUR'`),
  check("bills_document", sql`length(trim(${t.providerDocumentRef})) > 0`),
  check("bills_instructions", sql`${t.paymentInstructions} IS NULL
    OR CASE WHEN json_valid(${t.paymentInstructions}) THEN json_type(${t.paymentInstructions}) = 'object' ELSE 0 END`),
  check("bills_line_items", sql`CASE WHEN json_valid(${t.lineItems}) THEN json_array_length(${t.lineItems}) > 0 ELSE 0 END`),
  check("bills_issued_at", sql`typeof(${t.issuedAt}) = 'integer'`),
  check("bills_due_at", sql`typeof(${t.dueAt}) = 'integer' AND ${t.dueAt} >= ${t.issuedAt}`),
  check("bills_state", sql`${t.state} IN ('issued', 'replaced', 'void')`),
  check("bills_version_chain", sql`(${t.version} = 1) = (${t.replacesId} IS NULL)`),
  foreignKey({ columns: [t.jobId, t.businessId], foreignColumns: [jobs.id, jobs.businessId] }),
  foreignKey({ columns: [t.replacesId, t.jobId], foreignColumns: [t.id, t.jobId] }),
  unique().on(t.id, t.jobId),
  unique().on(t.businessId, t.number, t.version),
  uniqueIndex("bills_effective").on(t.jobId).where(sql`${t.state} = 'issued'`),
  uniqueIndex("bills_replaces").on(t.replacesId).where(sql`${t.replacesId} IS NOT NULL`),
  index("bills_job_history").on(t.jobId, t.issuedAt, t.id),
  index("bills_issued_due").on(t.dueAt, t.id).where(sql`${t.state} = 'issued'`),
]);

export const paidRecords = sqliteTable("paid_records", {
  id: text().notNull().primaryKey(),
  billId: text("bill_id").notNull().references(() => bills.id),
  actorId: text("actor_id").notNull().references(() => accounts.id),
  kind: text({ enum: PAID_RECORD_KINDS }).notNull(),
  priorId: text("prior_id"),
  amountMinor: integer("amount_minor"),
  verifiedReference: text("verified_reference"),
  reason: text(),
  at: integer().notNull(),
}, (t) => [
  check("paid_records_kind", sql`${t.kind} IN ('matched', 'checking', 'corrected', 'no_funds_received', 'refund_recorded')`),
  check("paid_records_amount", sql`${t.amountMinor} IS NULL OR (typeof(${t.amountMinor}) = 'integer' AND ${t.amountMinor} > 0)`),
  check("paid_records_reference", sql`${t.verifiedReference} IS NULL OR length(trim(${t.verifiedReference})) > 0`),
  check("paid_records_reason", sql`${t.reason} IS NULL OR length(trim(${t.reason}, char(9, 10, 11, 12, 13, 32))) > 0`),
  check("paid_records_at", sql`typeof(${t.at}) = 'integer'`),
  check("paid_records_content", sql`
    (${t.kind} IN ('matched', 'refund_recorded') AND ${t.amountMinor} IS NOT NULL AND ${t.verifiedReference} IS NOT NULL)
    OR (${t.kind} IN ('checking', 'corrected', 'no_funds_received') AND ${t.amountMinor} IS NULL AND ${t.verifiedReference} IS NULL AND ${t.reason} IS NOT NULL)`),
  foreignKey({ columns: [t.priorId, t.billId], foreignColumns: [t.id, t.billId] }),
  unique().on(t.id, t.billId),
  uniqueIndex("paid_records_bill_root").on(t.billId).where(sql`${t.priorId} IS NULL`),
  uniqueIndex("paid_records_next").on(t.priorId).where(sql`${t.priorId} IS NOT NULL`),
  index("paid_records_bill_time").on(t.billId, t.at, t.id),
]);

export const problemCases = sqliteTable("problem_cases", {
  id: text().notNull().primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id),
  reference: text().notNull().unique(),
  reporterId: text("reporter_id").notNull().references(() => accounts.id),
  caseOwnerId: text("case_owner_id").notNull().references(() => accounts.id),
  category: text({ enum: PROBLEM_CASE_CATEGORIES }).notNull(),
  providerAudience: text("provider_audience", { enum: CASE_PROVIDER_AUDIENCES }),
  billId: text("bill_id"),
  quoteVersionId: text("quote_version_id"),
  changeVersionId: text("change_version_id"),
  lineNo: integer("line_no"),
  state: text({ enum: PROBLEM_CASE_STATES }).notNull(),
  openedAt: integer("opened_at").notNull(),
  acknowledgeBy: integer("acknowledge_by").notNull(),
  firstUpdateBy: integer("first_update_by").notNull(),
  nextUpdateAt: integer("next_update_at"),
}, (t) => [
  check("problem_cases_reference", sql`${t.reference} GLOB 'BB-[A-Z0-9]*' AND substr(${t.reference}, 4) NOT GLOB '*[^A-Z0-9]*'`),
  check("problem_cases_category", sql`${t.category} IN ('quality', 'damage', 'bill', 'timing', 'other')`),
  check("problem_cases_provider_audience", sql`${t.providerAudience} IN ('provider_billing', 'provider_rectification')`),
  check("problem_cases_state", sql`${t.state} IN ('open', 'awaiting_plan', 'resolved', 'closed')`),
  check("problem_cases_opened_at", sql`typeof(${t.openedAt}) = 'integer'`),
  check("problem_cases_acknowledge_by", sql`typeof(${t.acknowledgeBy}) = 'integer' AND ${t.acknowledgeBy} > ${t.openedAt}`),
  check("problem_cases_first_update_by", sql`typeof(${t.firstUpdateBy}) = 'integer' AND ${t.firstUpdateBy} >= ${t.acknowledgeBy}`),
  check("problem_cases_next_update_at", sql`${t.nextUpdateAt} IS NULL OR (typeof(${t.nextUpdateAt}) = 'integer' AND ${t.nextUpdateAt} > ${t.openedAt})`),
  check("problem_cases_scope_line", sql`
    (${t.lineNo} IS NULL AND ${t.quoteVersionId} IS NULL AND ${t.changeVersionId} IS NULL)
    OR (${t.lineNo} IS NOT NULL AND (${t.quoteVersionId} IS NULL) <> (${t.changeVersionId} IS NULL))`),
  check("problem_cases_open_target", sql`(${t.state} IN ('open', 'awaiting_plan')) = (${t.nextUpdateAt} IS NOT NULL)`),
  foreignKey({ columns: [t.billId, t.jobId], foreignColumns: [bills.id, bills.jobId] }),
  foreignKey({ columns: [t.quoteVersionId, t.lineNo], foreignColumns: [quoteItems.versionId, quoteItems.lineNo] }),
  foreignKey({ columns: [t.changeVersionId, t.lineNo], foreignColumns: [changeItems.versionId, changeItems.lineNo] }),
  unique().on(t.id, t.jobId),
  index("problem_cases_job_opened").on(t.jobId, t.openedAt, t.id),
  index("problem_cases_bill").on(t.billId, t.jobId).where(sql`${t.billId} IS NOT NULL`),
  index("problem_cases_quote_line").on(t.quoteVersionId, t.lineNo).where(sql`${t.quoteVersionId} IS NOT NULL`),
  index("problem_cases_change_line").on(t.changeVersionId, t.lineNo).where(sql`${t.changeVersionId} IS NOT NULL`),
  index("problem_cases_owner_due").on(t.caseOwnerId, t.nextUpdateAt, t.id).where(sql`${t.nextUpdateAt} IS NOT NULL`),
  index("problem_cases_due").on(t.nextUpdateAt, t.id).where(sql`${t.nextUpdateAt} IS NOT NULL`),
]);

export const caseEvents = sqliteTable("case_events", {
  id: text().notNull().primaryKey(),
  caseId: text("case_id").notNull(),
  jobId: text("job_id").notNull(),
  actorId: text("actor_id").notNull().references(() => accounts.id),
  kind: text({ enum: CASE_EVENT_KINDS }).notNull(),
  audience: text({ enum: CASE_EVENT_AUDIENCES }).notNull(),
  originalText: text("original_text"),
  originalLanguage: text("original_language"),
  completionId: text("completion_id"),
  at: integer().notNull(),
}, (t) => [
  check("case_events_kind", sql`${t.kind} IN ('reported', 'reporter_update', 'acknowledged', 'substantive_update', 'correction_requested', 'resolved', 'closed', 'provider_packet')`),
  check("case_events_audience", sql`${t.audience} IN ('reporter_and_owner', 'provider_billing', 'provider_rectification')`),
  check("case_events_nonblank", sql`${t.originalText} IS NULL OR length(trim(${t.originalText}, char(9, 10, 11, 12, 13, 32))) > 0`),
  check("case_events_at", sql`typeof(${t.at}) = 'integer'`),
  check("case_events_text", sql`(${t.originalText} IS NULL) = (${t.originalLanguage} IS NULL)
    AND (${t.kind} IN ('acknowledged', 'closed') OR ${t.originalText} IS NOT NULL)`),
  check("case_events_correction", sql`(${t.kind} = 'correction_requested') = (${t.completionId} IS NOT NULL)`),
  check("case_events_provider_packet", sql`(${t.kind} = 'provider_packet') = (${t.audience} <> 'reporter_and_owner')`),
  foreignKey({ columns: [t.caseId, t.jobId], foreignColumns: [problemCases.id, problemCases.jobId] }),
  foreignKey({ columns: [t.completionId, t.jobId], foreignColumns: [completions.id, completions.jobId] }),
  unique().on(t.id, t.caseId),
  uniqueIndex("case_events_report").on(t.caseId).where(sql`${t.kind} = 'reported'`),
  index("case_events_timeline").on(t.caseId, t.audience, t.at, t.id),
  index("case_events_completion").on(t.completionId, t.jobId).where(sql`${t.completionId} IS NOT NULL`),
]);

export const caseGrants = sqliteTable("case_grants", {
  caseId: text("case_id").notNull().references(() => problemCases.id),
  contextId: text("context_id").notNull().references(() => accountContexts.id),
  capability: text({ enum: CASE_PROVIDER_AUDIENCES }).notNull(),
  validFrom: integer("valid_from").notNull(),
  validUntil: integer("valid_until").notNull(),
  revokedAt: integer("revoked_at"),
}, (t) => [
  primaryKey({ columns: [t.caseId, t.contextId, t.capability, t.validFrom] }),
  check("case_grants_capability", sql`${t.capability} IN ('provider_billing', 'provider_rectification')`),
  check("case_grants_valid_from", sql`typeof(${t.validFrom}) = 'integer'`),
  check("case_grants_valid_until", sql`typeof(${t.validUntil}) = 'integer' AND ${t.validUntil} > ${t.validFrom}`),
  check("case_grants_revoked_at", sql`${t.revokedAt} IS NULL OR (typeof(${t.revokedAt}) = 'integer' AND ${t.revokedAt} >= ${t.validFrom})`),
  uniqueIndex("case_grants_current").on(t.caseId, t.contextId, t.capability).where(sql`${t.revokedAt} IS NULL`),
  index("case_grants_context").on(t.contextId, t.caseId, t.capability),
  index("case_grants_due").on(t.validUntil, t.caseId, t.contextId).where(sql`${t.revokedAt} IS NULL`),
]);

export const billDeferrals = sqliteTable("bill_deferrals", {
  id: text().notNull().primaryKey(),
  jobId: text("job_id").notNull(),
  billId: text("bill_id").notNull(),
  caseId: text("case_id").notNull(),
  actorId: text("actor_id").notNull().references(() => accounts.id),
  grantId: text("grant_id").notNull().references(() => businessGrants.id),
  amountMinor: integer("amount_minor").notNull(),
  basis: text().notNull(),
  affectedLineNos: text("affected_line_nos").notNull(),
  at: integer().notNull(),
  reviewAt: integer("review_at").notNull(),
  releasedAt: integer("released_at"),
  releasedBy: text("released_by").references(() => accounts.id),
  releaseGrantId: text("release_grant_id").references(() => businessGrants.id),
  disposition: text({ enum: BILL_DEFERRAL_DISPOSITIONS }),
}, (t) => [
  check("bill_deferrals_amount", sql`typeof(${t.amountMinor}) = 'integer' AND ${t.amountMinor} > 0`),
  check("bill_deferrals_basis", sql`length(trim(${t.basis}, char(9, 10, 11, 12, 13, 32))) > 0`),
  check("bill_deferrals_lines", sql`CASE WHEN json_valid(${t.affectedLineNos}) THEN json_array_length(${t.affectedLineNos}) > 0 ELSE 0 END`),
  check("bill_deferrals_at", sql`typeof(${t.at}) = 'integer'`),
  check("bill_deferrals_review_at", sql`typeof(${t.reviewAt}) = 'integer' AND ${t.reviewAt} > ${t.at}`),
  check("bill_deferrals_disposition_kind", sql`${t.disposition} IN ('resume_collection', 'invoice_correction', 'refund_instruction')`),
  check("bill_deferrals_disposition", sql`
    (${t.releasedAt} IS NULL AND ${t.releasedBy} IS NULL AND ${t.releaseGrantId} IS NULL AND ${t.disposition} IS NULL)
    OR (typeof(${t.releasedAt}) = 'integer' AND ${t.releasedAt} >= ${t.at} AND ${t.releasedBy} IS NOT NULL
      AND ${t.releaseGrantId} IS NOT NULL AND ${t.disposition} IS NOT NULL)`),
  foreignKey({ columns: [t.billId, t.jobId], foreignColumns: [bills.id, bills.jobId] }),
  foreignKey({ columns: [t.caseId, t.jobId], foreignColumns: [problemCases.id, problemCases.jobId] }),
  uniqueIndex("bill_deferrals_active").on(t.billId).where(sql`${t.releasedAt} IS NULL`),
  index("bill_deferrals_bill_history").on(t.billId, t.at, t.id),
  index("bill_deferrals_case").on(t.caseId, t.jobId),
  index("bill_deferrals_grant").on(t.grantId),
  index("bill_deferrals_release_grant").on(t.releaseGrantId).where(sql`${t.releaseGrantId} IS NOT NULL`),
  index("bill_deferrals_review_due").on(t.reviewAt, t.id).where(sql`${t.releasedAt} IS NULL`),
]);

export const ratingEligibilities = sqliteTable("rating_eligibilities", {
  jobId: text("job_id").notNull(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  completionId: text("completion_id").notNull(),
  verifiedBy: text("verified_by").notNull().references(() => accounts.id),
  verifiedAt: integer("verified_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.jobId, t.accountId] }),
  check("rating_eligibilities_verified_at", sql`typeof(${t.verifiedAt}) = 'integer'`),
  check("rating_eligibilities_expires_at", sql`typeof(${t.expiresAt}) = 'integer' AND ${t.expiresAt} > ${t.verifiedAt}`),
  foreignKey({ columns: [t.completionId, t.jobId], foreignColumns: [completions.id, completions.jobId] }),
  index("rating_eligibilities_account_due").on(t.accountId, t.expiresAt, t.jobId),
  index("rating_eligibilities_completion").on(t.completionId, t.jobId),
]);

export const ratings = sqliteTable("ratings", {
  id: text().notNull().primaryKey(),
  jobId: text("job_id").notNull().unique(),
  authorId: text("author_id").notNull().references(() => accounts.id),
  stars: integer().notNull(),
  originalComment: text("original_comment"),
  originalLanguage: text("original_language"),
  submittedAt: integer("submitted_at").notNull(),
  state: text({ enum: RATING_STATES }).notNull(),
}, (t) => [
  check("ratings_stars", sql`typeof(${t.stars}) = 'integer' AND ${t.stars} BETWEEN 1 AND 5`),
  check("ratings_comment", sql`${t.originalComment} IS NULL OR length(trim(${t.originalComment}, char(9, 10, 11, 12, 13, 32))) > 0`),
  check("ratings_submitted_at", sql`typeof(${t.submittedAt}) = 'integer'`),
  check("ratings_state", sql`${t.state} IN ('submitted', 'withdrawn')`),
  check("ratings_language", sql`(${t.originalComment} IS NULL) = (${t.originalLanguage} IS NULL)`),
  foreignKey({ columns: [t.jobId, t.authorId], foreignColumns: [ratingEligibilities.jobId, ratingEligibilities.accountId] }),
  index("ratings_author").on(t.authorId, t.submittedAt, t.id),
]);
