import { authTokenPattern, sessionBootstrapSchema } from "@bookbuddy/api-contract";
import type { SessionBootstrap } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";

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

// Only pick the account's current, live staff roles. Resource authority must
// still be checked by the calling statement; a context is not a grant.
export const liveContextPredicate = `(c.role = 'customer' OR EXISTS (
  SELECT 1 FROM membership_roles g
  JOIN memberships m ON m.id = g.membership_id
  JOIN businesses b ON b.id = m.business_id
  WHERE g.id = c.role_grant_id AND g.role = c.role AND g.revoked_at IS NULL
    AND m.account_id = c.account_id AND m.business_id = c.business_id
    AND m.state = 'active' AND b.state = 'approved'
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
      SELECT s.id AS session_id, s.account_id, s.active_context_id AS context_id, s.expires_at
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

export function sessionProjection(prefix: CommandStatement): CommandStatement {
  return {
    params: prefix.params,
    sql: `${prefix.sql}
      SELECT s.session_id, s.expires_at, s.context_id, a.id AS account_id, a.email_normalized,
             a.display_name, a.setup_at, p.ui_locale, p.reading_locale, p.theme, p.field_mode, p.two_clock, p.revision,
             (SELECT json_group_array(json(choice)) FROM (
               SELECT json_object('contextId', c.id, 'role', c.role, 'businessId', c.business_id) AS choice
               FROM account_contexts c WHERE c.account_id = a.id AND ${liveContextPredicate} ${contextOrder}
             )) AS contexts
      FROM acting_session s JOIN accounts a ON a.id = s.account_id
      JOIN account_preferences p ON p.account_id = a.id`,
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
  theme: string;
  field_mode: number | null;
  two_clock: number;
  revision: number;
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
      uiLocale: row.ui_locale, readingLocale: row.reading_locale, theme: row.theme,
      fieldMode: row.field_mode === null ? null : row.field_mode === 1, twoClock: row.two_clock === 1, revision: row.revision,
    },
    activeContext: contexts.find(({ contextId }) => contextId === row.context_id) ?? null,
    contexts,
  });
}

const cookieAttributes = "; Path=/; HttpOnly; Secure; SameSite=Lax";
export function sessionCookie(credential: string, expiresAt: number, now: number): string {
  return `${sessionCookieName}=${credential}; Max-Age=${Math.max(0, Math.floor((expiresAt - now) / 1000))}${cookieAttributes}`;
}
export const clearSessionCookie = `${sessionCookieName}=; Max-Age=0${cookieAttributes}`;
