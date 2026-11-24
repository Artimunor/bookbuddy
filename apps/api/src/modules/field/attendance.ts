import { cachedWorkerFieldShiftSchema, mediaFileSchema, mediaLimits } from "@bookbuddy/api-contract";
import type {
  departAssignmentRoute, ErrorBody, OperationId, ProgressPhotoOutcome, recordAssignmentProgressRoute, recordAttendanceRoute,
  requestAttendanceCorrectionRoute, RouteResponse, SyncProgressPhoto,
} from "@bookbuddy/api-contract";
import { ATTENDANCE_REVIEW_POLICY } from "@bookbuddy/domain";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { planOperation } from "../../db/operations";
import type { OperationResult, OperationSpec } from "../../db/operations";
import { accessClock, at, displayName, liveTerm, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { currentMembership, placeZone } from "../jobs/projections";
import { foreman } from "../schedule/policy";
import { syncOperation } from "../sync/registry";
import type { SyncProjectionReader } from "../sync/registry";

type Clock = { now: number };
type Input<Route extends typeof departAssignmentRoute | typeof recordAssignmentProgressRoute | typeof recordAttendanceRoute
  | typeof requestAttendanceCorrectionRoute> = RouteResponse<Route["input"]>;
type Capture = { id: string; kind: "arrival" | "departure"; source: "self" | "manual" | "assisted"; actualAt: number; capturedAt: number };
type FieldCommand = { operation: OperationResult; value: string | null };

const assignmentJoins = `JOIN shift_slots slot ON slot.id = a.slot_id JOIN shifts sh ON sh.id = slot.shift_id
  JOIN visits v ON v.id = sh.visit_id JOIN jobs j ON j.id = v.job_id JOIN places p ON p.id = j.place_id`;
const namedWorker = (scope: string) => `(${scope}.role = 'worker' AND ${scope}.business_id = j.business_id
  AND ${currentMembership(scope, at)} = a.worker_membership_id)`;
const namedActor = (id: string) => `(SELECT ${displayName("actor")} FROM accounts actor WHERE actor.id = ${id})`;
const bool = (test: string) => `json(CASE WHEN ${test} THEN 'true' ELSE 'false' END)`;
const jsonArray = (rows: string) => `(SELECT json_group_array(json(value)) FROM (${rows}))`;
const currentAccepted = (event: string) => `${event}.review_state = 'accepted' AND NOT EXISTS (
  SELECT 1 FROM attendance_events successor WHERE successor.corrects_id = ${event}.id AND successor.review_state = 'accepted')`;
const acceptedEvent = (assignment: string, kind: Capture["kind"]) => `FROM attendance_events e WHERE e.assignment_id = ${assignment}
  AND e.kind = '${kind}' AND ${currentAccepted("e")}`;

// A named foreman relationship alone is not authority to attest for someone else.
const verifiedAssistant = (scope: string) => `(${foreman(scope)} AND owner.account_id <> ${scope}.account_id AND EXISTS (
  SELECT 1 FROM business_grants g JOIN authority_verifications proof ON proof.id = g.approval_verification_id
  WHERE g.business_id = j.business_id AND g.membership_id = ${currentMembership(scope, at)}
    AND g.capability = 'schedule_correction' AND ${liveTerm("g")}
    AND proof.kind = 'business_grant' AND proof.subject_account_id = ${scope}.account_id AND proof.verified_at <= ${at}))`;

function assignmentAccess(session: SessionAccess, now: number, id: string, actor: "worker" | "assistant" | "either"): SessionAccess {
  const clock = accessClock(session, now);
  const authority = actor === "worker" ? namedWorker("scope") : actor === "assistant" ? verifiedAssistant("scope")
    : `(${namedWorker("scope")} OR ${verifiedAssistant("scope")})`;
  return { sql: `${clock.sql}, field_actor AS MATERIALIZED (
    SELECT a.id, a.starts_at, a.ends_at, a.state, sh.id AS shift_id, sh.state AS shift_state, slot.is_lead,
      v.id AS visit_id, v.state AS visit_state, j.id AS job_id, j.state AS job_state, j.accountable_foreman_membership_id AS foreman_id,
      scope.account_id AS actor_id, scope.context_id
    FROM assignments a ${assignmentJoins}
    JOIN memberships owner ON owner.id = a.worker_membership_id AND owner.business_id = j.business_id
    CROSS JOIN live_scope scope WHERE a.id = ? AND a.confirmed_at <= ${at}
      AND a.state IN ('confirmed', 'completed') AND sh.state <> 'cancelled' AND v.state IN ('booked', 'finished')
      AND j.state <> 'cancelled' AND p.state = 'in_area' AND (${authority})
  )`, params: [...clock.params, id] };
}

const authorize = { sql: "EXISTS (SELECT 1 FROM field_actor)" };
const estimateAudience = (alias: string) => `CASE WHEN ${alias}.is_lead = 1 THEN 'crew_and_customer' ELSE 'crew_only' END`;
export const workerFieldShiftKind = "worker_field_shift";
export const assignmentBriefingKind = "assignment_briefing";

// Used in the existing command batch, never resolved in a follow-up membership read.
export function workerFieldChangeRows(assignmentIdsSql: string, changes: "shift" | "briefing" | "both"): string {
  const kind = changes === "both" ? "projection.kind"
    : `'${changes === "shift" ? workerFieldShiftKind : assignmentBriefingKind}'`;
  const projections = changes === "both" ? `CROSS JOIN (SELECT '${workerFieldShiftKind}' AS kind UNION ALL SELECT '${assignmentBriefingKind}') projection` : "";
  return `SELECT ${kind} AS kind, a.id AS resource_id, c.id AS partition_key,
    'upsert' AS op, ${at} AS at FROM (${assignmentIdsSql}) ids JOIN assignments a ON a.id = ids.id
    JOIN membership_roles r ON r.membership_id = a.worker_membership_id AND r.role = 'worker'
      AND r.revoked_at IS NULL AND r.granted_at <= ${at}
    JOIN account_contexts c ON c.role_grant_id = r.id ${projections}`;
}

const shiftChanges = (access: SessionAccess) => scopedStatement(access, workerFieldChangeRows("SELECT id FROM field_actor", "shift"));

export function attendanceEventValue(e: string, name = namedActor(`${e}.actor_id`)): string {
  return `json_object('id', ${e}.id, 'assignmentId', ${e}.assignment_id, 'kind', ${e}.kind, 'source', ${e}.source,
    'actualAt', ${e}.actual_at, 'capturedAt', ${e}.captured_at, 'receivedAt', ${e}.received_at, 'reviewState', ${e}.review_state,
    'correctsId', ${e}.corrects_id, 'reasonCode', ${e}.reason_code, 'recordedByName', ${name})`;
}

export function correctionValue(r: string, name = namedActor(`${r}.requester_id`)): string {
  return `json_object('id', ${r}.id, 'assignmentId', ${r}.assignment_id, 'eventId', ${r}.attendance_event_id,
    'requestedByName', ${name}, 'requestedAt', ${r}.requested_at, 'reasonCode', ${r}.reason_code,
    'proposedActualAt', ${r}.proposed_actual_at, 'state', ${r}.state, 'decision', json(CASE WHEN ${r}.decided_by IS NOT NULL
      THEN json_object('byName', ${namedActor(`${r}.decided_by`)}, 'at', ${r}.decided_at, 'correctionEventId', ${r}.correction_event_id) END))`;
}

export const estimateValue = (e: string, name = namedActor(`${e}.actor_id`)) => `json_object('id', ${e}.id,
  'band', json_object('startsAt', ${e}.band_start, 'endsAt', ${e}.band_end), 'at', ${e}.at,
  'audience', CASE WHEN ${e}.customer_update_id IS NULL THEN 'crew_only' ELSE 'crew_and_customer' END, 'foremanName', ${name})`;

export const workValue = (e: string, name = namedActor(`${e}.actor_id`)) =>
  `json_object('id', ${e}.id, 'kind', ${e}.kind, 'at', ${e}.at, 'byName', ${name})`;

const latestBriefing = (assignment: string) => `SELECT ver.id FROM safety_instructions i JOIN safety_versions ver ON ver.instruction_id = i.id
  WHERE i.assignment_id = ${assignment} AND ver.issued_at <= ${at} ORDER BY ver.no DESC LIMIT 1`;
const applicableHolds = (assignment: string) => `h.assignment_id = ${assignment}
  AND (h.kind <> 'briefing' OR h.version_id IS (${latestBriefing(assignment)}))`;
const holdsValue = (assignment: string) => jsonArray(`SELECT json_patch(json_object('id', h.id, 'state', h.state, 'kind', h.kind,
  'instruction', json(CASE WHEN ver.id IS NOT NULL THEN json_object('instructionId', ver.instruction_id,
    'version', json_object('id', ver.id, 'no', ver.no, 'issuedByName', ${namedActor("ver.issuer_id")}, 'issuedAt', ver.issued_at)) END)),
  CASE WHEN h.state = 'cleared' THEN json_object('clearedAt', h.cleared_at) ELSE '{}' END) AS value
  FROM safety_holds h LEFT JOIN safety_versions ver ON ver.id = h.version_id WHERE ${applicableHolds(assignment)} ORDER BY h.id`);

// Compare both device times to receipt time, not the shift start or the age
// of the submission: a delayed offline capture can still be valid.
const attendanceClockSkewMs = 2 * 60_000;

const reviewReason = `CASE WHEN EXISTS (SELECT 1 FROM attendance_events e WHERE e.assignment_id = x.id
  AND e.kind = x.kind AND ${currentAccepted("e")}) THEN 'duplicate_event'
  WHEN max(x.actual_at, x.captured_at) > ${at} + ${attendanceClockSkewMs} THEN 'out_of_window'
  WHEN x.kind = 'arrival' AND x.actual_at NOT BETWEEN
    x.starts_at - ${ATTENDANCE_REVIEW_POLICY.arrivalBeforeStartMs} AND x.starts_at + ${ATTENDANCE_REVIEW_POLICY.arrivalAfterStartMs}
    THEN 'out_of_window'
  WHEN x.kind = 'departure' AND x.actual_at > x.ends_at + ${ATTENDANCE_REVIEW_POLICY.departureAfterEndMs}
    THEN 'out_of_window' END`;

function captureAccess(access: SessionAccess, capture: Capture): SessionAccess {
  return { sql: `${access.sql}, tap(event_id, kind, source, actual_at, captured_at) AS (VALUES (?, ?, ?, ?, ?)),
    capture_scope AS MATERIALIZED (
      SELECT f.*, tap.*, (SELECT e.actual_at ${acceptedEvent("f.id", "arrival")}) AS arrival_at,
        (SELECT e.id FROM attendance_events e WHERE e.assignment_id = f.id AND e.kind = tap.kind AND e.source = tap.source
          AND e.actor_id = f.actor_id AND e.actual_at = tap.actual_at AND (
            (e.id = tap.event_id AND e.captured_at = tap.captured_at) OR (e.id <> tap.event_id AND ${currentAccepted("e")}
              AND NOT EXISTS (SELECT 1 FROM attendance_events clash WHERE clash.id = tap.event_id)))
          ORDER BY e.id = tap.event_id DESC LIMIT 1) AS existing_id
      FROM field_actor f CROSS JOIN tap)
    `, params: [...access.params, capture.id, capture.kind, capture.source, capture.actualAt, capture.capturedAt] };
}

function withTopics(plan: CommandInput<OperationResult>, customerIndex: number | null, mutationIndex = 1): CommandInput<OperationResult> {
  return { statements: plan.statements, decode(rows) {
    const result = plan.decode(rows);
    if (result.outcome.status !== "committed") return result;
    const written = rows[mutationIndex]?.results[0] as { job_id: string } | undefined;
    const update = customerIndex === null ? undefined : rows[customerIndex]?.results[0] as { visit_id: string } | undefined;
    return { ...result, topics: [
      ...(written ? [{ kind: "provider-job", opaqueId: written.job_id } as const] : []),
      ...(update ? [{ kind: "customer-visit", opaqueId: update.visit_id } as const] : []),
    ] };
  } };
}

async function planAttendance(ctx: Clock, session: SessionAccess, assignmentId: string, operationId: OperationId, capture: Capture) {
  const access = captureAccess(assignmentAccess(session, ctx.now, assignmentId, capture.source === "assisted" ? "assistant" : "worker"), capture);
  const publishes = capture.kind === "arrival";
  const plan = await planOperation(ctx, {
    access, authorize, operationId, command: "attendance", input: { assignmentId, ...capture }, resultRef: capture.id,
    unchanged: { sql: "EXISTS (SELECT 1 FROM capture_scope WHERE existing_id IS NOT NULL)" },
    eligible: { sql: `EXISTS (SELECT 1 FROM capture_scope x WHERE x.existing_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM attendance_events e WHERE e.id = x.event_id)
      AND (x.kind = 'arrival' OR x.actual_at >= x.arrival_at))` },
    writes: (guard) => ({
      statements: [scopedStatement(access, `, classified AS MATERIALIZED (SELECT x.*, ${reviewReason} AS reason FROM capture_scope x)
        INSERT INTO attendance_events (id, assignment_id, actor_id, kind, source, actual_at, captured_at, received_at, review_state, reason_code)
        SELECT event_id, id, actor_id, kind, source, actual_at, captured_at, ${at},
          CASE WHEN reason IS NULL THEN 'accepted' ELSE 'needs_review' END, reason FROM classified WHERE ${guard.sql}
        RETURNING (SELECT job_id FROM field_actor) AS job_id`, ...guard.params ?? []),
      ...(publishes ? [scopedStatement(access, `INSERT INTO customer_updates (id, visit_id, kind, occurred_at, recorded_at)
        SELECT ?, f.visit_id, 'on_site', e.actual_at, e.received_at FROM field_actor f
        JOIN attendance_events e ON e.id = ? AND e.assignment_id = f.id AND e.review_state = 'accepted'
        WHERE f.visit_state = 'booked' AND NOT EXISTS (SELECT 1 FROM customer_updates u WHERE u.visit_id = f.visit_id AND u.kind = 'on_site')
          AND ${guard.sql} RETURNING visit_id`, crypto.randomUUID(), capture.id, ...guard.params ?? [])] : [])],
      changes: shiftChanges(access),
    }),
  });
  // Worst case: six statements per attendance operation, leaving one feed statement at eight ops.
  return { plan: withTopics(plan, publishes ? 2 : null), access };
}

export const attendanceSyncOperation = syncOperation("attendance", async ({ access, now }, { operationId, payload }) => {
  const { assignmentId, ...capture } = payload;
  const { plan } = await planAttendance({ now }, access, assignmentId, operationId, { ...capture, source: "self" });
  return plan;
});

function withValue(plan: CommandInput<OperationResult>, select: CommandStatement): CommandInput<FieldCommand> {
  return { statements: [...plan.statements, select], decode(rows) {
    const operation = plan.decode(rows);
    const row = rows[plan.statements.length]?.results[0] as { value: string | null } | undefined;
    return { operation, value: operation.outcome.status === "rejected" ? null : row?.value ?? null };
  } };
}

export async function recordAttendance(ctx: Clock, session: SessionAccess, { params, body }: Input<typeof recordAttendanceRoute>) {
  const { plan, access } = await planAttendance(ctx, session, params.id, body.operationId, body.payload);
  return withValue(plan, scopedStatement(access, `SELECT json_object('event', ${attendanceEventValue("e")},
    'holds', json(${holdsValue("x.id")})) AS value FROM capture_scope x
    JOIN attendance_events e ON e.id = coalesce(x.existing_id, x.event_id) AND e.assignment_id = x.id`));
}

export async function departAssignment(ctx: Clock, session: SessionAccess, { params, body }: Input<typeof departAssignmentRoute>) {
  const { id, band, expectedAudience } = body.payload;
  const access = assignmentAccess(session, ctx.now, params.id, "worker");
  const publicEstimate = expectedAudience === "crew_and_customer";
  const updateId = publicEstimate ? crypto.randomUUID() : null;
  const eligible: OperationSpec["eligible"] = { sql: `EXISTS (SELECT 1 FROM field_actor f WHERE f.state = 'confirmed'
    AND f.shift_state IN ('planned', 'active') AND f.visit_state = 'booked' AND f.ends_at > ${at} AND ? > ${at}
    AND f.job_state = 'open'
    AND (${estimateAudience("f")}) = ? AND NOT EXISTS (SELECT 1 ${acceptedEvent("f.id", "arrival")})
    AND NOT EXISTS (SELECT 1 FROM visit_activity_events e WHERE e.id = ?)
    ${publicEstimate ? "AND NOT EXISTS (SELECT 1 FROM customer_updates u WHERE u.visit_id = f.visit_id AND u.kind = 'on_site')" : ""})`,
    params: [band.endsAt, expectedAudience, id] };
  const plan = await planOperation(ctx, {
    access, authorize, eligible, operationId: body.operationId, command: "assignment_depart", input: { assignmentId: params.id, ...body.payload },
    resultRef: id,
    writes: (guard) => ({
      statements: [
        // Publish only for a current lead who deliberately chose the customer audience.
        ...(publicEstimate ? [scopedStatement(access, `, prior AS (
          SELECT u.id FROM customer_updates u JOIN field_actor f ON f.visit_id = u.visit_id
          WHERE u.kind IN ('on_the_way', 'arrival_revised', 'arrival_withdrawn') ORDER BY u.recorded_at DESC, u.rowid DESC LIMIT 1
        ), correctable AS (
          SELECT u.id FROM prior JOIN customer_updates u ON u.id = prior.id WHERE u.kind <> 'arrival_withdrawn'
            AND NOT EXISTS (SELECT 1 FROM customer_updates next WHERE next.visit_id = u.visit_id AND next.corrects_id = u.id)
        ) INSERT INTO customer_updates (id, visit_id, actor_id, kind, band_start, band_end, corrects_id, recorded_at)
          SELECT ?, f.visit_id, f.actor_id, CASE WHEN prior.id IS NULL THEN 'on_the_way' ELSE 'arrival_revised' END,
            ?, ?, prior.id, ${at} FROM field_actor f LEFT JOIN correctable prior ON 1 WHERE ${guard.sql}
          RETURNING visit_id`, updateId, band.startsAt, band.endsAt, ...guard.params ?? [])] : []),
        scopedStatement(access, `INSERT INTO visit_activity_events (id, visit_id, assignment_id, actor_id, kind, at, band_start, band_end, customer_update_id)
          SELECT ?, f.visit_id, f.id, f.actor_id, 'setting_off', ${at}, ?, ?, ? FROM field_actor f WHERE ${guard.sql}
          RETURNING (SELECT job_id FROM field_actor) AS job_id`, id, band.startsAt, band.endsAt, updateId, ...guard.params ?? []),
      ], changes: shiftChanges(access),
    }),
  });
  return withValue(withTopics(plan, publicEstimate ? 1 : null, publicEstimate ? 2 : 1), scopedStatement(access,
    `SELECT ${estimateValue("e")} AS value FROM field_actor f
      JOIN visit_activity_events e ON e.assignment_id = f.id AND e.id = ? AND e.kind = 'setting_off'`, id));
}

export async function requestAttendanceCorrection(ctx: Clock, session: SessionAccess, { params, body }: Input<typeof requestAttendanceCorrectionRoute>) {
  const { id, eventId, reasonCode, proposedActualAt } = body.payload;
  const access = assignmentAccess(session, ctx.now, params.id, "either");
  const plan = await planOperation(ctx, {
    access, authorize, operationId: body.operationId, command: "attendance_request_correction", input: { assignmentId: params.id, ...body.payload },
    resultRef: id,
    eligible: { sql: `EXISTS (SELECT 1 FROM field_actor a JOIN attendance_events e ON e.assignment_id = a.id AND e.id = ?
      WHERE NOT EXISTS (SELECT 1 FROM attendance_correction_requests r WHERE r.id = ?))`, params: [eventId, id] },
    writes: (guard) => ({ statements: [scopedStatement(access, `INSERT INTO attendance_correction_requests (
      id, assignment_id, attendance_event_id, requester_id, reason_code, proposed_actual_at, requested_at, state)
      SELECT ?, f.id, ?, f.actor_id, ?, ?, ${at}, 'requested' FROM field_actor f WHERE ${guard.sql}
      RETURNING (SELECT job_id FROM field_actor) AS job_id`, id, eventId, reasonCode, proposedActualAt ?? null, ...guard.params ?? [])],
      changes: shiftChanges(access),
    }),
  });
  return withValue(withTopics(plan, null), scopedStatement(access, `SELECT ${correctionValue("r")} AS value FROM field_actor f
    JOIN attendance_correction_requests r ON r.assignment_id = f.id AND r.id = ?`, id));
}

const photoMimes = mediaFileSchema.options[0].shape.mime.options.map((mime) => `'${mime}'`).join(", ");
export const readyPhotoSql = (media: string) => `${media}.state = 'ready' AND ${media}.mime IN (${photoMimes})
  AND ${media}.bytes <= ${mediaLimits.photoBytes} AND (${media}.delete_after IS NULL OR ${media}.delete_after > ${at})`;

async function planProgress(ctx: Clock, session: SessionAccess, assignmentId: string,
  operationId: OperationId, photos: readonly SyncProgressPhoto[], delivery: "atomic" | "partial") {
  const scoped = assignmentAccess(session, ctx.now, assignmentId, "worker");
  const access: SessionAccess = { sql: `${scoped.sql}, photo_input AS MATERIALIZED (
    SELECT key AS position, value ->> 'activityId' AS id, value ->> 'attachmentId' AS attachment_id,
      value ->> 'capturedAt' AS captured_at, value ->> '$.caption.text' AS caption, value ->> '$.caption.language' AS language
    FROM json_each(?)
  ), progress_assignee AS MATERIALIZED (SELECT * FROM field_actor WHERE state = 'confirmed')`,
  params: [...scoped.params, JSON.stringify(photos)] };
  const authorize = { sql: "EXISTS (SELECT 1 FROM progress_assignee)" };
  const existing = `SELECT x.id, x.position, x.attachment_id, e.at AS received_at
    FROM progress_assignee f CROSS JOIN photo_input x
    JOIN visit_activity_events e ON e.id = x.id AND e.assignment_id = f.id AND e.visit_id = f.visit_id
      AND e.actor_id = f.actor_id AND e.kind = 'progress_photo' AND e.captured_at = x.captured_at
      AND e.safe_detail IS x.caption AND e.detail_language IS x.language
    JOIN shift_evidence link ON link.activity_event_id = e.id AND link.shift_id = f.shift_id AND link.attachment_id = x.attachment_id`;
  const eligible = `f.job_state = 'open' AND EXISTS (
    SELECT 1 FROM memberships manager JOIN accounts actor ON actor.id = manager.account_id AND actor.state = 'active'
    JOIN membership_roles role ON role.membership_id = manager.id AND role.role = 'foreman'
    WHERE manager.id = f.foreman_id AND manager.state = 'active' AND role.revoked_at IS NULL AND role.granted_at <= ${at})
    AND NOT EXISTS (SELECT 1 FROM safety_holds h WHERE ${applicableHolds("f.id")} AND h.state = 'active')
    AND NOT EXISTS (SELECT 1 FROM safety_versions ver WHERE ver.id = (${latestBriefing("f.id")}) AND NOT EXISTS (
      SELECT 1 FROM safety_acknowledgements ack WHERE ack.version_id = ver.id AND ack.assignment_id = f.id AND ack.at <= ${at}))`;
  const candidates = `SELECT x.id FROM progress_assignee f CROSS JOIN photo_input x
      JOIN attachments media ON media.id = x.attachment_id
      JOIN media_stages stage ON stage.id = media.stage_id AND stage.context_id = f.context_id
        AND stage.caller = 'progress' AND stage.parent_scope_id = f.id
      WHERE (${eligible}) AND (
        stage.created_at <= ${at} AND stage.expires_at > ${at} AND ${readyPhotoSql("media")}
        AND NOT EXISTS (SELECT 1 FROM job_handoffs h WHERE h.job_id = f.job_id AND h.state = 'accepted' AND h.ended_at >= stage.created_at)
        AND NOT EXISTS (SELECT 1 FROM shift_evidence used WHERE used.shift_id = f.shift_id AND used.attachment_id = x.attachment_id)
        AND NOT EXISTS (SELECT 1 FROM visit_activity_events e WHERE e.id = x.id)
        AND x.captured_at <= ${at}
        AND EXISTS (SELECT 1 ${acceptedEvent("f.id", "arrival")} AND e.actual_at <= x.captured_at)
        AND NOT EXISTS (SELECT 1 ${acceptedEvent("f.id", "departure")} AND e.actual_at < x.captured_at)
        AND (SELECT e.kind FROM visit_activity_events e WHERE e.visit_id = f.visit_id AND e.at <= x.captured_at
          AND e.kind IN ('work_started', 'work_paused', 'work_finished') ORDER BY e.at DESC, e.rowid DESC LIMIT 1) = 'work_started')
      ORDER BY x.position LIMIT coalesce((SELECT max(0, 6 - (SELECT count(*) FROM shift_evidence link WHERE link.shift_id = f.shift_id))
        FROM progress_assignee f), 0)`;
  const plan = await planOperation(ctx, {
    access, authorize, operationId, command: "assignment_progress", input: { assignmentId, photos },
    resultRef: operationId, unchanged: { sql: `(SELECT count(*) FROM (${existing})) = (SELECT count(*) FROM photo_input)` },
    selectWrites: { sql: delivery === "partial" ? candidates : `WITH candidates AS MATERIALIZED (${candidates})
      SELECT id FROM candidates WHERE (SELECT count(*) FROM candidates) + (SELECT count(*) FROM (${existing})) = (SELECT count(*) FROM photo_input)` },
    ineligible: { code: "VALIDATION_FAILED" },
    writes: (_guard, selected) => {
      const accepted = `, accepted_photos AS MATERIALIZED (SELECT x.* FROM photo_input x JOIN (${selected.sql}) picked ON picked.id = x.id)`;
      return { statements: [
        scopedStatement(access, `${accepted} INSERT INTO visit_activity_events (
          id, visit_id, assignment_id, actor_id, kind, at, captured_at, safe_detail, detail_language)
          SELECT x.id, f.visit_id, f.id, f.actor_id, 'progress_photo', ${at}, x.captured_at, x.caption, x.language
          FROM accepted_photos x CROSS JOIN progress_assignee f
          RETURNING id, (SELECT job_id FROM progress_assignee) AS job_id`, ...selected.params ?? []),
        scopedStatement(access, `${accepted} INSERT INTO shift_evidence (shift_id, attachment_id, activity_event_id)
          SELECT f.shift_id, x.attachment_id, x.id FROM accepted_photos x CROSS JOIN progress_assignee f`, ...selected.params ?? []),
        scopedStatement(access, `${accepted} UPDATE attachments SET retention_class = 'progress', delete_after = NULL
          WHERE id IN (SELECT attachment_id FROM accepted_photos) AND (retention_class <> 'progress' OR delete_after IS NOT NULL)`,
        ...selected.params ?? []),
      ] };
    },
  });
  return { plan: withTopics(plan, null), access, existing };
}

export async function recordAssignmentProgress(ctx: Clock, session: SessionAccess, { params, body }: Input<typeof recordAssignmentProgressRoute>) {
  const photos = body.payload.photos.map(({ id, ...photo }) => ({ activityId: id, ...photo }));
  const { plan, access, existing } = await planProgress(ctx, session, params.id, body.operationId, photos, "atomic");
  return withValue(plan, scopedStatement(access, `SELECT json_object('assignmentId', f.id, 'receipts', json(${jsonArray(`
    SELECT json_object('id', e.id, 'attachmentId', e.attachment_id, 'receivedAt', e.received_at) AS value
    FROM (${existing}) e ORDER BY e.position`)})) AS value FROM progress_assignee f`));
}

export const progressAttachmentSyncOperation = syncOperation("attachment_link", async ({ access: session, now }, { operationId, payload }) => {
  const { assignmentId, photos } = payload;
  const { plan, access, existing } = await planProgress({ now }, session, assignmentId, operationId, photos, "partial");
  const resultIndex = plan.statements.length;
  return { statements: [...plan.statements, scopedStatement(access, existing)], decode(rows) {
    const result = plan.decode(rows);
    const outcome = result.outcome;
    const error: ErrorBody = outcome.status === "rejected" ? outcome.error : { code: "VALIDATION_FAILED" };
    const canRead = outcome.status !== "rejected" || outcome.error.code === "VALIDATION_FAILED";
    const receipts = (rows[resultIndex]?.results ?? []) as { id: string; received_at: number }[];
    const written = new Set(((rows[1]?.results ?? []) as { id: string }[]).map(({ id }) => id));
    const saved = new Map(canRead ? receipts.map(({ id, received_at }) => [id, received_at] as const) : []);
    const photoOutcomes: ProgressPhotoOutcome[] = photos.map(({ activityId }) => {
      const receivedAt = saved.get(activityId);
      return receivedAt === undefined ? { activityId, status: "rejected", error }
        : { activityId, status: written.has(activityId) ? "committed" : "replayed", receivedAt };
    });
    return { ...result, outcome: { ...outcome, photoOutcomes } };
  } };
});

const canViewShift = (scope: string) => `${namedWorker(scope)} AND a.state = 'confirmed' AND a.confirmed_at <= ${at}
  AND sh.state <> 'cancelled' AND v.state IN ('booked', 'finished') AND j.state <> 'cancelled' AND p.state = 'in_area'`;
const bookedWindow = `JOIN visit_windows booked ON booked.visit_id = v.id AND booked.state = 'confirmed'
  AND booked.confirmed_at <= ${at} AND booked.starts_at <= a.starts_at AND booked.ends_at >= a.ends_at`;
const pendingReview = `SELECT e.id FROM attendance_events e WHERE e.assignment_id = a.id AND e.review_state = 'needs_review'
  AND NOT EXISTS (SELECT 1 FROM attendance_events successor WHERE successor.corrects_id = e.id AND successor.review_state = 'accepted')`;
const hasPendingReview = `EXISTS (${pendingReview})
  OR EXISTS (SELECT 1 FROM attendance_correction_requests r WHERE r.assignment_id = a.id AND r.state = 'requested')`;

function shiftRows(scope: string, filter: string, cached: boolean, from = "assignments a"): string {
  const travel = `SELECT ${estimateValue("e")} FROM visit_activity_events e WHERE e.assignment_id = a.id
    AND e.kind = 'setting_off' AND e.at <= ${at} ORDER BY e.at DESC, e.rowid DESC LIMIT 1`;
  const title = "nullif(j.trade, '')";
  const crewThread = cached ? "NULL" : `(SELECT t.id FROM chat_threads t JOIN chat_members cm ON cm.thread_id = t.id
    WHERE t.job_id = j.id AND t.audience = 'crew' AND cm.context_id = ${scope}.context_id AND cm.revoked_at IS NULL
      AND sh.state IN ('planned', 'active') AND v.state = 'booked' AND j.state = 'open')`;
  return `SELECT a.id AS resource_id, json_object('id', a.id, 'shiftId', sh.id, 'visitId', v.id,
    'job', json_object('id', j.id, 'reference', j.reference, 'title', ${title}${cached ? "" : `, 'placeAlias',
      CASE WHEN v.state = 'booked' AND j.state = 'open' THEN p.alias END`}),
    'siteZone', ${placeZone}, 'bookedWindow', json_object('id', booked.id, 'startsAt', booked.starts_at, 'endsAt', booked.ends_at),
    'task', coalesce(${title}, sh.skill), 'state', a.state, 'isLead', ${bool("slot.is_lead = 1")},
    'foremanName', coalesce(${namedActor("manager.account_id")}, ${namedActor("a.confirmed_by")}), 'crewThreadId', ${crewThread},
    'estimate', json((${travel})), 'attendance', json_object(
      'arrival', json((SELECT ${attendanceEventValue("e")} ${acceptedEvent("a.id", "arrival")})),
      'departure', json((SELECT ${attendanceEventValue("e")} ${acceptedEvent("a.id", "departure")})),
      'hasPendingReview', ${bool(hasPendingReview)}, 'pendingReviewEventIds', json((SELECT json_group_array(id)
        FROM (${pendingReview} ORDER BY e.id)))), 'holds', json(${holdsValue("a.id")}),
    'work', json((SELECT ${workValue("e")} FROM visit_activity_events e WHERE e.visit_id = v.id AND e.at <= ${at}
      AND e.kind IN ('work_started', 'work_paused', 'work_finished') ORDER BY e.at DESC, e.rowid DESC LIMIT 1)),
    'nextAction', CASE WHEN j.state <> 'open' THEN NULL
      WHEN EXISTS (SELECT 1 ${acceptedEvent("a.id", "departure")}) THEN NULL
      WHEN EXISTS (SELECT 1 ${acceptedEvent("a.id", "arrival")}) THEN CASE
        WHEN EXISTS (SELECT 1 FROM safety_holds h WHERE ${applicableHolds("a.id")} AND h.state = 'active') THEN 'view_briefing'
        ELSE 'check_out' END
      WHEN v.state <> 'booked' THEN NULL
      WHEN a.starts_at <= ${at} OR EXISTS (SELECT 1 FROM visit_activity_events e WHERE e.assignment_id = a.id AND e.kind = 'setting_off')
        OR (slot.is_lead = 1 AND EXISTS (SELECT 1 FROM customer_updates u WHERE u.visit_id = v.id AND u.kind = 'on_site')) THEN 'check_in'
      ELSE 'depart' END) AS value
  FROM ${from} ${assignmentJoins} ${bookedWindow}
  JOIN businesses b ON b.id = j.business_id JOIN operating_areas area ON area.id = b.catchment_id
  LEFT JOIN memberships manager ON manager.id = j.accountable_foreman_membership_id WHERE (${filter}) AND ${canViewShift(scope)}`;
}

// Shared by W-04 and W-09; access and the assignment relationship are checked in this statement.
export const workerFieldShiftValue = (assignment: string, scope: string) =>
  `(SELECT f.value FROM (${shiftRows(scope, `a.id = ${assignment}`, false)}) f)`;

export function readWorkerFieldShift(session: SessionAccess, now: number, assignment: string): CommandStatement {
  return scopedStatement(accessClock(session, now), `SELECT (SELECT ${workerFieldShiftValue("?", "scope")} FROM live_scope scope) AS value
    FROM acting_session`, assignment);
}

export const workerFieldShiftSyncProjection: SyncProjectionReader = {
  kind: workerFieldShiftKind,
  schema: cachedWorkerFieldShiftSchema,
  snapshotIds: (now) => ({ sql: `WITH clock(at) AS (VALUES (?))
    SELECT a.id AS resource_id FROM snapshot_scope scope CROSS JOIN assignments a ON a.id > scope.after_id
    ${assignmentJoins} ${bookedWindow} WHERE ${canViewShift("scope")}`, params: [now] }),
  project: (now) => ({ sql: `WITH clock(at) AS (VALUES (?))
    ${shiftRows("scope", `k.kind = '${workerFieldShiftKind}'`, true,
      "projection_keys k JOIN assignments a ON a.id = k.resource_id CROSS JOIN live_scope scope")}`, params: [now] }),
};
