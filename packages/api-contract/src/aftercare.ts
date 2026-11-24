import {
  BILL_DEFERRAL_DISPOSITIONS, BILL_PAYMENT_STATUSES, BILL_STATES, CASE_EVENT_KINDS, CASE_PROVIDER_AUDIENCES,
  COMPLETION_STATES, PAID_RECORD_KINDS, PROBLEM_CASE_CATEGORIES, PROBLEM_CASE_STATES, RATING_STATES,
} from "@bookbuddy/domain";
import { z } from "zod";
import { changeVersionIdSchema, quoteVersionIdSchema } from "./commercial";
import {
  attachmentIdSchema, businessIdSchema, commandInputSchema, idSchemaFor, localeTagSchema, paginationInputSchema, paginationSchema,
  revisionSchema, timestampSchema,
} from "./common";
import { jobIdSchema } from "./jobs";
import { defineRoute } from "./route";

export const completionIdSchema = idSchemaFor<"completion">();
export const completionItemIdSchema = idSchemaFor<"completion_item">();
export const signOffIdSchema = idSchemaFor<"sign_off">();
export const billIdSchema = idSchemaFor<"bill">();
export const paidRecordIdSchema = idSchemaFor<"paid_record">();
export const caseIdSchema = idSchemaFor<"case">();
export const caseEventIdSchema = idSchemaFor<"case_event">();
export const billDeferralIdSchema = idSchemaFor<"bill_deferral">();
export const ratingIdSchema = idSchemaFor<"rating">();
const providerDocumentRef = idSchemaFor<"provider_document">();
const jobParams = z.strictObject({ j: jobIdSchema });
const completionParams = z.strictObject({ id: completionIdSchema });
const billParams = z.strictObject({ id: billIdSchema });
const caseParams = z.strictObject({ id: caseIdSchema });

const no = z.int().positive();
const minor = z.int().nonnegative();
const positiveMinor = z.int().positive();
const currency = z.literal("EUR");
const name = z.string().min(1);
const reference = z.string().regex(/^BB-[A-Z0-9]+$/);
const shortText = z.string().max(500).refine((value) => value.trim().length > 0);
const longText = z.string().max(4_000).refine((value) => value.trim().length > 0);
const termsHash = z.string().min(1).max(128);
const job = z.strictObject({
  jobId: jobIdSchema, reference, title: name.nullable(), placeAlias: name, siteZone: name, providerDisplayName: name,
});
const stamp = z.strictObject({ at: timestampSchema, actorDisplayName: name });
const original = z.strictObject({ language: localeTagSchema, text: longText });
const reading = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ready"), language: localeTagSchema, text: name }),
  z.strictObject({ status: z.enum(["pending", "unavailable"]) }),
]);
const authored = z.strictObject({ original, reading: reading.nullable() });
const shownPhoto = z.strictObject({
  attachmentId: attachmentIdSchema, availability: z.enum(["available", "unavailable"]),
  capturedAt: timestampSchema.nullable(), caption: authored.nullable(),
});
const shownCaseEvidence = z.discriminatedUnion("kind", [
  shownPhoto.extend({ kind: z.literal("photo") }),
  z.strictObject({
    kind: z.literal("voice"), attachmentId: attachmentIdSchema, availability: z.enum(["available", "unavailable"]),
    durationMs: no.max(90_000),
  }),
]);
const caseEvidenceIds = z.array(attachmentIdSchema).max(6).refine((ids) => new Set(ids).size === ids.length);

export const approvedScopeLineReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("quote"), quoteVersionId: quoteVersionIdSchema, lineNo: no }),
  z.strictObject({ kind: z.literal("change"), changeVersionId: changeVersionIdSchema, lineNo: no }),
]);
const scopeLine = z.strictObject({
  ref: approvedScopeLineReferenceSchema, label: authored, evidenceRule: shortText, evidenceAlternative: shortText.nullish(),
});
const approvedScope = z.strictObject({
  quoteVersionId: quoteVersionIdSchema, version: no, termsHash, totalMinor: minor, currency,
  scope: authored.extend({ original: original.extend({ text: z.string().min(1).max(16_000) }) }),
  exclusions: authored.extend({ original: original.extend({ text: z.string().min(1).max(16_000) }) }).nullable(),
  lines: z.array(scopeLine),
});
const completionItemFields = {
  id: completionItemIdSchema, scope: approvedScopeLineReferenceSchema, photos: z.array(shownPhoto).max(8),
};
const completionItem = z.discriminatedUnion("outcome", [
  z.strictObject({ ...completionItemFields, outcome: z.literal("done"), result: authored, evidenceAlternative: authored.nullable() }),
  z.strictObject({ ...completionItemFields, outcome: z.literal("not_done"), reason: authored }),
]);
const completionState = z.enum(COMPLETION_STATES);
const completionVersion = z.strictObject({
  id: completionIdSchema, version: no, state: completionState, submitted: stamp, finishedAt: timestampSchema,
});
const completionSubmission = completionVersion.extend({ items: z.array(completionItem) });
const completionWithBill = completionSubmission.extend({ billReference: shortText.nullable(), billAmountMinor: positiveMinor.nullable() });
export const signOffReceiptSchema = stamp.extend({
  id: signOffIdSchema, completionId: completionIdSchema, completionVersion: no, quoteVersionId: quoteVersionIdSchema, termsHash,
});
const caseLink = z.strictObject({ id: caseIdSchema, reference, state: z.enum(PROBLEM_CASE_STATES) });
const completionFields = {
  job, approvedScope, namedApproverDisplayName: name, history: z.array(completionVersion),
  signOff: signOffReceiptSchema.nullable(), openCases: z.array(caseLink),
};
export const customerCompletionSchema = z.strictObject({
  audience: z.literal("customer"), ...completionFields, submission: completionSubmission.nullable(),
  actions: z.strictObject({ signOff: z.boolean(), seeBill: z.boolean(), reportProblem: z.boolean() }),
});
export const foremanCompletionSchema = z.strictObject({
  audience: z.literal("foreman"), ...completionFields,
  approvedScope: approvedScope.extend({ netMinor: z.int().optional(), taxMinor: z.int().optional() }),
  submission: completionWithBill.nullable(),
  work: z.strictObject({ finishedAt: timestampSchema, crewCheckedOutAt: timestampSchema.nullable() }).nullable(),
  correction: stamp.extend({ caseId: caseIdSchema, reason: authored }).nullable(),
  actions: z.strictObject({
    submit: z.boolean(), messageApprover: z.boolean(),
    // Billing uses a separate provider-admin context, not this foreman context.
    canIssueBill: z.boolean().optional(),
  }),
});
export const completionProjectionSchema = z.discriminatedUnion("audience", [customerCompletionSchema, foremanCompletionSchema]);

const invoiceLineFields = { originalLabel: shortText, originalLanguage: localeTagSchema, netMinor: z.int(), taxMinor: z.int() };
const invoiceLine = z.strictObject(invoiceLineFields);
const paymentInstructions = z.strictObject({ instructions: original, reference: shortText });
const billSummary = z.strictObject({
  id: billIdSchema, number: shortText, version: no, state: z.enum(BILL_STATES), replacesId: billIdSchema.nullable(),
  netMinor: minor, taxMinor: minor, totalMinor: positiveMinor, currency, issuedAt: timestampSchema, dueAt: timestampSchema,
});
const paymentStamp = stamp.extend({ id: paidRecordIdSchema, priorId: paidRecordIdSchema.nullable(), actorRole: z.literal("provider_admin") });
const paymentKind = z.enum(PAID_RECORD_KINDS);
const matchedStamp = paymentStamp.extend({ kind: z.literal("matched"), amountMinor: positiveMinor, corrected: z.boolean() });
const checkingStamp = paymentStamp.extend({ kind: paymentKind.extract(["checking", "corrected"]), reason: shortText });
const noFundsStamp = paymentStamp.extend({ kind: z.literal("no_funds_received"), reason: shortText });
const refundStamp = paymentStamp.extend({ kind: z.literal("refund_recorded"), amountMinor: positiveMinor, reason: shortText.nullable() });
const publicPaymentStamp = z.discriminatedUnion("kind", [matchedStamp, checkingStamp, noFundsStamp, refundStamp]);
const providerPaymentStamp = z.discriminatedUnion("kind", [
  matchedStamp.extend({ verifiedReference: shortText }), checkingStamp, noFundsStamp, refundStamp.extend({ verifiedReference: shortText }),
]);
const paymentStatus = z.enum(BILL_PAYMENT_STATUSES);
export const billPaymentOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: paymentStatus.extract(["due"]), record: noFundsStamp.nullable() }),
  z.strictObject({ status: paymentStatus.extract(["checking"]), record: z.union([checkingStamp, refundStamp]) }),
  z.strictObject({ status: paymentStatus.extract(["paid"]), record: matchedStamp.extend({ corrected: z.literal(false) }) }),
]);
const deferralDisposition = z.enum(BILL_DEFERRAL_DISPOSITIONS);
const deferral = stamp.extend({
  id: billDeferralIdSchema, caseId: caseIdSchema.nullable(), amountMinor: positiveMinor, reviewAt: timestampSchema,
});
const providerDeferral = deferral.extend({
  basis: shortText, affectedLineNos: z.array(no).min(1).max(100),
  release: stamp.extend({ disposition: deferralDisposition }).nullable(),
});
const safeBill = billSummary.extend({ outcome: billPaymentOutcomeSchema, activeDeferral: deferral.nullable() })
  .refine(({ activeDeferral, state, outcome, totalMinor }) => activeDeferral === null
    || (state === "issued" && outcome.status === "due" && activeDeferral.amountMinor <= totalMinor), { path: ["activeDeferral"] });

// F-05 consumes the same effective outcome as C-11/P-02 without getting a document URL,
// payment instructions, transfer reference, or a payment action.
export const foremanBillSummarySchema = safeBill;
export const providerBillSummarySchema = safeBill.safeExtend({
  actions: z.strictObject({
    recordPaid: z.boolean(), correctPayment: z.boolean(), recordChecking: z.boolean(), confirmNoFunds: z.boolean(),
    deferCollection: z.boolean(), releaseDeferral: z.boolean(),
  }),
});
const customerBill = safeBill.safeExtend({
  lines: z.array(invoiceLine.extend({ lineNo: no, labelReading: reading.nullable() })).min(1),
  matchesApprovedScope: z.boolean(),
  // Short-lived, authorised document read only; this is never a payment or bank link.
  documentUrl: z.url({ protocol: /^https$/ }).nullable(),
  paymentInstructions: paymentInstructions.nullable(), history: z.array(publicPaymentStamp), openCases: z.array(caseLink),
}).refine(({ paymentInstructions: instructions, state, outcome, activeDeferral, totalMinor }) => instructions === null
  || (state === "issued" && outcome.status === "due" && (activeDeferral === null || activeDeferral.amountMinor < totalMinor)), {
  path: ["paymentInstructions"],
});
const billFields = { job, signOff: signOffReceiptSchema.nullable() };
export const customerBillProjectionSchema = z.strictObject({
  audience: z.literal("customer"), ...billFields, bill: customerBill.nullable(), priorBills: z.array(billSummary),
});
export const foremanBillProjectionSchema = z.strictObject({
  audience: z.literal("foreman"), ...billFields, bill: foremanBillSummarySchema.nullable(),
});
export const providerBillProjectionSchema = z.strictObject({
  audience: z.literal("provider_admin"), ...billFields,
  bill: providerBillSummarySchema.safeExtend({ history: z.array(providerPaymentStamp), deferrals: z.array(providerDeferral) }).nullable(),
});
export const billProjectionSchema = z.discriminatedUnion("audience", [
  customerBillProjectionSchema, foremanBillProjectionSchema, providerBillProjectionSchema,
]);

const caseCategory = z.enum(PROBLEM_CASE_CATEGORIES);
const providerAudience = z.enum(CASE_PROVIDER_AUDIENCES);
const caseEventKind = z.enum(CASE_EVENT_KINDS);
const caseReceipt = caseLink.extend({
  category: caseCategory, openedAt: timestampSchema, caseOwnerDisplayName: name, acknowledgeBy: timestampSchema,
  firstUpdateBy: timestampSchema, nextUpdateAt: timestampSchema.nullable(),
});
const caseEvent = stamp.extend({
  id: caseEventIdSchema, content: authored.nullable(), evidence: z.array(shownCaseEvidence).max(6),
});
const report = caseEvent.extend({ kind: z.literal("reported"), content: authored });
const sharedCaseEvent = z.discriminatedUnion("kind", [
  caseEvent.extend({ kind: caseEventKind.extract(["acknowledged", "closed"]) }),
  caseEvent.extend({ kind: caseEventKind.extract(["reporter_update", "substantive_update", "resolved"]), content: authored }),
  caseEvent.extend({ kind: z.literal("correction_requested"), completionId: completionIdSchema, content: authored }),
]);
const participantCase = z.strictObject({
  audience: z.enum(["reporter", "case_owner"]), job, receipt: caseReceipt,
  disclosedProviderAudience: providerAudience.nullable(),
  affectedItem: scopeLine.nullable(), bill: billSummary.pick({ id: true, number: true }).nullable(),
  signOff: signOffReceiptSchema.nullable(), report, history: z.array(sharedCaseEvent), page: paginationSchema,
  actions: z.strictObject({ appendReport: z.boolean(), reviewCompletion: z.boolean() }),
});
// A named provider recipient sees only the explicitly shared minimum packet and their own posted replies.
const providerCase = z.strictObject({
  audience: providerAudience, job: job.pick({ jobId: true, reference: true, siteZone: true }), receipt: caseReceipt,
  packets: z.array(caseEvent.extend({ kind: z.literal("provider_packet"), content: authored })),
  replies: z.array(caseEvent.extend({ kind: z.literal("substantive_update"), content: authored })),
  page: paginationSchema, canRespond: z.boolean(),
});
export const problemCaseProjectionSchema = z.discriminatedUnion("audience", [participantCase, providerCase]);
export const jobCasesProjectionSchema = z.strictObject({
  jobId: jobIdSchema, siteZone: name, cases: z.array(caseReceipt), page: paginationSchema,
  newCaseAudience: z.strictObject({ businessId: businessIdSchema, providerName: name }).nullable(),
});

const ratingAudience = z.strictObject({ author: z.literal(true), bookBuddyFeedbackTeam: z.literal(true), providerFeedbackLead: z.literal(true) });
const ratingStars = z.int().min(1).max(5);
export const ratingReceiptSchema = z.strictObject({
  id: ratingIdSchema, jobId: jobIdSchema, stars: ratingStars, comment: authored.nullable(), submittedAt: timestampSchema,
  state: z.enum(RATING_STATES), audience: ratingAudience,
});
export const ratingEligibilitySchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("eligible"), job, expiresAt: timestampSchema, audience: ratingAudience }),
  z.strictObject({ status: z.literal("unavailable"), job, reason: z.enum(["not_eligible", "expired", "already_rated"]) }),
  z.strictObject({ status: z.literal("submitted"), job, rating: ratingReceiptSchema.extend({ state: z.literal("submitted") }) }),
]);

export const getJobCompletionRoute = defineRoute({
  method: "GET", path: "/jobs/:j/completion", auth: "context",
  input: z.strictObject({ params: jobParams, query: z.strictObject({ versionId: completionIdSchema.optional() }).optional() }),
  output: completionProjectionSchema,
});
export const getJobBillRoute = defineRoute({
  method: "GET", path: "/jobs/:j/bill", auth: "context",
  input: z.strictObject({ params: jobParams, query: z.strictObject({ versionId: billIdSchema.optional() }).optional() }),
  output: billProjectionSchema,
});
export const listJobCasesRoute = defineRoute({
  method: "GET", path: "/jobs/:j/cases", auth: "context",
  input: z.strictObject({ params: jobParams, query: paginationInputSchema.extend({ category: caseCategory.optional() }).optional() }),
  output: jobCasesProjectionSchema,
});
export const getProblemCaseRoute = defineRoute({
  method: "GET", path: "/cases/:id", auth: "context",
  input: z.strictObject({ params: caseParams, query: paginationInputSchema.optional() }), output: problemCaseProjectionSchema,
});
export const getJobRatingEligibilityRoute = defineRoute({
  method: "GET", path: "/jobs/:j/rating-eligibility", auth: "context",
  input: z.strictObject({ params: jobParams }), output: ratingEligibilitySchema,
});

function commandRoute<
  const Path extends `/${string}`, Params extends z.ZodType<Record<string, string>>,
  Payload extends z.ZodType, Output extends z.ZodType,
>(path: Path, params: Params, payload: Payload, output: Output) {
  return defineRoute({
    method: "POST", path, auth: "context", command: true,
    input: z.strictObject({ params, body: commandInputSchema(payload) }), output,
  });
}

const publishItemFields = {
  id: completionItemIdSchema, scope: approvedScopeLineReferenceSchema, originalLanguage: localeTagSchema,
  photos: z.array(z.strictObject({ attachmentId: attachmentIdSchema, caption: original.optional() })).max(8),
};
const publishItem = z.discriminatedUnion("outcome", [
  z.strictObject({ ...publishItemFields, outcome: z.literal("done"), resultNote: shortText, evidenceAlternative: shortText.optional() }),
  z.strictObject({ ...publishItemFields, outcome: z.literal("not_done"), reason: shortText }),
]);
export const submitCompletionPayloadSchema = z.strictObject({
  id: completionIdSchema, baseQuoteVersionId: quoteVersionIdSchema, expectedCompletionId: completionIdSchema.nullable(),
  items: z.array(publishItem).min(1).max(500), billReference: shortText.trim().optional(), billAmountMinor: positiveMinor.optional(),
}).superRefine(({ items, billReference, billAmountMinor }, ctx) => {
  if ((billReference === undefined) !== (billAmountMinor === undefined)) {
    ctx.addIssue({ code: "custom", path: [billReference === undefined ? "billReference" : "billAmountMinor"],
      message: "Provide the bill reference and amount together" });
  }
  const ids = new Set<string>(), scopeKeys = new Set<string>(), photos = new Set<string>();
  let photoCount = 0;
  for (const item of items) {
    const { scope } = item;
    const key = scope.kind === "quote" ? `q:${scope.quoteVersionId}:${scope.lineNo}` : `c:${scope.changeVersionId}:${scope.lineNo}`;
    ids.add(item.id);
    scopeKeys.add(key);
    for (const photo of item.photos) { photoCount++; photos.add(photo.attachmentId); }
  }
  if (ids.size !== items.length || scopeKeys.size !== items.length) {
    ctx.addIssue({ code: "custom", path: ["items"], message: "Each approved scope line must appear once" });
  }
  if (photoCount > 8 || photos.size !== photoCount) {
    ctx.addIssue({ code: "custom", path: ["items"], message: "Include at most eight distinct photos" });
  }
});
// The batch derives finish time/actor, verifies each approved item and every selected ready attachment or agreed alternative.
export const submitCompletionRoute = commandRoute("/jobs/:j/completions", jobParams, submitCompletionPayloadSchema,
  foremanCompletionSchema.extend({ submission: completionWithBill.extend({ state: z.literal("submitted") }) }));
export const signOffCompletionRoute = commandRoute("/completions/:id/sign-off", completionParams,
  z.strictObject({ id: signOffIdSchema, termsHash }), customerCompletionSchema.extend({
    signOff: signOffReceiptSchema,
    submission: completionSubmission.extend({ state: z.literal("signed_off") }),
    actions: customerCompletionSchema.shape.actions.extend({ signOff: z.literal(false) }),
  }));
export const returnCompletionRoute = defineRoute({
  method: "POST", path: "/completions/:id/return", auth: "context", command: true,
  input: z.strictObject({
    params: completionParams,
    body: commandInputSchema(z.strictObject({})).extend({ expectedRevision: revisionSchema }),
  }),
  output: foremanCompletionSchema.extend({
    submission: completionWithBill.extend({ state: z.literal("returned") }),
  }),
});

export const issueBillPayloadSchema = z.strictObject({
  id: billIdSchema, replacesId: billIdSchema.nullable(), number: shortText, currency, providerDocumentRef,
  paymentInstructions, dueAt: timestampSchema.optional(), lines: z.array(invoiceLine).min(1).max(100),
}).refine(({ lines }) => {
  let net = 0, tax = 0;
  for (const line of lines) { net += line.netMinor; tax += line.taxMinor; }
  return Number.isSafeInteger(net) && Number.isSafeInteger(tax) && Number.isSafeInteger(net + tax) && net >= 0 && tax >= 0 && net + tax > 0;
}, { path: ["lines"] });
// A replacement requires a changed invoice, never just a disputed case, payment correction or refund.
export const issueBillRoute = commandRoute("/jobs/:j/bills", jobParams, issueBillPayloadSchema, providerBillProjectionSchema);
const paymentDecision = z.strictObject({ id: paidRecordIdSchema, expectedPriorId: paidRecordIdSchema.nullable() });
// No actor, grant, receipt time or customer-side proof comes from the caller; all verbs use provider billing authority.
export const recordPaidRoute = commandRoute("/bills/:id/record-paid", billParams,
  paymentDecision.extend({ amountMinor: positiveMinor, verifiedReference: shortText }), providerBillProjectionSchema);
export const correctPaymentRoute = commandRoute("/bills/:id/correct-payment", billParams,
  paymentDecision.extend({ expectedPriorId: paidRecordIdSchema, reason: shortText }), providerBillProjectionSchema);
export const recordCheckingRoute = commandRoute("/bills/:id/record-checking", billParams,
  paymentDecision.extend({ reason: shortText }), providerBillProjectionSchema);
export const confirmNoFundsRoute = commandRoute("/bills/:id/confirm-no-funds", billParams,
  paymentDecision.extend({ expectedPriorId: paidRecordIdSchema, reason: shortText }), providerBillProjectionSchema);
export const deferCollectionRoute = commandRoute("/bills/:id/defer-collection", billParams, z.strictObject({
  id: billDeferralIdSchema, caseId: caseIdSchema, expectedPriorId: paidRecordIdSchema.nullable(), amountMinor: positiveMinor,
  basis: shortText, reviewAt: timestampSchema,
  affectedLineNos: z.array(no).min(1).max(100).refine((lines) => new Set(lines).size === lines.length),
}), providerBillProjectionSchema);
export const releaseDeferralRoute = commandRoute("/bills/:id/release-deferral", billParams,
  z.strictObject({ deferralId: billDeferralIdSchema, disposition: deferralDisposition }), providerBillProjectionSchema);

export const submitProblemCasePayloadSchema = z.strictObject({
  id: caseIdSchema, reportEventId: caseEventIdSchema, category: caseCategory, affectedItem: approvedScopeLineReferenceSchema.optional(),
  billId: billIdSchema.optional(), description: original, evidence: caseEvidenceIds,
  // Null opts out. A non-null audience must match the live preview; the reporter never selects a recipient or grant.
  expectedProviderAudience: providerAudience.nullable(),
}).refine(({ billId, category }) => billId === undefined || category === "bill", { path: ["billId"] });
export const submitProblemCaseRoute = commandRoute("/jobs/:j/problem-cases", jobParams, submitProblemCasePayloadSchema,
  participantCase.extend({ audience: z.literal("reporter") }));
const eventPayload = z.strictObject({ id: caseEventIdSchema });
export const appendCaseEventPayloadSchema = z.discriminatedUnion("kind", [
  eventPayload.extend({ kind: caseEventKind.extract(["reporter_update", "substantive_update", "resolved"]), content: original, evidence: caseEvidenceIds }),
  eventPayload.extend({ kind: caseEventKind.extract(["acknowledged", "closed"]), content: original.optional() }),
  eventPayload.extend({ kind: z.literal("correction_requested"), completionId: completionIdSchema, content: original }),
  eventPayload.extend({ kind: z.literal("provider_packet"), content: original, evidence: caseEvidenceIds }),
]);
export const appendCaseEventRoute = commandRoute("/cases/:id/events", caseParams, appendCaseEventPayloadSchema, problemCaseProjectionSchema);
export const submitRatingRoute = commandRoute("/jobs/:j/rating", jobParams,
  z.strictObject({ id: ratingIdSchema, stars: ratingStars, comment: original.optional() }),
  ratingReceiptSchema.extend({ state: z.literal("submitted") }));

export type CompletionProjection = z.output<typeof completionProjectionSchema>;
export type CompletionSubmissionInput = z.output<typeof submitCompletionPayloadSchema>;
export type SignOffReceipt = z.output<typeof signOffReceiptSchema>;
export type BillProjection = z.output<typeof billProjectionSchema>;
export type BillPaymentOutcome = z.output<typeof billPaymentOutcomeSchema>;
export type ProblemCaseProjection = z.output<typeof problemCaseProjectionSchema>;
export type JobCasesProjection = z.output<typeof jobCasesProjectionSchema>;
export type RatingEligibility = z.output<typeof ratingEligibilitySchema>;
export type RatingReceipt = z.output<typeof ratingReceiptSchema>;
