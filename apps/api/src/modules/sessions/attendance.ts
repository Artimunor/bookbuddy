import type { RouteResponse, recordSessionAttendanceRoute } from "@bookbuddy/api-contract";
import { at, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { attendanceValue, hostingCommand, hostingSlotAccess, hostingSlotAuthorization } from "./hosting";

type AttendanceInput = RouteResponse<typeof recordSessionAttendanceRoute.input>;

export function recordSessionAttendance(now: number, session: SessionAccess, input: AttendanceInput) {
  const { params, body } = input;
  const p = body.payload;
  const slot = hostingSlotAccess(session, now, params.id, p.slotId);
  const access = { sql: `${slot.sql}, attendance_input(id, booking_id, slot_revision, result, places, corrects_id, reason)
    AS (VALUES (?, ?, ?, ?, ?, ?, ?))`, params: [...slot.params, p.id, p.bookingId, p.slotRevision,
    p.result, p.placesAttended, p.correction?.correctsId ?? null, p.correction?.reason ?? null] };
  const booking = `FROM hosting_slot sl CROSS JOIN attendance_input i JOIN session_bookings b ON b.id = i.booking_id AND b.slot_id = sl.id`;
  return hostingCommand(now, access, {
    operationId: body.operationId, command: "session.attendance", input, resultRef: p.id,
    authorize: { sql: `${hostingSlotAuthorization.sql} AND EXISTS (SELECT 1 ${booking})` },
    eligible: { sql: `EXISTS (SELECT 1 ${booking}
      WHERE sl.revision = i.slot_revision AND sl.state IN ('published', 'paused', 'finished') AND sl.starts_at <= ${at}
        AND b.state IN ('booked', 'completed') AND i.places <= b.places
        AND NOT EXISTS (SELECT 1 FROM session_attendance used WHERE used.id = i.id)
        AND ((i.corrects_id IS NULL AND NOT EXISTS (SELECT 1 FROM session_attendance verified
          WHERE verified.booking_id = b.id AND verified.corrects_id IS NULL)) OR EXISTS (
          SELECT 1 FROM session_attendance prior WHERE prior.id = i.corrects_id AND prior.booking_id = b.id AND prior.recorded_at <= ${at}
            AND NOT EXISTS (SELECT 1 FROM session_attendance child WHERE child.corrects_id = prior.id))))` },
    writes: (guard) => ({ statements: [scopedStatement(access, `INSERT INTO session_attendance
      (id, booking_id, result, places_attended, recorded_by_id, recorded_at, corrects_id, correction_reason)
      SELECT i.id, i.booking_id, i.result, i.places, scope.account_id, ${at}, i.corrects_id, i.reason
      FROM attendance_input i CROSS JOIN live_scope scope WHERE ${guard.sql}`, ...guard.params ?? [])],
    changes: scopedStatement(access, `SELECT 'session_booking' AS kind, b.id AS resource_id, c.id AS partition_key, 'upsert' AS op, ${at} AS at
      FROM attendance_input i JOIN session_bookings b ON b.id = i.booking_id
      JOIN account_contexts c ON c.account_id = b.booker_id AND c.role = 'customer'
      JOIN accounts a ON a.id = c.account_id AND a.state = 'active'`) }),
  }, { sql: `SELECT ${attendanceValue("result", "recorder")} AS value
    FROM live_scope scope CROSS JOIN attendance_input i JOIN session_attendance result ON result.id = i.id AND result.booking_id = i.booking_id
    JOIN accounts recorder ON recorder.id = result.recorded_by_id WHERE ${hostingSlotAuthorization.sql}` });
}
