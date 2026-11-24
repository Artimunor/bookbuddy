import { expectedContextHeader, expectedSessionHeader, idSchema, noExpectedContext, sessionBootstrapSchema } from "@bookbuddy/api-contract";
import type { SessionBootstrap } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";
import { at } from "../access/policy";
import { sessionsBusinessEnabled, sessionsCustomerPlace, sessionsMarketEnabled } from "../sessions/policy";
import { requestSessionCredential, sessionCookieName } from "./credential";

export { isTrustedOrigin, sessionCookieName } from "./credential";
const encoder = new TextEncoder();

export async function hashSessionCredential(credential: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(credential));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const liveStaffGrant = `g.id = c.role_grant_id AND g.role = c.role AND g.revoked_at IS NULL
    AND m.account_id = c.account_id AND m.business_id = c.business_id
    AND m.state = 'active' AND b.state = 'approved'`;

// Only pick the account's current, live staff roles. Resource authority must
// still be checked by the calling statement; a context is not a grant.
export const liveContextAt = (time?: string) => `(c.role = 'customer' OR EXISTS (
  SELECT 1 FROM membership_roles g
  JOIN memberships m ON m.id = g.membership_id
  JOIN businesses b ON b.id = m.business_id
  WHERE ${liveStaffGrant}${time === undefined ? "" : ` AND g.granted_at <= ${time}`}
))`;
export const liveContextPredicate = liveContextAt();

const effectiveContext = `(SELECT c.id FROM account_contexts c
  WHERE c.id = s.active_context_id AND c.account_id = s.account_id AND ${liveContextAt("session_input.at")})`;
const validSession = `FROM (SELECT ? AS secret_hash, ? AS at) session_input
  JOIN sessions s ON s.secret_hash = session_input.secret_hash JOIN accounts a ON a.id = s.account_id
  WHERE s.revoked_at IS NULL AND s.expires_at > session_input.at AND a.state = 'active'`;
type CookieFence = { hash: string; now: number; sessionId: string; contextId: string | null };
const cookieFences = new WeakMap<Request, CookieFence | "missing">();

// The write is already fenced in its own statements. Resolve the reason only
// after an auth failure, without a second D1 call on ordinary writes.
export async function cookieSessionChanged(request: Request, db: D1Database): Promise<boolean> {
  const fence = cookieFences.get(request);
  if (!fence) return false;
  if (fence === "missing") return true;
  const row = await db.prepare(`SELECT s.id IS NOT ? OR ${effectiveContext} IS NOT ? AS changed ${validSession}`)
    .bind(fence.sessionId, fence.contextId, fence.hash, fence.now).first<{ changed: number }>();
  return row?.changed === 1;
}

export interface SessionAccess extends CommandStatement {
  readonly params: readonly unknown[];
  readonly afterContextSwitch?: CommandStatement;
}

// Builds a CTE prefix, not a database lookup. Append the caller's own live
// scope predicates to a statement and execute it in the caller's primary batch.
export async function resolveSession(
  request: Request, contextId: string | null, now: number, accountId?: string, scopeMode: "active" | "account" | "switch" = "active",
): Promise<SessionAccess | null> {
  const credential = requestSessionCredential(request);
  if (!credential) return null;
  const usesCookie = !request.headers.has("Authorization");
  const write = request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS";

  let fence: CookieFence | undefined;
  const expectedSession = request.headers.get(expectedSessionHeader);
  const expectedContext = request.headers.get(expectedContextHeader);
  const fenced = usesCookie && (write || expectedSession !== null || expectedContext !== null);
  if (fenced && (!idSchema.safeParse(expectedSession).success ||
    (expectedContext !== noExpectedContext && !idSchema.safeParse(expectedContext).success))) {
    cookieFences.set(request, "missing");
    return null;
  }
  const hash = await hashSessionCredential(credential);
  if (fenced) {
    fence = { hash, now, sessionId: expectedSession!, contextId: expectedContext === noExpectedContext ? null : expectedContext };
    cookieFences.set(request, fence);
  }

  const prefix = (check: string) => `WITH acting_session AS MATERIALIZED (
    SELECT s.id AS session_id, s.account_id, s.device_id, s.active_context_id AS context_id, s.expires_at, session_input.at
    ${validSession}${check}
  ), live_scope AS MATERIALIZED (
    SELECT s.session_id, c.account_id, c.id AS context_id, c.role, c.business_id
    FROM acting_session s JOIN account_contexts c ON c.account_id = s.account_id
      AND ${scopeMode === "account" ? "c.role = 'customer'" : "c.id = s.context_id"}
    WHERE (? IS NULL OR c.id = ?) AND ${liveContextAt("s.at")}${accountId === undefined ? "" : " AND c.account_id = ?"}
  )`;
  const scopeParams = [contextId, contextId, ...(accountId === undefined ? [] : [accountId])];
  return fence ? {
    sql: prefix(` AND s.id = ? AND ${effectiveContext} IS ?`),
    params: [hash, now, fence.sessionId, fence.contextId, ...scopeParams],
    ...(scopeMode === "switch" ? { afterContextSwitch: {
      sql: prefix(" AND s.id = ?"), params: [hash, now, fence.sessionId, ...scopeParams],
    } } : {}),
  } : { sql: prefix(""), params: [hash, now, ...scopeParams] };
}

const contextOrder = `ORDER BY c.role <> 'customer', c.role, c.business_id, c.id`;
export const defaultContextSql = (time: string) => `(SELECT c.id FROM account_contexts c
  WHERE c.account_id = a.id AND ${liveContextAt(time)} ${contextOrder} LIMIT 1)`;

const sessionsCapability = `CASE
  WHEN active.role = 'customer' THEN (
    SELECT CASE WHEN count(*) > 0 THEN json_object('areaIds', json_group_array(area_id)) END
    FROM (SELECT DISTINCT p.area_id FROM place_people pp JOIN places p ON p.id = pp.place_id
      WHERE ${sessionsCustomerPlace("p", "pp", "s.account_id")} AND ${sessionsMarketEnabled("p.area_id")}
      ORDER BY p.area_id)
  )
  WHEN active.granted_at <= ${at} AND ${sessionsBusinessEnabled("active.business_id")}
    THEN json_object('businessId', active.business_id)
END`;

export function sessionProjection(prefix: CommandStatement, now: number): CommandStatement {
  return {
    params: [...prefix.params ?? [], now],
    sql: `${prefix.sql}, clock AS (SELECT ? AS at), session_contexts AS MATERIALIZED (
      SELECT c.id, c.role, c.business_id, b.public_name, g.membership_id, g.granted_at
      FROM acting_session s JOIN account_contexts c ON c.account_id = s.account_id
      LEFT JOIN membership_roles g ON g.id = c.role_grant_id
      LEFT JOIN memberships m ON m.id = g.membership_id
      LEFT JOIN businesses b ON b.id = m.business_id
      WHERE c.role = 'customer' OR (${liveStaffGrant} AND g.granted_at <= ${at})
    )
      SELECT s.session_id, s.expires_at, s.context_id, a.id AS account_id, a.email_normalized,
             a.display_name, a.setup_at, p.ui_locale, p.reading_locale, p.display_zone,
             p.theme, p.field_mode, p.two_clock, p.revision,
             ${sessionsCapability} AS sessions_capability,
             (SELECT json_group_array(json(choice)) FROM (
               SELECT json_patch(json_object('contextId', c.id, 'role', c.role, 'businessId', c.business_id),
                                 json_object('businessName', c.public_name, 'membershipId', c.membership_id)) AS choice
               FROM session_contexts c ${contextOrder}
             )) AS contexts
      FROM acting_session s JOIN accounts a ON a.id = s.account_id
      JOIN account_preferences p ON p.account_id = a.id
      LEFT JOIN session_contexts active ON active.id = s.context_id`,
  };
}

interface SessionRow {
  session_id: string;
  expires_at: number;
  context_id: string | null;
  account_id: string;
  email_normalized: string;
  display_name: string | null;
  setup_at: number | null;
  ui_locale: string | null;
  reading_locale: string | null;
  display_zone: string | null;
  theme: string;
  field_mode: number | null;
  two_clock: number;
  revision: number;
  sessions_capability: string | null;
  contexts: string;
}

export function decodeSession(result?: D1Result): SessionBootstrap | null {
  const row = result?.results[0] as SessionRow | undefined;
  if (!row) return null;
  const contexts = JSON.parse(row.contexts) as { contextId: string }[];
  return sessionBootstrapSchema.parse({
    sessionId: row.session_id, expiresAt: row.expires_at,
    account: { id: row.account_id, email: row.email_normalized, displayName: row.display_name },
    setup: row.setup_at === null ? "required" : "complete",
    preferences: {
      uiLocale: row.ui_locale, readingLocale: row.reading_locale, displayZone: row.display_zone, theme: row.theme,
      fieldMode: row.field_mode === null ? null : row.field_mode === 1, twoClock: row.two_clock === 1, revision: row.revision,
    },
    activeContext: contexts.find(({ contextId }) => contextId === row.context_id) ?? null,
    contexts,
    capabilities: { sessions: row.sessions_capability === null ? null : JSON.parse(row.sessions_capability) },
  });
}

const cookieAttributes = "; Path=/; HttpOnly; Secure; SameSite=Lax";
export function sessionCookie(credential: string, expiresAt: number, now: number): string {
  return `${sessionCookieName}=${credential}; Max-Age=${Math.max(0, Math.floor((expiresAt - now) / 1000))}${cookieAttributes}`;
}
export const clearSessionCookie = `${sessionCookieName}=; Max-Age=0${cookieAttributes}`;
