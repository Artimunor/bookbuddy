import { COVER_POLICY, DROPOUT_REASONS, DROPOUT_SOURCES, ELIGIBILITY_DISPLAY_STATES, OFFER_DECLINE_REASONS } from "@bookbuddy/domain";
import { z } from "zod";
import { membershipIdSchema } from "./access";
import {
  businessIdSchema, commandInputSchema, idSchemaFor, localeTagSchema, paginationInputSchema, paginationSchema,
  revisionSchema, timestampSchema,
} from "./common";
import { defineRoute } from "./route";

const offerId = idSchemaFor<"staffing_offer">();
const assignmentId = idSchemaFor<"assignment">();
const gapId = idSchemaFor<"cover_gap">();
const shiftId = idSchemaFor<"shift">();
const slotId = idSchemaFor<"shift_slot">();
const windowId = idSchemaFor<"visit_window">();
const text = z.string().min(1);
const roundNo = z.int().positive();
const visitSpan = z.strictObject({ startsAt: timestampSchema, endsAt: timestampSchema })
  .refine(({ startsAt, endsAt }) => startsAt < endsAt, { path: ["endsAt"] });
const reference = z.string().regex(/^BB-[A-Z0-9]+$/);
const crewMember = z.object({ membershipId: membershipIdSchema, displayName: text });
const crewProfile = crewMember.extend({
  skills: z.array(text), workingLanguages: z.array(localeTagSchema), openToCoverUntil: timestampSchema.nullable(),
});
const crewScope = z.object({ businessId: businessIdSchema, businessName: text, siteZone: text });
const shiftNeed = z.object({
  shiftId, reference, window: visitSpan, siteZone: text, task: text, skill: text, briefingLanguage: localeTagSchema,
});
const eligibility = z.object({ state: z.enum(ELIGIBILITY_DISPLAY_STATES), validUntil: timestampSchema.nullable() });
const availabilityCheck = z.discriminatedUnion("state", [
  z.strictObject({ state: z.enum(["free", "unavailable", "unknown"]) }),
  // Busy intervals never identify the other job or its customer.
  z.strictObject({ state: z.literal("busy"), window: visitSpan }),
]);
const shiftFit = z.object({
  result: z.enum(["available", "conflict", "not_eligible", "checking"]), checkedAt: timestampSchema,
  skillMatches: z.boolean(), briefingLanguageMatches: z.boolean(), availability: availabilityCheck, eligibility,
});

// F-08: internal, provider-scoped roster; unrelated work is never identified.
const crewStatus = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("assigned"), reference: reference.nullable(),
    phase: z.enum(["confirmed", "on_the_way", "on_site", "working", "departed"]), at: timestampSchema,
    briefing: z.enum(["due", "acknowledged", "hold"]),
  }),
  z.object({ state: z.literal("free"), until: timestampSchema.nullable() }),
  z.object({ state: z.literal("unavailable"), since: timestampSchema.nullable() }),
  z.object({ state: z.literal("not_assignable"), eligibility }),
]);
export const crewRosterSchema = crewScope.extend({
  date: z.iso.date(), total: z.int().nonnegative(), page: paginationSchema,
  members: z.array(crewProfile.extend({ eligibility, status: crewStatus })),
});

// F-09: check results only, no eligibility evidence or details of conflicting work.
export const crewMemberSchema = crewScope.extend({
  member: crewProfile,
  eligibility,
  availability: z.array(z.object({ date: z.iso.date(), available: z.array(visitSpan), busy: z.array(visitSpan) })).length(7),
  shiftFit: z.object({ shift: shiftNeed, fit: shiftFit, crewThreadId: idSchemaFor<"chat_thread">().nullable() }).nullable(),
});
const namedOffer = z.object({ offerId, slotId, recipient: crewMember, sentAt: timestampSchema, replyBy: timestampSchema });
const pendingAssignmentOffer = namedOffer.extend({ state: z.literal("offered") });

// F-07: represent the available places separately; an unanswered offer never counts as crew.
export const shiftCandidatesSchema = z.object({
  shift: shiftNeed, businessName: text,
  slots: z.array(z.object({
    slotId, number: z.int().positive(), isLead: z.boolean(),
    availability: z.enum(["vacant", "offered", "assigned", "cover_gap"]),
    pendingOffer: pendingAssignmentOffer.nullable(), coverGapId: gapId.nullable(),
  })),
  candidates: z.array(crewProfile.extend({ fit: shiftFit })),
});

// W-01 and W-03 use only the intended worker's area, timing and work facts.
// A held place is never site or crew access; terminal states do not name a winner.
const workerOfferSummary = z.strictObject({
  offerId, town: text, task: text, skill: text, briefingLanguage: localeTagSchema, siteZone: text,
  window: visitSpan, replyBy: timestampSchema, foremanName: text,
});
const ordinaryOpen = workerOfferSummary.extend({ kind: z.literal("assignment"), state: z.literal("offered") });
const coverOfferBasis = workerOfferSummary.extend({ kind: z.literal("cover"), gapId, roundNo, revision: revisionSchema });
const coverOpen = coverOfferBasis.extend({ state: z.literal("offered") });
const coverHeld = coverOfferBasis.extend({
  state: z.literal("accepted_pending_confirmation"), acceptedAt: timestampSchema, confirmBy: timestampSchema,
});
export const workerOfferCardSchema = z.union([ordinaryOpen, coverOpen, coverHeld]);

const offerDetails = { businessName: text, sentAt: timestampSchema, workingLanguages: z.array(localeTagSchema) };
const endedWorkerOffer = z.strictObject({ offerId, endedAt: timestampSchema, siteZone: text });
const ownConfirmation = z.strictObject({
  offerId, state: z.literal("confirmed"), assignmentId, shiftId, confirmedAt: timestampSchema, confirmedByName: text, siteZone: text,
});
export const workerAssignmentOfferSchema = z.discriminatedUnion("state", [
  ordinaryOpen.extend({ ...offerDetails, availability: availabilityCheck }),
  ownConfirmation.extend({ kind: z.literal("assignment") }),
  endedWorkerOffer.extend({ kind: z.literal("assignment"), state: z.enum(["declined", "withdrawn", "expired"]) }),
]);
const ownCoverConfirmation = ownConfirmation.extend({ kind: z.literal("cover") });
const coverWithdrawn = endedWorkerOffer.extend({ kind: z.literal("cover"), state: z.literal("withdrawn") });
const coverNotConfirmed = endedWorkerOffer.extend({ kind: z.literal("cover"), state: z.literal("not_confirmed") });
const coverDeclined = endedWorkerOffer.extend({ kind: z.literal("cover"), state: z.literal("declined") });
export const workerCoverOfferSchema = z.discriminatedUnion("state", [
  coverOpen.extend({ ...offerDetails, availability: availabilityCheck }),
  coverHeld.extend(offerDetails),
  // A competing hold is projected without the held person's identity or deadline.
  workerOfferSummary.extend({ kind: z.literal("cover"), state: z.literal("on_hold") }),
  ownCoverConfirmation, coverWithdrawn, coverNotConfirmed, coverDeclined,
  endedWorkerOffer.extend({ kind: z.literal("cover"), state: z.enum(["filled_elsewhere", "expired"]) }),
]);

// F-10 and F-12: this is an accountable-foreman/backup projection only.
const coverCandidate = crewProfile.extend({
  fit: shiftFit,
  onDuty: z.boolean(), // An opted-in preference does not establish duty.
  response: z.object({
    offerId, state: z.enum(["offered", "on_hold", "held", "confirmed", "declined", "withdrawn", "not_confirmed", "expired", "filled_elsewhere"]),
    at: timestampSchema, declineReason: z.enum(OFFER_DECLINE_REASONS).nullable(),
  }).nullable(),
});
const coverStatus = z.discriminatedUnion("state", [
  z.object({ state: z.literal("gap"), reportedAt: timestampSchema }),
  z.object({ state: z.literal("offers_out"), sentAt: timestampSchema, replyBy: timestampSchema }),
  z.object({
    state: z.literal("accepted_pending_confirmation"),
    hold: z.object({
      offerId, worker: crewMember, acceptedAt: timestampSchema, confirmBy: timestampSchema,
      fit: shiftFit, onDuty: z.boolean(), gapStillOpen: z.boolean(),
    }),
  }),
  z.object({
    state: z.literal("confirmed"), assignmentId, worker: crewMember, confirmedAt: timestampSchema,
    confirmedByName: text, confirmedByViewer: z.boolean(),
  }),
  z.object({ state: z.literal("no_cover"), endedAt: timestampSchema }),
  z.object({ state: z.literal("new_visit_proposed"), proposedAt: timestampSchema, windowId, window: visitSpan }),
]);
export const foremanCoverSchema = z.object({
  audience: z.literal("foreman"), gapId, slotId, shift: shiftNeed, safeCutoff: timestampSchema,
  revision: revisionSchema, currentRoundNo: roundNo.nullable(), dispatchesUsed: z.int().min(0).max(COVER_POLICY.maxDispatchesPerGap),
  status: coverStatus,
  candidates: z.array(coverCandidate),
  customerUpdate: z.discriminatedUnion("state", [
    z.object({ state: z.literal("not_shared") }),
    z.object({
      state: z.literal("published"), kind: z.enum(["cover_arranging", "crew_updated", "no_crew_available"]),
      publishedAt: timestampSchema, nextUpdateAt: timestampSchema.nullable(),
    }),
  ]),
  noCrewUpdate: z.strictObject({ visitId: idSchemaFor<"visit">(), bookedWindowId: windowId, expectedRevision: revisionSchema }).nullable(),
  actions: z.object({ canIssue: z.boolean(), canClose: z.boolean(), canRelease: z.boolean(), canConfirm: z.boolean() }),
});
export const coverViewSchema = z.discriminatedUnion("audience", [
  foremanCoverSchema,
  z.strictObject({ audience: z.literal("worker"), offer: workerCoverOfferSchema }),
]);

const empty = z.strictObject({});
const decline = z.strictObject({ reason: z.enum(OFFER_DECLINE_REASONS).nullable().optional() });
const offerParams = z.object({ id: offerId });
const coverParams = z.object({ g: gapId });
const offerCommand = <Payload extends z.ZodType>(payload: Payload) => z.object({ params: offerParams, body: commandInputSchema(payload) });
const coverCommand = <Payload extends z.ZodType, Round extends z.ZodType>(payload: Payload, expectedRoundNo: Round) => z.object({
  params: coverParams, body: commandInputSchema(payload).extend({ expectedRevision: revisionSchema, expectedRoundNo }),
});

// Every live relationship and time/availability check belongs to the same D1 call as the command/read.
export const listCrewRoute = defineRoute({
  method: "GET", path: "/crew", auth: "context", output: crewRosterSchema,
  input: z.object({ query: paginationInputSchema.extend({
    search: z.string().trim().min(1).max(120).optional(), filter: z.enum(["all", "free_now", "open_to_cover"]).optional(),
  }).prefault({}) }),
});
export const getCrewMemberRoute = defineRoute({
  method: "GET", path: "/crew/:id", auth: "context", output: crewMemberSchema,
  input: z.object({ params: z.object({ id: membershipIdSchema }), query: z.object({ shiftId: shiftId.optional(), weekOf: z.iso.date().optional() }).prefault({}) }),
});
export const getShiftCandidatesRoute = defineRoute({
  method: "GET", path: "/shifts/:s/candidates", auth: "context", output: shiftCandidatesSchema,
  input: z.object({ params: z.object({ s: shiftId }) }),
});
export const issueAssignmentOfferRoute = defineRoute({
  method: "POST", path: "/slots/:id/offers", auth: "context", command: true, output: pendingAssignmentOffer,
  input: z.object({
    params: z.object({ id: slotId }), body: commandInputSchema(z.strictObject({
      offerId, recipientMembershipId: membershipIdSchema, replyBy: timestampSchema.optional(),
    })),
  }),
});
export const getOfferRoute = defineRoute({
  method: "GET", path: "/offers/:id", auth: "context", output: workerAssignmentOfferSchema,
  input: z.object({ params: offerParams }),
});
export const acceptOfferRoute = defineRoute({
  method: "POST", path: "/offers/:id/accept", auth: "context", command: true,
  input: offerCommand(empty), output: ownConfirmation.extend({ kind: z.literal("assignment") }),
});
export const declineOfferRoute = defineRoute({
  method: "POST", path: "/offers/:id/decline", auth: "context", command: true,
  input: offerCommand(decline), output: endedWorkerOffer.extend({ kind: z.literal("assignment"), state: z.literal("declined") }),
});
export const withdrawOfferRoute = defineRoute({
  method: "POST", path: "/offers/:id/withdraw", auth: "context", command: true,
  input: offerCommand(empty), output: namedOffer.extend({ state: z.literal("withdrawn"), resolvedAt: timestampSchema }),
});

// W-05 dropout is separate from offer withdrawal. F-16 reads its attributed history via getShiftRoute.
const dropoutReceipt = z.strictObject({ assignmentId, shiftId, state: z.literal("dropped"), droppedAt: timestampSchema });
export const dropoutAssignmentRoute = defineRoute({
  method: "POST", path: "/assignments/:id/dropout", auth: "context", command: true,
  input: z.object({
    params: z.object({ id: assignmentId }), body: commandInputSchema(z.strictObject({
      source: z.enum(DROPOUT_SOURCES), reason: z.enum(DROPOUT_REASONS).nullable().optional(),
    })),
  }),
  output: z.discriminatedUnion("audience", [
    dropoutReceipt.extend({ audience: z.literal("worker") }),
    dropoutReceipt.extend({ audience: z.literal("foreman"), gapId }),
  ]),
});

export const getCoverRoute = defineRoute({
  method: "GET", path: "/cover/:g", auth: "context", output: coverViewSchema,
  input: z.object({ params: coverParams }),
});
export const issueCoverRoute = defineRoute({
  method: "POST", path: "/cover/:g/issue", auth: "context", command: true, output: foremanCoverSchema,
  input: coverCommand(z.strictObject({
    recipientMembershipIds: z.array(membershipIdSchema).min(1).max(COVER_POLICY.maxRecipientsPerDispatch)
      .refine((ids) => new Set(ids).size === ids.length),
  }), roundNo.nullable()),
});
export const acceptCoverRoute = defineRoute({
  method: "POST", path: "/cover/:g/accept", auth: "context", command: true,
  input: coverCommand(z.strictObject({ offerId }), roundNo), output: coverHeld,
  // A lost CAS returns only the shared cover conflict status (filled/expired or still on hold), never this winner's projection.
});
export const declineCoverRoute = defineRoute({
  method: "POST", path: "/cover/:g/decline", auth: "context", command: true,
  input: coverCommand(decline.extend({ offerId }), roundNo), output: coverDeclined,
});
export const withdrawCoverRoute = defineRoute({
  method: "POST", path: "/cover/:g/withdraw", auth: "context", command: true,
  input: coverCommand(z.strictObject({ offerId }), roundNo),
  output: z.discriminatedUnion("state", [coverWithdrawn, ownCoverConfirmation, coverNotConfirmed]),
});
export const releaseCoverRoute = defineRoute({
  method: "POST", path: "/cover/:g/release", auth: "context", command: true, output: foremanCoverSchema,
  input: coverCommand(z.strictObject({ reason: z.enum(["delivery", "safety", "no_longer_eligible"]) }), roundNo),
});
export const closeCoverRoute = defineRoute({
  method: "POST", path: "/cover/:g/close", auth: "context", command: true, output: foremanCoverSchema,
  input: coverCommand(z.discriminatedUnion("reason", [
    z.strictObject({ reason: z.enum(["delivery", "safety", "exhausted"]) }),
    z.strictObject({ reason: z.literal("revised_visit"), revisedWindowId: windowId }),
  ]), roundNo.nullable()),
});
export const confirmCoverRoute = defineRoute({
  method: "POST", path: "/cover/:g/confirm", auth: "context", command: true,
  input: coverCommand(empty, roundNo), output: z.object({
    outcome: z.enum(["confirmed", "already_filled", "not_confirmed"]), cover: foremanCoverSchema,
  }),
});

export type CrewRoster = z.output<typeof crewRosterSchema>;
export type CrewMember = z.output<typeof crewMemberSchema>;
export type ShiftCandidates = z.output<typeof shiftCandidatesSchema>;
export type WorkerOfferCard = z.output<typeof workerOfferCardSchema>;
export type WorkerAssignmentOffer = z.output<typeof workerAssignmentOfferSchema>;
export type WorkerCoverOffer = z.output<typeof workerCoverOfferSchema>;
export type ForemanCover = z.output<typeof foremanCoverSchema>;
export type CoverView = z.output<typeof coverViewSchema>;
