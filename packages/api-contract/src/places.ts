import { INVITATION_POLICY, INVITATION_STATES, JOB_STATES, JOURNEY_STEPS, PLACE_CAPABILITIES, PLACE_STATES } from "@bookbuddy/domain";
import { z } from "zod";
import {
  accountIdSchema, commandInputSchema, cursorSchema, idSchemaFor, paginationSchema, revisionSchema, timestampSchema,
} from "./common";
import { defineRoute } from "./route";

export const placeIdSchema = idSchemaFor<"place">();
export const invitationIdSchema = idSchemaFor<"invitation">();
export const placeCapabilitySchema = z.enum(PLACE_CAPABILITIES);

const placeParams = z.object({ p: placeIdSchema });
const alias = z.string().trim().min(1).max(100);
const address = z.string().trim().min(1).max(500);
// This field is for non-secret arrangements only, never an entry code or alarm detail.
const safeArrivalNote = z.string().trim().min(1).max(500);
const displayName = z.string().min(1);
const count = z.int().nonnegative();
const relationship = z.enum(["owner", "manager", "viewer", "verification_pending"]);
const placeState = z.enum(PLACE_STATES);

export const placePinSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

// Address search is server-side, in the same authorized list read. The list carries no address or pin.
export const placeSummarySchema = z.object({
  id: placeIdSchema,
  alias,
  state: placeState,
  areaName: z.string().min(1).nullable(),
  siteZone: z.string().min(1).nullable(),
  relationship,
  ownerDisplayName: displayName.nullable(),
  namedApproverDisplayName: displayName.nullable(),
  viewerIsNamedApprover: z.boolean(),
  openBookingCount: count,
  liveBookingCount: count,
});

const placePerson = z.object({
  accountId: accountIdSchema,
  displayName,
  isOwner: z.boolean(),
  isNamedApprover: z.boolean(),
  capabilities: z.array(placeCapabilitySchema),
});

const placeBooking = z.object({
  jobId: idSchemaFor<"job">(),
  reference: z.string().regex(/^BB-[A-Z0-9]+$/),
  title: z.string().min(1),
  journeyStep: z.enum(JOURNEY_STEPS),
  state: z.enum(JOB_STATES),
});

export const invitationManagementSchema = z.object({
  id: invitationIdSchema,
  email: z.email(),
  state: z.enum(INVITATION_STATES),
  inviterDisplayName: displayName,
  issuedAt: timestampSchema,
  expiresAt: timestampSchema,
  endedAt: timestampSchema.nullable(),
  siteZone: z.string().min(1).nullable(),
  canWithdraw: z.boolean(),
  reissue: z.discriminatedUnion("status", [
    z.object({ status: z.literal("available") }),
    z.object({ status: z.literal("wait"), retryAt: timestampSchema }),
    z.object({ status: z.literal("unavailable") }),
  ]),
});

export const managedPlaceViewInvitationSchema = invitationManagementSchema.extend({
  kind: z.literal("place_view"),
  placeId: placeIdSchema,
  capabilities: z.tuple([z.literal("view")]),
});

export const managedPlaceTransferInvitationSchema = invitationManagementSchema.extend({
  kind: z.literal("place_transfer"),
  placeId: placeIdSchema,
});

export const placeDetailsSchema = placeSummarySchema.extend({
  revision: revisionSchema,
  address: address.nullable(),
  pin: placePinSchema.nullable(),
  safeArrivalNote: safeArrivalNote.nullable(),
  people: z.array(placePerson),
  // Null means invitation management is outside the viewer's grant, not that there are no invitations.
  pendingInvitations: z.array(z.discriminatedUnion("kind", [
    managedPlaceViewInvitationSchema, managedPlaceTransferInvitationSchema,
  ])).max(INVITATION_POLICY.maxOutstandingPerPlace).nullable(),
  bookings: z.array(placeBooking),
  actions: z.object({
    edit: z.boolean(),
    verifyPin: z.boolean(),
    invite: z.boolean(),
    changeApprover: z.boolean(),
    transfer: z.boolean(),
    archive: z.boolean(),
  }),
});

export const placeListSchema = paginationSchema.extend({
  total: count,
  places: z.array(placeSummarySchema),
});

export type PlaceSummary = z.infer<typeof placeSummarySchema>;
export type PlaceDetails = z.infer<typeof placeDetailsSchema>;
export type PlaceList = z.infer<typeof placeListSchema>;

const placeEdit = z.strictObject({ alias, address, safeArrivalNote: safeArrivalNote.nullable() });
const placePatch = placeEdit.partial().refine((fields) => Object.values(fields).some((value) => value !== undefined));
const successor = z.strictObject({ successorAccountId: accountIdSchema });
const placePersonPatch = z.strictObject({
  view: z.boolean().optional(),
  message: z.boolean().optional(),
  // True names this person; withdrawing the current person's approval requires a successor.
  approve: z.boolean().optional(),
  successorAccountId: accountIdSchema.optional(),
}).refine(({ view, message, approve, successorAccountId }) =>
  (view !== undefined || message !== undefined || approve !== undefined) && (successorAccountId === undefined || approve === false));

export type PlacePersonPatch = z.infer<typeof placePersonPatch>;

function versionedPlaceCommand<Payload extends z.ZodType>(payload: Payload) {
  return z.object({ params: placeParams, body: commandInputSchema(payload).extend({ expectedRevision: revisionSchema }) });
}

// All context routes additionally check the viewer's live place relationship or grant.
export const listPlacesRoute = defineRoute({
  method: "GET", path: "/places", auth: "context",
  input: z.object({ query: z.object({ cursor: cursorSchema.optional(), q: z.string().trim().max(160).optional() }).optional() }),
  output: placeListSchema,
});

export const getPlaceRoute = defineRoute({
  method: "GET", path: "/places/:p", auth: "context",
  input: z.object({ params: placeParams }), output: placeDetailsSchema,
});

export const createPlaceRoute = defineRoute({
  method: "POST", path: "/places", auth: "context", command: true,
  input: z.object({ body: commandInputSchema(placeEdit.extend({
    safeArrivalNote: safeArrivalNote.nullable().optional(),
    pin: placePinSchema.optional(),
  })) }),
  output: placeDetailsSchema,
});

export const patchPlaceRoute = defineRoute({
  method: "PATCH", path: "/places/:p", auth: "context", command: true,
  input: versionedPlaceCommand(placePatch), output: placeDetailsSchema,
});

export const patchPlacePersonRoute = defineRoute({
  method: "PATCH", path: "/places/:p/people/:person", auth: "context", command: true,
  input: versionedPlaceCommand(placePersonPatch).extend({ params: placeParams.extend({ person: accountIdSchema }) }),
  output: placeDetailsSchema,
});

export const verifyPlacePinRoute = defineRoute({
  method: "POST", path: "/places/:p/verify-pin", auth: "context", command: true,
  input: versionedPlaceCommand(z.strictObject({ pin: placePinSchema })), output: placeDetailsSchema,
});

export const invitePlacePersonRoute = defineRoute({
  method: "POST", path: "/places/:p/invite", auth: "context", command: true,
  input: versionedPlaceCommand(z.strictObject({ email: z.email() })), output: managedPlaceViewInvitationSchema,
});

// Owner/successor verification comes from independently verified server records, never a client assertion.
export const changePlaceApproverRoute = defineRoute({
  method: "POST", path: "/places/:p/change-approver", auth: "context", command: true,
  input: versionedPlaceCommand(successor), output: placeDetailsSchema,
});

// Initiating a verified successor's invitation does not change ownership; acceptance is separate.
export const transferPlaceRoute = defineRoute({
  method: "POST", path: "/places/:p/transfer", auth: "context", command: true,
  input: versionedPlaceCommand(successor), output: managedPlaceTransferInvitationSchema,
});

export const archivePlaceRoute = defineRoute({
  method: "POST", path: "/places/:p/archive", auth: "context", command: true,
  input: versionedPlaceCommand(z.strictObject({})),
  output: z.object({ id: placeIdSchema, revision: revisionSchema, state: z.literal("archived"), archivedAt: timestampSchema }),
});
