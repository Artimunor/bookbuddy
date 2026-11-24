import {
  ASSIGNMENT_SOURCES, ASSIGNMENT_STATES, AVAILABILITY_SOURCES, CURRENCIES, CUSTOMER_UPDATE_KINDS,
  RESCHEDULE_REQUEST_STATES, SAFETY_HOLD_KINDS, SHIFT_STATES, VISIT_KINDS, VISIT_STATES, WINDOW_CONFIRMATION_MODES,
} from "@bookbuddy/domain";
import { z } from "zod";
import { membershipIdSchema } from "./access";
import {
  businessIdSchema, commandInputSchema, idSchema, idSchemaFor, localeTagSchema, paginationInputSchema, paginationSchema,
  revisionSchema, timestampSchema,
} from "./common";
import { defineRoute } from "./route";

const jobId = idSchemaFor<"job">();
const quoteVersionId = idSchemaFor<"quote_version">();
const visitId = idSchemaFor<"visit">();
const windowId = idSchemaFor<"visit_window">();
const requestId = idSchemaFor<"reschedule_request">();
const shiftId = idSchemaFor<"shift">();
const assignmentId = idSchemaFor<"assignment">();
const jobParams = z.object({ j: jobId });
const windowParams = z.object({ id: windowId });
const visitParams = z.object({ id: visitId });
const availabilityParams = z.object({ member: membershipIdSchema });
const displayName = z.string().min(1);
const localDate = z.iso.date();

// Only resolved, named IANA zones go on these projections; never offsets or a device default.
const validSiteZones = new Set<string>();
const siteZone = z.string().min(1).max(255).refine((zone) => {
  if (validSiteZones.has(zone)) return true;
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    validSiteZones.add(zone);
    return true;
  } catch {
    return false;
  }
});

const span = { startsAt: timestampSchema, endsAt: timestampSchema };
const hasOrderedTimes = ({ startsAt, endsAt }: { startsAt: number; endsAt: number }) => startsAt < endsAt;
const scheduledSpan = z.object(span).refine(hasOrderedTimes, { path: ["endsAt"] });
const jobSummary = z.object({
  id: jobId, reference: z.string().regex(/^BB-[A-Z0-9]+$/), title: displayName,
});
const approvedQuote = z.object({ id: quoteVersionId, number: z.int().positive(), totalMinor: z.int().nonnegative(), currency: z.enum(CURRENCIES) });

const offeredWindow = z.object({
  id: windowId, ...span, expiresAt: timestampSchema, proposedAt: timestampSchema, replacesWindowId: windowId.nullable(),
  confirmationMode: z.enum(WINDOW_CONFIRMATION_MODES).nullable(),
});
const bookedWindow = z.object({
  id: windowId, ...span, confirmedAt: timestampSchema,
  crewAvailability: z.enum(["as_agreed", "no_crew_available"]),
});

// C-08 and C-17 deliberately have no crew/person detail, capacity, or dropout reason.
// A pending request or proposal is separate from the existing booking.
export const visitScheduleSchema = z.object({
  id: visitId,
  kind: z.enum(VISIT_KINDS),
  state: z.enum(VISIT_STATES),
  revision: revisionSchema,
  bookedWindow: bookedWindow.nullable(),
  offeredWindows: z.array(offeredWindow),
  rescheduleRequest: z.object({
    id: requestId, state: z.enum(RESCHEDULE_REQUEST_STATES), requestedAt: timestampSchema, replyBy: timestampSchema,
  }).nullable(),
  cancellation: z.object({ at: timestampSchema, byViewer: z.boolean() }).nullable(),
  actions: z.object({ canCancelFeeFree: z.boolean(), canRequestReschedule: z.boolean() }),
});
export const jobWindowsSchema = z.object({
  job: jobSummary,
  siteZone,
  foremanName: displayName.nullable(),
  approvedQuote: approvedQuote.nullable(),
  // An independent commercial entitlement, not a cancellation or a request to the provider.
  withdrawalQuoteVersionId: quoteVersionId.nullable(),
  visits: z.array(visitScheduleSchema),
});
const changedVisitSchedule = z.object({ jobId, siteZone, visit: visitScheduleSchema });

// F-06: capacity is scoped to this job and week. Unrelated work is only an
// opaque busy interval. These lanes are neither assignments nor reservations.
const capacity = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unavailable") }),
  z.object({ state: z.literal("ready"), days: z.array(z.object({
    date: localDate,
    lanes: z.array(z.object({
      membershipId: membershipIdSchema, displayName, available: z.array(scheduledSpan), busy: z.array(scheduledSpan),
    })),
  })).length(7) }),
]);
export const businessScheduleSchema = z.object({
  businessId: businessIdSchema,
  job: jobSummary,
  siteZone,
  approvedQuote: approvedQuote.nullable(),
  visit: visitScheduleSchema.nullable(),
  bookedByName: displayName.nullable(),
  capacity,
});

const shiftSummary = z.object({
  id: shiftId, visitId, job: jobSummary, ...span, siteZone, placeAlias: displayName, task: displayName,
  skill: displayName, briefingLanguage: localeTagSchema, state: z.enum(SHIFT_STATES),
});
const workerAssignment = z.object({
  id: assignmentId, source: z.enum(ASSIGNMENT_SOURCES), state: z.enum(ASSIGNMENT_STATES), confirmedAt: timestampSchema,
});
const rosterAssignmentBase = workerAssignment.extend({
  member: z.object({ id: membershipIdSchema, displayName }), confirmedByName: displayName,
});
const assignmentState = z.enum(ASSIGNMENT_STATES);
const rosterAssignment = z.discriminatedUnion("state", [
  rosterAssignmentBase.extend({ state: assignmentState.exclude(["dropped"]) }),
  rosterAssignmentBase.extend({
    state: z.literal("dropped"), droppedAt: timestampSchema,
    dropoutReason: z.enum(["transport", "another_job", "personal"]).nullable(),
  }),
]);
const slot = z.object({
  id: idSchemaFor<"shift_slot">(), number: z.int().positive(), isLead: z.boolean(),
  assignments: z.array(rosterAssignment),
  pendingOffer: z.object({
    recipientName: displayName, replyBy: timestampSchema, state: z.enum(["offered", "awaiting_confirmation"]),
  }).nullable(),
});
const briefingHold = z.object({
  id: idSchemaFor<"safety_hold">(), kind: z.enum(SAFETY_HOLD_KINDS),
  instruction: z.object({ id: idSchemaFor<"safety_instruction">(), version: z.int().positive() }).nullable(),
});
const customerUpdate = z.discriminatedUnion("state", [
  z.object({ state: z.literal("not_shared") }),
  z.object({ state: z.literal("pending") }),
  z.object({ state: z.literal("published"), kind: z.enum(CUSTOMER_UPDATE_KINDS), publishedAt: timestampSchema }),
]);
const crewThreadId = idSchemaFor<"chat_thread">().nullable();

// F-16 includes the roster and its history. An assignee gets only their own
// assignment and holds; shift access does not grant the foreman's projection.
export const shiftDetailSchema = z.discriminatedUnion("view", [
  z.object({
    view: z.literal("foreman"), shift: shiftSummary, slots: z.array(slot),
    holds: z.array(briefingHold.extend({ assignmentId })), customerUpdate, crewThreadId,
    nextAction: z.enum(["assign_crew", "find_cover", "share_update"]).nullable(),
  }),
  z.object({
    view: z.literal("worker"), shift: shiftSummary.extend({ placeAlias: displayName.nullable() }),
    assignment: workerAssignment, holds: z.array(briefingHold), crewThreadId,
  }),
]);

// W-02: a provisional cover reply is an offer, never an assigned shift or a
// grant to the exact site. Only confirmed work goes in Upcoming.
const shiftAgendaEntry = z.object({
  kind: z.literal("shift"), shift: shiftSummary.extend({ placeAlias: displayName.nullable() }), assignment: workerAssignment,
});
const shiftOfferAgendaEntry = z.object({
  kind: z.literal("offer"), id: idSchema,
  ...span, siteZone, areaName: displayName, task: displayName, replyBy: timestampSchema,
});
const ordinaryOfferAgendaEntry = shiftOfferAgendaEntry.extend({ source: z.literal("ordinary") });
const coverOfferAgendaEntry = shiftOfferAgendaEntry.extend({ source: z.literal("cover"), gapId: idSchemaFor<"cover_gap">() });
const pendingOfferState = { state: z.enum(["offered", "awaiting_confirmation"]) };
const pastOfferState = { state: z.enum(["filled", "expired", "declined", "withdrawn", "released"]), endedAt: timestampSchema };
const shiftAgendaSegment = z.enum(["upcoming", "offers", "past"]);
export const shiftAgendaSchema = z.discriminatedUnion("segment", [
  paginationSchema.extend({
    segment: z.literal("upcoming"), total: z.int().nonnegative(),
    rows: z.array(shiftAgendaEntry.extend({
      shift: shiftSummary,
      assignment: workerAssignment.extend({ state: z.literal("confirmed") }),
      nextAction: z.enum(["view_shift", "check_briefing", "depart", "check_in", "check_out"]),
    })),
  }),
  paginationSchema.extend({
    segment: z.literal("offers"),
    rows: z.array(z.discriminatedUnion("source", [
      ordinaryOfferAgendaEntry.extend(pendingOfferState),
      coverOfferAgendaEntry.extend(pendingOfferState),
    ])),
  }),
  paginationSchema.extend({
    segment: z.literal("past"),
    rows: z.array(z.union([
      shiftAgendaEntry.extend({ outcome: z.enum(["completed", "cancelled", "dropped", "released"]), endedAt: timestampSchema }),
      z.discriminatedUnion("source", [
        ordinaryOfferAgendaEntry.extend(pastOfferState),
        coverOfferAgendaEntry.extend(pastOfferState),
      ]),
    ])),
  }),
]);

// W-08: effective hours for the selected business zone, not assignments.
// Reading or saving preferences never changes the separately listed work.
const availabilityShiftBasis = z.strictObject({ assignmentId, ...span }).refine(hasOrderedTimes);
const availabilityDay = z.object({
  date: localDate,
  revision: revisionSchema,
  preference: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("not_set") }),
    z.object({ kind: z.literal("available"), hours: z.array(scheduledSpan).min(1), openToCover: z.boolean(),
      savedAt: timestampSchema, source: z.enum(AVAILABILITY_SOURCES) }),
    z.object({ kind: z.literal("unavailable"), savedAt: timestampSchema, source: z.enum(AVAILABILITY_SOURCES) }),
  ]),
  confirmedShifts: z.array(z.object({
    shiftId, assignmentId, ...span, siteZone, conflictsWithPreference: z.boolean(),
  })),
});
const availabilityScope = z.object({ membershipId: membershipIdSchema, businessId: businessIdSchema, siteZone });
export const crewAvailabilitySchema = availabilityScope.extend({ days: z.array(availabilityDay).length(7) });
const changedAvailability = availabilityScope.extend({ day: availabilityDay });

const proposal = z.strictObject({ id: windowId, ...span, expiresAt: timestampSchema })
  .refine(hasOrderedTimes, { path: ["endsAt"] })
  .refine(({ expiresAt, startsAt }) => expiresAt <= startsAt, { path: ["expiresAt"] });
const proposeWindows = z.strictObject({
  visitId,
  approvedQuoteVersionId: quoteVersionId.nullable(),
  purpose: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("booking"), visitKind: z.enum(VISIT_KINDS), requestId: requestId.nullable() }),
    z.strictObject({ kind: z.literal("direct_alternative"), replacesWindowId: windowId }),
    // Null requestId initiates an exact provider proposal; a non-null ID answers an existing request.
    z.strictObject({ kind: z.literal("agreement"), replacesWindowId: windowId, requestId: requestId.nullable() }),
  ]),
  windows: z.array(proposal).min(1).max(20).refine((windows) => new Set(windows.map(({ id }) => id)).size === windows.length),
});

const availabilityHours = z.array(z.strictObject(span).refine(hasOrderedTimes, { path: ["endsAt"] })).min(1).max(24)
  .refine((hours) => hours.every((hour, index) => index === 0 || hours[index - 1]!.endsAt <= hour.startsAt));
const availabilityConfirmedShifts = z.array(availabilityShiftBasis).max(100)
  .refine((shifts) => new Set(shifts.map(({ assignmentId }) => assignmentId)).size === shifts.length);
const availabilityEditBasis = { date: localDate, expectedConfirmedShifts: availabilityConfirmedShifts };
const changeAvailability = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("available"), ...availabilityEditBasis, hours: availabilityHours, openToCover: z.boolean() }),
  z.strictObject({ kind: z.literal("unavailable"), ...availabilityEditBasis }),
]);

function versionedScheduleCommand<Params extends z.ZodType, Payload extends z.ZodType>(params: Params, payload: Payload) {
  return z.object({ params, body: commandInputSchema(payload).extend({ expectedRevision: revisionSchema }) });
}

// The credential scope is not the authority check: the same guarded D1 call
// checks the live relationship, exact revision, times and applicable capacity.
export const getJobWindowsRoute = defineRoute({
  method: "GET", path: "/jobs/:j/windows", auth: "context",
  input: z.object({ params: jobParams }), output: jobWindowsSchema,
});
export const getBusinessScheduleRoute = defineRoute({
  method: "GET", path: "/businesses/:b/schedule", auth: "context",
  input: z.object({
    params: z.object({ b: businessIdSchema }), query: z.object({ jobId, visitId: visitId.optional(), weekOf: localDate.optional() }),
  }), output: businessScheduleSchema,
});
export const listShiftsRoute = defineRoute({
  method: "GET", path: "/shifts", auth: "context",
  input: z.object({ query: paginationInputSchema.extend({ segment: shiftAgendaSegment.optional() }).optional() }),
  output: shiftAgendaSchema,
});
export const getShiftRoute = defineRoute({
  method: "GET", path: "/shifts/:s", auth: "context",
  input: z.object({ params: z.object({ s: shiftId }) }), output: shiftDetailSchema,
});
export const getCrewAvailabilityRoute = defineRoute({
  method: "GET", path: "/crew/:member/availability", auth: "context",
  input: z.object({ params: availabilityParams, query: z.object({ weekOf: localDate.optional() }).optional() }),
  output: crewAvailabilitySchema,
});
export const proposeVisitWindowsRoute = defineRoute({
  method: "POST", path: "/jobs/:j/windows", auth: "context", command: true,
  input: versionedScheduleCommand(jobParams, proposeWindows), output: changedVisitSchedule,
});
export const confirmVisitWindowRoute = defineRoute({
  method: "POST", path: "/windows/:id/confirm", auth: "context", command: true,
  input: versionedScheduleCommand(windowParams, z.strictObject({ approvedQuoteVersionId: quoteVersionId.nullable() })),
  output: changedVisitSchedule,
});
export const withdrawVisitWindowRoute = defineRoute({
  method: "POST", path: "/windows/:id/withdraw", auth: "context", command: true,
  input: versionedScheduleCommand(windowParams, z.strictObject({})), output: changedVisitSchedule,
});
export const cancelVisitRoute = defineRoute({
  method: "POST", path: "/visits/:id/cancel", auth: "context", command: true,
  input: versionedScheduleCommand(visitParams, z.strictObject({ bookedWindowId: windowId })), output: changedVisitSchedule,
});
export const requestVisitRescheduleRoute = defineRoute({
  method: "POST", path: "/visits/:id/request-reschedule", auth: "context", command: true,
  input: versionedScheduleCommand(visitParams, z.strictObject({ id: requestId, bookedWindowId: windowId.nullable() })),
  output: changedVisitSchedule,
});
export const patchCrewAvailabilityRoute = defineRoute({
  method: "PATCH", path: "/crew/:member/availability", auth: "context", command: true,
  input: versionedScheduleCommand(availabilityParams, changeAvailability), output: changedAvailability,
});

export type VisitSchedule = z.output<typeof visitScheduleSchema>;
export type JobWindows = z.output<typeof jobWindowsSchema>;
export type BusinessSchedule = z.output<typeof businessScheduleSchema>;
export type ShiftDetail = z.output<typeof shiftDetailSchema>;
export type ShiftAgenda = z.output<typeof shiftAgendaSchema>;
export type CrewAvailability = z.output<typeof crewAvailabilitySchema>;
