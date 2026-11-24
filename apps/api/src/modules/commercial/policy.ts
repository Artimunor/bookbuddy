import { CUSTOMER_CHANGE_VERSION_STATES, CUSTOMER_QUOTE_VERSION_STATES } from "@bookbuddy/domain";
import { accessClock, at, liveTerm } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { currentPerson, placeCapability } from "../places/policy";

export type CommercialKind = "quote" | "change";
const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
export const models = {
  quote: { versions: "quote_versions", items: "quote_items", group: "quote_id", ref: "quote_version_id",
    declined: "declined", visible: quoted(CUSTOMER_QUOTE_VERSION_STATES) },
  change: { versions: "change_versions", items: "change_items", group: "proposal_id", ref: "change_version_id",
    declined: "rejected", visible: quoted(CUSTOMER_CHANGE_VERSION_STATES) },
} as const;

export function commercialAccess(session: SessionAccess, now: number, id: string, versionKind?: CommercialKind): SessionAccess {
  const clock = accessClock(session, now);
  const targetJob = versionKind ? `(SELECT job_id FROM ${models[versionKind].versions} WHERE id = input.id)` : "input.id";
  return { sql: `${clock.sql}, commercial_input AS (SELECT ? AS id), commercial_job AS MATERIALIZED (
    SELECT j.*, p.site_zone, p.state AS place_state, p.owner_id, p.named_approver_id, p.alias,
      b.public_name, b.state AS business_state, p.area_id, r.submitted_at
    FROM commercial_input input JOIN jobs j ON j.id = ${targetJob}
    JOIN places p ON p.id = j.place_id JOIN businesses b ON b.id = j.business_id
    LEFT JOIN requests r ON r.job_id = j.id
  ), commercial_actor AS MATERIALIZED (
    SELECT s.*, role.membership_id FROM live_scope s JOIN account_contexts c ON c.id = s.context_id
    LEFT JOIN membership_roles role ON role.id = c.role_grant_id WHERE role.id IS NULL OR role.granted_at <= ${at}
  )`, params: [...clock.params, id] };
}

export const jobOpen = `(j.state = 'open' AND j.business_state = 'approved' AND j.place_state = 'in_area')`;

export const foreman = (scope: string) => `(${scope}.role = 'foreman' AND ${scope}.business_id = j.business_id
  AND ${scope}.membership_id = j.accountable_foreman_membership_id)`;

export const customer = (scope: string) => `(${scope}.role = 'customer' AND j.place_state <> 'restricted' AND EXISTS (
  SELECT 1 FROM place_people pp WHERE pp.place_id = j.place_id AND pp.account_id = ${scope}.account_id
    AND ${currentPerson("pp")} AND (j.owner_id = ${scope}.account_id OR ${placeCapability("j.place_id", `${scope}.account_id`, "view")})
    AND (j.requester_id = pp.account_id OR j.submitted_at >= pp.history_from)))`;

// A staff context and a business-wide capability alone cannot open a private version.
export const businessGrant = (scope: string, capability: "review_commercial" | "publish_commercial") => `EXISTS (
  SELECT 1 FROM business_grants g WHERE g.business_id = j.business_id AND g.membership_id = ${scope}.membership_id
    AND g.capability = '${capability}' AND ${liveTerm("g")})`;

const jobGrant = (scope: string, capability: "reviewer" | "backup") => `EXISTS (
  SELECT 1 FROM job_grants g WHERE g.job_id = j.id AND g.context_id = ${scope}.context_id
    AND g.capability = '${capability}' AND ${liveTerm("g")})`;

export const reviewScope = (scope: string) => `(${scope}.role IN ('foreman', 'provider_admin') AND ${scope}.business_id = j.business_id
  AND ${businessGrant(scope, "review_commercial")})`;
export const routedReviewer = (scope: string, r: string) => `(${reviewScope(scope)} AND (
  (${r}.reviewer_id = ${scope}.account_id AND ${jobGrant(scope, "reviewer")}) OR
  (${r}.backup_id = ${scope}.account_id AND ${r}.due_at <= ${at} AND ${jobGrant(scope, "backup")})))`;

export const namedRouting = (primary: boolean) => `SELECT DISTINCT c.account_id FROM job_grants g
  JOIN account_contexts c ON c.id = g.context_id AND c.business_id = j.business_id AND c.role IN ('foreman', 'provider_admin')
  JOIN accounts a ON a.id = c.account_id AND a.state = 'active'
  JOIN membership_roles rr ON rr.id = c.role_grant_id AND rr.revoked_at IS NULL AND rr.granted_at <= ${at}
  JOIN memberships m ON m.id = rr.membership_id AND m.state = 'active'
  JOIN business_grants bg ON bg.membership_id = m.id AND bg.capability = 'review_commercial' AND ${liveTerm("bg")}
  WHERE g.job_id = j.id AND g.capability = '${primary ? "reviewer" : "backup"}' AND ${liveTerm("g")}`;

export const routing = `review_routing AS MATERIALIZED (
  SELECT (SELECT CASE count(*) WHEN 1 THEN min(account_id) END FROM (${namedRouting(true)})) AS reviewer_id,
    (SELECT CASE count(*) WHEN 1 THEN min(account_id) END FROM (${namedRouting(false)})) AS backup_id
  FROM commercial_job j
)`;
export const hasRouting = (author: string) => `EXISTS (SELECT 1 FROM review_routing route
  WHERE route.reviewer_id <> route.backup_id AND ${author} NOT IN (route.reviewer_id, route.backup_id))`;

export const versionVisible = (kind: CommercialKind, scope: string, v = "v", review = "review") => `(
  (${customer(scope)} AND ${v}.state IN (${models[kind].visible}) AND ${v}.issued_at <= ${at}) OR
  (${foreman(scope)} AND (${v}.issued_at IS NOT NULL OR ${v}.author_id = ${scope}.account_id)) OR
  ${routedReviewer(scope, review)})`;

export const versionAudience = (scope: string) => `CASE WHEN ${scope}.role = 'customer' THEN 'customer'
  WHEN ${foreman(scope)} AND (v.issued_at IS NOT NULL OR v.author_id = ${scope}.account_id) THEN 'foreman'
  ELSE 'reviewer' END`;

export const versionFrom = (kind: CommercialKind) => `FROM ${models[kind].versions} v JOIN commercial_job j ON j.id = v.job_id
  LEFT JOIN commercial_reviews review ON review.${models[kind].ref} = v.id`;

export const decisionGrant = (scope: string) => `SELECT g.id FROM place_grants g WHERE g.place_id = j.place_id
  AND g.account_id = ${scope}.account_id AND j.named_approver_id = g.account_id
  AND g.capability = 'approve' AND ${liveTerm("g")}`;

export const actionableDecision = (kind: CommercialKind, scope: string) => `${jobOpen} AND v.state = 'issued'
  AND v.issued_at <= ${at} AND v.expires_at > ${at} AND ${scope}.account_id NOT IN (v.author_id, v.publisher_id)
  AND EXISTS (${decisionGrant(scope)})${kind === "change" ? ` AND ${changeStillCurrent} AND NOT EXISTS (
    SELECT 1 ${bookedWork} AND w.starts_at > v.issued_at AND w.starts_at <= ${at}
  )` : ""}`;

export const bookedWork = `FROM visits visit JOIN visit_windows w ON w.visit_id = visit.id AND w.state = 'confirmed'
  WHERE visit.job_id = j.id AND visit.kind = 'work' AND visit.state IN ('booked', 'finished') AND w.confirmed_at <= ${at}`;

export const approvedTotal = (base: string) => `(SELECT base.total_minor + coalesce((
    SELECT sum(agreed.delta_minor) FROM change_proposals cp
    JOIN change_versions agreed ON agreed.proposal_id = cp.id AND agreed.state = 'approved'
    WHERE cp.base_quote_version_id = base.id AND cp.job_id = j.id
  ), 0) FROM quote_versions base WHERE base.id = ${base} AND base.job_id = j.id AND base.state = 'approved')`;
const changeStillCurrent = `v.total_minor = v.delta_minor + ${approvedTotal("(SELECT base_quote_version_id FROM change_proposals WHERE id = v.proposal_id)")}`;

export const noApproved = (kind: CommercialKind) => `NOT EXISTS (SELECT 1 FROM ${models[kind].versions} agreed
  WHERE agreed.${models[kind].group} = v.${models[kind].group} AND agreed.state = 'approved')`;
export const newest = (kind: CommercialKind) => `NOT EXISTS (SELECT 1 FROM ${models[kind].versions} next
  WHERE next.${models[kind].group} = v.${models[kind].group} AND next.no > v.no)`;

export const canSubmit = (kind: CommercialKind, scope: string) => `${jobOpen} AND v.state = 'draft' AND v.author_id = ${scope}.account_id
  AND ${foreman(scope)} AND ${newest(kind)} AND ${noApproved(kind)} AND ${hasRouting("v.author_id")}`;

export const canReturn = (scope: string) => `${jobOpen} AND v.state = 'in_review' AND review.state = 'pending'
  AND v.author_id <> ${scope}.account_id AND ${routedReviewer(scope, "review")}`;

export const canPublish = (kind: CommercialKind, scope: string) => `${jobOpen} AND ${businessGrant(scope, "publish_commercial")}
  AND ${newest(kind)} AND ${noApproved(kind)} AND (
    (v.state = 'draft' AND ${foreman(scope)} AND v.author_id = ${scope}.account_id) OR (${canReturn(scope)})
  )${kind === "change" ? ` AND ${changeStillCurrent}` : ""}`;

const offeredWindows = `FROM visits visit JOIN visit_windows w ON w.visit_id = visit.id
  WHERE visit.job_id = j.id AND visit.state IN ('planned', 'booked') AND w.state = 'proposed'
    AND w.provider_authorized = 1 AND w.proposed_at <= ${at} AND w.expires_at > ${at}`;
export const availableWindows = `EXISTS (SELECT 1 ${offeredWindows}
  AND (w.replaces_window_id IS NULL OR EXISTS (SELECT 1 FROM visit_windows original
    WHERE original.id = w.replaces_window_id AND original.state = 'confirmed'))
  AND NOT EXISTS (SELECT 1 FROM visit_windows busy JOIN visits other ON other.id = busy.visit_id
    JOIN jobs booked ON booked.id = other.job_id
    WHERE busy.state = 'confirmed' AND other.state = 'booked' AND other.id <> visit.id
      AND booked.place_id = j.place_id AND busy.starts_at < w.ends_at AND busy.ends_at > w.starts_at))`;
export const publicationCapacity = `(NOT EXISTS (SELECT 1 ${offeredWindows}) OR ${availableWindows})`;
