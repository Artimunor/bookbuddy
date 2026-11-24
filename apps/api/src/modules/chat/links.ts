import type { CommandStatement } from "../../db/commit";
import { at, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import type { LinkResolver } from "../links";
import { createLinkedNotifications } from "../links/notifications";
import { chatParticipants, chatTargets, entryVisible } from "./policy";

export const threadLinkKind = "thread";
export const chatNoticeKind = "chat_message";
const dayMs = 24 * 60 * 60 * 1000;

export function visibleThreadFor(resource: string, context: string): string {
  // Bind outer expressions before the thread and member queries give their
  // own aliases to those tables. Neither a token nor a membership row is authority.
  return `WITH chat_link(id, context_id) AS MATERIALIZED (SELECT ${resource}, ${context}),
    chat_targets AS MATERIALIZED (${chatTargets("t.id = (SELECT id FROM chat_link)")})
    SELECT id, audience FROM (${chatParticipants("c.id = (SELECT context_id FROM chat_link)")})`;
}

export const threadLinkResolver: LinkResolver = {
  targetKind: "conversation",
  project(resource, scope) {
    return `(SELECT json_object('kind', 'thread', 'threadId', permitted.id, 'audience', permitted.audience)
      FROM (${visibleThreadFor(resource, `${scope}.context_id`)}) permitted)`;
  },
};

export function chatNotifications(scope: SessionAccess, threadId: string, entryId: string, now: number) {
  const event = `${chatNoticeKind}:${entryId}`;
  // Messages on the same UTC day reuse the same still-valid scoped destination.
  const expires = (Math.floor(now / dayMs) + 8) * dayMs;
  const targets = scopedStatement(scope, `, recipients AS MATERIALIZED (${chatParticipants()})
    SELECT '${threadLinkKind}' AS kind, recipient.id AS resource_id, recipient.context_id AS required_scope,
      ? AS expires_at, ${at} AS created_at FROM chat_scope sender JOIN recipients recipient
      ON recipient.id = sender.id AND recipient.account_id <> sender.account_id
    JOIN chat_entries e ON ${entryVisible("recipient", "e")} AND e.id = ?`, expires, entryId);
  // The thread-link and (context,event) indexes locate the notices without an
  // event-key table scan. Durable notices need no push intent without a device.
  const notices = `FROM link_targets t JOIN notifications n
    ON n.context_id = t.required_scope AND n.event_key = ? AND n.link_token = t.token`;
  const target = `t.kind = '${threadLinkKind}' AND t.resource_id = ? AND t.expires_at >= ?`;
  return {
    statements: (guard: CommandStatement) => createLinkedNotifications(targets, guard, event, chatNoticeKind),
    changes: { sql: `SELECT 'notification' AS kind, n.id AS resource_id, n.context_id AS partition_key, 'upsert' AS op, ? AS at
      ${notices} WHERE ${target}`, params: [now, event, threadId, expires] },
    effects: { sql: `SELECT lower(hex(randomblob(16))) AS id, 'notification_push' AS kind,
        'notification_push:' || n.id AS dedupe_key, n.id AS resource_ref, ? AS due_at, t.expires_at
      ${notices} JOIN account_contexts c ON c.id = n.context_id WHERE ${target} AND EXISTS (
        SELECT 1 FROM push_installations device WHERE device.account_id = c.account_id AND device.state = 'active')`,
      params: [now, event, threadId, expires] },
  };
}
