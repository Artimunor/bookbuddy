import { at, liveTerm } from "../access/policy";
import type { SessionAccess } from "../auth/session";

export const configuredSteward = "(SELECT account_id FROM case_steward_config)";

export function withCaseSteward(access: SessionAccess, accountId: string | undefined): SessionAccess {
  return { sql: `${access.sql}, case_steward_config(account_id) AS (VALUES (?))`, params: [...access.params, accountId ?? null] };
}

export const stewardGrant = (account: string) => `EXISTS (SELECT 1 FROM steward_grants g
  WHERE g.account_id = ${account} AND g.revoked_at IS NULL AND g.granted_at <= ${at})`;

export const caseSteward = (s: string) => `(${s}.role = 'customer' AND pc.case_owner_id = ${s}.account_id
  AND pc.case_owner_id = ${configuredSteward} AND ${stewardGrant(`${s}.account_id`)})`;

export const caseProviderGrant = (s: string) => `(${s}.role IN ('provider_admin', 'foreman') AND ${s}.business_id = j.business_id
  AND ${s}.membership_id IS NOT NULL AND EXISTS (SELECT 1 FROM case_grants g WHERE g.case_id = pc.id
    AND g.context_id = ${s}.context_id AND g.capability = pc.provider_audience AND ${liveTerm("g")}))`;

export const casePacket = (p: string) => `${p}.case_id = pc.id AND ${p}.kind = 'provider_packet'
  AND ${p}.audience = pc.provider_audience AND ${p}.at <= ${at}`;

export const casePacketExists = `EXISTS (SELECT 1 FROM case_events packet WHERE ${casePacket("packet")})`;
