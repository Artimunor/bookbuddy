import { idSchema, placeDetailsSchema, placeListSchema, placeSummarySchema } from "@bookbuddy/api-contract";
import { decodeManagedInvitations, managedInvitationJoins, managedInvitationProjection } from "../access/invitations";
import type { SealedInvitation } from "../access/invitations";
import { at, displayName, inviteKind, liveTerm, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import type { SyncProjectionReader } from "../sync/registry";
import {
  activePlace, bookedPlace, currentPerson, openPlaceCommitments, placeCapability, placeManager, placeOwner, placeReadable, verifiedOwner,
} from "./policy";
import { currentTransferMailbox } from "./invitation";

const pageSize = 50;
const placeJoins = `JOIN place_people person ON person.account_id = scope.account_id
  JOIN places property ON property.id = person.place_id LEFT JOIN operating_areas area ON area.id = property.area_id`;
const readable = placeReadable("property", "person", "scope");
const owner = placeOwner("property", "scope.account_id");
const active = activePlace("property");
const manager = placeManager("property", "scope.account_id");
const verified = verifiedOwner("property", "person");
const booked = bookedPlace("property.id");
const yes = (condition: string) => `json(CASE WHEN ${condition} THEN 'true' ELSE 'false' END)`;

const visibleJobs = `FROM jobs j LEFT JOIN requests req ON req.job_id = j.id
  WHERE j.place_id = property.id AND (j.requester_id = scope.account_id OR req.submitted_at >= person.history_from)`;
const liveJob = `j.state = 'open' AND EXISTS (SELECT 1 FROM visits visit JOIN shifts shift ON shift.visit_id = visit.id
  WHERE visit.job_id = j.id AND visit.state = 'booked' AND shift.state = 'active')`;
const bookingCounts = `SELECT json_object('openBookingCount', count(*), 'liveBookingCount', count(*) FILTER (WHERE ${liveJob}))
  ${visibleJobs} AND j.state = 'open'`;

const summary = `
  'id', property.id, 'alias', property.alias, 'state', property.state,
  'areaName', area.name, 'siteZone', property.site_zone,
  'relationship', CASE WHEN property.state = 'pending_verification' AND ${owner} THEN 'verification_pending'
    WHEN ${owner} THEN 'owner' WHEN scope.account_id = property.named_approver_id
    OR ${placeCapability("property.id", "scope.account_id", "delegate")}
    OR ${placeCapability("property.id", "scope.account_id", "request")} THEN 'manager' ELSE 'viewer' END,
  'ownerDisplayName', (SELECT nullif(display_name, '') FROM accounts WHERE id = property.owner_id AND state = 'active'),
  'namedApproverDisplayName', (SELECT nullif(display_name, '') FROM accounts WHERE id = property.named_approver_id AND state = 'active'),
  'viewerIsNamedApprover', ${yes(`scope.account_id = property.named_approver_id`)}`;

export interface PlacePosition { live: number; open: number; name: string; id: string }
export function decodePlaceCursor(token: string): PlacePosition | null {
  try {
    const bytes = Uint8Array.from(atob(token.replaceAll("-", "+").replaceAll("_", "/")), (byte) => byte.charCodeAt(0));
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) as Partial<PlacePosition> | null;
    if (!value || !Number.isSafeInteger(value.live) || !Number.isSafeInteger(value.open)
      || typeof value.name !== "string" || value.name.length > 100 || !idSchema.safeParse(value.id).success) return null;
    return value as PlacePosition;
  } catch {
    return null;
  }
}

function encodePlaceCursor(position: PlacePosition): string {
  const bytes = new TextEncoder().encode(JSON.stringify(position));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function readPlaces(access: SessionAccess, q: string, position: PlacePosition | null) {
  return scopedStatement(access, `, search AS (SELECT lower(?) AS q),
    matching AS MATERIALIZED (SELECT property.id, lower(property.alias) AS name,
      json_object(${summary}) AS summary,
      (SELECT json_object('open', count(*), 'live', count(*) FILTER (WHERE ${liveJob}))
        ${visibleJobs} AND j.state = 'open') AS counts
      FROM live_scope scope ${placeJoins} CROSS JOIN search
      WHERE ${readable} AND property.state <> 'archived'
        AND (search.q = '' OR instr(lower(property.alias), search.q) > 0
          OR instr(lower(area.name), search.q) > 0 OR instr(lower(property.normalized_address), search.q) > 0)),
    ordered AS (SELECT id, name, summary, json_extract(counts, '$.open') AS open, json_extract(counts, '$.live') AS live FROM matching),
    page AS (SELECT id, name, summary, open, live FROM ordered
      ${position ? "WHERE (-live, -open, name, id) > (?, ?, ?, ?)" : ""}
      ORDER BY live DESC, open DESC, name, id LIMIT ${pageSize + 1})
    SELECT scope.context_id, (SELECT count(*) FROM matching) AS total, page.*
    FROM acting_session s LEFT JOIN live_scope scope ON scope.account_id = s.account_id AND scope.role = 'customer'
    LEFT JOIN page ON 1 ORDER BY page.live DESC, page.open DESC, page.name, page.id`,
  q, ...position ? [-position.live, -position.open, position.name, position.id] : []);
}

interface ListRow extends PlacePosition { context_id: string | null; summary: string | null; total: number }
export function decodePlaces(rows: readonly unknown[]) {
  const list = rows as readonly ListRow[];
  const first = list[0];
  if (!first) return "UNAUTHENTICATED";
  if (!first.context_id) return "NOT_FOUND";
  const hasMore = list.length > pageSize;
  const items = first.summary === null ? [] : list.slice(0, pageSize);
  const last = items.at(-1);
  return placeListSchema.parse({ total: first.total, hasMore,
    cursor: hasMore && last ? encodePlaceCursor({ id: last.id, name: last.name, live: last.live, open: last.open }) : null,
    places: items.map((item) => ({ ...JSON.parse(item.summary!), openBookingCount: item.open, liveBookingCount: item.live })),
  });
}

const people = `SELECT json_group_array(json(value)) FROM (SELECT json_object(
    'accountId', a.id, 'displayName', ${displayName("a")}, 'isOwner', ${yes("a.id = property.owner_id")},
    'isNamedApprover', ${yes("a.id = property.named_approver_id")},
    'capabilities', json((SELECT json_group_array(capability) FROM (
      SELECT g.capability FROM place_grants g WHERE g.place_id = property.id AND g.account_id = a.id AND ${liveTerm("g")}
        AND (g.capability <> 'approve' OR property.named_approver_id = a.id) ORDER BY g.capability)))
    ) AS value FROM place_people peer JOIN accounts a ON a.id = peer.account_id AND a.state = 'active'
    WHERE peer.place_id = property.id AND ${currentPerson("peer")}
    ORDER BY (a.id = property.owner_id) DESC, (a.id = property.named_approver_id) DESC, a.display_name, a.id)`;

const invitations = `SELECT json_group_array(json(value)) FROM (SELECT ${managedInvitationProjection()} AS value
    FROM invitations i ${managedInvitationJoins} WHERE i.place_id = property.id AND i.state = 'pending' AND i.expires_at > ${at}
      AND (${inviteKind("i")} <> 'place_transfer' OR (${owner} AND ${currentTransferMailbox("i")} IS NOT NULL))
    ORDER BY i.issued_at DESC, i.id)`;

// The deployed schema has no authored short title or customer field/aftercare
// stamps yet. Use the reference as its label; only persisted milestones advance it.
const bookings = `SELECT json_group_array(json(value)) FROM (SELECT json_object(
      'jobId', j.id, 'reference', j.reference, 'title', j.reference, 'state', j.state,
      'journeyStep', CASE WHEN (${liveJob}) OR EXISTS (SELECT 1 FROM visits v WHERE v.job_id = j.id AND v.state = 'finished') THEN 'visit'
        WHEN EXISTS (SELECT 1 FROM visits v JOIN visit_windows w ON w.visit_id = v.id
          WHERE v.job_id = j.id AND v.state = 'booked' AND w.state = 'confirmed') THEN 'booked'
        WHEN EXISTS (SELECT 1 FROM quote_versions q WHERE q.job_id = j.id
          AND (q.state = 'approved' OR (q.state = 'issued' AND q.expires_at > ${at}))) THEN 'quoted' ELSE 'requested' END
    ) AS value ${visibleJobs} ORDER BY (j.state = 'open') DESC, req.submitted_at DESC NULLS LAST, j.id)`;

export function placeDetailsAt(place: string) {
  return `SELECT json_patch(json_object(${summary},
    'revision', property.revision, 'address', property.normalized_address, 'pin', json(property.pin),
    'safeArrivalNote', property.safe_arrival_note,
    'people', json((${people})), 'pendingInvitations', json(CASE WHEN ${active} AND ${manager} THEN (${invitations}) END),
    'bookings', json((${bookings})), 'actions', json_object(
      'edit', ${yes(`${owner} AND property.state <> 'archived'`)},
      'verifyPin', ${yes(`${owner} AND property.state <> 'archived' AND NOT (${booked})`)},
      'invite', ${yes(`${active} AND ${manager}`)},
      'changeApprover', ${yes(`${active} AND ${owner} AND ${verified}`)},
      'transfer', ${yes(`${active} AND ${owner} AND ${verified}`)},
      'archive', ${yes(`${owner} AND ${verified} AND property.state <> 'archived' AND NOT ${openPlaceCommitments("property.id")}`)})),
      (${bookingCounts})) AS value
    FROM place_people person JOIN places property ON property.id = person.place_id
    LEFT JOIN operating_areas area ON area.id = property.area_id
    WHERE person.account_id = scope.account_id AND property.id = ${place} AND ${readable}`;
}

export function readPlace(access: SessionAccess, id: string) {
  return scopedStatement(access, `SELECT scope.context_id, (${placeDetailsAt("?")}) AS value
    FROM acting_session s LEFT JOIN live_scope scope ON s.account_id = scope.account_id`, id);
}

export async function decodePlace(value: string, key: string | undefined) {
  const data = JSON.parse(value) as { pendingInvitations: SealedInvitation[] | null };
  return placeDetailsSchema.parse({ ...data, pendingInvitations: data.pendingInvitations === null ? null
    : await decodeManagedInvitations(data.pendingInvitations, key) });
}

const syncScope = (source: string) => `FROM ${source} scope ${placeJoins}
  WHERE property.state <> 'archived' AND ${placeReadable("property", "person", "scope", "(SELECT at FROM place_sync_clock)")}`;

export const placeSyncProjection: SyncProjectionReader = {
  kind: "place",
  schema: placeSummarySchema.pick({ id: true, alias: true, state: true }),
  snapshotIds: (now) => ({ sql: `WITH place_sync_clock AS (SELECT ? AS at) SELECT property.id AS resource_id
    ${syncScope("snapshot_scope")} AND property.id > scope.after_id`, params: [now] }),
  project: (now) => ({ sql: `WITH place_sync_clock AS (SELECT ? AS at) SELECT property.id AS resource_id,
    json_object('id', property.id, 'alias', property.alias, 'state', property.state) AS value
    ${syncScope("live_scope")} AND property.id IN (SELECT resource_id FROM projection_keys WHERE kind = 'place')`, params: [now] }),
};
