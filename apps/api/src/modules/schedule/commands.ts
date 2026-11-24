import type {
  RouteResponse, cancelVisitRoute, confirmVisitWindowRoute, proposeVisitWindowsRoute, requestVisitRescheduleRoute, withdrawVisitWindowRoute,
} from "@bookbuddy/api-contract";
import { DIRECT_RESCHEDULE_NOTICE_MS } from "@bookbuddy/domain";
import type { CommandStatement } from "../../db/commit";
import { recordSyncChanges } from "../../db/operations";
import type { RequestScope } from "../../db/scope";
import { at, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import {
  approvedQuoteJoin, capacity, confirmationMode, confirmedWindow, customer, foreman, freeWorkers, jobOpen,
  likeForLike, noWithdrawal, scheduleAccess, targetId, unstarted, visitManager,
} from "./policy";
import { changedVisitJson } from "./read";
import { scheduleReceipt } from "./receipts";
import { affectedWorkerKeys, jobSignals } from "./signals";

type Proposal = RouteResponse<typeof proposeVisitWindowsRoute.input>;
type Confirmation = RouteResponse<typeof confirmVisitWindowRoute.input>;
type Withdrawal = RouteResponse<typeof withdrawVisitWindowRoute.input>;
type Cancellation = RouteResponse<typeof cancelVisitRoute.input>;
type Reschedule = RouteResponse<typeof requestVisitRescheduleRoute.input>;

const now = at;
const visitForWindow = `(SELECT visit_id FROM visit_windows WHERE id = ${targetId})`;
const mayPropose = `EXISTS (SELECT 1 FROM schedule_job j WHERE ${foreman("scope")})`;
const mayConfirm = `EXISTS (SELECT 1 FROM schedule_job j WHERE ${customer("scope", "j", true)})`;
const mayManage = `EXISTS (SELECT 1 FROM schedule_job j WHERE ${visitManager("scope")})`;
const revisionOf = (expected: number, visitId: string) => ({ expected, sql: `SELECT v.revision FROM visits v
  JOIN schedule_job j ON j.id = v.job_id WHERE v.id = ${visitId}` });
const bumpVisit = (access: SessionAccess, guard: CommandStatement, visitId: string) => scopedStatement(access,
  `UPDATE visits SET revision = revision + 1 WHERE id = ${visitId} AND ${guard.sql}`, ...guard.params ?? []);
const windowUnavailable = { code: "CONFLICT", current: { kind: "window_unavailable" } } as const;

// A worker agreed to the old times, not to a new window. Release those
// assignments and offers only when the customer actually moves or cancels it.
function endShiftCommitments(access: SessionAccess, guard: CommandStatement, visitId: string): CommandStatement[] {
  const pending = guard.params ?? [];
  const slots = `SELECT slot.id FROM shift_slots slot JOIN shifts sh ON sh.id = slot.shift_id
    WHERE sh.visit_id = ${visitId} AND sh.state = 'planned'`;
  const gaps = `SELECT g.id FROM cover_gaps g WHERE g.slot_id IN (${slots}) AND g.state IN ('open', 'accepted_pending_confirmation')`;
  return [
    recordSyncChanges(guard, affectedWorkerKeys(access, visitId)),
    scopedStatement(access, `UPDATE assignments SET state = 'released' WHERE state = 'confirmed' AND slot_id IN (${slots})
      AND ${guard.sql}`, ...pending),
    scopedStatement(access, `UPDATE assignment_offers SET state = CASE WHEN expires_at <= ${now} THEN 'expired' ELSE 'withdrawn' END,
      resolved_at = ${now} WHERE state = 'offered' AND issued_at <= ${now} AND slot_id IN (${slots}) AND ${guard.sql}`, ...pending),
    scopedStatement(access, `UPDATE cover_rounds SET state = 'closed', ended_at = ${now}
      WHERE state IN ('open', 'accepted_pending_confirmation') AND gap_id IN (${gaps}) AND opened_at <= ${now} AND ${guard.sql}`, ...pending),
    scopedStatement(access, `UPDATE cover_dispatches SET state = 'closed', closed_at = ${now}
      WHERE state = 'open' AND gap_id IN (${gaps}) AND issued_at <= ${now} AND ${guard.sql}`, ...pending),
    scopedStatement(access, `UPDATE cover_gaps SET state = 'closed', closed_at = ${now}, revision = revision + 1
      WHERE id IN (${gaps}) AND ${guard.sql}`, ...pending),
  ];
}

function retireProposals(access: SessionAccess, guard: CommandStatement, visitId: string) {
  return scopedStatement(access, `UPDATE visit_windows SET state = 'withdrawn'
    WHERE visit_id = ${visitId} AND state = 'proposed' AND ${guard.sql}`, ...guard.params ?? []);
}

export function proposeWindows(ctx: RequestScope, session: SessionAccess, { params: { j }, body }: Proposal) {
  const { expectedRevision, operationId, payload } = body;
  const { visitId, approvedQuoteVersionId, windows, purpose } = payload;
  const original = purpose.kind === "booking" ? null : purpose.replacesWindowId;
  const previousRequest = purpose.kind === "direct_alternative" ? null : purpose.requestId;
  // A request row also carries the provider's explicit agreement to this exact
  // replacement. A direct alternative deliberately has no request association.
  const newAgreement = purpose.kind === "agreement" && previousRequest === null ? crypto.randomUUID() : null;
  const request = previousRequest ?? newAgreement;
  const visit = "(SELECT visit_id FROM proposal_input)";
  const record = scheduleAccess(session, ctx.now, { kind: "job", id: j });
  const access: SessionAccess = { sql: `${record.sql}, proposal_input(visit_id, original, request_id, visit_kind) AS (VALUES (?, ?, ?, ?)),
    proposal_windows AS MATERIALIZED (SELECT value ->> '$.id' AS id, value ->> '$.startsAt' AS starts_at,
      value ->> '$.endsAt' AS ends_at, value ->> '$.expiresAt' AS expires_at FROM json_each(?))`,
  params: [...record.params, visitId, original, request, purpose.kind === "booking" ? purpose.visitKind : null, JSON.stringify(windows)] };
  const visitBasis = purpose.kind === "booking"
    ? `(booked.id IS NULL AND ((v.id IS NULL AND ${previousRequest === null ? "1" : "0"})
      OR (v.state = 'planned' AND v.kind = input.visit_kind AND ${unstarted("v", "booked")})))`
    : `(v.state = 'booked' AND booked.id = input.original AND ${unstarted("v", "booked")})`;
  const requestBasis = previousRequest === null ? "1" : `EXISTS (SELECT 1 FROM reschedule_requests req WHERE req.id = input.request_id
    AND req.visit_id = v.id AND req.state IN ('requested', 'proposed') AND req.reply_by > ${now})`;
  return scheduleReceipt(ctx, access, {
    command: "schedule.propose_windows", input: [j, body], operationId, resultRef: visitId, authorize: { sql: mayPropose },
    eligible: { sql: `EXISTS (SELECT 1 FROM schedule_job j CROSS JOIN proposal_input input ${approvedQuoteJoin()}
      LEFT JOIN visits v ON v.id = input.visit_id ${confirmedWindow("v")}
      WHERE ${jobOpen()} AND q.id = ? AND ${noWithdrawal()} AND (v.id IS NULL OR v.job_id = j.id)
        AND coalesce(v.revision, 0) = ? AND ${visitBasis} AND ${requestBasis}
        AND NOT EXISTS (SELECT 1 FROM proposal_windows w WHERE w.expires_at <= ${now}
          OR EXISTS (SELECT 1 FROM visit_windows old WHERE old.id = w.id)
          OR NOT ${capacity("j", "input.visit_id", "w.starts_at", "w.ends_at")}
          ${purpose.kind === "direct_alternative" ? `OR NOT (${likeForLike("j", "booked", "w.starts_at", "w.ends_at")})` : ""}))`,
    params: [approvedQuoteVersionId, expectedRevision] },
    ineligible: windowUnavailable,
    writes(guard) {
      const statements: CommandStatement[] = [];
      if (purpose.kind === "booking") statements.push(scopedStatement(access, `INSERT INTO visits (id, job_id, kind, state)
        SELECT input.visit_id, j.id, input.visit_kind, 'planned' FROM schedule_job j CROSS JOIN proposal_input input
        WHERE ${guard.sql} AND NOT EXISTS (SELECT 1 FROM visits WHERE id = input.visit_id)`, ...guard.params ?? []));
      statements.push(retireProposals(access, guard, visit));
      statements.push(scopedStatement(access, `UPDATE reschedule_requests SET state = 'requested'
        WHERE visit_id = ${visit} AND state = 'proposed' AND ${guard.sql}`,
      ...guard.params ?? []));
      if (newAgreement !== null) statements.push(scopedStatement(access, `INSERT INTO reschedule_requests
        (id, visit_id, requester_id, state, requested_at, reply_by)
        SELECT input.request_id, input.visit_id, scope.account_id, 'proposed', ${now},
          (SELECT max(expires_at) FROM proposal_windows) FROM proposal_input input CROSS JOIN live_scope scope
        WHERE ${guard.sql}`, ...guard.params ?? []));
      if (previousRequest !== null) statements.push(scopedStatement(access, `UPDATE reschedule_requests SET state = 'proposed'
        WHERE id = (SELECT request_id FROM proposal_input) AND ${guard.sql}`, ...guard.params ?? []));
      statements.push(scopedStatement(access, `INSERT INTO visit_windows
        (id, visit_id, replaces_window_id, reschedule_request_id, starts_at, ends_at, expires_at, provider_authorized, proposed_at, proposed_by, state)
        SELECT w.id, input.visit_id, input.original, input.request_id, w.starts_at, w.ends_at, w.expires_at, 1, ${now}, scope.account_id, 'proposed'
        FROM proposal_input input CROSS JOIN proposal_windows w CROSS JOIN live_scope scope WHERE ${guard.sql}`, ...guard.params ?? []),
      bumpVisit(access, guard, visit));
      const { notifications, changes, effects } = jobSignals(access, guard, "visit_windows_offered", "customer");
      return { statements: [...statements, ...notifications], changes, effects };
    },
  }, { sql: changedVisitJson(visit) }, revisionOf(expectedRevision, visit));
}

export function confirmWindow(ctx: RequestScope, session: SessionAccess, { params: { id }, body }: Confirmation) {
  const { expectedRevision, operationId, payload } = body;
  const access = scheduleAccess(session, ctx.now, { kind: "window", id });
  const confirmed = `SELECT w.visit_id, w.starts_at, w.ends_at, j.trade,
    (SELECT crew.work_language FROM (${freeWorkers("j", "v.id", "w.starts_at", "w.ends_at")}) crew
      ORDER BY crew.work_language, crew.id LIMIT 1) AS language
    FROM visit_windows w JOIN visits v ON v.id = w.visit_id JOIN schedule_job j ON j.id = v.job_id WHERE w.id = ${targetId}`;
  return scheduleReceipt(ctx, access, {
    command: "schedule.confirm_window", input: [id, body], operationId, resultRef: id, authorize: { sql: mayConfirm },
    eligible: { sql: `EXISTS (SELECT 1 FROM schedule_job j ${approvedQuoteJoin()}
      JOIN visit_windows w ON w.id = ${targetId} JOIN visits v ON v.id = w.visit_id AND v.job_id = j.id ${confirmedWindow("v")}
      WHERE q.id = ? AND v.revision = ? AND w.proposed_by <> scope.account_id AND ${confirmationMode("j", "v", "w", "booked")} IS NOT NULL)`,
    params: [payload.approvedQuoteVersionId, expectedRevision] },
    ineligible: windowUnavailable,
    writes(guard) {
      const pending = guard.params ?? [];
      const { notifications, changes, effects } = jobSignals(access, guard, "visit_window_confirmed", "provider", true);
      return { statements: [
        scopedStatement(access, `UPDATE visit_windows SET state = 'superseded' WHERE visit_id = ${visitForWindow}
          AND state = 'confirmed' AND ${guard.sql}`, ...pending),
        scopedStatement(access, `UPDATE visit_windows SET state = 'confirmed', confirmed_at = ${now},
          confirmed_by = (SELECT account_id FROM live_scope) WHERE id = ${targetId} AND ${guard.sql}`, ...pending),
        retireProposals(access, guard, visitForWindow),
        scopedStatement(access, `UPDATE visits SET state = 'booked', revision = revision + 1 WHERE id = ${visitForWindow} AND ${guard.sql}`, ...pending),
        scopedStatement(access, `UPDATE reschedule_requests SET state = CASE WHEN id = (
          SELECT reschedule_request_id FROM visit_windows WHERE id = ${targetId}) THEN 'accepted' ELSE 'withdrawn' END
          WHERE visit_id = ${visitForWindow} AND state IN ('requested', 'proposed') AND ${guard.sql}`, ...pending),
        ...endShiftCommitments(access, guard, visitForWindow),
        // Preserve the original times for any already issued offer or assignment.
        scopedStatement(access, `UPDATE shifts AS sh SET state = 'cancelled'
          WHERE sh.visit_id = ${visitForWindow} AND sh.state = 'planned' AND ${guard.sql}
            AND EXISTS (SELECT 1 FROM shift_slots slot WHERE slot.shift_id = sh.id AND (
              EXISTS (SELECT 1 FROM assignments a WHERE a.slot_id = slot.id)
              OR EXISTS (SELECT 1 FROM assignment_offers o WHERE o.slot_id = slot.id)))`, ...pending),
        scopedStatement(access, `, selected AS MATERIALIZED (${confirmed})
          UPDATE shifts AS sh SET starts_at = selected.starts_at, ends_at = selected.ends_at,
            skill = selected.trade, briefing_language = selected.language FROM selected
          WHERE sh.visit_id = selected.visit_id AND sh.state = 'planned' AND ${guard.sql}`, ...pending),
        scopedStatement(access, `, selected AS MATERIALIZED (${confirmed})
          INSERT INTO shifts (id, visit_id, starts_at, ends_at, skill, briefing_language, state)
          SELECT lower(hex(randomblob(16))), s.visit_id, s.starts_at, s.ends_at, s.trade, s.language, 'planned' FROM selected s
          WHERE ${guard.sql} AND NOT EXISTS (SELECT 1 FROM shifts sh WHERE sh.visit_id = s.visit_id AND sh.state = 'planned')`, ...pending),
        scopedStatement(access, `INSERT INTO shift_slots (id, shift_id, number, is_lead)
          SELECT lower(hex(randomblob(16))), sh.id, 1, 1 FROM shifts sh WHERE sh.visit_id = ${visitForWindow} AND sh.state = 'planned'
            AND ${guard.sql} AND NOT EXISTS (SELECT 1 FROM shift_slots slot WHERE slot.shift_id = sh.id)`, ...pending),
        ...notifications,
      ], changes, effects };
    },
  }, { sql: changedVisitJson(visitForWindow) }, revisionOf(expectedRevision, visitForWindow));
}

export function withdrawWindow(ctx: RequestScope, session: SessionAccess, { params: { id }, body }: Withdrawal) {
  const { expectedRevision, operationId } = body;
  const access = scheduleAccess(session, ctx.now, { kind: "window", id });
  return scheduleReceipt(ctx, access, {
    command: "schedule.withdraw_window", input: [id, body], operationId, resultRef: id, authorize: { sql: mayPropose },
    eligible: { sql: `EXISTS (SELECT 1 FROM schedule_job j JOIN visits v ON v.job_id = j.id
      JOIN visit_windows w ON w.id = ${targetId} AND w.visit_id = v.id
      WHERE ${jobOpen()} AND v.revision = ? AND w.state = 'proposed' AND w.proposed_at <= ${now} AND w.expires_at > ${now})`, params: [expectedRevision] },
    ineligible: windowUnavailable,
    writes(guard) {
      const pending = guard.params ?? [];
      const { notifications, changes, effects } = jobSignals(access, guard, "visit_window_withdrawn", "customer");
      return { statements: [
        scopedStatement(access, `UPDATE visit_windows SET state = 'withdrawn' WHERE id = ${targetId} AND ${guard.sql}`, ...pending),
        scopedStatement(access, `UPDATE reschedule_requests AS request SET state = 'requested'
          WHERE request.state = 'proposed' AND request.id = (SELECT reschedule_request_id FROM visit_windows WHERE id = ${targetId})
            AND ${guard.sql} AND NOT EXISTS (SELECT 1 FROM visit_windows w WHERE w.reschedule_request_id = request.id
              AND w.state = 'proposed' AND w.expires_at > ${now})`, ...pending),
        bumpVisit(access, guard, visitForWindow), ...notifications,
      ], changes, effects };
    },
  }, { sql: changedVisitJson(visitForWindow) }, revisionOf(expectedRevision, visitForWindow));
}

export function cancelVisit(ctx: RequestScope, session: SessionAccess, { params: { id }, body }: Cancellation) {
  const { expectedRevision, operationId, payload } = body;
  const access = scheduleAccess(session, ctx.now, { kind: "visit", id });
  return scheduleReceipt(ctx, access, {
    command: "schedule.cancel_visit", input: [id, body], operationId, resultRef: id, authorize: { sql: mayManage },
    eligible: { sql: `EXISTS (SELECT 1 FROM schedule_job j JOIN visits v ON v.id = ${targetId} AND v.job_id = j.id ${confirmedWindow("v")}
      WHERE v.revision = ? AND v.state = 'booked' AND booked.id = ? AND ${unstarted("v", "booked")})`,
    params: [expectedRevision, payload.bookedWindowId] },
    writes(guard) {
      const pending = guard.params ?? [];
      const { notifications, changes, effects } = jobSignals(access, guard, "visit_cancelled", "other_side", true);
      return { statements: [
        scopedStatement(access, `UPDATE visits SET state = 'cancelled', revision = revision + 1, cancelled_at = ${now},
          cancelled_by = (SELECT account_id FROM live_scope) WHERE id = ${targetId} AND ${guard.sql}`, ...pending),
        scopedStatement(access, `UPDATE visit_windows SET state = CASE state WHEN 'confirmed' THEN 'cancelled' ELSE 'withdrawn' END
          WHERE visit_id = ${targetId} AND state IN ('confirmed', 'proposed') AND ${guard.sql}`, ...pending),
        ...endShiftCommitments(access, guard, targetId),
        scopedStatement(access, `UPDATE shifts SET state = 'cancelled' WHERE visit_id = ${targetId} AND state = 'planned' AND ${guard.sql}`, ...pending),
        scopedStatement(access, `UPDATE reschedule_requests SET state = 'withdrawn'
          WHERE visit_id = ${targetId} AND state IN ('requested', 'proposed') AND ${guard.sql}`, ...pending), ...notifications,
      ], changes, effects };
    },
  }, { sql: changedVisitJson(targetId) }, revisionOf(expectedRevision, targetId));
}

export function requestReschedule(ctx: RequestScope, session: SessionAccess, { params: { id }, body }: Reschedule) {
  const { expectedRevision, operationId, payload } = body;
  const access = scheduleAccess(session, ctx.now, { kind: "visit", id });
  return scheduleReceipt(ctx, access, {
    command: "schedule.request_reschedule", input: [id, body], operationId, resultRef: payload.id, authorize: { sql: mayManage },
    eligible: { sql: `EXISTS (SELECT 1 FROM schedule_job j JOIN visits v ON v.id = ${targetId} AND v.job_id = j.id ${confirmedWindow("v")}
      WHERE v.revision = ? AND ${jobOpen()} AND booked.id IS ? AND ${unstarted("v", "booked")}
      AND (v.state = 'planned' OR booked.id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM reschedule_requests r WHERE r.id = ? OR (r.visit_id = v.id AND r.reply_by > ${now}
        AND r.state IN ('requested', 'proposed'))))`, params: [expectedRevision, payload.bookedWindowId, payload.id] },
    writes(guard) {
      const { notifications, changes, effects } = jobSignals(access, guard, "visit_reschedule_requested", "other_side");
      return { statements: [
        scopedStatement(access, `INSERT INTO reschedule_requests (id, visit_id, requester_id, state, requested_at, reply_by)
          SELECT ?, v.id, scope.account_id, 'requested', ${now},
            min(coalesce(booked.starts_at, ${now} + ${DIRECT_RESCHEDULE_NOTICE_MS}), ${now} + ${DIRECT_RESCHEDULE_NOTICE_MS})
          FROM visits v ${confirmedWindow("v")} CROSS JOIN live_scope scope WHERE v.id = ${targetId} AND ${guard.sql}`,
        payload.id, ...guard.params ?? []), bumpVisit(access, guard, targetId), ...notifications,
      ], changes, effects };
    },
  }, { sql: changedVisitJson(targetId) }, revisionOf(expectedRevision, targetId));
}
