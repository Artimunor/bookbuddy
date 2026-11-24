import { syncLimits } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";
import { accessClock, at, liveTerm } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { currentPerson } from "../places/policy";
import { ensureSessionThread, isSessionThread, sessionChatGrants, sessionChatTargets } from "./session";

const audiences = "(SELECT 'job' AS audience UNION ALL SELECT 'crew')";
const actorContext = "c.id = (SELECT context_id FROM live_scope)";
const jobFields = `j.business_id, j.place_id, j.requester_id, j.accountable_foreman_membership_id,
  j.reference, j.trade AS title, j.state = 'open' AS parent_open, NULL AS site_zone,
  NULL AS slot_id, NULL AS booked_at, NULL AS host_language, NULL AS guaranteed_host_id, NULL AS session_area_id`;
const staff = `JOIN membership_roles role ON role.id = c.role_grant_id AND role.revoked_at IS NULL AND role.granted_at <= ${at}
  JOIN memberships m ON m.id = role.membership_id AND m.state = 'active' AND m.business_id = t.business_id
  JOIN businesses b ON b.id = m.business_id AND b.state = 'approved'`;

// chat_targets can also describe a not-yet-materialized thread in the inbox.
export function chatTargets(filter: string): string {
  return `SELECT * FROM (
    SELECT t.id, t.job_id, t.session_booking_id, t.audience, t.write_state, t.last_position, ${jobFields}
      FROM chat_threads t JOIN jobs j ON j.id = t.job_id
    UNION ALL
    ${sessionChatTargets(false)}
  ) t WHERE ${filter}`;
}

// chat_members is an explicit Job grant for P and W. For the named foreman,
// customer with a message grant, and assigned Crew, it is a history/write
// boundary, not an independent grant. Never authorize from that row alone.
export function chatParticipants(contextFilter = "1", targets = "chat_targets", includeSessions = true): string {
  return `WITH job_grants AS (
    SELECT t.*, c.id AS context_id, c.account_id, c.role, pp.history_from AS visible_since
    FROM ${targets} t JOIN places p ON p.id = t.place_id AND p.state IN ('in_area', 'out_of_area')
    JOIN place_people pp ON pp.place_id = p.id AND ${currentPerson("pp")}
    JOIN account_contexts c ON c.account_id = pp.account_id AND c.role = 'customer'
    JOIN place_grants g ON g.place_id = p.id AND g.account_id = c.account_id AND g.capability = 'message' AND ${liveTerm("g")}
    WHERE t.audience = 'job' AND (${contextFilter}) AND (t.requester_id = c.account_id OR EXISTS (
      SELECT 1 FROM requests r WHERE r.job_id = t.job_id AND r.submitted_at >= pp.history_from))
    UNION ALL
    SELECT t.*, c.id, c.account_id, c.role, max(role.granted_at, coalesce((SELECT max(h.ended_at) FROM job_handoffs h
      WHERE h.job_id = t.job_id AND h.recipient_id = m.id AND h.state = 'accepted'), 0))
    FROM ${targets} t JOIN account_contexts c ON c.business_id = t.business_id AND c.role = 'foreman'
    ${staff} WHERE t.job_id IS NOT NULL AND m.id = t.accountable_foreman_membership_id AND (${contextFilter})
    UNION ALL
    SELECT t.*, c.id, c.account_id, c.role, max(role.granted_at, assigned.confirmed_at)
    FROM ${targets} t JOIN account_contexts c ON c.business_id = t.business_id AND c.role = 'worker'
    ${staff}
    JOIN (SELECT v.job_id, a.worker_membership_id, min(a.confirmed_at) AS confirmed_at
      FROM assignments a JOIN shift_slots slot ON slot.id = a.slot_id
      JOIN shifts s ON s.id = slot.shift_id AND s.state IN ('planned', 'active')
      JOIN visits v ON v.id = s.visit_id AND v.state = 'booked'
      WHERE a.state = 'confirmed' AND a.confirmed_at <= ${at}
      AND v.job_id IN (SELECT job_id FROM ${targets})
      GROUP BY v.job_id, a.worker_membership_id) assigned ON assigned.job_id = t.job_id AND assigned.worker_membership_id = m.id
    WHERE (${contextFilter}) AND (t.audience = 'crew' OR EXISTS (
      SELECT 1 FROM chat_members explicit WHERE explicit.thread_id = t.id AND explicit.context_id = c.id AND explicit.revoked_at IS NULL))
    UNION ALL
    SELECT t.*, c.id, c.account_id, c.role, role.granted_at
    FROM ${targets} t JOIN chat_members explicit ON explicit.thread_id = t.id AND explicit.revoked_at IS NULL
    JOIN account_contexts c ON c.id = explicit.context_id AND c.business_id = t.business_id AND c.role = 'provider_admin'
    ${staff} WHERE t.audience = 'job' AND (${contextFilter})
  ), grants AS (SELECT * FROM job_grants${includeSessions ? ` UNION ALL SELECT * FROM (${sessionChatGrants(targets, contextFilter, staff)})` : ""})
  SELECT g.*, coalesce(cm.visible_from, 1) AS visible_from, coalesce(cm.can_send, 1) AS member_can_send,
    g.parent_open AND g.write_state = 'open' AND coalesce(cm.can_send, 1) AS can_send
  FROM grants g JOIN accounts a ON a.id = g.account_id AND a.state = 'active'
  LEFT JOIN chat_members cm ON cm.thread_id = g.id AND cm.context_id = g.context_id
  WHERE cm.revoked_at IS NULL`;
}

export function chatScope(access: SessionAccess, now: number, filter: CommandStatement): SessionAccess {
  const clock = accessClock(access, now);
  return { sql: `${clock.sql}, chat_targets AS MATERIALIZED (${chatTargets(filter.sql)}),
    chat_scope AS MATERIALIZED (${chatParticipants(actorContext)})`, params: [...clock.params, ...filter.params ?? []] };
}

export const entryVisible = (thread: string, entry: string) =>
  `${entry}.thread_id = ${thread}.id AND ${entry}.position >= ${thread}.visible_from AND ${entry}.received_at >= ${thread}.visible_since`;

export const exactThread = (id: string): CommandStatement => ({ sql: "t.id = ?", params: [id] });

export function sessionThreadProvision(access: SessionAccess, now: number, id: string): CommandStatement | null {
  return isSessionThread(id) ? ensureSessionThread(access, now, id, staff) : null;
}

function insertThreads(select: string): string {
  return `INSERT INTO chat_threads (id, job_id, audience, write_state)
    SELECT lower(hex(randomblob(16))), job_id, audience, 'open' FROM (${select}) WHERE 1
    ON CONFLICT (job_id, audience) DO NOTHING`;
}

// Optional for job creators: use inside their existing guarded batch, after the
// job insert. Legacy jobs use the scoped, bounded lazy path below instead.
export function createJobThreads(jobId: string, guard: CommandStatement): CommandStatement {
  return { sql: insertThreads(`SELECT j.id AS job_id, a.audience FROM jobs j CROSS JOIN ${audiences} a
    WHERE j.id = ? AND (${guard.sql})`), params: [jobId, ...guard.params ?? []] };
}

export const threadPageFilter = ([jobId, audience]: readonly [string, string]): CommandStatement => ({
  sql: "(coalesce(t.job_id, t.session_booking_id), t.audience) > (?, ?)", params: [jobId, audience],
});

export function ensureInboxThreads(access: SessionAccess, now: number, after: readonly [string, string]): CommandStatement {
  const clock = accessClock(access, now);
  // Existing rows are included before LIMIT so an already provisioned page
  // causes no inserts for jobs beyond the page. Explicit grants always have a thread.
  const candidates = `SELECT t.id, j.id AS job_id, NULL AS session_booking_id, u.audience,
      coalesce(t.write_state, 'open') AS write_state, coalesce(t.last_position, 0) AS last_position, ${jobFields}
    FROM jobs j CROSS JOIN ${audiences} u LEFT JOIN chat_threads t ON t.job_id = j.id AND t.audience = u.audience
    WHERE (j.id, u.audience) > (?, ?) AND EXISTS (SELECT 1 FROM live_scope s
      WHERE s.business_id = j.business_id OR (s.role = 'customer' AND EXISTS (
        SELECT 1 FROM place_people pp WHERE pp.place_id = j.place_id AND pp.account_id = s.account_id AND pp.ends_at IS NULL)))`;
  return { sql: `${clock.sql}, chat_targets AS MATERIALIZED (${candidates}),
    inbox AS MATERIALIZED (${chatParticipants(actorContext, "chat_targets", false)})
    ${insertThreads(`SELECT job_id, audience FROM (
      SELECT id, job_id, audience FROM inbox ORDER BY job_id, audience LIMIT ${syncLimits.changes + 1}) WHERE id IS NULL`)}`,
    params: [...clock.params, ...after] };
}

// On-demand membership materialization is safe because every read, append and
// translation target derives the live audience again, including history bounds.
export function ensureChatMember(scope: SessionAccess, guard: CommandStatement): CommandStatement {
  return { sql: `${scope.sql}
    INSERT INTO chat_members(thread_id, context_id, can_send, visible_from)
    SELECT id, context_id, member_can_send, visible_from FROM chat_scope WHERE (${guard.sql})
    ON CONFLICT(thread_id, context_id) DO NOTHING`, params: [...scope.params, ...guard.params ?? []] };
}
