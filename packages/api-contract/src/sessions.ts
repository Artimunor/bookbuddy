import {
  CURRENCIES, SESSIONS_FEATURE_FLAG, SESSION_ATTENDANCE_RESULTS, SESSION_BOOKING_STATES, SESSION_CHANGE_STATES,
  SESSION_DAY_STAGES, SESSION_FORMATS, SESSION_HOST_ASSIGNMENT_STATES, SESSION_PAYMENT_METHOD, SESSION_PRICE_BASES,
  SESSION_SLOT_STATES,
} from "@bookbuddy/domain";
import { z } from "zod";
import {
  businessIdSchema, commandInputSchema, cursorSchema, idSchemaFor, localeTagSchema, paginationSchema,
  revisionSchema, timestampSchema,
} from "./common";
import { defineRoute } from "./route";
import type { RouteDefinition } from "./route";

export const sessionVenueIdSchema = idSchemaFor<"session_venue">();
export const sessionListingIdSchema = idSchemaFor<"session_listing">();
export const sessionListingVersionIdSchema = idSchemaFor<"session_listing_version">();
export const sessionSlotIdSchema = idSchemaFor<"session_slot">();
export const sessionHoldIdSchema = idSchemaFor<"session_hold">();
export const sessionBookingIdSchema = idSchemaFor<"session_booking">();
export const sessionChangeProposalIdSchema = idSchemaFor<"session_change_proposal">();
export const sessionHostAssignmentIdSchema = idSchemaFor<"session_host_assignment">();
export const sessionAttendanceIdSchema = idSchemaFor<"session_attendance">();
export const sessionThreadIdSchema = idSchemaFor<"session_thread">();
export const sessionCategorySchema = z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/);
const areaId = idSchemaFor<"operating_area">();
const membershipId = idSchemaFor<"membership">();
const display = z.string().max(256).trim().min(1);
const text = z.string().max(16_000).refine((value) => value.trim().length > 0);
const count = z.int().nonnegative();
const positive = z.int().positive();
const termsHash = z.string().min(1).max(128);
const reference = z.string().regex(/^BB-S[A-Z0-9]+$/);
const siteZone = z.string().min(1).max(255);
const listingParams = z.strictObject({ id: sessionListingIdSchema });
const bookingParams = z.strictObject({ id: sessionBookingIdSchema });
const holdParams = z.strictObject({ id: sessionHoldIdSchema });
const slotTime = { startsAt: timestampSchema, endsAt: timestampSchema };

const provider = z.strictObject({ id: businessIdSchema, name: display });
const listing = { id: sessionListingIdSchema, provider, category: sessionCategorySchema };
const venueSummary = z.strictObject({ id: sessionVenueIdSchema, name: display, locality: display, siteZone, accessNote: text });
const venueDetails = venueSummary.extend({ address: display, arrivalNote: text });
const unitPrice = z.strictObject({ currency: z.enum(CURRENCIES), unitMinor: count, basis: z.enum(SESSION_PRICE_BASES) });
export const sessionPriceSchema = unitPrice.extend({ paymentMethod: z.literal(SESSION_PAYMENT_METHOD) });
const versionCard = z.strictObject({
  id: sessionListingVersionIdSchema, title: display, venue: venueSummary, price: sessionPriceSchema,
  format: z.enum(SESSION_FORMATS), durationMs: positive, language: localeTagSchema,
});
const termsSource = z.strictObject({ text, locale: localeTagSchema, cancellationNoticeMs: count });
const versionDetails = versionCard.extend({
  venue: venueDetails, description: text, originalLocale: localeTagSchema, hostGuaranteed: z.boolean(),
  terms: termsSource.extend({ hash: termsHash }),
});
const confirmation = { at: timestampSchema, byName: display };
const confirmedHost = z.strictObject({ name: display, language: localeTagSchema, confirmed: z.strictObject(confirmation) });
const day = z.strictObject({ stage: z.enum(SESSION_DAY_STAGES), ...confirmation });
const places = { capacity: positive, placesLeft: count };
const customerSlot = z.strictObject({
  id: sessionSlotIdSchema, listingVersionId: sessionListingVersionIdSchema, ...slotTime, ...places,
  state: z.enum(["published", "paused"]),
});
export const customerSessionCardSchema = z.strictObject({ ...listing, version: versionCard, nextSlot: customerSlot });
export const customerSessionDetailSchema = z.strictObject({
  ...listing, audience: z.literal("customer"), availability: z.enum(["available", "full", "paused"]),
  nextSlotId: sessionSlotIdSchema.nullable(),
  // Each slot is offered against the exact version identified here, not the newest draft.
  versions: z.array(versionDetails).max(100),
  slots: z.array(customerSlot.extend({ host: confirmedHost.nullable(), freeCancellationUntil: timestampSchema })).max(100),
  page: paginationSchema,
});

const agreement = z.strictObject({
  slotId: sessionSlotIdSchema, ...slotTime, version: versionDetails, places: positive, totalMinor: count,
  freeCancellationUntil: timestampSchema,
});
const proposal = z.strictObject({
  id: sessionChangeProposalIdSchema, version: positive, state: z.enum([...SESSION_CHANGE_STATES, "expired"]),
  respondBy: timestampSchema, proposed: agreement, sent: z.strictObject(confirmation), decidedAt: timestampSchema.nullable(),
});
export const customerSessionBookingSchema = z.strictObject({
  id: sessionBookingIdSchema, reference, listingId: sessionListingIdSchema, provider, revision: revisionSchema,
  state: z.enum(SESSION_BOOKING_STATES), bookerName: display, bookedAt: timestampSchema,
  original: z.strictObject({ slotId: sessionSlotIdSchema, listingVersionId: sessionListingVersionIdSchema, termsHash }),
  agreement, day: day.nullable(),
  host: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("confirmed"), host: confirmedHost, isSubstitute: z.boolean() }),
    z.strictObject({ status: z.enum(["unconfirmed", "arranging"]), nextUpdateAt: timestampSchema.nullable() }),
  ]),
  coordinatorName: display.nullable(), threadId: sessionThreadIdSchema.nullable(),
  proposal: proposal.nullable(), cancellation: z.strictObject(confirmation).nullable(),
  actions: z.strictObject({ move: z.boolean(), cancel: z.boolean(), respond: z.boolean(), leaveFeedback: z.boolean() }),
});
export const sessionHoldProjectionSchema = z.strictObject({
  status: z.literal("held"), id: sessionHoldIdSchema, listingId: sessionListingIdSchema, provider, bookerName: display,
  expiresAt: timestampSchema, agreement, host: confirmedHost.nullable(),
  moveFrom: z.strictObject({ id: sessionBookingIdSchema, reference, ...slotTime, siteZone }).nullable(),
});
const holdOutcome = z.discriminatedUnion("status", [
  sessionHoldProjectionSchema,
  z.strictObject({
    status: z.literal("not_held"), reason: z.enum(["places_unavailable", "booking_unavailable", "active_hold_exists"]),
    slotId: sessionSlotIdSchema, placesLeft: count,
  }),
]);
const notBooked = z.discriminatedUnion("reason", [
  z.strictObject({ reason: z.literal("expired"), expiresAt: timestampSchema }),
  z.strictObject({ reason: z.literal("slot_unavailable") }),
  z.strictObject({ reason: z.literal("terms_changed"), current: agreement }),
]);

const hostAssignment = z.strictObject({
  id: sessionHostAssignmentIdSchema, membershipId, name: display, position: positive, roleLabel: display,
  language: localeTagSchema, state: z.enum(SESSION_HOST_ASSIGNMENT_STATES), changed: z.strictObject(confirmation),
});
const providerSlot = z.strictObject({
  id: sessionSlotIdSchema, listingVersionId: sessionListingVersionIdSchema, ...slotTime, ...places,
  state: z.enum(SESSION_SLOT_STATES), day: day.nullable(), revision: revisionSchema,
  hostsRequired: positive, heldPlaces: count, bookedPlaces: count,
  coordinator: z.strictObject({ membershipId, name: display }).nullable(),
});
const attendanceReceipt = z.strictObject({
  id: sessionAttendanceIdSchema, bookingId: sessionBookingIdSchema, result: z.enum(SESSION_ATTENDANCE_RESULTS),
  placesAttended: count, correctsId: sessionAttendanceIdSchema.nullable(), recorded: z.strictObject(confirmation),
});
// A roster is scoped separately from listing setup. No guest list, contact details or proof documents.
export const providerSessionRosterSchema = z.strictObject({
  slot: providerSlot, assignments: z.array(hostAssignment),
  attendees: z.array(z.strictObject({ id: sessionBookingIdSchema, bookerName: display, places: positive, attendance: attendanceReceipt.nullable() })).max(100),
  attendeesPage: paginationSchema,
});
export const providerSessionDetailSchema = z.strictObject({
  ...listing, audience: z.literal("provider"), revision: revisionSchema,
  version: versionDetails.extend({ no: positive, guaranteedHostMembershipId: membershipId.nullable() }).nullable(),
  slots: z.array(providerSlot).max(100), page: paginationSchema, roster: providerSessionRosterSchema.nullable(),
  actions: z.strictObject({ publish: z.boolean(), roster: z.boolean(), changeHost: z.boolean(), recordAttendance: z.boolean() }),
});

// The Worker must join against an enabled `feature_flags` row for the market/category
// in the same D1 call as the live business/capability/scope check. Missing is off.
function defineSessionRoute<const Route extends RouteDefinition>(route: Route) {
  return defineRoute({ ...route, featureFlag: SESSIONS_FEATURE_FLAG });
}

function sessionCommand<const Path extends `/${string}`, Params extends z.ZodType<Record<string, string>>, Payload extends z.ZodType,
  Output extends z.ZodType>(path: Path, params: Params, payload: Payload, output: Output) {
  return defineSessionRoute({
    method: "POST", path, auth: "context", command: true,
    input: z.strictObject({ params, body: commandInputSchema(payload).strict() }), output,
  });
}

export const listSessionsRoute = defineSessionRoute({
  method: "GET", path: "/sessions", auth: "context",
  input: z.strictObject({ query: z.strictObject({ areaId, locality: display.optional(), category: sessionCategorySchema.optional(), cursor: cursorSchema.optional() }) }),
  output: z.strictObject({ categories: z.array(sessionCategorySchema), sessions: z.array(customerSessionCardSchema).max(100), page: paginationSchema }),
});
export const getSessionRoute = defineSessionRoute({
  method: "GET", path: "/sessions/:id", auth: "context",
  input: z.strictObject({ params: listingParams, query: z.strictObject({
    cursor: cursorSchema.optional(), rosterSlotId: sessionSlotIdSchema.optional(), attendeeCursor: cursorSchema.optional(),
  }).optional() }),
  output: z.discriminatedUnion("audience", [customerSessionDetailSchema, providerSessionDetailSchema]),
});
export const getSessionBookingRoute = defineSessionRoute({
  method: "GET", path: "/session-bookings/:id", auth: "context",
  input: z.strictObject({ params: bookingParams }), output: customerSessionBookingSchema,
});

export const createSessionHoldRoute = sessionCommand("/sessions/:id/holds", listingParams, z.strictObject({
  id: sessionHoldIdSchema, slotId: sessionSlotIdSchema, places: positive, moveBookingId: sessionBookingIdSchema.optional(),
}), holdOutcome);
const acceptedHoldTerms = z.strictObject({ listingVersionId: sessionListingVersionIdSchema, termsHash, totalMinor: count });
export const bookSessionHoldRoute = sessionCommand("/holds/:id/book", holdParams, z.strictObject({
  id: sessionBookingIdSchema, ...acceptedHoldTerms.shape,
}), z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("booked"), booking: customerSessionBookingSchema }),
  z.strictObject({ status: z.literal("not_booked"), failure: notBooked }),
]));
export const releaseSessionHoldRoute = sessionCommand("/holds/:id/release", holdParams, z.strictObject({}),
  z.strictObject({ id: sessionHoldIdSchema, state: z.enum(["released", "consumed"]), resolvedAt: timestampSchema }));
export const moveSessionBookingRoute = sessionCommand("/session-bookings/:id/move", bookingParams, acceptedHoldTerms.extend({
  holdId: sessionHoldIdSchema, bookingRevision: revisionSchema,
}), z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("moved"), booking: customerSessionBookingSchema }),
  z.strictObject({ status: z.literal("not_moved"), booking: customerSessionBookingSchema, failure: notBooked }),
]));
export const cancelSessionBookingRoute = sessionCommand("/session-bookings/:id/cancel", bookingParams,
  z.strictObject({ bookingRevision: revisionSchema, termsHash }), customerSessionBookingSchema);
export const respondToSessionChangeRoute = sessionCommand("/session-bookings/:id/respond", bookingParams, z.strictObject({
  bookingRevision: revisionSchema, proposalId: sessionChangeProposalIdSchema, version: positive,
  decision: z.enum(["accept", "decline"]),
}), customerSessionBookingSchema);

const slotTarget = { slotId: sessionSlotIdSchema, slotRevision: revisionSchema };
const listingDraft = z.strictObject({
  kind: z.literal("save_listing"), listingVersionId: sessionListingVersionIdSchema,
  category: sessionCategorySchema, venueId: sessionVenueIdSchema, title: display, description: text,
  originalLocale: localeTagSchema, language: localeTagSchema, format: z.enum(SESSION_FORMATS), durationMs: positive,
  guaranteedHostMembershipId: membershipId.nullable(), price: unitPrice, terms: termsSource,
}).refine(({ format, price }) => (format === "private") === (price.basis === "per_appointment"), { path: ["price", "basis"] });
const slotDraft = z.strictObject({
  kind: z.literal("save_slot"), slotId: sessionSlotIdSchema, slotRevision: revisionSchema.nullable(),
  listingVersionId: sessionListingVersionIdSchema, ...slotTime, capacity: positive, hostsRequired: positive,
  coordinatorMembershipId: membershipId.nullable(),
}).refine(({ startsAt, endsAt }) => endsAt > startsAt, { path: ["endsAt"] });
export const publishSessionRoute = sessionCommand("/sessions/:id/publish", listingParams, z.discriminatedUnion("kind", [
  listingDraft, slotDraft,
  z.strictObject({ kind: z.literal("publish"), ...slotTarget, listingVersionId: sessionListingVersionIdSchema }),
  z.strictObject({ kind: z.enum(["pause", "cancel"]), ...slotTarget }),
]), providerSessionDetailSchema);
export const updateSessionRosterRoute = sessionCommand("/sessions/:id/roster", listingParams, z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("propose_host"), ...slotTarget, id: sessionHostAssignmentIdSchema, membershipId,
    position: positive, roleLabel: display, language: localeTagSchema }),
  z.strictObject({ kind: z.enum(["confirm_host", "release_host"]), ...slotTarget, assignmentId: sessionHostAssignmentIdSchema }),
  z.strictObject({ kind: z.literal("confirm_stage"), ...slotTarget, stage: z.enum(SESSION_DAY_STAGES) }),
]), providerSessionRosterSchema);
export const changeSessionHostRoute = sessionCommand("/sessions/:id/host-change", listingParams, z.discriminatedUnion("kind", [
  // Confirmation is own-team only. A guaranteed-host or other terms change is not a substitute update.
  z.strictObject({ kind: z.literal("substitute"), ...slotTarget,
    replacedAssignmentId: sessionHostAssignmentIdSchema, replacementAssignmentId: sessionHostAssignmentIdSchema }),
  z.strictObject({ kind: z.literal("propose_change"), ...slotTarget, id: sessionChangeProposalIdSchema,
    bookingId: sessionBookingIdSchema, bookingRevision: revisionSchema, proposedSlotId: sessionSlotIdSchema,
    proposedListingVersionId: sessionListingVersionIdSchema, respondBy: timestampSchema }),
  z.strictObject({ kind: z.literal("withdraw_change"), ...slotTarget, bookingId: sessionBookingIdSchema,
    proposalId: sessionChangeProposalIdSchema, version: positive }),
]), providerSessionRosterSchema);
export const recordSessionAttendanceRoute = sessionCommand("/sessions/:id/attendance", listingParams, z.strictObject({
  ...slotTarget, id: sessionAttendanceIdSchema, bookingId: sessionBookingIdSchema,
  result: z.enum(SESSION_ATTENDANCE_RESULTS), placesAttended: count,
  correction: z.strictObject({ correctsId: sessionAttendanceIdSchema, reason: display }).nullable(),
}).refine(({ result, placesAttended }) => (result === "attended") === (placesAttended > 0), { path: ["placesAttended"] }), attendanceReceipt);

export type CustomerSessionCard = z.output<typeof customerSessionCardSchema>;
export type CustomerSessionDetail = z.output<typeof customerSessionDetailSchema>;
export type CustomerSessionBooking = z.output<typeof customerSessionBookingSchema>;
export type SessionHoldProjection = z.output<typeof sessionHoldProjectionSchema>;
export type ProviderSessionDetail = z.output<typeof providerSessionDetailSchema>;
export type ProviderSessionRoster = z.output<typeof providerSessionRosterSchema>;
