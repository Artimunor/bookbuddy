import { mediaFileSchema, mediaLimits } from "@bookbuddy/api-contract";
import type { MediaCaller } from "@bookbuddy/api-contract";
import { accessClock, at, liveTerm } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { chatScope, entryVisible } from "../chat/policy";
import { customer, foreman as commercialForeman, models, versionVisible } from "../commercial/policy";
import { currentMembership, scopedIntakeIds } from "../jobs/projections";
import { currentPerson, placeCapability } from "../places/policy";
import { confirmedWindow, foreman, jobOpen, provider } from "../schedule/policy";

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
  return `EXISTS (${Object.values(linkTables).map((table) =>
    `SELECT 1 FROM ${table} link WHERE link.attachment_id = ${id}`).join(" UNION ALL ")})`;
}

const job = `(SELECT base.*, p.state AS place_state, p.owner_id, p.named_approver_id,
    b.state AS business_state, r.submitted_at
  FROM jobs base JOIN places p ON p.id = base.place_id JOIN businesses b ON b.id = base.business_id
  LEFT JOIN requests r ON r.job_id = base.id)`;
const ownAssignment = `scope.role = 'worker' AND scope.business_id = j.business_id AND scope.membership_id = a.worker_membership_id
  AND a.state IN ('confirmed', 'completed') AND a.confirmed_at <= ${at}`;
const liveVisit = `v.state IN ('booked', 'finished') AND booked.id IS NOT NULL AND j.place_state <> 'restricted' AND j.state <> 'cancelled'`;
const allowedVisit = `((j.place_state IN ('in_area', 'out_of_area') AND ${customer("scope")}) OR ${foreman("scope")})`;
const caseGrant = `(scope.role IN ('provider_admin', 'foreman') AND scope.business_id = j.business_id
  AND scope.membership_id IS NOT NULL AND EXISTS (SELECT 1 FROM case_grants g
    WHERE g.case_id = pc.id AND g.context_id = scope.context_id AND g.capability = pc.provider_audience AND ${liveTerm("g")}))`;
const caseReporter = `pc.reporter_id = scope.account_id AND ${customer("scope")}`;
const caseOwner = `scope.role = 'customer' AND pc.case_owner_id = scope.account_id`;
const mayReport = `(${customer("scope")} AND (scope.account_id IN (j.owner_id, j.requester_id)
  OR ${placeCapability("j.place_id", "scope.account_id", "book")} OR ${placeCapability("j.place_id", "scope.account_id", "approve")}))`;
const hasPacket = `EXISTS (SELECT 1 FROM case_events e WHERE e.case_id = pc.id AND e.kind = 'provider_packet'
  AND e.audience = pc.provider_audience AND e.at <= ${at})`;

// Upload parents are currently writable records, not untrusted future IDs. New
// request/completion/report drafts use an existing place/job and their own stage ID.
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
      AND (${caseReporter} OR ${caseOwner} OR (${caseGrant} AND ${hasPacket}))) OR (
      NOT EXISTS (SELECT 1 FROM problem_cases WHERE id = ${id}) AND EXISTS (SELECT 1 FROM ${job} j
        WHERE j.id = ${id} AND j.state <> 'cancelled' AND ${mayReport})))`,
  quote: (id: string) => commercialDraft("quote", id),
  change: (id: string) => commercialDraft("change", id),
} satisfies Record<MediaCaller, (id: string) => string>;

function commercialDraft(kind: "quote" | "change", id: string) {
  return `EXISTS (SELECT 1 FROM ${models[kind].versions} v JOIN ${job} j ON j.id = v.job_id
    WHERE v.id = ${id} AND ${jobOpen()} AND v.state = 'draft' AND v.author_id = scope.account_id AND ${commercialForeman("scope")})`;
}

export function uploadAllowed(parent: string, caller?: MediaCaller) {
  if (caller) return writePolicy[caller](parent);
  return `(CASE stage.caller ${Object.entries(writePolicy).map(([kind, policy]) => `WHEN '${kind}' THEN ${policy(parent)}`).join(" ")} END)`;
}

const readers = {
  request: (id: string) => `SELECT l.attachment_id FROM request_attachments l JOIN ${job} j ON j.id = l.job_id
    WHERE l.job_id = ${id} AND (${customer("scope")} OR ${foreman("scope")} OR ${provider("scope")} OR EXISTS (
      ${scopedIntakeIds("live_scope", at, `j.id = ${id}`)}))`,
  chat: (id: string) => `SELECT l.attachment_id FROM entry_attachments l JOIN chat_entries e ON e.id = l.entry_id
    JOIN chat_scope t ON t.context_id = scope.context_id AND ${entryVisible("t", "e")} WHERE l.entry_id = ${id}`,
  progress: (id: string) => `SELECT l.attachment_id FROM shift_evidence l JOIN visit_activity_events e ON e.id = l.activity_event_id
    JOIN assignments a ON a.id = e.assignment_id JOIN shifts sh ON sh.id = l.shift_id
    JOIN visits v ON v.id = sh.visit_id JOIN ${job} j ON j.id = v.job_id WHERE l.shift_id = ${id}
      AND j.place_state <> 'restricted' AND j.state <> 'cancelled' AND v.state IN ('booked', 'finished') AND sh.state <> 'cancelled'
      AND e.at <= ${at} AND (${foreman("scope")} OR (${ownAssignment}))`,
  update: (id: string) => `SELECT l.attachment_id FROM update_attachments l JOIN customer_updates u ON u.id = l.update_id
    JOIN visits v ON v.id = u.visit_id JOIN ${job} j ON j.id = v.job_id ${confirmedWindow("v")}
    WHERE l.update_id = ${id} AND u.kind = 'photo' AND u.recorded_at <= ${at} AND ${liveVisit} AND ${allowedVisit}`,
  quote: (id: string) => commercialLinks("quote", id),
  change: (id: string) => commercialLinks("change", id),
  completion: (id: string) => `SELECT l.attachment_id FROM completion_attachments l JOIN completions c ON c.id = l.completion_id
    JOIN ${job} j ON j.id = c.job_id WHERE l.completion_item_id = ${id} AND c.submitted_at <= ${at}
      AND (${customer("scope")} OR ${commercialForeman("scope")})`,
  case: (id: string) => `SELECT l.attachment_id FROM case_attachments l JOIN case_events e ON e.id = l.case_event_id AND e.case_id = l.case_id
    JOIN problem_cases pc ON pc.id = e.case_id JOIN ${job} j ON j.id = pc.job_id
    WHERE l.case_event_id = ${id} AND e.at <= ${at} AND (
      (e.audience = 'reporter_and_owner' AND (${caseReporter} OR ${caseOwner})) OR
      (${caseGrant} AND ((e.kind = 'provider_packet' AND e.audience = pc.provider_audience)
        OR (e.kind = 'substantive_update' AND e.actor_id = scope.account_id))))`,
} satisfies Record<MediaCaller, (id: string) => string>;

function commercialLinks(kind: "quote" | "change", id: string) {
  const { ref, versions } = models[kind];
  return `SELECT l.attachment_id FROM ${linkTables[kind]} l JOIN ${versions} v ON v.id = l.${ref}
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
