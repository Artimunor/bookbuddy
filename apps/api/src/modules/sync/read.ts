import { accountIdSchema, scopeHeaderSchema, syncLimits } from "@bookbuddy/api-contract";
import type { ScopeHeader, SyncCursor, SyncPage, SyncProjection, SyncRemoval } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";
import type { SessionAccess } from "../auth/session";
import type { CursorPosition } from "./cursor";
import type { SyncRegistry } from "./registry";

const pageLimit = syncLimits.changes;

export function syncFeed(access: SessionAccess, cursor: SyncCursor | null, now: number, registry: SyncRegistry): CommandStatement {
  const expired = cursor !== null && cursor.expiresAt <= now;
  const snapshot = cursor?.phase === "snapshot" ? cursor : undefined;
  const delta = cursor?.phase === "delta" ? cursor : undefined;
  const snapshotParts: string[] = [], projectionParts: string[] = [];
  const snapshotParams: unknown[] = [], projectionParams: unknown[] = [];
  for (const [kind, reader] of registry.projections) {
    // Registry kind names have already been restricted to ASCII ID characters.
    const ids = reader.snapshotIds(now);
    snapshotParts.push(`SELECT '${kind}' AS kind, resource_id FROM (
      WITH snapshot_scope AS MATERIALIZED (
        SELECT b.context_id, b.account_id, b.role, b.business_id,
          CASE WHEN b.after_kind = '${kind}' THEN b.after_id ELSE '' END AS after_id
        FROM bounds b WHERE b.context_id IS NOT NULL AND b.mode <> 'delta' AND '${kind}' >= b.after_kind
      )
      SELECT resource_id FROM (${ids.sql}) ORDER BY resource_id LIMIT ${pageLimit + 1}
    )`);
    snapshotParams.push(...ids.params ?? []);
    const projection = reader.project(now);
    projectionParts.push(`SELECT '${kind}' AS kind, resource_id, value FROM (${projection.sql})`);
    projectionParams.push(...projection.params ?? []);
  }
  return {
    sql: `${access.sql},
      cursor_input(phase, epoch, seq, through_seq, anchor, after_kind, after_id) AS (VALUES (?, ?, ?, ?, ?, ?, ?)),
      state AS MATERIALIZED (
        SELECT s.account_id, l.context_id, l.role, l.business_id,
          COALESCE(e.visibility_epoch, 0) AS epoch, r.floor_seq,
          max(r.floor_seq, COALESCE((SELECT seq FROM sync_changes WHERE partition_key = l.context_id ORDER BY seq DESC LIMIT 1), 0)) AS high,
          i.phase, i.seq, i.through_seq, i.anchor, i.after_kind, i.after_id,
          CASE
            WHEN l.context_id IS NULL THEN 'revoked'
            WHEN i.epoch IS NOT NULL AND i.epoch <> COALESCE(e.visibility_epoch, 0) THEN 'reset'
            WHEN i.phase = 'delta' AND i.seq >= r.floor_seq THEN 'delta'
            ELSE 'snapshot'
          END AS mode
        FROM acting_session s LEFT JOIN live_scope l ON l.account_id = s.account_id
        LEFT JOIN sync_scope_state e ON e.context_id = l.context_id
        JOIN sync_retention r ON r.id = 1 CROSS JOIN cursor_input i
      ),
      bounds AS MATERIALIZED (
        SELECT account_id, context_id, role, business_id, epoch, mode, seq, high,
          COALESCE(through_seq, high) AS delta_through,
          CASE WHEN mode = 'snapshot' AND phase = 'snapshot' AND anchor >= floor_seq THEN anchor ELSE high END AS snapshot_anchor,
          CASE WHEN mode = 'snapshot' AND phase = 'snapshot' AND anchor >= floor_seq THEN after_kind ELSE '' END AS after_kind,
          CASE WHEN mode = 'snapshot' AND phase = 'snapshot' AND anchor >= floor_seq THEN after_id ELSE '' END AS after_id,
          CASE WHEN mode = 'reset' OR (mode = 'snapshot' AND phase NOT IN ('initial', 'revoked')
            AND NOT (phase = 'snapshot' AND anchor >= floor_seq)) THEN 1 ELSE 0 END AS barrier
        FROM state
      ),
      delta_scan AS MATERIALIZED (
        SELECT c.seq, c.kind, c.resource_id, c.op FROM sync_changes c
        WHERE c.partition_key = (SELECT context_id FROM bounds WHERE mode = 'delta')
          AND c.seq > (SELECT seq FROM bounds) AND c.seq <= (SELECT delta_through FROM bounds)
        ORDER BY c.seq LIMIT ${pageLimit + 1}
      ),
      delta_page AS MATERIALIZED (SELECT * FROM delta_scan ORDER BY seq LIMIT ${pageLimit}),
      latest_delta AS (
        SELECT *, row_number() OVER (PARTITION BY kind, resource_id ORDER BY seq DESC) AS newest FROM delta_page
      ),
      snapshot_scan AS MATERIALIZED (
        SELECT kind, resource_id FROM (${snapshotParts.join(" UNION ALL ") || "SELECT NULL AS kind, NULL AS resource_id WHERE 0"})
        ORDER BY kind, resource_id LIMIT COALESCE((SELECT ${pageLimit + 1} - barrier FROM bounds), 0)
      ),
      page_keys AS MATERIALIZED (
        SELECT seq, kind, resource_id, op FROM latest_delta WHERE newest = 1
        UNION ALL
        SELECT NULL, kind, resource_id, 'upsert' FROM (
          SELECT kind, resource_id FROM snapshot_scan ORDER BY kind, resource_id
          LIMIT COALESCE((SELECT ${pageLimit} - barrier FROM bounds), 0)
        )
      ),
      projection_keys AS MATERIALIZED (SELECT kind, resource_id FROM page_keys WHERE op = 'upsert'),
      projections AS (${projectionParts.join(" UNION ALL ") || "SELECT NULL AS kind, NULL AS resource_id, NULL AS value WHERE 0"})
      SELECT b.account_id, b.context_id, b.role, b.business_id, b.epoch, b.mode, b.barrier, b.high,
        b.delta_through, b.snapshot_anchor, (SELECT MAX(seq) FROM delta_page) AS delta_last,
        CASE WHEN b.mode = 'delta' THEN (SELECT count(*) FROM delta_scan) > ${pageLimit}
             ELSE (SELECT count(*) FROM snapshot_scan) > ${pageLimit} - b.barrier END AS has_more,
        k.seq, k.kind, k.resource_id, k.op, p.value
      FROM bounds b LEFT JOIN page_keys k ON 1
      LEFT JOIN projections p ON p.kind = k.kind AND p.resource_id = k.resource_id
      ORDER BY k.seq, k.kind, k.resource_id`,
    params: [...access.params ?? [], expired ? "expired" : cursor?.phase ?? "initial", cursor?.epoch ?? null,
      delta?.seq ?? null, delta?.through ?? null, snapshot?.anchor ?? null, snapshot?.kind ?? null, snapshot?.id ?? null,
      ...snapshotParams, ...projectionParams],
  };
}

interface FeedRow {
  account_id: string;
  context_id: string | null;
  role: string | null;
  business_id: string | null;
  epoch: number;
  mode: SyncPage["mode"] | "revoked";
  barrier: number;
  high: number;
  delta_through: number;
  delta_last: number | null;
  snapshot_anchor: number;
  has_more: number;
  kind: string | null;
  resource_id: string | null;
  op: "upsert" | "remove" | null;
  value: string | null;
}

export type FeedPage = Pick<SyncPage, "mode" | "context" | "upserts" | "removals" | "hasMore"> & {
  accountId: SyncCursor["accountId"]; epoch: number; position: CursorPosition;
};

export function decodeFeed(rows: readonly unknown[], cursor: SyncCursor | null, registry: SyncRegistry): FeedPage | "UNAUTHENTICATED" | "NOT_FOUND" {
  const pageRows = rows as FeedRow[];
  const first = pageRows[0];
  if (!first) return "UNAUTHENTICATED";
  if (cursor && cursor.accountId !== first.account_id) return "NOT_FOUND";
  const accountId = accountIdSchema.parse(first.account_id);
  if (first.mode === "revoked") {
    // Only an authenticated former recipient with a signed context may purge a revoked scope.
    if (!cursor) return "NOT_FOUND";
    return { mode: "reset", accountId, context: cursor.context, epoch: cursor.epoch,
      upserts: [], removals: [{ kind: "scope", resourceId: cursor.context.contextId }], position: { phase: "revoked" }, hasMore: false };
  }
  const context: ScopeHeader = scopeHeaderSchema.parse({ contextId: first.context_id, businessId: first.business_id, role: first.role });
  const removals: SyncRemoval[] = first.barrier ? [{ kind: "scope", resourceId: context.contextId }] : [];
  const upserts: SyncProjection[] = [];
  let lastKey: { kind: string; id: string } | undefined;
  for (const { kind, resource_id: id, op, value } of pageRows) {
    if (!kind || !id) continue;
    lastKey = { kind, id };
    const reader = registry.projections.get(kind);
    if (op === "upsert" && reader && value !== null) {
      upserts.push({ kind, resourceId: id, value: reader.schema.parse(JSON.parse(value)) });
    } else if (op === "remove" || (first.mode === "delta" && reader)) {
      removals.push({ kind, resourceId: id });
    }
  }
  const hasMoreInWindow = Boolean(first.has_more);
  const hasMore = hasMoreInWindow || first.high > (first.mode === "delta" ? first.delta_through : first.snapshot_anchor);
  const position: CursorPosition = first.mode === "delta"
    ? hasMoreInWindow && first.delta_last !== null
      ? { phase: "delta", seq: first.delta_last, through: first.delta_through }
      : { phase: "delta", seq: first.delta_through }
    : hasMoreInWindow && lastKey
      ? { phase: "snapshot", anchor: first.snapshot_anchor, ...lastKey }
      : { phase: "delta", seq: first.snapshot_anchor };
  return { mode: first.mode, context, accountId, epoch: first.epoch, removals, upserts, position, hasMore };
}
