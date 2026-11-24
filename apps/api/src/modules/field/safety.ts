import type {
  ErrorBody, RouteResponse, acknowledgeSafetyInstructionRoute, askSafetyQuestionRoute, issueSafetyInstructionRoute,
  recordSafetyTeachBackRoute,
} from "@bookbuddy/api-contract";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { planOperation } from "../../db/operations";
import type { OperationResult, OperationSpec } from "../../db/operations";
import type { RequestScope } from "../../db/scope";
import { accessClock, at, displayName, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { currentMembership } from "../jobs/projections";
import { confirmedWindow, foreman, jobOpen } from "../schedule/policy";
import { workerFieldShiftChangeRows, workerFieldShiftValue } from "./attendance";

export const fieldJobs = `SELECT j.*, p.owner_id, p.named_approver_id, p.state AS place_state, p.alias, p.normalized_address,
  coalesce(p.site_zone, area.site_zone) AS site_zone, b.public_name AS provider_name, b.state AS business_state,
  r.submitted_at, nullif(trim(lead.display_name), '') AS foreman_name, ${displayName("requester")} AS customer_name
  FROM jobs j JOIN places p ON p.id = j.place_id JOIN businesses b ON b.id = j.business_id
  JOIN operating_areas area ON area.id = b.catchment_id JOIN accounts requester ON requester.id = j.requester_id
  LEFT JOIN requests r ON r.job_id = j.id LEFT JOIN memberships lead_member ON lead_member.id = j.accountable_foreman_membership_id
  LEFT JOIN accounts lead ON lead.id = lead_member.account_id`;
export const headingSql = (job: string) => `json_object('id', ${job}.id, 'reference', ${job}.reference,
  'title', nullif(${job}.trade, ''), 'placeAlias', ${job}.alias)`;
export const windowSql = (w: string) => `json_object('id', ${w}.id, 'startsAt', ${w}.starts_at, 'endsAt', ${w}.ends_at)`;
export const jsonRows = (select: string) => `(SELECT json_group_array(json(value)) FROM (${select}))`;
export const visitAssignments = `FROM assignments a JOIN shift_slots slot ON slot.id = a.slot_id
  JOIN shifts sh ON sh.id = slot.shift_id JOIN memberships member ON member.id = a.worker_membership_id
  JOIN accounts worker ON worker.id = member.account_id`;

export const pageSize = 50;
interface Position { at: number | null; id: string }
export function fieldPosition(cursor?: string): Position | null {
  if (cursor === undefined) return { at: null, id: "" };
  const match = /^(-?\d+)~([A-Za-z0-9_-]{1,256})$/.exec(cursor);
  return match && Number.isSafeInteger(Number(match[1])) ? { at: Number(match[1]), id: match[2]! } : null;
}
export const pageSql = (rows: string) => `json_object('hasMore', json(CASE WHEN (SELECT count(*) FROM ${rows}) > ${pageSize}
  THEN 'true' ELSE 'false' END), 'cursor', CASE WHEN (SELECT count(*) FROM ${rows}) > ${pageSize}
    THEN (SELECT at || '~' || id FROM ${rows} ORDER BY at DESC, id DESC LIMIT 1 OFFSET ${pageSize - 1}) END)`;

const versionSummary = (version: string) => `json_object('id', ${version}.id, 'no', ${version}.no,
  'issuedAt', ${version}.issued_at, 'issuedByName', (SELECT ${displayName("issuer")} FROM accounts issuer WHERE issuer.id = ${version}.issuer_id))`;
export const currentSafetyVersion = (assignment: string) => `(SELECT ver.id FROM safety_instructions ins
  JOIN safety_versions ver ON ver.instruction_id = ins.id WHERE ins.assignment_id = ${assignment} ORDER BY ver.no DESC LIMIT 1)`;
export const instructionSql = (versionId: string) => `(SELECT json_object('instructionId', ver.instruction_id, 'version', json(${versionSummary("ver")}))
  FROM safety_versions ver WHERE ver.id = ${versionId})`;
export const activeHold = (assignment: string, version: string) => `EXISTS (SELECT 1 FROM safety_holds h
  WHERE h.assignment_id = ${assignment} AND h.state = 'active' AND (h.kind <> 'briefing' OR h.version_id IS ${version}))`;
export const holdsSql = (assignment: string, version: string) => jsonRows(`SELECT CASE WHEN h.state = 'cleared'
  THEN json_patch(hold, json_object('clearedAt', cleared_at)) ELSE hold END AS value FROM (
    SELECT json_object('id', h.id, 'kind', h.kind, 'state', h.state, 'instruction', json(${instructionSql("h.version_id")})) AS hold,
      h.state, h.cleared_at, h.id FROM safety_holds h
    WHERE h.assignment_id = ${assignment} AND (h.kind <> 'briefing' OR h.version_id IS ${version}) ORDER BY h.id) h`);

export const effectiveAttendance = (event: string) => `${event}.review_state = 'accepted' AND ${event}.received_at <= ${at}
  AND NOT EXISTS (SELECT 1 FROM attendance_events successor WHERE successor.assignment_id = ${event}.assignment_id
    AND successor.corrects_id = ${event}.id AND successor.review_state = 'accepted' AND successor.received_at <= ${at})`;
function oneAttendance(assignment: string, kind: "arrival" | "departure") {
  return `(SELECT json_object('id', e.id, 'assignmentId', e.assignment_id, 'kind', e.kind, 'source', e.source, 'actualAt', e.actual_at,
    'capturedAt', e.captured_at, 'receivedAt', e.received_at, 'reviewState', e.review_state, 'correctsId', e.corrects_id,
    'reasonCode', e.reason_code, 'recordedByName', ${displayName("actor")})
    FROM attendance_events e JOIN accounts actor ON actor.id = e.actor_id
    WHERE e.assignment_id = ${assignment} AND e.kind = '${kind}' AND ${effectiveAttendance("e")} LIMIT 1)`;
}
export const attendanceSql = (assignment: string) => `json_object('arrival', json(${oneAttendance(assignment, "arrival")}),
  'departure', json(${oneAttendance(assignment, "departure")}), 'hasPendingReview', json(CASE WHEN EXISTS (
    SELECT 1 FROM attendance_events e WHERE e.assignment_id = ${assignment} AND e.review_state = 'needs_review'
    AND e.received_at <= ${at} AND NOT EXISTS (SELECT 1 FROM attendance_events successor
      WHERE successor.corrects_id = e.id AND successor.review_state = 'accepted' AND successor.received_at <= ${at}))
    OR EXISTS (SELECT 1 FROM attendance_correction_requests r WHERE r.assignment_id = ${assignment} AND r.state = 'requested'
      AND r.requested_at <= ${at}) THEN 'true' ELSE 'false' END))`;
export const estimateSql = (assignment: string, foreman: string) => `(SELECT json_object('id', e.id, 'band',
  json_object('startsAt', e.band_start, 'endsAt', e.band_end), 'at', e.at,
  'audience', CASE WHEN e.customer_update_id IS NULL THEN 'crew_only' ELSE 'crew_and_customer' END,
  'foremanName', coalesce(${foreman}, ${displayName("actor")}))
  FROM visit_activity_events e JOIN accounts actor ON actor.id = e.actor_id
  WHERE e.assignment_id = ${assignment} AND e.kind = 'setting_off' AND e.at <= ${at} ORDER BY e.at DESC, e.id DESC LIMIT 1)`;
export const workRows = (visit: string) => `SELECT e.id, e.at, e.kind, e.actor_id, e.customer_update_id FROM visit_activity_events e
  WHERE e.visit_id = ${visit} AND e.kind IN ('work_started', 'work_paused', 'work_finished') AND e.at <= ${at}
  ORDER BY e.at DESC, e.rowid DESC LIMIT 1`;
export const workStampSql = (event: string) => `json_object('id', ${event}.id, 'kind', ${event}.kind, 'at', ${event}.at,
  'byName', (SELECT ${displayName("actor")} FROM accounts actor WHERE actor.id = ${event}.actor_id))`;

const proofRows = (version: string, assignment: string) => `SELECT proof.* FROM teach_backs proof WHERE proof.version_id = ${version}
  AND proof.assignment_id = ${assignment} ORDER BY proof.at DESC, proof.id DESC LIMIT 1`;
const proofSql = (proof: string) => `json_object('id', ${proof}.id, 'outcome', ${proof}.outcome, 'at', ${proof}.at, 'language', ${proof}.language,
  'interpreterRef', ${proof}.interpreter_ref, 'checklist', json(${proof}.checklist),
  'verifiedByName', (SELECT ${displayName("verifier")} FROM accounts verifier WHERE verifier.id = ${proof}.verified_by))`;
const acknowledgementSql = (version: string, assignment: string) => `(SELECT json_object('teachBackId', ack.teach_back_id,
  'workerName', ${displayName("named_worker")}, 'at', ack.at) FROM safety_acknowledgements ack
  JOIN accounts named_worker ON named_worker.id = ack.worker_id WHERE ack.version_id = ${version} AND ack.assignment_id = ${assignment})`;
export const briefingReceiptSql = (version: string, assignment: string) => `(SELECT json_object('teachBack', json(${proofSql("proof")}),
  'acknowledgement', json(${acknowledgementSql(version, assignment)})) FROM (${proofRows(version, assignment)}) proof)`;

const namedWorker = (scope: string) => `${scope}.role = 'worker' AND ${scope}.business_id = j.business_id
  AND member.id = ${currentMembership(scope, at)} AND worker.id = ${scope}.account_id`;
const assignmentFrom = `${visitAssignments} JOIN visits v ON v.id = sh.visit_id JOIN (${fieldJobs}) j ON j.id = v.job_id
  AND j.business_id = member.business_id`;
const confirmedAssignment = `a.state = 'confirmed' AND a.confirmed_at <= ${at} AND sh.state IN ('planned', 'active')`;

export function readAssignmentBriefing(session: SessionAccess, now: number, assignment: string): CommandStatement {
  const access = accessClock(session, now);
  return scopedStatement(access, `, briefing_target AS MATERIALIZED (
    SELECT a.id, v.id AS visit_id, j.normalized_address, scope.context_id
    ${assignmentFrom} ${confirmedWindow("v")} CROSS JOIN live_scope scope
    WHERE a.id = ? AND ${namedWorker("scope")} AND ${confirmedAssignment} AND ${jobOpen()}
      AND v.state = 'booked' AND booked.starts_at <= a.starts_at AND booked.ends_at >= a.ends_at
  )
  SELECT (SELECT json_object('shift', json(${workerFieldShiftValue("briefed.id", "scope")}),
    'instruction', json(${instructionSql(currentSafetyVersion("briefed.id"))}), 'site',
    json_object('address', briefed.normalized_address, 'arrivalPlan', json((
      SELECT json_object('original', json_object('language', e.detail_language, 'text', e.safe_detail), 'reading', NULL,
        'postedByName', ${displayName("actor")}, 'postedAt', e.at)
      FROM visit_activity_events e JOIN accounts actor ON actor.id = e.actor_id WHERE e.visit_id = briefed.visit_id AND e.kind = 'arrival_plan_set'
        AND (e.assignment_id IS NULL OR e.assignment_id = briefed.id) AND e.at <= ${at} ORDER BY e.at DESC, e.id DESC LIMIT 1))))
    FROM briefing_target briefed JOIN live_scope scope ON scope.context_id = briefed.context_id) AS value FROM acting_session`, assignment);
}

function safetyAccess(session: SessionAccess, now: number, instruction: string, assignment: string | null = null): SessionAccess {
  const access = accessClock(session, now);
  return { sql: `${access.sql}, safety_input(id, assignment_id) AS (VALUES (?, ?)), safety_target AS MATERIALIZED (
    SELECT i.id AS instruction_id, a.id AS assignment_id, member.id AS worker_membership_id, worker.id AS worker_id,
      ${displayName("worker")} AS worker_name, j.*, ${currentSafetyVersion("a.id")} AS current_version_id
    ${assignmentFrom} CROSS JOIN safety_input input LEFT JOIN safety_instructions i ON i.assignment_id = a.id
    WHERE a.id = coalesce(input.assignment_id, (SELECT assignment_id FROM safety_instructions WHERE id = input.id))
      AND (i.id IS NULL OR i.id = input.id) AND ${confirmedAssignment} AND ${jobOpen()} AND v.state IN ('booked', 'finished')
  )`, params: [...access.params, instruction, assignment] };
}
const instructionId = "(SELECT id FROM safety_input)";
const targetWorker = (scope: string) => `${scope}.role = 'worker' AND ${scope}.business_id = j.business_id
  AND j.worker_membership_id = ${currentMembership(scope, at)} AND j.worker_id = ${scope}.account_id`;
const targetIssuer = (scope: string) => `${scope}.account_id = ver.issuer_id AND ${foreman(scope)}`;
const currentVersionJoin = "JOIN safety_versions ver ON ver.id = j.current_version_id";
const canIssue = { sql: `EXISTS (SELECT 1 FROM safety_target j WHERE ${foreman("scope")})` };
const canTeach = { sql: `EXISTS (SELECT 1 FROM safety_target j WHERE ${foreman("scope")} AND EXISTS (
  SELECT 1 FROM safety_versions ver WHERE ver.instruction_id = j.instruction_id AND ver.issuer_id = scope.account_id))` };
const workerOnly = { sql: `EXISTS (SELECT 1 FROM safety_target j WHERE j.instruction_id IS NOT NULL AND ${targetWorker("scope")})` };
const questionSql = (q: string) => `json_object('id', ${q}.id, 'versionId', ${q}.version_id, 'askedAt', ${q}.asked_at,
  'original', json_object('language', ${q}.language, 'text', ${q}.original))`;

function safetyProjection(version: string, cursorAt = "NULL", cursorId = "NULL"): string {
  return `SELECT (WITH questions_page AS MATERIALIZED (
    SELECT q.id, q.asked_at AS at, ${questionSql("q")} AS value FROM safety_questions q
    WHERE q.version_id = ver.id AND (${cursorAt} IS NULL OR (q.asked_at, q.id) < (${cursorAt}, ${cursorId}))
    ORDER BY q.asked_at DESC, q.id DESC LIMIT ${pageSize + 1}
  ), current_proof AS MATERIALIZED (${proofRows("ver.id", "j.assignment_id")}), packet AS (
  SELECT json_object('instructionId', ver.instruction_id, 'assignmentId', j.assignment_id,
    'viewer', CASE scope.role WHEN 'foreman' THEN 'issuer' ELSE 'worker' END, 'workerName', j.worker_name, 'siteZone', j.site_zone,
    'version', json(${versionSummary("ver")}), 'original', json_object('language', ver.language, 'text', ver.original),
    'reviewedHumanReadingAid', json(CASE WHEN ver.reading_aid_language IS NOT NULL THEN
      json_object('language', ver.reading_aid_language, 'text', ver.reviewed_human_reading_aid) END),
    'holds', json(${holdsSql("j.assignment_id", "ver.id")}),
    'questions', json(${jsonRows(`SELECT value FROM questions_page ORDER BY at DESC, id DESC LIMIT ${pageSize}`)}),
    'page', json(${pageSql("questions_page")}),
    'teachBack', json((SELECT ${proofSql("proof")} FROM current_proof proof))) AS value
  )
  SELECT CASE WHEN ver.id <> j.current_version_id THEN json_set(packet.value, '$.state', 'superseded',
    '$.acknowledgement', json(${acknowledgementSql("ver.id", "j.assignment_id")}),
    '$.replacedBy', json((SELECT ${versionSummary("latest")} FROM safety_versions latest WHERE latest.id = j.current_version_id)))
  WHEN EXISTS (SELECT 1 FROM safety_acknowledgements ack WHERE ack.version_id = ver.id AND ack.assignment_id = j.assignment_id)
    THEN json_set(packet.value, '$.state', 'acknowledged', '$.acknowledgement', json(${acknowledgementSql("ver.id", "j.assignment_id")}))
  WHEN (SELECT outcome FROM current_proof) = 'passed' THEN json_set(packet.value, '$.state', 'awaiting_acknowledgement')
  ELSE json_set(packet.value, '$.state', 'awaiting_teach_back') END FROM packet)
  FROM safety_target j JOIN safety_versions ver ON ver.instruction_id = j.instruction_id AND ver.id = ${version} AND ver.issued_at <= ${at}
  WHERE ((${targetIssuer("scope")}) OR (${targetWorker("scope")}))`;
}

export function readSafetyInstruction(session: SessionAccess, now: number, id: string, version: string | undefined, position: Position) {
  const access = safetyAccess(session, now, id);
  return scopedStatement(access, `, safety_page(version_id, before_at, before_id) AS (VALUES (?, ?, ?))
    SELECT (SELECT (${safetyProjection("coalesce(page.version_id, j.current_version_id)", "page.before_at", "page.before_id")})
      FROM live_scope scope CROSS JOIN safety_page page) AS value FROM acting_session`, version ?? null, position.at, position.id);
}

export interface FieldCommandResult { operation: OperationResult; value: string | null; error?: ErrorBody }
export async function fieldReceipt(ctx: RequestScope, access: SessionAccess, spec: Omit<OperationSpec, "access">,
  projection: CommandStatement, revision?: { sql: string; expected: number }): Promise<CommandInput<FieldCommandResult>> {
  const plan = await planOperation(ctx, { ...spec, access });
  const authorize = spec.authorize ?? { sql: "1" };
  const result = scopedStatement(access, `SELECT CASE WHEN r.operation_id IS NOT NULL THEN (${projection.sql}) END AS value,
    ${revision ? `(${revision.sql})` : "NULL"} AS revision FROM live_scope scope LEFT JOIN operation_receipts r
    ON r.account_id = scope.account_id AND r.context_id = scope.context_id AND r.operation_id = ? AND r.command = ?
    WHERE (${authorize.sql})`, ...projection.params ?? [], spec.operationId, spec.command, ...authorize.params ?? []);
  return { statements: [...plan.statements, result], decode(results) {
    const operation = plan.decode(results);
    const row = results[plan.statements.length]?.results[0] as { value: string | null; revision: number | null } | undefined;
    if (operation.outcome.status !== "rejected") return { operation, value: row?.value ?? null };
    const error: ErrorBody = revision && operation.outcome.error.code === "CONFLICT" && row?.revision != null && row.revision !== revision.expected
      ? { code: "STALE_REVISION", current: { kind: "revision", revision: row.revision } } : operation.outcome.error;
    return { operation, value: null, error };
  } };
}

type Issue = RouteResponse<typeof issueSafetyInstructionRoute.input>;
type Teach = RouteResponse<typeof recordSafetyTeachBackRoute.input>;
type Ack = RouteResponse<typeof acknowledgeSafetyInstructionRoute.input>;
type Question = RouteResponse<typeof askSafetyQuestionRoute.input>;

export function issueInstruction(ctx: RequestScope, session: SessionAccess, { params: { id }, body }: Issue) {
  const { payload } = body;
  const access = safetyAccess(session, ctx.now, id, payload.assignmentId);
  return fieldReceipt(ctx, access, {
    operationId: body.operationId, command: "field.safety_issue", input: [id, body], resultRef: payload.id, authorize: canIssue,
    eligible: { sql: `EXISTS (SELECT 1 FROM safety_target j LEFT JOIN safety_versions current ON current.id = j.current_version_id
      WHERE j.current_version_id IS ? AND coalesce(current.issued_at, ${at}) <= ${at}
      AND NOT EXISTS (SELECT 1 FROM safety_versions WHERE id = ?)
      AND NOT EXISTS (SELECT 1 FROM safety_instructions other WHERE other.id = ${instructionId} AND other.assignment_id <> j.assignment_id))`,
    params: [payload.expectedVersionId, payload.id] },
    writes: (guard) => ({ statements: [
      scopedStatement(access, `INSERT INTO safety_instructions (id, job_id, assignment_id)
        SELECT ${instructionId}, j.id, j.assignment_id FROM safety_target j WHERE j.instruction_id IS NULL AND ${guard.sql}`,
      ...guard.params ?? []),
      scopedStatement(access, `INSERT INTO safety_versions (id, instruction_id, no, issuer_id, original, language,
        reviewed_human_reading_aid, reading_aid_language, issued_at)
        SELECT ?, ${instructionId}, coalesce((SELECT max(no) FROM safety_versions WHERE instruction_id = ${instructionId}), 0) + 1,
          scope.account_id, ?, ?, ?, ?, ${at} FROM live_scope scope WHERE ${guard.sql}`,
      payload.id, payload.original.text, payload.original.language, payload.reviewedHumanReadingAid?.text ?? null,
      payload.reviewedHumanReadingAid?.language ?? null, ...guard.params ?? []),
      scopedStatement(access, `INSERT INTO safety_holds (id, assignment_id, version_id, kind, state)
        SELECT lower(hex(randomblob(16))), j.assignment_id, ?, 'briefing', 'active' FROM safety_target j WHERE ${guard.sql}`,
      payload.id, ...guard.params ?? []),
    ], changes: scopedStatement(access, workerFieldShiftChangeRows("SELECT assignment_id AS id FROM safety_target")) }),
  }, { sql: safetyProjection("?"), params: [payload.id] });
}

export function recordTeachBack(ctx: RequestScope, session: SessionAccess, { params: { id }, body }: Teach) {
  const { payload } = body;
  const access = safetyAccess(session, ctx.now, id);
  return fieldReceipt(ctx, access, {
    operationId: body.operationId, command: "field.safety_teach_back", input: [id, body], resultRef: payload.id, authorize: canTeach,
    eligible: { sql: `EXISTS (SELECT 1 FROM safety_target j ${currentVersionJoin} WHERE ver.id = ? AND ver.issued_at <= ${at}
      AND ${targetIssuer("scope")} AND EXISTS (SELECT 1 FROM member_languages language
        WHERE language.membership_id = j.worker_membership_id AND language.tag = ? COLLATE NOCASE)
      AND NOT EXISTS (SELECT 1 FROM teach_backs prior WHERE prior.id = ? OR (prior.version_id = ver.id
        AND prior.assignment_id = j.assignment_id AND (prior.at, prior.id) >= (${at}, ?)))
      AND NOT EXISTS (SELECT 1 FROM safety_acknowledgements ack WHERE ack.version_id = ver.id AND ack.assignment_id = j.assignment_id))`,
    params: [payload.versionId, payload.language, payload.id, payload.id] },
    writes: (guard) => ({ statements: [scopedStatement(access, `INSERT INTO teach_backs
      (id, version_id, assignment_id, verified_by, language, interpreter_ref, checklist, outcome, at)
      SELECT ?, ?, j.assignment_id, scope.account_id, ?, ?, ?, ?, ${at} FROM safety_target j CROSS JOIN live_scope scope WHERE ${guard.sql}`,
    payload.id, payload.versionId, payload.language, payload.interpreterRef ?? null, JSON.stringify(payload.checklist), payload.outcome,
    ...guard.params ?? [])] }),
  }, { sql: safetyProjection("?"), params: [payload.versionId] });
}

export function acknowledgeInstruction(ctx: RequestScope, session: SessionAccess, { params: { id }, body }: Ack) {
  const { payload } = body;
  const access = safetyAccess(session, ctx.now, id);
  return fieldReceipt(ctx, access, {
    operationId: body.operationId, command: "field.safety_acknowledge", input: [id, body], resultRef: payload.versionId, authorize: workerOnly,
    eligible: { sql: `EXISTS (SELECT 1 FROM safety_target j ${currentVersionJoin}
      JOIN teach_backs proof ON proof.id = ? AND proof.version_id = ver.id AND proof.assignment_id = j.assignment_id
      WHERE ver.id = ? AND proof.outcome = 'passed' AND proof.at <= ${at}
      AND proof.id = (SELECT current.id FROM (${proofRows("ver.id", "j.assignment_id")}) current)
      AND NOT EXISTS (SELECT 1 FROM safety_acknowledgements ack WHERE ack.version_id = ver.id AND ack.assignment_id = j.assignment_id))`,
    params: [payload.teachBackId, payload.versionId] },
    writes: (guard) => ({ statements: [
      scopedStatement(access, `INSERT INTO safety_acknowledgements (version_id, assignment_id, worker_id, teach_back_id, at)
        SELECT ?, j.assignment_id, scope.account_id, ?, ${at} FROM safety_target j CROSS JOIN live_scope scope WHERE ${guard.sql}`,
      payload.versionId, payload.teachBackId, ...guard.params ?? []),
      scopedStatement(access, `UPDATE safety_holds SET state = 'cleared', cleared_at = ${at}
        WHERE assignment_id = (SELECT assignment_id FROM safety_target) AND version_id = ? AND kind = 'briefing' AND state = 'active' AND ${guard.sql}`,
      payload.versionId, ...guard.params ?? []),
    ], changes: scopedStatement(access, workerFieldShiftChangeRows("SELECT assignment_id AS id FROM safety_target")) }),
  }, { sql: safetyProjection("?"), params: [payload.versionId] });
}

export function askQuestion(ctx: RequestScope, session: SessionAccess, { params: { id }, body }: Question) {
  const { payload } = body;
  const access = safetyAccess(session, ctx.now, id);
  return fieldReceipt(ctx, access, {
    operationId: body.operationId, command: "field.safety_question", input: [id, body], resultRef: payload.id, authorize: workerOnly,
    eligible: { sql: `EXISTS (SELECT 1 FROM safety_target j ${currentVersionJoin} WHERE ver.id = ? AND ver.issued_at <= ${at}
      AND NOT EXISTS (SELECT 1 FROM safety_questions q WHERE q.id = ?))`, params: [payload.versionId, payload.id] },
    writes: (guard) => ({ statements: [scopedStatement(access, `INSERT INTO safety_questions (id, version_id, worker_id, original, language, asked_at)
      SELECT ?, ?, scope.account_id, ?, ?, ${at} FROM live_scope scope WHERE ${guard.sql}`,
    payload.id, payload.versionId, payload.original.text, payload.original.language, ...guard.params ?? [])] }),
  }, { sql: `SELECT ${questionSql("q")} FROM safety_questions q WHERE q.id = ?`, params: [payload.id] });
}
