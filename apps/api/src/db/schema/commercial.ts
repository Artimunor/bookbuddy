import {
  APPROVAL_DECISIONS, CHANGE_VALIDITY_MS, CHANGE_VERSION_STATES, COMMERCIAL_REVIEW_STATES, CONTRACT_NOTICE_KINDS,
  QUOTE_VERSION_STATES,
} from "@bookbuddy/domain";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { businesses, placeGrants } from "./access";
import { accounts } from "./identity";
import { jobs } from "./jobs";

// Snapshot, exact-decision and append-only triggers live in 0005_commercial.sql.
export const termsVersions = sqliteTable("terms_versions", {
  id: text().notNull().primaryKey(),
  businessId: text("business_id").notNull().references(() => businesses.id),
  version: integer().notNull(),
  providerLegalSnapshot: text("provider_legal_snapshot").notNull(),
  originalText: text("original_text").notNull(),
  contractLocale: text("contract_locale").notNull(),
  consentText: text("consent_text").notNull(),
  hash: text().notNull(),
}, (t) => [
  check("terms_versions_version", sql`typeof(${t.version}) = 'integer' AND ${t.version} > 0`),
  check("terms_versions_hash", sql`length(${t.hash}) > 0`),
  unique().on(t.id, t.businessId),
  index("terms_versions_business_version").on(t.businessId, t.version, t.id),
]);

export const quotes = sqliteTable("quotes", {
  id: text().notNull().primaryKey(),
  jobId: text("job_id").notNull().unique().references(() => jobs.id),
}, (t) => [unique().on(t.id, t.jobId)]);

export const quoteVersions = sqliteTable("quote_versions", {
  id: text().notNull().primaryKey(),
  quoteId: text("quote_id").notNull(),
  jobId: text("job_id").notNull(),
  businessId: text("business_id").notNull(),
  no: integer().notNull(),
  authorId: text("author_id").notNull().references(() => accounts.id),
  publisherId: text("publisher_id").references(() => accounts.id),
  termsId: text("terms_id").notNull(),
  originalLocale: text("original_locale").notNull(),
  scope: text().notNull(),
  exclusions: text().notNull(),
  netMinor: integer("net_minor").notNull(),
  taxMinor: integer("tax_minor").notNull(),
  totalMinor: integer("total_minor").notNull(),
  currency: text({ enum: ["EUR"] }).notNull(),
  issuedAt: integer("issued_at"),
  expiresAt: integer("expires_at"),
  state: text({ enum: QUOTE_VERSION_STATES }).notNull(),
}, (t) => [
  check("quote_versions_no", sql`typeof(${t.no}) = 'integer' AND ${t.no} > 0`),
  check("quote_versions_net", sql`typeof(${t.netMinor}) = 'integer' AND ${t.netMinor} >= 0`),
  check("quote_versions_tax", sql`typeof(${t.taxMinor}) = 'integer' AND ${t.taxMinor} >= 0`),
  check("quote_versions_total", sql`typeof(${t.totalMinor}) = 'integer' AND ${t.totalMinor} > 0 AND ${t.totalMinor} = ${t.netMinor} + ${t.taxMinor}`),
  check("quote_versions_currency", sql`${t.currency} = 'EUR'`),
  check("quote_versions_state", sql`${t.state} IN ('draft', 'in_review', 'returned', 'issued', 'approved', 'declined', 'superseded', 'withdrawn')`),
  check("quote_versions_publication", sql`
    (${t.state} IN ('draft', 'in_review', 'returned') AND ${t.publisherId} IS NULL AND ${t.issuedAt} IS NULL AND ${t.expiresAt} IS NULL)
    OR (${t.state} NOT IN ('draft', 'in_review', 'returned') AND ${t.publisherId} IS NOT NULL
        AND typeof(${t.issuedAt}) = 'integer' AND typeof(${t.expiresAt}) = 'integer' AND ${t.expiresAt} > ${t.issuedAt})`),
  foreignKey({ columns: [t.quoteId, t.jobId], foreignColumns: [quotes.id, quotes.jobId] }),
  foreignKey({ columns: [t.jobId, t.businessId], foreignColumns: [jobs.id, jobs.businessId] }),
  foreignKey({ columns: [t.termsId, t.businessId], foreignColumns: [termsVersions.id, termsVersions.businessId] }),
  unique().on(t.quoteId, t.no),
  unique().on(t.id, t.jobId),
  uniqueIndex("quote_versions_live").on(t.quoteId).where(sql`${t.state} IN ('issued', 'approved')`),
  index("quote_versions_due").on(t.expiresAt, t.id).where(sql`${t.state} = 'issued'`),
  index("quote_versions_job").on(t.jobId, t.businessId),
  index("quote_versions_terms").on(t.termsId, t.businessId),
]);

export const quoteItems = sqliteTable("quote_items", {
  versionId: text("version_id").notNull().references(() => quoteVersions.id),
  lineNo: integer("line_no").notNull(),
  originalLabel: text("original_label").notNull(),
  quantity: integer().notNull(),
  netMinor: integer("net_minor").notNull(),
  taxMinor: integer("tax_minor").notNull(),
  evidenceRule: text("evidence_rule").notNull(),
  evidenceAlternative: text("evidence_alternative"),
}, (t) => [
  primaryKey({ columns: [t.versionId, t.lineNo] }),
  check("quote_items_line", sql`typeof(${t.lineNo}) = 'integer' AND ${t.lineNo} > 0`),
  check("quote_items_quantity", sql`typeof(${t.quantity}) = 'integer' AND ${t.quantity} > 0`),
  check("quote_items_net", sql`typeof(${t.netMinor}) = 'integer' AND ${t.netMinor} >= 0`),
  check("quote_items_tax", sql`typeof(${t.taxMinor}) = 'integer' AND ${t.taxMinor} >= 0`),
  check("quote_items_evidence_alternative", sql`${t.evidenceAlternative} IS NULL OR length(trim(${t.evidenceAlternative}, char(9, 10, 11, 12, 13, 32))) > 0`),
]);

export const changeProposals = sqliteTable("change_proposals", {
  id: text().notNull().primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id),
  baseQuoteVersionId: text("base_quote_version_id").notNull(),
}, (t) => [
  foreignKey({ columns: [t.baseQuoteVersionId, t.jobId], foreignColumns: [quoteVersions.id, quoteVersions.jobId] }),
  unique().on(t.id, t.jobId),
  index("change_proposals_job").on(t.jobId, t.id),
  index("change_proposals_base").on(t.baseQuoteVersionId, t.jobId),
]);

export const changeVersions = sqliteTable("change_versions", {
  id: text().notNull().primaryKey(),
  proposalId: text("proposal_id").notNull(),
  jobId: text("job_id").notNull(),
  businessId: text("business_id").notNull(),
  no: integer().notNull(),
  authorId: text("author_id").notNull().references(() => accounts.id),
  publisherId: text("publisher_id").references(() => accounts.id),
  termsId: text("terms_id").notNull(),
  originalLocale: text("original_locale").notNull(),
  originalText: text("original_text").notNull(),
  deltaMinor: integer("delta_minor").notNull(),
  totalMinor: integer("total_minor").notNull(),
  timing: text().notNull(),
  affectedItems: text("affected_items").notNull(),
  createdAt: integer("created_at").notNull(),
  issuedAt: integer("issued_at"),
  expiresAt: integer("expires_at"),
  state: text({ enum: CHANGE_VERSION_STATES }).notNull(),
}, (t) => [
  check("change_versions_no", sql`typeof(${t.no}) = 'integer' AND ${t.no} > 0`),
  check("change_versions_delta", sql`typeof(${t.deltaMinor}) = 'integer'`),
  check("change_versions_total", sql`typeof(${t.totalMinor}) = 'integer' AND ${t.totalMinor} >= 0`),
  check("change_versions_created_at", sql`typeof(${t.createdAt}) = 'integer'`),
  check("change_versions_state", sql`${t.state} IN ('draft', 'in_review', 'returned', 'issued', 'approved', 'rejected', 'superseded', 'withdrawn')`),
  check("change_versions_publication", sql`
    (${t.state} IN ('draft', 'in_review', 'returned') AND ${t.publisherId} IS NULL AND ${t.issuedAt} IS NULL AND ${t.expiresAt} IS NULL)
    OR (${t.state} NOT IN ('draft', 'in_review', 'returned') AND ${t.publisherId} IS NOT NULL
        AND typeof(${t.issuedAt}) = 'integer' AND typeof(${t.expiresAt}) = 'integer'
        AND ${t.issuedAt} >= ${t.createdAt} AND ${t.expiresAt} > ${t.issuedAt}
        AND ${t.expiresAt} - ${t.issuedAt} <= ${sql.raw(String(CHANGE_VALIDITY_MS))})`),
  foreignKey({ columns: [t.proposalId, t.jobId], foreignColumns: [changeProposals.id, changeProposals.jobId] }),
  foreignKey({ columns: [t.jobId, t.businessId], foreignColumns: [jobs.id, jobs.businessId] }),
  foreignKey({ columns: [t.termsId, t.businessId], foreignColumns: [termsVersions.id, termsVersions.businessId] }),
  unique().on(t.proposalId, t.no),
  uniqueIndex("change_versions_live").on(t.proposalId).where(sql`${t.state} = 'issued'`),
  index("change_versions_due").on(t.expiresAt, t.id).where(sql`${t.state} = 'issued'`),
  index("change_versions_job").on(t.jobId, t.businessId),
  index("change_versions_job_created").on(t.jobId, t.createdAt, t.id),
  index("change_versions_terms").on(t.termsId, t.businessId),
]);

export const changeItems = sqliteTable("change_items", {
  versionId: text("version_id").notNull().references(() => changeVersions.id),
  lineNo: integer("line_no").notNull(),
  originalLabel: text("original_label").notNull(),
  quantity: integer().notNull(),
  netMinor: integer("net_minor").notNull(),
  taxMinor: integer("tax_minor").notNull(),
  evidenceRule: text("evidence_rule").notNull(),
  evidenceAlternative: text("evidence_alternative"),
}, (t) => [
  primaryKey({ columns: [t.versionId, t.lineNo] }),
  check("change_items_line", sql`typeof(${t.lineNo}) = 'integer' AND ${t.lineNo} > 0`),
  check("change_items_quantity", sql`typeof(${t.quantity}) = 'integer' AND ${t.quantity} > 0`),
  check("change_items_net", sql`typeof(${t.netMinor}) = 'integer'`),
  check("change_items_tax", sql`typeof(${t.taxMinor}) = 'integer'`),
  check("change_items_evidence_alternative", sql`${t.evidenceAlternative} IS NULL OR length(trim(${t.evidenceAlternative}, char(9, 10, 11, 12, 13, 32))) > 0`),
]);

export const commercialReviews = sqliteTable("commercial_reviews", {
  id: text().notNull().primaryKey(),
  quoteVersionId: text("quote_version_id").references(() => quoteVersions.id),
  changeVersionId: text("change_version_id").references(() => changeVersions.id),
  reviewerId: text("reviewer_id").notNull().references(() => accounts.id),
  backupId: text("backup_id").notNull().references(() => accounts.id),
  submittedAt: integer("submitted_at").notNull(),
  dueAt: integer("due_at").notNull(),
  resolvedById: text("resolved_by_id").references(() => accounts.id),
  resolvedAt: integer("resolved_at"),
  returnReason: text("return_reason"),
  state: text({ enum: COMMERCIAL_REVIEW_STATES }).notNull(),
}, (t) => [
  check("commercial_reviews_submitted", sql`typeof(${t.submittedAt}) = 'integer'`),
  check("commercial_reviews_due", sql`typeof(${t.dueAt}) = 'integer' AND ${t.dueAt} > ${t.submittedAt}`),
  check("commercial_reviews_state", sql`${t.state} IN ('pending', 'returned', 'issued')`),
  check("commercial_reviews_version", sql`(${t.quoteVersionId} IS NULL) <> (${t.changeVersionId} IS NULL)`),
  check("commercial_reviews_distinct", sql`${t.reviewerId} <> ${t.backupId}`),
  check("commercial_reviews_resolution", sql`
    (${t.state} = 'pending' AND ${t.resolvedById} IS NULL AND ${t.resolvedAt} IS NULL AND ${t.returnReason} IS NULL)
    OR (${t.state} IN ('returned', 'issued') AND ${t.resolvedById} IS NOT NULL AND typeof(${t.resolvedAt}) = 'integer'
      AND ${t.resolvedAt} >= ${t.submittedAt} AND (
        (${t.state} = 'returned' AND ${t.returnReason} IS NOT NULL AND length(trim(${t.returnReason})) > 0)
        OR (${t.state} = 'issued' AND ${t.returnReason} IS NULL)))`),
  uniqueIndex("commercial_reviews_quote").on(t.quoteVersionId).where(sql`${t.quoteVersionId} IS NOT NULL`),
  uniqueIndex("commercial_reviews_change").on(t.changeVersionId).where(sql`${t.changeVersionId} IS NOT NULL`),
  index("commercial_reviews_reviewer_due").on(t.reviewerId, t.state, t.dueAt, t.id),
  index("commercial_reviews_backup_due").on(t.backupId, t.state, t.dueAt, t.id),
]);

export const approvals = sqliteTable("approvals", {
  id: text().notNull().primaryKey(),
  quoteVersionId: text("quote_version_id").references(() => quoteVersions.id),
  changeVersionId: text("change_version_id").references(() => changeVersions.id),
  accountId: text("account_id").notNull().references(() => accounts.id),
  grantId: text("grant_id").notNull().references(() => placeGrants.id),
  termsHash: text("terms_hash").notNull(),
  readingArtifactRef: text("reading_artifact_ref"),
  decision: text({ enum: APPROVAL_DECISIONS }).notNull(),
  at: integer().notNull(),
}, (t) => [
  check("approvals_decision", sql`${t.decision} IN ('approve', 'decline')`),
  check("approvals_at", sql`typeof(${t.at}) = 'integer'`),
  check("approvals_version", sql`(${t.quoteVersionId} IS NULL) <> (${t.changeVersionId} IS NULL)`),
  uniqueIndex("approvals_quote").on(t.quoteVersionId).where(sql`${t.quoteVersionId} IS NOT NULL`),
  uniqueIndex("approvals_change").on(t.changeVersionId).where(sql`${t.changeVersionId} IS NOT NULL`),
  index("approvals_grant").on(t.grantId),
]);

export const contractNotices = sqliteTable("contract_notices", {
  id: text().notNull().primaryKey(),
  jobId: text("job_id").notNull(),
  quoteVersionId: text("quote_version_id").notNull(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  termsHash: text("terms_hash").notNull(),
  kind: text({ enum: CONTRACT_NOTICE_KINDS }).notNull(),
  at: integer().notNull(),
  noticeText: text("notice_text"),
  noticeLocale: text("notice_locale"),
}, (t) => [
  check("contract_notices_kind", sql`${t.kind} IN ('early_start_request', 'early_start_acknowledgement', 'withdrawal')`),
  check("contract_notices_at", sql`typeof(${t.at}) = 'integer'`),
  check("contract_notices_statement", sql`
    (${t.kind} <> 'withdrawal' AND ${t.noticeText} IS NULL AND ${t.noticeLocale} IS NULL)
    OR (${t.kind} = 'withdrawal' AND ${t.noticeText} IS NOT NULL AND ${t.noticeLocale} IS NOT NULL
      AND length(${t.noticeText}) <= 16000 AND length(trim(${t.noticeText}, char(9, 10, 11, 12, 13, 32))) > 0
      AND length(${t.noticeLocale}) BETWEEN 1 AND 255)`),
  foreignKey({ columns: [t.quoteVersionId, t.jobId], foreignColumns: [quoteVersions.id, quoteVersions.jobId] }),
  unique().on(t.quoteVersionId, t.kind),
  index("contract_notices_job_time").on(t.jobId, t.at, t.id),
]);
