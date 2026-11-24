import type { RouteResponse, patchCrewAvailabilityRoute } from "@bookbuddy/api-contract";
import type { RequestScope } from "../../db/scope";
import { at, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import {
  availabilityAccess, availabilityJson, confirmedAssignments, dateBasisFilter, datePreferences, datedRevision, mayEditAvailability,
} from "./availability";
import { dayBoundsByZone } from "./calendar";
import { crewAvailabilityKind } from "./projections";
import { scheduleReceipt } from "./receipts";
import { noticeSignals } from "./signals";

type Edit = RouteResponse<typeof patchCrewAvailabilityRoute.input>;

export function editAvailability(ctx: RequestScope, session: SessionAccess, { params: { member }, body }: Edit) {
  const { expectedRevision, operationId, payload } = body;
  const available = payload.kind === "available";
  const access = availabilityAccess(session, ctx.now, member);
  const edit: SessionAccess = { sql: `${access.sql},
    availability_input(date, zones, expected_revision, kind, hours, cover, expected_work) AS (VALUES (?, ?, ?, ?, ?, ?, ?)),
    availability_edit AS MATERIALIZED (
      SELECT m.*, i.date, i.expected_revision, i.kind, i.hours, i.cover,
        z.value ->> '$[0]' AS day_start, z.value ->> '$[1]' AS day_end
      FROM availability_member m CROSS JOIN availability_input i JOIN json_each(i.zones) z ON z.key = m.site_zone
    ), availability_hours AS MATERIALIZED (
      SELECT h.value ->> '$.startsAt' AS begins, h.value ->> '$.endsAt' AS ends
      FROM availability_edit i CROSS JOIN json_each(i.hours) h
      UNION ALL SELECT day_start, day_end FROM availability_edit WHERE kind = 'unavailable'
    )`, params: [...access.params, payload.date, dayBoundsByZone(payload.date), expectedRevision, payload.kind,
    JSON.stringify(available ? payload.hours : []), Number(available && payload.openToCover), JSON.stringify(payload.expectedConfirmedShifts)] };
  const date = "(SELECT date FROM availability_input)";
  const current = datedRevision("m.id", date);
  const onDay = `${confirmedAssignments("m.id", "m.business_id", at)}
    AND work.starts_at < m.day_end AND work.ends_at > m.day_start`;
  const exactBasis = `(SELECT count(*) ${onDay}) = json_array_length((SELECT expected_work FROM availability_input))
    AND NOT EXISTS (SELECT 1 ${onDay} AND NOT EXISTS (
      SELECT 1 FROM availability_input input CROSS JOIN json_each(input.expected_work) expected
      WHERE expected.value ->> '$.assignmentId' = work.id
        AND expected.value ->> '$.startsAt' = work.starts_at AND expected.value ->> '$.endsAt' = work.ends_at))`;
  const valid = `m.expected_revision = ${current} AND m.expected_revision < ${Number.MAX_SAFE_INTEGER}
    AND NOT EXISTS (SELECT 1 FROM availability_hours h WHERE h.begins < m.day_start OR h.ends > m.day_end)
    AND ${exactBasis}`;
  const same = `(SELECT count(*) FROM availability_intervals a WHERE a.membership_id = m.id AND ${datePreferences("m.date")})
      = (SELECT count(*) FROM availability_hours)
    AND NOT EXISTS (SELECT 1 FROM availability_hours h WHERE NOT EXISTS (SELECT 1 FROM availability_intervals a
      WHERE a.membership_id = m.id AND ${datePreferences("m.date")} AND a.kind = m.kind AND a.open_to_cover = m.cover
        AND a.starts_at = h.begins AND a.ends_at = h.ends))`;
  const audience = `SELECT c.id AS context_id, c.account_id FROM availability_member m JOIN account_contexts c
    ON c.business_id = m.business_id AND c.role = 'worker' JOIN membership_roles r ON r.id = c.role_grant_id
      AND r.membership_id = m.id AND r.granted_at <= ${at} AND r.revoked_at IS NULL`;
  return scheduleReceipt(ctx, edit, {
    command: "schedule.edit_availability", input: [member, body], operationId, resultRef: member,
    authorize: { sql: `EXISTS (SELECT 1 FROM availability_member m WHERE ${mayEditAvailability("scope", "m")})` },
    eligible: { sql: `EXISTS (SELECT 1 FROM availability_edit m WHERE ${valid} AND NOT (${same}))` },
    unchanged: { sql: `EXISTS (SELECT 1 FROM availability_edit m WHERE ${valid} AND (${same}))` },
    writes(guard) {
      const pending = guard.params ?? [];
      const change = `SELECT '${crewAvailabilityKind}', m.id, worker.context_id, 'upsert', ${at}
        FROM availability_member m CROSS JOIN (${audience}) worker`;
      const recipients = `SELECT worker.context_id FROM (${audience}) worker CROSS JOIN live_scope actor
        WHERE actor.role <> 'worker' AND actor.account_id <> worker.account_id`;
      const { inserted, changes, effects } = noticeSignals(edit, guard, "availability_corrected", recipients, change);
      return { statements: [
        scopedStatement(edit, `DELETE FROM availability_intervals AS a WHERE a.membership_id = (SELECT id FROM availability_member)
          AND ${datePreferences(date)} AND ${guard.sql}`, ...pending),
        scopedStatement(edit, `INSERT INTO availability_intervals (id, membership_id, week_day_or_date, starts_at, ends_at,
          kind, source, open_to_cover, recorded_by, recorded_at, revision)
          SELECT lower(hex(randomblob(16))), m.id, m.date, h.begins, h.ends, m.kind,
            CASE WHEN scope.role = 'worker' THEN 'worker' ELSE 'employer' END,
            m.cover, scope.account_id, ${at}, m.expected_revision + 1
          FROM availability_edit m CROSS JOIN availability_hours h CROSS JOIN live_scope scope WHERE ${guard.sql}`, ...pending),
        inserted,
      ], changes, effects };
    },
  }, { sql: `SELECT ${availabilityJson("m", "m.site_zone", at, dateBasisFilter(date), { start: "m.day_start", end: "m.day_end" })}
    FROM availability_edit m` },
  { expected: expectedRevision, sql: `SELECT ${current} FROM availability_member m` });
}
