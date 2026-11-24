import { accountIdSchema, authTokenPattern, contextIdSchema, idSchema, sessionBootstrapSchema, sessionRevokeRoute, sessionRevocationProofSchema } from "@bookbuddy/api-contract";
import type { SessionBootstrap } from "@bookbuddy/api-contract";
import { contextSummarySchema } from "./offline-bootstrap";
import type { SessionContextSummary } from "./offline-bootstrap";

const sessionHeader = sessionBootstrapSchema.pick({ sessionId: true, expiresAt: true, setup: true }).extend({
  accountId: accountIdSchema, activeContext: contextSummarySchema.nullable(),
});

export interface DeviceSession extends Pick<SessionBootstrap, "sessionId" | "expiresAt" | "setup"> {
  accountId: SessionBootstrap["account"]["id"];
  activeContext: SessionContextSummary | null;
}
export interface ActiveSession {
  state: "active";
  requiresUnlock: boolean;
  credential: string | null;
  proof: string | null;
  session: DeviceSession;
}
export type Disposition = "keep" | "discard";
export type Revocation = { mode: "native"; sessionId: string; proof: string }
  | { mode: "cookie"; sessionId: string; contextId: string | null };
export interface EndingSession {
  state: "ending";
  accountId: DeviceSession["accountId"];
  disposition: Disposition;
  persistent: boolean;
  localPending: boolean;
  revocation: Revocation | null;
}
export interface SignOutProgress { intent: EndingSession; persisted: boolean }

export function parseStoredSession(raw: string, cookieSession: boolean): ActiveSession | EndingSession {
  const value: unknown = JSON.parse(raw);
  if (value && typeof value === "object" && "state" in value) {
    if (value.state === "active" && "requiresUnlock" in value && typeof value.requiresUnlock === "boolean"
      && "credential" in value && "proof" in value && "session" in value) {
      const { credential, proof } = value;
      if (cookieSession ? credential === null && proof === null
        : typeof credential === "string" && authTokenPattern.test(credential) && sessionRevocationProofSchema.safeParse(proof).success) {
        return { state: "active", requiresUnlock: value.requiresUnlock, credential: credential as string | null,
          proof: proof as string | null, session: sessionHeader.parse(value.session) };
      }
    }
    if (value.state === "ending" && "accountId" in value && "disposition" in value && "persistent" in value
        && "localPending" in value && "revocation" in value && typeof value.persistent === "boolean"
        && typeof value.localPending === "boolean" && (value.disposition === "keep" || value.disposition === "discard")) {
      const revocation = value.revocation;
      const local: Omit<EndingSession, "revocation"> = { state: "ending", accountId: accountIdSchema.parse(value.accountId), disposition: value.disposition,
        persistent: value.persistent, localPending: value.localPending };
      if (revocation === null) return { ...local, revocation: null };
      if (revocation && typeof revocation === "object" && "mode" in revocation && "sessionId" in revocation) {
        if (!cookieSession && revocation.mode === "native" && "proof" in revocation) {
          const body = sessionRevokeRoute.input.shape.body.parse({ sessionId: revocation.sessionId, proof: revocation.proof });
          return { ...local, revocation: { mode: "native", ...body } };
        }
        if (cookieSession && revocation.mode === "cookie" && "contextId" in revocation) {
          return { ...local, revocation: { mode: "cookie", sessionId: idSchema.parse(revocation.sessionId),
            contextId: contextIdSchema.nullable().parse(revocation.contextId) } };
        }
      }
    }
  }
  throw new Error("Invalid saved session");
}

export function beginSignOut(record: ActiveSession, disposition: Disposition, persistent: boolean): SignOutProgress {
  const { sessionId, accountId, activeContext } = record.session;
  const revocation: Revocation = record.proof ? { mode: "native", sessionId, proof: record.proof }
    : { mode: "cookie", sessionId, contextId: activeContext?.contextId ?? null };
  return { intent: { state: "ending", accountId, localPending: true, disposition, persistent, revocation }, persisted: false };
}

interface Settlement {
  save: (intent: EndingSession) => Promise<void>;
  remove: () => Promise<void>;
  finalizeLocal: (intent: EndingSession) => Promise<void>;
  revoke?: (intent: Revocation) => Promise<boolean>;
}

/** The durable marker replaces the bearer before either kind of cleanup is attempted. */
export async function settleSignOut(progress: SignOutProgress, { save, remove, finalizeLocal, revoke }: Settlement): Promise<boolean> {
  const persist = async (intent: EndingSession) => { await save(intent); progress.intent = intent; progress.persisted = true; };
  if (!progress.persisted) await persist(progress.intent);
  let localFailed = false;
  if (progress.intent.localPending) {
    try {
      await finalizeLocal(progress.intent);
      await persist({ ...progress.intent, localPending: false });
    } catch { localFailed = true; }
  }
  const revocation = progress.intent.revocation;
  if (revocation && revoke && await revoke(revocation)) await persist({ ...progress.intent, revocation: null });
  if (localFailed) throw new Error("Local sign-out cleanup could not be completed");
  if (progress.intent.revocation) return false;
  await remove();
  return true;
}
