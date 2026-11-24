import {
  departAssignmentRoute, getVisitLogRoute, getWorkerFieldShiftRoute, idSchema, operationIdHeader, recordAssignmentProgressRoute,
  recordAttendanceRoute, requestAttendanceCorrectionRoute,
} from "@bookbuddy/api-contract";
import type { OpOutcome, ResponseSchema, RouteResponse } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { ApiEnv } from "../../bindings";
import { commitCommand, prepareCommand } from "../../db/commit";
import type { CommandInput, CommandStatement } from "../../db/commit";
import type { OperationResult } from "../../db/operations";
import { openRequestScope } from "../../db/scope";
import { at, displayName, scopedStatement } from "../access/policy";
import { resolveSession } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { mediaLinkAvailable } from "../media/deadlines";
import { foreman, publishedCustomerUpdate, scheduleAccess, targetId } from "../schedule/policy";
import { boundedBody, scheduleOperationSignals, transportFailure, transportSuccess } from "../sync/http";
import { attendanceEventValue, correctionValue, departAssignment, estimateValue, readWorkerFieldShift, readyPhotoSql,
  recordAssignmentProgress, recordAttendance, requestAttendanceCorrection, workValue } from "./attendance";
import { customerStampSql, foremanControlSql } from "./live";

export const attendanceRoutes = new Hono<ApiEnv>();

type Definition<Input> = {
  path: string;
  input: { safeParse(value: unknown): { success: true; data: Input } | { success: false } };
  output: ResponseSchema;
};

function get<Input>(route: Definition<Input>, plan: (session: SessionAccess, now: number, input: Input) => CommandStatement | null) {
  attendanceRoutes.get(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), query: c.req.query() });
    if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
    const ctx = openRequestScope(c.env.DB, c.var.requestId);
    const session = await resolveSession(c.req.raw, null, ctx.now);
    if (!session) return transportFailure(c, "UNAUTHENTICATED");
    const statement = plan(session, ctx.now, input.data);
    if (!statement) return transportFailure(c, "VALIDATION_FAILED");
    const row = await ctx.binding.prepare(statement.sql).bind(...statement.params ?? []).first<{ value: string | null }>();
    if (!row) return transportFailure(c, "UNAUTHENTICATED");
    if (row.value === null) return transportFailure(c, "NOT_FOUND");
    return transportSuccess(c, route.output.parse(JSON.parse(row.value)), ctx.now);
  });
}

function command<Input extends { body: { operationId: string } }>(route: Definition<Input>,
  plan: (ctx: { now: number }, session: SessionAccess, input: Input) =>
    CommandInput<{ operation: OperationResult; value: string | null }> | Promise<CommandInput<{ operation: OperationResult; value: string | null }>>,
  project?: (value: unknown, outcome: OpOutcome["status"]) => unknown,
) {
  attendanceRoutes.post(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), body: await boundedBody(c.req.raw) });
    if (!input.success || input.data.body.operationId !== c.req.header(operationIdHeader)) return transportFailure(c, "VALIDATION_FAILED");
    const ctx = openRequestScope(c.env.DB, c.var.requestId);
    const session = await resolveSession(c.req.raw, null, ctx.now);
    if (!session) return transportFailure(c, "UNAUTHENTICATED");
    const { operation, value } = await commitCommand(ctx, prepareCommand(ctx, await plan(ctx, session, input.data)));
    if (operation.outcome.status === "rejected") return transportFailure(c, operation.outcome.error);
    if (value === null) return transportFailure(c, "NOT_FOUND");
    const data: unknown = JSON.parse(value);
    scheduleOperationSignals(c, [operation]);
    return transportSuccess(c, route.output.parse(project ? project(data, operation.outcome.status) : data), ctx.now);
  });
}

const pageSize = 50;
type LogInput = RouteResponse<typeof getVisitLogRoute.input>;

function readVisitLog(session: SessionAccess, now: number, { params, query }: LogInput): CommandStatement | null {
  const cursorPrefix = `${query.view}~${params.id}~${query.shiftId ?? ""}~`;
  const position = query.cursor?.slice(cursorPrefix.length).split("~");
  if (query.cursor !== undefined && (!query.cursor.startsWith(cursorPrefix) || position?.length !== 3
    || !/^-?\d+$/.test(position[0]!) || !Number.isSafeInteger(Number(position[0]))
    || !["activity", "attendance", "correction_request", "customer_update"].includes(position[1]!)
    || !idSchema.safeParse(position[2]).success)) return null;

  const access = scheduleAccess(session, now, { kind: "visit", id: params.id });
  const customerOnly = query.view === "customer";
  const published = customerStampSql("u", "l.provider_name");
  const customerRows = `SELECT u.recorded_at AS at, 'customer_update' AS source, u.id,
    ${customerOnly ? published : `json_object('kind', 'customer_update', 'update', json(${published}))`} AS value
    FROM log_scope l JOIN customer_updates u ON u.visit_id = l.visit_id AND ${publishedCustomerUpdate("u")}
    WHERE u.kind <> 'photo' OR EXISTS (SELECT 1 FROM update_attachments link WHERE link.update_id = u.id)`;
  const photoReady = `${readyPhotoSql("media")} AND ${mediaLinkAvailable("l.job_id", "media.id", "progress")}`;
  const privateRows = `
    SELECT e.actual_at AS at, 'attendance' AS source, e.id, json_object('kind', 'attendance', 'at', e.actual_at,
      'actorName', ${displayName("actor")}, 'customerUpdateId', (SELECT id FROM on_site_origin WHERE event_id = e.id),
      'event', ${attendanceEventValue("e", displayName("actor"))}) AS value
    FROM log_assignments a JOIN attendance_events e ON e.assignment_id = a.id AND e.received_at <= ${at}
    JOIN accounts actor ON actor.id = e.actor_id
    UNION ALL SELECT r.requested_at, 'correction_request', r.id, json_object('kind', 'correction_request', 'at', r.requested_at,
      'actorName', ${displayName("actor")}, 'customerUpdateId', NULL, 'request', ${correctionValue("r", displayName("actor"))})
    FROM log_assignments a JOIN attendance_correction_requests r ON r.assignment_id = a.id AND r.requested_at <= ${at}
    JOIN accounts actor ON actor.id = r.requester_id
    UNION ALL SELECT e.at, 'activity', e.id,
      CASE e.kind WHEN 'setting_off' THEN json_object('kind', 'setting_off', 'at', e.at, 'actorName', ${displayName("actor")},
        'customerUpdateId', e.customer_update_id, 'assignmentId', e.assignment_id, 'estimate', ${estimateValue("e", displayName("actor"))})
      WHEN 'arrival_plan_set' THEN json_object('kind', 'arrival_plan_set', 'at', e.at, 'actorName', ${displayName("actor")},
        'id', e.id, 'original', json_object('language', e.detail_language, 'text', e.safe_detail))
      ELSE json_object('kind', 'work', 'at', e.at, 'actorName', ${displayName("actor")}, 'customerUpdateId', e.customer_update_id,
        'activity', ${workValue("e", displayName("actor"))}) END
    FROM log_scope l CROSS JOIN mark JOIN visit_activity_events e ON e.visit_id = l.visit_id AND e.at <= ${at}
    JOIN accounts actor ON actor.id = e.actor_id
    WHERE e.kind <> 'progress_photo' AND (mark.shift_id IS NULL OR e.assignment_id IS NULL OR e.assignment_id IN (SELECT id FROM log_assignments))
    UNION ALL SELECT e.at, 'activity', e.id, json_object('kind', 'progress_photo', 'id', e.id, 'assignmentId', a.id,
      'shiftId', evidence.shift_id, 'at', e.at, 'actorName', ${displayName("actor")}, 'customerUpdateId', shared.id, 'capturedAt', e.captured_at,
      'photo', json_object('attachmentId', media.id, 'availability', CASE WHEN ${photoReady} THEN 'available' ELSE 'unavailable' END),
      'caption', json(CASE WHEN e.safe_detail IS NOT NULL THEN json_object('original',
        json_object('language', e.detail_language, 'text', e.safe_detail), 'reading', NULL) END),
      'canShareWithCustomer', json(CASE WHEN ${photoReady}
        AND shared.id IS NULL AND l.visit_state = 'booked' AND l.job_state = 'open' AND l.place_state = 'in_area' THEN 'true' ELSE 'false' END))
    FROM log_assignments a JOIN visit_activity_events e ON e.assignment_id = a.id AND e.at <= ${at} AND e.kind = 'progress_photo'
    JOIN log_scope l ON l.visit_id = e.visit_id JOIN accounts actor ON actor.id = e.actor_id
    JOIN shift_evidence evidence ON evidence.activity_event_id = e.id JOIN attachments media ON media.id = evidence.attachment_id
    LEFT JOIN customer_updates shared ON shared.id = (SELECT u.id FROM update_attachments linked JOIN customer_updates u ON u.id = linked.update_id
      WHERE linked.attachment_id = media.id AND u.visit_id = e.visit_id AND u.kind = 'photo' AND u.recorded_at <= ${at}
      ORDER BY u.recorded_at DESC, u.rowid DESC LIMIT 1)`;

  return scopedStatement(access, `, mark(shift_id, stamp_at, source, stamp_id, prefix) AS (VALUES (?, ?, ?, ?, ?)),
    log_scope AS MATERIALIZED (
      SELECT scope.*, j.id AS job_id, v.id AS visit_id, v.state AS visit_state, j.state AS job_state, j.place_state, j.site_zone,
        b.public_name AS provider_name
      FROM live_scope scope CROSS JOIN schedule_job j JOIN visits v ON v.id = ${targetId} AND v.job_id = j.id
      JOIN businesses b ON b.id = j.business_id CROSS JOIN mark
      WHERE ${foreman("scope")} AND j.place_state <> 'restricted' AND (mark.shift_id IS NULL OR EXISTS (
        SELECT 1 FROM shifts sh WHERE sh.id = mark.shift_id AND sh.visit_id = v.id))
    )${customerOnly ? "" : `, log_assignments AS MATERIALIZED (
      SELECT a.id FROM log_scope l JOIN shifts sh ON sh.visit_id = l.visit_id
      JOIN shift_slots slot ON slot.shift_id = sh.id JOIN assignments a ON a.slot_id = slot.id CROSS JOIN mark
      WHERE a.confirmed_at <= ${at} AND (mark.shift_id IS NULL OR sh.id = mark.shift_id)
    ), on_site_origin AS MATERIALIZED (
      SELECT u.id, e.id AS event_id FROM log_scope l JOIN customer_updates u ON u.visit_id = l.visit_id AND u.kind = 'on_site'
      JOIN shifts sh ON sh.visit_id = l.visit_id JOIN shift_slots slot ON slot.shift_id = sh.id
      JOIN assignments a ON a.slot_id = slot.id JOIN attendance_events e ON e.assignment_id = a.id AND e.kind = 'arrival'
        AND e.review_state = 'accepted' AND e.corrects_id IS NULL AND e.received_at = u.recorded_at AND e.actual_at = u.occurred_at
      ORDER BY e.rowid LIMIT 1
    )`}, stamps AS (${customerRows}${customerOnly ? "" : ` UNION ALL ${privateRows}`}),
    log_page AS MATERIALIZED (SELECT s.* FROM stamps s CROSS JOIN mark WHERE mark.stamp_at IS NULL OR
      (s.at, s.source, s.id) < (mark.stamp_at, mark.source, mark.stamp_id)
      ORDER BY s.at DESC, s.source DESC, s.id DESC LIMIT ${pageSize + 1})
    SELECT (SELECT json_object('view', '${query.view}', 'visitId', l.visit_id,
      ${customerOnly ? "'siteZone', l.site_zone" : `'shiftId', mark.shift_id, 'control', json(${foremanControlSql("l.visit_id", "l")})`},
      'stamps', json((SELECT json_group_array(json(value)) FROM (
        SELECT value FROM log_page ORDER BY at DESC, source DESC, id DESC LIMIT ${pageSize}))),
      'page', json_object('hasMore', json(CASE WHEN (SELECT count(*) FROM log_page) > ${pageSize} THEN 'true' ELSE 'false' END),
        'cursor', CASE WHEN (SELECT count(*) FROM log_page) > ${pageSize} THEN (
          SELECT mark.prefix || at || '~' || source || '~' || id FROM log_page ORDER BY at DESC, source DESC, id DESC LIMIT 1 OFFSET ${pageSize - 1}) END))
      FROM log_scope l CROSS JOIN mark) AS value FROM acting_session`, query.shiftId ?? null,
  position ? Number(position[0]) : null, position?.[1] ?? null, position?.[2] ?? null, cursorPrefix);
}

get(getWorkerFieldShiftRoute, (session, now, { params }) => readWorkerFieldShift(session, now, params.id));
get(getVisitLogRoute, readVisitLog);
command(departAssignmentRoute, departAssignment);
command(recordAttendanceRoute, recordAttendance, (value, outcome) =>
  typeof value === "object" && value !== null ? { ...value, outcome: outcome === "committed" ? "recorded" : "existing" } : value);
command(requestAttendanceCorrectionRoute, requestAttendanceCorrection);
command(recordAssignmentProgressRoute, recordAssignmentProgress);
