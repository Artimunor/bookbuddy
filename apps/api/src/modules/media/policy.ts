import { mediaFileSchema, mediaLimits } from "@bookbuddy/api-contract";
import type { MediaCaller } from "@bookbuddy/api-contract";
import { accessClock, at, liveTerm } from "../access/policy";
import { casePacketExists, caseProviderGrant, caseSteward } from "../aftercare/case-policy";
import type { SessionAccess } from "../auth/session";
import { chatScope, entryVisible } from "../chat/policy";
import { customer, foreman as commercialForeman, models, versionVisible } from "../commercial/policy";
import { currentMembership, scopedIntakeIds } from "../jobs/projections";
import { currentPerson, placeCapability } from "../places/policy";
import { confirmedWindow, foreman, jobOpen, provider } from "../schedule/policy";
import { sessionsCustomerPlace } from "../sessions/policy";
import { mediaLinkDeadline, noMediaDeadline } from "./deadlines";

const photoMimes = mediaFileSchema.options[0].shape.mime.options;
const voiceMimes = mediaFileSchema.options[1].shape.mime.options;
export const photoMimeSql = photoMimes.map((mime) => `'${mime}'`).join(", ");
const voiceMimeSql = voiceMimes.map((mime) => `'${mime}'`).join(", ");

export function readyAttachmentSql(media: string, kind?: "photo" | "voice") {
  const photo = `${media}.mime IN (${photoMimeSql}) AND ${media}.bytes <= ${mediaLimits.photoBytes} AND ${media}.duration_ms IS NULL`;
  const voice = `${media}.mime IN (${voiceMimeSql}) AND ${media}.bytes <= ${mediaLimits.voiceBytes}
    AND ${media}.duration_ms BETWEEN 1 AND ${mediaLimits.voiceDurationMs}`;
  return `${media}.state = 'ready' AND (${media}.delete_after IS NULL OR ${media}.delete_after > ${at})
    AND (${kind === "photo" ? photo : kind === "voice" ? voice : `(${photo}) OR (${voice})`})`;
}

// Used by link commands in their own batch, after checking the exact parent authority.
export function stagedAttachmentSql(media: string, stage: string, caller: MediaCaller, context: string, parent: string, kind?: "photo" | "voice") {
  return `${readyAttachmentSql(media, kind)} AND ${stage}.caller = '${caller}' AND ${stage}.context_id = ${context}
    AND ${stage}.parent_scope_id = ${parent} AND ${stage}.created_at <= ${at} AND ${stage}.expires_at > ${at}`;
}

export const linkTables = {
  request: "request_attachments", chat: "entry_attachments", progress: "shift_evidence", update: "update_attachments",
  quote: "quote_attachments", change: "change_attachments", completion: "completion_attachments", case: "case_attachments",
} as const satisfies Record<MediaCaller, string>;

export function attachmentHasLink(id: string) {
  // Keep each indexed junction probe independent of D1's compound SELECT limit.
  return `(${Object.values(linkTables).map((table) =>
    `EXISTS (SELECT 1 FROM ${table} link WHERE link.attachment_id = ${id})`).join(" OR ")})`;
}

const job = `(SELECT base.*, p.state AS place_state, p.owner_id, p.named_approver_id,
    b.state AS business_state, r.submitted_at
  FROM jobs base JOIN places p ON p.id = base.place_id JOIN businesses b ON b.id = base.business_id
  LEFT JOIN requests r ON r.job_id = base.id)`;
const ownAssignment = `scope.role = 'worker' AND scope.business_id = j.business_id AND scope.membership_id = a.worker_membership_id
  AND a.state IN ('confirmed', 'completed') AND a.confirmed_at <= ${at}`;
const liveVisit = `v.state IN ('booked', 'finished') AND booked.id IS NOT NULL AND j.place_state <> 'restricted' AND j.state <> 'cancelled'`;
const caseGrant = caseProviderGrant("scope");
const caseReporter = `pc.reporter_id = scope.account_id AND ${customer("scope")}`;
const caseOwner = caseSteward("scope");
const mayReport = `(${customer("scope")} AND (scope.account_id IN (j.owner_id, j.requester_id)
  OR ${placeCapability("j.place_id", "scope.account_id", "book")} OR ${placeCapability("j.place_id", "scope.account_id", "approve")}))`;

// Upload parents are currently writable records, not untrusted future IDs. New
// request, completion, case and commercial drafts use a place/job and their own stage ID.
const writePolicy = {
  request: (id: string) => `EXISTS (SELECT 1 FROM places p JOIN place_people person ON person.place_id = p.id
    AND person.account_id = scope.account_id AND ${currentPerson("person")}
    WHERE p.id = ${id} AND scope.role = 'customer' AND p.state = 'in_area'
      AND ${placeCapability("p.id", "scope.account_id", "request")})`,
  chat: (id: string) => `EXISTS (SELECT 1 FROM chat_scope t WHERE t.id = ${id} AND t.context_id = scope.context_id AND t.can_send)`,
  progress: (id: string) => `EXISTS (SELECT 1 FROM assignments a JOIN shift_slots slot ON slot.id = a.slot_id
    JOIN shifts sh ON sh.id = slot.shift_id JOIN visits v ON v.id = sh.visit_id JOIN ${job} j ON j.id = v.job_id
    WHERE a.id = ${id} AND ${ownAssignment} AND sh.state <> 'cancelled' AND v.state IN ('booked', 'finished') AND ${jobOpen()})`,
  update: (id: string) => `EXISTS (SELECT 1 FROM visits v JOIN ${job} j ON j.id = v.job_id ${confirmedWindow("v")}
    WHERE v.id = ${id} AND ${liveVisit} AND v.state = 'booked' AND ${jobOpen()} AND ${foreman("scope")})`,
  completion: (id: string) => `EXISTS (SELECT 1 FROM ${job} j WHERE j.id = ${id} AND j.state = 'open'
    AND j.place_state IN ('in_area', 'out_of_area') AND ${commercialForeman("scope")}
    AND EXISTS (SELECT 1 FROM visits v JOIN visit_activity_events e ON e.visit_id = v.id AND e.kind = 'work_finished' AND e.at <= ${at}
      WHERE v.job_id = j.id AND v.kind = 'work' AND v.state = 'finished')
    AND NOT EXISTS (SELECT 1 FROM completions c WHERE c.job_id = j.id AND c.state IN ('submitted', 'signed_off')))`,
  case: (id: string) => `(EXISTS (SELECT 1 FROM problem_cases pc JOIN ${job} j ON j.id = pc.job_id
    WHERE pc.id = ${id} AND pc.opened_at <= ${at} AND pc.state IN ('open', 'awaiting_plan')
      AND (${caseReporter} OR ${caseOwner} OR (${caseGrant} AND ${casePacketExists}))) OR (
      NOT EXISTS (SELECT 1 FROM problem_cases WHERE id = ${id}) AND EXISTS (SELECT 1 FROM ${job} j
        WHERE j.id = ${id} AND j.state <> 'cancelled' AND ${mayReport})))`,
  quote: commercialDraft,
  change: commercialDraft,
} satisfies Record<MediaCaller, (id: string) => string>;

function commercialDraft(id: string) {
  return `EXISTS (SELECT 1 FROM ${job} j WHERE j.id = ${id} AND ${jobOpen()} AND ${commercialForeman("scope")})`;
}

export function uploadAllowed(parent: string, caller?: MediaCaller) {
  if (caller) return writePolicy[caller](parent);
  return `(CASE stage.caller ${Object.entries(writePolicy).map(([kind, policy]) => `WHEN '${kind}' THEN ${policy(parent)}`).join(" ")} END)`;
}

// A grant without a time limit uses a finite sentinel; an absent authorization
// stays NULL. Intersections cap by the earliest deadline of the required grants,
// while either of two independent authorized paths is sufficient.
const deadline = (table: string, where: string) => `(SELECT max(coalesce(g.valid_until, ${noMediaDeadline}))
  FROM ${table} g WHERE ${where} AND ${liveTerm("g")})`;
const placeDeadline = (place: string, account: string, capability: string) => deadline("place_grants",
  `g.place_id = ${place} AND g.account_id = ${account} AND g.capability = '${capability}'`);
const jobDeadline = (capability: string) => deadline("job_grants",
  `g.job_id = j.id AND g.context_id = scope.context_id AND g.capability = '${capability}'`);
const businessDeadline = (capability: string) => deadline("business_grants",
  `g.business_id = j.business_id AND g.membership_id = scope.membership_id AND g.capability = '${capability}'`);
const later = (...paths: string[]) => `max(${paths.map((path) => `coalesce(${path}, 0)`).join(", ")})`;
const customerRead = `CASE WHEN ${customer("scope")} THEN CASE WHEN j.owner_id = scope.account_id THEN ${noMediaDeadline}
  ELSE ${placeDeadline("j.place_id", "scope.account_id", "view")} END END`;
const foremanRead = `CASE WHEN scope.role = 'foreman' AND scope.business_id = j.business_id THEN
  CASE WHEN scope.membership_id = j.accountable_foreman_membership_id THEN ${noMediaDeadline}
    ELSE min(${jobDeadline("backup")}, ${businessDeadline("backup_foreman")}) END END`;
const intakeRead = `(SELECT max(min(h.expires_at, g.valid_until))
  FROM (${scopedIntakeIds("live_scope", at, "h.job_id = l.job_id")}) permitted
  JOIN job_handoffs h ON h.id = permitted.resource_id
  JOIN job_grants g ON g.job_id = h.job_id AND g.context_id = scope.context_id AND g.capability = 'intake' AND ${liveTerm("g")})`;
const caseRead = `CASE WHEN ${caseGrant} THEN ${deadline("case_grants",
  "g.case_id = pc.id AND g.context_id = scope.context_id AND g.capability = pc.provider_audience")} END`;
const chatRead = `CASE WHEN scope.role <> 'customer' THEN ${noMediaDeadline}
  WHEN t.audience = 'job' THEN ${placeDeadline("t.place_id", "scope.account_id", "message")}
  ELSE (SELECT max(CASE WHEN p.owner_id = scope.account_id THEN ${noMediaDeadline}
    ELSE ${placeDeadline("p.id", "scope.account_id", "view")} END)
    FROM place_people pp JOIN places p ON p.id = pp.place_id
    WHERE p.area_id = t.session_area_id AND ${sessionsCustomerPlace("p", "pp", "scope.account_id")}) END`;

const linkRow = (authorization: string, jobId?: string, purpose: "progress" | "ordinary" = "ordinary") =>
  `SELECT l.attachment_id, ${jobId ? `min((${authorization}), ${mediaLinkDeadline(jobId, "l.attachment_id", purpose)})` : authorization}
    AS authorized_through FROM media_actor scope CROSS JOIN`;

const readers = {
  request: (id: string) => `${linkRow(later(customerRead, foremanRead,
    `CASE WHEN ${provider("scope")} THEN ${noMediaDeadline} END`, intakeRead), "j.id")}
    request_attachments l JOIN ${job} j ON j.id = l.job_id WHERE l.job_id = ${id}`,
  chat: (id: string) => `${linkRow(chatRead, "t.job_id")}
    entry_attachments l JOIN chat_entries e ON e.id = l.entry_id
    JOIN chat_scope t ON t.context_id = scope.context_id AND ${entryVisible("t", "e")} WHERE l.entry_id = ${id}`,
  progress: (id: string) => `${linkRow(later(foremanRead, `CASE WHEN ${ownAssignment} THEN ${noMediaDeadline} END`), "j.id", "progress")}
    shift_evidence l JOIN visit_activity_events e ON e.id = l.activity_event_id
    JOIN assignments a ON a.id = e.assignment_id JOIN shifts sh ON sh.id = l.shift_id
    JOIN visits v ON v.id = sh.visit_id JOIN ${job} j ON j.id = v.job_id WHERE l.shift_id = ${id}
      AND j.place_state <> 'restricted' AND j.state <> 'cancelled' AND v.state IN ('booked', 'finished') AND sh.state <> 'cancelled'
      AND e.at <= ${at}`,
  update: (id: string) => `${linkRow(later(foremanRead, `CASE WHEN j.place_state IN ('in_area', 'out_of_area') THEN ${customerRead} END`), "j.id")}
    update_attachments l JOIN customer_updates u ON u.id = l.update_id
    JOIN visits v ON v.id = u.visit_id JOIN ${job} j ON j.id = v.job_id ${confirmedWindow("v")}
    WHERE l.update_id = ${id} AND u.kind = 'photo' AND u.recorded_at <= ${at} AND ${liveVisit}`,
  quote: (id: string) => commercialLinks("quote", id),
  change: (id: string) => commercialLinks("change", id),
  completion: (id: string) => `${linkRow(later(customerRead, `CASE WHEN ${commercialForeman("scope")} THEN ${noMediaDeadline} END`))}
    completion_attachments l JOIN completions c ON c.id = l.completion_id
    JOIN ${job} j ON j.id = c.job_id WHERE l.completion_item_id = ${id} AND c.submitted_at <= ${at}`,
  case: (id: string) => `${linkRow(later(
    `CASE WHEN e.audience = 'reporter_and_owner' THEN ${later(`CASE WHEN ${caseReporter} THEN ${customerRead} END`,
      `CASE WHEN ${caseOwner} THEN ${noMediaDeadline} END`)} END`,
    `CASE WHEN (e.kind = 'provider_packet' AND e.audience = pc.provider_audience)
      OR (e.kind = 'substantive_update' AND e.actor_id = scope.account_id) THEN ${caseRead} END`))}
    case_attachments l JOIN case_events e ON e.id = l.case_event_id AND e.case_id = l.case_id
    JOIN problem_cases pc ON pc.id = e.case_id JOIN ${job} j ON j.id = pc.job_id
    WHERE l.case_event_id = ${id} AND e.at <= ${at}`,
} satisfies Record<MediaCaller, (id: string) => string>;

function commercialLinks(kind: "quote" | "change", id: string) {
  const { ref, versions } = models[kind];
  const reviewer = `min(${businessDeadline("review_commercial")}, ${later(
    `CASE WHEN review.reviewer_id = scope.account_id THEN ${jobDeadline("reviewer")} END`,
    `CASE WHEN review.backup_id = scope.account_id AND review.due_at <= ${at} THEN ${jobDeadline("backup")} END`)})`;
  return `${linkRow(`CASE WHEN scope.role = 'customer' THEN ${customerRead}
    WHEN ${commercialForeman("scope")} AND (v.issued_at IS NOT NULL OR v.author_id = scope.account_id) THEN ${noMediaDeadline}
    ELSE ${reviewer} END`)}
    ${linkTables[kind]} l JOIN ${versions} v ON v.id = l.${ref}
    JOIN ${job} j ON j.id = v.job_id LEFT JOIN commercial_reviews review ON review.${ref} = v.id
    WHERE l.${ref} = ${id} AND ${versionVisible(kind, "scope")}`;
}

export function readLinks(caller: MediaCaller, parent: string) {
  return readers[caller](parent);
}

export function mediaActor(session: SessionAccess, now: number, chatFilter?: { sql: string; values: readonly string[] }): SessionAccess {
  const access = chatFilter ? chatScope(session, now, { sql: chatFilter.sql, params: chatFilter.values }) : accessClock(session, now);
  return { params: access.params, sql: `${access.sql}, media_actor AS MATERIALIZED (
    SELECT scope.*, s.expires_at AS session_expires_at, ${currentMembership("scope", at)} AS membership_id
    FROM live_scope scope JOIN acting_session s ON s.session_id = scope.session_id)` };
}
