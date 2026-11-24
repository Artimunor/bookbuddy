import type { BusinessMemberRolesPatch, CommandInput as WireCommand, ErrorBody } from "@bookbuddy/api-contract";
import { invitationExpiresAt } from "@bookbuddy/domain";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { bumpVisibilityEpoch, planOperation } from "../../db/operations";
import type { OperationResult, OperationSpec } from "../../db/operations";
import type { RequestScope } from "../../db/scope";
import type { SessionAccess } from "../auth/session";
import { mac, mailboxKey } from "../auth/crypto";
import { currentTransferMailbox, placeInvitationChanges, placeInvitationVisibility, transferKind, transferNotice } from "../places/invitation";
import { businessMemberProjection } from "./businesses";
import { invitationOpeningSql, managedInvitationAt } from "./invitations";
import { invitationMailEffectSql, prepareInvitationLink, sealInviteEmail } from "./mail";
import type { InvitationMailKeys } from "./mail";
import { accountableForeman, at, canReplaceInvite, freePlaceSlots, intendedRecipient, inviteKind, inviteRole, managesBusiness,
  liveTerm, mayGrantInvite, mayManageInvite, otherAdmin, reissueAt, revokedRoleProjection, scopedStatement } from "./policy";

export interface AccessCommandResult {
  operation: OperationResult;
  value: string | null;
  error?: ErrorBody;
}

// Reads the committed entity via the receipt in this batch, with the same authorization
// used for replay. No result projection is built from a caller's uncommitted input.
async function commandPlan(ctx: RequestScope, spec: OperationSpec, projection: string, retryAt?: CommandStatement): Promise<CommandInput<AccessCommandResult>> {
  const operation = await planOperation(ctx, spec);
  const authorization = spec.authorize ?? { sql: "1" };
  const result = scopedStatement(spec.access as SessionAccess, `SELECT (SELECT value FROM (${projection})) AS value,
    ${retryAt ? `(${retryAt.sql})` : "NULL"} AS retry_at
    FROM live_scope scope LEFT JOIN operation_receipts r ON r.account_id = scope.account_id
      AND r.context_id = scope.context_id AND r.operation_id = ? AND r.command = ? WHERE (${authorization.sql})`,
  ...retryAt?.params ?? [], spec.operationId, spec.command, ...authorization.params ?? []);
  const index = operation.statements.length;
  return { statements: [...operation.statements, result], decode(results) {
    const outcome = operation.decode(results);
    const row = results[index]?.results[0] as { value: string | null; retry_at: number | null } | undefined;
    if (outcome.outcome.status === "rejected") {
      const error = outcome.outcome.error;
      return { operation: outcome, value: null,
        error: error.code === "CONFLICT" && row?.retry_at != null && row.retry_at > ctx.now ? { code: "RATE_LIMITED", retryAt: row.retry_at } : error };
    }
    return { operation: outcome, value: row?.value ?? null };
  } };
}

const managerLookup = `SELECT 1 FROM invitations i WHERE i.id = ? AND ${mayManageInvite("i")}`;
const issuerMember = (business: string) => `scope.role = 'provider_admin' AND scope.business_id = ${business}
  AND ${managesBusiness("scope.account_id", "scope.business_id")}`;
const inviteViaReceipt = "i.id = r.result_ref";

function auditInvite(access: SessionAccess, guard: CommandStatement, id: string, kind: string): CommandStatement {
  return scopedStatement(access, `INSERT INTO access_audit (id, business_id, place_id, actor_id, subject_account_id, verification_id, kind, at)
    SELECT ?, i.business_id, i.place_id, scope.account_id, i.recipient_id, i.verification_id, ?, ${at}
    FROM invitations i CROSS JOIN live_scope scope WHERE i.id = ? AND ${guard.sql}`,
  crypto.randomUUID(), kind, id, ...guard.params ?? []);
}

type BusinessInvite = WireCommand<{ email: string; role: "worker" | "foreman" }>;
export async function issueBusinessInvitation(ctx: RequestScope, base: SessionAccess, keys: InvitationMailKeys, business: string, input: BusinessInvite) {
  const email = input.payload.email.trim().toLowerCase(), { role } = input.payload;
  const recipientKey = await mailboxKey(keys.lookup, email);
  const id = await mac(keys.lookup, "business-invitation-id", business, recipientKey, role, input.operationId);
  const [link, encrypted] = await Promise.all([prepareInvitationLink(keys.encryption, keys.origin, id), sealInviteEmail(keys.encryption, recipientKey, email)]);
  const access = { sql: `${base.sql}, intended AS (SELECT id FROM accounts WHERE email_normalized = ? AND state = 'active'),
    independent_check AS (SELECT v.id FROM authority_verifications v JOIN intended a ON a.id = v.subject_account_id
      WHERE v.business_id = ? AND v.kind = 'membership' AND v.verified_at <= ${at} ORDER BY v.verified_at DESC, v.id LIMIT 1)`,
    params: [...base.params, email, business] };
  return commandPlan(ctx, {
    access, operationId: input.operationId, command: "access.invite_business", input: [business, input.expectedRevision ?? null, recipientKey, role], resultRef: id,
    authorize: { sql: issuerMember("?"), params: [business] },
    eligible: { sql: `NOT EXISTS (SELECT 1 FROM invitations i WHERE i.id = ? OR (
        i.business_id = scope.business_id AND i.recipient_key = ? AND i.state IN ('pending', 'expired')
        AND NOT EXISTS (SELECT 1 FROM invitations next WHERE next.supersedes_id = i.id)))
      AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = scope.account_id AND a.email_normalized = ?)
      AND (? = 'worker' OR EXISTS (SELECT 1 FROM independent_check))
      AND NOT EXISTS (SELECT 1 FROM memberships m JOIN intended a ON a.id = m.account_id
        WHERE m.business_id = scope.business_id AND (m.state = 'suspended' OR EXISTS (
          SELECT 1 FROM membership_roles g WHERE g.membership_id = m.id AND g.role = ? AND g.revoked_at IS NULL)))`,
      params: [id, recipientKey, email, role, role] },
    writes: (guard) => ({ statements: [
      scopedStatement(access, `INSERT INTO invitations (id, token_hash, recipient_key, recipient_email_ciphertext, business_id,
        inviter_id, grant_snapshot, verification_id, issued_at, expires_at, recipient_id, state)
        SELECT ?, ?, ?, ?, scope.business_id, scope.account_id, json_object('kind', 'business_role', 'role', ?),
          CASE WHEN ? = 'foreman' THEN (SELECT id FROM independent_check) END, ${at}, ?, (SELECT id FROM intended), 'pending'
        FROM live_scope scope WHERE ${guard.sql}`, id, link.tokenHash, recipientKey, encrypted, role, role, invitationExpiresAt(ctx.now), ...guard.params ?? []),
      auditInvite(access, guard, id, "invitation_issued"),
    ], effects: invitationMailEffectSql(link) }),
  }, managedInvitationAt("r.result_ref"));
}

type InviteDecision = WireCommand<Record<string, never>>;
export async function reissueInvitation(ctx: RequestScope, access: SessionAccess, keys: InvitationMailKeys, old: string, input: InviteDecision) {
  const id = await mac(keys.lookup, "invitation-reissue-id", old, input.operationId);
  const link = await prepareInvitationLink(keys.encryption, keys.origin, id);
  const fromOld = `FROM invitations i WHERE i.id = ?`;
  return commandPlan(ctx, {
    access, operationId: input.operationId, command: "access.reissue_invitation", input: [old, input.expectedRevision ?? null], resultRef: id,
    authorize: { sql: `EXISTS (${managerLookup})`, params: [old] },
    eligible: { sql: `NOT EXISTS (SELECT 1 FROM invitations WHERE id = ?)
      AND EXISTS (SELECT 1 ${fromOld} AND ${canReplaceInvite("i")} AND i.recipient_email_ciphertext IS NOT NULL
        AND ${reissueAt("i")} <= ${at} AND i.recipient_id IS NOT scope.account_id
        AND (NOT (${transferKind("i")}) OR (${currentTransferMailbox("i")} IS NOT NULL AND ${mayGrantInvite("i")}))
        AND (i.place_id IS NULL OR EXISTS (${freePlaceSlots("i")})))`, params: [id, old] },
    writes: (guard) => ({ statements: [
      scopedStatement(access, `UPDATE invitations SET state = CASE WHEN expires_at <= ${at} THEN 'expired' ELSE 'withdrawn' END,
        ended_at = ${at} WHERE state = 'pending' AND ${guard.sql} AND (id = ? OR (expires_at <= ${at} AND EXISTS (
          SELECT 1 FROM invitations i WHERE i.id = ? AND (i.place_id = invitations.place_id OR
            (i.business_id = invitations.business_id AND i.recipient_key = invitations.recipient_key)))))`,
      ...guard.params ?? [], old, old),
      scopedStatement(access, `INSERT INTO invitations (id, token_hash, recipient_key, recipient_email_ciphertext, business_id,
        place_id, inviter_id, grant_snapshot, verification_id, issued_at, expires_at, recipient_id, supersedes_id, pending_slot, state)
        SELECT ?, ?, i.recipient_key, i.recipient_email_ciphertext, i.business_id, i.place_id, scope.account_id,
          i.grant_snapshot, i.verification_id, ${at}, ?, i.recipient_id, i.id,
          CASE WHEN i.place_id IS NOT NULL THEN (${freePlaceSlots("i")} ORDER BY slot LIMIT 1) END, 'pending'
        FROM invitations i CROSS JOIN live_scope scope WHERE i.id = ? AND ${guard.sql}`,
      id, link.tokenHash, invitationExpiresAt(ctx.now), old, ...guard.params ?? []),
      auditInvite(access, guard, id, "invitation_reissued"),
      ...transferNotice(access, guard, id, link.token),
    ], effects: invitationMailEffectSql(link) }),
  }, managedInvitationAt("r.result_ref"), {
    sql: `SELECT ${reissueAt("i")} ${fromOld} AND ${canReplaceInvite("i")}`, params: [old],
  });
}

export function withdrawInvitation(ctx: RequestScope, access: SessionAccess, id: string, input: InviteDecision) {
  return commandPlan(ctx, {
    access, operationId: input.operationId, command: "access.withdraw_invitation", input: [id, input.expectedRevision ?? null], resultRef: id,
    authorize: { sql: `EXISTS (${managerLookup})`, params: [id] },
    eligible: { sql: `EXISTS (SELECT 1 FROM invitations i WHERE i.id = ? AND i.state = 'pending' AND i.expires_at > ${at})`, params: [id] },
    writes: (guard) => ({ statements: [
      scopedStatement(access, `UPDATE invitations SET state = 'withdrawn', ended_at = ${at} WHERE id = ? AND ${guard.sql}`, id, ...guard.params ?? []),
      auditInvite(access, guard, id, "invitation_withdrawn"),
    ] }),
  }, `SELECT json_object('id', i.id, 'state', 'withdrawn', 'withdrawnAt', i.ended_at) AS value
    FROM invitations i WHERE ${inviteViaReceipt} AND i.state = 'withdrawn'`);
}

const acceptBusinessAllowed = `NOT EXISTS (SELECT 1 FROM memberships m WHERE m.business_id = i.business_id AND m.account_id = scope.account_id
  AND (m.state = 'suspended' OR EXISTS (SELECT 1 FROM membership_roles g WHERE g.membership_id = m.id
    AND g.role = ${inviteRole("i")} AND g.revoked_at IS NULL)))`;

function acceptBusiness(access: SessionAccess, guard: CommandStatement, id: string): CommandStatement[] {
  const grant = crypto.randomUUID();
  const forInvite = `i.id = ? AND i.business_id IS NOT NULL AND ${guard.sql}`;
  const args = [id, ...guard.params ?? []];
  return [
    scopedStatement(access, `INSERT INTO memberships (id, business_id, account_id, state)
      SELECT ?, i.business_id, i.recipient_id, 'active' FROM invitations i WHERE ${forInvite}
      ON CONFLICT (business_id, account_id) DO UPDATE SET state = 'active' WHERE memberships.state = 'revoked'`, crypto.randomUUID(), ...args),
    scopedStatement(access, `INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at)
      SELECT ?, m.id, m.business_id, m.account_id, ${inviteRole("i")}, ${at} FROM invitations i
      JOIN memberships m ON m.business_id = i.business_id AND m.account_id = i.recipient_id WHERE ${forInvite}`, grant, ...args),
    scopedStatement(access, `INSERT INTO account_contexts (id, account_id, role, business_id, role_grant_id)
      SELECT ?, g.account_id, g.role, g.business_id, g.id FROM membership_roles g WHERE g.id = ? AND ${guard.sql}
      ON CONFLICT (account_id, role, business_id) WHERE business_id IS NOT NULL DO UPDATE SET role_grant_id = excluded.role_grant_id`,
    crypto.randomUUID(), grant, ...guard.params ?? []),
    scopedStatement(access, `INSERT INTO access_audit (id, business_id, actor_id, subject_account_id, verification_id, kind, at)
      SELECT ?, i.business_id, i.recipient_id, i.recipient_id, i.verification_id, 'role_granted', ${at}
      FROM invitations i WHERE ${forInvite}`, crypto.randomUUID(), ...args),
  ];
}

function acceptPlace(access: SessionAccess, guard: CommandStatement, id: string): CommandStatement[] {
  const transfer = transferKind("i");
  const match = `i.id = ? AND i.place_id IS NOT NULL AND ${guard.sql}`;
  const args = [id, ...guard.params ?? []];
  const predecessor = `SELECT i.place_id, i.inviter_id FROM invitations i WHERE ${match} AND ${transfer}`;
  return [
    scopedStatement(access, `INSERT INTO place_people (place_id, account_id, verified_from, history_from)
      SELECT i.place_id, i.recipient_id, ${at}, ${at} FROM invitations i WHERE ${match}
      ON CONFLICT (place_id, account_id) DO UPDATE SET verified_from = excluded.verified_from, history_from = excluded.history_from,
        ends_at = NULL WHERE place_people.ends_at IS NOT NULL`, ...args),
    scopedStatement(access, `UPDATE place_grants SET revoked_at = ${at} WHERE revoked_at IS NULL AND valid_from <= ${at}
      AND (place_id, account_id) IN (SELECT i.place_id, i.recipient_id FROM invitations i WHERE ${match})
      AND capability = 'view' AND valid_until <= ${at}`, ...args),
    scopedStatement(access, `INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, approval_verification_id, valid_from)
      SELECT ?, i.place_id, i.recipient_id, 'view', i.inviter_id, i.verification_id, ${at} FROM invitations i WHERE ${match}
      ON CONFLICT (place_id, account_id, capability) WHERE revoked_at IS NULL DO NOTHING`, crypto.randomUUID(), ...args),
    scopedStatement(access, `UPDATE place_grants SET revoked_at = max(valid_from, ${at}) WHERE revoked_at IS NULL
      AND (place_id, account_id) IN (${predecessor})`, ...args),
    scopedStatement(access, `INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, approval_verification_id, valid_from)
      SELECT ?, i.place_id, i.recipient_id, 'approve', i.inviter_id, i.verification_id, ${at}
      FROM invitations i JOIN places p ON p.id = i.place_id AND p.named_approver_id = i.inviter_id WHERE ${match} AND ${transfer}`, crypto.randomUUID(), ...args),
    scopedStatement(access, `INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, approval_verification_id, valid_from)
      SELECT lower(hex(randomblob(16))), i.place_id, i.recipient_id, cap.value, i.inviter_id, i.verification_id, ${at}
      FROM invitations i CROSS JOIN json_each('["message","request","book"]') cap WHERE ${match} AND ${transfer}
      ON CONFLICT (place_id, account_id, capability) WHERE revoked_at IS NULL DO NOTHING`, ...args),
    scopedStatement(access, `UPDATE places SET (owner_id, named_approver_id, revision) = (SELECT i.recipient_id,
      CASE WHEN places.named_approver_id = i.inviter_id THEN i.recipient_id ELSE places.named_approver_id END, places.revision + 1
      FROM invitations i WHERE i.id = ?) WHERE id IN (SELECT i.place_id FROM invitations i WHERE ${match} AND ${transfer})`, id, ...args),
    scopedStatement(access, `UPDATE place_people SET ends_at = max(verified_from, ${at})
      WHERE ends_at IS NULL AND (place_id, account_id) IN (${predecessor})`, ...args),
    scopedStatement(access, `INSERT INTO access_audit (id, place_id, actor_id, subject_account_id, verification_id, kind, at)
      SELECT ?, i.place_id, i.recipient_id, i.recipient_id, i.verification_id, 'owner_transferred', ${at}
      FROM invitations i WHERE ${match} AND ${transfer}`, crypto.randomUUID(), ...args),
    scopedStatement(access, `UPDATE invitations SET state = CASE WHEN expires_at <= ${at} THEN 'expired' ELSE 'withdrawn' END,
      ended_at = ${at} WHERE state = 'pending' AND (place_id, inviter_id) IN (${predecessor})`, ...args),
    bumpVisibilityEpoch(guard, placeInvitationVisibility(id)),
  ];
}

export function decideInvitation(ctx: RequestScope, access: SessionAccess, id: string, input: InviteDecision, decision: "accepted" | "declined") {
  const isAcceptance = decision === "accepted";
  const recipient = intendedRecipient("i", "a");
  return commandPlan(ctx, {
    access, operationId: input.operationId, command: `access.${decision}_invitation`, input: [id, input.expectedRevision ?? null], resultRef: id,
    authorize: { sql: `EXISTS (SELECT 1 FROM invitations i JOIN accounts a ON a.id = scope.account_id WHERE i.id = ? AND ${recipient})`, params: [id] },
    eligible: { sql: `EXISTS (SELECT 1 FROM invitations i JOIN accounts a ON a.id = scope.account_id WHERE i.id = ? AND ${recipient} AND i.state = 'pending'
      AND i.inviter_id <> scope.account_id AND i.issued_at <= ${at} AND i.expires_at > ${at} AND ${mayGrantInvite("i")}
      ${isAcceptance ? `AND (i.business_id IS NULL OR (${acceptBusinessAllowed}))` : ""})`, params: [id] },
    writes: (guard) => ({ statements: [
      scopedStatement(access, `UPDATE invitations SET state = ?, ended_at = ${at}, recipient_id = (SELECT account_id FROM live_scope)
        WHERE id = ? AND ${guard.sql}`, decision, id, ...guard.params ?? []),
      ...(isAcceptance ? [...acceptBusiness(access, guard, id), ...acceptPlace(access, guard, id)] : []),
      auditInvite(access, guard, id, `invitation_${decision}`),
    ], changes: isAcceptance ? placeInvitationChanges(id, ctx.now) : undefined }),
  }, isAcceptance ? `${invitationOpeningSql("scope.account_id")} AND ${inviteViaReceipt}`
    : `SELECT json_object('id', i.id, 'state', 'declined', 'declinedAt', i.ended_at) AS value FROM invitations i
      WHERE ${inviteViaReceipt} AND i.recipient_id = scope.account_id AND i.state = 'declined'`);
}

function withMemberRoleEdits(base: SessionAccess, business: string, member: string, roles: string | null, backup: boolean | null): SessionAccess {
  return { sql: `${base.sql}, edited_member AS MATERIALIZED (
    SELECT m.* FROM memberships m JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
    WHERE m.business_id = ? AND m.id = ?
  ), edits(roles, backup) AS (VALUES (?, ?)),
  requested_roles AS MATERIALIZED (SELECT value AS role FROM edits CROSS JOIN json_each(edits.roles)),
  current_roles AS MATERIALIZED (
    SELECT g.id, g.role, g.granted_at FROM edited_member m JOIN membership_roles g ON g.membership_id = m.id WHERE g.revoked_at IS NULL
  ), added_roles AS MATERIALIZED (SELECT role FROM requested_roles WHERE role NOT IN (SELECT role FROM current_roles)),
  removed_roles AS MATERIALIZED (
    SELECT id, role FROM current_roles WHERE (SELECT roles FROM edits) IS NOT NULL AND role NOT IN (SELECT role FROM requested_roles)
  ), foreman_verification AS (
    SELECT v.id FROM edited_member m JOIN authority_verifications v ON v.business_id = m.business_id AND v.subject_account_id = m.account_id
    CROSS JOIN live_scope scope WHERE v.kind = 'membership' AND v.verified_at <= ${at} AND v.verified_by <> scope.account_id
    ORDER BY v.verified_at DESC, v.id LIMIT 1
  ), backup_edit AS MATERIALIZED (
    SELECT e.enabled FROM (SELECT coalesce(backup, CASE WHEN EXISTS (SELECT 1 FROM removed_roles WHERE role = 'foreman') THEN 0 END)
      AS enabled FROM edits) e CROSS JOIN edited_member m WHERE e.enabled IS NOT NULL AND e.enabled <> EXISTS (
        SELECT 1 FROM business_grants bg WHERE bg.membership_id = m.id AND bg.capability = 'backup_foreman'
          AND ((${liveTerm("bg")} AND e.enabled = 1) OR (bg.revoked_at IS NULL AND e.enabled = 0)))
  )`, params: [...base.params, business, member, roles, backup] };
}

const memberEditChanged = `EXISTS (SELECT 1 FROM added_roles) OR EXISTS (SELECT 1 FROM removed_roles) OR EXISTS (SELECT 1 FROM backup_edit)`;
const memberEditAllowed = `EXISTS (SELECT 1 FROM edited_member m WHERE m.state = 'active'
  AND NOT EXISTS (SELECT 1 FROM added_roles WHERE role = 'provider_admin')
  AND (m.account_id <> scope.account_id OR (NOT EXISTS (SELECT 1 FROM added_roles)
    AND NOT EXISTS (SELECT 1 FROM backup_edit WHERE enabled = 1)))
  AND (NOT EXISTS (SELECT 1 FROM removed_roles WHERE role = 'provider_admin')
    OR (m.account_id <> scope.account_id AND ${otherAdmin("m")}))
  AND (NOT EXISTS (SELECT 1 FROM removed_roles WHERE role = 'foreman') OR NOT (${accountableForeman("m")}))
  AND (NOT EXISTS (SELECT 1 FROM added_roles WHERE role = 'foreman') OR EXISTS (SELECT 1 FROM foreman_verification))
  AND ((SELECT backup FROM edits) IS NOT 1 OR (NOT EXISTS (SELECT 1 FROM removed_roles WHERE role = 'foreman')
    AND (EXISTS (SELECT 1 FROM added_roles WHERE role = 'foreman')
      OR EXISTS (SELECT 1 FROM current_roles WHERE role = 'foreman' AND granted_at <= ${at})))))`;

export function patchBusinessMemberRoles(ctx: RequestScope, base: SessionAccess, business: string, member: string,
  input: WireCommand<BusinessMemberRolesPatch>) {
  const roles = input.payload.roles ? JSON.stringify([...input.payload.roles].sort()) : null;
  const backup = input.payload.backupForeman ?? null;
  const access = withMemberRoleEdits(base, business, member, roles, backup);
  const roleKey = input.payload.roles?.length ? crypto.randomUUID() : null;
  const backupKey = backup === true ? crypto.randomUUID() : null;
  return commandPlan(ctx, {
    access, operationId: input.operationId, command: "access.patch_member_roles", input: [business, member, roles, backup, input.expectedRevision ?? null],
    resultRef: member, authorize: { sql: `EXISTS (SELECT 1 FROM edited_member m WHERE ${issuerMember("m.business_id")})` },
    eligible: { sql: `${memberEditAllowed} AND (${memberEditChanged})` },
    unchanged: { sql: `${memberEditAllowed} AND NOT (${memberEditChanged})` },
    writes: (guard) => ({ statements: [
      bumpVisibilityEpoch(guard, scopedStatement(access, `SELECT c.id AS context_id FROM edited_member m
        JOIN account_contexts c ON c.business_id = m.business_id AND c.account_id = m.account_id
        WHERE c.role_grant_id IN (SELECT id FROM removed_roles)
          OR (c.role = 'foreman' AND EXISTS (SELECT 1 FROM current_roles g WHERE g.id = c.role_grant_id)
            AND EXISTS (SELECT 1 FROM backup_edit))`)),
      scopedStatement(access, `, events(kind, verification_id) AS (
        SELECT 'role_revoked', NULL FROM removed_roles
        UNION ALL SELECT 'role_granted', CASE WHEN role = 'foreman' THEN (SELECT id FROM foreman_verification) END FROM added_roles
        UNION ALL SELECT CASE enabled WHEN 1 THEN 'grant_issued' ELSE 'grant_revoked' END, NULL FROM backup_edit)
        INSERT INTO access_audit (id, business_id, actor_id, subject_account_id, verification_id, kind, at)
        SELECT lower(hex(randomblob(16))), m.business_id, scope.account_id, m.account_id, e.verification_id, e.kind, ${at}
        FROM edited_member m CROSS JOIN live_scope scope CROSS JOIN events e WHERE ${guard.sql}`, ...guard.params ?? []),
      scopedStatement(access, `UPDATE business_grants AS g SET revoked_at = max(g.valid_from, ${at})
        WHERE g.membership_id = (SELECT id FROM edited_member) AND g.revoked_at IS NULL AND ${guard.sql}
          AND (json_array_length((SELECT roles FROM edits)) = 0
            OR (g.capability = 'membership_admin' AND EXISTS (SELECT 1 FROM removed_roles WHERE role = 'provider_admin'))
            OR (g.capability = 'backup_foreman' AND EXISTS (SELECT 1 FROM backup_edit)))`, ...guard.params ?? []),
      ...backupKey === null ? [] : [scopedStatement(access, `INSERT INTO business_grants
        (id, business_id, membership_id, capability, issuer_id, valid_from)
        SELECT ?, m.business_id, m.id, 'backup_foreman', scope.account_id, ${at}
        FROM edited_member m CROSS JOIN live_scope scope JOIN backup_edit e ON e.enabled = 1 WHERE ${guard.sql}`,
      backupKey, ...guard.params ?? [])],
      ...roles === null ? [] : [scopedStatement(access, `UPDATE membership_roles SET revoked_at = max(granted_at, ${at}),
        revoked_by = (SELECT account_id FROM live_scope) WHERE id IN (SELECT id FROM removed_roles) AND ${guard.sql}`, ...guard.params ?? [])],
      ...roleKey === null ? [] : [
        scopedStatement(access, `INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at)
          SELECT ? || '_' || r.role, m.id, m.business_id, m.account_id, r.role, ${at}
          FROM edited_member m CROSS JOIN added_roles r WHERE ${guard.sql}`, roleKey, ...guard.params ?? []),
        scopedStatement(access, `INSERT INTO account_contexts (id, account_id, role, business_id, role_grant_id)
          SELECT lower(hex(randomblob(16))), g.account_id, g.role, g.business_id, g.id FROM membership_roles g
          WHERE g.membership_id = (SELECT id FROM edited_member) AND g.id = ? || '_' || g.role AND ${guard.sql}
          ON CONFLICT (account_id, role, business_id) WHERE business_id IS NOT NULL DO UPDATE SET role_grant_id = excluded.role_grant_id`,
        roleKey, ...guard.params ?? []),
        bumpVisibilityEpoch(guard, { sql: `SELECT id AS context_id FROM account_contexts
          WHERE account_id = (SELECT account_id FROM memberships WHERE id = ?) AND role_grant_id = ? || '_' || role`, params: [member, roleKey] }),
      ],
      ...input.payload.roles?.length === 0 ? [scopedStatement(access, `UPDATE memberships SET state = 'revoked'
        WHERE id = (SELECT id FROM edited_member) AND ${guard.sql}`, ...guard.params ?? [])] : [],
    ], topicChanges: scopedStatement(access, `, revoked AS MATERIALIZED (
        SELECT c.id, c.business_id, c.role FROM edited_member m JOIN account_contexts c ON c.business_id = m.business_id AND c.account_id = m.account_id
        JOIN membership_roles g ON g.id = c.role_grant_id CROSS JOIN live_scope scope
        WHERE (SELECT roles FROM edits) IS NOT NULL AND c.role NOT IN (SELECT role FROM requested_roles)
          AND g.revoked_at = max(g.granted_at, ${at}) AND g.revoked_by = scope.account_id)
      SELECT 'scope-inbox' AS kind, id AS opaque_id, id AS revoked_scope_id FROM revoked
      UNION ALL SELECT 'provider-crew', m.business_id, r.id FROM edited_member m LEFT JOIN revoked r ON r.role IN ('provider_admin', 'foreman')
      UNION ALL SELECT 'scope-inbox', c.id, NULL FROM edited_member m
        JOIN account_contexts c ON c.business_id = m.business_id AND c.account_id = m.account_id AND c.role = 'foreman'
        JOIN business_grants g ON g.membership_id = m.id AND g.capability = 'backup_foreman'
        WHERE (g.id = ? OR ((SELECT backup FROM edits) = 0 AND g.revoked_at = max(g.valid_from, ${at})))
          AND NOT EXISTS (SELECT 1 FROM revoked WHERE role = 'foreman')`, backupKey) }),
  }, `SELECT json_object('member', json(CASE WHEN m.state = 'active' THEN ${businessMemberProjection("m", "scope.account_id", "1")} END)) AS value
    FROM edited_member m JOIN accounts a ON a.id = m.account_id`);
}

const revokeTarget = `FROM membership_roles g JOIN memberships m ON m.id = g.membership_id WHERE m.id = ? AND g.id = ?`;
export function revokeBusinessRole(ctx: RequestScope, access: SessionAccess, member: string, input: WireCommand<{ roleGrantId: string }>) {
  const grant = input.payload.roleGrantId;
  return commandPlan(ctx, {
    access, operationId: input.operationId, command: "access.revoke_role", input: [member, grant, input.expectedRevision ?? null], resultRef: grant,
    authorize: { sql: `EXISTS (SELECT 1 ${revokeTarget} AND ${issuerMember("m.business_id")})`, params: [member, grant] },
    eligible: { sql: `EXISTS (SELECT 1 ${revokeTarget} AND m.state = 'active' AND g.revoked_at IS NULL AND g.granted_at <= ${at}
      AND (g.role <> 'provider_admin' OR (m.account_id <> scope.account_id AND ${otherAdmin("m")}))
      AND (g.role <> 'foreman' OR NOT (${accountableForeman("m")})))`, params: [member, grant] },
    writes: (guard) => ({ statements: [
      scopedStatement(access, `UPDATE membership_roles SET revoked_at = ${at}, revoked_by = (SELECT account_id FROM live_scope)
        WHERE id = ? AND ${guard.sql}`, grant, ...guard.params ?? []),
      scopedStatement(access, `UPDATE memberships SET state = 'revoked' WHERE id = ? AND ${guard.sql}
        AND NOT EXISTS (SELECT 1 FROM membership_roles g WHERE g.membership_id = memberships.id AND g.revoked_at IS NULL)`, member, ...guard.params ?? []),
      scopedStatement(access, `UPDATE business_grants SET revoked_at = max(valid_from, ${at}) WHERE membership_id = ? AND revoked_at IS NULL
        AND ${guard.sql} AND (EXISTS (SELECT 1 FROM memberships m WHERE m.id = business_grants.membership_id AND m.state = 'revoked')
          OR (capability = 'membership_admin' AND EXISTS (SELECT 1 FROM membership_roles g WHERE g.id = ? AND g.role = 'provider_admin')))`,
      member, ...guard.params ?? [], grant),
      bumpVisibilityEpoch(guard, { sql: "SELECT id AS context_id FROM account_contexts WHERE role_grant_id = ?", params: [grant] }),
      scopedStatement(access, `INSERT INTO access_audit (id, business_id, actor_id, subject_account_id, kind, at)
        SELECT ?, g.business_id, g.revoked_by, g.account_id, 'role_revoked', ${at} FROM membership_roles g WHERE g.id = ? AND ${guard.sql}`, crypto.randomUUID(), grant, ...guard.params ?? []),
    ], topicChanges: { sql: `WITH revoked AS MATERIALIZED (
      SELECT id, business_id, role FROM account_contexts WHERE role_grant_id = ?)
      SELECT 'scope-inbox' AS kind, id AS opaque_id, id AS revoked_scope_id FROM revoked
      UNION ALL SELECT 'provider-crew', business_id, id FROM revoked WHERE role IN ('provider_admin', 'foreman')`, params: [grant] } }),
  }, `SELECT json_object('revoked', ${revokedRoleProjection("m", "g")}, 'member', json(CASE WHEN m.state = 'active' THEN
    ${businessMemberProjection("m", "scope.account_id", "1")} END)) AS value
    FROM membership_roles g JOIN memberships m ON m.id = g.membership_id JOIN accounts a ON a.id = m.account_id
    JOIN accounts revoker ON revoker.id = g.revoked_by WHERE g.id = r.result_ref`);
}
