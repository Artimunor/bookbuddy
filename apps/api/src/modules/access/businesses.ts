import { businessEligibilitySchema, businessPeopleSchema } from "@bookbuddy/api-contract";
import type { BusinessEligibility, BusinessPeople } from "@bookbuddy/api-contract";
import type { SessionAccess } from "../auth/session";
import { decodeManagedInvitations, managedInvitationProjection } from "./invitations";
import { accountableForeman, at, checkPriority, currentCheck, displayName, eligibilityCutoff, eligibilityStatus,
  managesBusiness, memberEligibility, otherAdmin, revokedRoleProjection, scopedStatement } from "./policy";

const pageSize = 50;

export const businessHeader = (business: string) => `json_object('id', ${business}.id, 'publicName', ${business}.public_name,
  'state', ${business}.state, 'areaName', area.name, 'siteZone', area.site_zone)`;

const crewRole = (role: string) => `${role}.role IN ('worker', 'foreman') AND ${role}.revoked_at IS NULL`;
const currentRole = (member: string) => `EXISTS (SELECT 1 FROM membership_roles g WHERE g.membership_id = ${member}.id AND g.revoked_at IS NULL)`;
const currentCrew = (member: string) => `EXISTS (SELECT 1 FROM membership_roles g WHERE g.membership_id = ${member}.id AND ${crewRole("g")})`;

export function businessMemberProjection(member: string, viewer: string, canManage: string): string {
  return `json_object('id', ${member}.id, 'displayName', ${displayName("a")}, 'email', a.email_normalized,
    'isViewer', json(CASE WHEN ${member}.account_id = ${viewer} THEN 'true' ELSE 'false' END),
    'eligibility', CASE WHEN ${currentCrew(member)} THEN ${memberEligibility(member)} END,
    'roles', json((SELECT json_group_array(json(value)) FROM (
      SELECT json_object('grantId', g.id, 'role', g.role, 'grantedAt', g.granted_at,
        'removal', json(CASE WHEN g.role = 'provider_admin' AND NOT (${otherAdmin(member)}) THEN json_object('status', 'last_admin')
          WHEN NOT (${canManage}) OR (${member}.account_id = ${viewer} AND g.role = 'provider_admin') THEN json_object('status', 'unavailable')
          WHEN g.role = 'foreman' AND ${accountableForeman(member)} THEN json_object('status', 'unavailable')
          ELSE json_object('status', 'allowed') END)) AS value
      FROM membership_roles g WHERE g.membership_id = ${member}.id AND g.revoked_at IS NULL ORDER BY g.role))))`;
}

const foremanMember = `json_object('id', m.id, 'displayName', ${displayName("a")}, 'eligibility', ${memberEligibility("m")},
  'roles', json((SELECT json_group_array(role) FROM (SELECT g.role FROM membership_roles g
    WHERE g.membership_id = m.id AND ${crewRole("g")} ORDER BY g.role))),
  'skills', json((SELECT json_group_array(tag) FROM (SELECT tag FROM member_skills WHERE membership_id = m.id ORDER BY tag))),
  'workLanguages', json((SELECT json_group_array(tag) FROM (SELECT tag FROM member_languages WHERE membership_id = m.id ORDER BY tag))))`;

const activeMembers = `FROM memberships m JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
  WHERE m.business_id = b.id AND m.state = 'active'`;
const memberPage = (condition: string, projection: string) => `SELECT json_group_array(json(value)) FROM (
  SELECT ${projection} AS value ${activeMembers} AND ${condition} AND m.id > (SELECT id FROM position)
  ORDER BY m.id LIMIT ${pageSize + 1})`;

const openInvitations = `i.business_id = b.id AND i.state IN ('pending','expired') AND i.recipient_email_ciphertext IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM invitations next WHERE next.supersedes_id = i.id)`;
const invitationPage = `SELECT json_group_array(json(value)) FROM (
  SELECT ${managedInvitationProjection("i", "s.can_manage")} AS value FROM invitations i JOIN accounts inviter ON inviter.id = i.inviter_id
  LEFT JOIN places p ON p.id = i.place_id WHERE ${openInvitations} AND i.id > (SELECT id FROM position)
  ORDER BY i.id LIMIT ${pageSize + 1})`;
const pastRolePage = `SELECT json_group_array(json(value)) FROM (
  SELECT ${revokedRoleProjection("m", "g")} AS value FROM membership_roles g JOIN memberships m ON m.id = g.membership_id
  JOIN accounts a ON a.id = m.account_id JOIN accounts revoker ON revoker.id = g.revoked_by
  WHERE g.business_id = b.id AND g.revoked_at IS NOT NULL AND g.id > (SELECT id FROM position)
  ORDER BY g.id LIMIT ${pageSize + 1})`;

export function readBusinessPeople(access: SessionAccess, id: string, view: "active" | "invited" | "past", cursor: string) {
  const providerList = view === "active" ? memberPage(currentRole("m"), businessMemberProjection("m", "s.account_id", "s.can_manage"))
    : view === "invited" ? invitationPage : pastRolePage;
  return scopedStatement(access, `, position AS (SELECT ? AS id), reader AS MATERIALIZED (
      SELECT scope.*, ${managesBusiness("scope.account_id", "scope.business_id")} AS can_manage FROM live_scope scope
      WHERE scope.business_id = ? AND scope.role IN ('provider_admin', 'foreman')
        AND (scope.role = 'provider_admin' OR ? = 'active'))
    SELECT (SELECT CASE s.role WHEN 'foreman' THEN json_object('audience', 'foreman', 'businessId', b.id,
        'entries', json((${memberPage(currentCrew("m"), foremanMember)})))
      ELSE json_object('audience', 'provider_admin', 'view', ?, 'business', ${businessHeader("b")},
        'canInvite', json(CASE WHEN s.can_manage THEN 'true' ELSE 'false' END),
        'counts', json_object('active', (SELECT count(*) ${activeMembers} AND ${currentRole("m")}),
          'invited', (SELECT count(*) FROM invitations i WHERE ${openInvitations}),
          'past', (SELECT count(*) FROM membership_roles g WHERE g.business_id = b.id AND g.revoked_at IS NOT NULL)),
        'entries', json((${providerList}))) END AS value
      FROM reader s JOIN businesses b ON b.id = s.business_id JOIN operating_areas area ON area.id = b.catchment_id)
      AS value FROM acting_session`, cursor, id, view, view);
}

function page<T>(rows: T[], key: (row: T) => string) {
  const hasMore = rows.length > pageSize;
  if (hasMore) rows.pop();
  return { hasMore, cursor: hasMore ? key(rows[rows.length - 1]!) : null };
}

export async function decodeBusinessPeople(value: string, secret: string | undefined): Promise<BusinessPeople> {
  const { entries, ...header } = JSON.parse(value) as (
    { audience: "foreman"; entries: { id: string }[] } |
    { audience: "provider_admin"; view: "active"; entries: { id: string }[] } |
    { audience: "provider_admin"; view: "past"; entries: { grantId: string }[] } |
    { audience: "provider_admin"; view: "invited"; entries: { id: string; recipientKey: string; sealedEmail: string }[] }
  );
  if (header.audience === "provider_admin" && header.view === "past") return businessPeopleSchema.parse({
    ...header, ...page(entries as { grantId: string }[], (row) => row.grantId), roles: entries,
  });
  if (header.audience === "provider_admin" && header.view === "invited") return businessPeopleSchema.parse({
    ...header, ...page(entries as { id: string }[], (row) => row.id),
    invitations: await decodeManagedInvitations(entries as { recipientKey: string; sealedEmail: string }[], secret),
  });
  return businessPeopleSchema.parse({ ...header, ...page(entries as { id: string }[], (row) => row.id), members: entries });
}

const eligibilityProjection = (key: string, extras = "") => `json_object('_key', ${key}, 'memberId', m.id,
  'displayName', ${displayName("a")}, 'status', ${eligibilityStatus("e")}, 'checkedAt', e.checked_at,
  'validUntil', e.valid_until, 'reviewBy', e.review_by, 'effectiveCutoffAt', ${eligibilityCutoff("e")}${extras})`;
const foremanEligibility = `SELECT json_group_array(json(value)) FROM (
  SELECT ${eligibilityProjection("e.id", ", 'trade', e.trade, 'workLanguage', e.work_language")} AS value
  FROM eligibility_checks e JOIN memberships m ON m.id = e.membership_id AND m.state = 'active'
  JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
  WHERE e.business_id = b.id AND ${currentCheck("e")} AND ${currentCrew("m")} AND e.id > (SELECT id FROM position)
  ORDER BY e.id LIMIT ${pageSize + 1})`;
const providerEligibility = `SELECT json_group_array(json(value)) FROM (
  SELECT ${eligibilityProjection("m.id")} AS value FROM memberships m JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
  LEFT JOIN eligibility_checks e ON e.id = (SELECT check_id FROM (
    SELECT candidate.id AS check_id, ${eligibilityStatus("candidate")} AS status, ${eligibilityCutoff("candidate")} AS cutoff
    FROM eligibility_checks candidate WHERE candidate.business_id = m.business_id AND candidate.membership_id = m.id
      AND ${currentCheck("candidate")}) ORDER BY ${checkPriority("status")}, cutoff ASC NULLS LAST, check_id LIMIT 1)
  WHERE m.business_id = b.id AND m.state = 'active' AND ${currentCrew("m")} AND m.id > (SELECT id FROM position)
  ORDER BY m.id LIMIT ${pageSize + 1})`;

export function businessEligibilityPayload(role: string): string {
  return `CASE ${role} WHEN 'foreman' THEN json_object('audience', 'foreman', 'businessId', b.id, 'siteZone', area.site_zone,
    'members', json((${foremanEligibility})))
  ELSE json_object('audience', 'provider_admin', 'business', ${businessHeader("b")}, 'coverPolicy', 'own_crew',
    'approvedScopes', json((SELECT json_group_array(json(value)) FROM (SELECT DISTINCT json_object('trade', e.trade, 'scope', e.scope) AS value
      FROM eligibility_checks e WHERE e.business_id = b.id AND e.membership_id IS NULL AND ${currentCheck("e")}
      AND (${eligibilityStatus("e")}) IN ('approved', 'expiring') ORDER BY value))),
    'members', json((${providerEligibility})), 'supportReference', NULL) END`;
}

export function readBusinessEligibility(access: SessionAccess, id: string, cursor: string) {
  return scopedStatement(access, `, position AS (SELECT ? AS id)
    SELECT (SELECT ${businessEligibilityPayload("s.role")} AS value FROM live_scope s JOIN businesses b ON b.id = s.business_id
      JOIN operating_areas area ON area.id = b.catchment_id WHERE b.id = ? AND s.role IN ('provider_admin', 'foreman')) AS value
    FROM acting_session`, cursor, id);
}

export function decodeBusinessEligibility(value: string): BusinessEligibility {
  const raw = JSON.parse(value) as { members: { _key: string }[] };
  return businessEligibilitySchema.parse({ ...raw, ...page(raw.members, (row) => row._key) });
}
