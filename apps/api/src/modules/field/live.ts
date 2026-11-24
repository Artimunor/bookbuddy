import type { RouteResponse, finishVisitWorkRoute, publishVisitUpdateRoute, startVisitWorkRoute } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";
import type { OperationWrites } from "../../db/operations";
import type { RequestScope } from "../../db/scope";
import { accessClock, at, displayName, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { currentMembership } from "../jobs/projections";
import { createLinkTarget, linkTokenFor } from "../links";
import { mediaLinkAvailable } from "../media/deadlines";
import { placeCapability } from "../places/policy";
import { confirmedWindow, currentNoCrewStamp, customer, foreman, jobOpen, optedInCustomerZone, publishedCustomerUpdate } from "../schedule/policy";
import { coverAllowsShortage } from "../staffing/cover";
import { readyPhotoSql, workerFieldChangeRows } from "./attendance";
import {
  activeHold, attendanceSql, briefingReceiptSql, currentSafetyVersion, effectiveAttendance, estimateSql, fieldJobs, fieldPosition,
  fieldReceipt, headingSql, holdsSql, instructionSql, jsonRows, pageSize, pageSql, visitAssignments, windowSql, workRows, workStampSql,
} from "./safety";

const visitFrom = `FROM visits v JOIN (${fieldJobs}) j ON j.id = v.job_id ${confirmedWindow("v")}`;
const visitReadable = "booked.id IS NOT NULL AND v.state IN ('booked', 'finished') AND j.state <> 'cancelled' AND j.place_state <> 'restricted'";
const liveCustomer = `(${customer("scope")} AND (j.owner_id = scope.account_id
  OR ${placeCapability("j.place_id", "scope.account_id", "view")}))`;
const assignedCrew = `sh.visit_id = v.id AND member.business_id = j.business_id AND a.confirmed_at <= ${at}`;
const roster = `${assignedCrew} AND a.state = 'confirmed' AND sh.state IN ('planned', 'active')`;
const leadAssignment = (scope: string) => `(SELECT a.id ${visitAssignments} WHERE ${roster}
  AND slot.is_lead = 1 AND ${scope}.role = 'worker' AND ${scope}.business_id = j.business_id
  AND member.id = ${currentMembership(scope, at)} AND worker.id = ${scope}.account_id
  ORDER BY a.ends_at <= ${at}, a.starts_at, a.id LIMIT 1)`;
const onSite = `EXISTS (SELECT 1 ${visitAssignments} WHERE ${roster} AND member.state = 'active' AND worker.state = 'active'
  AND EXISTS (SELECT 1 FROM attendance_events arrival WHERE arrival.assignment_id = a.id AND arrival.kind = 'arrival'
    AND arrival.actual_at <= ${at} AND ${effectiveAttendance("arrival")})
  AND NOT EXISTS (SELECT 1 FROM attendance_events departure WHERE departure.assignment_id = a.id AND departure.kind = 'departure'
    AND departure.actual_at <= ${at} AND ${effectiveAttendance("departure")}))`;
const blockedAssignments = `SELECT assignment.id FROM (SELECT a.id, ${currentSafetyVersion("a.id")} AS version_id
  ${visitAssignments} WHERE ${roster}) assignment WHERE ${activeHold("assignment.id", "assignment.version_id")}
  OR (assignment.version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM safety_acknowledgements ack
    WHERE ack.version_id = assignment.version_id AND ack.assignment_id = assignment.id AND ack.at <= ${at}))`;

export function customerStampSql(stamp: string, providerName: string): string {
  const base = `json_object('id', ${stamp}.id, 'kind', ${stamp}.kind, 'recordedAt', ${stamp}.recorded_at)`;
  const band = `json_object('startsAt', ${stamp}.band_start, 'endsAt', ${stamp}.band_end)`;
  return `CASE WHEN ${stamp}.kind = 'on_site'
    THEN json_set(${base}, '$.occurredAt', ${stamp}.occurred_at)
    ELSE (WITH stamp_base AS (SELECT json_set(${base}, '$.sharedByName', coalesce((
      SELECT nullif(trim(actor.display_name), '') FROM accounts actor WHERE actor.id = ${stamp}.actor_id), ${providerName})) AS value)
      SELECT CASE ${stamp}.kind
        WHEN 'on_the_way' THEN json_set(value, '$.band', json(${band}))
        WHEN 'arrival_revised' THEN json_set(value, '$.band', json(${band}), '$.correctsId', ${stamp}.corrects_id)
        WHEN 'arrival_withdrawn' THEN json_set(value, '$.correctsId', ${stamp}.corrects_id)
        WHEN 'paused' THEN json_set(value, '$.nextUpdateAt', ${stamp}.next_update_at)
        WHEN 'cover_arranging' THEN json_set(value, '$.nextUpdateAt', ${stamp}.next_update_at)
        WHEN 'photo' THEN (SELECT json_set(stamp_base.value, '$.photo',
          json_object('attachmentId', media.id, 'availability', CASE WHEN ${readyPhotoSql("media")}
            AND ${mediaLinkAvailable(`(SELECT job_id FROM visits WHERE id = ${stamp}.visit_id)`, "media.id", "ordinary")}
            THEN 'available' ELSE 'unavailable' END),
          '$.caption', json(CASE WHEN ${stamp}.caption IS NOT NULL THEN json_object('original',
            json_object('language', ${stamp}.caption_language, 'text', ${stamp}.caption), 'reading', NULL) END))
          FROM update_attachments linked JOIN attachments media ON media.id = linked.attachment_id
          WHERE linked.update_id = ${stamp}.id ORDER BY media.id LIMIT 1)
        ELSE value END FROM stamp_base) END`;
}
const travelKinds = "'on_the_way', 'arrival_revised', 'arrival_withdrawn', 'cover_arranging', 'no_crew_available'";
const latestStamp = (kinds: string) => `(SELECT cu.id FROM customer_updates cu WHERE cu.visit_id = v.id AND cu.kind IN (${kinds})
  AND (cu.booked_window_id IS NULL OR cu.booked_window_id = booked.id)
  AND ${publishedCustomerUpdate("cu")} ORDER BY cu.recorded_at DESC, cu.rowid DESC LIMIT 1)`;
const beforeOnSite = `NOT EXISTS (SELECT 1 FROM customer_updates cu WHERE cu.visit_id = v.id
  AND cu.kind IN ('on_site', 'working', 'finished') AND cu.recorded_at <= ${at}) AND NOT (${onSite})`;
const travelCurrent = (idSql: string) => `EXISTS (SELECT 1 FROM customer_updates prior
  WHERE prior.id = ${latestStamp(travelKinds)} AND prior.id = ${idSql} AND prior.kind IN ('on_the_way', 'arrival_revised')
  AND NOT EXISTS (SELECT 1 FROM customer_updates successor WHERE successor.visit_id = v.id AND successor.corrects_id = prior.id))`;
const mayShareNewEstimate = `NOT EXISTS (SELECT 1 FROM customer_updates cu WHERE cu.id = ${latestStamp(travelKinds)}
  AND cu.kind IN ('on_the_way', 'arrival_revised'))`;

const confirmedNames = `(SELECT json_group_array(name) FROM (SELECT DISTINCT worker.id, trim(worker.display_name) AS name
  ${visitAssignments} WHERE ${assignedCrew} AND sh.state <> 'cancelled' AND member.state = 'active' AND worker.state = 'active'
  AND (a.state = 'confirmed' OR (v.state = 'finished' AND a.state = 'completed')) AND nullif(trim(worker.display_name), '') IS NOT NULL
  ORDER BY name COLLATE NOCASE, name))`;

// Only published facts feed the customer capsule. Expiry quiets an estimate; it never suggests a check-in.
const customerSummary = `(WITH stamps AS MATERIALIZED (
  SELECT ${latestStamp("'on_site', 'working', 'finished'")} AS step_id,
    ${latestStamp(travelKinds)} AS arrival_id,
    ${latestStamp("'crew_confirmed', 'crew_updated', 'cover_arranging'")} AS crew_id,
    ${latestStamp("'on_site', 'working', 'paused', 'finished', 'cover_arranging'")} AS status_id,
    ${currentNoCrewStamp("v.id", "booked")} AS shortage_id
), basis AS (
  SELECT CASE WHEN stamps.shortage_id IS NOT NULL THEN NULL WHEN step.kind IS NOT NULL THEN step.kind
      WHEN arrival.kind IN ('on_the_way', 'arrival_revised') AND arrival.band_end > ${at} THEN 'on_the_way'
      WHEN crew.kind IN ('crew_confirmed', 'crew_updated') THEN 'confirmed' END AS step,
    CASE WHEN stamps.shortage_id IS NOT NULL THEN 'no_crew_available' WHEN status.kind = 'paused' THEN 'paused' WHEN step.kind = 'finished' THEN 'finished'
      WHEN crew.kind = 'cover_arranging' AND (step.id IS NULL OR (crew.recorded_at, crew.rowid) > (step.recorded_at, step.rowid))
        AND (arrival.kind NOT IN ('on_the_way', 'arrival_revised') OR arrival.band_end <= ${at}) THEN 'cover_arranging'
      WHEN step.kind IS NOT NULL THEN step.kind
      WHEN arrival.kind IN ('on_the_way', 'arrival_revised') THEN CASE WHEN arrival.band_end > ${at} THEN 'on_the_way' END
      WHEN crew.kind IN ('crew_confirmed', 'crew_updated') THEN 'confirmed' END AS status,
    CASE WHEN step.id IS NULL AND arrival.kind IN ('on_the_way', 'arrival_revised') AND arrival.band_end > ${at}
      THEN ${customerStampSql("arrival", "j.provider_name")} END AS arrival,
    CASE WHEN stamps.shortage_id IS NOT NULL THEN stamps.shortage_id WHEN status.kind = 'paused' THEN status.id WHEN step.kind = 'finished' THEN step.id
      WHEN crew.kind = 'cover_arranging' AND (step.id IS NULL OR (crew.recorded_at, crew.rowid) > (step.recorded_at, step.rowid))
        AND (arrival.kind NOT IN ('on_the_way', 'arrival_revised') OR arrival.band_end <= ${at}) THEN crew.id
      ELSE coalesce(step.id, CASE WHEN arrival.kind <> 'no_crew_available' THEN arrival.id END, crew.id) END AS source_id
  FROM stamps LEFT JOIN customer_updates step ON step.id = stamps.step_id LEFT JOIN customer_updates arrival ON arrival.id = stamps.arrival_id
  LEFT JOIN customer_updates crew ON crew.id = stamps.crew_id LEFT JOIN customer_updates status ON status.id = stamps.status_id
)
SELECT json_object('window', json(${windowSql("booked")}), 'confirmedCrewNames', json(${confirmedNames}), 'live',
  json_object('step', basis.step, 'status', basis.status, 'since', coalesce(source.occurred_at, source.recorded_at),
    'source', json(CASE WHEN source.id IS NOT NULL THEN json_object('at', coalesce(source.occurred_at, source.recorded_at),
      'sharedByName', CASE WHEN source.kind <> 'on_site' THEN coalesce(nullif(trim(actor.display_name), ''), j.provider_name) END) END),
    'arrival', json(basis.arrival), 'nextUpdateAt', source.next_update_at))
FROM basis LEFT JOIN customer_updates source ON source.id = basis.source_id LEFT JOIN accounts actor ON actor.id = source.actor_id)`;

function customerVisitSql(cursorAt: string, cursorId: string): string {
  return `(WITH visit_page AS MATERIALIZED (
    SELECT cu.id, cu.recorded_at AS at, ${customerStampSql("cu", "j.provider_name")} AS value FROM customer_updates cu
    WHERE cu.visit_id = v.id AND ${publishedCustomerUpdate("cu")} AND (cu.kind <> 'photo' OR EXISTS (
      SELECT 1 FROM update_attachments linked WHERE linked.update_id = cu.id))
      AND (${cursorAt} IS NULL OR (cu.recorded_at, cu.id) < (${cursorAt}, ${cursorId}))
    ORDER BY cu.recorded_at DESC, cu.id DESC LIMIT ${pageSize + 1}
  ) SELECT json_set(${customerSummary}, '$.visitId', v.id, '$.job', json(${headingSql("j")}),
    '$.siteZone', j.site_zone, '$.providerName', j.provider_name, '$.foremanName', j.foreman_name,
    '$.jobThreadId', (SELECT thread.id FROM chat_threads thread JOIN chat_members cm ON cm.thread_id = thread.id
      WHERE thread.job_id = j.id AND thread.audience = 'job' AND cm.context_id = scope.context_id AND cm.revoked_at IS NULL),
    '$.completionId', (SELECT c.id FROM completions c WHERE c.job_id = j.id AND c.state IN ('submitted', 'signed_off')
      AND c.submitted_at <= ${at} ORDER BY c.no DESC LIMIT 1),
    '$.moments', json(${jsonRows(`SELECT value FROM visit_page ORDER BY at DESC, id DESC LIMIT ${pageSize}`)}),
    '$.page', json(${pageSql("visit_page")})))`;
}

const crewControl = jsonRows(`SELECT json_object('assignmentId', crew.id, 'workerName', crew.name, 'state', crew.state,
  'estimate', json(${estimateSql("crew.id", "j.foreman_name")}), 'attendance', json(${attendanceSql("crew.id")}),
  'holds', json(${holdsSql("crew.id", "crew.version_id")}), 'instruction', json(${instructionSql("crew.version_id")}),
  'briefingReceipt', json(${briefingReceiptSql("crew.version_id", "crew.id")})) AS value FROM (
    SELECT a.id, ${displayName("worker")} AS name, a.state, ${currentSafetyVersion("a.id")} AS version_id
    ${visitAssignments} WHERE ${assignedCrew} AND a.state IN ('confirmed', 'completed') AND sh.state <> 'cancelled'
    ORDER BY sh.starts_at, slot.number, a.id) crew`);

function visitControlProjection(includeCustomerZone: boolean) {
  return `(WITH work AS MATERIALIZED (${workRows("v.id")}), blocked AS MATERIALIZED (${blockedAssignments})
  SELECT json_object('visitId', v.id, 'revision', v.revision, 'job', json(${headingSql("j")}), 'siteZone', j.site_zone,
    ${includeCustomerZone ? `'customerZone', ${optedInCustomerZone},` : ""}
    'customerName', j.customer_name, 'window', json(${windowSql("booked")}), 'customerPreview', json(${customerSummary}),
    'work', json((SELECT ${workStampSql("work")} FROM work)), 'crew', json(${crewControl}),
    'workGate', json(CASE WHEN v.state = 'finished' THEN json_object('status', 'finished')
      WHEN NOT ${jobOpen()} THEN json_object('status', 'not_authorized')
      WHEN EXISTS (SELECT 1 FROM blocked) THEN json_object('status', 'held', 'blockedAssignments',
        json((SELECT json_group_array(id) FROM (SELECT id FROM blocked ORDER BY id))))
      WHEN NOT (${onSite}) THEN json_object('status', 'not_on_site') ELSE json_object('status', 'ready') END),
    'permittedUpdates', json((SELECT json_group_array(kind) FROM (
      SELECT 'on_the_way' AS kind WHERE ${beforeOnSite} AND ${mayShareNewEstimate}
      UNION ALL SELECT 'arrival_revised' WHERE ${beforeOnSite} AND ${travelCurrent(latestStamp(travelKinds))}
      UNION ALL SELECT 'arrival_withdrawn' WHERE ${beforeOnSite} AND ${travelCurrent(latestStamp(travelKinds))}
      UNION ALL SELECT 'paused' WHERE (SELECT kind FROM work) = 'work_started'
      UNION ALL SELECT 'photo') WHERE v.state = 'booked' AND ${jobOpen()}))))`;
}

const controlProjection = visitControlProjection(false);
const shareUpdateProjection = visitControlProjection(true);

// Reused by the foreman's online site log; neither grants access via a cast nor requests a second read.
export function foremanControlSql(visit: string, scope: string): string {
  return `(SELECT ${controlProjection} ${visitFrom} WHERE v.id = ${visit} AND ${visitReadable} AND ${foreman(scope)})`;
}

export function readVisitLive(session: SessionAccess, now: number, id: string, cursor?: string): CommandStatement | null {
  const position = fieldPosition(cursor);
  if (!position) return null;
  const access = accessClock(session, now);
  return scopedStatement(access, `, visit_input(id, before_at, before_id) AS (VALUES (?, ?, ?))
    SELECT (SELECT CASE WHEN ${liveCustomer} THEN ${customerVisitSql("input.before_at", "input.before_id")}
      WHEN ${foreman("scope")} THEN ${shareUpdateProjection} END
      ${visitFrom} CROSS JOIN live_scope scope CROSS JOIN visit_input input WHERE v.id = input.id AND ${visitReadable}) AS value
    FROM acting_session`, id, position.at, position.id);
}

const visitId = "(SELECT visit_id FROM visit_input)";
const stampId = "(SELECT stamp_id FROM visit_input)";
function visitAccess(session: SessionAccess, now: number, visit: string, stamp: string): SessionAccess {
  const access = accessClock(session, now);
  return { sql: `${access.sql}, visit_input(visit_id, stamp_id) AS (VALUES (?, ?))`, params: [...access.params, visit, stamp] };
}
const authorizeWork = { sql: `EXISTS (SELECT 1 ${visitFrom} WHERE v.id = ${visitId} AND ${visitReadable}
  AND (${foreman("scope")} OR ${leadAssignment("scope")} IS NOT NULL))` };
const authorizeForeman = { sql: `EXISTS (SELECT 1 ${visitFrom} WHERE v.id = ${visitId} AND ${visitReadable} AND ${foreman("scope")})` };
const eligibleVisit = `v.id = ${visitId} AND v.state = 'booked' AND booked.id IS NOT NULL AND ${jobOpen()} AND v.revision = ?
  AND NOT EXISTS (SELECT 1 FROM customer_updates cu WHERE cu.id = ${stampId})`;
const revisionSql = `SELECT v.revision FROM visits v WHERE v.id = ${visitId}`;
const workKind = `(SELECT kind FROM (${workRows("v.id")}))`;
const missingActivity = `NOT EXISTS (SELECT 1 FROM visit_activity_events e WHERE e.id = ${stampId})`;

const linkKind = "'visit_live'";
const day = 86_400_000;
const linkMinExpiry = `${at} + ${day / 24}`;
const linkExpiry = `max(booked.ends_at, ${at}) + ${day}`;
const eventKey = `'field_live:' || ${stampId}`;

function visitSignals(access: SessionAccess, guard: CommandStatement, visit: string, workChange: "shift" | "both" | null): OperationWrites {
  const audience: SessionAccess = { ...access, sql: `${access.sql}, live_audience AS MATERIALIZED (
    SELECT scope.context_id, v.id AS resource_id, ${linkExpiry} AS expires_at ${visitFrom}
    JOIN place_people person ON person.place_id = j.place_id
    JOIN accounts viewer ON viewer.id = person.account_id AND viewer.state = 'active'
    JOIN (SELECT id AS context_id, account_id, role, business_id FROM account_contexts WHERE role = 'customer') scope
      ON scope.account_id = viewer.id
    WHERE v.id = ${visitId} AND ${visitReadable} AND ${liveCustomer}
  )` };
  return {
    statements: [
      createLinkTarget(scopedStatement(audience, `SELECT ${linkKind} AS kind, r.resource_id, r.context_id AS required_scope, r.expires_at
        FROM live_audience r WHERE ${linkTokenFor(linkKind, "r.resource_id", "r.context_id", linkMinExpiry)} IS NULL`), guard),
      scopedStatement(audience, `INSERT INTO notifications (id, context_id, event_key, kind, link_token, created_at)
        SELECT lower(hex(randomblob(16))), r.context_id, ${eventKey}, ${linkKind},
          ${linkTokenFor(linkKind, "r.resource_id", "r.context_id", linkMinExpiry)}, ${at}
        FROM live_audience r WHERE ${guard.sql}`, ...guard.params ?? []),
    ],
    // The only persistent customer sync value is its inbox row. Live content stays online-only.
    changes: scopedStatement(access, `SELECT 'notification' AS kind, n.id AS resource_id, n.context_id AS partition_key,
      'upsert' AS op, ${at} AS at FROM notifications n WHERE n.event_key = ${eventKey}${workChange ? ` UNION ALL ${
        workerFieldChangeRows(`SELECT a.id ${visitAssignments} WHERE sh.visit_id = ${visitId}
          AND a.state = 'confirmed' AND sh.state <> 'cancelled' AND a.confirmed_at <= ${at}`, workChange)
      }` : ""}`),
    effects: scopedStatement(access, `SELECT lower(hex(randomblob(16))) AS id, 'notification_push' AS kind,
      'notification_push:' || n.id AS dedupe_key, n.id AS resource_ref, ${at} AS due_at, ${at} + ${day} AS expires_at
      FROM notifications n WHERE n.event_key = ${eventKey}`),
    topics: [{ kind: "customer-visit", opaqueId: visit }],
    topicChanges: { sql: `SELECT 'provider-job' AS kind, job_id AS opaque_id, NULL AS revoked_scope_id FROM visits WHERE id = ?`,
      params: [visit] },
  };
}

function insertCustomerStamp(access: SessionAccess, guard: CommandStatement, kind: string, band?: { startsAt: number; endsAt: number },
  nextUpdateAt: number | null = null, correctsId: string | null = null, caption?: { text: string; language: string },
  bookedWindowId: string | null = null): CommandStatement {
  return scopedStatement(access, `INSERT INTO customer_updates
    (id, visit_id, actor_id, kind, band_start, band_end, next_update_at, corrects_id, caption, caption_language, booked_window_id, recorded_at)
    SELECT ${stampId}, ${visitId}, scope.account_id, ?, ?, ?, ?, ?, ?, ?, ?, ${at} FROM live_scope scope WHERE ${guard.sql}`,
  kind, band?.startsAt ?? null, band?.endsAt ?? null, nextUpdateAt, correctsId, caption?.text ?? null, caption?.language ?? null,
  bookedWindowId, ...guard.params ?? []);
}
function insertWork(access: SessionAccess, guard: CommandStatement, kind: string): CommandStatement {
  return scopedStatement(access, `INSERT INTO visit_activity_events (id, visit_id, assignment_id, actor_id, kind, at, customer_update_id)
    SELECT ${stampId}, v.id, ${leadAssignment("scope")}, scope.account_id, ?, ${at}, ${stampId}
    ${visitFrom} CROSS JOIN live_scope scope WHERE v.id = ${visitId} AND ${guard.sql}`, kind, ...guard.params ?? []);
}

type Work = RouteResponse<typeof startVisitWorkRoute.input> | RouteResponse<typeof finishVisitWorkRoute.input>;
export function changeWork(ctx: RequestScope, session: SessionAccess, { params: { id }, body }: Work, action: "start" | "finish") {
  const { expectedRevision, payload } = body;
  const access = visitAccess(session, ctx.now, id, payload.id);
  const finish = action === "finish";
  return fieldReceipt(ctx, access, {
    operationId: body.operationId, command: `field.${action}_work`, input: [id, body], resultRef: payload.id,
    authorize: finish ? authorizeForeman : authorizeWork,
    eligible: { sql: `EXISTS (SELECT 1 ${visitFrom} WHERE ${eligibleVisit} AND booked.id = ? AND ${missingActivity} AND ${finish
      ? `${workKind} IN ('work_started', 'work_paused')`
      : `coalesce(${workKind}, 'not_started') IN ('not_started', 'work_paused') AND NOT EXISTS (${blockedAssignments}) AND (${onSite})`})`,
    params: [expectedRevision, payload.bookedWindowId] },
    writes(guard) {
      const signals = visitSignals(access, guard, id, finish ? "both" : "shift");
      return { ...signals, statements: [
        insertCustomerStamp(access, guard, finish ? "finished" : "working"),
        insertWork(access, guard, finish ? "work_finished" : "work_started"),
        scopedStatement(access, `UPDATE visits SET revision = revision + 1${finish ? ", state = 'finished'" : ""}
          WHERE id = ${visitId} AND ${guard.sql}`, ...guard.params ?? []), ...signals.statements,
      ] };
    },
  }, { sql: `SELECT json_object('visitId', v.id, 'revision', v.revision, 'work', json(${workStampSql("e")}),
    'published', json(${customerStampSql("cu", "j.provider_name")})) ${visitFrom}
    JOIN visit_activity_events e ON e.visit_id = v.id AND e.id = ${stampId} JOIN customer_updates cu ON cu.id = e.customer_update_id
    WHERE v.id = ${visitId}` }, { sql: revisionSql, expected: expectedRevision });
}

type Update = RouteResponse<typeof publishVisitUpdateRoute.input>;
export function publishUpdate(ctx: RequestScope, session: SessionAccess, { params: { id }, body }: Update) {
  const { expectedRevision, payload } = body;
  const access = visitAccess(session, ctx.now, id, payload.id);
  const photo = payload.kind === "photo" ? payload : null;
  const pause = payload.kind === "paused";
  const shortage = payload.kind === "no_crew_available" ? payload : null;
  const correctsId = "correctsId" in payload ? payload.correctsId : null;
  const band = "band" in payload ? payload.band : undefined;
  const nextUpdateAt = pause ? payload.nextUpdateAt ?? null : null;
  const photoSource = photo?.progressEventId !== undefined
    ? `stage.caller = 'progress' AND ${mediaLinkAvailable("j.id", "media.id", "progress")}
      AND EXISTS (SELECT 1 FROM shift_evidence link JOIN shifts sh ON sh.id = link.shift_id
      JOIN visit_activity_events e ON e.id = link.activity_event_id WHERE link.attachment_id = media.id AND e.id = ?
      AND e.visit_id = v.id AND sh.visit_id = v.id AND e.kind = 'progress_photo' AND e.at <= ${at})`
    : `stage.caller = 'update' AND stage.parent_scope_id = v.id AND stage.context_id = scope.context_id AND stage.expires_at > ${at}`;
  const allowed = photo ? `EXISTS (SELECT 1 FROM attachments media JOIN media_stages stage ON stage.id = media.stage_id
      WHERE media.id = ? AND ${readyPhotoSql("media")} AND stage.created_at <= ${at} AND (${photoSource}))`
    : pause ? `${workKind} = 'work_started' AND ${missingActivity}`
    : shortage ? `NOT (${onSite}) AND booked.id = ? AND ${currentNoCrewStamp("v.id", "booked")} IS NULL
      AND ${coverAllowsShortage("?", "v.id", "booked")}`
    : `${beforeOnSite} AND ${correctsId === null ? mayShareNewEstimate : travelCurrent("?")}`;
  return fieldReceipt(ctx, access, {
    operationId: body.operationId, command: "field.publish_update", input: [id, body], resultRef: payload.id,
    authorize: pause || photo || shortage ? authorizeForeman : authorizeWork,
    eligible: { sql: `EXISTS (SELECT 1 ${visitFrom} WHERE ${eligibleVisit} AND (${allowed})
      ${band ? `AND ? > ${at}` : ""}${nextUpdateAt === null ? "" : ` AND ? > ${at}`})`,
    params: [expectedRevision, ...(photo ? [photo.attachmentId, ...(photo.progressEventId ? [photo.progressEventId] : [])] : []),
      ...(shortage ? [shortage.bookedWindowId, shortage.gapId] : []),
      ...(correctsId === null ? [] : [correctsId]), ...(band ? [band.endsAt] : []), ...(nextUpdateAt === null ? [] : [nextUpdateAt])] },
    ...(photo ? { ineligible: { code: "VALIDATION_FAILED" } as const } : {}),
    writes(guard) {
      const signals = visitSignals(access, guard, id, pause ? "shift" : null);
      return { ...signals, statements: [
        insertCustomerStamp(access, guard, payload.kind, band, nextUpdateAt, correctsId, photo?.caption, shortage?.bookedWindowId),
        ...(pause ? [insertWork(access, guard, "work_paused")] : []),
        ...(photo ? [scopedStatement(access, `INSERT INTO update_attachments (update_id, attachment_id)
          SELECT ${stampId}, ? WHERE ${guard.sql}`, photo.attachmentId, ...guard.params ?? [])] : []),
        scopedStatement(access, `UPDATE visits SET revision = revision + 1 WHERE id = ${visitId} AND ${guard.sql}`, ...guard.params ?? []),
        ...signals.statements,
      ] };
    },
  }, { sql: `SELECT json_object('visitId', v.id, 'revision', v.revision, 'update', json(${customerStampSql("cu", "j.provider_name")}),
    'customerPreview', json(${customerSummary})) ${visitFrom}
    JOIN customer_updates cu ON cu.visit_id = v.id AND cu.id = ${stampId} WHERE v.id = ${visitId}` },
  { sql: revisionSql, expected: expectedRevision });
}
