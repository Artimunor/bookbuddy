import { linkOpeningSchema } from "@bookbuddy/api-contract";
import type { LinkOpening } from "@bookbuddy/api-contract";
import { hashSessionCredential, liveContextPredicate } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { businessEligibilityPayload, businessHeader, businessMemberProjection, decodeBusinessEligibility } from "./businesses";
import { decodeOpening, invitationOpeningSql, unavailableInvitation } from "./invitations";
import { at, managesBusiness, scopedStatement } from "./policy";

export async function readLink(access: SessionAccess, opaque: string) {
  const hash = await hashSessionCredential(opaque);
  return scopedStatement(access, `, position AS (SELECT '' AS id),
    link_scope AS MATERIALIZED (
      SELECT t.kind, t.resource_id, t.expires_at, c.id AS context_id, c.account_id, c.role, c.business_id, s.context_id AS active_id
      FROM link_targets t JOIN account_contexts c ON c.id = t.required_scope
      JOIN acting_session s ON s.account_id = c.account_id
      WHERE t.token = ? AND ${liveContextPredicate} AND (
        (t.kind = 'business_eligibility' AND t.resource_id = c.business_id AND c.role IN ('provider_admin', 'foreman')) OR
        (t.kind = 'business_member' AND c.role = 'provider_admin' AND EXISTS (SELECT 1 FROM memberships m
          JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
          WHERE m.id = t.resource_id AND m.business_id = c.business_id AND m.state = 'active'))))
    SELECT (SELECT value FROM (${invitationOpeningSql("s.account_id")} AND i.token_hash = ?)) AS invitation,
      (SELECT CASE
        WHEN t.expires_at <= ${at} THEN json_object('kind', 'unavailable', 'status', 'unavailable', 'reason', 'expired', 'supportReference', NULL)
        WHEN t.active_id IS NOT t.context_id THEN json_object('kind', 'switch_context', 'targetKind', 'business',
          'activeContextId', (SELECT context_id FROM live_scope), 'choices', json_array(json_object('scope',
            json_object('contextId', t.context_id, 'role', t.role, 'businessId', t.business_id), 'businessName', b.public_name)))
        WHEN t.kind = 'business_eligibility' THEN json_object('kind', 'business_eligibility', 'eligibility', json(${businessEligibilityPayload("t.role")}))
        ELSE json_object('kind', 'business_member', 'business', ${businessHeader("b")}, 'member', json((
          SELECT ${businessMemberProjection("m", "t.account_id", managesBusiness("t.account_id", "t.business_id"))}
          FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.id = t.resource_id))) END
        FROM link_scope t JOIN businesses b ON b.id = t.business_id JOIN operating_areas area ON area.id = b.catchment_id) AS scoped
    FROM acting_session s`, opaque, hash);
}

export function decodeLink(row: { invitation: string | null; scoped: string | null }): LinkOpening {
  if (row.invitation) {
    const invitation = decodeOpening(row.invitation);
    if (invitation.status === "unavailable") return { kind: "unavailable", ...invitation };
    return { kind: "invitation", invitation };
  }
  if (!row.scoped) return { kind: "unavailable", ...unavailableInvitation };
  const value = JSON.parse(row.scoped) as { kind: string; eligibility?: unknown };
  if (value.kind === "business_eligibility") return {
    kind: "business_eligibility", eligibility: decodeBusinessEligibility(JSON.stringify(value.eligibility)),
  };
  return linkOpeningSchema.parse(value);
}
