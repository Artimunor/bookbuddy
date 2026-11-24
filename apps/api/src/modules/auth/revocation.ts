import type { RouteRequest, sessionRevokeRoute } from "@bookbuddy/api-contract";
import { commitCommand, prepareCommand } from "../../db/commit";
import type { RequestScope } from "../../db/scope";
import { hashSessionCredential } from "./session";

export async function revokeDeviceSession(ctx: RequestScope, input: RouteRequest<typeof sessionRevokeRoute.input>["body"]) {
  const { sessionId, proof } = input;
  // Match the exact session even after expiry; do not turn the proof into a SessionAccess.
  const match = [sessionId, await hashSessionCredential(proof)];
  return commitCommand(ctx, prepareCommand(ctx, {
    statements: [
      {
        // A delayed proof cannot deactivate a fresh opt-in by another session.
        sql: `UPDATE push_installations SET state = 'revoked', updated_at = max(updated_at, ?)
          WHERE state <> 'revoked' AND session_id = (
            SELECT id FROM sessions WHERE id = ? AND revocation_hash = ? AND revoked_at IS NULL
          )`,
        params: [ctx.now, ...match],
      },
      {
        sql: `UPDATE sessions SET revoked_at = max(issued_at, ?)
          WHERE id = ? AND revocation_hash = ? AND revoked_at IS NULL RETURNING id`,
        params: [ctx.now, ...match],
      },
      {
        sql: `INSERT INTO account_security_events (id, account_id, actor_id, kind, at, safe_reason)
          SELECT ?, account_id, account_id, 'session_revoked', revoked_at, 'signed_out' FROM sessions
          WHERE id = ? AND revocation_hash = ? AND changes() = 1`,
        params: [crypto.randomUUID(), ...match],
      },
      {
        sql: "SELECT 1 FROM sessions WHERE id = ? AND revocation_hash = ?",
        params: match,
      },
    ],
    decode: (results) => results[3]?.results.length
      ? { newlyRevokedSessionId: results[1]?.results.length ? sessionId : null }
      : null,
  }));
}
