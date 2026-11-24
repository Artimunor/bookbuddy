import { coverViewSchema } from "@bookbuddy/api-contract";
import type {
  acceptCoverRoute, closeCoverRoute, confirmCoverRoute, declineCoverRoute, ErrorBody, issueCoverRoute,
  releaseCoverRoute, RouteResponse, withdrawCoverRoute,
} from "@bookbuddy/api-contract";
import { COVER_POLICY } from "@bookbuddy/domain";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { planOperation, recordSyncChanges } from "../../db/operations";
import type { OperationResult, OperationSpec } from "../../db/operations";
import type { RequestScope } from "../../db/scope";
import { accessClock, at, currentCheck, displayName, eligibilityCutoff, eligibilityStatus, scopedStatement } from "../access/policy";
import { randomToken } from "../auth/crypto";
import { liveContextPredicate } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { currentMembership, memberJson } from "../jobs/projections";
import { foreman, jobOpen } from "../schedule/policy";
import { crewAvailabilityKind, workerAgendaKind } from "../schedule/projections";
import type { SyncProjectionReader } from "../sync/registry";

interface CoverBodies {
  issue: RouteResponse<typeof issueCoverRoute.input>["body"];
  accept: RouteResponse<typeof acceptCoverRoute.input>["body"];
  decline: RouteResponse<typeof declineCoverRoute.input>["body"];
  withdraw: RouteResponse<typeof withdrawCoverRoute.input>["body"];
  release: RouteResponse<typeof releaseCoverRoute.input>["body"];
  close: RouteResponse<typeof closeCoverRoute.input>["body"];
  confirm: RouteResponse<typeof confirmCoverRoute.input>["body"];
}
type Verb = keyof CoverBodies;
type CoverAction = { [V in Verb]: { verb: V; body: CoverBodies[V] } }[Verb];

const { confirmationMs, defaultReplyMs, maxDispatchesPerGap, minimumReplyMs } = COVER_POLICY;
const defaultStaffingLeadMs = 20 * 60_000;
const coverKind = "cover";
const offerLinkKind = "cover_offer";
const noticeKinds = { issue: "cover_offer", accept: "cover_accepted" } as const;

// This target includes business, job and visit scope but deliberately never reads
// the address, place alias, customer name, or chat membership.
function target(gap: string) {
  return `SELECT j.id, j.reference, j.business_id, j.accountable_foreman_membership_id, j.state,
    p.state AS place_state, b.state AS business_state, b.public_name AS business_name,
    g.id AS gap_id, g.slot_id, g.safe_cutoff, g.current_round_no, g.state AS gap_state, g.revision,
    g.closed_at, g.revised_window_id, prior.worker_membership_id AS prior_worker, prior.dropped_at,
    sh.id AS shift_id, sh.starts_at, sh.ends_at, sh.state AS shift_state, sh.skill, sh.briefing_language,
    coalesce(nullif(j.trade, ''), sh.skill) AS task, coalesce(p.site_zone, area.site_zone) AS site_zone, area.name AS town,
    v.id AS visit_id, v.state AS visit_state, r.state AS round_state, r.opened_at, r.winner_offer_id,
    r.accepted_at, r.confirm_by, r.ended_at AS round_ended_at,
    d.dispatch_no, d.state AS dispatch_state, d.issued_at, d.reply_until, d.closed_at AS dispatch_closed_at
  FROM cover_gaps g JOIN assignments prior ON prior.id = g.prior_assignment_id
  JOIN shift_slots slot ON slot.id = g.slot_id JOIN shifts sh ON sh.id = slot.shift_id
  JOIN visits v ON v.id = sh.visit_id JOIN jobs j ON j.id = v.job_id JOIN places p ON p.id = j.place_id
  JOIN businesses b ON b.id = j.business_id JOIN operating_areas area ON area.id = coalesce(p.area_id, b.catchment_id)
  LEFT JOIN cover_rounds r ON r.gap_id = g.id AND r.round_no = g.current_round_no
  LEFT JOIN cover_dispatches d ON d.gap_id = r.gap_id AND d.dispatch_no = r.dispatch_no WHERE ${gap}`;
}

const workerScope = (scope: string, g: string) => `(${scope}.role = 'worker' AND ${scope}.business_id = ${g}.business_id)`;
const ownsOffer = (scope: string, g: string, offer: string) => `${workerScope(scope, g)} AND ${offer}.recipient_id = ${currentMembership(scope, at)}`;
const foremanScope = (scope: string, g: string) => `(${currentMembership(scope, at)} IS NOT NULL AND ${foreman(scope, g)})`;
const vacant = (g: string) => `(${jobOpen(g)} AND ${g}.visit_state = 'booked' AND ${g}.shift_state = 'planned'
  AND ${g}.starts_at > ${at} AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.slot_id = ${g}.slot_id AND a.state = 'confirmed')
  AND NOT EXISTS (SELECT 1 FROM assignment_offers a WHERE a.slot_id = ${g}.slot_id AND a.state = 'offered' AND a.expires_at > ${at}))`;
const cutoff = (g: string) => `min(${g}.safe_cutoff, ${g}.starts_at)`;
const replyDeadline = (g: string) => `min(${at} + ${defaultReplyMs}, ${cutoff(g)} - ${confirmationMs})`;
const holdAlive = (g: string) => `(${g}.gap_state = 'accepted_pending_confirmation' AND ${g}.round_state = 'accepted_pending_confirmation'
  AND ${g}.accepted_at <= ${at} AND min(${g}.confirm_by, ${cutoff(g)}) > ${at})`;

function workerContexts(g: string, predicate: string, columns: string) {
  return `SELECT ${columns} FROM memberships m JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
    JOIN membership_roles role ON role.membership_id = m.id AND role.role = 'worker' AND role.revoked_at IS NULL AND role.granted_at <= ${at}
    JOIN account_contexts c ON c.role_grant_id = role.id
    WHERE m.business_id = ${g}.business_id AND m.state = 'active' AND (${predicate})`;
}

const foremanMember = currentMembership("fc", at).replace("fc.context_id", "fc.id");
const activeForeman = (g: string) => `fc.business_id = ${g}.business_id AND fc.role = 'foreman'
  AND a.state = 'active' AND ${liveContextPredicate.replaceAll("c.", "fc.")}
  AND ${foremanScope("fc", g).replaceAll("fc.context_id", "fc.id")}`;

const overlap = (row: string, g: string) => `${row}.starts_at < ${g}.ends_at AND ${row}.ends_at > ${g}.starts_at`;
const dated = (row: string, member: string) => `${row}.membership_id = ${member} AND ${row}.recorded_at <= ${at}`;

function timing(g: string) {
  // Dated employer duty is authoritative. Opt-in/recurring preferences aren't
  // duty or a commitment; recorded unavailable/rest intervals always veto it.
  const available = `SELECT h.starts_at, h.ends_at, max(h.ends_at) OVER (ORDER BY h.starts_at, h.ends_at, h.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_end
    FROM availability_intervals h WHERE ${dated("h", "m.id")} AND h.kind IN ('available', 'duty') AND ${overlap("h", g)}`;
  return `EXISTS (SELECT 1 FROM availability_intervals h WHERE ${dated("h", "m.id")}
      AND h.kind = 'duty' AND h.starts_at <= ${at} AND h.ends_at > ${at})
    AND NOT EXISTS (SELECT 1 FROM availability_intervals h WHERE ${dated("h", "m.id")}
      AND h.kind = 'unavailable' AND h.starts_at <= ${at} AND h.ends_at > ${at}) AS on_duty,
    EXISTS (SELECT 1 FROM availability_intervals h WHERE ${dated("h", "m.id")}
      AND h.kind = 'unavailable' AND ${overlap("h", g)}) AS unavailable,
    EXISTS (SELECT count(*) FROM (${available}) HAVING count(*) > 0 AND min(starts_at) <= ${g}.starts_at
      AND max(ends_at) >= ${g}.ends_at AND max(CASE WHEN starts_at > previous_end THEN 1 ELSE 0 END) = 0) AS covered`;
}

function busyWindow(g: string) {
  return `(SELECT json_object('startsAt', starts_at, 'endsAt', ends_at) FROM (
    SELECT a.starts_at, a.ends_at FROM memberships peer JOIN assignments a ON a.worker_membership_id = peer.id
    WHERE peer.account_id = m.account_id AND a.state = 'confirmed' AND ${overlap("a", g)}
    UNION ALL
    SELECT sh.starts_at, sh.ends_at FROM memberships peer JOIN cover_offers o ON o.recipient_id = peer.id
    JOIN cover_gaps other ON other.id = o.gap_id AND other.state = 'accepted_pending_confirmation' AND other.id <> ${g}.gap_id
    JOIN cover_rounds r ON r.gap_id = other.id AND r.round_no = other.current_round_no
      AND r.winner_offer_id = o.id AND r.state = 'accepted_pending_confirmation' AND r.confirm_by > ${at}
    JOIN shift_slots slot ON slot.id = other.slot_id JOIN shifts sh ON sh.id = slot.shift_id
    JOIN visits v ON v.id = sh.visit_id AND v.state = 'booked'
    WHERE peer.account_id = m.account_id AND o.state = 'offered' AND sh.state = 'planned' AND ${overlap("sh", g)}
      AND min(other.safe_cutoff, sh.starts_at) > ${at}
    ORDER BY starts_at, ends_at LIMIT 1))`;
}

function fits(g: string, predicate: string) {
  const check = `(SELECT e.id FROM eligibility_checks e WHERE e.business_id = m.business_id AND e.membership_id = m.id
    AND e.trade = ${g}.skill AND e.work_language = ${g}.briefing_language AND e.scope = 'internal'
    AND (e.checked_at IS NULL OR e.checked_at <= ${at}) AND ${currentCheck("e")} LIMIT 1)`;
  return workerContexts(g, `m.id <> ${g}.prior_worker AND (${predicate})`, `m.id, ${displayName("a")} AS name,
    EXISTS (SELECT 1 FROM member_skills sk WHERE sk.membership_id = m.id AND sk.tag = ${g}.skill) AS skilled,
    EXISTS (SELECT 1 FROM member_languages l WHERE l.membership_id = m.id AND l.tag = ${g}.briefing_language) AS briefable,
    (SELECT ${eligibilityCutoff("e")} FROM eligibility_checks e WHERE e.id = ${check}) AS valid_until,
    coalesce((SELECT ${eligibilityStatus("e")} FROM eligibility_checks e WHERE e.id = ${check}), 'pending') AS eligibility,
    ${timing(g)}, ${busyWindow(g)} AS busy_window`);
}

const available = (f: string) => `(${f}.covered AND NOT ${f}.unavailable AND ${f}.busy_window IS NULL)`;
const eligible = (f: string, g: string) => `(${f}.skilled AND ${f}.briefable AND ${f}.eligibility IN ('approved', 'expiring')
  AND ${f}.valid_until >= ${g}.ends_at)`;
const fitToCover = (f: string, g: string) => `(${eligible(f, g)} AND ${available(f)} AND ${f}.on_duty)`;
const canCover = (g: string, member: string) => `EXISTS (SELECT 1 FROM (${fits(g, `m.id = ${member}`)}) f WHERE ${fitToCover("f", g)})`;
const bool = (sql: string) => `json(CASE WHEN ${sql} THEN 'true' ELSE 'false' END)`;
const span = (row: string) => `json_object('startsAt', ${row}.starts_at, 'endsAt', ${row}.ends_at)`;
const list = (rows: string) => `(SELECT json_group_array(json(value)) FROM (${rows}))`;
const tags = (table: "member_skills" | "member_languages", member: string) => `(SELECT json_group_array(tag) FROM (
  SELECT tag FROM ${table} WHERE membership_id = ${member} ORDER BY tag))`;
const accountName = (id: string) => `(SELECT ${displayName("a")} FROM accounts a WHERE a.id = ${id})`;
const availabilityJson = (f: string) => `CASE WHEN ${f}.busy_window IS NOT NULL THEN
  json_patch(json_object('state', 'busy'), json_object('window', json(${f}.busy_window)))
  ELSE json_object('state', CASE WHEN ${f}.unavailable THEN 'unavailable' WHEN ${f}.covered THEN 'free' ELSE 'unknown' END) END`;
const fitJson = (f: string, g: string) => `json_object('result', CASE
  WHEN NOT coalesce(${eligible(f, g)}, 0) THEN 'not_eligible'
  WHEN ${f}.busy_window IS NOT NULL OR ${f}.unavailable THEN 'conflict'
  WHEN ${available(f)} THEN 'available' ELSE 'checking' END, 'checkedAt', ${at},
  'skillMatches', ${bool(`${f}.skilled`)}, 'briefingLanguageMatches', ${bool(`${f}.briefable`)},
  'availability', json(${availabilityJson(f)}), 'eligibility', json_object('state', coalesce(${f}.eligibility, 'pending'), 'validUntil', ${f}.valid_until))`;

const unanswered = (o: string) => `(${o}.state = 'offered' AND ${o}.expires_at > ${at}
  AND NOT EXISTS (SELECT 1 FROM cover_rounds won WHERE won.gap_id = ${o}.gap_id
    AND won.dispatch_no = ${o}.dispatch_no AND won.winner_offer_id = ${o}.id))`;
const liveOffers = (g: string) => `(${g}.dispatch_state = 'open' AND ${g}.reply_until > ${at}
  AND EXISTS (SELECT 1 FROM cover_offers o WHERE o.gap_id = ${g}.gap_id AND o.dispatch_no = ${g}.dispatch_no AND ${unanswered("o")}))`;
const reusableDispatch = (g: string) => `(${vacant(g)} AND ${liveOffers(g)}
  AND min(${g}.reply_until, ${cutoff(g)} - ${confirmationMs}) >= ${at} + ${minimumReplyMs}
  AND EXISTS (SELECT 1 FROM cover_offers o WHERE o.gap_id = ${g}.gap_id AND o.dispatch_no = ${g}.dispatch_no
    AND ${unanswered("o")} AND ${canCover(g, "o.recipient_id")}))`;
const hasOffersOut = (g: string) => `(${g}.gap_state = 'open' AND ${g}.round_state = 'open' AND ${liveOffers(g)} AND ${vacant(g)})`;
const canIssue = (g: string, count: string) => `(${vacant(g)} AND ${g}.gap_state IN ('open', 'accepted_pending_confirmation')
  AND NOT coalesce(${holdAlive(g)}, 0) AND NOT coalesce(${hasOffersOut(g)}, 0)
  AND NOT coalesce(${reusableDispatch(g)}, 0) AND ${count} < ${maxDispatchesPerGap}
  AND ${replyDeadline(g)} >= ${at} + ${minimumReplyMs})`;

const joinedOffer = (g: string, predicate: string) => `FROM cover_offers o
  JOIN cover_dispatches d ON d.gap_id = o.gap_id AND d.dispatch_no = o.dispatch_no
  LEFT JOIN cover_rounds won ON won.gap_id = o.gap_id AND won.dispatch_no = o.dispatch_no AND won.winner_offer_id = o.id
  LEFT JOIN assignments assigned ON assigned.cover_gap_id = o.gap_id AND won.state = 'confirmed'
  WHERE o.gap_id = ${g}.gap_id AND (${predicate}) ORDER BY o.dispatch_no DESC LIMIT 1`;

function offerState(g: string) {
  return `CASE WHEN assigned.id IS NOT NULL THEN 'confirmed' WHEN o.state <> 'offered' THEN o.state
    WHEN won.round_no = ${g}.current_round_no AND ${holdAlive(g)} THEN 'held'
    WHEN won.round_no IS NOT NULL THEN 'not_confirmed'
    WHEN ${g}.gap_state = 'filled' AND o.dispatch_no = ${g}.dispatch_no THEN 'filled_elsewhere'
    WHEN o.dispatch_no = ${g}.dispatch_no AND ${holdAlive(g)} AND o.expires_at > ${at} THEN 'on_hold'
    WHEN o.dispatch_no = ${g}.dispatch_no AND ${hasOffersOut(g)} AND o.expires_at > ${at} THEN 'offered'
    ELSE 'expired' END`;
}

function offerEndedAt(g: string, state: string) {
  return `CASE ${state} WHEN 'not_confirmed' THEN coalesce(won.ended_at, min(won.confirm_by, ${cutoff(g)}))
    WHEN 'filled_elsewhere' THEN ${g}.round_ended_at
    WHEN 'expired' THEN min(o.expires_at, coalesce(d.closed_at, o.expires_at), coalesce(${g}.closed_at, o.expires_at), ${at})
    ELSE o.responded_at END`;
}

const offerSummary = (g: string) => `'kind', 'cover', 'offerId', o.id, 'town', ${g}.town, 'task', ${g}.task,
  'skill', ${g}.skill, 'briefingLanguage', ${g}.briefing_language, 'siteZone', ${g}.site_zone,
  'window', ${span(g)}, 'replyBy', o.expires_at, 'foremanName', ${accountName("d.issued_by")}`;
const offerDetails = (g: string) => `'businessName', ${g}.business_name, 'sentAt', d.issued_at,
  'workingLanguages', json(${tags("member_languages", "o.recipient_id")})`;
const heldOffer = (g: string, round: string, revision: string) => `${offerSummary(g)}, 'state', 'accepted_pending_confirmation',
  'gapId', ${g}.gap_id, 'roundNo', ${round}.round_no, 'revision', ${revision}, 'acceptedAt', ${round}.accepted_at, 'confirmBy', ${round}.confirm_by`;
const confirmedOffer = (g: string) => `json_object('kind', 'cover', 'state', 'confirmed', 'offerId', o.id, 'assignmentId', assigned.id,
  'shiftId', ${g}.shift_id, 'confirmedAt', assigned.confirmed_at, 'confirmedByName', ${accountName("assigned.confirmed_by")}, 'siteZone', ${g}.site_zone)`;
const terminalOffer = (g: string, state: string, ended: string) => `json_object('kind', 'cover', 'state', ${state},
  'offerId', o.id, 'endedAt', ${ended}, 'siteZone', ${g}.site_zone)`;

function workerOffer(g: string, scope: string, exact = "1") {
  const state = offerState(g);
  return `(SELECT CASE ${state}
    WHEN 'confirmed' THEN ${confirmedOffer(g)}
    WHEN 'held' THEN json_object(${heldOffer(g, "won", `${g}.revision`)}, ${offerDetails(g)})
    WHEN 'on_hold' THEN json_object(${offerSummary(g)}, 'state', 'on_hold')
    WHEN 'offered' THEN json_object(${offerSummary(g)}, ${offerDetails(g)}, 'state', 'offered',
      'gapId', ${g}.gap_id, 'roundNo', ${g}.current_round_no, 'revision', ${g}.revision, 'availability', json(coalesce(
        (SELECT ${availabilityJson("f")} FROM (${fits(g, "m.id = o.recipient_id")}) f), json_object('state', 'unknown'))))
    ELSE ${terminalOffer(g, state, offerEndedAt(g, state))} END
    ${joinedOffer(g, `${ownsOffer(scope, g, "o")} AND (${exact})`)})`;
}

const candidateResponse = (g: string) => `(SELECT json_object('offerId', o.id, 'state', ${offerState(g)},
  'at', coalesce(o.responded_at, assigned.confirmed_at, CASE ${offerState(g)} WHEN 'held' THEN won.accepted_at
    WHEN 'on_hold' THEN ${g}.accepted_at WHEN 'offered' THEN d.issued_at ELSE ${offerEndedAt(g, offerState(g))} END),
  'declineReason', o.decline_reason) ${joinedOffer(g, "o.recipient_id = f.id")})`;

const customerUpdateId = (kind: "cover_arranging" | "crew_updated", gap: string) => `'${kind}-' || ${gap}`;
function foremanCover(g: string, scope: string) {
  const issuable = `${canIssue(g, "dispatches.used")} AND EXISTS (SELECT 1 FROM crew f WHERE ${fitToCover("f", g)})`;
  return `(WITH crew AS MATERIALIZED (${fits(g, "1")}), dispatches AS (
    SELECT count(*) AS used FROM cover_dispatches d WHERE d.gap_id = ${g}.gap_id
  ), holder AS MATERIALIZED (
    SELECT o.recipient_id, f.* FROM cover_offers o LEFT JOIN crew f ON f.id = o.recipient_id WHERE o.id = ${g}.winner_offer_id
  ) SELECT json_object('audience', 'foreman', 'gapId', ${g}.gap_id, 'slotId', ${g}.slot_id,
    'shift', json_object('shiftId', ${g}.shift_id, 'reference', ${g}.reference, 'window', ${span(g)},
      'siteZone', ${g}.site_zone, 'task', ${g}.task, 'skill', ${g}.skill, 'briefingLanguage', ${g}.briefing_language),
    'safeCutoff', ${g}.safe_cutoff, 'revision', ${g}.revision, 'currentRoundNo', ${g}.current_round_no, 'dispatchesUsed', dispatches.used,
    'status', json(CASE
      WHEN ${g}.gap_state = 'filled' THEN (SELECT json_object('state', 'confirmed', 'assignmentId', a.id,
        'worker', json(${memberJson("a.worker_membership_id")}), 'confirmedAt', a.confirmed_at,
        'confirmedByName', ${accountName("a.confirmed_by")}, 'confirmedByViewer', ${bool(`a.confirmed_by = ${scope}.account_id`)})
        FROM assignments a WHERE a.cover_gap_id = ${g}.gap_id)
      WHEN ${g}.gap_state = 'closed' AND ${g}.revised_window_id IS NOT NULL THEN (SELECT json_object('state', 'new_visit_proposed',
        'proposedAt', w.proposed_at, 'windowId', w.id, 'window', ${span("w")}) FROM visit_windows w WHERE w.id = ${g}.revised_window_id)
      WHEN ${g}.gap_state = 'closed' THEN json_object('state', 'no_cover', 'endedAt', ${g}.closed_at)
      WHEN ${holdAlive(g)} THEN (SELECT json_object('state', 'accepted_pending_confirmation', 'hold', json_object(
        'offerId', ${g}.winner_offer_id, 'worker', json(${memberJson("h.recipient_id")}), 'acceptedAt', ${g}.accepted_at,
        'confirmBy', ${g}.confirm_by, 'fit', json(${fitJson("h", g)}), 'onDuty', ${bool("h.on_duty")}, 'gapStillOpen', ${bool(vacant(g))})) FROM holder h)
      WHEN ${hasOffersOut(g)} THEN json_object('state', 'offers_out', 'sentAt', ${g}.issued_at, 'replyBy', ${g}.reply_until)
      WHEN ${issuable} OR ${g}.dispatch_no IS NULL THEN json_object('state', 'gap', 'reportedAt', ${g}.dropped_at)
      ELSE json_object('state', 'no_cover', 'endedAt', max(${g}.dropped_at, min(${at},
        coalesce(${g}.round_ended_at, ${g}.confirm_by, ${g}.reply_until, ${g}.safe_cutoff)))) END),
    'candidates', json(${list(`SELECT json_object('membershipId', f.id, 'displayName', f.name,
      'skills', json(${tags("member_skills", "f.id")}), 'workingLanguages', json(${tags("member_languages", "f.id")}),
      'openToCoverUntil', (SELECT max(h.ends_at) FROM availability_intervals h WHERE ${dated("h", "f.id")}
        AND h.open_to_cover = 1 AND h.starts_at <= ${at} AND h.ends_at > ${at}),
      'fit', ${fitJson("f", g)}, 'onDuty', ${bool("f.on_duty")}, 'response', json(${candidateResponse(g)})) AS value
      FROM crew f ORDER BY f.name, f.id`)}),
    'customerUpdate', json(coalesce((SELECT json_object('state', 'published', 'kind', u.kind,
      'publishedAt', u.recorded_at, 'nextUpdateAt', u.next_update_at) FROM customer_updates u WHERE u.visit_id = ${g}.visit_id
      AND u.id IN (${customerUpdateId("crew_updated", `${g}.gap_id`)}, ${customerUpdateId("cover_arranging", `${g}.gap_id`)})
      ORDER BY u.kind = 'crew_updated' DESC LIMIT 1), json_object('state', 'not_shared'))),
    'actions', json_object('canIssue', ${bool(issuable)}, 'canClose', ${bool(`${g}.gap_state IN ('open', 'accepted_pending_confirmation')
      AND NOT coalesce(${holdAlive(g)}, 0)`)}, 'canRelease', ${bool(`${g}.gap_state = 'accepted_pending_confirmation'`)},
      'canConfirm', ${bool(`${holdAlive(g)} AND ${vacant(g)} AND EXISTS (SELECT 1 FROM holder h WHERE ${fitToCover("h", g)})`)})) FROM dispatches)`;
}

function workerView(g: string, scope: string, exact?: string) {
  return `(SELECT json_object('audience', 'worker', 'offer', json(offer))
    FROM (SELECT ${workerOffer(g, scope, exact)} AS offer LIMIT 1) WHERE offer IS NOT NULL)`;
}

function view(g: string, scope: string) {
  return `CASE WHEN ${foremanScope(scope, g)} THEN ${foremanCover(g, scope)} ELSE ${workerView(g, scope)} END`;
}

export function readCover(session: SessionAccess, now: number, gapId: string): CommandStatement {
  return scopedStatement(accessClock(session, now), `SELECT (SELECT ${view("g", "scope")}
    FROM live_scope scope CROSS JOIN (${target("g.id = ?")}) g) AS value FROM acting_session`, gapId);
}

function linkProjection(gap: string, projection: string) {
  return `(SELECT json_object('kind', 'cover', 'cover', json(value)) FROM (
    SELECT ${projection} AS value FROM (${target(`g.id = ${gap}`)}) g LIMIT 1
  ) WHERE value IS NOT NULL)`;
}

export const coverLinkResolver = {
  cover: { targetKind: "shift", project: (resource: string, scope: string) =>
    linkProjection(resource, `CASE WHEN ${foremanScope(scope, "g")} THEN ${foremanCover("g", scope)} END`) },
  cover_offer: { targetKind: "offer", project: (resource: string, scope: string) =>
    linkProjection(`(SELECT gap_id FROM cover_offers WHERE id = ${resource})`, workerView("g", scope, `o.id = ${resource}`)) },
} as const;

function coverAudience(scope: string, g: string) {
  return `(${foremanScope(scope, g)} OR (${workerScope(scope, g)} AND EXISTS (SELECT 1 FROM cover_offers o
    WHERE o.gap_id = ${g}.gap_id AND ${ownsOffer(scope, g, "o")})))`;
}

export const coverSyncProjection: SyncProjectionReader = {
  kind: coverKind, schema: coverViewSchema,
  snapshotIds: (now) => ({ sql: `WITH clock(at) AS (VALUES (?)) SELECT g.gap_id AS resource_id
    FROM snapshot_scope scope CROSS JOIN (${target("g.state IN ('open', 'accepted_pending_confirmation')")}) g
    WHERE g.gap_id > scope.after_id AND ${coverAudience("scope", "g")}`, params: [now] }),
  project: (now) => ({ sql: `WITH clock(at) AS (VALUES (?)) SELECT g.gap_id AS resource_id, ${view("g", "scope")} AS value
    FROM live_scope scope CROSS JOIN (${target(`g.id IN (SELECT resource_id FROM projection_keys WHERE kind = '${coverKind}')`)}) g
    WHERE ${coverAudience("scope", "g")}`, params: [now] }),
};

function changedCover(workerWhere?: string) {
  const foremen = `SELECT '${coverKind}' AS kind, g.gap_id AS resource_id, fc.id AS partition_key, 'upsert' AS op, ${at} AS at
    FROM cover_target g JOIN account_contexts fc ON fc.business_id = g.business_id JOIN accounts a ON a.id = fc.account_id
    WHERE ${activeForeman("g")}`;
  if (!workerWhere) return foremen;
  return `${foremen}
    UNION ALL SELECT k.kind, CASE WHEN k.kind = '${coverKind}' THEN g.gap_id ELSE m.id END, c.id, 'upsert', ${at}
    FROM cover_target g JOIN memberships m ON m.business_id = g.business_id AND m.state = 'active'
    JOIN membership_roles role ON role.membership_id = m.id AND role.role = 'worker' AND role.revoked_at IS NULL AND role.granted_at <= ${at}
    JOIN account_contexts c ON c.role_grant_id = role.id JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
    CROSS JOIN (SELECT '${coverKind}' AS kind UNION ALL SELECT '${workerAgendaKind}') k
    WHERE EXISTS (SELECT 1 FROM cover_offers o WHERE o.gap_id = g.gap_id AND o.recipient_id = m.id AND (${workerWhere}))`;
}

// Append after the guarded dropout UPDATE, in the same command batch. A dropout
// opens history for the foreman; it does not publish an unreviewed customer update.
export function openGapStatements(guard: CommandStatement, input: {
  assignmentId: string; gapId: string; droppedAt: number; safeCutoff?: number;
}): CommandStatement[] {
  const { assignmentId, gapId, droppedAt, safeCutoff } = input;
  const gapAccess = { sql: `WITH clock(at) AS (VALUES (?)), cover_target AS MATERIALIZED (${target("g.id = ?")})`, params: [droppedAt, gapId] };
  return [{ sql: `INSERT INTO cover_gaps (id, slot_id, prior_assignment_id, safe_cutoff, state)
      SELECT ?, a.slot_id, a.id, min(sh.starts_at, coalesce(?, sh.starts_at - ${defaultStaffingLeadMs})), 'open'
      FROM assignments a JOIN shift_slots slot ON slot.id = a.slot_id JOIN shifts sh ON sh.id = slot.shift_id
      WHERE a.id = ? AND a.state = 'dropped' AND a.dropped_at = ? AND ${guard.sql}`,
    params: [gapId, safeCutoff ?? null, assignmentId, droppedAt, ...guard.params ?? []] },
  recordSyncChanges(guard, scopedStatement(gapAccess, changedCover()))];
}

const expectedRound = "(SELECT round_no FROM cover_expected)";
const expectedRevision = "(SELECT revision FROM cover_expected)";
const selectedOffer = "(SELECT offer_id FROM cover_expected)";
const matchingEpoch = `g.revision = ${expectedRevision} AND g.current_round_no IS ${expectedRound}`;
const gapKey = "(SELECT gap_id FROM cover_target)";
const heldState = `g.gap_state = 'accepted_pending_confirmation' AND g.round_state = 'accepted_pending_confirmation' AND g.accepted_at <= ${at}`;
const confirmable = `${holdAlive("g")} AND ${vacant("g")} AND o.state = 'offered' AND ${canCover("g", "o.recipient_id")}`;
const epochOffer = `o.dispatch_no = g.dispatch_no AND ${hasOffersOut("g")} AND g.opened_at <= ${at} AND ${unanswered("o")}`;
const completedRound = `EXISTS (SELECT 1 FROM cover_rounds r WHERE r.gap_id = g.gap_id AND r.round_no = ${expectedRound}
  AND r.winner_offer_id IS NOT NULL AND r.state IN ('confirmed', 'closed'))`;
const signedWorkerOffer = "JOIN cover_offers o ON o.gap_id = g.gap_id AND o.id = " + selectedOffer;
const workerFront = (predicate: string) => `EXISTS (SELECT 1 FROM cover_target g ${signedWorkerOffer} WHERE ${predicate})`;
const foremanFront = (predicate: string) => `EXISTS (SELECT 1 FROM cover_target g WHERE ${predicate})`;

function closeDispatch(access: SessionAccess, guard: CommandStatement, additional = "1") {
  return scopedStatement(access, `UPDATE cover_dispatches SET state = 'closed', closed_at = max(issued_at, ${at})
    WHERE gap_id = ${gapKey} AND state = 'open' AND (${additional}) AND ${guard.sql}`, ...guard.params ?? []);
}

function endRound(access: SessionAccess, guard: CommandStatement, wroteAssignment?: string) {
  const confirmed = wroteAssignment ? `EXISTS (SELECT 1 FROM assignments WHERE id = ?)` : "0";
  return scopedStatement(access, `UPDATE cover_rounds SET state = CASE WHEN ${confirmed} THEN 'confirmed' ELSE 'closed' END,
    ended_at = max(opened_at, coalesce(accepted_at, opened_at), min(${at}, coalesce(confirm_by, ${at})))
    WHERE gap_id = ${gapKey} AND round_no = ${expectedRound} AND state IN ('open', 'accepted_pending_confirmation') AND ${guard.sql}`,
  ...wroteAssignment ? [wroteAssignment] : [], ...guard.params ?? []);
}

// A closed acceptance round retains its winner. Reuse only a dispatch that can
// still run safely, and publish a fresh epoch without reissuing the offer rows.
function settleRound(access: SessionAccess, guard: CommandStatement, wroteAssignment?: string) {
  const confirmed = wroteAssignment ? `EXISTS (SELECT 1 FROM assignments WHERE id = ?)` : "0";
  const nextRound = `${expectedRound} + 1`;
  const fresh = `EXISTS (SELECT 1 FROM cover_rounds WHERE gap_id = cover_gaps.id AND round_no = ${nextRound} AND state = 'open')`;
  return [
    endRound(access, guard, wroteAssignment),
    scopedStatement(access, `INSERT INTO cover_rounds (gap_id, round_no, dispatch_no, state, opened_at)
      SELECT g.gap_id, ${nextRound}, g.dispatch_no, 'open', ${at} FROM cover_target g
      WHERE NOT (${confirmed}) AND ${reusableDispatch("g")} AND ${guard.sql}`, ...wroteAssignment ? [wroteAssignment] : [], ...guard.params ?? []),
    scopedStatement(access, `UPDATE cover_gaps SET state = CASE WHEN ${confirmed} THEN 'filled' ELSE 'open' END,
      current_round_no = CASE WHEN ${fresh} THEN ${nextRound} ELSE current_round_no END, revision = revision + 1
      WHERE id = ${gapKey} AND current_round_no = ${expectedRound} AND revision = ${expectedRevision} AND ${guard.sql}`,
    ...wroteAssignment ? [wroteAssignment] : [], ...guard.params ?? []),
    closeDispatch(access, guard, `NOT EXISTS (SELECT 1 FROM cover_rounds r WHERE r.gap_id = cover_dispatches.gap_id
      AND r.dispatch_no = cover_dispatches.dispatch_no AND r.state = 'open')`),
  ];
}

function noticeWrites(access: SessionAccess, guard: CommandStatement, kind: keyof typeof noticeKinds, recipients: CommandStatement) {
  const source = `, cover_notices AS MATERIALIZED (${recipients.sql})`;
  const notificationKind = noticeKinds[kind];
  const targetKind = kind === "issue" ? offerLinkKind : coverKind;
  return [
    scopedStatement(access, `${source} INSERT INTO link_targets (token, kind, resource_id, required_scope, expires_at)
      SELECT token, '${targetKind}', resource_id, context_id, expires_at FROM cover_notices WHERE ${guard.sql}`,
    ...recipients.params ?? [], ...guard.params ?? []),
    scopedStatement(access, `${source} INSERT INTO notifications (id, context_id, event_key, kind, link_token, created_at)
      SELECT notice_id, context_id, notice_id, '${notificationKind}', token, ${at} FROM cover_notices WHERE ${guard.sql}`,
    ...recipients.params ?? [], ...guard.params ?? []),
  ];
}

function coverSignals(access: SessionAccess, workerWhere: string, options?: { notices?: CommandStatement; assignment?: string }) {
  const { notices, assignment } = options ?? {};
  const source = notices ? `, cover_notices AS MATERIALIZED (${notices.sql})` : "";
  const noticeChanges = notices ? ` UNION ALL SELECT 'notification', notice_id, context_id, 'upsert', ${at} FROM cover_notices` : "";
  const crewChanges = assignment ? ` UNION ALL SELECT '${crewAvailabilityKind}', a.worker_membership_id, c.id, 'upsert', ${at}
    FROM assignments a JOIN membership_roles r ON r.membership_id = a.worker_membership_id AND r.role = 'worker' AND r.revoked_at IS NULL
    JOIN account_contexts c ON c.role_grant_id = r.id WHERE a.id = ?` : "";
  return {
    changes: scopedStatement(access, `${source} ${changedCover(workerWhere)}${noticeChanges}${crewChanges}`,
      ...notices?.params ?? [], ...assignment ? [assignment] : []),
    effects: notices && scopedStatement(access, `${source} SELECT 'push-' || notice_id AS id, 'notification_push' AS kind,
      'notification_push:' || notice_id AS dedupe_key, notice_id AS resource_ref, ${at} AS due_at, expires_at FROM cover_notices`,
    ...notices.params ?? []),
  };
}

function customerStamp(access: SessionAccess, guard: CommandStatement, kind: "cover_arranging" | "crew_updated", predicate: CommandStatement) {
  const nextUpdate = kind === "cover_arranging" ? `min(${at} + ${defaultReplyMs}, g.starts_at)` : "NULL";
  return scopedStatement(access, `INSERT INTO customer_updates (id, visit_id, actor_id, kind, next_update_at, recorded_at)
    SELECT ${customerUpdateId(kind, "g.gap_id")}, g.visit_id, s.account_id, '${kind}', ${nextUpdate}, ${at}
    FROM cover_target g CROSS JOIN live_scope s WHERE (${predicate.sql}) AND ${guard.sql}`,
  ...predicate.params ?? [], ...guard.params ?? []);
}

type Transition = Pick<OperationSpec, "eligible" | "unchanged" | "writes">;
const sameDispatch = "o.dispatch_no = g.dispatch_no";
const onlySelected = `o.id = ${selectedOffer}`;

function issueTransition(access: SessionAccess, body: CoverBodies["issue"]): Transition {
  const recipients = body.payload.recipientMembershipIds.map((membership) => ({ membership, id: crypto.randomUUID(), token: randomToken() }));
  const offers = JSON.stringify(recipients);
  const requested = "m.id IN (SELECT value ->> 'membership' FROM json_each(?))";
  const dispatches = "(SELECT count(*) FROM cover_dispatches d WHERE d.gap_id = g.gap_id)";
  const nextRound = `coalesce(${expectedRound}, 0) + 1`;
  const dispatch = `coalesce(g.dispatch_no, 0) + 1`;
  const notices = { sql: `SELECT 'cover-offer-' || o.id AS notice_id, o.id AS resource_id, c.id AS context_id,
    x.value ->> 'token' AS token, o.expires_at FROM json_each(?) x JOIN cover_offers o ON o.id = x.value ->> 'id'
    JOIN membership_roles r ON r.membership_id = o.recipient_id AND r.role = 'worker' AND r.granted_at <= ${at} AND r.revoked_at IS NULL
    JOIN account_contexts c ON c.role_grant_id = r.id`, params: [offers] };

  return {
    eligible: { sql: foremanFront(`${matchingEpoch} AND ${canIssue("g", dispatches)}
      AND (SELECT count(*) FROM (${fits("g", requested)}) f WHERE ${fitToCover("f", "g")}) = ?`), params: [offers, recipients.length] },
    writes: (guard) => ({
      statements: [
        endRound(access, guard),
        closeDispatch(access, guard),
        scopedStatement(access, `INSERT INTO cover_dispatches (gap_id, dispatch_no, issued_by, issued_at, reply_until, state)
          SELECT g.gap_id, ${dispatch}, scope.account_id, ${at}, ${replyDeadline("g")}, 'open'
          FROM cover_target g CROSS JOIN live_scope scope WHERE ${guard.sql}`, ...guard.params ?? []),
        scopedStatement(access, `INSERT INTO cover_offers (id, gap_id, dispatch_no, recipient_id, expires_at, state)
          SELECT x.value ->> 'id', g.gap_id, d.dispatch_no, x.value ->> 'membership', d.reply_until, 'offered'
          FROM cover_target g JOIN cover_dispatches d ON d.gap_id = g.gap_id AND d.dispatch_no = ${dispatch}
          CROSS JOIN json_each(?) x WHERE ${guard.sql}`, offers, ...guard.params ?? []),
        scopedStatement(access, `INSERT INTO cover_rounds (gap_id, round_no, dispatch_no, state, opened_at)
          SELECT g.gap_id, ${nextRound}, ${dispatch}, 'open', ${at}
          FROM cover_target g WHERE ${guard.sql}`, ...guard.params ?? []),
        scopedStatement(access, `UPDATE cover_gaps SET state = 'open', current_round_no = ${nextRound}, revision = revision + 1
          WHERE id = ${gapKey} AND ${guard.sql}`, ...guard.params ?? []),
        ...noticeWrites(access, guard, "issue", notices),
        customerStamp(access, guard, "cover_arranging", { sql: "g.dispatch_no = 1" }),
      ],
      ...coverSignals(access, sameDispatch, { notices }),
    }),
  };
}

function acceptTransition(access: SessionAccess): Transition {
  const notices = { sql: `SELECT 'cover-accepted-' || g.winner_offer_id AS notice_id, g.gap_id AS resource_id,
    fc.id AS context_id, ? AS token, g.confirm_by AS expires_at
    FROM cover_target g JOIN account_contexts fc ON fc.business_id = g.business_id JOIN accounts a ON a.id = fc.account_id
    WHERE ${activeForeman("g")} ORDER BY ${foremanMember} IS g.accountable_foreman_membership_id DESC, fc.id LIMIT 1`, params: [randomToken()] };
  return {
    eligible: { sql: workerFront(`${matchingEpoch} AND ${epochOffer} AND ${cutoff("g")} > ${at} AND ${canCover("g", "o.recipient_id")}
      AND EXISTS (SELECT 1 FROM account_contexts fc JOIN accounts a ON a.id = fc.account_id WHERE ${activeForeman("g")})`) },
    writes: (guard) => ({
      statements: [
        scopedStatement(access, `UPDATE cover_rounds SET state = 'accepted_pending_confirmation', winner_offer_id = ${selectedOffer},
          accepted_at = ${at}, confirm_by = (SELECT min(${at} + ${confirmationMs}, ${cutoff("g")}) FROM cover_target g)
          WHERE gap_id = ${gapKey} AND round_no = ${expectedRound} AND state = 'open' AND winner_offer_id IS NULL AND ${guard.sql}`,
        ...guard.params ?? []),
        scopedStatement(access, `UPDATE cover_gaps SET state = 'accepted_pending_confirmation', revision = revision + 1
          WHERE id = ${gapKey} AND current_round_no = ${expectedRound} AND revision = ${expectedRevision} AND state = 'open' AND ${guard.sql}`,
        ...guard.params ?? []),
        ...noticeWrites(access, guard, "accept", notices),
      ],
      ...coverSignals(access, sameDispatch, { notices }),
    }),
  };
}

function workerDecision(access: SessionAccess, action: Extract<CoverAction, { verb: "decline" | "withdraw" }>): Transition {
  const withdraw = action.verb === "withdraw";
  const state = withdraw ? "withdrawn" : "declined";
  const reason = action.verb === "decline" ? action.body.payload.reason ?? null : null;
  return {
    eligible: { sql: workerFront(`${matchingEpoch} AND ${withdraw
      ? `${holdAlive("g")} AND o.id = g.winner_offer_id AND o.state = 'offered'` : epochOffer}`) },
    unchanged: withdraw ? { sql: `EXISTS (SELECT 1 FROM cover_target g WHERE (SELECT ${offerState("g")}
      ${joinedOffer("g", onlySelected)}) IN ('confirmed', 'not_confirmed'))` } : undefined,
    writes: (guard) => ({
      statements: [
        scopedStatement(access, `UPDATE cover_offers SET state = '${state}', responded_at = ${at}, decline_reason = ?
          WHERE id = ${selectedOffer} AND state = 'offered' AND ${guard.sql}`, reason, ...guard.params ?? []),
        ...withdraw ? settleRound(access, guard) : [],
      ],
      ...coverSignals(access, withdraw ? sameDispatch : onlySelected),
    }),
  };
}

function releaseTransition(access: SessionAccess): Transition {
  return {
    eligible: { sql: foremanFront(`${matchingEpoch} AND ${heldState}`) },
    writes: (guard) => ({ statements: settleRound(access, guard), ...coverSignals(access, sameDispatch) }),
  };
}

function closeTransition(access: SessionAccess, body: CoverBodies["close"]): Transition {
  const payload = body.payload;
  const revised = payload.reason === "revised_visit";
  const windowId = payload.reason === "revised_visit" ? payload.revisedWindowId : null;
  const early = body.payload.reason === "delivery" || body.payload.reason === "safety";
  const closeable = `(g.gap_state IN ('open', 'accepted_pending_confirmation') AND NOT coalesce(${holdAlive("g")}, 0)
    ${early ? "" : `AND NOT coalesce(${hasOffersOut("g")}, 0)`})`;
  const proposed = `EXISTS (SELECT 1 FROM visit_windows w JOIN visit_windows booked ON booked.id = w.replaces_window_id
    AND booked.visit_id = w.visit_id AND booked.state = 'confirmed'
    WHERE w.id = ? AND w.visit_id = g.visit_id AND w.state = 'proposed' AND w.provider_authorized = 1
      AND w.proposed_at <= ${at} AND w.expires_at > ${at})`;
  return {
    eligible: { sql: foremanFront(`${matchingEpoch} AND ${revised
      ? `(${closeable} OR (g.gap_state = 'closed' AND g.revised_window_id IS NULL)) AND ${proposed}` : closeable}`),
    params: revised ? [windowId] : [] },
    writes: (guard) => ({
      statements: [
        endRound(access, guard),
        closeDispatch(access, guard),
        scopedStatement(access, `UPDATE cover_gaps SET state = 'closed', closed_at = coalesce(closed_at, ${at}),
          revised_window_id = ?, revision = revision + 1 WHERE id = ${gapKey} AND ${guard.sql}`, windowId, ...guard.params ?? []),
      ],
      ...coverSignals(access, sameDispatch),
    }),
  };
}

function confirmTransition(access: SessionAccess): Transition {
  const assignmentId = crypto.randomUUID();
  const assigned = { sql: "EXISTS (SELECT 1 FROM assignments WHERE id = ?)", params: [assignmentId] };
  return {
    eligible: { sql: foremanFront(`${matchingEpoch} AND ${heldState}`) },
    unchanged: { sql: foremanFront(completedRound) },
    writes: (guard) => ({
      statements: [
        scopedStatement(access, `INSERT INTO assignments (id, slot_id, worker_membership_id, cover_gap_id, source,
          state, confirmed_by, confirmed_at, starts_at, ends_at)
          SELECT ?, g.slot_id, o.recipient_id, g.gap_id, 'cover', 'confirmed', s.account_id, ${at}, g.starts_at, g.ends_at
          FROM cover_target g JOIN cover_offers o ON o.id = g.winner_offer_id CROSS JOIN live_scope s
          WHERE ${confirmable} AND ${guard.sql}`, assignmentId, ...guard.params ?? []),
        { sql: `INSERT INTO safety_holds (id, assignment_id, kind, state)
          SELECT ?, id, 'briefing', 'active' FROM assignments WHERE id = ? AND ${guard.sql}`,
        params: [crypto.randomUUID(), assignmentId, ...guard.params ?? []] },
        customerStamp(access, guard, "crew_updated", assigned),
        ...settleRound(access, guard, assignmentId),
      ],
      ...coverSignals(access, sameDispatch, { assignment: assignmentId }),
    }),
  };
}

type ConflictStatus = Extract<NonNullable<ErrorBody["current"]>, { kind: "cover" }>["status"];
interface ResultRow { value: string | null; revision: number; current: ConflictStatus | null }
export interface CoverCommandResult { operation: OperationResult; value: string | null; error?: ErrorBody }

export async function planCover(ctx: RequestScope, session: SessionAccess, gapId: string, action: CoverAction):
Promise<CommandInput<CoverCommandResult>> {
  const { body, verb } = action;
  const offerId = "offerId" in body.payload ? body.payload.offerId : null;
  const access = accessClock(session, ctx.now);
  const scope = { sql: `${access.sql}, cover_target AS MATERIALIZED (${target("g.id = ?")}),
    cover_expected(revision, round_no, offer_id) AS (VALUES (?, ?, ?))`,
  params: [...access.params, gapId, body.expectedRevision, body.expectedRoundNo, offerId] };
  const worker = offerId !== null;
  const authorize = { sql: worker ? workerFront(ownsOffer("scope", "g", "o")) : foremanFront(foremanScope("scope", "g")) };
  const transition = (() => {
    switch (action.verb) {
      case "issue": return issueTransition(scope, action.body);
      case "accept": return acceptTransition(scope);
      case "decline": case "withdraw": return workerDecision(scope, action);
      case "release": return releaseTransition(scope);
      case "close": return closeTransition(scope, action.body);
      case "confirm": return confirmTransition(scope);
    }
  })();
  // Persist the enumerated close/release reason with the attributed receipt.
  const command = verb === "release" || verb === "close" ? `cover_${verb}_${action.body.payload.reason}` : `cover_${verb}`;
  const plan = await planOperation(ctx, {
    operationId: body.operationId, input: { gapId, body }, command, resultRef: offerId ?? gapId, access: scope, authorize,
    ...transition,
  });
  const foremanValue = foremanCover("g", "scope");
  const wonExpected = `EXISTS (SELECT 1 FROM cover_rounds r WHERE r.gap_id = g.gap_id
    AND r.round_no = ${expectedRound} AND r.state = 'confirmed')`;
  const value = verb === "accept"
    // Reconstruct the original decision from its immutable round, not from
    // today's worker state. Later confirmation/expiry does not rewrite a reply.
    ? `(SELECT json_object(${heldOffer("g", "won", `${expectedRevision} + 1`)})
       ${joinedOffer("g", `${onlySelected} AND won.round_no = ${expectedRound} AND won.accepted_at = receipt.committed_at`)})`
    : worker ? workerOffer("g", "scope", onlySelected)
    : verb === "confirm"
      ? `json_object('outcome', CASE WHEN ${wonExpected} THEN CASE WHEN receipt.operation_id IS NULL THEN 'already_filled' ELSE 'confirmed' END
        ELSE 'not_confirmed' END, 'cover', json(${foremanValue}))`
      : foremanValue;
  const current = worker ? `(SELECT CASE
    WHEN g.gap_state = 'filled' THEN 'filled'
    WHEN o.state = 'withdrawn' THEN 'withdrawn'
    WHEN g.gap_state = 'closed' THEN 'closed'
    WHEN ${holdAlive("g")} THEN 'accepted_pending_confirmation'
    WHEN o.expires_at <= ${at} OR d.state = 'closed' OR won.round_no IS NOT NULL
      OR NOT ${vacant("g")} THEN 'expired' END ${joinedOffer("g", onlySelected)})` : "NULL";
  const unchanged = transition.unchanged;
  const response = scopedStatement(scope, `SELECT CASE WHEN receipt.operation_id IS NOT NULL
    ${unchanged ? `OR (${unchanged.sql})` : ""} THEN (${value}) END AS value, g.revision, ${current} AS current
    FROM live_scope scope CROSS JOIN cover_target g LEFT JOIN operation_receipts receipt ON receipt.account_id = scope.account_id
      AND receipt.context_id = scope.context_id AND receipt.operation_id = ? AND receipt.command = ? WHERE (${authorize.sql})`,
  ...unchanged?.params ?? [], body.operationId, command);
  const resultIndex = plan.statements.length;
  return { statements: [...plan.statements, response], decode(results) {
    const operation = plan.decode(results);
    const row = results[resultIndex]?.results[0] as ResultRow | undefined;
    if (operation.outcome.status !== "rejected") return { operation, value: row?.value ?? null };
    const { error } = operation.outcome;
    if (error.code !== "CONFLICT" || !row) return { operation, value: null, error };
    if (row.current) return { operation, value: null, error: { code: "CONFLICT", current: { kind: "cover", status: row.current } } };
    if (!worker && row.revision !== body.expectedRevision) {
      return { operation, value: null, error: { code: "STALE_REVISION", current: { kind: "revision", revision: row.revision } } };
    }
    return { operation, value: null, error };
  } };
}
