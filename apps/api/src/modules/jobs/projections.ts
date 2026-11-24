import { syncProjectionSchema } from "@bookbuddy/api-contract";
import { projectJourney } from "@bookbuddy/domain";
import type { JobState } from "@bookbuddy/domain";
import { displayName } from "../access/policy";
import { placeReadable } from "../places/policy";
import type { SyncProjectionReader } from "../sync/registry";

export const jobKind = "job";
export const jobHandoffKind = "job_handoff";

export function customerPlaces(scope: string, now: string): string {
  return `SELECT p.id, p.alias, p.site_zone, p.owner_id = s.account_id AS owned, pp.history_from
    FROM ${scope} s JOIN place_people pp ON pp.account_id = s.account_id
    JOIN places p ON p.id = pp.place_id WHERE ${placeReadable("p", "pp", "s", now)}`;
}

export function currentMembership(scope: string, now: string): string {
  return `(SELECT g.membership_id FROM account_contexts c JOIN membership_roles g ON g.id = c.role_grant_id
    WHERE c.id = ${scope}.context_id AND g.granted_at <= ${now})`;
}

export const grantTerm = (grant: string, now: string) => `${grant}.revoked_at IS NULL AND ${grant}.valid_from <= ${now}
  AND (${grant}.valid_until IS NULL OR ${grant}.valid_until > ${now})`;

export function businessCapability(membership: string, capability: string, now: string): string {
  return `EXISTS (SELECT 1 FROM business_grants g WHERE g.membership_id = ${membership}
    AND g.capability = '${capability}' AND ${grantTerm("g", now)})`;
}

function jobCapability(job: string, context: string, capability: string, now: string): string {
  return `EXISTS (SELECT 1 FROM job_grants g WHERE g.job_id = ${job} AND g.context_id = ${context}
    AND g.capability = '${capability}' AND ${grantTerm("g", now)})`;
}

// The same relationships govern online, snapshot, and delta reads. A current
// place membership alone does not grant the previous owner's job history.
export function scopedJobIds(scope: string, places: string, now: string, filter: string): string {
  const membership = currentMembership("s", now);
  return `SELECT j.id AS resource_id FROM ${scope} s JOIN ${places} p ON s.role = 'customer'
    JOIN jobs j ON j.place_id = p.id
    LEFT JOIN requests r ON r.job_id = j.id
    WHERE (${filter}) AND (j.requester_id = s.account_id OR r.submitted_at >= p.history_from)
    UNION ALL
    SELECT j.id FROM ${scope} s JOIN jobs j ON j.business_id = s.business_id
    WHERE s.role = 'provider_admin' AND ${membership} IS NOT NULL AND (${filter})
    UNION ALL
    SELECT j.id FROM ${scope} s JOIN jobs j ON j.business_id = s.business_id AND j.accountable_foreman_membership_id = ${membership}
    WHERE s.role = 'foreman' AND (${filter})
    UNION ALL
    SELECT j.id FROM ${scope} s JOIN job_grants access ON access.context_id = s.context_id AND access.capability = 'backup'
    JOIN jobs j ON j.id = access.job_id AND j.business_id = s.business_id
    WHERE s.role = 'foreman' AND j.accountable_foreman_membership_id IS NOT ${membership} AND (${filter})
      AND ${grantTerm("access", now)} AND ${businessCapability(membership, "backup_foreman", now)}`;
}

export function scopedIntakeIds(scope: string, now: string, filter: string): string {
  return `SELECT h.id AS resource_id FROM ${scope} s JOIN job_handoffs h
    ON h.business_id = s.business_id AND h.recipient_id = ${currentMembership("s", now)}
    JOIN jobs j ON j.id = h.job_id AND j.state = 'open' AND j.accountable_foreman_membership_id IS h.incumbent_id
    WHERE s.role = 'foreman' AND h.state = 'offered' AND h.offered_at <= ${now} AND h.expires_at > ${now}
      AND (${filter}) AND ${jobCapability("j.id", "s.context_id", "intake", now)}`;
}

export const headingSql = (job: string, zone: string) => `
  'jobId', ${job}.id, 'reference', ${job}.reference, 'title', nullif(${job}.trade, ''), 'siteZone', ${zone}`;

export const placeZone = "coalesce(p.site_zone, area.site_zone)";

export function journeySql(job: string, now: string): string {
  return `'state', ${job}.state,
    'quoted', EXISTS (SELECT 1 FROM quote_versions q WHERE q.job_id = ${job}.id AND q.issued_at <= ${now}),
    'booked', EXISTS (SELECT 1 FROM visits v JOIN visit_windows w ON w.visit_id = v.id
      WHERE v.job_id = ${job}.id AND w.confirmed_at <= ${now}),
    'reached', EXISTS (SELECT 1 FROM visits v WHERE v.job_id = ${job}.id AND v.state = 'finished'),
    'signedOff', EXISTS (SELECT 1 FROM sign_offs s WHERE s.job_id = ${job}.id AND s.at <= ${now}),
    'paymentMatched', EXISTS (SELECT 1 FROM bills b JOIN paid_records r ON r.bill_id = b.id AND r.kind = 'matched'
      WHERE b.job_id = ${job}.id AND b.state = 'issued' AND r.at <= ${now}
      AND NOT EXISTS (SELECT 1 FROM paid_records successor WHERE successor.prior_id = r.id AND successor.at <= ${now}))`;
}

export interface JourneyRow { state: JobState; quoted: number; booked: number; reached: number; signedOff: number; paymentMatched: number }

export function journey({ state, quoted, booked, reached, signedOff, paymentMatched }: JourneyRow) {
  return projectJourney({ jobState: state, quoteIssued: Boolean(quoted), windowConfirmed: Boolean(booked), visitReached: Boolean(reached),
    signedOff: Boolean(signedOff), paymentMatched: Boolean(paymentMatched) });
}

interface VisitWindow { visitId: string; startsAt: number; endsAt: number }
export interface VisitRow extends VisitWindow { at: number; by: string; finished: number }

export function visitJson(visit: string, window: string): string {
  return `json_object('visitId', ${visit}.id, 'startsAt', ${window}.starts_at, 'endsAt', ${window}.ends_at,
    'at', ${window}.confirmed_at, 'by', (SELECT ${displayName("a")} FROM accounts a WHERE a.id = ${window}.confirmed_by),
    'finished', ${visit}.state = 'finished')`;
}

export function nextVisitId(job: string, now: string): string {
  return `SELECT w.id FROM visits v JOIN visit_windows w ON w.visit_id = v.id AND w.state = 'confirmed'
    WHERE v.job_id = ${job}.id AND ${job}.state = 'open' AND v.state = 'booked' AND w.confirmed_at <= ${now} AND w.ends_at > ${now}
    ORDER BY w.starts_at, v.id LIMIT 1`;
}

export const booking = ({ visitId, startsAt, endsAt }: VisitWindow) => ({ visitId, window: { startsAt, endsAt } });

export function memberJson(id: string): string {
  return `(SELECT json_object('membershipId', m.id, 'displayName', ${displayName("a")})
    FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.id = ${id})`;
}

export function handoffJson(handoff: string, now: string): string {
  const expired = `${handoff}.state = 'offered' AND ${handoff}.expires_at <= ${now}`;
  return `json_object('handoffId', ${handoff}.id, 'policy', ${handoff}.policy,
    'state', CASE WHEN ${expired} THEN 'expired' ELSE ${handoff}.state END,
    'from', json(${memberJson(`${handoff}.incumbent_id`)}), 'to', json(${memberJson(`${handoff}.recipient_id`)}),
    'offeredBy', (SELECT ${displayName("a")} FROM accounts a WHERE a.id = ${handoff}.issuer_id),
    'offeredAt', ${handoff}.offered_at, 'expiresAt', ${handoff}.expires_at,
    'endedAt', CASE WHEN ${expired} THEN ${handoff}.expires_at ELSE ${handoff}.ended_at END,
    'reofferOfId', ${handoff}.reoffer_of_id)`;
}

const clock = "(SELECT at FROM job_clock)";
const scopedSyncPlaces = (scope: string) => `WITH job_clock(at) AS (VALUES (?)), job_places AS (${customerPlaces(scope, clock)})`;
const syncKeys = (alias: string, kind: string) => `${alias}.id IN (SELECT resource_id FROM projection_keys WHERE kind = '${kind}')`;
const placeBusiness = `JOIN places p ON p.id = j.place_id JOIN businesses b ON b.id = j.business_id
  JOIN operating_areas area ON area.id = b.catchment_id`;

interface SyncHeading extends JourneyRow { jobId: string; reference: string; title: string | null; siteZone: string }

export const jobSyncProjections: readonly SyncProjectionReader[] = [
  {
    kind: jobKind,
    schema: { parse(value) {
      const row = value as SyncHeading & { place: { placeId: string; alias: string }; next: VisitWindow | null };
      const { jobId, reference, title, siteZone, place, state, next } = row;
      return syncProjectionSchema.shape.value.parse({ jobId, reference, title, siteZone, place, state, journey: journey(row),
        nextVisit: next ? booking(next) : null });
    } },
    snapshotIds: (now) => ({ sql: `${scopedSyncPlaces("snapshot_scope")}
      ${scopedJobIds("snapshot_scope", "job_places", clock, "j.id > s.after_id")}`, params: [now] }),
    project: (now) => ({ sql: `${scopedSyncPlaces("live_scope")}, keys AS (
      ${scopedJobIds("live_scope", "job_places", clock, syncKeys("j", jobKind))})
      SELECT j.id AS resource_id, json_object(${headingSql("j", placeZone)}, ${journeySql("j", clock)},
        'place', json_object('placeId', p.id, 'alias', p.alias),
        'next', (SELECT json_object('visitId', w.visit_id, 'startsAt', w.starts_at, 'endsAt', w.ends_at)
          FROM visit_windows w WHERE w.id = (${nextVisitId("j", clock)}))) AS value
      FROM keys JOIN jobs j ON j.id = keys.resource_id ${placeBusiness}`, params: [now] }),
  },
  {
    kind: jobHandoffKind,
    schema: { parse(value) {
      const row = value as SyncHeading & { town: string; customerName: string; handoff: unknown };
      const { jobId, reference, title, siteZone, town, customerName, handoff } = row;
      return syncProjectionSchema.shape.value.parse({ jobId, reference, title, siteZone, town, customerName, handoff, journey: journey(row) });
    } },
    snapshotIds: (now) => ({ sql: `WITH job_clock(at) AS (VALUES (?))
      ${scopedIntakeIds("snapshot_scope", clock, "h.id > s.after_id")}`, params: [now] }),
    project: (now) => ({ sql: `WITH job_clock(at) AS (VALUES (?)), keys AS (
      ${scopedIntakeIds("live_scope", clock, syncKeys("h", jobHandoffKind))})
      SELECT h.id AS resource_id, json_object(${headingSql("j", placeZone)}, ${journeySql("j", clock)},
        'town', area.name, 'customerName', ${displayName("customer")}, 'handoff', ${handoffJson("h", clock)}) AS value
      FROM keys JOIN job_handoffs h ON h.id = keys.resource_id JOIN jobs j ON j.id = h.job_id ${placeBusiness}
      JOIN accounts customer ON customer.id = j.requester_id`, params: [now] }),
  },
];
