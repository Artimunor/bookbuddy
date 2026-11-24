import { THEMES } from "@bookbuddy/domain";
import { z } from "zod";
import {
  accountIdSchema, activeContextSchema, businessIdSchema, commandInputSchema, contextIdSchema, idSchema,
  localePreferencesSchema, localeTagSchema, revisionSchema, timestampSchema,
} from "./common";
import { defineRoute } from "./route";

// A canonical, unpadded base64url encoding of 256 bits.
export const authTokenPattern = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const authToken = z.string().regex(authTokenPattern);
const email = z.string().trim().max(254).transform((value) => value.toLowerCase()).pipe(z.email());
const transport = z.enum(["web", "native"]);
const device = z.object({ email, deviceId: idSchema, transport });
const attemptParams = z.object({ attempt: authToken });
const generation = revisionSchema.min(1);
const triesLeft = z.int().min(0).max(5);

export const emailAttemptSchema = z.object({
  attemptId: authToken,
  generation,
  state: z.enum(["pending", "expired", "invalidated", "consumed", "locked"]),
  delivery: z.enum(["requested", "accepted", "failed", "unknown"]),
  expiresAt: timestampSchema,
  resendAt: timestampSchema,
  retryAt: timestampSchema.nullable(),
  triesLeft,
});

export const accountSettingsSchema = localePreferencesSchema.extend({
  theme: z.enum(THEMES),
  fieldMode: z.boolean().nullable(),
  twoClock: z.boolean(),
  revision: revisionSchema,
});

const sessionsCapabilitySchema = z.union([
  z.strictObject({ areaIds: z.array(idSchema).min(1) }),
  z.strictObject({ businessId: businessIdSchema }),
]);

export const sessionBootstrapSchema = z.object({
  sessionId: idSchema,
  expiresAt: timestampSchema,
  account: z.object({ id: accountIdSchema, email, displayName: z.string().nullable() }),
  setup: z.enum(["required", "complete"]),
  preferences: accountSettingsSchema,
  activeContext: activeContextSchema.nullable(),
  contexts: z.array(activeContextSchema),
  // Optional for previously cached bootstraps; current responses always include it.
  capabilities: z.object({ sessions: sessionsCapabilitySchema.nullable() }).optional(),
});

export const accountSettingsPatchSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(100).optional(),
  uiLocale: localeTagSchema.optional(),
  readingLocale: localeTagSchema.nullable().optional(),
  displayZone: localePreferencesSchema.shape.displayZone.refine((zone) => {
    if (zone == null) return true;
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }),
  theme: z.enum(THEMES).optional(),
  fieldMode: z.boolean().nullable().optional(),
  twoClock: z.boolean().optional(),
}).refine((patch) => Object.values(patch).some((value) => value !== undefined));

export const emailStartRoute = defineRoute({
  method: "POST", path: "/auth/email/start", auth: "public",
  // Supplying a securely preallocated attempt lets the caller check a lost start response.
  input: z.object({ body: device.extend({ attemptId: authToken.optional() }) }),
  output: emailAttemptSchema,
});

export const emailResendRoute = defineRoute({
  method: "POST", path: "/auth/email/:attempt/resend", auth: "challenge", command: true,
  input: z.object({ params: attemptParams, body: commandInputSchema(device).extend({ expectedRevision: generation }) }),
  output: emailAttemptSchema,
});

export const emailVerifyRoute = defineRoute({
  method: "POST", path: "/auth/email/:attempt/verify", auth: "challenge", command: true,
  input: z.object({
    params: attemptParams,
    body: commandInputSchema(device.extend({ code: z.string().regex(/^\d{6}$/) })),
  }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("verified"), session: sessionBootstrapSchema, credential: authToken.optional() }),
    z.object({ status: z.literal("wrong_code"), triesLeft }),
    z.object({ status: z.literal("expired") }),
  ]),
});

export const emailStatusRoute = defineRoute({
  method: "GET", path: "/auth/email/:attempt/status", auth: "challenge",
  input: z.object({ params: attemptParams }), output: emailAttemptSchema,
});

export const sessionContextRoute = defineRoute({
  method: "POST", path: "/session/context", auth: "session", command: true,
  input: z.object({ body: commandInputSchema(z.object({ contextId: contextIdSchema })) }),
  output: sessionBootstrapSchema,
});

export const sessionEndRoute = defineRoute({
  method: "POST", path: "/session/end", auth: "session",
  input: z.object({}), output: z.object({ ended: z.literal(true) }),
});

export const sessionRoute = defineRoute({
  method: "GET", path: "/session", auth: "session", input: z.object({}), output: sessionBootstrapSchema,
});

export const accountSettingsRoute = defineRoute({
  method: "PATCH", path: "/account/settings", auth: "session", command: true,
  input: z.object({ body: commandInputSchema(accountSettingsPatchSchema).extend({ expectedRevision: revisionSchema }) }),
  output: sessionBootstrapSchema,
});

export type EmailAttempt = z.output<typeof emailAttemptSchema>;
export type AccountSettingsPatch = z.output<typeof accountSettingsPatchSchema>;
export type SessionBootstrap = z.output<typeof sessionBootstrapSchema>;
