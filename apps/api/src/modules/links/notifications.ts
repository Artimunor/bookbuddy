import type { CommandStatement } from "../../db/commit";
import { createLinkTarget, linkTokenFor } from ".";

// The producer supplies only the current recipient(s) and an authorized
// destination. Both writes share its operation fence in the caller's batch.
// `targets` yields kind, resource_id, required_scope, expires_at, created_at.
export function createLinkedNotifications(targets: CommandStatement, guard: CommandStatement, event: string, kind: string) {
  const eligible = `SELECT * FROM (${targets.sql}) WHERE resource_id IS NOT NULL AND expires_at > created_at`;
  const token = linkTokenFor("t.kind", "t.resource_id", "t.required_scope", "t.expires_at");
  return [
    createLinkTarget({ sql: eligible, params: targets.params }, guard),
    {
      sql: `INSERT INTO notifications (id, context_id, event_key, kind, link_token, created_at)
        SELECT lower(hex(randomblob(16))), t.required_scope, ?, ?, ${token}, t.created_at FROM (${eligible}) t
        WHERE ${guard.sql} ON CONFLICT (context_id, event_key) DO NOTHING`,
      params: [event, kind, ...targets.params ?? [], ...guard.params ?? []],
    },
  ] as const;
}
