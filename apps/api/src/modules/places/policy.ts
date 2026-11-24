import type { CommandStatement } from "../../db/commit";
import { at, delegatesPlaceView, liveTerm } from "../access/policy";

export const activePlace = (p: string) => `${p}.state IN ('in_area', 'out_of_area')`;
export const placeOwner = (p: string, actor: string) => `${p}.owner_id = ${actor}`;
export const currentPerson = (person: string, clock = at) => `${person}.ends_at IS NULL AND ${person}.verified_from <= ${clock}`;

export const placeCapability = (place: string, account: string, capability: string, clock = at) =>
  `EXISTS (SELECT 1 FROM place_grants g WHERE g.place_id = ${place} AND g.account_id = ${account}
    AND g.capability = '${capability}' AND ${liveTerm("g", clock)})`;

export const placeViewer = (p: string, account: string, clock = at) =>
  `(${placeOwner(p, account)} OR ${placeCapability(`${p}.id`, account, "view", clock)})`;

export const placeReadable = (p: string, person: string, scope: string, clock = at) => `${scope}.role = 'customer'
  AND ${p}.state <> 'restricted' AND (${p}.state <> 'pending_verification' OR ${placeOwner(p, `${scope}.account_id`)})
  AND ${currentPerson(person, clock)} AND ${placeViewer(p, `${scope}.account_id`, clock)}`;

export const placeManager = (p: string, actor: string) =>
  `(${placeOwner(p, actor)} OR ${delegatesPlaceView(`${p}.id`, actor)})`;

// Address changes pause authority for the old address until operations verifies
// the new one. The customer route cannot produce an independent record.
export const ownerVerification = (p: string, person: string) => `SELECT v.id FROM authority_verifications v
  WHERE v.place_id = ${p}.id AND v.subject_account_id = ${p}.owner_id AND v.verified_at <= ${at}
    AND v.address_revision = ${p}.address_revision AND (
      (v.kind = 'place_owner' AND v.verified_at >= ${person}.verified_from)
      OR (v.kind = 'place_transfer' AND EXISTS (
        SELECT 1 FROM invitations i WHERE i.verification_id = v.id AND i.place_id = ${p}.id AND i.inviter_id <> v.verified_by
          AND i.recipient_id = ${p}.owner_id AND i.state = 'accepted' AND i.ended_at >= ${person}.verified_from
      ))) ORDER BY v.verified_at DESC, v.id LIMIT 1`;

export const verifiedOwner = (p: string, person: string) => `EXISTS (${ownerVerification(p, person)})`;

export const bookedPlace = (place: string) => `EXISTS (SELECT 1 FROM jobs j JOIN visits v ON v.job_id = j.id
  WHERE j.place_id = ${place} AND j.state = 'open' AND v.state = 'booked')`;

export const openPlaceCommitments = (place: string) => `(EXISTS (
  SELECT 1 FROM jobs j WHERE j.place_id = ${place} AND j.state = 'open'
) OR EXISTS (
  SELECT 1 FROM jobs j JOIN problem_cases pc ON pc.job_id = j.id
  WHERE j.place_id = ${place} AND pc.state IN ('open', 'awaiting_plan')
))`;

export const placeContextIds = (place: string, now: number): CommandStatement => ({
  sql: `SELECT c.id AS context_id FROM places p JOIN place_people pp ON pp.place_id = p.id
    JOIN account_contexts c ON c.account_id = pp.account_id AND c.role = 'customer'
    JOIN accounts a ON a.id = c.account_id AND a.state = 'active'
    WHERE p.id = ? AND ${currentPerson("pp", "?")} AND ${placeViewer("p", "pp.account_id", "?")}`,
  params: [place, now, now, now],
});

export function placeChanges(place: string, now: number, operation: "upsert" | "remove" = "upsert"): CommandStatement {
  const audience = placeContextIds(place, now);
  return { sql: `SELECT 'place' AS kind, ? AS resource_id, context_id AS partition_key, '${operation}' AS op, ? AS at
    FROM (${audience.sql})`, params: [place, now, ...audience.params ?? []] };
}

export function normalizedAddress(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}
