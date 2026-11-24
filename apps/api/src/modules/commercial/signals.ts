import type { CommandStatement } from "../../db/commit";
import { at, liveTerm, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { createLinkedNotifications } from "../links/notifications";
import { customer, decisionGrant, foreman, routedReviewer, versionFrom } from "./policy";
import type { CommercialKind } from "./policy";

const DAY_MS = 86_400_000;
export type CommercialEvent = "commercial_review_due" | "commercial_returned" | "commercial_approved" | "commercial_declined" | "quote_ready" | "change_ready";
export const commercialMailKind = "commercial_receipt_email";

// Quote/change snapshots and contract receipts are online-only. Only the
// shared notification and first-quote job journey projections enter sync.

const contexts = `JOIN (SELECT c.*, c.id AS context_id, m.id AS membership_id
  FROM accounts a JOIN account_contexts c ON c.account_id = a.id
  LEFT JOIN membership_roles r ON r.id = c.role_grant_id
  LEFT JOIN memberships m ON m.id = r.membership_id AND m.state = 'active'
  WHERE a.state = 'active' AND
    (c.role = 'customer' OR (m.id IS NOT NULL AND r.revoked_at IS NULL AND r.granted_at <= ${at}))) target ON 1`;

export function commercialSignals(access: SessionAccess, guard: CommandStatement, kind: CommercialKind, id: string, event: CommercialEvent,
  mail: CommandStatement | null = null,
) {
  const ready = event === "quote_ready" || event === "change_ready";
  const reviewDue = event === "commercial_review_due";
  const audience = ready ? `(${customer("target")} AND EXISTS (${decisionGrant("target")}))`
    : reviewDue ? routedReviewer("target", "review") : foreman("target");
  const eventKey = `${event}:${kind}:${id}`;
  const quoteReady = event === "quote_ready";
  const expiry = ready ? `v.expires_at` : reviewDue ? `review.due_at + ${DAY_MS}` : `${at} + ${7 * DAY_MS}`;
  const targets = scopedStatement(access, `SELECT ? AS kind, ${quoteReady ? "v.id" : "j.id"} AS resource_id,
    target.id AS required_scope, ${expiry} AS expires_at, ${at} AS created_at ${versionFrom(kind)} ${contexts}
    WHERE v.id = ? AND ${audience}`, quoteReady ? "quote_ready" : "job_update", id);
  const notifications = createLinkedNotifications(targets, guard, eventKey, event);
  const push = `SELECT lower(hex(randomblob(16))) AS id, 'notification_push' AS kind,
    'notification_push:' || n.id AS dedupe_key, n.id AS resource_ref, ${at} AS due_at, ${expiry} AS expires_at
    ${versionFrom(kind)} JOIN notifications n ON n.event_key = ? AND n.link_token IS NOT NULL WHERE v.id = ?`;
  const effects = scopedStatement(access, push + (mail ? ` UNION ALL ${mail.sql}` : ""), eventKey, id, ...mail?.params ?? []);
  const jobChanges = `SELECT 'job', j.id, target.id, 'upsert', ${at} ${versionFrom("quote")} ${contexts}
    WHERE v.id = ? AND NOT EXISTS (SELECT 1 FROM quote_versions prior WHERE prior.quote_id = v.quote_id
      AND prior.id <> v.id AND prior.issued_at IS NOT NULL)
      AND (${customer("target")} OR ${foreman("target")} OR (target.business_id = j.business_id AND (
        target.role = 'provider_admin' OR (target.role = 'foreman' AND EXISTS (
          SELECT 1 FROM job_grants g JOIN business_grants bg ON bg.membership_id = target.membership_id
            AND bg.capability = 'backup_foreman' AND ${liveTerm("bg")}
          WHERE g.job_id = j.id AND g.context_id = target.id AND g.capability = 'backup' AND ${liveTerm("g")})))))`;
  const changes = scopedStatement(access, `SELECT 'notification' AS kind, n.id AS resource_id, n.context_id AS partition_key,
    'upsert' AS op, ${at} AS at FROM notifications n WHERE n.event_key = ?` + (quoteReady ? ` UNION ALL ${jobChanges}` : ""),
  eventKey, ...(quoteReady ? [id] : []));
  return { notifications, changes, effects };
}

export function mailIntent(key: string, receipt: string): CommandStatement {
  return { sql: `SELECT lower(hex(randomblob(16))) AS id, '${commercialMailKind}' AS kind,
    '${commercialMailKind}:' || ? AS dedupe_key, ? AS resource_ref, ${at} AS due_at, ${at} + ${7 * DAY_MS} AS expires_at`,
  params: [key, receipt] };
}
