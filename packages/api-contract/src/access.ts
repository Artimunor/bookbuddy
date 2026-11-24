import { BUSINESS_STATES, CURRENCIES, ELIGIBILITY_DISPLAY_STATES, MEMBERSHIP_ROLES, VISIT_STEPS } from "@bookbuddy/domain";
import { z } from "zod";
import {
  activeContextSchema, businessIdSchema, commandInputSchema, contextIdSchema, cursorSchema, idSchemaFor,
  localeTagSchema, paginationSchema, timestampSchema,
} from "./common";
import { linkTokenSchema } from "./links";
import {
  invitationIdSchema, invitationManagementSchema, managedPlaceTransferInvitationSchema,
  managedPlaceViewInvitationSchema, placeCapabilitySchema, placeDetailsSchema, placeIdSchema,
} from "./places";
import { defineRoute } from "./route";

export const membershipIdSchema = idSchemaFor<"membership">();
export const roleGrantIdSchema = idSchemaFor<"membership_role">();
const supportReference = idSchemaFor<"support_case">();
const businessParams = z.object({ b: businessIdSchema });
const invitationParams = z.object({ id: invitationIdSchema });
const membershipRole = z.enum(MEMBERSHIP_ROLES);
const invitationalRole = membershipRole.exclude(["provider_admin"]);
const eligibilityStatus = z.enum(ELIGIBILITY_DISPLAY_STATES);
const displayName = z.string().min(1);
const siteZone = z.string().min(1);
const count = z.int().nonnegative();

const businessHeader = z.object({
  id: businessIdSchema,
  publicName: displayName,
  state: z.enum(BUSINESS_STATES),
  areaName: displayName,
  siteZone,
});

const businessJob = z.object({
  jobId: idSchemaFor<"job">(),
  reference: z.string().regex(/^BB-[A-Z0-9]+$/),
  title: z.string().min(1),
  siteZone,
});

// P-01 carries only permitted aggregate outcomes and one live visit, never individual attendance.
export const businessOverviewSchema = z.object({
  business: businessHeader,
  liveJob: businessJob.extend({
    step: z.enum(VISIT_STEPS),
    since: timestampSchema,
    accountableForeman: displayName.nullable(),
    sharedBy: displayName.nullable(),
    crewSize: count,
  }).nullable(),
  nextVisit: businessJob.extend({ startsAt: timestampSchema, endsAt: timestampSchema }).nullable(),
  handoffs: z.object({
    offeredCount: count,
    nextReplyAt: timestampSchema.nullable(),
    stuck: z.array(businessJob.extend({
      since: timestampSchema,
      offeredTo: displayName,
      accountableForeman: displayName.nullable(),
    })),
  }),
  unassignedCount: count,
  commercialReviewCount: count,
  bills: z.object({ openCount: count, totalMinor: count, currency: z.enum(CURRENCIES) }),
  eligibility: z.object({ status: eligibilityStatus, pendingReviewCount: count }),
});

const managedBusinessInvitation = invitationManagementSchema.extend({
  kind: z.literal("business_role"),
  businessId: businessIdSchema,
  role: invitationalRole,
});

export const managedInvitationSchema = z.discriminatedUnion("kind", [
  managedBusinessInvitation, managedPlaceViewInvitationSchema, managedPlaceTransferInvitationSchema,
]);

const currentRole = z.object({
  grantId: roleGrantIdSchema,
  role: membershipRole,
  grantedAt: timestampSchema,
  removal: z.discriminatedUnion("status", [
    z.object({ status: z.literal("allowed") }),
    z.object({ status: z.literal("unavailable") }),
    z.object({ status: z.literal("last_admin") }),
    z.object({ status: z.literal("accountable_foreman"), affectedJobCount: z.int().positive() }),
  ]),
});

export const businessMemberSchema = z.object({
  id: membershipIdSchema,
  displayName,
  email: z.email().nullable(),
  isViewer: z.boolean(),
  roles: z.array(currentRole),
  eligibility: eligibilityStatus.nullable(),
});

const pastRole = z.object({
  memberId: membershipIdSchema,
  displayName,
  grantId: roleGrantIdSchema,
  role: membershipRole,
  revokedAt: timestampSchema,
  revokedBy: displayName,
});

const peopleView = z.enum(["active", "invited", "past"]);
const providerPeople = paginationSchema.extend({
  audience: z.literal("provider_admin"),
  business: businessHeader,
  counts: z.object({ active: count, invited: count, past: count }),
  canInvite: z.boolean(),
});

const foremanCrewMember = z.object({
  id: membershipIdSchema,
  displayName,
  roles: z.array(membershipRole),
  eligibility: eligibilityStatus,
  skills: z.array(z.string().min(1)),
  workLanguages: z.array(localeTagSchema),
});

export const businessPeopleSchema = z.discriminatedUnion("audience", [
  z.discriminatedUnion("view", [
    providerPeople.extend({ view: z.literal("active"), members: z.array(businessMemberSchema) }),
    providerPeople.extend({ view: z.literal("invited"), invitations: z.array(managedBusinessInvitation) }),
    providerPeople.extend({ view: z.literal("past"), roles: z.array(pastRole) }),
  ]),
  paginationSchema.extend({
    audience: z.literal("foreman"),
    businessId: businessIdSchema,
    members: z.array(foremanCrewMember),
  }),
]);

const crewEligibility = z.object({
  memberId: membershipIdSchema,
  displayName,
  status: eligibilityStatus,
  checkedAt: timestampSchema.nullable(),
  validUntil: timestampSchema.nullable(),
  reviewBy: timestampSchema.nullable(),
  effectiveCutoffAt: timestampSchema.nullable(),
});

// Foremen receive scoped task/crew facts only, not the admin directory or verification evidence.
export const businessEligibilitySchema = z.discriminatedUnion("audience", [
  paginationSchema.extend({
    audience: z.literal("provider_admin"),
    business: businessHeader,
    approvedScopes: z.array(z.object({ trade: z.string().min(1), scope: z.string().min(1) })),
    coverPolicy: z.literal("own_crew"),
    members: z.array(crewEligibility),
    supportReference: supportReference.nullable(),
  }),
  paginationSchema.extend({
    audience: z.literal("foreman"),
    businessId: businessIdSchema,
    siteZone,
    members: z.array(crewEligibility.extend({ trade: z.string().min(1), workLanguage: localeTagSchema })),
  }),
]);

const contextChoice = z.object({ scope: activeContextSchema, businessName: displayName.nullable() });
const invitationGrant = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("business_role"), businessName: displayName, role: invitationalRole }),
  z.object({ kind: z.literal("place_view"), placeAlias: displayName, capabilities: z.tuple([z.literal("view")]) }),
  z.object({ kind: z.literal("place_transfer"), placeAlias: displayName }),
]);

const invitePending = z.object({
  status: z.literal("pending"),
  id: invitationIdSchema,
  grant: invitationGrant,
  inviterDisplayName: displayName,
  issuedAt: timestampSchema,
  expiresAt: timestampSchema,
  siteZone: siteZone.nullable(),
  setupRequired: z.boolean(),
});

const inviteAccepted = z.object({
  status: z.literal("accepted"),
  id: invitationIdSchema,
  acceptedAt: timestampSchema,
  currentAccess: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("business"),
      context: contextChoice,
      workEligibility: eligibilityStatus,
      supportReference: supportReference.nullable(),
    }),
    z.object({
      kind: z.literal("place"),
      placeId: placeIdSchema,
      placeAlias: displayName,
      isOwner: z.boolean(),
      capabilities: z.array(placeCapabilitySchema),
      historyFrom: timestampSchema,
    }),
  ]),
});

const unavailable = z.strictObject({
  status: z.literal("unavailable"),
  reason: z.enum(["unavailable", "expired", "removed", "wrong_account"]),
  supportReference: supportReference.nullable(),
});

// Only a verified intended recipient sees invitation details. Acceptance is a view of live access.
export const invitationOpeningSchema = z.discriminatedUnion("status", [invitePending, inviteAccepted, unavailable]);

export const linkOpeningSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("invitation"), invitation: invitationOpeningSchema }),
  z.object({ kind: z.literal("place"), place: placeDetailsSchema }),
  z.object({ kind: z.literal("business_overview"), business: businessOverviewSchema }),
  z.object({ kind: z.literal("business_member"), business: businessHeader, member: businessMemberSchema }),
  z.object({ kind: z.literal("business_eligibility"), eligibility: businessEligibilitySchema }),
  z.strictObject({
    kind: z.literal("switch_context"),
    targetKind: z.enum(["place", "business", "invitation", "job", "shift", "offer", "conversation", "update"]),
    activeContextId: contextIdSchema.nullable(),
    choices: z.array(contextChoice).min(1),
  }),
  unavailable.extend({ kind: z.literal("unavailable") }),
]);

export type BusinessOverview = z.infer<typeof businessOverviewSchema>;
export type BusinessPeople = z.infer<typeof businessPeopleSchema>;
export type BusinessEligibility = z.infer<typeof businessEligibilitySchema>;
export type ManagedInvitation = z.infer<typeof managedInvitationSchema>;
export type InvitationOpening = z.infer<typeof invitationOpeningSchema>;
export type LinkOpening = z.infer<typeof linkOpeningSchema>;

const invitationCommand = z.object({ params: invitationParams, body: commandInputSchema(z.strictObject({})) });

// Auth scopes describe credential transport; the worker checks current authority in the same D1 call.
export const openLinkRoute = defineRoute({
  method: "GET", path: "/links/:opaque", auth: "session",
  input: z.object({ params: z.object({ opaque: linkTokenSchema }) }), output: linkOpeningSchema,
});

export const getBusinessOverviewRoute = defineRoute({
  method: "GET", path: "/businesses/:b/overview", auth: "context",
  input: z.object({ params: businessParams }), output: businessOverviewSchema,
});

export const getBusinessPeopleRoute = defineRoute({
  method: "GET", path: "/businesses/:b/people", auth: "context",
  input: z.object({ params: businessParams, query: z.object({ view: peopleView.optional(), cursor: cursorSchema.optional() }).optional() }),
  output: businessPeopleSchema,
});

export const getBusinessEligibilityRoute = defineRoute({
  method: "GET", path: "/businesses/:b/eligibility", auth: "context",
  input: z.object({ params: businessParams, query: z.object({ cursor: cursorSchema.optional() }).optional() }),
  output: businessEligibilitySchema,
});

export const inviteBusinessMemberRoute = defineRoute({
  method: "POST", path: "/businesses/:b/invitations", auth: "context", command: true,
  input: z.object({ params: businessParams, body: commandInputSchema(z.strictObject({ email: z.email(), role: invitationalRole })) }),
  output: managedBusinessInvitation,
});

export const revokeBusinessMemberRoute = defineRoute({
  method: "POST", path: "/members/:member/revoke", auth: "context", command: true,
  input: z.object({
    params: z.object({ member: membershipIdSchema }),
    body: commandInputSchema(z.strictObject({ roleGrantId: roleGrantIdSchema })),
  }),
  output: z.object({ revoked: pastRole, member: businessMemberSchema.nullable() }),
});

export const getInvitationRoute = defineRoute({
  method: "GET", path: "/invitations/:id", auth: "session",
  input: z.object({ params: invitationParams }), output: invitationOpeningSchema,
});

export const reissueInvitationRoute = defineRoute({
  method: "POST", path: "/invitations/:id/reissue", auth: "context", command: true,
  input: invitationCommand, output: managedInvitationSchema,
});

export const withdrawInvitationRoute = defineRoute({
  method: "POST", path: "/invitations/:id/withdraw", auth: "context", command: true,
  input: invitationCommand,
  output: z.object({ id: invitationIdSchema, state: z.literal("withdrawn"), withdrawnAt: timestampSchema }),
});

export const acceptInvitationRoute = defineRoute({
  method: "POST", path: "/invitations/:id/accept", auth: "session", command: true,
  input: invitationCommand, output: inviteAccepted,
});

export const declineInvitationRoute = defineRoute({
  method: "POST", path: "/invitations/:id/decline", auth: "session", command: true,
  input: invitationCommand,
  output: z.object({ id: invitationIdSchema, state: z.literal("declined"), declinedAt: timestampSchema }),
});

// Anonymous intake is separately throttled and accepts only a typed message and opaque reference.
export const submitSupportRoute = defineRoute({
  method: "POST", path: "/support", auth: "optional-session", command: true,
  input: z.object({ body: commandInputSchema(z.strictObject({
    kind: z.enum(["sign_in", "access", "eligibility", "property", "other"]),
    reference: supportReference.optional(),
    replyEmail: z.email().optional(),
    message: z.string().trim().min(1).max(2000),
  })) }),
  output: z.object({ reference: supportReference, receivedAt: timestampSchema }),
});
