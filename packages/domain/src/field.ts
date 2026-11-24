export const ATTENDANCE_REASON_CODES = [
  "out_of_window", "duplicate_event", "missing_arrival", "out_of_order", "disputed", "correction",
] as const;
export const ATTENDANCE_CORRECTION_REASONS = ["wrong_time", "disputed"] as const;
export const ATTENDANCE_CORRECTION_STATES = ["requested", "accepted", "declined", "withdrawn"] as const;

export const VISIT_ACTIVITY_KINDS = [
  "setting_off", "work_started", "work_paused", "work_finished", "progress_photo", "arrival_plan_set",
] as const;

// The verifier checks all three in the actual spoken briefing, not from a read receipt.
export type TeachBackChecklist = {
  hazard: boolean;
  control: boolean;
  response: boolean;
};
