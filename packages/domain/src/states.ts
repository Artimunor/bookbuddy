// Identity and access
export const ACCOUNT_STATES = ["active", "restricted", "closed"] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const OTP_ATTEMPT_STATES = ["pending", "consumed", "invalidated", "expired"] as const;
export type OtpAttemptState = (typeof OTP_ATTEMPT_STATES)[number];
export const BUSINESS_STATES = ["pending", "approved", "suspended", "closed"] as const;
export type BusinessState = (typeof BUSINESS_STATES)[number];
export const MEMBERSHIP_STATES = ["active", "revoked", "suspended"] as const;
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];
export const MEMBERSHIP_ROLES = ["worker", "foreman", "provider_admin"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
export const CONTEXT_ROLES = ["customer", ...MEMBERSHIP_ROLES] as const;
export type ContextRole = (typeof CONTEXT_ROLES)[number];
export const BUSINESS_CAPABILITIES = [
  "handoff", "backup_foreman", "review_commercial", "publish_commercial", "issue_bill",
  "record_paid", "billing_deferral", "membership_admin", "schedule_correction", "feedback_lead",
] as const;
export type BusinessCapability = (typeof BUSINESS_CAPABILITIES)[number];
export const ELIGIBILITY_STATES = ["pending", "approved", "suspended", "rejected"] as const;
export type EligibilityState = (typeof ELIGIBILITY_STATES)[number];
export const ELIGIBILITY_DISPLAY_STATES = [...ELIGIBILITY_STATES, "expiring", "expired"] as const;
export type EligibilityDisplayState = (typeof ELIGIBILITY_DISPLAY_STATES)[number];
export const PLACE_STATES = ["pending_verification", "in_area", "out_of_area", "restricted", "archived"] as const;
export type PlaceState = (typeof PLACE_STATES)[number];
export const PLACE_CAPABILITIES = ["view", "message", "request", "book", "approve", "sign_off", "bill_view", "delegate"] as const;
export type PlaceCapability = (typeof PLACE_CAPABILITIES)[number];
export const INVITATION_STATES = ["pending", "accepted", "declined", "withdrawn", "expired"] as const;
export type InvitationState = (typeof INVITATION_STATES)[number];

// Transport: notification read state is derived from read_at, not a persisted enum.
export const SYNC_CHANGE_OPERATIONS = ["upsert", "remove"] as const;
export type SyncChangeOperation = (typeof SYNC_CHANGE_OPERATIONS)[number];
export const NOTIFICATION_READ_STATES = ["unread", "read"] as const;
export type NotificationReadState = (typeof NOTIFICATION_READ_STATES)[number];
export const PUSH_PLATFORMS = ["ios", "android"] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];
export const PUSH_INSTALLATION_STATES = ["active", "disabled", "revoked"] as const;
export type PushInstallationState = (typeof PUSH_INSTALLATION_STATES)[number];
export const EFFECT_STATES = ["pending", "claimed", "delivered", "failed", "unknown", "skipped"] as const;
export type EffectState = (typeof EFFECT_STATES)[number];
export const PUSH_TICKET_STATES = ["due", "delivered", "rejected", "unknown"] as const;
export type PushTicketState = (typeof PUSH_TICKET_STATES)[number];

// Intake and commercial
export const JOB_STATES = ["open", "cancelled", "closed"] as const;
export type JobState = (typeof JOB_STATES)[number];
export const HANDOFF_STATES = ["offered", "accepted", "declined", "expired", "withdrawn"] as const;
export type HandoffState = (typeof HANDOFF_STATES)[number];
export const SUPPORT_CASE_STATES = ["open", "responded", "closed"] as const;
export type SupportCaseState = (typeof SUPPORT_CASE_STATES)[number];
export const QUOTE_VERSION_STATES = ["draft", "in_review", "returned", "issued", "approved", "declined", "superseded", "withdrawn"] as const;
export type QuoteVersionState = (typeof QUOTE_VERSION_STATES)[number];
export const CHANGE_VERSION_STATES = ["draft", "in_review", "returned", "issued", "approved", "rejected", "superseded", "withdrawn"] as const;
export type ChangeVersionState = (typeof CHANGE_VERSION_STATES)[number];
export const COMMERCIAL_REVIEW_STATES = ["pending", "returned", "issued"] as const;
export type CommercialReviewState = (typeof COMMERCIAL_REVIEW_STATES)[number];
export const APPROVAL_DECISIONS = ["approve", "decline"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

// Schedule and staffing
export const VISIT_KINDS = ["assessment", "work"] as const;
export type VisitKind = (typeof VISIT_KINDS)[number];
export const VISIT_STATES = ["planned", "booked", "cancelled", "finished"] as const;
export type VisitState = (typeof VISIT_STATES)[number];
export const VISIT_WINDOW_STATES = ["proposed", "confirmed", "withdrawn", "superseded", "cancelled"] as const;
export type VisitWindowState = (typeof VISIT_WINDOW_STATES)[number];
export const RESCHEDULE_REQUEST_STATES = ["requested", "proposed", "accepted", "declined", "withdrawn"] as const;
export type RescheduleRequestState = (typeof RESCHEDULE_REQUEST_STATES)[number];
export const SHIFT_STATES = ["planned", "active", "finished", "cancelled"] as const;
export type ShiftState = (typeof SHIFT_STATES)[number];
export const AVAILABILITY_KINDS = ["available", "unavailable", "duty"] as const;
export type AvailabilityKind = (typeof AVAILABILITY_KINDS)[number];
export const AVAILABILITY_SOURCES = ["worker", "employer"] as const;
export type AvailabilitySource = (typeof AVAILABILITY_SOURCES)[number];
export const ASSIGNMENT_SOURCES = ["ordinary", "cover"] as const;
export type AssignmentSource = (typeof ASSIGNMENT_SOURCES)[number];
export const ASSIGNMENT_STATES = ["confirmed", "dropped", "released", "completed"] as const;
export type AssignmentState = (typeof ASSIGNMENT_STATES)[number];
export const ASSIGNMENT_OFFER_STATES = ["offered", "confirmed", "declined", "withdrawn", "expired"] as const;
export type AssignmentOfferState = (typeof ASSIGNMENT_OFFER_STATES)[number];
export const COVER_GAP_STATES = ["open", "accepted_pending_confirmation", "filled", "closed"] as const;
export type CoverGapState = (typeof COVER_GAP_STATES)[number];
export const COVER_DISPATCH_STATES = ["open", "closed"] as const;
export type CoverDispatchState = (typeof COVER_DISPATCH_STATES)[number];
export const COVER_ROUND_STATES = ["open", "accepted_pending_confirmation", "confirmed", "closed"] as const;
export type CoverRoundState = (typeof COVER_ROUND_STATES)[number];
export const COVER_OFFER_STATES = ["offered", "declined", "withdrawn"] as const;
export type CoverOfferState = (typeof COVER_OFFER_STATES)[number];

// Field and safety
export const ATTENDANCE_KINDS = ["arrival", "departure"] as const;
export type AttendanceKind = (typeof ATTENDANCE_KINDS)[number];
export const ATTENDANCE_SOURCES = ["self", "assisted", "manual"] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];
export const ATTENDANCE_REVIEW_STATES = ["accepted", "needs_review"] as const;
export type AttendanceReviewState = (typeof ATTENDANCE_REVIEW_STATES)[number];
export const CUSTOMER_UPDATE_KINDS = [
  "crew_confirmed", "on_the_way", "arrival_revised", "arrival_withdrawn", "on_site", "working",
  "paused", "photo", "cover_arranging", "no_crew_available", "crew_updated", "finished",
] as const;
export type CustomerUpdateKind = (typeof CUSTOMER_UPDATE_KINDS)[number];
export const TEACH_BACK_OUTCOMES = ["passed", "not_understood"] as const;
export type TeachBackOutcome = (typeof TEACH_BACK_OUTCOMES)[number];
export const SAFETY_HOLD_KINDS = ["briefing", "work_rule", "incident"] as const;
export type SafetyHoldKind = (typeof SAFETY_HOLD_KINDS)[number];
export const SAFETY_HOLD_STATES = ["active", "cleared"] as const;
export type SafetyHoldState = (typeof SAFETY_HOLD_STATES)[number];
// Instruction state is derived from version, teach-back and acknowledgement records.
export const SAFETY_INSTRUCTION_STATES = ["awaiting_teach_back", "awaiting_acknowledgement", "acknowledged", "superseded"] as const;
export type SafetyInstructionState = (typeof SAFETY_INSTRUCTION_STATES)[number];

// Closeout, communication and evidence
export const COMPLETION_STATES = ["submitted", "returned", "superseded", "signed_off"] as const;
export type CompletionState = (typeof COMPLETION_STATES)[number];
export const COMPLETION_ITEM_OUTCOMES = ["done", "not_done"] as const;
export type CompletionItemOutcome = (typeof COMPLETION_ITEM_OUTCOMES)[number];
export const BILL_STATES = ["issued", "replaced", "void"] as const;
export type BillState = (typeof BILL_STATES)[number];
export const PAID_RECORD_KINDS = ["matched", "checking", "corrected", "no_funds_received", "refund_recorded"] as const;
export type PaidRecordKind = (typeof PAID_RECORD_KINDS)[number];
export const PROBLEM_CASE_CATEGORIES = ["quality", "damage", "bill", "timing", "other"] as const;
export type ProblemCaseCategory = (typeof PROBLEM_CASE_CATEGORIES)[number];
export const PROBLEM_CASE_STATES = ["open", "awaiting_plan", "resolved", "closed"] as const;
export type ProblemCaseState = (typeof PROBLEM_CASE_STATES)[number];
export const RATING_STATES = ["submitted", "withdrawn"] as const;
export type RatingState = (typeof RATING_STATES)[number];
export const CHAT_AUDIENCES = ["job", "crew"] as const;
export type ChatAudience = (typeof CHAT_AUDIENCES)[number];
export const CHAT_WRITE_STATES = ["open", "read_only"] as const;
export type ChatWriteState = (typeof CHAT_WRITE_STATES)[number];
export const MESSAGE_TRANSLATION_STATES = ["pending", "ready", "unavailable"] as const;
export type MessageTranslationState = (typeof MESSAGE_TRANSLATION_STATES)[number];
export const ATTACHMENT_STATES = ["reserved", "preparing", "uploading", "verifying", "ready", "rejected", "expired"] as const;
export type AttachmentState = (typeof ATTACHMENT_STATES)[number];

// Later session category: these literals do not enable the feature.
export const SESSION_SLOT_STATES = ["draft", "published", "paused", "cancelled", "finished"] as const;
export type SessionSlotState = (typeof SESSION_SLOT_STATES)[number];
export const SESSION_HOLD_STATES = ["held", "consumed", "released"] as const;
export type SessionHoldState = (typeof SESSION_HOLD_STATES)[number];
export const SESSION_BOOKING_STATES = ["booked", "cancelled", "completed"] as const;
export type SessionBookingState = (typeof SESSION_BOOKING_STATES)[number];
export const SESSION_HOST_ASSIGNMENT_STATES = ["proposed", "confirmed", "released"] as const;
export type SessionHostAssignmentState = (typeof SESSION_HOST_ASSIGNMENT_STATES)[number];
