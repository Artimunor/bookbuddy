import type { CommandInput as WireCommand, ErrorBody, PlacePersonPatch } from "@bookbuddy/api-contract";
import { invitationExpiresAt, INVITATION_POLICY } from "@bookbuddy/domain";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { bumpVisibilityEpoch, planOperation } from "../../db/operations";
import type { OperationResult, OperationSpec } from "../../db/operations";
import type { RequestScope } from "../../db/scope";
import { managedInvitationAt } from "../access/invitations";
import { invitationMailEffectSql, prepareInvitationLink, sealInviteEmail } from "../access/mail";
import type { InvitationMailKeys } from "../access/mail";
import { at, freePlaceSlots, inviteKind, liveTerm, scopedStatement } from "../access/policy";
import { mac, mailboxKey, randomToken } from "../auth/crypto";
import { hashSessionCredential } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { withPinArea } from "./area";
import { sealTransferLocator, transferNotice } from "./invitation";
import {
  activePlace, bookedPlace, currentPerson, normalizedAddress, openPlaceCommitments, ownerVerification,
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
        crypto.randomUUID(), address, ...guard.params ?? []),
        scopedStatement(access, `UPDATE place_grants SET revoked_at = max(valid_from, ${at})
          WHERE place_id IN (${changedAddress}) AND capability IN ('approve', 'book', 'request', 'sign_off') AND revoked_at IS NULL AND ${guard.sql}`,
        address, ...guard.params ?? []),
        scopedStatement(access, `UPDATE invitations SET state = CASE WHEN expires_at <= ${at} THEN 'expired' ELSE 'withdrawn' END,
          ended_at = ${at} WHERE place_id IN (${changedAddress}) AND state = 'pending' AND ${guard.sql}`, address, ...guard.params ?? []),
        bumpVisibilityEpoch(guard, { sql: `SELECT context_id FROM (${audience.sql})
          WHERE EXISTS (${access.sql} ${changedAddress})`,
        params: [...audience.params ?? [], ...access.params, address] }),
      ],
      scopedStatement(access, `, edits(alias, address, has_note, note) AS (VALUES (?, ?, ?, ?))
        UPDATE places AS p SET (alias, normalized_address, address_revision, named_approver_id, safe_arrival_note, pin, area_id, site_zone, state, revision) = (
          SELECT coalesce(e.alias, p.alias), coalesce(e.address, p.normalized_address),
            CASE WHEN e.address IS NOT NULL AND e.address <> p.normalized_address THEN p.address_revision + 1 ELSE p.address_revision END,
            CASE WHEN e.address IS NOT NULL AND e.address <> p.normalized_address THEN p.owner_id ELSE p.named_approver_id END,
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
      scopedStatement(access, `INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, approval_verification_id, address_revision, valid_from)
        SELECT lower(hex(randomblob(16))), p.id, p.owner_id, capability, p.actor_id, (${ownerVerification("p", "p")}), p.address_revision, ${at}
        FROM selected_place p CROSS JOIN (SELECT value AS capability FROM json_each(?)) cap
        WHERE p.state = 'in_area' AND ${guard.sql}
          AND (capability <> 'approve' OR p.named_approver_id = p.owner_id)
        ON CONFLICT (place_id, account_id, capability) WHERE revoked_at IS NULL DO NOTHING`,
      ownerPinCapabilities, ...guard.params ?? []),
      audit(access, { sql: `${guard.sql} AND p.state = 'in_area'`, params: guard.params }, "place_verified", "p.owner_id", verifyOwner),
    ], changes: placeChanges(place, ctx.now) }),
  });
}

function withApproverReplacement(base: SessionAccess, successor: string | null): SessionAccess {
  return { sql: `${base.sql}, approver_replacement AS MATERIALIZED (
    SELECT v.id, a.id AS account_id FROM selected_place p JOIN place_people person ON person.place_id = p.id
    JOIN accounts a ON a.id = person.account_id AND a.state = 'active'
    JOIN authority_verifications v ON v.place_id = p.id AND v.subject_account_id = a.id AND v.kind = 'place_approver'
      AND v.address_revision = p.address_revision
    WHERE a.id = ? AND p.named_approver_id IS NOT a.id AND ${currentPerson("person")}
      AND v.verified_at BETWEEN person.verified_from AND ${at} AND v.verified_by <> p.owner_id
      AND ${placeCapability("p.id", "a.id", "view")}
    ORDER BY v.verified_at DESC, v.id LIMIT 1)`, params: [...base.params, successor] };
}

const hasReplacement = "EXISTS (SELECT 1 FROM approver_replacement)";
const replacementAccount = "(SELECT account_id FROM approver_replacement)";
const verifiedReplacement = `${ownerVerified} AND ${hasReplacement}`;

// Both entry points replace the exact approval grant before changing the named
// person, in the same guarded batch. No intermediate state is visible.
function replaceApproverGrants(access: SessionAccess, guard: CommandStatement): CommandStatement[] {
  const replacing = { sql: `${guard.sql} AND ${hasReplacement}`, params: guard.params };
  return [
    scopedStatement(access, `UPDATE place_grants SET revoked_at = max(valid_from, ${at}) WHERE place_id = ${selected}
      AND capability = 'approve' AND revoked_at IS NULL AND ${replacing.sql}`, ...guard.params ?? []),
    scopedStatement(access, `INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, approval_verification_id, address_revision, valid_from)
      SELECT ?, p.id, v.account_id, 'approve', p.actor_id, v.id, p.address_revision, ${at}
      FROM selected_place p CROSS JOIN approver_replacement v WHERE ${guard.sql}`, crypto.randomUUID(), ...guard.params ?? []),
    audit(access, replacing, "approver_changed", replacementAccount, "(SELECT id FROM approver_replacement)"),
  ];
}

export function changePlaceApprover(ctx: RequestScope, base: SessionAccess, place: string, input: Versioned<Successor>) {
  const successor = input.payload.successorAccountId;
  const access = withApproverReplacement(withPlace(base, place), successor);
  return preparePlaceOperation(ctx, {
    access, operationId: input.operationId, command: "places.change_approver", input: [place, input.expectedRevision, successor],
    resultRef: place, revision: input.expectedRevision, authorize: ownerOnly,
    eligible: byRevision(input.expectedRevision, `${activePlace("p")} AND ${verifiedReplacement}`),
    writes: (guard) => ({ statements: [
      bumpVisibilityEpoch(guard, { sql: `SELECT c.id AS context_id FROM places p JOIN account_contexts c ON c.role = 'customer'
        AND c.account_id IN (p.named_approver_id, ?) WHERE p.id = ?`, params: [successor, place] }),
      ...replaceApproverGrants(access, guard),
      scopedStatement(access, `UPDATE places SET named_approver_id = ?, revision = revision + 1 WHERE id = ${selected} AND ${guard.sql}`,
      successor, ...guard.params ?? []),
    ], changes: placeChanges(place, ctx.now) }),
  });
}

const editedPerson = "(SELECT account_id FROM edited_person)";
const placePersonEditAllowed = `${activePlace("p")} AND EXISTS (SELECT 1 FROM edited_person e
  WHERE (e.view_enabled IS NOT 0 OR e.account_id <> p.owner_id)
    AND (e.approve_enabled IS NOT 0 OR CASE WHEN p.named_approver_id = e.account_id
      THEN e.successor_id IS NOT NULL AND e.successor_id <> e.account_id ELSE e.successor_id IS NULL END)
    AND (e.successor_id IS NULL OR CASE WHEN e.successor_id = p.named_approver_id
      THEN ${placeCapability("p.id", "e.successor_id", "approve")} ELSE ${verifiedReplacement} END)
    AND (e.account_id = p.owner_id OR coalesce(e.view_enabled, ${placeCapability("p.id", "e.account_id", "view")})
      OR (coalesce(e.successor_id, p.named_approver_id) <> e.account_id
        AND NOT coalesce(e.message_enabled, ${placeCapability("p.id", "e.account_id", "message")}))))`;
const placePersonChanged = `${hasReplacement} OR EXISTS (SELECT 1 FROM changed_capabilities)`;

export function patchPlacePerson(ctx: RequestScope, base: SessionAccess, place: string, person: string, input: Versioned<PlacePersonPatch>) {
  const { view, message, approve, successorAccountId } = input.payload;
  const successor = approve === true ? person : successorAccountId ?? null;
  const selectedAccess = withApproverReplacement(withPlace(base, place), successor);
  const access = { sql: `${selectedAccess.sql}, edited_person AS MATERIALIZED (
    SELECT p.id AS place_id, peer.account_id, ? AS view_enabled, ? AS message_enabled, ? AS approve_enabled, ? AS successor_id
    FROM selected_place p JOIN place_people peer ON peer.place_id = p.id
    JOIN accounts a ON a.id = peer.account_id AND a.state = 'active' WHERE peer.account_id = ? AND ${currentPerson("peer")}
  ), changed_capabilities AS MATERIALIZED (
    SELECT e.place_id, e.account_id, cap.key AS capability, cap.value AS enabled FROM edited_person e
    CROSS JOIN json_each(json_object('view', e.view_enabled, 'message', e.message_enabled)) cap
    WHERE cap.value IS NOT NULL AND cap.value <> EXISTS (SELECT 1 FROM place_grants g
      WHERE g.place_id = e.place_id AND g.account_id = e.account_id AND g.capability = cap.key
        AND ((${liveTerm("g")} AND cap.value = 1) OR (g.revoked_at IS NULL AND cap.value = 0)))
  )`, params: [...selectedAccess.params, view ?? null, message ?? null, approve ?? null, successor, person] };
  return preparePlaceOperation(ctx, {
    access, operationId: input.operationId, command: "places.patch_person", input: [place, person, input.expectedRevision, input.payload],
    resultRef: place, revision: input.expectedRevision, projection: placeDetailsAt(selected),
    authorize: { sql: `${ownerOnly.sql} AND EXISTS (SELECT 1 FROM edited_person)` },
    eligible: byRevision(input.expectedRevision, `${placePersonEditAllowed} AND (${placePersonChanged})`),
    unchanged: byRevision(input.expectedRevision, `${placePersonEditAllowed} AND NOT (${placePersonChanged})`),
    writes: (guard) => ({ statements: [
      bumpVisibilityEpoch(guard, scopedStatement(access, `SELECT c.id AS context_id FROM selected_place p CROSS JOIN edited_person e
        JOIN account_contexts c ON c.role = 'customer'
        WHERE (c.account_id = e.account_id AND EXISTS (SELECT 1 FROM changed_capabilities))
          OR (${hasReplacement} AND c.account_id IN (p.named_approver_id, ${replacementAccount}))`)),
      ...view === undefined && message === undefined ? [] : [
        scopedStatement(access, `INSERT INTO access_audit (id, place_id, actor_id, subject_account_id, kind, at)
          SELECT lower(hex(randomblob(16))), p.id, p.actor_id, e.account_id,
            CASE e.enabled WHEN 1 THEN 'grant_issued' ELSE 'grant_revoked' END, ${at}
          FROM selected_place p CROSS JOIN changed_capabilities e WHERE ${guard.sql}`, ...guard.params ?? []),
        scopedStatement(access, `UPDATE place_grants SET revoked_at = max(valid_from, ${at})
          WHERE place_id = ${selected} AND account_id = ${editedPerson} AND revoked_at IS NULL
            AND capability IN (SELECT capability FROM changed_capabilities) AND ${guard.sql}`, ...guard.params ?? []),
        ...view === true ? [scopedStatement(access, `UPDATE place_people SET history_from = max(history_from, ${at})
          WHERE place_id = ${selected} AND account_id = ${editedPerson} AND ${guard.sql}
            AND account_id <> (SELECT owner_id FROM selected_place)
            AND EXISTS (SELECT 1 FROM changed_capabilities WHERE capability = 'view' AND enabled = 1)`, ...guard.params ?? [])] : [],
        scopedStatement(access, `INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, address_revision, valid_from)
          SELECT lower(hex(randomblob(16))), e.place_id, e.account_id, e.capability, p.actor_id, p.address_revision, ${at}
          FROM selected_place p CROSS JOIN changed_capabilities e WHERE e.enabled = 1 AND ${guard.sql}`, ...guard.params ?? []),
      ],
      ...(successor === null ? [] : replaceApproverGrants(access, guard)),
      scopedStatement(access, `UPDATE places SET named_approver_id = coalesce(${replacementAccount}, named_approver_id), revision = revision + 1
        WHERE id = ${selected} AND ${guard.sql}`, ...guard.params ?? []),
    ], changes: placeChanges(place, ctx.now) }),
  });
}

export function archivePlace(ctx: RequestScope, base: SessionAccess, place: string, input: Versioned<Record<string, never>>) {
  const access = withPlace(base, place);
  return preparePlaceOperation(ctx, {
    access, operationId: input.operationId, command: "places.archive", input: [place, input.expectedRevision], resultRef: place,
    revision: input.expectedRevision, authorize: ownerOnly,
    eligible: byRevision(input.expectedRevision, `p.state <> 'archived' AND ${ownerVerified} AND NOT ${openPlaceCommitments("p.id")}`),
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
        AND v.address_revision = p.address_revision
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
          AND i.address_revision = p.address_revision
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
        grant_snapshot, verification_id, address_revision, issued_at, expires_at, recipient_id, pending_slot, state)
        SELECT ?, ?, target.recipient_key, ?, p.id, p.actor_id, json_object('kind', ?),
          ${transfer ? "(SELECT id FROM transfer_verification)" : "NULL"}, p.address_revision, ${at}, ?, (SELECT id FROM recipient), (${availableSlot}), 'pending'
        FROM selected_place p CROSS JOIN target WHERE ${guard.sql}`, id, tokenHash, sealedRecipient, kind, invitationExpiresAt(ctx.now), ...guard.params ?? []),
      audit(access, guard, "invitation_issued", "(SELECT id FROM recipient)", transfer ? "(SELECT id FROM transfer_verification)" : "NULL"),
      ...(transferToken ? transferNotice(access, guard, id, transferToken) : []),
    ], effects: link ? invitationMailEffectSql(link) : undefined }),
  });
}
