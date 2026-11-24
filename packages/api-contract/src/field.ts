import {
  ASSIGNMENT_STATES, ATTENDANCE_CORRECTION_REASONS, ATTENDANCE_CORRECTION_STATES, ATTENDANCE_KINDS,
  ATTENDANCE_REASON_CODES, ATTENDANCE_REVIEW_STATES, ATTENDANCE_SOURCES, SAFETY_HOLD_KINDS,
  TEACH_BACK_OUTCOMES, VISIT_STEPS,
} from "@bookbuddy/domain";
import type { TeachBackChecklist } from "@bookbuddy/domain";
import { z } from "zod";
import {
  attachmentIdSchema, commandInputSchema, idSchema, idSchemaFor, localeTagSchema, paginationInputSchema, paginationSchema,
  revisionSchema, timestampSchema,
} from "./common";
import { defineRoute } from "./route";

const jobId = idSchemaFor<"job">();
const visitId = idSchemaFor<"visit">();
const windowId = idSchemaFor<"visit_window">();
const shiftId = idSchemaFor<"shift">();
const assignmentId = idSchemaFor<"assignment">();
const attendanceEventId = idSchemaFor<"attendance_event">();
const correctionRequestId = idSchemaFor<"attendance_correction_request">();
const activityId = idSchemaFor<"visit_activity_event">();
const updateId = idSchemaFor<"customer_update">();
const instructionId = idSchemaFor<"safety_instruction">();
const versionId = idSchemaFor<"safety_version">();
const teachBackId = idSchemaFor<"teach_back">();
const questionId = idSchemaFor<"safety_question">();
const visitParams = z.object({ id: visitId });
const assignmentParams = z.object({ id: assignmentId });
const safetyParams = z.object({ id: instructionId });

const displayText = z.string().min(1);
const siteZone = displayText; // The stored IANA site zone, never the device zone.
const jobHeading = z.strictObject({
  id: jobId, reference: z.string().regex(/^BB-[A-Z0-9]+$/), title: displayText.nullable(), placeAlias: displayText,
});
const timeBand = z.strictObject({ startsAt: timestampSchema, endsAt: timestampSchema })
  .refine(({ startsAt, endsAt }) => startsAt < endsAt, { path: ["endsAt"] });
const bookedWindow = timeBand.safeExtend({ id: windowId });
const original = z.strictObject({
  language: localeTagSchema, text: z.string().min(1).max(16_000).refine((text) => text.trim().length > 0),
});
const originalCaption = original.extend({ text: z.string().min(1).max(500).refine((text) => text.trim().length > 0) });
const reading = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ready"), language: localeTagSchema, text: displayText }),
  z.strictObject({ status: z.enum(["pending", "unavailable"]) }),
]);
const caption = z.strictObject({ original: originalCaption, reading: reading.nullable() });
const photo = z.strictObject({ attachmentId: attachmentIdSchema, availability: z.enum(["available", "unavailable"]) });

const updateStamp = { id: updateId, recordedAt: timestampSchema };
const attributedUpdate = { ...updateStamp, sharedByName: displayText };
const onTheWayUpdate = z.strictObject({ kind: z.literal("on_the_way"), ...attributedUpdate, band: timeBand });
const revisedArrivalUpdate = z.strictObject({
  kind: z.literal("arrival_revised"), ...attributedUpdate, band: timeBand, correctsId: updateId,
});
// The generated on-site stamp has no actor, attendance ID, or assignment ID.
export const customerUpdateSchema = z.discriminatedUnion("kind", [
  onTheWayUpdate,
  revisedArrivalUpdate,
  z.strictObject({ kind: z.literal("arrival_withdrawn"), ...attributedUpdate, correctsId: updateId }),
  z.strictObject({ kind: z.literal("on_site"), ...updateStamp, occurredAt: timestampSchema }),
  z.strictObject({ kind: z.literal("cover_arranging"), ...attributedUpdate, nextUpdateAt: timestampSchema }),
  z.strictObject({ kind: z.literal("paused"), ...attributedUpdate, nextUpdateAt: timestampSchema.nullable() }),
  z.strictObject({ kind: z.literal("photo"), ...attributedUpdate, photo, caption: caption.nullable() }),
  z.strictObject({ kind: z.enum(["crew_confirmed", "crew_updated", "working", "finished"]), ...attributedUpdate }),
]);

const customerLiveState = z.strictObject({
  step: z.enum(VISIT_STEPS).nullable(),
  // An absent/expired estimate cannot advance the day line. An offered window does not move the booking.
  status: z.enum([...VISIT_STEPS, "cover_arranging", "no_crew_available", "paused"]).nullable(),
  since: timestampSchema.nullable(),
  source: z.strictObject({ at: timestampSchema, sharedByName: displayText.nullable() }).nullable(),
  arrival: z.discriminatedUnion("kind", [onTheWayUpdate, revisedArrivalUpdate]).nullable(),
  nextUpdateAt: timestampSchema.nullable(),
}).refine(({ status, source }) => status !== "on_site" || source?.sharedByName == null, { path: ["source", "sharedByName"] });
const customerLiveSummary = z.strictObject({
  window: bookedWindow, confirmedCrewNames: z.array(displayText), live: customerLiveState,
});

// C-09 and the foreman's customer preview use a separate allowlist, not a filtered roster or site log.
export const customerLiveVisitSchema = customerLiveSummary.extend({
  visitId, job: jobHeading, siteZone, providerName: displayText, foremanName: displayText.nullable(),
  jobThreadId: idSchemaFor<"chat_thread">().nullable(),
  completionId: idSchemaFor<"completion">().nullable(),
  moments: z.array(customerUpdateSchema), page: paginationSchema,
});

export const attendanceEventSchema = z.strictObject({
  id: attendanceEventId, assignmentId, kind: z.enum(ATTENDANCE_KINDS), source: z.enum(ATTENDANCE_SOURCES),
  actualAt: timestampSchema, capturedAt: timestampSchema, receivedAt: timestampSchema,
  reviewState: z.enum(ATTENDANCE_REVIEW_STATES), correctsId: attendanceEventId.nullable(),
  reasonCode: z.enum(ATTENDANCE_REASON_CODES).nullable(), recordedByName: displayText,
});
const acceptedAttendance = attendanceEventSchema.extend({ reviewState: z.literal("accepted") });
const attendance = z.strictObject({
  arrival: acceptedAttendance.extend({ kind: z.literal("arrival") }).nullable(),
  departure: acceptedAttendance.extend({ kind: z.literal("departure") }).nullable(),
  hasPendingReview: z.boolean(),
});
const correctionRequest = z.strictObject({
  id: correctionRequestId, assignmentId, eventId: attendanceEventId, requestedByName: displayText,
  requestedAt: timestampSchema, reasonCode: z.enum(ATTENDANCE_CORRECTION_REASONS), proposedActualAt: timestampSchema.nullable(),
  state: z.enum(ATTENDANCE_CORRECTION_STATES),
  decision: z.strictObject({ byName: displayText, at: timestampSchema, correctionEventId: attendanceEventId.nullable() }).nullable(),
});

const versionSummary = z.strictObject({ id: versionId, no: z.int().positive(), issuedByName: displayText, issuedAt: timestampSchema });
const instructionLink = z.strictObject({ instructionId, version: versionSummary });
const holdFields = { id: idSchemaFor<"safety_hold">(), kind: z.enum(SAFETY_HOLD_KINDS), instruction: instructionLink.nullable() };
const safetyHold = z.discriminatedUnion("state", [
  z.strictObject({ ...holdFields, state: z.literal("active") }),
  z.strictObject({ ...holdFields, state: z.literal("cleared"), clearedAt: timestampSchema }),
]);
const checklist = z.strictObject({ hazard: z.boolean(), control: z.boolean(), response: z.boolean() }) satisfies z.ZodType<TeachBackChecklist>;
const teachBack = z.strictObject({
  id: teachBackId, verifiedByName: displayText, language: localeTagSchema, interpreterRef: idSchema.nullable(),
  checklist, outcome: z.enum(TEACH_BACK_OUTCOMES), at: timestampSchema,
});
const acknowledgement = z.strictObject({ teachBackId, workerName: displayText, at: timestampSchema });
const question = z.strictObject({ id: questionId, versionId, original, askedAt: timestampSchema });
const safetyDetails = {
  instructionId, assignmentId, viewer: z.enum(["issuer", "worker"]), workerName: displayText, siteZone,
  version: versionSummary, original, reviewedHumanReadingAid: original.nullable(),
  holds: z.array(safetyHold), questions: z.array(question), page: paginationSchema,
};
const passedTeachBack = teachBack.extend({ outcome: z.literal("passed") });

// S-11: the recipient can acknowledge only the displayed exact positive proof, online.
export const safetyInstructionSchema = z.discriminatedUnion("state", [
  z.strictObject({
    ...safetyDetails, state: z.literal("awaiting_teach_back"),
    teachBack: teachBack.extend({ outcome: z.literal("not_understood") }).nullable(),
  }),
  z.strictObject({ ...safetyDetails, state: z.literal("awaiting_acknowledgement"), teachBack: passedTeachBack }),
  z.strictObject({ ...safetyDetails, state: z.literal("acknowledged"), teachBack: passedTeachBack, acknowledgement }),
  z.strictObject({
    ...safetyDetails, state: z.literal("superseded"), teachBack: teachBack.nullable(),
    acknowledgement: acknowledgement.nullable(), replacedBy: versionSummary,
  }),
]);

const audience = z.enum(["crew_only", "crew_and_customer"]);
const estimateReceipt = z.strictObject({
  id: activityId, band: timeBand, at: timestampSchema, audience, foremanName: displayText,
});
const workStamp = z.strictObject({
  kind: z.enum(["work_started", "work_paused", "work_finished"]), id: activityId, at: timestampSchema, byName: displayText,
});

// W-04, W-06 and W-10: only this worker's assignment, estimate and attendance.
export const workerFieldShiftSchema = z.strictObject({
  id: assignmentId, shiftId, visitId, job: jobHeading.extend({ placeAlias: displayText.nullable() }), siteZone, bookedWindow, task: displayText,
  state: z.enum(ASSIGNMENT_STATES), isLead: z.boolean(), foremanName: displayText,
  crewThreadId: idSchemaFor<"chat_thread">().nullable(), estimate: estimateReceipt.nullable(),
  attendance: attendance.extend({ pendingReviewEventIds: z.array(attendanceEventId) }),
  holds: z.array(safetyHold), work: workStamp.nullable(),
  nextAction: z.enum(["depart", "check_in", "check_out", "view_briefing", "send_progress"]).nullable(),
});
export const cachedWorkerFieldShiftSchema = workerFieldShiftSchema.extend({
  job: workerFieldShiftSchema.shape.job.omit({ placeAlias: true }),
});

// W-09: ordinary safe arrival plan is not the human-reviewed safety instruction.
export const assignmentBriefingSchema = z.strictObject({
  shift: workerFieldShiftSchema,
  site: z.strictObject({
    address: displayText,
    arrivalPlan: z.strictObject({ original, reading: reading.nullable(), postedByName: displayText, postedAt: timestampSchema }).nullable(),
  }).nullable(),
  instruction: instructionLink.nullable(),
});

// Last confirmed safety context is readable offline; site access and clearance are online only.
export const cachedAssignmentBriefingSchema = z.strictObject({
  assignmentId, siteZone, bookedWindow, hasActiveHold: z.boolean(),
  instruction: instructionLink.extend({
    state: z.enum(["awaiting_teach_back", "awaiting_acknowledgement", "acknowledged"]),
    original, reviewedHumanReadingAid: original.nullable(),
  }).nullable(),
});

const shareKind = z.enum(["on_the_way", "arrival_revised", "arrival_withdrawn", "paused", "photo"]);
// F-05 and F-17: the private work state and the last published state are independent.
export const foremanVisitControlSchema = z.strictObject({
  visitId, revision: revisionSchema, job: jobHeading, siteZone, customerName: displayText,
  work: workStamp.nullable(), window: bookedWindow, customerPreview: customerLiveSummary,
  crew: z.array(z.strictObject({
    assignmentId, workerName: displayText, state: z.enum(ASSIGNMENT_STATES), estimate: estimateReceipt.nullable(), attendance,
    holds: z.array(safetyHold), instruction: instructionLink.nullable(),
    briefingReceipt: z.strictObject({ teachBack, acknowledgement: acknowledgement.nullable() }).nullable(),
  })),
  workGate: z.discriminatedUnion("status", [
    z.strictObject({ status: z.enum(["ready", "not_on_site", "finished", "not_authorized"]) }),
    z.strictObject({ status: z.literal("held"), blockedAssignments: z.array(assignmentId).min(1) }),
  ]),
  permittedUpdates: z.array(shareKind),
});
const privateLogFields = { at: timestampSchema, actorName: displayText, customerUpdateId: updateId.nullable() };
const logEntry = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("attendance"), ...privateLogFields, event: attendanceEventSchema }),
  z.strictObject({ kind: z.literal("correction_request"), ...privateLogFields, request: correctionRequest }),
  z.strictObject({ kind: z.literal("setting_off"), ...privateLogFields, assignmentId, estimate: estimateReceipt }),
  z.strictObject({ kind: z.literal("work"), ...privateLogFields, activity: workStamp }),
  z.strictObject({
    kind: z.literal("progress_photo"), ...privateLogFields, id: activityId, assignmentId, shiftId: shiftId.optional(), photo,
    capturedAt: timestampSchema, caption: caption.nullable(), canShareWithCustomer: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("arrival_plan_set"), at: timestampSchema, actorName: displayText, id: activityId, original }),
  z.strictObject({ kind: z.literal("customer_update"), update: customerUpdateSchema }),
]);
// F-13 only includes server-received stamps. The customer filter cannot carry private stamps.
export const visitLogSchema = z.discriminatedUnion("view", [
  z.strictObject({
    view: z.literal("all"), visitId, shiftId: shiftId.nullable(), control: foremanVisitControlSchema.nullable(),
    stamps: z.array(logEntry), page: paginationSchema,
  }),
  z.strictObject({ view: z.literal("customer"), visitId, siteZone, stamps: z.array(customerUpdateSchema), page: paginationSchema }),
]);

export const attendanceCaptureSchema = z.strictObject({
  id: attendanceEventId, kind: z.enum(ATTENDANCE_KINDS), actualAt: timestampSchema, capturedAt: timestampSchema,
});
const submitAttendance = attendanceCaptureSchema.extend({ source: z.enum(ATTENDANCE_SOURCES).default("self") });
const attendanceResult = z.strictObject({
  outcome: z.enum(["recorded", "existing"]), event: attendanceEventSchema, holds: z.array(safetyHold),
});
const correctionPayload = z.discriminatedUnion("reasonCode", [
  z.strictObject({ id: correctionRequestId, eventId: attendanceEventId, reasonCode: z.literal("wrong_time"), proposedActualAt: timestampSchema }),
  z.strictObject({ id: correctionRequestId, eventId: attendanceEventId, reasonCode: z.literal("disputed"), proposedActualAt: timestampSchema.optional() }),
]);
const progressCapture = { attachmentId: attachmentIdSchema, capturedAt: timestampSchema, caption: originalCaption.optional() };
const progressPhotos = z.array(z.strictObject({ id: activityId, ...progressCapture })).min(1).max(6)
  .refine((items) => new Set(items.map(({ id }) => id)).size === items.length
    && new Set(items.map(({ attachmentId }) => attachmentId)).size === items.length);
export const syncProgressPhotoLimit = 5;
export const syncProgressPhotosSchema = z.array(z.strictObject({ activityId, ...progressCapture })).min(1).max(syncProgressPhotoLimit)
  .refine((items) => new Set(items.map(({ activityId }) => activityId)).size === items.length
    && new Set(items.map(({ attachmentId }) => attachmentId)).size === items.length);
export type SyncProgressPhoto = z.output<typeof syncProgressPhotosSchema>[number];
const publishUpdate = z.discriminatedUnion("kind", [
  z.strictObject({ id: updateId, kind: z.literal("on_the_way"), band: timeBand }),
  z.strictObject({ id: updateId, kind: z.literal("arrival_revised"), correctsId: updateId, band: timeBand }),
  z.strictObject({ id: updateId, kind: z.literal("arrival_withdrawn"), correctsId: updateId }),
  z.strictObject({ id: updateId, kind: z.literal("paused"), nextUpdateAt: timestampSchema.optional() }),
  z.strictObject({
    id: updateId, kind: z.literal("photo"), attachmentId: attachmentIdSchema,
    progressEventId: activityId.optional(), caption: originalCaption.optional(),
  }),
]);
const workDecision = z.strictObject({ id: activityId, bookedWindowId: windowId });
const workResult = z.strictObject({ visitId, revision: revisionSchema, work: workStamp, published: customerUpdateSchema.nullable() });
const teachBackPayload = z.strictObject({
  id: teachBackId, versionId, language: localeTagSchema, interpreterRef: idSchema.optional(), checklist, outcome: z.enum(TEACH_BACK_OUTCOMES),
}).refine(({ outcome, checklist }) => outcome !== "passed" || (checklist.hazard && checklist.control && checklist.response), { path: ["checklist"] });

const visitCommand = <Payload extends z.ZodType>(payload: Payload) =>
  z.object({ params: visitParams, body: commandInputSchema(payload).extend({ expectedRevision: revisionSchema }) });

// Context is a transport requirement. Each route enforces the named relationship and live grants
// inside its scoped D1 read or guarded batch; the caller cannot supply authority or receipt time.
export const getVisitLiveRoute = defineRoute({
  method: "GET", path: "/visits/:id/live", auth: "context",
  input: z.object({ params: visitParams, query: paginationInputSchema.optional() }),
  output: z.union([customerLiveVisitSchema, foremanVisitControlSchema]),
});
export const getVisitLogRoute = defineRoute({
  method: "GET", path: "/visits/:id/log", auth: "context",
  input: z.object({ params: visitParams, query: paginationInputSchema.extend({
    shiftId: shiftId.optional(), view: z.enum(["all", "customer"]).default("all"),
  }).prefault({}) }), output: visitLogSchema,
});
export const departAssignmentRoute = defineRoute({
  method: "POST", path: "/assignments/:id/depart", auth: "context", command: true,
  // Recheck the lead role before sending. A changed audience requires a new deliberate preview.
  input: z.object({ params: assignmentParams, body: commandInputSchema(z.strictObject({ id: activityId, band: timeBand, expectedAudience: audience })) }),
  output: estimateReceipt,
});
export const recordAttendanceRoute = defineRoute({
  method: "POST", path: "/assignments/:id/attendance", auth: "context", command: true,
  input: z.object({ params: assignmentParams, body: commandInputSchema(submitAttendance).strict() }), output: attendanceResult,
});
export const requestAttendanceCorrectionRoute = defineRoute({
  method: "POST", path: "/assignments/:id/request-correction", auth: "context", command: true,
  input: z.object({ params: assignmentParams, body: commandInputSchema(correctionPayload) }), output: correctionRequest,
});
export const recordAssignmentProgressRoute = defineRoute({
  method: "POST", path: "/assignments/:id/progress", auth: "context", command: true,
  input: z.object({ params: assignmentParams, body: commandInputSchema(z.strictObject({ photos: progressPhotos })) }),
  output: z.strictObject({ assignmentId, receipts: z.array(z.strictObject({ id: activityId, attachmentId: attachmentIdSchema, receivedAt: timestampSchema })) }),
});
export const startVisitWorkRoute = defineRoute({
  method: "POST", path: "/visits/:id/start-work", auth: "context", command: true,
  // Recheck the current briefing proof and every applicable hold in the same batch.
  input: visitCommand(workDecision), output: workResult,
});
export const finishVisitWorkRoute = defineRoute({
  method: "POST", path: "/visits/:id/finish-work", auth: "context", command: true,
  // Ending work is neither a checkout nor customer sign-off; review requires an actual completion.
  input: visitCommand(workDecision), output: workResult,
});
export const publishVisitUpdateRoute = defineRoute({
  method: "POST", path: "/visits/:id/updates", auth: "context", command: true,
  input: visitCommand(publishUpdate),
  output: z.strictObject({ visitId, revision: revisionSchema, update: customerUpdateSchema, customerPreview: customerLiveSummary }),
});
export const getWorkerFieldShiftRoute = defineRoute({
  method: "GET", path: "/assignments/:id/field", auth: "context",
  input: z.object({ params: assignmentParams }), output: workerFieldShiftSchema,
});
export const getAssignmentBriefingRoute = defineRoute({
  method: "GET", path: "/assignments/:id/briefing", auth: "context",
  input: z.object({ params: assignmentParams }), output: assignmentBriefingSchema,
});
export const getSafetyInstructionRoute = defineRoute({
  method: "GET", path: "/safety/:id", auth: "context",
  input: z.object({ params: safetyParams, query: paginationInputSchema.extend({ versionId: versionId.optional() }).optional() }),
  output: safetyInstructionSchema,
});
export const issueSafetyInstructionRoute = defineRoute({
  method: "POST", path: "/safety/:id/issue", auth: "context", command: true,
  input: z.object({ params: safetyParams, body: commandInputSchema(z.strictObject({
    id: versionId, assignmentId, expectedVersionId: versionId.nullable(), original, reviewedHumanReadingAid: original.optional(),
  })) }), output: safetyInstructionSchema,
});
export const recordSafetyTeachBackRoute = defineRoute({
  method: "POST", path: "/safety/:id/teach-back", auth: "context", command: true,
  input: z.object({ params: safetyParams, body: commandInputSchema(teachBackPayload) }), output: safetyInstructionSchema,
});
export const acknowledgeSafetyInstructionRoute = defineRoute({
  method: "POST", path: "/safety/:id/acknowledge", auth: "context", command: true,
  input: z.object({ params: safetyParams, body: commandInputSchema(z.strictObject({ versionId, teachBackId })) }),
  output: safetyInstructionSchema,
});
export const askSafetyQuestionRoute = defineRoute({
  method: "POST", path: "/safety/:id/question", auth: "context", command: true,
  input: z.object({ params: safetyParams, body: commandInputSchema(z.strictObject({ id: questionId, versionId, original })) }), output: question,
});

export type CustomerLiveVisit = z.output<typeof customerLiveVisitSchema>;
export type CustomerUpdate = z.output<typeof customerUpdateSchema>;
export type VisitLog = z.output<typeof visitLogSchema>;
export type ForemanVisitControl = z.output<typeof foremanVisitControlSchema>;
export type WorkerFieldShift = z.output<typeof workerFieldShiftSchema>;
export type AttendanceEvent = z.output<typeof attendanceEventSchema>;
export type AssignmentBriefing = z.output<typeof assignmentBriefingSchema>;
export type CachedAssignmentBriefing = z.output<typeof cachedAssignmentBriefingSchema>;
export type SafetyInstruction = z.output<typeof safetyInstructionSchema>;
