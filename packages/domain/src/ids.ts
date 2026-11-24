declare const opaqueIdBrand: unique symbol;

/** Already validated by the boundary that received or minted the ID. */
export type OpaqueId<Kind extends string> = string & { readonly [opaqueIdBrand]: Kind };

export type AccountId = OpaqueId<"account">;
export type ContextId = OpaqueId<"context">;
export type BusinessId = OpaqueId<"business">;
export type MembershipId = OpaqueId<"membership">;
export type SessionId = OpaqueId<"session">;
export type OtpAttemptId = OpaqueId<"otp_attempt">;
export type DeviceId = OpaqueId<"device">;
export type InvitationId = OpaqueId<"invitation">;
export type PlaceId = OpaqueId<"place">;
export type OperationId = OpaqueId<"operation">;
export type RequestId = OpaqueId<"request">;
export type NotificationId = OpaqueId<"notification">;
export type PushInstallationId = OpaqueId<"push_installation">;
export type JobId = OpaqueId<"job">;
export type HandoffId = OpaqueId<"handoff">;
export type QuoteId = OpaqueId<"quote">;
export type QuoteVersionId = OpaqueId<"quote_version">;
export type TermsVersionId = OpaqueId<"terms_version">;
export type CommercialReviewId = OpaqueId<"commercial_review">;
export type ChangeProposalId = OpaqueId<"change_proposal">;
export type ChangeVersionId = OpaqueId<"change_version">;
export type VisitId = OpaqueId<"visit">;
export type VisitWindowId = OpaqueId<"visit_window">;
export type RescheduleRequestId = OpaqueId<"reschedule_request">;
export type ShiftId = OpaqueId<"shift">;
export type ShiftSlotId = OpaqueId<"shift_slot">;
export type AssignmentId = OpaqueId<"assignment">;
export type AssignmentOfferId = OpaqueId<"assignment_offer">;
export type CoverGapId = OpaqueId<"cover_gap">;
export type CoverOfferId = OpaqueId<"cover_offer">;
export type AttendanceEventId = OpaqueId<"attendance_event">;
export type CustomerUpdateId = OpaqueId<"customer_update">;
export type SafetyInstructionId = OpaqueId<"safety_instruction">;
export type SafetyVersionId = OpaqueId<"safety_version">;
export type SafetyHoldId = OpaqueId<"safety_hold">;
export type CompletionId = OpaqueId<"completion">;
export type BillId = OpaqueId<"bill">;
export type PaidRecordId = OpaqueId<"paid_record">;
export type CaseId = OpaqueId<"case">;
export type SupportCaseId = OpaqueId<"support_case">;
export type ChatThreadId = OpaqueId<"chat_thread">;
export type ChatMessageId = OpaqueId<"chat_message">;
export type ChatEntryId = OpaqueId<"chat_entry">;
export type MediaStageId = OpaqueId<"media_stage">;
export type AttachmentId = OpaqueId<"attachment">;

/** A public label, not an opaque ID or a credential. */
export type BookBuddyReference = OpaqueId<"bookbuddy_reference"> & `BB-${string}`;
const referencePattern = /^BB-[A-Z0-9]+$/;

export function parseReference(value: string): BookBuddyReference | null {
  return referencePattern.test(value) ? (value as BookBuddyReference) : null;
}

/** Format a label from its canonical suffix, e.g. `1042` or `S1042`. */
export function formatReference(suffix: string): BookBuddyReference {
  const reference = parseReference(`BB-${suffix}`);
  if (reference === null) throw new RangeError("Invalid BookBuddy reference suffix");
  return reference;
}
