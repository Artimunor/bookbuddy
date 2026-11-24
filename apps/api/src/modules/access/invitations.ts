import { invitationOpeningSchema, managedInvitationSchema } from "@bookbuddy/api-contract";
import type { InvitationOpening } from "@bookbuddy/api-contract";
import type { SessionAccess } from "../auth/session";
import { loadDeliveryKey } from "../auth/crypto";
import { currentTransferMailbox, openTransferLocator, placeInvitationAccessSql, placeInvitationGrantSql, transferKind } from "../places/invitation";
import { openInviteEmail } from "./mail";
import { at, canReplaceInvite, displayName, intendedRecipient, inviteKind, inviteRole, mayGrantInvite, mayManageInvite,
  memberEligibility, reissueAt, scopedStatement } from "./policy";

export const unavailableInvitation = { status: "unavailable", reason: "unavailable", supportReference: null } as const;

const unavailableOpening = (reason: "expired" | "removed" | "unavailable") =>
  `json_object('status', 'unavailable', 'reason', '${reason}', 'supportReference', NULL)`;

const currentBusiness = `SELECT json_object('kind', 'business', 'context', json_object(
    'scope', json_object('contextId', c.id, 'role', c.role, 'businessId', c.business_id), 'businessName', b.public_name),
    'workEligibility', ${memberEligibility("m")}, 'supportReference', NULL)
  FROM memberships m JOIN membership_roles g ON g.membership_id = m.id AND g.role = ${inviteRole("i")} AND g.revoked_at IS NULL
    AND g.granted_at <= ${at}
  JOIN account_contexts c ON c.role_grant_id = g.id
  WHERE b.state = 'approved' AND m.business_id = b.id AND m.account_id = i.recipient_id AND m.state = 'active'`;

export const invitationOpeningSql = (viewer: string) => `SELECT CASE
  WHEN i.state = 'accepted' THEN coalesce((SELECT CASE WHEN current_access IS NOT NULL THEN json_object(
    'status', 'accepted', 'id', i.id, 'acceptedAt', i.ended_at, 'currentAccess', json(current_access)) END
    FROM (SELECT CASE WHEN i.business_id IS NOT NULL THEN (${currentBusiness}) ELSE (${placeInvitationAccessSql}) END AS current_access)),
    ${unavailableOpening("removed")})
  WHEN i.state = 'expired' OR (i.state = 'pending' AND i.expires_at <= ${at}) THEN ${unavailableOpening("expired")}
  WHEN i.state <> 'pending' THEN ${unavailableOpening("unavailable")}
  WHEN NOT (${mayGrantInvite("i")}) THEN ${unavailableOpening("removed")}
  ELSE json_object('status', 'pending', 'id', i.id, 'grant', json(CASE WHEN i.business_id IS NOT NULL
    THEN json_object('kind', 'business_role', 'businessName', b.public_name, 'role', ${inviteRole("i")})
    ELSE ${placeInvitationGrantSql} END),
    'inviterDisplayName', ${displayName("inviter")}, 'issuedAt', i.issued_at, 'expiresAt', i.expires_at,
    'siteZone', coalesce(area.site_zone, p.site_zone), 'setupRequired', json(CASE WHEN recipient.setup_at IS NULL THEN 'true' ELSE 'false' END))
  END AS value
  FROM invitations i JOIN accounts inviter ON inviter.id = i.inviter_id JOIN accounts recipient ON recipient.id = ${viewer}
  LEFT JOIN businesses b ON b.id = i.business_id LEFT JOIN operating_areas area ON area.id = b.catchment_id
  LEFT JOIN places p ON p.id = i.place_id WHERE ${intendedRecipient("i", "recipient")}`;

export function readInvitation(access: SessionAccess, id: string) {
  return scopedStatement(access, `SELECT (SELECT value FROM (${invitationOpeningSql("s.account_id")}
    AND i.id = ?)) AS value FROM acting_session s`, id);
}

export function decodeOpening(value: string): InvitationOpening {
  return invitationOpeningSchema.parse(JSON.parse(value));
}

export const managedInvitationProjection = (invite = "i", authority = "1") => `json_object(
  'id', ${invite}.id, 'kind', ${inviteKind(invite)}, 'role', ${inviteRole(invite)}, 'businessId', ${invite}.business_id,
  'placeId', ${invite}.place_id, 'capabilities', json('["view"]'),
  'inviterDisplayName', ${displayName("inviter")}, 'recipientKey', ${invite}.recipient_key,
  'sealedEmail', ${invite}.recipient_email_ciphertext,
  'transferEmail', CASE WHEN ${transferKind(invite)} THEN ${currentTransferMailbox(invite)} END,
  'recipientId', ${invite}.recipient_id,
  'state', CASE WHEN ${invite}.state = 'pending' AND ${invite}.expires_at <= ${at} THEN 'expired' ELSE ${invite}.state END,
  'issuedAt', ${invite}.issued_at, 'expiresAt', ${invite}.expires_at, 'endedAt', ${invite}.ended_at,
  'siteZone', coalesce(area.site_zone, p.site_zone),
  'canWithdraw', json(CASE WHEN (${authority}) AND ${invite}.state = 'pending' AND ${invite}.expires_at > ${at} THEN 'true' ELSE 'false' END),
  'reissue', json(CASE WHEN NOT (${authority}) OR NOT (${canReplaceInvite(invite)}) OR ${invite}.recipient_email_ciphertext IS NULL
    THEN json_object('status', 'unavailable') WHEN ${reissueAt(invite)} > ${at} THEN json_object('status', 'wait', 'retryAt', ${reissueAt(invite)})
    ELSE json_object('status', 'available') END))`;

export const managedInvitationJoins = `JOIN accounts inviter ON inviter.id = i.inviter_id
  LEFT JOIN businesses b ON b.id = i.business_id LEFT JOIN operating_areas area ON area.id = b.catchment_id
  LEFT JOIN places p ON p.id = i.place_id`;

export const managedInvitationAt = (id: string) => `SELECT ${managedInvitationProjection()} AS value FROM invitations i
  ${managedInvitationJoins} WHERE i.id = ${id} AND ${mayManageInvite("i")}
    AND (NOT (${transferKind("i")}) OR ${currentTransferMailbox("i")} IS NOT NULL)`;

export interface SealedInvitation {
  recipientKey: string;
  sealedEmail: string;
  kind?: string;
  placeId?: string;
  recipientId?: string;
  transferEmail?: string;
}

export async function decodeManagedInvitations(values: readonly SealedInvitation[], secret: string | undefined) {
  if (values.length === 0) return [];
  const key = await loadDeliveryKey(secret);
  if (!key) throw new TypeError("Missing invitation encryption key");
  return Promise.all(values.map(async ({ recipientKey, sealedEmail, recipientId, transferEmail, ...projection }) => {
    if (projection.kind === "place_transfer") {
      if (!projection.placeId || !recipientId || !transferEmail
        || await openTransferLocator(key, projection.placeId, sealedEmail) !== recipientId) throw new TypeError("Invalid transfer recipient");
      return managedInvitationSchema.parse({ ...projection, email: transferEmail });
    }
    return managedInvitationSchema.parse({ ...projection, email: await openInviteEmail(key, recipientKey, sealedEmail) });
  }));
}

export async function decodeManagedInvitation(value: string, secret: string | undefined) {
  const [projection] = await decodeManagedInvitations([JSON.parse(value) as SealedInvitation], secret);
  return projection!;
}
