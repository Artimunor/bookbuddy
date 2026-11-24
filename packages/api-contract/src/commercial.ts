import {
  APPROVAL_DECISIONS, CHANGE_VERSION_STATES, COMMERCIAL_REVIEW_STATES, CONTRACT_NOTICE_KINDS,
  CUSTOMER_CHANGE_VERSION_STATES, CUSTOMER_QUOTE_VERSION_STATES, EFFECT_STATES, QUOTE_VERSION_STATES,
} from "@bookbuddy/domain";
import { z } from "zod";
import {
  commandInputSchema, evidenceReferenceSchema, idSchemaFor, localeTagSchema, paginationInputSchema, paginationSchema,
  timestampSchema,
} from "./common";
import { jobIdSchema as jobId } from "./jobs";
import { defineRoute } from "./route";

export const quoteIdSchema = idSchemaFor<"quote">();
export const quoteVersionIdSchema = idSchemaFor<"quote_version">();
export const changeProposalIdSchema = idSchemaFor<"change_proposal">();
export const changeVersionIdSchema = idSchemaFor<"change_version">();
export const termsVersionIdSchema = idSchemaFor<"terms_version">();
const reviewId = idSchemaFor<"commercial_review">();
const decisionId = idSchemaFor<"commercial_decision">();
const noticeId = idSchemaFor<"contract_notice">();
const readingArtifactRef = idSchemaFor<"reading_artifact">();
const jobParams = z.object({ j: jobId });
const quoteVersionParams = z.object({ id: quoteVersionIdSchema });
const changeVersionParams = z.object({ id: changeVersionIdSchema });

const no = z.int().positive();
const displayName = z.string().min(1);
const eur = z.literal("EUR");
const minor = z.int().nonnegative();
const deltaMinor = z.int();
const termsHash = z.string().min(1).max(128);
const originalText = z.string().max(16_000).refine((text) => text.trim().length > 0);
const originalLabel = z.string().max(500).refine((text) => text.trim().length > 0);
const originalExclusions = z.string().max(16_000);
const decision = z.enum(APPROVAL_DECISIONS);
const evidence = z.array(evidenceReferenceSchema);

// This data is assembled in the scoped version read, not fetched per person, place or line item.
const jobHeader = z.object({
  jobId,
  reference: z.string().regex(/^BB-[A-Z0-9]+$/),
  jobTitle: z.string().min(1),
  placeAlias: z.string().min(1),
  siteZone: z.string().min(1),
  providerDisplayName: displayName,
  namedApproverDisplayName: displayName,
});

const terms = z.object({
  id: termsVersionIdSchema,
  version: no,
  providerLegalSnapshot: z.string().min(1),
  originalText: z.string().min(1),
  contractLocale: localeTagSchema,
  consentText: z.string().min(1),
  hash: termsHash,
});

const evidenceAlternative = originalLabel.refine((value) => value.trim().length > 0);
const itemFields = { originalLabel, quantity: no, evidenceRule: originalLabel, evidenceAlternative: evidenceAlternative.optional() };
const quoteDraftItem = z.strictObject({ ...itemFields, netMinor: minor, taxMinor: minor });
const changeDraftItem = z.strictObject({ ...itemFields, netMinor: deltaMinor, taxMinor: deltaMinor });
const quoteItem = quoteDraftItem.extend({ lineNo: no, evidenceAlternative: evidenceAlternative.nullish() });
const changeItem = changeDraftItem.extend({ lineNo: no, evidenceAlternative: evidenceAlternative.nullish() });

const noReadingAid = z.object({ status: z.enum(["original_only", "pending", "unavailable"]) });
const readyReadingAid = z.object({
  status: z.literal("ready"),
  ref: readingArtifactRef,
  locale: localeTagSchema,
  items: z.array(z.object({ lineNo: no, label: z.string().min(1) })),
  termsText: z.string().min(1).nullable(),
});
const quoteReadingAid = z.discriminatedUnion("status", [noReadingAid, readyReadingAid.extend({
  scope: z.string().min(1),
  exclusions: z.string(),
})]);
const changeReadingAid = z.discriminatedUnion("status", [noReadingAid, readyReadingAid.extend({
  text: z.string().min(1),
  timing: z.string().min(1),
  affectedItems: z.string().min(1),
})]);

const commercialDecision = z.object({
  id: decisionId,
  decision,
  termsHash,
  actorDisplayName: displayName,
  at: timestampSchema,
});
const approval = commercialDecision.extend({ decision: z.literal("approve") });
const decline = commercialDecision.extend({ decision: z.literal("decline") });

const quoteSummary = z.object({
  id: quoteVersionIdSchema,
  quoteId: quoteIdSchema,
  no,
  totalMinor: minor.positive(),
  currency: eur,
});
const changeSummary = z.object({
  id: changeVersionIdSchema,
  proposalId: changeProposalIdSchema,
  baseQuoteVersionId: quoteVersionIdSchema,
  no,
  deltaMinor,
  totalMinor: minor,
  currency: eur,
});
const publication = { publisherDisplayName: displayName, issuedAt: timestampSchema, expiresAt: timestampSchema };
const privatePublication = {
  publisherDisplayName: displayName.nullable(), issuedAt: timestampSchema.nullable(), expiresAt: timestampSchema.nullable(),
};
const customerQuoteSummary = quoteSummary.extend({
  ...publication, state: z.enum([...CUSTOMER_QUOTE_VERSION_STATES, "expired"]),
});
const customerChangeSummary = changeSummary.extend({
  ...publication, state: z.enum([...CUSTOMER_CHANGE_VERSION_STATES, "expired"]),
});
const staffQuoteSummary = quoteSummary.extend({
  ...privatePublication, state: z.enum([...QUOTE_VERSION_STATES, "expired"]),
});
const staffChangeSummary = changeSummary.extend({
  ...privatePublication, state: z.enum([...CHANGE_VERSION_STATES, "expired"]),
});

const reviewContext = z.object({ reviewerDisplayName: displayName, backupDisplayName: displayName });
const reviewMetadata = reviewContext.extend({ id: reviewId, submittedAt: timestampSchema, dueAt: timestampSchema });
const reviewState = z.enum(COMMERCIAL_REVIEW_STATES);
export const commercialReviewSchema = z.discriminatedUnion("state", [
  reviewMetadata.extend({ state: reviewState.extract(["pending"]) }),
  reviewMetadata.extend({
    state: reviewState.extract(["returned"]), returnReason: originalLabel,
    resolvedByDisplayName: displayName, resolvedAt: timestampSchema,
  }),
  reviewMetadata.extend({ state: reviewState.extract(["issued"]), resolvedByDisplayName: displayName, resolvedAt: timestampSchema }),
]);

const quoteContent = z.object({
  originalLocale: localeTagSchema,
  scope: originalText,
  exclusions: originalExclusions,
  netMinor: minor,
  taxMinor: minor,
  items: z.array(quoteItem),
  readingAid: quoteReadingAid,
  terms,
  evidence,
});
const approvedBase = customerQuoteSummary.pick({ id: true, no: true, totalMinor: true, currency: true })
  .extend(quoteContent.pick({ originalLocale: true, scope: true, exclusions: true, readingAid: true }).shape)
  .extend({ approval });
const changeContent = z.object({
  approvedBase,
  originalLocale: localeTagSchema,
  originalText,
  timing: originalLabel,
  affectedItems: originalText,
  items: z.array(changeItem),
  readingAid: changeReadingAid,
  terms,
  evidence,
});

const customerAudience = {
  audience: z.literal("customer"),
  job: jobHeader,
  viewerIsNamedApprover: z.boolean(),
  actions: z.object({ approve: z.boolean(), decline: z.boolean() }),
};
const staffAudience = z.enum(["foreman", "reviewer"]);
const staffReview = {
  audience: staffAudience,
  job: jobHeader,
  authorDisplayName: displayName,
  reviewRouting: reviewContext.nullable(),
  review: commercialReviewSchema.nullable(),
  actions: z.object({ createRevision: z.boolean(), submitReview: z.boolean(), return: z.boolean(), issue: z.boolean() }),
};
const quoteReplacement = z.object({ id: quoteVersionIdSchema, no, issuedAt: timestampSchema });
const changeReplacement = z.object({ id: changeVersionIdSchema, no, issuedAt: timestampSchema });

// Only customer-safe, previously issued versions can enter these branches. The scoped read must
// select that branch with SQL visibility predicates, not hand the client a staff projection.
export const customerQuoteVersionSchema = customerQuoteSummary.extend(quoteContent.shape).extend({
  ...customerAudience,
  decision: commercialDecision.nullable(),
  replacedBy: quoteReplacement.nullable(),
  // The approval itself never books a visit. Read the existing scoped schedule when offered.
  hasProposedWindows: z.boolean(),
});
export const customerChangeVersionSchema = customerChangeSummary.extend(changeContent.shape).extend({
  ...customerAudience,
  decision: commercialDecision.nullable(),
  replacedBy: changeReplacement.nullable(),
});
export const staffQuoteVersionSchema = staffQuoteSummary.extend(quoteContent.shape).extend({
  ...staffReview, decision: commercialDecision.nullable(), replacedBy: quoteReplacement.nullable(),
});
export const staffChangeVersionSchema = staffChangeSummary.extend(changeContent.shape).extend({
  ...staffReview, decision: commercialDecision.nullable(), replacedBy: changeReplacement.nullable(),
});
export const quoteVersionSchema = z.discriminatedUnion("audience", [customerQuoteVersionSchema, staffQuoteVersionSchema]);
export const changeVersionSchema = z.discriminatedUnion("audience", [customerChangeVersionSchema, staffChangeVersionSchema]);

const currentTerms = terms.pick({ id: true, version: true }).nullable();

export const quoteVersionListSchema = z.discriminatedUnion("audience", [
  paginationSchema.extend({ audience: z.literal("customer"), versions: z.array(customerQuoteSummary) }),
  paginationSchema.extend({ audience: z.literal("foreman"), versions: z.array(staffQuoteSummary), currentTerms }),
  paginationSchema.extend({ audience: z.literal("reviewer"), versions: z.array(staffQuoteSummary) }),
]);
export const changeVersionListSchema = z.discriminatedUnion("audience", [
  paginationSchema.extend({ audience: z.literal("customer"), versions: z.array(customerChangeSummary) }),
  paginationSchema.extend({ audience: z.literal("foreman"), versions: z.array(staffChangeSummary), currentTerms }),
  paginationSchema.extend({ audience: z.literal("reviewer"), versions: z.array(staffChangeSummary) }),
]);

// P-02 queue entries are visible to the designated reviewer or eligible backup, not all admins.
const reviewQueueEntry = z.object({
  job: jobHeader, authorDisplayName: displayName, review: reviewMetadata.extend({ state: z.literal("pending") }),
});
export const commercialReviewQueueItemSchema = z.discriminatedUnion("kind", [
  reviewQueueEntry.extend({ kind: z.literal("quote"), version: staffQuoteSummary.extend({ state: z.literal("in_review") }) }),
  reviewQueueEntry.extend({ kind: z.literal("change"), version: staffChangeSummary.extend({ state: z.literal("in_review") }) }),
]);

export type QuoteVersion = z.output<typeof quoteVersionSchema>;
export type ChangeVersion = z.output<typeof changeVersionSchema>;
export type QuoteVersionList = z.output<typeof quoteVersionListSchema>;
export type ChangeVersionList = z.output<typeof changeVersionListSchema>;
export type CommercialReview = z.output<typeof commercialReviewSchema>;
export type CommercialReviewQueueItem = z.output<typeof commercialReviewQueueItemSchema>;

const jobListInput = z.object({ params: jobParams, query: paginationInputSchema.optional() });
export const listQuoteVersionsRoute = defineRoute({
  method: "GET", path: "/jobs/:j/quotes", auth: "context", input: jobListInput, output: quoteVersionListSchema,
});
export const listChangeVersionsRoute = defineRoute({
  method: "GET", path: "/jobs/:j/changes", auth: "context", input: jobListInput, output: changeVersionListSchema,
});
export const getQuoteVersionRoute = defineRoute({
  method: "GET", path: "/jobs/:j/quotes/:id", auth: "context",
  input: z.object({ params: jobParams.extend(quoteVersionParams.shape) }), output: quoteVersionSchema,
});
export const getChangeVersionRoute = defineRoute({
  method: "GET", path: "/jobs/:j/changes/:id", auth: "context",
  input: z.object({ params: jobParams.extend(changeVersionParams.shape) }), output: changeVersionSchema,
});

function commandRoute<
  const Path extends `/${string}`, Params extends z.ZodType<Record<string, string>>,
  Payload extends z.ZodType, Output extends z.ZodType,
>(path: Path, params: Params, payload: Payload, output: Output) {
  return defineRoute({
    method: "POST", path, auth: "context", command: true,
    input: z.object({ params, body: commandInputSchema(payload) }), output,
  });
}

// The caller supplies a stable new version ID, never the actor, the assigned publisher, an
// acceptance or legal wording. Validate terms and ready evidence against job scope in the batch.
const draftFields = { termsVersionId: termsVersionIdSchema, originalLocale: localeTagSchema, evidence: evidence.max(20) };
export const createQuoteVersionPayloadSchema = z.strictObject({
  ...draftFields,
  id: quoteVersionIdSchema,
  scope: originalText,
  exclusions: originalExclusions,
  items: z.array(quoteDraftItem).min(1).max(100).refine((items) => {
    const total = items.reduce((sum, item) => sum + item.netMinor + item.taxMinor, 0);
    return Number.isSafeInteger(total) && total > 0;
  }),
});
export const createChangeVersionPayloadSchema = z.strictObject({
  ...draftFields,
  id: changeVersionIdSchema,
  proposalId: changeProposalIdSchema,
  baseQuoteVersionId: quoteVersionIdSchema,
  originalText,
  timing: originalLabel,
  affectedItems: originalText,
  items: z.array(changeDraftItem).min(1).max(100),
});
export const createQuoteVersionRoute = commandRoute("/jobs/:j/quote-versions", jobParams, createQuoteVersionPayloadSchema, staffQuoteVersionSchema);
export const createChangeVersionRoute = commandRoute("/jobs/:j/change-versions", jobParams, createChangeVersionPayloadSchema, staffChangeVersionSchema);

const submitReview = z.strictObject({});
const returnForChanges = z.strictObject({ reason: originalLabel });
const issueVersion = z.strictObject({ termsHash });
const decideVersion = z.strictObject({ termsHash, readingArtifactRef: readingArtifactRef.optional() });

// Only the author can submit. Return uses named review authority. Issue uses a separate live
// publisher grant and recomputes expiry from server time and the site/affected-work schedule.
// Issue must also scope the exact current snapshot and recheck capacity; it does not move a visit.
// Replace a prior issued version atomically; never replace the accepted quote or reissue an accepted proposal.
export const submitQuoteReviewRoute = commandRoute("/quote-versions/:id/submit-review", quoteVersionParams, submitReview, staffQuoteVersionSchema);
export const returnQuoteVersionRoute = commandRoute("/quote-versions/:id/return", quoteVersionParams, returnForChanges, staffQuoteVersionSchema);
export const issueQuoteVersionRoute = commandRoute("/quote-versions/:id/issue", quoteVersionParams, issueVersion, staffQuoteVersionSchema);
export const submitChangeReviewRoute = commandRoute("/change-versions/:id/submit-review", changeVersionParams, submitReview, staffChangeVersionSchema);
export const returnChangeVersionRoute = commandRoute("/change-versions/:id/return", changeVersionParams, returnForChanges, staffChangeVersionSchema);
export const issueChangeVersionRoute = commandRoute("/change-versions/:id/issue", changeVersionParams, issueVersion, staffChangeVersionSchema);

// Version and terms are taken from the exact view displayed to the approver. A stale version is
// rejected, never redirected into a decision on a different version. Change decline records rejection.
export const approveQuoteVersionRoute = commandRoute("/quote-versions/:id/approve", quoteVersionParams, decideVersion,
  customerQuoteVersionSchema.extend({ state: z.literal("approved"), decision: approval }));
export const declineQuoteVersionRoute = commandRoute("/quote-versions/:id/decline", quoteVersionParams, decideVersion,
  customerQuoteVersionSchema.extend({ decision: decline }));
export const approveChangeVersionRoute = commandRoute("/change-versions/:id/approve", changeVersionParams, decideVersion,
  customerChangeVersionSchema.extend({ state: z.literal("approved"), decision: approval }));
export const declineChangeVersionRoute = commandRoute("/change-versions/:id/decline", changeVersionParams, decideVersion,
  customerChangeVersionSchema.extend({ decision: decline }));

const exactContract = z.strictObject({ quoteVersionId: quoteVersionIdSchema, termsHash });
const noticeKind = z.enum(CONTRACT_NOTICE_KINDS);
export const contractNoticeReceiptSchema = z.object({
  id: noticeId,
  jobId,
  quoteVersionId: quoteVersionIdSchema,
  termsHash,
  kind: noticeKind,
  actorDisplayName: displayName,
  at: timestampSchema,
});
export type ContractNoticeReceipt = z.output<typeof contractNoticeReceiptSchema>;

export const contractNoticeSchema = contractNoticeReceiptSchema.extend({
  noticeText: z.string(),
  deliveryState: z.enum(EFFECT_STATES).nullable(),
});
export type ContractNotice = z.output<typeof contractNoticeSchema>;

export const listContractNoticesRoute = defineRoute({
  method: "GET", path: "/jobs/:j/contract/notices", auth: "context",
  input: z.object({ params: jobParams }), output: z.object({ notices: z.array(contractNoticeSchema) }),
});

// Applicability and entitled party come from the configured contract and live scope. Withdrawal
// is a notice, not an appointment command or a request for the provider's permission.
export const requestEarlyStartRoute = commandRoute("/jobs/:j/contract/early-start", jobParams,
  exactContract.extend({ acknowledgement: z.literal(true).optional() }), z.object({
    request: contractNoticeReceiptSchema.extend({ kind: noticeKind.extract(["early_start_request"]) }),
    acknowledgement: contractNoticeReceiptSchema.extend({ kind: noticeKind.extract(["early_start_acknowledgement"]) }).nullable(),
  }));
export const withdrawContractRoute = commandRoute("/jobs/:j/contract/withdrawal", jobParams, exactContract,
  contractNoticeReceiptSchema.extend({ kind: noticeKind.extract(["withdrawal"]) }));
