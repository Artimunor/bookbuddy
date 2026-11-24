import { linkOpeningSchema } from "@bookbuddy/api-contract";
import type { LinkOpening } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";
import { at, scopedStatement } from "../access/policy";
import { hashSessionCredential } from "../auth/session";
import type { SessionAccess } from "../auth/session";

type TargetKind = Extract<LinkOpening, { kind: "switch_context" }>["targetKind"];
type Unavailable = Extract<LinkOpening, { kind: "unavailable" }>;

export interface LinkResolver {
  readonly targetKind: TargetKind;
  // Return a scalar JSON opening, or NULL when the viewer cannot open the record.
  // The target scope exposes account_id, context_id, role, business_id and membership_id.
  project(resourceSql: string, scopeAlias: string): string;
  decode?(projection: unknown, now: number): LinkOpening;
  // Invitation mail predates the target table and is keyed by a hashed locator.
  legacyResource?(hashSql: string): string;
}

const resolvers = new Map<string, LinkResolver>();
let compiledRead: readonly [LinkQuery, ...LinkQuery[]] | undefined;

interface LinkQuery {
  readonly sql: string;
  readonly usesHash: boolean;
}

const maxProjectionBytes = 90_000; // Reserve space for D1's 100 KB statement limit and the request scope.

export function registerLinkResolver(kind: string, resolver: LinkResolver): void {
  if (!/^[a-z][a-z0-9_]*$/.test(kind) || resolvers.has(kind)) throw new TypeError(`Invalid or duplicate link kind: ${kind}`);
  if (resolver.legacyResource && [...resolvers.values()].some((known) => known.legacyResource)) {
    throw new TypeError("Only one legacy link locator is permitted");
  }
  resolvers.set(kind, resolver);
  compiledRead = undefined;
}

export const unavailableLink = (reason: Unavailable["reason"]): Unavailable =>
  ({ kind: "unavailable", status: "unavailable", reason, supportReference: null });
const unavailableSql = (reasonSql: string) =>
  `json_object('kind', 'unavailable', 'status', 'unavailable', 'reason', ${reasonSql}, 'supportReference', NULL)`;

interface Projection {
  readonly kinds: string[];
  readonly sql: string;
  readonly targetKind: TargetKind;
}

function linkSql(): [LinkQuery, ...LinkQuery[]] {
  const grouped = new Map<LinkResolver, string[]>();
  let legacy: string | undefined;
  for (const [kind, resolver] of resolvers) {
    const kinds = grouped.get(resolver);
    if (kinds) kinds.push(kind);
    else grouped.set(resolver, [kind]);
    if (resolver.legacyResource) legacy = `'${kind}', ${resolver.legacyResource("(SELECT hash FROM link_input)")}`;
  }
  const groups: [Projection[], ...Projection[][]] = [[]];
  let group = groups[0], size = 0;
  const encoder = new TextEncoder();
  const ordered = [...grouped].sort(([a], [b]) => Number(!!b.legacyResource) - Number(!!a.legacyResource));
  for (const [resolver, kinds] of ordered) {
    const sql = `WHEN t.kind IN (${kinds.map((kind) => `'${kind}'`).join(", ")}) THEN (${resolver.project("t.resource_id", "t")})`;
    const bytes = encoder.encode(sql).byteLength;
    if (bytes > maxProjectionBytes) throw new TypeError(`Link resolver exceeds the D1 projection budget: ${kinds[0]}`);
    if (size + bytes > maxProjectionBytes) {
      group = [];
      groups.push(group);
      size = 0;
    }
    group.push({ kinds, sql, targetKind: resolver.targetKind });
    size += bytes;
  }
  const knownKinds = [...resolvers.keys()].map((kind) => `'${kind}'`).join(", ") || "NULL";
  return [
    linkQuery(groups[0], knownKinds, legacy),
    ...groups.slice(1).map((projections) => linkQuery(projections)),
  ];
}

function linkQuery(projections: readonly Projection[], knownKinds?: string, legacy?: string): LinkQuery {
  const kinds = projections.flatMap(({ kinds }) => kinds.map((kind) => `'${kind}'`)).join(", ") || "NULL";
  const targetKinds = projections.flatMap((p) => p.kinds.map((kind) => `WHEN '${kind}' THEN '${p.targetKind}'`)).join(" ");
  const project = projections.map(({ sql }) => sql).join("\n");
  // D1 batches these statements against a single snapshot. Only the matching
  // kind (or the first group's unknown-token fallback) reaches the session and
  // resource reads; other groups do only an indexed token probe.
  return { usesHash: legacy !== undefined, sql: `,
    link_input AS (SELECT ? AS token${legacy ? ", ? AS hash" : ""}),
    stored_target AS MATERIALIZED (
      SELECT kind, resource_id, required_scope, expires_at FROM link_targets WHERE token = (SELECT token FROM link_input)
    ), candidate(kind, resource_id, required_scope, expires_at) AS MATERIALIZED (
      SELECT * FROM stored_target WHERE kind IN (${kinds})${knownKinds ? ` OR kind NOT IN (${knownKinds})
      UNION ALL SELECT ${legacy ?? "NULL, NULL"}, NULL, NULL WHERE NOT EXISTS (SELECT 1 FROM stored_target)` : ""}
    ), link_scope AS MATERIALIZED (
      SELECT target.*, s.account_id, c.id AS context_id, c.role, c.business_id, g.membership_id, b.public_name,
        (SELECT context_id FROM live_scope) AS active_id,
        CASE WHEN target.required_scope IS NOT NULL AND c.id IS NULL THEN 'unavailable'
          WHEN target.expires_at <= ${at} THEN 'expired'
          WHEN target.required_scope IS NULL OR c.role = 'customer' THEN NULL
          WHEN g.id IS NULL OR g.revoked_at IS NOT NULL OR g.granted_at > ${at} OR m.state IS NOT 'active' THEN 'removed'
          WHEN b.state = 'pending' THEN 'pending'
          WHEN b.state IS NOT 'approved' THEN 'removed' END AS reason,
        ${targetKinds ? `CASE target.kind ${targetKinds} END` : "NULL"} AS target_kind
      FROM candidate target CROSS JOIN acting_session s
      LEFT JOIN account_contexts c ON c.id = target.required_scope AND c.account_id = s.account_id
      LEFT JOIN membership_roles g ON g.id = c.role_grant_id AND g.role = c.role
      LEFT JOIN memberships m ON m.id = g.membership_id AND m.account_id = c.account_id AND m.business_id = c.business_id
      LEFT JOIN businesses b ON b.id = m.business_id
    ), projected AS MATERIALIZED (
      SELECT t.*, ${project ? `CASE WHEN t.reason IS NULL AND t.resource_id IS NOT NULL THEN CASE ${project} END END` : "NULL"} AS value
      FROM link_scope t
    )
    SELECT p.kind, CASE
      WHEN p.target_kind IS NULL THEN NULL
      WHEN p.reason IS NOT NULL THEN ${unavailableSql("p.reason")}
      WHEN p.value IS NULL AND p.required_scope IS NOT NULL THEN ${unavailableSql("'removed'")}
      WHEN p.value IS NULL OR json_extract(p.value, '$.kind') = 'unavailable' THEN p.value
      WHEN p.context_id IS NOT NULL AND p.active_id IS NOT p.context_id THEN json_object(
        'kind', 'switch_context', 'targetKind', p.target_kind, 'activeContextId', p.active_id,
        'choices', json_array(json_object('scope', json_object('contextId', p.context_id, 'role', p.role, 'businessId', p.business_id),
          'businessName', p.public_name)))
      ELSE p.value END AS value
    FROM projected p` };
}

export interface LinkRow { kind: string | null; value: string | null }

export async function readLink(access: SessionAccess, opaque: string): Promise<[CommandStatement, ...CommandStatement[]]> {
  const [first, ...rest] = compiledRead ??= linkSql();
  return [
    first.usesHash ? scopedStatement(access, first.sql, opaque, await hashSessionCredential(opaque))
      : scopedStatement(access, first.sql, opaque),
    ...rest.map(({ sql }) => scopedStatement(access, sql, opaque)),
  ];
}

export function decodeLink({ kind, value }: LinkRow, now: number): LinkOpening {
  if (value === null) return unavailableLink("unavailable");
  const projection = JSON.parse(value) as { kind: string };
  if (kind !== null && projection.kind !== "unavailable" && projection.kind !== "switch_context") {
    const decode = resolvers.get(kind)?.decode;
    if (decode) return decode(projection, now);
  }
  return linkOpeningSchema.parse(projection);
}

// SQL expressions only, from trusted producers. Set the destination inside the
// same notification batch; the resource index serves both reuse and lookup.
export function linkTokenFor(kind: string, resourceId: string, requiredScope: string, expiresAt: string): string {
  return `(SELECT existing.token FROM link_targets existing WHERE existing.kind = ${kind}
    AND existing.resource_id = ${resourceId} AND existing.required_scope = ${requiredScope}
    AND existing.expires_at >= ${expiresAt} ORDER BY existing.expires_at DESC, existing.token LIMIT 1)`;
}

// The select yields kind, resource_id, required_scope, expires_at for the exact
// authorized audience. A guard lets command producers share their write fence.
export function createLinkTarget(targets: CommandStatement, guard: CommandStatement = { sql: "1" }): CommandStatement {
  return {
    sql: `INSERT INTO link_targets (token, kind, resource_id, required_scope, expires_at)
      SELECT lower(hex(randomblob(32))), target.kind, target.resource_id, target.required_scope, target.expires_at
      FROM (SELECT kind, resource_id, required_scope, max(expires_at) AS expires_at
        FROM (${targets.sql}) GROUP BY kind, resource_id, required_scope) target
      WHERE (${guard.sql}) AND ${linkTokenFor("target.kind", "target.resource_id", "target.required_scope", "target.expires_at")} IS NULL`,
    params: [...targets.params ?? [], ...guard.params ?? []],
  };
}
