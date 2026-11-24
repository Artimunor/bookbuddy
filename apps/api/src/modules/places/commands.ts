import type { CommandInput as WireCommand, ErrorBody } from "@bookbuddy/api-contract";
import { invitationExpiresAt, INVITATION_POLICY } from "@bookbuddy/domain";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { bumpVisibilityEpoch, planOperation } from "../../db/operations";
import type { OperationResult, OperationSpec } from "../../db/operations";
import type { RequestScope } from "../../db/scope";
import { managedInvitationAt } from "../access/invitations";
import { invitationMailEffectSql, prepareInvitationLink, sealInviteEmail } from "../access/mail";
import type { InvitationMailKeys } from "../access/mail";
import { addressResetPrefix, afterAddressReset, at, freePlaceSlots, inviteKind, scopedStatement } from "../access/policy";
import { mac, mailboxKey, randomToken } from "../auth/crypto";
import { hashSessionCredential } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { withPinArea } from "./area";
import { sealTransferLocator, transferNotice } from "./invitation";
import {
  activePlace, bookedPlace, currentPerson, normalizedAddress, ownerVerification,
  placeCapability, placeChanges, placeContextIds, placeManager, verifiedOwner,
} from "./policy";
import { placeDetailsAt } from "./read";

type Versioned<T> = WireCommand<T> & { expectedRevision: number };
type Pin = { latitude: number; longitude: number };
type PlaceEdit = { alias?: string; address?: string; safeArrivalNote?: string | null };
type Successor = { successorAccountId: string };

export interface PlaceCommandResult { operation: OperationResult; value: string | null; error?: ErrorBody }

interface PlaceOperation extends OperationSpec {
  access: SessionAccess;
  authorize: CommandStatement;
  revision?: number;
  projection?: string;
}

async function preparePlaceOperation(ctx: RequestScope, spec: PlaceOperation): Promise<CommandInput<PlaceCommandResult>> {
  const operation = await planOperation(ctx, spec);
  const position = operation.statements.length;
  const { authorize, projection = placeDetailsAt("r.result_ref") } = spec;
  return { statements: [...operation.statements, scopedStatement(spec.access, `SELECT (${projection}) AS value,
    ${spec.revision === undefined ? "NULL" : "(SELECT revision FROM selected_place)"} AS revision
    FROM live_scope scope LEFT JOIN operation_receipts r ON r.account_id = scope.account_id AND r.context_id = scope.context_id
      AND r.operation_id = ? AND r.command = ? WHERE ${authorize.sql}`,
  spec.operationId, spec.command, ...authorize.params ?? [])], decode(results) {
    const outcome = operation.decode(results);
    const row = results[position]?.results[0] as { value: string | null; revision: number | null } | undefined;
    if (outcome.outcome.status === "rejected") {
      const error = outcome.outcome.error;
      return { operation: outcome, value: null, error: error.code === "CONFLICT" && spec.revision !== undefined
        && row?.revision != null && row.revision !== spec.revision
        ? { code: "STALE_REVISION", current: { kind: "revision", revision: row.revision } } : error };
    }
    return { operation: outcome, value: row?.value ?? null };
  } };
}

function withPlace(base: SessionAccess, place: string): SessionAccess {
  return { sql: `${base.sql}, selected_place AS MATERIALIZED (
    SELECT p.*, pp.verified_from, scope.account_id AS actor_id
    FROM live_scope scope JOIN place_people pp ON pp.account_id = scope.account_id
    JOIN places p ON p.id = pp.place_id WHERE p.id = ? AND scope.role = 'customer'
      AND ${currentPerson("pp")} AND p.state <> 'restricted')`, params: [...base.params, place] };
}

const ownerOnly = { sql: "EXISTS (SELECT 1 FROM selected_place p WHERE p.actor_id = p.owner_id)" };
const managerOnly = { sql: `EXISTS (SELECT 1 FROM selected_place p WHERE ${activePlace("p")} AND ${placeManager("p", "p.actor_id")})` };
const selected = "(SELECT id FROM selected_place)";
const ownerVerified = verifiedOwner("p", "p");
const notBooked = `NOT (${bookedPlace("p.id")})`;
const candidate = (check: string) => `EXISTS (SELECT 1 FROM selected_place p WHERE p.revision = ? AND (${check}))`;
const byRevision = (revision: number, check: string, ...params: unknown[]): CommandStatement => ({
  sql: candidate(check), params: [revision, ...params],
});

function audit(access: SessionAccess, guard: CommandStatement, kind: string, subject = "NULL", verification = "NULL") {
  return scopedStatement(access, `INSERT INTO access_audit (id, place_id, actor_id, subject_account_id, verification_id, kind, at)
    SELECT ?, p.id, p.actor_id, ${subject}, ${verification}, ?, ${at} FROM selected_place p WHERE ${guard.sql}`,
  crypto.randomUUID(), kind, ...guard.params ?? []);
}

const placeCreationAuditId = "'create:' || scope.account_id || ':' || ?";
export function createPlace(ctx: RequestScope, base: SessionAccess, input: WireCommand<PlaceEdit & { alias: string; address: string; pin?: Pin }>) {
  const place = crypto.randomUUID(), { alias, pin, safeArrivalNote = null } = input.payload;
  const address = normalizedAddress(input.payload.address);
  const access = pin ? withPinArea(base, pin) : base;
  return preparePlaceOperation(ctx, {
    access, operationId: input.operationId, command: "places.create", input: [alias, address, safeArrivalNote, pin ?? null, input.expectedRevision ?? null],
    resultRef: place, authorize: { sql: "scope.role = 'customer'" },
    eligible: { sql: `NOT EXISTS (SELECT 1 FROM access_audit WHERE id = ${placeCreationAuditId})`, params: [input.operationId] },
    writes: (guard) => ({ statements: [
      scopedStatement(access, `INSERT INTO places (id, owner_id, alias, normalized_address, safe_arrival_note, pin, area_id, site_zone, state)
        SELECT ?, scope.account_id, ?, ?, ?, ?, ${pin ? "(SELECT id FROM pin_area), (SELECT site_zone FROM pin_area)" : "NULL, NULL"},
          'pending_verification' FROM live_scope scope WHERE ${guard.sql}`,
      place, alias, address, safeArrivalNote, pin ? JSON.stringify(pin) : null, ...guard.params ?? []),
      scopedStatement(access, `INSERT INTO place_people (place_id, account_id, verified_from, history_from)
        SELECT ?, account_id, ${at}, ${at} FROM live_scope WHERE ${guard.sql}`, place, ...guard.params ?? []),
      scopedStatement(access, `UPDATE places SET named_approver_id = owner_id WHERE id = ? AND ${guard.sql}`, place, ...guard.params ?? []),
      scopedStatement(access, `INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, valid_from)
        SELECT ?, ?, account_id, 'view', account_id, ${at} FROM live_scope WHERE ${guard.sql}`,
      crypto.randomUUID(), place, ...guard.params ?? []),
      scopedStatement(access, `INSERT INTO access_audit (id, place_id, actor_id, subject_account_id, kind, at)
        SELECT ${placeCreationAuditId}, ?, scope.account_id, scope.account_id, 'grant_issued', ${at}
        FROM live_scope scope WHERE ${guard.sql}`, input.operationId, place, ...guard.params ?? []),
      bumpVisibilityEpoch(guard, { sql: `SELECT context_id FROM (${access.sql} SELECT context_id FROM live_scope)`, params: access.params }),
    ], changes: placeChanges(place, ctx.now) }),
  });
}

export function patchPlace(ctx: RequestScope, base: SessionAccess, place: string, input: Versioned<PlaceEdit>) {
  const { alias, safeArrivalNote } = input.payload;
  const address = input.payload.address === undefined ? undefined : normalizedAddress(input.payload.address);
  const changedAddress = `SELECT p.id FROM selected_place p WHERE p.normalized_address <> ?`;
  const moving = "(? IS NOT NULL AND p.normalized_address <> ?)";
  const access = withPlace(base, place);
  const audience = address === undefined ? null : placeContextIds(place, ctx.now);
  return preparePlaceOperation(ctx, {
    access, operationId: input.operationId, command: "places.patch", input: [place, input.expectedRevision, { alias, address, safeArrivalNote }],
    resultRef: place, revision: input.expectedRevision, authorize: ownerOnly,
    eligible: byRevision(input.expectedRevision, `p.state <> 'archived' AND (NOT ${moving} OR ${notBooked})`, address ?? null, address ?? null),
    writes: (guard) => ({ statements: [
      ...address === undefined || !audience ? [] : [
        scopedStatement(access, `INSERT INTO access_audit (id, place_id, actor_id, subject_account_id, kind, at)
          SELECT ?, p.id, p.actor_id, p.owner_id, 'grant_revoked', ${at} FROM selected_place p
          WHERE p.normalized_address <> ? AND ${guard.sql}`,
        `${addressResetPrefix}${crypto.randomUUID()}`, address, ...guard.params ?? []),
        scopedStatement(access, `UPDATE place_grants SET revoked_at = max(valid_from, ${at})
          WHERE place_id IN (${changedAddress}) AND capability IN ('book', 'request') AND revoked_at IS NULL AND ${guard.sql}`,
        address, ...guard.params ?? []),
        scopedStatement(access, `UPDATE invitations SET state = CASE WHEN expires_at <= ${at} THEN 'expired' ELSE 'withdrawn' END,
          ended_at = ${at} WHERE place_id IN (${changedAddress}) AND state = 'pending' AND ${guard.sql}`, address, ...guard.params ?? []),
        bumpVisibilityEpoch(guard, { sql: `SELECT context_id FROM (${audience.sql})
          WHERE EXISTS (${access.sql} ${changedAddress})`,
        params: [...audience.params ?? [], ...access.params, address] }),
      ],
      scopedStatement(access, `, edits(alias, address, has_note, note) AS (VALUES (?, ?, ?, ?))
        UPDATE places AS p SET (alias, normalized_address, safe_arrival_note, pin, area_id, site_zone, state, revision) = (
          SELECT coalesce(e.alias, p.alias), coalesce(e.address, p.normalized_address),
            CASE WHEN e.has_note THEN e.note ELSE p.safe_arrival_note END,
            CASE WHEN e.address IS NULL OR e.address = p.normalized_address THEN p.pin END,
            CASE WHEN e.address IS NULL OR e.address = p.normalized_address THEN p.area_id END,
            CASE WHEN e.address IS NULL OR e.address = p.normalized_address THEN p.site_zone END,
            CASE WHEN e.address IS NOT NULL AND e.address <> p.normalized_address THEN 'pending_verification' ELSE p.state END,
            p.revision + 1 FROM edits e) WHERE p.id = ${selected} AND ${guard.sql}`,
      alias ?? null, address ?? null, safeArrivalNote !== undefined, safeArrivalNote ?? null, ...guard.params ?? []),
    ], changes: placeChanges(place, ctx.now) }),
  });
}

const ownerPinCapabilities = '["message","request","book","approve"]';
export function verifyPlacePin(ctx: RequestScope, base: SessionAccess, place: string, input: Versioned<{ pin: Pin }>) {
  const { pin } = input.payload;
  const access = withPinArea(withPlace(base, place), pin);
  // When no unambiguous approved area supplies the site's zone, operations
  // must resolve it. `out_of_area` is only valid with an independently known zone.
  const verifyOwner = `(SELECT (${ownerVerification("p", "p")}) FROM selected_place p)`;
  const activate = `${verifyOwner} IS NOT NULL AND EXISTS (SELECT 1 FROM pin_area)`;
  const audience = placeContextIds(place, ctx.now);
  return preparePlaceOperation(ctx, {
    access, operationId: input.operationId, command: "places.verify_pin", input: [place, input.expectedRevision, pin],
    resultRef: place, revision: input.expectedRevision, authorize: ownerOnly,
    eligible: byRevision(input.expectedRevision, `p.state <> 'archived' AND ${notBooked}`),
    writes: (guard) => ({ statements: [
      bumpVisibilityEpoch(guard, { sql: `SELECT context_id FROM (${audience.sql}) WHERE EXISTS (
        ${access.sql} SELECT 1 FROM selected_place p WHERE (${activePlace("p")}) <> (${activate}))`,
      params: [...audience.params ?? [], ...access.params] }),
      scopedStatement(access, `UPDATE places SET pin = ?, area_id = (SELECT id FROM pin_area), site_zone = (SELECT site_zone FROM pin_area),
        state = CASE WHEN ${activate} THEN 'in_area' ELSE 'pending_verification' END, revision = revision + 1
        WHERE id = ${selected} AND ${guard.sql}`, JSON.stringify(pin), ...guard.params ?? []),
      scopedStatement(access, `INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, approval_verification_id, valid_from)
        SELECT lower(hex(randomblob(16))), p.id, p.owner_id, capability, p.actor_id, (${ownerVerification("p", "p")}), ${at}
        FROM selected_place p CROSS JOIN (SELECT value AS capability FROM json_each(?)) cap
        WHERE p.state = 'in_area' AND ${guard.sql}
          AND (capability <> 'approve' OR p.named_approver_id = p.owner_id)
        ON CONFLICT (place_id, account_id, capability) WHERE revoked_at IS NULL DO NOTHING`,
      ownerPinCapabilities, ...guard.params ?? []),
      audit(access, { sql: `${guard.sql} AND p.state = 'in_area'`, params: guard.params }, "place_verified", "p.owner_id", verifyOwner),
    ], changes: placeChanges(place, ctx.now) }),
  });
}

export function changePlaceApprover(ctx: RequestScope, base: SessionAccess, place: string, input: Versioned<Successor>) {
  const successor = input.payload.successorAccountId;
  const selectedAccess = withPlace(base, place);
  const access = { sql: `${selectedAccess.sql}, approver_verification AS MATERIALIZED (
    SELECT v.id, a.id AS account_id FROM selected_place p JOIN place_people person ON person.place_id = p.id
    JOIN accounts a ON a.id = person.account_id AND a.state = 'active'
    JOIN authority_verifications v ON v.place_id = p.id AND v.subject_account_id = a.id AND v.kind = 'place_approver'
    WHERE a.id = ? AND ${currentPerson("person")} AND v.verified_at BETWEEN person.verified_from AND ${at}
      AND v.verified_by <> p.owner_id AND ${placeCapability("p.id", "a.id", "view")}
    ORDER BY v.verified_at DESC, v.id LIMIT 1)`, params: [...selectedAccess.params, successor] };
  return preparePlaceOperation(ctx, {
    access, operationId: input.operationId, command: "places.change_approver", input: [place, input.expectedRevision, successor],
    resultRef: place, revision: input.expectedRevision, authorize: ownerOnly,
    eligible: byRevision(input.expectedRevision, `${activePlace("p")} AND ${ownerVerified}
      AND p.named_approver_id IS NOT ? AND EXISTS (SELECT 1 FROM approver_verification)`, successor),
    writes: (guard) => ({ statements: [
      bumpVisibilityEpoch(guard, { sql: `SELECT c.id AS context_id FROM places p JOIN account_contexts c ON c.role = 'customer'
        AND c.account_id IN (p.named_approver_id, ?) WHERE p.id = ?`, params: [successor, place] }),
      scopedStatement(access, `UPDATE place_grants SET revoked_at = max(valid_from, ${at}) WHERE place_id = ${selected}
        AND capability = 'approve' AND revoked_at IS NULL AND ${guard.sql}`, ...guard.params ?? []),
      scopedStatement(access, `INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, approval_verification_id, valid_from)
        SELECT ?, p.id, v.account_id, 'approve', p.actor_id, v.id, ${at}
        FROM selected_place p CROSS JOIN approver_verification v WHERE ${guard.sql}`, crypto.randomUUID(), ...guard.params ?? []),
      scopedStatement(access, `UPDATE places SET named_approver_id = ?, revision = revision + 1 WHERE id = ${selected} AND ${guard.sql}`,
      successor, ...guard.params ?? []),
      audit(access, guard, "approver_changed", "(SELECT account_id FROM approver_verification)", "(SELECT id FROM approver_verification)"),
    ], changes: placeChanges(place, ctx.now) }),
  });
}

export function archivePlace(ctx: RequestScope, base: SessionAccess, place: string, input: Versioned<Record<string, never>>) {
  const access = withPlace(base, place);
  return preparePlaceOperation(ctx, {
    access, operationId: input.operationId, command: "places.archive", input: [place, input.expectedRevision], resultRef: place,
    revision: input.expectedRevision, authorize: ownerOnly,
    // A booked visit is a commitment; an open request alone is not a booking.
    eligible: byRevision(input.expectedRevision, `p.state <> 'archived' AND ${ownerVerified} AND ${notBooked}`),
    projection: `SELECT json_object('id', p.id, 'revision', p.revision, 'state', p.state, 'archivedAt', r.committed_at)
      FROM selected_place p WHERE p.id = r.result_ref AND p.state = 'archived'`,
    writes: (guard) => ({ statements: [
      bumpVisibilityEpoch(guard, placeContextIds(place, ctx.now)),
      scopedStatement(access, `UPDATE places SET state = 'archived', revision = revision + 1
        WHERE id = ${selected} AND ${guard.sql}`, ...guard.params ?? []),
      scopedStatement(access, `UPDATE place_grants SET revoked_at = max(valid_from, ${at}) WHERE place_id = ${selected}
        AND capability <> 'view' AND revoked_at IS NULL AND ${guard.sql}`, ...guard.params ?? []),
      scopedStatement(access, `UPDATE invitations SET state = CASE WHEN expires_at <= ${at} THEN 'expired' ELSE 'withdrawn' END,
        ended_at = ${at} WHERE place_id = ${selected} AND state = 'pending' AND ${guard.sql}`, ...guard.params ?? []),
      audit(access, guard, "place_archived", "p.owner_id"),
    ], changes: placeChanges(place, ctx.now, "remove") }),
  });
}

const availableSlot = `SELECT slot FROM (${freePlaceSlots("target")}) ORDER BY slot LIMIT 1`;

export async function issuePlaceInvitation(ctx: RequestScope, base: SessionAccess, keys: InvitationMailKeys, place: string,
  input: Versioned<{ email: string }> | Versioned<Successor>) {
  const data = input.payload;
  const transfer = "successorAccountId" in data;
  const recipient = transfer ? data.successorAccountId : data.email.trim().toLowerCase();
  const kind = transfer ? "place_transfer" : "place_view";
  const recipientLookup = transfer ? recipient : await mailboxKey(keys.lookup, recipient);
  const id = await mac(keys.lookup, `places.invitation.${kind}`, place, recipientLookup, input.operationId);
  const selectedAccess = withPlace(base, place);
  const access = { sql: `${selectedAccess.sql}, recipient AS MATERIALIZED (
      SELECT a.id, a.email_key, a.verified_at FROM accounts a WHERE ${transfer ? "a.id" : "a.email_normalized"} = ?
        AND a.state = 'active' AND a.verified_at <= ${at}${transfer ? " AND a.email_key IS NOT NULL AND EXISTS (SELECT 1 FROM account_contexts c WHERE c.account_id = a.id AND c.role = 'customer')" : ""}
    ), target AS (SELECT ${selected} AS place_id, '' AS id,
      ${transfer ? "(SELECT email_key FROM recipient)" : "?"} AS recipient_key), transfer_verification AS MATERIALIZED (
      SELECT v.id FROM authority_verifications v JOIN selected_place p ON p.id = v.place_id
      JOIN recipient a ON a.id = v.subject_account_id WHERE v.kind = 'place_transfer' AND v.verified_by <> p.owner_id
        AND ${afterAddressReset("p.id", "v.verified_at")}
        AND v.verified_at BETWEEN max(a.verified_at, p.verified_from, coalesce((SELECT max(audit.at) FROM access_audit audit
          WHERE audit.place_id = p.id AND audit.kind = 'owner_transferred'), 0)) AND ${at}
      ORDER BY v.verified_at DESC, v.id LIMIT 1)`,
    params: [...selectedAccess.params, recipient, ...(transfer ? [] : [recipientLookup])] };
  const transferToken = transfer ? randomToken() : null;
  const link = transferToken === null ? await prepareInvitationLink(keys.encryption, keys.origin, id) : null;
  const [sealedRecipient, tokenHash] = await Promise.all([
    transfer ? sealTransferLocator(keys.encryption, place, recipient) : sealInviteEmail(keys.encryption, recipientLookup, recipient),
    link ? link.tokenHash : hashSessionCredential(transferToken!),
  ]);
  return preparePlaceOperation(ctx, {
    access, operationId: input.operationId, command: `places.${kind}`, input: [place, input.expectedRevision, recipientLookup],
    resultRef: id, revision: input.expectedRevision, authorize: transfer ? ownerOnly : managerOnly,
    eligible: byRevision(input.expectedRevision, `${activePlace("p")} AND NOT EXISTS (SELECT 1 FROM invitations WHERE id = ?)
      AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = p.actor_id AND ${transfer ? "a.id" : "a.email_normalized"} = ?)
      AND NOT EXISTS (SELECT 1 FROM invitations i CROSS JOIN target WHERE i.place_id = target.place_id
        AND (i.recipient_key = target.recipient_key OR i.recipient_id = (SELECT id FROM recipient))
        AND ((i.state = 'pending' AND i.expires_at > ${at}) OR (${inviteKind("i")} = ? AND i.state <> 'accepted'
          AND ${afterAddressReset("p.id", "i.issued_at")}
          AND i.issued_at > ${at} - ${INVITATION_POLICY.reissueWindowMs})))
      AND EXISTS (SELECT 1 FROM target WHERE (${availableSlot}) IS NOT NULL)
      AND ${transfer ? `${ownerVerified} AND EXISTS (SELECT 1 FROM transfer_verification)` : `NOT EXISTS (
        SELECT 1 FROM recipient a JOIN place_people peer ON peer.place_id = p.id AND peer.account_id = a.id
        WHERE ${currentPerson("peer")} AND (p.owner_id = a.id OR ${placeCapability("p.id", "a.id", "view")}))`}`,
    id, recipient, kind),
    projection: managedInvitationAt("r.result_ref"),
    writes: (guard) => ({ statements: [
      scopedStatement(access, `UPDATE invitations SET state = 'expired', ended_at = ${at}
        WHERE place_id = ${selected} AND state = 'pending' AND expires_at <= ${at} AND ${guard.sql}`, ...guard.params ?? []),
      scopedStatement(access, `INSERT INTO invitations (id, token_hash, recipient_key, recipient_email_ciphertext, place_id, inviter_id,
        grant_snapshot, verification_id, issued_at, expires_at, recipient_id, pending_slot, state)
        SELECT ?, ?, target.recipient_key, ?, p.id, p.actor_id, json_object('kind', ?),
          ${transfer ? "(SELECT id FROM transfer_verification)" : "NULL"}, ${at}, ?, (SELECT id FROM recipient), (${availableSlot}), 'pending'
        FROM selected_place p CROSS JOIN target WHERE ${guard.sql}`, id, tokenHash, sealedRecipient, kind, invitationExpiresAt(ctx.now), ...guard.params ?? []),
      audit(access, guard, "invitation_issued", "(SELECT id FROM recipient)", transfer ? "(SELECT id FROM transfer_verification)" : "NULL"),
      ...(transferToken ? transferNotice(access, guard, id, transferToken) : []),
    ], effects: link ? invitationMailEffectSql(link) : undefined }),
  });
}
