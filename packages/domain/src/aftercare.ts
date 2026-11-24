import type { PaidRecordKind } from "./states";

export const AFTERCARE_TARGETS = {
  signOffReminderCalendarDays: 3,
  signOffFollowUpCalendarDays: 7,
  billDueCalendarDays: 7,
  caseAcknowledgementBusinessDays: 1,
  caseFirstUpdateBusinessDays: 2,
  caseNextUpdateBusinessDays: 2,
  deferralDecisionBusinessDays: 2,
  ratingCalendarDays: 30,
} as const;

export const BILL_PAYMENT_STATUSES = ["due", "checking", "paid"] as const;
export type BillPaymentStatus = (typeof BILL_PAYMENT_STATUSES)[number];

/** Pass the head of the invoice's provider-recorded history, not a client receipt or a case status. */
export function projectBillPaymentStatus(head: PaidRecordKind | null): BillPaymentStatus {
  switch (head) {
    case null:
    case "no_funds_received": return "due";
    case "matched": return "paid";
    case "checking":
    case "corrected":
    case "refund_recorded": return "checking";
  }
}

export const CASE_PROVIDER_AUDIENCES = ["provider_billing", "provider_rectification"] as const;
export const CASE_EVENT_AUDIENCES = ["reporter_and_owner", ...CASE_PROVIDER_AUDIENCES] as const;
export const CASE_EVENT_KINDS = [
  "reported", "reporter_update", "acknowledged", "substantive_update", "correction_requested", "resolved", "closed", "provider_packet",
] as const;
export const BILL_DEFERRAL_DISPOSITIONS = ["resume_collection", "invoice_correction", "refund_instruction"] as const;
