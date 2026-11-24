import { z } from "zod";
import {
  businessEligibilitySchema, businessMemberSchema, businessOverviewSchema, contextChoiceSchema,
  invitationOpeningSchema, invitationUnavailableSchema,
} from "./access";
import { billProjectionSchema, completionProjectionSchema, problemCaseProjectionSchema } from "./aftercare";
import { chatAudienceSchema, chatThreadIdSchema } from "./chat";
import { contextIdSchema, idSchemaFor } from "./common";
import { jobDetailSchema } from "./jobs";
import { placeDetailsSchema } from "./places";
import { defineRoute } from "./route";
import { crewAvailabilitySchema, shiftDetailSchema } from "./schedule";
import { customerSessionBookingSchema } from "./sessions";
import { coverViewSchema, workerAssignmentOfferSchema } from "./staffing";

export const opaqueLinkRoute = "/l/:token";
export const linkTokenSchema = idSchemaFor<"link_token">();
export type LinkToken = z.infer<typeof linkTokenSchema>;

const httpsUrlSchema = z.url({ protocol: /^https$/, normalize: true });
const httpsOriginSchema = z.string().regex(/^https:\/\/(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]+)?$/)
  .refine((origin) => {
    const url = httpsUrlSchema.safeParse(origin);
    return url.success && url.data === `${origin}/`;
  });

export const opaqueLinkPathSchema = z.string().regex(/^\/l\/[A-Za-z0-9_-]{1,256}$/)
  .transform((path) => path as `/l/${string}`);
export type OpaqueLinkPath = z.infer<typeof opaqueLinkPathSchema>;

export const opaqueLinkUrlSchema = z.string().refine((href) => {
  const pathIndex = href.indexOf("/", "https://".length);
  return pathIndex !== -1 && httpsOriginSchema.safeParse(href.slice(0, pathIndex)).success
    && opaqueLinkPathSchema.safeParse(href.slice(pathIndex)).success;
}).transform((href) => href as `https://${string}${OpaqueLinkPath}`);
export type OpaqueLinkUrl = z.infer<typeof opaqueLinkUrlSchema>;

export function createOpaqueLink(origin: string, token: string): OpaqueLinkUrl {
  return `${httpsOriginSchema.parse(origin)}/l/${linkTokenSchema.parse(token)}` as OpaqueLinkUrl;
}

// Incoming HTTPS destinations must match the app's configured origin, not just the public shape.
export function parseOpaqueLink(origin: string, href: string): LinkToken | null {
  const prefix = `${httpsOriginSchema.parse(origin)}/l/`;
  if (!href.startsWith(prefix)) return null;
  const token = linkTokenSchema.safeParse(href.slice(prefix.length));
  return token.success ? token.data : null;
}

export const linkOpeningSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("invitation"), invitation: invitationOpeningSchema }),
  z.object({ kind: z.literal("place"), place: placeDetailsSchema }),
  z.object({ kind: z.literal("business_overview"), business: businessOverviewSchema }),
  z.object({ kind: z.literal("business_member"), business: businessOverviewSchema.shape.business, member: businessMemberSchema }),
  z.object({ kind: z.literal("business_eligibility"), eligibility: businessEligibilitySchema }),
  z.object({ kind: z.literal("job"), record: jobDetailSchema }),
  z.object({ kind: z.literal("shift"), shift: shiftDetailSchema }),
  z.object({ kind: z.literal("thread"), threadId: chatThreadIdSchema, audience: chatAudienceSchema }),
  z.object({ kind: z.literal("completion"), completion: completionProjectionSchema }),
  z.object({ kind: z.literal("bill"), bill: billProjectionSchema }),
  z.object({ kind: z.literal("problem_case"), case: problemCaseProjectionSchema }),
  z.object({ kind: z.literal("cover"), cover: coverViewSchema }),
  z.object({ kind: z.literal("assignment_offer"), offer: workerAssignmentOfferSchema }),
  z.object({ kind: z.literal("crew_availability"), date: z.iso.date(), availability: crewAvailabilitySchema }),
  z.object({ kind: z.literal("session_booking"), booking: customerSessionBookingSchema }),
  z.strictObject({
    kind: z.literal("switch_context"),
    targetKind: z.enum(["place", "business", "invitation", "job", "shift", "offer", "conversation", "update", "completion", "bill", "problem_case", "session_booking"]),
    activeContextId: contextIdSchema.nullable(),
    choices: z.array(contextChoiceSchema).min(1),
  }),
  invitationUnavailableSchema.extend({
    kind: z.literal("unavailable"),
    reason: z.enum([...invitationUnavailableSchema.shape.reason.options, "pending"]),
  }),
]);
export type LinkOpening = z.infer<typeof linkOpeningSchema>;

// The worker checks recipient, scope and the opening projection in one read.
export const openLinkRoute = defineRoute({
  method: "GET", path: "/links/:opaque", auth: "session",
  input: z.object({ params: z.object({ opaque: linkTokenSchema }) }), output: linkOpeningSchema,
});
