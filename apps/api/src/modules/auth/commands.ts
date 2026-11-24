import type { AccountSettingsPatch, ErrorBody, SessionBootstrap } from "@bookbuddy/api-contract";
import { commitCommand, prepareCommand } from "../../db/commit";
import type { CommandStatement } from "../../db/commit";
import type { RequestScope } from "../../db/scope";
import { decodeSession, hashSessionCredential, liveContextAt, sessionProjection } from "./session";
import type { SessionAccess } from "./session";

type SessionCommand = { session: SessionBootstrap } | { error: ErrorBody };
const unauthenticated = { error: { code: "UNAUTHENTICATED" } } as const;
const missing = { error: { code: "NOT_FOUND" } } as const;
const reused = { error: { code: "OPERATION_ID_REUSED", current: { kind: "operation_id_reused" } } } as const;

export async function readSession(ctx: RequestScope, access: SessionAccess): Promise<SessionBootstrap | null> {
  const select = sessionProjection(access, ctx.now);
  return decodeSession(await ctx.binding.prepare(select.sql).bind(...select.params ?? []).all());
}

export async function switchContext(ctx: RequestScope, access: SessionAccess, operationId: string, contextId: string): Promise<SessionCommand> {
  const marker = `pending:${crypto.randomUUID()}`;
  const hash = await hashSessionCredential(JSON.stringify(["session.context", contextId]));
  const target = `${access.sql}, target AS MATERIALIZED (
    SELECT s.session_id, s.account_id, s.context_id AS old_context_id, c.id AS context_id
    FROM acting_session s JOIN account_contexts c ON c.account_id = s.account_id
    WHERE c.id = ? AND ${liveContextAt("s.at")}
  )`;
  // Only the context-selection statements use the old context. The receipt
  // marker and the same cookie's session ID bind the post-switch statements.
  const updated = access.afterContextSwitch ?? access;
  return commitCommand(ctx, prepareCommand<SessionCommand>(ctx, {
    statements: [
      {
        sql: `${target}
          INSERT INTO operation_receipts (account_id, context_id, operation_id, input_hash, command, result_ref, committed_at)
          SELECT account_id, context_id, ?, ?, 'session.context', ?, ? FROM target WHERE old_context_id IS NOT context_id
          ON CONFLICT (account_id, context_id, operation_id) DO NOTHING`,
        params: [...access.params, contextId, operationId, hash, marker, ctx.now],
      },
      {
        sql: `${target} SELECT
          t.context_id IS NOT NULL AS can_switch, r.input_hash, r.command, r.result_ref
          FROM acting_session s LEFT JOIN target t ON t.session_id = s.session_id
          LEFT JOIN operation_receipts r ON r.account_id = t.account_id AND r.context_id = t.context_id AND r.operation_id = ?`,
        params: [...access.params, contextId, operationId],
      },
      {
        sql: `${target} UPDATE sessions SET active_context_id = ?
          WHERE id = (SELECT session_id FROM target) AND EXISTS (SELECT 1 FROM operation_receipts WHERE result_ref = ?)`,
        params: [...access.params, contextId, contextId, marker],
      },
      {
        sql: `${updated.sql} UPDATE operation_receipts SET result_ref = (SELECT session_id FROM acting_session) WHERE result_ref = ?`,
        params: [...updated.params ?? [], marker],
      },
      sessionProjection(updated, ctx.now),
    ],
    decode(results) {
      const target = results[1]?.results[0] as (Receipt & { can_switch: number }) | undefined;
      if (!target) return unauthenticated;
      if (!target.can_switch) return missing;
      const session = decodeSession(results[4]);
      if (!session) return unauthenticated;
      if (target.input_hash !== null && (target.command !== "session.context" || target.input_hash !== hash ||
        (target.result_ref !== marker && target.result_ref !== session.sessionId))) return reused;
      return { session };
    },
  }));
}

export async function endSession(ctx: RequestScope, access: SessionAccess): Promise<string | null> {
  return commitCommand(ctx, prepareCommand(ctx, {
    statements: [
      {
        // Revoke only the signing-out session's registration. A fresh opt-in,
        // not sign-out, advances the token epoch and can change the owner.
        sql: `${access.sql} UPDATE push_installations SET state = 'revoked', updated_at = max(updated_at, ?)
          WHERE state <> 'revoked' AND session_id = (SELECT session_id FROM acting_session)`,
        params: [...access.params, ctx.now],
      },
      {
        sql: `${access.sql} UPDATE sessions SET revoked_at = max(issued_at, ?)
          WHERE id = (SELECT session_id FROM acting_session) RETURNING id`,
        params: [...access.params, ctx.now],
      },
      {
        sql: `INSERT INTO account_security_events (id, account_id, actor_id, kind, at, safe_reason)
          SELECT ?, account_id, account_id, 'session_revoked', revoked_at, 'signed_out' FROM sessions
          WHERE secret_hash = ? AND revoked_at IS NOT NULL AND changes() = 1`,
        params: [crypto.randomUUID(), access.params[0]],
      },
    ],
    decode: (results) => (results[1]?.results[0] as { id: string } | undefined)?.id ?? null,
  }));
}

interface Receipt { input_hash: string | null; command: string | null; result_ref: string | null }
const preferenceColumns = {
  uiLocale: "ui_locale", readingLocale: "reading_locale", displayZone: "display_zone",
  theme: "theme", fieldMode: "field_mode", twoClock: "two_clock",
  shareDisplayZone: "share_display_zone",
} as const;

export async function changeSettings(ctx: RequestScope, access: SessionAccess, operationId: string, revision: number, patch: AccountSettingsPatch): Promise<SessionCommand> {
  const marker = `pending:${crypto.randomUUID()}`;
  const hash = await hashSessionCredential(JSON.stringify(["account.settings", revision, Object.entries(patch).sort(([a], [b]) => a.localeCompare(b))]));
  // An account-level command uses a stable owned context as its receipt key;
  // that context is never treated as authority, including on replay.
  const prefix = `${access.sql}, self AS MATERIALIZED (
    SELECT s.account_id, (SELECT c.id FROM account_contexts c WHERE c.account_id = s.account_id
      ORDER BY c.role <> 'customer', c.id LIMIT 1) AS receipt_context FROM acting_session s
  )`;
  const fields = (Object.keys(preferenceColumns) as (keyof typeof preferenceColumns)[]).flatMap((key) => {
    const value = patch[key];
    return value === undefined ? [] : [{ column: preferenceColumns[key], value: typeof value === "boolean" ? Number(value) : value }];
  });
  const assignments = fields.map(({ column }) => `${column} = ?`);
  const differs = fields.map(({ column }) => `p.${column} IS NOT ?`);
  const values = fields.map(({ value }) => value);
  const eligibleParams: unknown[] = [revision, ...values];
  if (patch.displayName !== undefined) {
    differs.push("a.display_name IS NOT ?", "a.setup_at IS NULL");
    eligibleParams.push(patch.displayName);
  }
  const eligible = `(SELECT p.revision = ? AND (${differs.join(" OR ")})
    FROM account_preferences p JOIN accounts a ON a.id = p.account_id WHERE p.account_id = (SELECT account_id FROM self))`;
  const audit: CommandStatement[] = patch.displayName === undefined ? [] : [{
    sql: `${access.sql} UPDATE accounts SET display_name = ?, setup_at = coalesce(setup_at, max(verified_at, ?))
      WHERE id = (SELECT account_id FROM acting_session) AND changes() = 1`,
    params: [...access.params, patch.displayName, ctx.now],
  }];
  return commitCommand(ctx, prepareCommand<SessionCommand>(ctx, {
    statements: [
      {
        sql: `${prefix}
          INSERT INTO operation_receipts (account_id, context_id, operation_id, input_hash, command, result_ref, committed_at)
          SELECT account_id, receipt_context, ?, ?, 'account.settings', ?, ? FROM self WHERE receipt_context IS NOT NULL AND ${eligible}
          ON CONFLICT (account_id, context_id, operation_id) DO NOTHING`,
        params: [...access.params, operationId, hash, marker, ctx.now, ...eligibleParams],
      },
      {
        sql: `${prefix} UPDATE account_preferences SET ${[...assignments, "revision = revision + 1"].join(", ")}
          WHERE account_id = (SELECT account_id FROM self) AND (
            EXISTS (SELECT 1 FROM operation_receipts WHERE result_ref = ?)
            OR ((SELECT receipt_context FROM self) IS NULL AND ${eligible})
          ) RETURNING revision`,
        params: [...access.params, ...values, marker, ...eligibleParams],
      },
      ...audit,
      {
        sql: `UPDATE operation_receipts SET result_ref = ? WHERE result_ref = ?`,
        params: [String(revision + 1), marker],
      },
      sessionProjection(access, ctx.now),
      {
        sql: `${prefix} SELECT r.input_hash, r.command, r.result_ref FROM self s LEFT JOIN operation_receipts r
          ON r.account_id = s.account_id AND r.context_id = s.receipt_context AND r.operation_id = ?`,
        params: [...access.params, operationId],
      },
    ],
    decode(results) {
      const session = decodeSession(results.at(-2));
      if (!session) return unauthenticated;
      const receipt = results.at(-1)?.results[0] as Receipt | undefined;
      if (receipt?.input_hash != null && (receipt.command !== "account.settings" || receipt.input_hash !== hash)) return reused;
      if (receipt?.input_hash != null || results[1]?.results.length || session.preferences.revision === revision) return { session };
      return { error: { code: "STALE_REVISION", current: { kind: "revision", revision: session.preferences.revision } } };
    },
  }));
}
