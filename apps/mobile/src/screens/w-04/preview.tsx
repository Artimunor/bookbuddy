import { workerFieldShiftSchema } from "@bookbuddy/api-contract";
import { PreviewLocaleProvider } from "../../i18n";
import type { AttendanceStatus } from "../../repository/attendance";
import type { ScreenPreview } from "../../preview/screens/types";
import { BeaconThemeProvider } from "../../ui/theme";
import { LiveShiftView } from "./Screen";

const at = Date.parse("2026-11-24T08:14:00Z");
export const fixture = workerFieldShiftSchema.parse({ id: "assignment_1", shiftId: "shift_1", visitId: "visit_1", job: { id: "job_1", reference: "BB-1042", title: "Terrace door repair", placeAlias: "Villa Mar" }, siteZone: "Europe/Madrid", bookedWindow: { id: "window_1", startsAt: at - 14 * 60000, endsAt: at + 46 * 60000 }, task: "Terrace door repair", state: "confirmed", isLead: false, foremanName: "Mateo", crewThreadId: "thread_1", estimate: null, attendance: { arrival: null, departure: null, hasPendingReview: false, pendingReviewEventIds: [] }, holds: [{ id: "hold_1", kind: "briefing", state: "active", instruction: null }], work: null, nextAction: "check_in" });
export const arrival = { status: "recorded", operationId: null, eventId: "event_1", actualAt: at, capturedAt: at, receivedAt: at, error: null } as const;
const noop = () => {};
export const previews: ScreenPreview[] = ["confirmed", "hold", "on-the-way", "checked-in", "check-out-due", "cancelled", "offline"].map(state => ({ id: "W-04", state, render: () => {
  const arrived = ["hold", "checked-in", "check-out-due"].includes(state); const attendance: AttendanceStatus = { arrival: arrived ? arrival : null, departure: null, lastConfirmedAt: at };
  const data = { ...fixture, holds: state === "hold" ? fixture.holds : [], state: state === "cancelled" ? "released" as const : fixture.state, estimate: state === "on-the-way" ? { id: "activity_1" as never, band: { startsAt: at, endsAt: at + 600000 }, at: at - 60000, audience: "crew_only" as const, foremanName: "Mateo" } : null, work: state === "checked-in" ? { id: "activity_2" as never, kind: "work_started" as const, at: at + 240000, byName: "Mateo" } : null };
  return <BeaconThemeProvider field><PreviewLocaleProvider><LiveShiftView data={data} shiftId="shift_1" assignmentId="assignment_1" offline={state === "offline"} lastConfirmedAt={at} loading={false} error={false} attendance={attendance} now={state === "check-out-due" ? fixture.bookedWindow.endsAt + 60000 : at} onBack={noop} onNavigate={noop} onRetry={noop} /></PreviewLocaleProvider></BeaconThemeProvider>;
} }));
