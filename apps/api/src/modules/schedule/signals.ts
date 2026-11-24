import type { CommandStatement } from "../../db/commit";
import { at, scopedStatement } from "../access/policy";
import { liveContextPredicate } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { workerFieldShiftChangeRows } from "../field/attendance";
import { placeCapability } from "../places/policy";
import { customer, foreman, provider } from "./policy";
import { crewAvailabilityKind, workerAgendaKind } from "./projections";

export function noticeSignals(access: SessionAccess, guard: CommandStatement, kind: string, recipients: string,
  otherChanges?: string) {
  const event = `${kind}:${crypto.randomUUID()}`;
  const inserted = scopedStatement(access, `INSERT INTO notifications (id, context_id, event_key, kind, created_at)
    SELECT lower(hex(randomblob(16))), context_id, ?, ?, ${at} FROM (${recipients}) WHERE ${guard.sql}`,
  event, kind, ...guard.params ?? []);
  const changes = scopedStatement(access, `SELECT 'notification' AS kind, n.id AS resource_id, n.context_id AS partition_key,
    'upsert' AS op, ${at} AS at FROM (${recipients}) r JOIN notifications n ON n.context_id = r.context_id
    WHERE n.event_key = ?${otherChanges ? ` UNION ALL ${otherChanges}` : ""}`, event);
  const effects = scopedStatement(access, `SELECT lower(hex(randomblob(16))) AS id, 'notification_push' AS kind,
    'notification_push:' || n.id AS dedupe_key, n.id AS resource_ref, ${at} AS due_at, ${at} + 86400000 AS expires_at
    FROM (${recipients}) r JOIN notifications n ON n.context_id = r.context_id WHERE n.event_key = ?`, event);
  return { inserted, changes, effects };
}

export function jobSignals(access: SessionAccess, guard: CommandStatement, kind: string, to: "customer" | "provider" | "other_side",
  bookingChanged = false) {
  const withAudience: SessionAccess = { ...access, sql: `${access.sql}, schedule_audience AS MATERIALIZED (
    SELECT c.id AS context_id, c.account_id, c.role, c.business_id FROM schedule_job j
    JOIN account_contexts c ON c.business_id = j.business_id AND c.role IN ('foreman', 'provider_admin')
    JOIN accounts a ON a.id = c.account_id AND a.state = 'active' WHERE ${liveContextPredicate}
    UNION ALL
    SELECT c.id, c.account_id, c.role, c.business_id FROM schedule_job j JOIN place_people pp ON pp.place_id = j.place_id
    JOIN account_contexts c ON c.account_id = pp.account_id AND c.role = 'customer'
    JOIN accounts a ON a.id = c.account_id AND a.state = 'active' WHERE pp.ends_at IS NULL
  )` };
  const destination = to === "customer" ? customer("audience", "j", true) : to === "provider" ? foreman("audience")
    : `(CASE WHEN actor.role = 'customer' THEN ${foreman("audience")} ELSE ${customer("audience", "j", true)} END)`;
  const recipients = `SELECT audience.context_id FROM schedule_audience audience CROSS JOIN schedule_job j CROSS JOIN live_scope actor
    WHERE audience.account_id <> actor.account_id AND (${destination})`;
  const readable = `(${foreman("audience")} OR ${provider("audience")} OR (${customer("audience")}
    AND (j.owner_id = audience.account_id OR ${placeCapability("j.place_id", "audience.account_id", "view")})))`;
  const jobChanges = bookingChanged ? `SELECT 'job', j.id, audience.context_id, 'upsert', ${at}
    FROM schedule_audience audience CROSS JOIN schedule_job j WHERE ${readable}` : undefined;
  return noticeSignals(withAudience, guard, kind, recipients, jobChanges);
}

export function affectedWorkerKeys(access: SessionAccess, visit: string): CommandStatement {
  return scopedStatement(access, `, released_assignments AS MATERIALIZED (
    SELECT a.id, a.worker_membership_id FROM shifts sh JOIN shift_slots slot ON slot.shift_id = sh.id
    JOIN assignments a ON a.slot_id = slot.id WHERE sh.visit_id = ${visit} AND sh.state = 'planned' AND a.state = 'confirmed'
  ) SELECT kind.value AS kind, m.id AS resource_id, c.id AS partition_key, 'upsert' AS op, ${at} AS at
    FROM account_contexts c JOIN membership_roles r ON r.id = c.role_grant_id AND r.granted_at <= ${at}
    JOIN memberships m ON m.id = r.membership_id JOIN schedule_job j ON j.business_id = m.business_id
    JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
    CROSS JOIN json_each('["${workerAgendaKind}","${crewAvailabilityKind}"]') kind
    WHERE c.role = 'worker' AND ${liveContextPredicate} AND EXISTS (
      SELECT 1 FROM released_assignments a WHERE a.worker_membership_id = m.id)
    UNION ALL ${workerFieldShiftChangeRows("SELECT id FROM released_assignments")}`);
}
