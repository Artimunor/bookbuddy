import { activeContextSchema, contextRoleSchema, sessionBootstrapSchema } from "@bookbuddy/api-contract";
import type { ActiveContext, SessionBootstrap } from "@bookbuddy/api-contract";

export const offlineWindow = 72 * 60 * 60 * 1000;
export const contextSummarySchema = activeContextSchema.options[1].pick({ contextId: true, businessName: true })
  .extend({ role: contextRoleSchema });
export const offlineBootstrapSchema = sessionBootstrapSchema.pick({ sessionId: true }).extend({
  authorizedAt: sessionBootstrapSchema.shape.expiresAt,
  account: sessionBootstrapSchema.shape.account.pick({ displayName: true }),
  activeContext: contextSummarySchema,
  preferences: sessionBootstrapSchema.shape.preferences.omit({ revision: true }),
});
export interface OfflineBootstrap {
  sessionId: SessionBootstrap["sessionId"];
  authorizedAt: number;
  account: Pick<SessionBootstrap["account"], "displayName">;
  activeContext: Pick<SessionContextSummary, "contextId" | "role" | "businessName">;
  preferences: Omit<SessionBootstrap["preferences"], "revision">;
}
export type SessionContextSummary = Omit<ActiveContext, "businessId" | "membershipId"> & {
  businessId?: ActiveContext["businessId"];
  membershipId?: ActiveContext["membershipId"];
};

export function projectOfflineBootstrap(bootstrap: SessionBootstrap, authorizedAt: number): OfflineBootstrap | null {
  const { sessionId, account, activeContext, preferences } = bootstrap;
  if (!activeContext) return null;
  const { contextId, role, businessName } = activeContext;
  const { uiLocale, readingLocale, displayZone, theme, fieldMode, twoClock } = preferences;
  // Construct the allowlist instead of persisting or casting a server bootstrap.
  return { sessionId, authorizedAt, account: { displayName: account.displayName },
    activeContext: { contextId, role, ...(businessName === undefined ? {} : { businessName }) },
    preferences: { uiLocale, readingLocale, displayZone, theme, fieldMode, twoClock } };
}

export function offlineBootstrapIsFresh({ authorizedAt }: OfflineBootstrap, now: number): boolean {
  return now >= authorizedAt && now - authorizedAt < offlineWindow;
}
