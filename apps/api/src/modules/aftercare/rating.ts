import type { RouteResponse, submitRatingRoute } from "@bookbuddy/api-contract";
import { AFTERCARE_TARGETS } from "@bookbuddy/domain";
import type { RequestScope } from "../../db/scope";
import { at, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { customer } from "../commercial/policy";
import { aftercareAccess, aftercareJobValue, aftercareReceipt, authored, calendarDeadline, withAftercareSiteClock } from "./completion";

const audience = `json_object('author', json('true'), 'bookBuddyFeedbackTeam', json('true'), 'providerFeedbackLead', json('true'))`;
const ratingValue = `json_object('id', r.id, 'jobId', r.job_id, 'stars', r.stars, 'submittedAt', r.submitted_at,
  'state', r.state, 'comment', json(${authored("r.original_comment", "r.original_language")}), 'audience', ${audience})`;

// Pricing, invoices and cases do not establish the recipient or move the 30-day service clock.
const verifiedDelivery = `SELECT c.id AS completion_id, sign.approver_id AS verified_by, sign.at AS verified_at,
    ${calendarDeadline("c.finished_at", AFTERCARE_TARGETS.ratingCalendarDays)} AS expires_at
  FROM sign_offs sign JOIN completions c ON c.id = sign.completion_id AND c.state = 'signed_off'
  JOIN aftercare_job j ON j.id = sign.job_id CROSS JOIN aftercare_actor scope
  WHERE j.state = 'closed' AND sign.at <= ${at} AND (
    sign.approver_id = scope.account_id OR EXISTS (SELECT 1 FROM approvals a WHERE a.quote_version_id = c.base_quote_version_id
      AND a.account_id = scope.account_id AND a.decision = 'approve' AND a.at <= sign.at)
    OR EXISTS (SELECT 1 FROM visits v JOIN visit_windows w ON w.visit_id = v.id AND w.state = 'confirmed'
      WHERE v.job_id = j.id AND v.kind = 'work' AND v.state = 'finished' AND w.confirmed_by = scope.account_id AND w.confirmed_at <= sign.at))`;

function ratingAccess(base: SessionAccess, now: number): SessionAccess {
  const access = withAftercareSiteClock(base, now);
  return { sql: `${access.sql}, delivery AS MATERIALIZED (${verifiedDelivery})`, params: access.params };
}

export function readRatingEligibility(session: SessionAccess, now: number, job: string) {
  const access = ratingAccess(aftercareAccess(session, now, job), now);
  return scopedStatement(access, `SELECT (SELECT CASE
    WHEN r.state = 'submitted' AND r.author_id = scope.account_id THEN
      json_object('status', 'submitted', 'job', json(${aftercareJobValue}), 'rating', json(${ratingValue}))
    WHEN delivery.completion_id IS NULL OR (e.job_id IS NOT NULL AND (e.completion_id <> delivery.completion_id OR e.verified_at > ${at}))
      THEN json_object('status', 'unavailable', 'job', json(${aftercareJobValue}), 'reason', 'not_eligible')
    WHEN r.id IS NOT NULL THEN json_object('status', 'unavailable', 'job', json(${aftercareJobValue}), 'reason', 'already_rated')
    WHEN delivery.expires_at IS NULL OR delivery.expires_at <= ${at} OR e.expires_at <= ${at} THEN
      json_object('status', 'unavailable', 'job', json(${aftercareJobValue}), 'reason', 'expired')
    ELSE json_object('status', 'eligible', 'job', json(${aftercareJobValue}),
      'expiresAt', min(delivery.expires_at, coalesce(e.expires_at, delivery.expires_at)), 'audience', ${audience}) END
    FROM aftercare_job j CROSS JOIN aftercare_actor scope LEFT JOIN delivery ON 1
    LEFT JOIN ratings r ON r.job_id = j.id LEFT JOIN rating_eligibilities e ON e.job_id = j.id AND e.account_id = scope.account_id
    WHERE ${customer("scope")}) AS value FROM acting_session`);
}

export function submitRating(ctx: RequestScope, session: SessionAccess, { params, body }: RouteResponse<typeof submitRatingRoute.input>) {
  const base = aftercareAccess(session, ctx.now, params.j);
  const access = ratingAccess(base, ctx.now);
  const { id, stars, comment } = body.payload;
  return aftercareReceipt(ctx, base, {
    access, operationId: body.operationId, command: "rating.submit", input: [params.j, body], resultRef: id,
    authorize: { sql: `EXISTS (SELECT 1 FROM aftercare_job j WHERE ${customer("scope")})` },
    eligible: { sql: `EXISTS (SELECT 1 FROM aftercare_job j CROSS JOIN delivery d LEFT JOIN rating_eligibilities e
      ON e.job_id = j.id AND e.account_id = scope.account_id
      WHERE (? IS NULL OR j.revision = ?) AND d.expires_at > ${at}
        AND (e.job_id IS NULL OR (e.completion_id = d.completion_id AND e.verified_at <= ${at} AND e.expires_at > ${at}))
        AND NOT EXISTS (SELECT 1 FROM ratings WHERE job_id = j.id OR id = ?))`,
    params: [body.expectedRevision ?? null, body.expectedRevision ?? null, id] },
    writes(guard) {
      return { statements: [scopedStatement(access, `INSERT INTO rating_eligibilities
          (job_id, account_id, completion_id, verified_by, verified_at, expires_at)
          SELECT j.id, scope.account_id, d.completion_id, d.verified_by, d.verified_at, d.expires_at
          FROM aftercare_job j CROSS JOIN aftercare_actor scope CROSS JOIN delivery d WHERE ${guard.sql}
          AND NOT EXISTS (SELECT 1 FROM rating_eligibilities WHERE job_id = j.id AND account_id = scope.account_id)`, ...guard.params ?? []),
        scopedStatement(access, `INSERT INTO ratings (id, job_id, author_id, stars, original_comment, original_language, submitted_at, state)
          SELECT ?, j.id, scope.account_id, ?, ?, ?, ${at}, 'submitted' FROM aftercare_job j CROSS JOIN aftercare_actor scope WHERE ${guard.sql}`,
        id, stars, comment?.text ?? null, comment?.language ?? null, ...guard.params ?? [])] };
    },
  }, `SELECT ${ratingValue} FROM ratings r WHERE r.job_id = j.id AND r.id = ? AND r.author_id = scope.account_id AND r.state = 'submitted'`,
  body.expectedRevision, [id]);
}
