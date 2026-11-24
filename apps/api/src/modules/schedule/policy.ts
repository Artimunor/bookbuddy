import { DIRECT_RESCHEDULE_NOTICE_MS } from "@bookbuddy/domain";
import { accessClock, at, currentCheck, eligibilityCutoff, liveTerm } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { businessCapability, currentMembership } from "../jobs/projections";
import { currentPerson, placeCapability } from "../places/policy";

export type ScheduleTarget = { kind: "job" | "visit" | "window" | "shift"; id: string };

const jobFor = {
  job: "t.id",
  visit: "(SELECT job_id FROM visits WHERE id = t.id)",
  window: "(SELECT v.job_id FROM visit_windows w JOIN visits v ON v.id = w.visit_id WHERE w.id = t.id)",
  shift: "(SELECT v.job_id FROM shifts sh JOIN visits v ON v.id = sh.visit_id WHERE sh.id = t.id)",
};

export function scheduleAccess(session: SessionAccess, now: number, target: ScheduleTarget): SessionAccess {
  const access = accessClock(session, now);
  return { sql: `${access.sql}, schedule_target(id) AS (VALUES (?)), schedule_job AS MATERIALIZED (
    SELECT j.*, p.owner_id, p.named_approver_id, p.state AS place_state, p.alias,
      coalesce(p.site_zone, area.site_zone) AS site_zone, area.site_zone AS business_zone, b.state AS business_state,
      r.submitted_at
    FROM schedule_target t JOIN jobs j ON j.id = ${jobFor[target.kind]}
    JOIN places p ON p.id = j.place_id JOIN businesses b ON b.id = j.business_id
    JOIN operating_areas area ON area.id = b.catchment_id LEFT JOIN requests r ON r.job_id = j.id
  )`, params: [...access.params, target.id] };
}

export const targetId = "(SELECT id FROM schedule_target)";
export const jobOpen = (j = "j") => `(${j}.state = 'open' AND ${j}.place_state = 'in_area' AND ${j}.business_state = 'approved')`;

export function foreman(scope: string, j = "j") {
  const member = currentMembership(scope, at);
  return `(${scope}.role = 'foreman' AND ${scope}.business_id = ${j}.business_id AND (
    ${member} = ${j}.accountable_foreman_membership_id OR (
      ${businessCapability(member, "backup_foreman", at)} AND EXISTS (SELECT 1 FROM job_grants g
        WHERE g.job_id = ${j}.id AND g.context_id = ${scope}.context_id AND g.capability = 'backup' AND ${liveTerm("g")}))))`;
}

export const provider = (scope: string, j = "j") => `(${scope}.role = 'provider_admin' AND ${scope}.business_id = ${j}.business_id
  AND ${currentMembership(scope, at)} IS NOT NULL)`;
export const scheduler = (scope: string) => `(${scope}.role IN ('foreman', 'provider_admin')
  AND ${businessCapability(currentMembership(scope, at), "schedule_correction", at)})`;
export const namedApprover = (scope: string, j = "j") => `(${j}.named_approver_id = ${scope}.account_id
  AND ${placeCapability(`${j}.place_id`, `${scope}.account_id`, "approve")})`;
const bookingGrant = (scope: string, j: string) => `(${namedApprover(scope, j)}
  OR ${placeCapability(`${j}.place_id`, `${scope}.account_id`, "book")})`;

export function customer(scope: string, j = "j", manage = false) {
  return `(${scope}.role = 'customer' AND ${j}.place_state NOT IN ('restricted', 'pending_verification')
    AND EXISTS (SELECT 1 FROM place_people pp WHERE pp.place_id = ${j}.place_id AND pp.account_id = ${scope}.account_id
      AND ${currentPerson("pp")} AND (${j}.requester_id = pp.account_id OR ${j}.submitted_at >= pp.history_from)
      AND (${bookingGrant(scope, j)}${manage ? "" : ` OR ${j}.owner_id = pp.account_id
        OR ${placeCapability(`${j}.place_id`, "pp.account_id", "view")}`})))`;
}

export const visitManager = (scope: string) => `(${customer(scope, "j", true)} OR ${foreman(scope)}
  OR (${provider(scope)} AND ${scheduler(scope)}))`;

export const workerContext = (scope: string, clock = at) => `(${scope}.role = 'worker'
  AND ${currentMembership(scope, clock)} IS NOT NULL)`;

export const confirmedWindow = (visit: string, alias = "booked") => `LEFT JOIN visit_windows ${alias}
  ON ${alias}.visit_id = ${visit}.id AND ${alias}.state = 'confirmed' AND ${alias}.confirmed_at <= ${at}`;

// Receipt proves the stamp exists; an accepted future arrival is visible only when it occurs.
export const publishedCustomerUpdate = (stamp: string) =>
  `${stamp}.recorded_at <= ${at} AND (${stamp}.occurred_at IS NULL OR ${stamp}.occurred_at <= ${at})`;

// A shortage belongs to the booking it was published for. A newer public
// service update can resolve it; internal staffing and proposals cannot.
export const currentNoCrewStamp = (visitId: string, booked: string) => `(SELECT
  CASE WHEN u.kind = 'no_crew_available' THEN u.id END FROM customer_updates u
  WHERE u.visit_id = ${visitId} AND u.recorded_at >= ${booked}.confirmed_at AND ${publishedCustomerUpdate("u")}
    AND (u.booked_window_id IS NULL OR u.booked_window_id = ${booked}.id)
    AND u.kind IN ('no_crew_available', 'crew_confirmed', 'crew_updated', 'cover_arranging',
      'on_the_way', 'arrival_revised', 'arrival_withdrawn', 'on_site', 'working', 'paused', 'finished')
  ORDER BY u.recorded_at DESC, u.rowid DESC LIMIT 1)`;

// An active/finished shift is evidence that work has already started even if the clock is early.
export const unstarted = (visit: string, booked: string) => `(${visit}.state IN ('planned', 'booked')
  AND (${booked}.id IS NULL OR ${booked}.starts_at > ${at})
  AND NOT EXISTS (SELECT 1 FROM shifts started WHERE started.visit_id = ${visit}.id AND started.state IN ('active', 'finished'))
  AND NOT EXISTS (SELECT 1 FROM visit_activity_events e WHERE e.visit_id = ${visit}.id
    AND e.kind IN ('work_started', 'work_paused', 'work_finished') AND e.at <= ${at}))`;

export const approvedVersion = (j = "j", q = "q") => `${q}.job_id = ${j}.id AND ${q}.state = 'approved' AND ${q}.issued_at <= ${at}`;
export const approvedQuoteJoin = (j = "j", q = "q") => `LEFT JOIN quote_versions ${q} ON ${approvedVersion(j, q)}`;
export const noWithdrawal = (q = "q") => `NOT EXISTS (SELECT 1 FROM contract_notices n WHERE n.quote_version_id = ${q}.id AND n.kind = 'withdrawal')`;

export function eligibleWorkers(j: string, ends: string) {
  return `SELECT m.id, m.account_id, e.work_language, ${eligibilityCutoff("e")} AS eligible_until
    FROM memberships m JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
    JOIN member_skills skill ON skill.membership_id = m.id AND skill.tag = ${j}.trade
    JOIN eligibility_checks e ON e.business_id = m.business_id AND e.membership_id = m.id AND e.trade = skill.tag
    JOIN member_languages lang ON lang.membership_id = m.id AND lang.tag = e.work_language
    WHERE m.business_id = ${j}.business_id AND m.state = 'active'
      AND EXISTS (SELECT 1 FROM membership_roles mr WHERE mr.membership_id = m.id AND mr.role = 'worker'
        AND mr.revoked_at IS NULL AND mr.granted_at <= ${at})
      AND e.scope = 'internal' AND e.state = 'approved' AND e.checked_at <= ${at}
      AND ${eligibilityCutoff("e")} >= ${ends} AND ${currentCheck("e")}`;
}

// Only UTC-dated positive coverage is usable as a booking commitment in the
// 0006 model. Recurring local preferences are not an allocated worker or slot.
function datedCoverage(member: string, starts: string, ends: string) {
  return `NOT EXISTS (SELECT 1 FROM availability_intervals off WHERE off.membership_id = ${member}
      AND off.recorded_at <= ${at} AND off.kind = 'unavailable' AND off.starts_at < ${ends} AND off.ends_at > ${starts})
    AND EXISTS (SELECT count(*) FROM (
      SELECT hours.starts_at, hours.ends_at, max(hours.ends_at) OVER (ORDER BY hours.starts_at, hours.ends_at, hours.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_end
      FROM availability_intervals hours WHERE hours.membership_id = ${member} AND hours.kind IN ('available', 'duty')
        AND hours.recorded_at <= ${at} AND hours.starts_at < ${ends} AND hours.ends_at > ${starts}
    ) HAVING count(*) > 0 AND min(starts_at) <= ${starts} AND max(ends_at) >= ${ends}
        AND max(CASE WHEN starts_at > previous_end THEN 1 ELSE 0 END) = 0)`;
}

export function freeWorkers(j: string, visitId: string, starts: string, ends: string) {
  return `SELECT crew.* FROM (${eligibleWorkers(j, ends)}) crew WHERE ${datedCoverage("crew.id", starts, ends)}
    AND NOT EXISTS (SELECT 1 FROM memberships peer JOIN assignments busy ON busy.worker_membership_id = peer.id
      JOIN shift_slots slot ON slot.id = busy.slot_id
      JOIN shifts sh ON sh.id = slot.shift_id AND sh.state IN ('planned', 'active')
      JOIN visits live ON live.id = sh.visit_id AND live.state = 'booked' AND live.id <> ${visitId}
      WHERE peer.account_id = crew.account_id AND busy.state = 'confirmed' AND busy.confirmed_at <= ${at}
        AND busy.starts_at < ${ends} AND busy.ends_at > ${starts})`;
}

// Named assignments consume their own lanes. Unfilled overlapping booked slots
// conservatively consume pooled capacity; outstanding proposals consume none.
export function capacity(j: string, visitId: string, starts: string, ends: string) {
  const other = `other.id <> ${visitId} AND other.state = 'booked'`;
  const overlap = (alias: string) => `${alias}.starts_at < ${ends} AND ${alias}.ends_at > ${starts}`;
  return `(NOT EXISTS (SELECT 1 FROM jobs same_place JOIN visits other ON other.job_id = same_place.id
    JOIN visit_windows w ON w.visit_id = other.id AND w.state = 'confirmed'
    WHERE same_place.place_id = ${j}.place_id AND ${other} AND ${overlap("w")})
    AND (SELECT count(DISTINCT free.id) FROM (${freeWorkers(j, visitId, starts, ends)}) free) > (
      SELECT count(*) FROM jobs same_business JOIN visits other ON other.job_id = same_business.id
      JOIN shifts sh ON sh.visit_id = other.id AND sh.state IN ('planned', 'active') JOIN shift_slots slot ON slot.shift_id = sh.id
      WHERE same_business.business_id = ${j}.business_id AND ${other} AND ${overlap("sh")}
        AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.slot_id = slot.id AND a.state = 'confirmed')))`;
}

export function likeForLike(j: string, booked: string, starts: string, ends: string) {
  return `${booked}.starts_at - ${at} >= ${DIRECT_RESCHEDULE_NOTICE_MS}
    AND ${ends} - ${starts} = ${booked}.ends_at - ${booked}.starts_at
    AND NOT EXISTS (SELECT 1 FROM change_versions change JOIN approvals a ON a.change_version_id = change.id
      WHERE change.job_id = ${j}.id AND change.state = 'approved' AND a.decision = 'approve' AND a.at >= ${booked}.confirmed_at)`;
}

export function confirmationMode(j: string, visit: string, w: string, booked: string) {
  return `CASE WHEN ${w}.state = 'proposed' AND ${w}.provider_authorized = 1 AND ${w}.proposed_at <= ${at}
    AND ${w}.expires_at > ${at} AND ${w}.starts_at > ${at} AND ${jobOpen(j)} AND ${unstarted(visit, booked)}
    AND EXISTS (SELECT 1 FROM quote_versions q WHERE ${approvedVersion(j)} AND ${noWithdrawal()})
    AND ${capacity(j, `${visit}.id`, `${w}.starts_at`, `${w}.ends_at`)} THEN CASE
      WHEN ${visit}.state = 'planned' AND ${booked}.id IS NULL AND ${w}.replaces_window_id IS NULL THEN 'booking'
      WHEN ${visit}.state = 'booked' AND ${w}.replaces_window_id = ${booked}.id THEN CASE
        WHEN ${w}.reschedule_request_id IS NOT NULL AND EXISTS (SELECT 1 FROM reschedule_requests r
          WHERE r.id = ${w}.reschedule_request_id AND r.state = 'proposed') THEN 'agreed_reschedule'
        WHEN ${w}.reschedule_request_id IS NULL AND ${likeForLike(j, booked, `${w}.starts_at`, `${w}.ends_at`)} THEN 'direct_reschedule'
      END
    END END`;
}
