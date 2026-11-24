import {
  ARRIVAL_ARRANGEMENTS, ASSIGNMENT_STATES, CHANGE_VERSION_STATES, CURRENCIES, CUSTOMER_UPDATE_KINDS,
  HANDOFF_POLICIES, HANDOFF_STATES, JOB_STATES, JOURNEY_STEPS, PROBLEM_CASE_STATES, QUOTE_VERSION_STATES, VISIT_STEPS,
  looksLikeAccessCode, projectJourney,
} from "@bookbuddy/domain";
import type { JourneyProjection } from "@bookbuddy/domain";
import { z } from "zod";
import { businessOverviewSchema, membershipIdSchema } from "./access";
import {
  attachmentIdSchema, commandInputSchema, cursorSchema, evidenceReferenceSchema, idSchema, idSchemaFor,
  localeTagSchema, operationIdSchema, paginationInputSchema, paginationSchema, revisionSchema, timestampSchema,
} from "./common";
import { placeIdSchema } from "./places";
import { defineRoute } from "./route";

export const jobIdSchema = idSchemaFor<"job">();
export const jobHandoffIdSchema = idSchemaFor<"handoff">();
export const jobViewSchema = z.enum(["whole", "today", "intake"]);

// Serialize the domain projection of confirmed facts, never a mutable stage or an inferred milestone.
export const jobJourneySchema = z.strictObject({
  step: z.enum(JOURNEY_STEPS), cancelled: z.boolean(), complete: z.boolean(),
}) satisfies z.ZodType<JourneyProjection>;

const displayText = z.string().min(1);
const siteZone = displayText;
const count = z.int().nonnegative();
const reference = z.string().regex(/^BB-[A-Z0-9]+$/);
const jobState = z.enum(JOB_STATES);
const handoffState = z.enum(HANDOFF_STATES);
const handoffPolicy = z.enum(HANDOFF_POLICIES);
const arrivalArrangement = z.enum(ARRIVAL_ARRANGEMENTS);
const member = z.object({ membershipId: membershipIdSchema, displayName: displayText });
const place = z.object({ placeId: placeIdSchema, alias: displayText });
const money = z.object({ minor: count, currency: z.enum(CURRENCIES) });
const stamp = z.object({ at: timestampSchema, by: displayText.nullable() });
const timeBand = z.object({ startsAt: timestampSchema, endsAt: timestampSchema }).refine(({ startsAt, endsAt }) => startsAt < endsAt);
const booking = z.object({ visitId: idSchemaFor<"visit">(), window: timeBand });
const visit = booking.extend({
  step: z.enum(VISIT_STEPS).nullable(),
  status: z.enum([...VISIT_STEPS, "cover_arranging", "paused"]),
  arrival: timeBand.nullable(), nextUpdateAt: timestampSchema.nullable(), source: stamp,
});
const jobHeading = z.object({ jobId: jobIdSchema, reference, title: displayText.nullable(), siteZone });
const jobCard = jobHeading.extend({
  journey: jobJourneySchema, state: jobState, place, nextVisit: booking.nullable(), finalAt: timestampSchema.nullable(),
});
const nextStepFields = { recordId: idSchema.nullable(), at: timestampSchema.nullable(), waitingOn: displayText.nullable() };
const customerNextStep = z.object({
  ...nextStepFields,
  kind: z.enum([
    "wait_for_quote", "review_quote", "read_quote", "wait_for_approver", "wait_for_windows", "pick_window",
    "review_revised_visit", "visit", "review_change", "review_completion", "sign_off", "see_bill", "open_case", "rate_job",
  ]),
});
const foremanNextStep = z.object({
  ...nextStepFields,
  kind: z.enum(["accept_job", "write_quote", "assign_crew", "find_cover", "review_briefing", "confirm_cover", "share_update", "visit"]),
});
const customerMoment = stamp.extend({
  jobId: jobIdSchema, recordId: idSchema,
  kind: z.enum([
    "requested", "quote_issued", "quote_approved", "visit_booked", "visit_revised", "cancelled", "change_issued",
    "completion_submitted", "signed_off", "bill_issued", "paid", "case_opened", ...CUSTOMER_UPDATE_KINDS,
  ]),
});
const foremanMoment = customerMoment.extend({
  kind: customerMoment.shape.kind.or(z.enum([
    "quote_in_review", "quote_returned", "change_in_review", "change_returned", "change_approved", "payment_corrected",
  ])),
});
const historyPage = z.object({ items: z.array(customerMoment), page: paginationSchema });
const customerCard = jobCard.extend({ providerName: displayText, nextStep: customerNextStep.nullable(), live: z.boolean() });
const customerLive = jobHeading.extend({
  journey: jobJourneySchema, providerName: displayText, crewName: displayText.nullable(), visit,
});
const customerDecision = jobHeading.extend({
  journey: jobJourneySchema, place,
  kind: z.enum(["review_quote", "pick_window", "review_revised_visit", "review_change", "review_completion", "sign_off", "see_bill"]),
  recordId: idSchema, amount: money.nullable(), sent: stamp, dueAt: timestampSchema.nullable(),
});

const handoff = z.object({
  handoffId: jobHandoffIdSchema, state: handoffState, policy: handoffPolicy,
  from: member.nullable(), to: member, offeredBy: displayText.nullable(), offeredAt: timestampSchema,
  expiresAt: timestampSchema, endedAt: timestampSchema.nullable(), reofferOfId: jobHandoffIdSchema.nullable(),
});
const foremanCard = jobCard.extend({
  customerName: displayText, nextStep: foremanNextStep.nullable(), live: z.boolean(),
  flags: z.array(z.enum(["crew_gap", "open_change", "open_problem", "unpaid_bill"])),
});
// An intended recipient sees the town, not the place alias, address or arrival notes before acceptance.
const foremanIncoming = jobHeading.extend({
  town: displayText, customerName: displayText, journey: jobJourneySchema, handoff,
});
const foremanLiveSummary = jobHeading.extend({ visit });
const foremanLive = foremanLiveSummary.extend({
  place, customerStatus: visit.nullable(),
  crew: z.array(member.extend({
    state: z.enum(["confirmed", "on_the_way", "on_site", "working", "departed", "dropped"]),
    at: timestampSchema, briefing: z.enum(["due", "acknowledged", "hold"]),
  })),
});
const crewGap = jobHeading.extend({
  gapId: idSchemaFor<"cover_gap">(), worker: member, skill: displayText, reportedAt: timestampSchema,
  visitStartsAt: timestampSchema, customerNotified: z.boolean(),
});

const workerAssignment = z.object({
  assignmentId: idSchemaFor<"assignment">(), shiftId: idSchemaFor<"shift">(), state: z.enum(ASSIGNMENT_STATES),
  task: displayText, briefingLanguage: localeTagSchema, window: timeBand,
  nextStep: z.enum(["travel", "check_in", "open_briefing", "check_out"]).nullable(), safetyHold: z.boolean(),
});
// Pending worker offers are not job access. Only a confirmed assignment can open a site-specific view.
const workerOfferSummary = z.object({
  offerId: idSchema, town: displayText, task: displayText,
  skill: displayText, briefingLanguage: localeTagSchema, siteZone, window: timeBand, replyBy: timestampSchema,
  awaitingConfirmationUntil: timestampSchema.nullable(),
});
const workerOffer = z.discriminatedUnion("kind", [
  workerOfferSummary.extend({ kind: z.literal("ordinary") }),
  workerOfferSummary.extend({ kind: z.literal("cover"), gapId: idSchemaFor<"cover_gap">() }),
]);
const workerCard = jobHeading.extend({ place, assignment: workerAssignment });

const providerJobCard = jobCard.extend({ accountableForeman: member.nullable(), handoff: handoff.nullable(), readyToBill: z.boolean() });
const providerLive = businessOverviewSchema.shape.liveJob;
const providerReview = z.object({
  kind: z.enum(["quote", "change"]), versionId: idSchema, version: z.int().positive(), submitted: stamp,
});
const providerBill = z.object({
  billId: idSchemaFor<"bill">(), number: displayText, total: money,
  outcome: z.discriminatedUnion("status", [
    z.object({ status: z.enum(["due", "checking"]) }),
    z.object({ status: z.literal("paid"), recorded: stamp, matched: money }),
  ]),
});
const readyBill = z.strictObject({
  number: displayText, total: money,
  lines: z.array(z.strictObject({ originalLabel: displayText, originalLanguage: localeTagSchema, netMinor: z.int(), taxMinor: z.int() })).min(1),
});
const unpaidBill = jobHeading.extend({
  billId: idSchemaFor<"bill">(), number: displayText, total: money,
  status: z.enum(["due", "checking"]), expectedPriorId: idSchemaFor<"paid_record">().nullable(), canRecordPaid: z.boolean(),
});

export const homeProjectionSchema = z.discriminatedUnion("audience", [
  z.object({
    audience: z.literal("customer"), unreadCount: count, place: place.extend({ siteZone: siteZone.nullable() }).nullable(),
    liveVisits: z.array(customerLive), decisions: z.array(customerDecision), upcoming: z.array(customerCard), recent: z.array(customerMoment),
  }),
  z.object({
    audience: z.literal("foreman"), unreadCount: count, businessName: displayText, siteZone,
    gaps: z.array(crewGap), liveVisits: z.array(foremanLive), laterVisits: z.array(foremanCard),
    needsYou: z.array(jobHeading.extend({ action: foremanNextStep })), needsYouCount: count,
  }),
  z.object({
    audience: z.literal("worker"), unreadCount: count, businessName: displayText, siteZone,
    assignment: workerCard.nullable(), offers: z.array(workerOffer), openToCoverUntil: timestampSchema.nullable(),
  }),
  z.object({ audience: z.literal("provider_admin"), unreadCount: count, overview: businessOverviewSchema }),
]);

const customerSegment = z.enum(["active", "past"]);
const foremanSegment = z.enum(["incoming", "active", "past"]);
const providerSegment = z.enum(["needs_you", "active", "past"]);
const listPage = z.object({ unreadCount: count, page: paginationSchema });
export const jobsPageSchema = z.discriminatedUnion("audience", [
  listPage.extend({
    audience: z.literal("customer"), segment: customerSegment, siteZone: siteZone.nullable(),
    activeCount: count, pastCount: count, items: z.array(customerCard), live: customerLive.nullable(),
  }),
  listPage.extend({
    audience: z.literal("foreman"), businessName: displayText, siteZone,
    incomingCount: count, activeCount: count, pastCount: count, live: foremanLiveSummary.nullable(),
    list: z.discriminatedUnion("segment", [
      z.object({ segment: z.literal("incoming"), items: z.array(foremanIncoming) }),
      z.object({ segment: foremanSegment.exclude(["incoming"]), items: z.array(foremanCard) }),
    ]),
  }),
  listPage.extend({ audience: z.literal("worker"), segment: customerSegment, siteZone, items: z.array(workerCard) }),
  listPage.extend({
    audience: z.literal("provider_admin"), segment: providerSegment, businessName: displayText, siteZone,
    needsYouCount: count, activeCount: count, pastCount: count, items: z.array(providerJobCard),
    unpaidBills: z.array(unpaidBill),
  }),
]);

const quoteSummary = z.object({
  versionId: idSchemaFor<"quote_version">(), version: z.int().positive(), total: money,
  state: z.enum(QUOTE_VERSION_STATES).extract(["issued", "approved", "declined", "superseded", "withdrawn"]),
  sent: stamp.optional(), approved: stamp.nullable().optional(),
});
const attachment = evidenceReferenceSchema.extend({ availability: z.enum(["available", "unavailable"]) });
const voicedRequest = attachment.extend({ durationMs: z.int().positive().max(90_000), language: localeTagSchema.nullable() });
const translation = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["pending", "unavailable"]) }),
  z.object({ status: z.literal("ready"), language: localeTagSchema, text: displayText }),
]);
const requestAttachmentIds = z.array(attachmentIdSchema).max(10);
const intakeRequest = z.object({
  submitted: stamp, originalText: displayText.nullable(), originalLanguage: localeTagSchema.nullable(),
  attachmentIds: requestAttachmentIds, translation: translation.nullable(), photos: z.array(attachment).max(5), originalVoice: voicedRequest.nullable(),
});
const arrival = z.object({ arrangement: arrivalArrangement, contactName: displayText.nullable(), safeNote: displayText.nullable() });
const foremanIntake = foremanIncoming.extend({
  view: z.literal("intake"), revision: revisionSchema, request: intakeRequest.nullable(),
  reply: z.enum(["available", "authority_missing", "closed_elsewhere", "closed"]), chatThreadId: idSchemaFor<"chat_thread">().nullable(),
});
const shiftSlots = z.array(z.object({ shiftId: idSchemaFor<"shift">(), slotIds: z.array(idSchemaFor<"shift_slot">()) }));
const visitStaffing = { shifts: shiftSlots, vacantSlotId: idSchemaFor<"shift_slot">().nullable().optional() };
const foremanJobBill = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none"), total: z.null() }),
  z.object({ state: z.enum(["draft", "sent", "paid_recorded"]), total: money }),
]);

export const jobDetailSchema = z.discriminatedUnion("audience", [
  z.object({ audience: z.literal("customer"), job: z.discriminatedUnion("view", [
    customerCard.extend({
      view: z.literal("whole"), revision: revisionSchema, hasTodayView: z.boolean(), quote: quoteSummary.nullable(),
      foremanName: displayText.nullable(), chatThreadId: idSchemaFor<"chat_thread">().nullable(),
      attachmentIds: requestAttachmentIds,
      change: z.object({ versionId: idSchemaFor<"change_version">(), state: z.enum(CHANGE_VERSION_STATES).extract(["issued", "approved", "rejected"]),
        delta: z.object({ minor: z.int(), currency: z.enum(CURRENCIES) }) }).nullable(),
      openCase: z.object({ caseId: idSchemaFor<"case">(), state: z.enum(PROBLEM_CASE_STATES).extract(["open", "awaiting_plan"]) }).nullable(),
      bill: z.object({ billId: idSchemaFor<"bill">(), total: money, status: z.enum(["due", "checking", "paid"]) }).nullable(),
      crew: z.object({ leadName: displayText.nullable(), count: z.int().positive() }).nullable().optional(),
      cancellation: stamp.nullable().optional(),
      history: historyPage,
    }),
    customerLive.extend({ view: z.literal("today"), nextStep: customerNextStep.nullable(), crewNames: z.array(displayText) }),
  ]) }),
  z.object({ audience: z.literal("foreman"), job: z.discriminatedUnion("view", [
    foremanIntake,
    foremanCard.extend({
      view: z.literal("whole"), revision: revisionSchema, address: displayText, arrival, chatThreadId: idSchemaFor<"chat_thread">().nullable(),
      visits: z.array(z.object({ visitId: idSchemaFor<"visit">(), ...visitStaffing })).optional(),
      quote: z.object({ versionId: idSchemaFor<"quote_version">(), no: z.int().positive(), state: z.enum(QUOTE_VERSION_STATES) }).nullable().optional(),
      change: z.object({ versionId: idSchemaFor<"change_version">(), no: z.int().positive(), state: z.enum(CHANGE_VERSION_STATES) }).nullable().optional(),
      bill: foremanJobBill.optional(),
      history: historyPage.extend({ items: z.array(foremanMoment) }).optional(),
    }),
    foremanLive.extend({
      view: z.literal("today"), revision: revisionSchema, gap: crewGap.nullable(), nextStep: foremanNextStep.nullable(),
      visit: visit.extend({ ...visitStaffing, shifts: shiftSlots.optional() }),
    }),
  ]) }),
  z.object({ audience: z.literal("worker"), job: z.discriminatedUnion("view", [
    workerCard.extend({ view: z.literal("whole") }),
    workerCard.extend({
      view: z.literal("today"), assignment: workerAssignment.extend({ state: z.literal("confirmed") }),
      address: displayText, safeArrivalNote: displayText.nullable(), foremanName: displayText,
    }),
  ]) }),
  z.object({ audience: z.literal("provider_admin"), job: z.discriminatedUnion("view", [
    providerJobCard.extend({
      view: z.literal("whole"), revision: revisionSchema, bill: providerBill.nullable(), commercialReview: providerReview.nullable(),
      readyBill: readyBill.nullable(),
      canWithdrawHandoff: z.boolean(), handoffPreview: z.object({
        policy: handoffPolicy, expiresAt: timestampSchema, reofferOfId: jobHandoffIdSchema.nullable(), eligibleForemen: z.array(member),
      }).nullable(),
    }),
    providerJobCard.extend({ view: z.literal("today"), live: providerLive }),
  ]) }),
]);

export const submitRequestPayloadSchema = z.strictObject({
  placeId: placeIdSchema, trade: z.string().trim().min(1).max(100).optional(),
  originalText: z.string().max(16_000).optional(), originalLanguage: localeTagSchema.optional(),
  attachmentIds: requestAttachmentIds.refine((ids) => new Set(ids).size === ids.length, "Each attachment ID must be distinct").optional(),
  arrivalArrangement, arrivalContactName: z.string().trim().min(1).max(100).optional(),
  safeNote: z.string().trim().min(1).max(500)
    .refine((note) => !looksLikeAccessCode(note), "Do not include entry credentials").optional(),
}).superRefine((request, ctx) => {
  if (!request.originalText?.trim() && !request.attachmentIds?.length) {
    ctx.addIssue({ code: "custom", path: ["originalText"], message: "Text or original voice is required" });
  }
  if ((request.arrivalArrangement === "someone_else") !== (request.arrivalContactName !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["arrivalContactName"], message: "Name only the person meeting the crew" });
  }
  if (request.arrivalArrangement === "nobody" && request.safeNote === undefined) {
    ctx.addIssue({ code: "custom", path: ["safeNote"], message: "A safe arrival note is required when nobody is on site" });
  }
  // IDs describe intent only; the command checks ownership, MIME and readiness in the same write batch.
});

const sentJourney = projectJourney({
  jobState: "open", quoteIssued: false, windowConfirmed: false, visitReached: false, signedOff: false, paymentMatched: false,
});
export const requestReceiptSchema = z.object({
  jobId: jobIdSchema, reference, siteZone, submittedAt: timestampSchema,
  journey: jobJourneySchema.refine((journey) =>
    journey.step === sentJourney.step && journey.cancelled === sentJourney.cancelled && journey.complete === sentJourney.complete),
});
const handoffReceipt = z.object({
  jobId: jobIdSchema, handoffId: jobHandoffIdSchema, revision: revisionSchema,
  state: handoffState, expiresAt: timestampSchema, endedAt: timestampSchema.nullable(),
});

const jobParams = z.object({ j: jobIdSchema });
const handoffParams = jobParams.extend({ h: jobHandoffIdSchema });
const commandAtRevision = <Payload extends z.ZodType>(payload: Payload) =>
  commandInputSchema(payload).extend({ expectedRevision: revisionSchema });
const emptyCommand = commandAtRevision(z.strictObject({}));

export const getHomeRoute = defineRoute({
  method: "GET", path: "/home", auth: "context",
  input: z.object({ query: z.object({ placeId: placeIdSchema.optional() }).prefault({}) }),
  output: homeProjectionSchema,
});
export const getJobsRoute = defineRoute({
  method: "GET", path: "/jobs", auth: "context",
  input: z.object({ query: paginationInputSchema.extend({
    segment: z.enum(["active", "past", "incoming", "needs_you"]).optional(), placeId: placeIdSchema.optional(),
  }).prefault({}) }),
  output: jobsPageSchema,
});
export const getJobRoute = defineRoute({
  method: "GET", path: "/jobs/:j", auth: "context",
  input: z.object({ params: jobParams, query: z.object({ view: jobViewSchema.default("whole"), cursor: cursorSchema.optional() }).prefault({}) }),
  output: jobDetailSchema,
});
export const getHandoffRoute = defineRoute({
  method: "GET", path: "/handoffs/:h", auth: "context",
  input: z.object({ params: z.object({ h: jobHandoffIdSchema }) }),
  output: z.object({ audience: z.literal("foreman"), job: foremanIntake }),
});
export const submitRequestRoute = defineRoute({
  method: "POST", path: "/requests", auth: "context", command: true,
  input: z.object({ body: commandAtRevision(submitRequestPayloadSchema) }), // Expected revision is the selected place's.
  output: requestReceiptSchema,
});
export const offerJobHandoffRoute = defineRoute({
  method: "POST", path: "/jobs/:j/handoffs", auth: "context", command: true,
  input: z.object({ params: jobParams, body: commandAtRevision(z.strictObject({
    recipientMembershipId: membershipIdSchema, reofferOfId: jobHandoffIdSchema.optional(), urgentCallConfirmed: z.literal(true).optional(),
  })) }),
  output: handoffReceipt,
});
export const acceptJobHandoffRoute = defineRoute({
  method: "POST", path: "/jobs/:j/handoffs/:h/accept", auth: "context", command: true,
  input: z.object({ params: handoffParams, body: emptyCommand }), output: handoffReceipt,
});
export const declineJobHandoffRoute = defineRoute({
  method: "POST", path: "/jobs/:j/handoffs/:h/decline", auth: "context", command: true,
  input: z.object({ params: handoffParams, body: commandAtRevision(z.strictObject({ reason: z.string().trim().min(1).max(500).optional() })) }),
  output: handoffReceipt,
});
export const withdrawJobHandoffRoute = defineRoute({
  method: "POST", path: "/jobs/:j/handoffs/:h/withdraw", auth: "context", command: true,
  input: z.object({ params: handoffParams, body: emptyCommand }), output: handoffReceipt,
});
export const getOperationRoute = defineRoute({
  method: "GET", path: "/operations/:id", auth: "context",
  input: z.object({
    params: z.object({ id: operationIdSchema }),
    query: z.object({ resource: z.literal("1").optional() }).optional(),
  }),
  // Return only a committed receipt for this actor and live scope; absent or unavailable stays reason-safe 404.
  output: z.strictObject({
    operationId: operationIdSchema, status: z.literal("committed"), committedAt: timestampSchema,
    resource: z.strictObject({ kind: z.enum(["place", "job", "case"]), id: idSchema }).optional(),
  }),
});

export type HomeProjection = z.output<typeof homeProjectionSchema>;
export type JobsPage = z.output<typeof jobsPageSchema>;
export type JobDetail = z.output<typeof jobDetailSchema>;
export type SubmitRequest = z.output<typeof submitRequestRoute.input>["body"];
export type RequestReceipt = z.output<typeof requestReceiptSchema>;
export type HandoffReceipt = z.output<typeof handoffReceipt>;
export type OperationStatus = z.output<typeof getOperationRoute.output>;
