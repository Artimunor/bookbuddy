import type { CommandStatement } from "../../db/commit";
import { at } from "../access/policy";
import { liveContextPredicate } from "../auth/session";
import { foreman } from "../commercial/policy";
import { createLinkTarget, linkTokenFor, registerLinkResolver } from "../links";
import type { LinkResolver } from "../links";
import { awaitingSignOff, completionValue, dayMs, followUpKind, isSignOffRecipient, jobSource, reminderKind } from "./completion";

export { caseSweepStatements } from "./cases";
export { billingRoutes } from "./routes.billing";
export { completionRoutes } from "./routes.completion";

const completionLink: LinkResolver = {
  targetKind: "completion",
  project(resource, scope) {
    return `(SELECT json_object('kind', 'completion', 'completion', json(${completionValue(scope, "c.id")}))
      FROM (${jobSource(`j.id = (SELECT job_id FROM completions WHERE id = ${resource})`)}) j
      JOIN completions c ON c.id = ${resource} AND c.job_id = j.id
      WHERE CASE WHEN ${scope}.kind = '${followUpKind}' THEN ${foreman(scope)} AND ${awaitingSignOff("c")}
        ELSE ${isSignOffRecipient(scope, "c")} END)`;
  },
};

for (const kind of ["completion_ready", reminderKind, followUpKind]) registerLinkResolver(kind, completionLink);

// D1-only effects are finalized in the sweep's claim transaction. Keep the due
// slice unchanged until the last statement, so the targets, notices, and push
// intents all use the same clock and current grants. No device is required for
// the reminder or the accountable foreman's follow-up to appear in their inbox.
export function completionSweepStatements(now: number): CommandStatement[] {
  const work = `WITH clock(at) AS (VALUES (?)), due AS MATERIALIZED (
    SELECT e.id, e.kind, e.resource_ref, e.expires_at FROM effect_outbox e
    WHERE e.state = 'pending' AND e.kind IN ('${reminderKind}', '${followUpKind}') AND e.due_at <= ${at}
    ORDER BY e.due_at, e.id LIMIT 32
  ), current_completions AS MATERIALIZED (
    SELECT c.* FROM due CROSS JOIN completions c ON c.id = due.resource_ref WHERE c.state = 'submitted' GROUP BY c.id
  ), affected_jobs AS MATERIALIZED (${jobSource("j.id IN (SELECT job_id FROM current_completions)")}),
  candidates AS MATERIALIZED (SELECT due.id AS effect_id, due.kind, c.id AS resource_id, target.id AS required_scope,
    ${at} + ${7 * dayMs} AS expires_at, ${at} AS created_at
    FROM due JOIN current_completions c ON c.id = due.resource_ref JOIN affected_jobs j ON j.id = c.job_id
    JOIN account_contexts target ON (due.kind = '${reminderKind}' AND target.account_id = j.named_approver_id AND target.role = 'customer')
      OR (due.kind = '${followUpKind}' AND target.business_id = j.business_id AND target.role = 'foreman'
        AND target.role_grant_id = (SELECT id FROM membership_roles WHERE membership_id = j.accountable_foreman_membership_id
          AND role = 'foreman' AND revoked_at IS NULL AND granted_at <= ${at} ORDER BY granted_at DESC, id LIMIT 1))
    JOIN accounts person ON person.id = target.account_id AND person.state = 'active'
    WHERE due.expires_at > ${at} AND ${awaitingSignOff("c")} AND CASE WHEN due.kind = '${reminderKind}'
      THEN ${isSignOffRecipient("target", "c")} ELSE EXISTS (
        SELECT 1 FROM account_contexts c WHERE c.id = target.id AND ${liveContextPredicate}) END)`;
  const eventKey = "t.kind || ':' || t.resource_id";
  const token = linkTokenFor("t.kind", "t.resource_id", "t.required_scope", "t.expires_at");
  const posted = `FROM candidates t JOIN notifications n ON n.context_id = t.required_scope AND n.event_key = ${eventKey}
    WHERE n.created_at = t.created_at AND n.link_token IS NOT NULL`;
  return [
    createLinkTarget({ sql: `${work} SELECT * FROM candidates`, params: [now] }),
    { sql: `${work} INSERT INTO notifications (id, context_id, event_key, kind, link_token, created_at)
      SELECT lower(hex(randomblob(16))), t.required_scope, ${eventKey}, t.kind, ${token}, t.created_at FROM candidates t WHERE 1
      ON CONFLICT (context_id, event_key) DO NOTHING`, params: [now] },
    { sql: `${work} INSERT INTO sync_changes (kind, resource_id, partition_key, op, at)
      SELECT 'notification', n.id, n.context_id, 'upsert', ${at} ${posted}`, params: [now] },
    { sql: `${work} INSERT INTO effect_outbox (id, kind, dedupe_key, resource_ref, due_at, state, expires_at)
      SELECT lower(hex(randomblob(16))), 'notification_push', 'notification_push:' || n.id, n.id, ${at}, 'pending', t.expires_at
      ${posted} ON CONFLICT (dedupe_key) DO NOTHING`, params: [now] },
    { sql: `${work} UPDATE effect_outbox SET state = CASE WHEN EXISTS (SELECT 1 FROM candidates WHERE effect_id = effect_outbox.id)
      THEN 'delivered' ELSE 'skipped' END WHERE id IN (SELECT id FROM due)`, params: [now] },
  ];
}
