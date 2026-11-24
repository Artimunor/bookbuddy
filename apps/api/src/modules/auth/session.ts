import { authTokenPattern, sessionBootstrapSchema } from "@bookbuddy/api-contract";
import type { SessionBootstrap } from "@bookbuddy/api-contract";
import { SESSIONS_FEATURE_FLAG } from "@bookbuddy/domain";
import type { CommandStatement } from "../../db/commit";
import { at } from "../access/policy";
import { currentPerson, placeViewer } from "../places/policy";

export const sessionCookieName = "__Host-bookbuddy_session";
const encoder = new TextEncoder();

export function isTrustedOrigin(request: Request): boolean {
  const { origin } = new URL(request.url);
  return request.headers.get("Origin") === origin;
}

export async function hashSessionCredential(credential: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(credential));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const liveStaffGrant = `g.id = c.role_grant_id AND g.role = c.role AND g.revoked_at IS NULL
    AND m.account_id = c.account_id AND m.business_id = c.business_id
    AND m.state = 'active' AND b.state = 'approved'`;

// Only pick the account's current, live staff roles. Resource authority must
// still be checked by the calling statement; a context is not a grant.
export const liveContextPredicate = `(c.role = 'customer' OR EXISTS (
  SELECT 1 FROM membership_roles g
  JOIN memberships m ON m.id = g.membership_id
  JOIN businesses b ON b.id = m.business_id
  WHERE ${liveStaffGrant}
))`;

export interface SessionAccess extends CommandStatement {
  readonly params: readonly unknown[];
}

// Builds a CTE prefix, not a database lookup. Append the caller's own live
// scope predicates to a statement and execute it in the caller's primary batch.
export async function resolveSession(
  request: Request, contextId: string | null, now: number, accountId?: string, scopeMode: "active" | "account" = "active",
): Promise<SessionAccess | null> {
  const authorization = request.headers.get("Authorization");
  const requiresOrigin = !["GET", "HEAD", "OPTIONS"].includes(request.method)
    || request.headers.get("Upgrade")?.toLowerCase() === "websocket";
  if (requiresOrigin && (authorization === null || request.headers.has("Origin")) && !isTrustedOrigin(request)) return null;

  let credential: string | undefined;
  if (authorization !== null) {
    credential = /^Bearer ([^ ]+)$/i.exec(authorization)?.[1];
  } else {
    for (const part of request.headers.get("Cookie")?.split(";") ?? []) {
      const cookie = part.trim();
      if (!cookie.startsWith(`${sessionCookieName}=`)) continue;
      if (credential !== undefined) return null;
      credential = cookie.slice(sessionCookieName.length + 1);
    }
  }
  if (!credential || !authTokenPattern.test(credential)) return null;

  return {
    sql: `WITH acting_session AS MATERIALIZED (
      SELECT s.id AS session_id, s.account_id, s.device_id, s.active_context_id AS context_id, s.expires_at
      FROM sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.secret_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND a.state = 'active'
    ), live_scope AS MATERIALIZED (
      SELECT s.session_id, c.account_id, c.id AS context_id, c.role, c.business_id
      FROM acting_session s JOIN account_contexts c ON c.account_id = s.account_id
        AND ${scopeMode === "account" ? "c.role = 'customer'" : "c.id = s.context_id"}
      WHERE (? IS NULL OR c.id = ?) AND ${liveContextPredicate}${accountId === undefined ? "" : " AND c.account_id = ?"}
    )`,
    params: [await hashSessionCredential(credential), now, contextId, contextId, ...(accountId === undefined ? [] : [accountId])],
  };
}

const contextOrder = `ORDER BY c.role <> 'customer', c.role, c.business_id, c.id`;
export const defaultContextSql = `(SELECT c.id FROM account_contexts c
  WHERE c.account_id = a.id AND ${liveContextPredicate} ${contextOrder} LIMIT 1)`;

const sessionsCapability = `CASE
  WHEN active.role = 'customer' THEN (
    SELECT CASE WHEN count(*) > 0 THEN json_object('areaIds', json_group_array(area_id)) END
    FROM (SELECT DISTINCT p.area_id FROM place_people pp JOIN places p ON p.id = pp.place_id
      WHERE pp.account_id = s.account_id AND p.state = 'in_area'
        AND ${currentPerson("pp")} AND ${placeViewer("p", "pp.account_id")}
        AND EXISTS (SELECT 1 FROM feature_flags f WHERE f.key = '${SESSIONS_FEATURE_FLAG}' AND f.enabled = 1
          AND f.scope_key > p.area_id || ':' AND f.scope_key < p.area_id || ';')
      ORDER BY p.area_id)
  )
  WHEN active.granted_at <= ${at} AND EXISTS (
    SELECT 1 FROM feature_flags f WHERE f.key = '${SESSIONS_FEATURE_FLAG}' AND f.enabled = 1 AND f.scope_key = active.business_id
  ) THEN json_object('businessId', active.business_id)
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
      WHERE c.role = 'customer' OR (${liveStaffGrant})
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
