import type { CommandStatement } from "../../db/commit";
import { recordSyncChanges } from "../../db/operations";
import { at, inviteKind, liveTerm, scopedStatement } from "../access/policy";
import { openDelivery, sealDelivery } from "../auth/crypto";
import type { SessionAccess } from "../auth/session";
import { currentPerson, placeViewer } from "./policy";

export const transferKind = (invite: string) => `${inviteKind(invite)} = 'place_transfer'`;
export const currentTransferMailbox = (invite: string) => `(SELECT a.email_normalized FROM accounts a
  WHERE a.id = ${invite}.recipient_id AND a.email_key = ${invite}.recipient_key AND a.state = 'active')`;

// Pending invitations require a sealed recipient. A transfer knows an account ID,
// not its address. Seal that locator; the batch binds it to that account's current
// mailbox key. Never send a transfer to a looked-up or changed address by email.
const locatorAad = (place: string) => `place-transfer-recipient:${place}`;
export const sealTransferLocator = (key: CryptoKey, place: string, account: string) =>
  sealDelivery(key, locatorAad(place), JSON.stringify(account));
export const openTransferLocator = (key: CryptoKey, place: string, sealed: string) =>
  openDelivery(key, locatorAad(place), sealed);

// Used by the access module for both direct invitation opens and opaque links.
export const placeInvitationGrantSql = `CASE ${inviteKind("i")}
  WHEN 'place_view' THEN json_object('kind', 'place_view', 'placeAlias', p.alias, 'capabilities', json('["view"]'))
  WHEN 'place_transfer' THEN json_object('kind', 'place_transfer', 'placeAlias', p.alias) END`;

export const placeInvitationAccessSql = `SELECT json_object('kind', 'place', 'placeId', p.id, 'placeAlias', p.alias,
  'isOwner', json(CASE WHEN p.owner_id = pp.account_id THEN 'true' ELSE 'false' END), 'historyFrom', pp.history_from,
  'capabilities', json((SELECT json_group_array(capability) FROM (
    SELECT g.capability FROM place_grants g WHERE g.place_id = p.id AND g.account_id = pp.account_id AND ${liveTerm("g")}
      AND (g.capability <> 'approve' OR p.named_approver_id = pp.account_id) ORDER BY g.capability))))
  FROM place_people pp WHERE pp.place_id = p.id AND pp.account_id = i.recipient_id AND ${currentPerson("pp")}
    AND p.state NOT IN ('archived', 'restricted') AND ${placeViewer("p", "pp.account_id")}`;

export const placeInvitationVisibility = (id: string): CommandStatement => ({
  sql: `SELECT c.id AS context_id FROM invitations i JOIN account_contexts c ON c.role = 'customer'
    AND (c.account_id = i.recipient_id OR (${transferKind("i")} AND c.account_id = i.inviter_id))
    WHERE i.id = ? AND i.place_id IS NOT NULL`, params: [id],
});

export const placeInvitationChanges = (id: string, now: number): CommandStatement => ({
  sql: `SELECT 'place' AS kind, i.place_id AS resource_id, c.id AS partition_key,
    CASE WHEN ${transferKind("i")} AND c.account_id = i.inviter_id THEN 'remove' ELSE 'upsert' END AS op, ? AS at
    FROM invitations i JOIN places p ON p.id = i.place_id
    JOIN account_contexts c ON c.role = 'customer' JOIN accounts a ON a.id = c.account_id AND a.state = 'active'
    LEFT JOIN place_people pp ON pp.place_id = p.id AND pp.account_id = c.account_id
    WHERE i.id = ? AND ((${currentPerson("pp", "?")} AND ${placeViewer("p", "pp.account_id", "?")})
      OR (${transferKind("i")} AND c.account_id = i.inviter_id))`, params: [now, id, now, now, now],
});

export function transferNotice(access: SessionAccess, guard: CommandStatement, id: string, token: string): CommandStatement[] {
  const forRecipient = `FROM invitations i JOIN account_contexts c ON c.account_id = i.recipient_id AND c.role = 'customer'
    WHERE i.id = ? AND ${transferKind("i")} AND ${guard.sql}`;
  const args = [id, ...guard.params ?? []];
  return [
    scopedStatement(access, `INSERT INTO link_targets (token, kind, resource_id, required_scope, expires_at)
      SELECT ?, 'place_transfer', i.id, c.id, i.expires_at ${forRecipient}`, token, ...args),
    scopedStatement(access, `INSERT INTO notifications (id, context_id, event_key, kind, link_token, created_at)
      SELECT i.id, c.id, 'place_transfer:' || i.id, 'place_transfer', ?, i.issued_at ${forRecipient}`, token, ...args),
    recordSyncChanges(guard, { sql: `SELECT 'notification' AS kind, id AS resource_id, context_id AS partition_key,
      'upsert' AS op, created_at AS at FROM notifications WHERE id = ? AND kind = 'place_transfer'`, params: [id] }),
  ];
}
