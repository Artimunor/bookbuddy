import { INVITATION_POLICY } from "@bookbuddy/domain";
import type { CommandStatement } from "../../db/commit";
import type { SessionAccess } from "../auth/session";

export function accessClock(access: SessionAccess, now: number): SessionAccess {
  return { sql: `${access.sql}, clock AS (SELECT ? AS at)`, params: [...access.params, now] };
}

const eligibilityReminderLead = 30 * 24 * 60 * 60 * 1000;

export const at = "(SELECT at FROM clock)";
export const inviteRole = (invite: string) => `json_extract(${invite}.grant_snapshot, '$.role')`;
export const inviteKind = (invite: string) => `json_extract(${invite}.grant_snapshot, '$.kind')`;
export const liveTerm = (grant: string, time = at) => `${grant}.revoked_at IS NULL AND ${grant}.valid_from <= ${time}
  AND (${grant}.valid_until IS NULL OR ${grant}.valid_until > ${time})`;

export const delegatesPlaceView = (place: string, account: string) => `(SELECT count(*) FROM place_grants g
  WHERE g.place_id = ${place} AND g.account_id = ${account} AND g.capability IN ('delegate', 'view') AND ${liveTerm("g")}) = 2`;

const currentPlaceInvite = (invite: string) => `EXISTS (SELECT 1 FROM places p
  WHERE p.id = ${invite}.place_id AND p.address_revision = ${invite}.address_revision)`;

// A membership management capability is distinct from viewing the P roster.
export function managesBusiness(account: string, business: string): string {
  return `EXISTS (SELECT 1 FROM memberships admin
    JOIN accounts a ON a.id = admin.account_id AND a.state = 'active'
    JOIN businesses b ON b.id = admin.business_id AND b.state = 'approved'
    JOIN membership_roles r ON r.membership_id = admin.id AND r.role = 'provider_admin' AND r.revoked_at IS NULL AND r.granted_at <= ${at}
    JOIN business_grants g ON g.membership_id = admin.id AND g.capability = 'membership_admin'
    WHERE admin.account_id = ${account} AND admin.business_id = ${business} AND admin.state = 'active' AND ${liveTerm("g")})`;
}

// An ordinary view invitation may be delegated; a transfer may never be.
export function managesPlace(account: string, place: string, ownerOnly: string): string {
  return `EXISTS (SELECT 1 FROM places p
    JOIN place_people pp ON pp.place_id = p.id AND pp.account_id = ${account} AND pp.ends_at IS NULL AND pp.verified_from <= ${at}
    JOIN accounts a ON a.id = pp.account_id AND a.state = 'active'
    WHERE p.id = ${place} AND p.state IN ('in_area', 'out_of_area') AND (p.owner_id = pp.account_id OR
      (NOT (${ownerOnly}) AND ${delegatesPlaceView("p.id", "pp.account_id")})))`;
}

export function mayManageInvite(invite: string, scope = "scope"): string {
  return `((${invite}.business_id = ${scope}.business_id AND ${scope}.role = 'provider_admin'
      AND ${managesBusiness(`${scope}.account_id`, `${invite}.business_id`)}) OR
    (${invite}.place_id IS NOT NULL AND ${scope}.role = 'customer' AND
      ${managesPlace(`${scope}.account_id`, `${invite}.place_id`, `${inviteKind(invite)} = 'place_transfer'`)}))`;
}

export function mayGrantInvite(invite: string): string {
  return `((${invite}.business_id IS NOT NULL AND
      ${managesBusiness(`${invite}.inviter_id`, `${invite}.business_id`)} AND
      (${inviteRole(invite)} = 'worker' OR EXISTS (SELECT 1 FROM authority_verifications v
        WHERE v.id = ${invite}.verification_id AND v.business_id = ${invite}.business_id
          AND v.subject_account_id = ${invite}.recipient_id AND v.kind = 'membership' AND v.verified_at <= ${at}))) OR
    (${invite}.place_id IS NOT NULL AND ${managesPlace(`${invite}.inviter_id`, `${invite}.place_id`, `${inviteKind(invite)} = 'place_transfer'`)}
      AND ${currentPlaceInvite(invite)}
      AND (${inviteKind(invite)} = 'place_view' OR EXISTS (SELECT 1 FROM authority_verifications v
        JOIN accounts a ON a.id = v.subject_account_id AND a.state = 'active' AND a.email_key = ${invite}.recipient_key
        WHERE v.id = ${invite}.verification_id AND v.place_id = ${invite}.place_id AND a.id = ${invite}.recipient_id
          AND v.kind = 'place_transfer' AND v.verified_by <> ${invite}.inviter_id AND v.verified_at BETWEEN a.verified_at AND ${at}
          AND v.address_revision = ${invite}.address_revision))))`;
}

export function intendedRecipient(invite: string, account: string): string {
  return `((${invite}.state = 'accepted' AND ${invite}.recipient_id = ${account}.id) OR
    (${invite}.state <> 'accepted' AND ${invite}.recipient_key = ${account}.email_key
      AND (${invite}.recipient_id IS NULL OR ${invite}.recipient_id = ${account}.id)))`;
}

const sameRecipient = (previous: string, invite: string) => `${previous}.recipient_key = ${invite}.recipient_key
  AND (${previous}.business_id = ${invite}.business_id OR ${previous}.place_id = ${invite}.place_id)`;

export const anotherPending = (invite: string) => `EXISTS (SELECT 1 FROM invitations prior
  WHERE ${sameRecipient("prior", invite)} AND prior.id <> ${invite}.id AND prior.state = 'pending' AND prior.expires_at > ${at})`;

export const canReplaceInvite = (invite: string) => `(${invite}.state IN ('pending', 'expired')
  OR (${invite}.place_id IS NOT NULL AND ${invite}.state = 'withdrawn'))
  AND (${invite}.place_id IS NULL OR ${currentPlaceInvite(invite)})
  AND NOT EXISTS (SELECT 1 FROM invitations next WHERE next.supersedes_id = ${invite}.id)
  AND NOT (${anotherPending(invite)})`;

// The first delivery is the original invitation. All later deliveries count as
// reissues, including a fresh ID after withdrawal; neither state nor role resets the history.
export function providerDeliveryRetryAt(business: string, recipient: string): string {
  const history = `FROM invitations past WHERE past.business_id = ${business} AND past.recipient_key = ${recipient}
    ORDER BY past.issued_at DESC, past.id DESC`;
  const maxReissues = INVITATION_POLICY.maxReissuesPerWindow;
  return `max(coalesce((SELECT past.issued_at ${history} LIMIT 1) + ${INVITATION_POLICY.providerReissueCooldownMs}, 0),
    CASE WHEN EXISTS (SELECT 1 ${history} LIMIT 1 OFFSET ${maxReissues})
      THEN (SELECT past.issued_at ${history} LIMIT 1 OFFSET ${maxReissues - 1}) + ${INVITATION_POLICY.reissueWindowMs}
      ELSE 0 END)`;
}

export function reissueAt(invite: string): string {
  const history = `FROM invitations past WHERE past.recipient_key = ${invite}.recipient_key
    AND past.place_id = ${invite}.place_id AND past.supersedes_id IS NOT NULL
    AND past.issued_at > ${at} - ${INVITATION_POLICY.reissueWindowMs}`;
  return `CASE WHEN ${invite}.business_id IS NOT NULL THEN ${providerDeliveryRetryAt(`${invite}.business_id`, `${invite}.recipient_key`)}
    ELSE max(${invite}.issued_at + ${INVITATION_POLICY.placeReissueCooldownMs},
      coalesce((SELECT max(past.issued_at) ${history}) + ${INVITATION_POLICY.placeReissueCooldownMs}, 0),
      coalesce((SELECT past.issued_at ${history} ORDER BY past.issued_at DESC, past.id DESC LIMIT 1 OFFSET ${INVITATION_POLICY.maxReissuesPerWindow - 1})
        + ${INVITATION_POLICY.reissueWindowMs}, 0)) END`;
}

export const freePlaceSlots = (invite: string) => `SELECT slot FROM (SELECT 1 AS slot UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5)
  WHERE NOT EXISTS (SELECT 1 FROM invitations reserved WHERE reserved.place_id = ${invite}.place_id
    AND reserved.id <> ${invite}.id AND reserved.pending_slot = slot AND reserved.state = 'pending' AND reserved.expires_at > ${at})`;

export const displayName = (account: string) => `coalesce(nullif(${account}.display_name, ''), ${account}.id)`;

export function eligibilityCutoff(check: string): string {
  return `CASE WHEN ${check}.valid_until IS NULL THEN ${check}.review_by WHEN ${check}.review_by IS NULL THEN ${check}.valid_until
    ELSE min(${check}.valid_until, ${check}.review_by) END`;
}

export function eligibilityStatus(check: string): string {
  return `CASE WHEN ${check}.state IS NULL THEN 'pending' WHEN ${check}.state <> 'approved' THEN ${check}.state
    WHEN (${eligibilityCutoff(check)}) <= ${at} THEN 'expired'
    WHEN (${eligibilityCutoff(check)}) <= ${at} + ${eligibilityReminderLead} THEN 'expiring' ELSE 'approved' END`;
}

export function currentCheck(check: string): string {
  return `NOT EXISTS (SELECT 1 FROM eligibility_checks newer WHERE newer.business_id = ${check}.business_id
    AND newer.membership_id IS ${check}.membership_id AND newer.trade = ${check}.trade
    AND newer.work_language = ${check}.work_language AND newer.scope = ${check}.scope
    AND (coalesce(newer.checked_at, -1), newer.id) > (coalesce(${check}.checked_at, -1), ${check}.id))`;
}

export const checkPriority = (status: string) => `CASE ${status} WHEN 'suspended' THEN 0 WHEN 'rejected' THEN 1
  WHEN 'expired' THEN 2 WHEN 'pending' THEN 3 WHEN 'expiring' THEN 4 ELSE 5 END`;

export function memberEligibility(member: string): string {
  return `coalesce((SELECT status FROM (SELECT ${eligibilityStatus("e")} AS status, ${eligibilityCutoff("e")} AS cutoff, e.id
    FROM eligibility_checks e WHERE e.business_id = ${member}.business_id AND e.membership_id = ${member}.id AND ${currentCheck("e")})
    ORDER BY ${checkPriority("status")}, cutoff ASC NULLS LAST, id LIMIT 1), 'pending')`;
}

export const hasBackupForeman = (membershipId: string) => `EXISTS (SELECT 1 FROM business_grants bg
  WHERE bg.membership_id = ${membershipId} AND bg.capability = 'backup_foreman' AND ${liveTerm("bg")})`;

export function otherAdmin(member: string): string {
  return `EXISTS (SELECT 1 FROM memberships peer
    JOIN accounts a ON a.id = peer.account_id AND a.state = 'active'
    JOIN membership_roles r ON r.membership_id = peer.id AND r.role = 'provider_admin' AND r.revoked_at IS NULL AND r.granted_at <= ${at}
    WHERE peer.business_id = ${member}.business_id AND peer.id <> ${member}.id AND peer.state = 'active')`;
}

export const accountableForeman = (member: string) => `(EXISTS (SELECT 1 FROM businesses b
  WHERE b.id = ${member}.business_id AND b.default_foreman_id = ${member}.id)
  OR EXISTS (SELECT 1 FROM jobs j WHERE j.accountable_foreman_membership_id = ${member}.id AND j.state = 'open'))`;

export function revokedRoleProjection(member: string, grant: string): string {
  return `json_object('memberId', ${member}.id, 'displayName', ${displayName("a")},
    'grantId', ${grant}.id, 'role', ${grant}.role, 'revokedAt', ${grant}.revoked_at, 'revokedBy', ${displayName("revoker")})`;
}

export function scopedStatement(access: SessionAccess, sql: string, ...params: unknown[]): CommandStatement {
  return { sql: `${access.sql} ${sql}`, params: [...access.params, ...params] };
}
