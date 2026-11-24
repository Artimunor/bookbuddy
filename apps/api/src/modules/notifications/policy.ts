import { at, intendedRecipient, inviteKind, mayGrantInvite } from "../access/policy";
import { casePacketExists, caseProviderGrant, caseSteward } from "../aftercare/case-policy";
import { awaitingSignOff, followUpKind, isSignOffRecipient, reminderKind } from "../aftercare/completion";
import { customerBillReader } from "../aftercare/invoice";
import { chatNoticeKind, threadLinkKind } from "../chat/links";
import { chatParticipants, chatTargets, entryVisible } from "../chat/policy";
import { actionableDecision, customer, foreman, routedReviewer } from "../commercial/policy";
import type { CommercialKind } from "../commercial/policy";
import { currentMembership, scopedIntakeIds } from "../jobs/projections";
import { placeCapability } from "../places/policy";
import { customer as scheduleCustomer, foreman as scheduleForeman, jobOpen, provider as scheduleProvider } from "../schedule/policy";
import { sessionsCustomerTarget } from "../sessions/policy";
import { approvedJob } from "../staffing/crew";

// n is the recorded intent, l its exact, unexpired scoped link and scope the
// current recipient (account_id, context_id, role, business_id, membership_id).
// Do not project destination contents merely to test authority to show a notice.
const link = "l.resource_id";
const context = "scope.context_id";
const account = "scope.account_id";
const job = `(SELECT j.*, p.owner_id, p.named_approver_id, p.state AS place_state, b.state AS business_state, r.submitted_at
  FROM jobs j JOIN places p ON p.id = j.place_id JOIN businesses b ON b.id = j.business_id
  LEFT JOIN requests r ON r.job_id = j.id)`;
const ownedJob = `FROM ${job} j WHERE j.id = ${link}`;
const eventId = (prefix: string) => `CASE WHEN n.event_key GLOB '${prefix}*' THEN substr(n.event_key, ${prefix.length + 1}) END`;
const linkedJob = (table: string) => `FROM ${table} target JOIN ${job} j ON j.id = target.job_id WHERE target.id = ${link}`;
const eligibleShift = `sh.state = 'planned' AND sh.starts_at > ${at} AND v.state = 'booked' AND ${jobOpen()} AND ${approvedJob("j")}
  AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.slot_id = slot.id AND a.state = 'confirmed')`;
const shiftParents = `JOIN shift_slots slot ON slot.id = g.slot_id JOIN shifts sh ON sh.id = slot.shift_id
  JOIN visits v ON v.id = sh.visit_id JOIN ${job} j ON j.id = v.job_id`;
const staffOffer = `scope.role = 'worker' AND scope.business_id = j.business_id AND scope.membership_id = o.recipient_id`;
const signOffDestination = `FROM completions c JOIN ${job} j ON j.id = c.job_id WHERE c.id = ${link}`;

function commercialDestination(kind: CommercialKind, purpose: "decision" | "review") {
  const direct = kind === "quote" && purpose === "decision";
  const version = direct ? link : eventId(`${purpose === "review" ? "commercial_review_due" : "change_ready"}:${kind}:`);
  const decision = `${customer("scope")} AND ${actionableDecision(kind, "scope")}`;
  return `EXISTS (SELECT 1 FROM ${kind}_versions v JOIN ${job} j ON j.id = v.job_id
    ${purpose === "review" ? `JOIN commercial_reviews review ON review.${kind}_version_id = v.id` : ""}
    WHERE v.id = (${version}) ${direct ? "" : `AND j.id = ${link}`}
      AND ${purpose === "review" ? `review.state = 'pending' AND ${routedReviewer("scope", "review")}` : decision})`;
}

const chat = `EXISTS (WITH notice_thread(id, entry_id, context_id) AS MATERIALIZED (
    SELECT ${link}, ${eventId(`${chatNoticeKind}:`)}, ${context}
  ), chat_targets AS MATERIALIZED (${chatTargets("t.id = (SELECT id FROM notice_thread)")})
  SELECT 1 FROM (${chatParticipants("c.id = (SELECT context_id FROM notice_thread)")}) t
  JOIN chat_entries e ON e.id = (SELECT entry_id FROM notice_thread) AND ${entryVisible("t", "e")})`;

function noticePolicy(forPush: boolean): string {
  const schedule = scheduleCustomer("scope", "j", true);
  const foremanJob = scheduleForeman("scope");
  const assignedOffer = `EXISTS (SELECT 1 FROM assignment_offers o
    JOIN shift_slots slot ON slot.id = o.slot_id JOIN shifts sh ON sh.id = slot.shift_id
    JOIN visits v ON v.id = sh.visit_id JOIN ${job} j ON j.id = v.job_id
    WHERE o.id = ${link} AND o.issued_at <= ${at} AND ${staffOffer}
      ${forPush ? `AND CASE n.kind WHEN 'assignment_offer' THEN o.state = 'offered' AND o.expires_at > ${at}
        AND ${eligibleShift} AND NOT EXISTS (SELECT 1 FROM cover_gaps g WHERE g.slot_id = slot.id)
        ELSE o.state = 'withdrawn' END` : ""})`;
  const coverOffer = `EXISTS (SELECT 1 FROM cover_offers o JOIN cover_gaps g ON g.id = o.gap_id
    JOIN cover_dispatches d ON d.gap_id = g.id AND d.dispatch_no = o.dispatch_no
    ${forPush ? "JOIN cover_rounds r ON r.gap_id = g.id AND r.round_no = g.current_round_no AND r.dispatch_no = o.dispatch_no" : ""}
    ${shiftParents} WHERE o.id = ${link} AND ${staffOffer} AND d.issued_at <= ${at}
      ${forPush ? `AND o.state = 'offered' AND o.expires_at > ${at} AND g.state = 'open' AND g.safe_cutoff > ${at}
        AND r.state = 'open' AND d.state = 'open' AND d.reply_until > ${at} AND ${eligibleShift}` : ""})`;
  const caseAccess = `EXISTS (SELECT 1 FROM problem_cases pc JOIN ${job} j ON j.id = pc.job_id
    WHERE pc.id = ${link} AND pc.opened_at <= ${at} AND CASE n.kind
      WHEN 'case_provider_packet' THEN ${caseProviderGrant("scope")} AND ${casePacketExists}
      WHEN 'case_updated' THEN (pc.reporter_id = ${account} AND ${customer("scope")}) OR ${caseSteward("scope")}
      ELSE ${caseSteward("scope")} END)`;
  const invitation = `EXISTS (SELECT 1 FROM invitations i JOIN accounts recipient ON recipient.id = ${account}
    WHERE i.id = ${link} AND ${intendedRecipient("i", "recipient")} AND i.issued_at <= ${at}
      AND CASE n.kind WHEN 'place_transfer' THEN ${inviteKind("i")} = 'place_transfer'
        WHEN 'place_invite' THEN i.place_id IS NOT NULL ELSE 1 END
      AND (i.state = 'accepted'${forPush ? " AND 0" : ""} OR (i.state = 'pending' AND i.expires_at > ${at} AND ${mayGrantInvite("i")})))`;
  return `CASE
    WHEN n.kind = '${chatNoticeKind}' THEN l.kind = '${threadLinkKind}' AND ${chat}
    WHEN n.kind = 'job_handoff_offered' THEN l.kind = 'job_handoff' AND EXISTS (
      WITH recipient(context_id, role, business_id) AS (SELECT ${context}, scope.role, scope.business_id)
      ${scopedIntakeIds("recipient", at, `h.id = ${link}`)})
    WHEN n.kind IN ('assignment_offer', 'assignment_withdrawn') THEN l.kind = 'assignment_offer' AND ${assignedOffer}
    WHEN n.kind = 'cover_offer' THEN l.kind = 'cover_offer' AND ${coverOffer}
    WHEN n.kind IN ('assignment_dropped', 'cover_accepted') THEN l.kind = 'cover' AND EXISTS (
      SELECT 1 FROM cover_gaps g ${shiftParents} WHERE g.id = ${link} AND ${foremanJob})
    WHEN n.kind IN ('assignment_confirmed', 'assignment_declined', 'commercial_approved', 'commercial_declined', 'commercial_returned')
      THEN l.kind = 'job_update' AND EXISTS (SELECT 1 ${ownedJob} AND ${foreman("scope")})
    WHEN n.kind IN ('job_handoff_accepted', 'job_handoff_declined', 'job_handoff_withdrawn')
      THEN l.kind = 'job_update' AND EXISTS (SELECT 1 ${ownedJob} AND (${scheduleProvider("scope")} OR ${foremanJob}))
    WHEN n.kind = 'visit_window_confirmed' THEN l.kind = 'job_update' AND EXISTS (SELECT 1 ${ownedJob} AND ${foremanJob})
    WHEN n.kind IN ('visit_windows_offered', 'visit_window_withdrawn')
      THEN l.kind = 'job_update' AND EXISTS (SELECT 1 ${ownedJob} AND ${schedule})
    WHEN n.kind IN ('visit_reschedule_requested', 'visit_cancelled')
      THEN l.kind = 'job_update' AND EXISTS (SELECT 1 ${ownedJob} AND (${schedule} OR ${foremanJob}))
    WHEN n.kind = 'visit_live' THEN l.kind = 'visit_live' AND EXISTS (
      SELECT 1 FROM visits v JOIN ${job} j ON j.id = v.job_id
      JOIN visit_windows w ON w.visit_id = v.id AND w.state = 'confirmed' AND w.confirmed_at <= ${at}
      WHERE v.id = ${link} AND v.state IN ('booked', 'finished') AND j.state <> 'cancelled'
        AND ${scheduleCustomer("scope")} AND (j.owner_id = ${account} OR ${placeCapability("j.place_id", account, "view")}))
    WHEN n.kind = 'quote_ready' THEN l.kind = 'quote_ready' AND ${commercialDestination("quote", "decision")}
    WHEN n.kind = 'change_ready' THEN l.kind = 'job_update' AND ${commercialDestination("change", "decision")}
    WHEN n.kind = 'commercial_review_due' THEN l.kind = 'job_update'
      AND (${commercialDestination("quote", "review")} OR ${commercialDestination("change", "review")})
    WHEN n.kind IN ('bill_issued', 'bill_paid', 'bill_due', 'bill_checking', 'bill_collection_deferred', 'bill_collection_released')
      THEN l.kind = n.kind AND EXISTS (SELECT 1 ${linkedJob("bills")} AND target.issued_at <= ${at} AND ${customerBillReader("scope")})
    WHEN n.kind IN ('completion_ready', '${reminderKind}') THEN l.kind = n.kind
      AND EXISTS (SELECT 1 ${signOffDestination} AND ${isSignOffRecipient("scope", "c")})
    WHEN n.kind = '${followUpKind}' THEN l.kind = n.kind
      AND EXISTS (SELECT 1 ${signOffDestination} AND ${foreman("scope")} AND ${awaitingSignOff("c")})
    WHEN n.kind IN ('case_opened', 'case_updated', 'case_provider_packet', 'case_acknowledgement_due', 'case_update_due')
      THEN l.kind = n.kind AND ${caseAccess}
    WHEN n.kind = 'availability_corrected' THEN l.kind = 'crew_availability' AND scope.role = 'worker'
      AND instr(${link}, ':') > 1 AND substr(${link}, 1, instr(${link}, ':') - 1) = scope.membership_id
    WHEN n.kind IN ('session_booking_updated', 'session_host_arranging', 'session_host_changed', 'session_change_withdrawn', 'session_change_proposed')
      THEN l.kind = 'session_booking' AND scope.role = 'customer' AND EXISTS (
        SELECT 1 FROM session_bookings booking JOIN session_listings listing ON listing.id = booking.listing_id
        JOIN businesses business ON business.id = listing.business_id AND business.state = 'approved'
        JOIN session_listing_versions version ON version.id = booking.listing_version_id JOIN venues venue ON venue.id = version.venue_id
        WHERE booking.id = ${link} AND booking.booked_at <= ${at} AND booking.booker_id = ${account}
          AND ${sessionsCustomerTarget(account, "listing.business_id", "venue.area_id", "listing.category")})
    WHEN n.kind IN ('invitation', 'place_invite', 'place_transfer') THEN l.kind = n.kind AND ${invitation}
    ELSE 0 END`;
}

export const inboxNoticeAllowed = noticePolicy(false);
export const pushNoticeAllowed = noticePolicy(true);
export const noticeLink = `l.token = n.link_token AND l.required_scope = ${context} AND l.expires_at > ${at}`;
export const scopedNoticeReader = (source: "live_scope" | "snapshot_scope") =>
  `notice_scope AS MATERIALIZED (SELECT s.*, ${currentMembership("s", at)} AS membership_id FROM ${source} s)`;
