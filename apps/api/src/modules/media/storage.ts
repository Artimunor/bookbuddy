import { mediaLimits } from "@bookbuddy/api-contract";
import type { AttachmentState, RouteResponse } from "@bookbuddy/api-contract";
import type { createMediaGrantsRoute, recoverMediaRoute, settleMediaRoute } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";
import type { RequestScope } from "../../db/scope";
import { at } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { attachmentHasLink, mediaActor, photoMimeSql, uploadAllowed } from "./policy";

export type GrantInput = RouteResponse<typeof createMediaGrantsRoute.input>["body"];
export type SettleInput = RouteResponse<typeof settleMediaRoute.input>["body"];
export type RecoverInput = RouteResponse<typeof recoverMediaRoute.input>["body"];
export const stageLifetime = 7 * 86_400_000;
export const claimLifetime = 120_000;
export const partBytes = 5 * 1024 * 1024; // R2 minimum size for every non-final part.
export const singleBytes = 4 * 1024 * 1024;

export interface AttachmentRow {
  id: string;
  object_key: string;
  upload_generation: number;
  mime: string;
  bytes: number;
  duration_ms: number | null;
  r2_upload_id: string | null;
  state: AttachmentState;
  lease_until: number | null;
  expires_at: number;
  session_expires_at: number;
}

export interface Status {
  signed_in: number;
  in_scope: number;
}

type ClaimRow = { id: string; state: AttachmentState };

export function statement(db: D1Database, { sql, params }: CommandStatement) {
  const prepared = db.prepare(sql);
  return params?.length ? prepared.bind(...params) : prepared;
}

const visibleState = (row: string, expiry: string) => `CASE WHEN (${row}.delete_after IS NOT NULL AND ${row}.delete_after <= ${at})
  OR (${expiry} <= ${at} AND (${row}.state <> 'ready' OR NOT (${attachmentHasLink(`${row}.id`)})))
  THEN 'expired' ELSE ${row}.state END AS state`;

const reservationColumns = (row: string) => `${row}.id, ${row}.object_key, ${row}.upload_generation, ${row}.mime, ${row}.bytes,
  ${row}.duration_ms, ${row}.r2_upload_id, ${row}.lease_until`;

export async function reserve(ctx: RequestScope, session: SessionAccess, { stageId, scope, files }: GrantInput) {
  const { caller, parentScopeId } = scope;
  const access = mediaActor(session, ctx.now, caller === "chat" ? { sql: "t.id = ?", values: [parentScopeId] } : undefined);
  const base = `${access.sql}, media_target(id, caller, parent, stage_expiry, claim) AS (VALUES (?, ?, ?, ?, ?)),
    authorized AS MATERIALIZED (
      SELECT i.*, scope.context_id, scope.account_id, scope.session_expires_at FROM media_target i CROSS JOIN media_actor scope
      WHERE ${uploadAllowed("i.parent", caller)}
    ), requested AS MATERIALIZED (
      SELECT value ->> 'attachmentId' AS id, value ->> '$.file.mime' AS mime, value ->> '$.file.kind' AS kind,
        value ->> '$.file.bytes' AS bytes, value ->> '$.file.durationMs' AS duration_ms,
        value ->> '$.refresh.uploadGeneration' AS generation FROM json_each(?)
    ), allowed AS MATERIALIZED (
      SELECT i.*, coalesce(s.expires_at, i.stage_expiry) AS expires_at FROM authorized i LEFT JOIN media_stages s ON s.id = i.id
      WHERE (s.id IS NULL OR (s.context_id = i.context_id AND s.caller = i.caller AND s.parent_scope_id = i.parent
        AND s.created_at <= ${at}))
    )`;
  const params = [...access.params, stageId, caller, parentScopeId, ctx.now + stageLifetime, ctx.now + claimLifetime, JSON.stringify(files)];
  // Validate the whole batch before allocating any new object key. Existing IDs
  // must belong to this draft and match its immutable file shape and generation.
  const eligible = `${base}, eligible AS MATERIALIZED (
    SELECT i.* FROM allowed i WHERE i.expires_at > ${at} AND NOT EXISTS (
      SELECT 1 FROM requested f LEFT JOIN attachments a ON a.id = f.id WHERE
        (a.id IS NULL AND f.generation IS NOT NULL) OR (a.id IS NOT NULL AND (
        a.stage_id <> i.id OR a.mime <> f.mime OR a.bytes <> f.bytes OR a.duration_ms IS NOT f.duration_ms
        OR (f.generation IS NOT NULL AND a.upload_generation <> f.generation))))
  ), new_files AS MATERIALIZED (SELECT f.* FROM requested f WHERE NOT EXISTS (SELECT 1 FROM attachments a WHERE a.id = f.id))`;
  const useProgress = caller === "progress" ? `, progress_target AS MATERIALIZED (
      SELECT slot.shift_id FROM assignments a JOIN shift_slots slot ON slot.id = a.slot_id
      JOIN eligible i ON i.parent = a.id
    ), draft_photos AS (
      SELECT a.id FROM progress_target target JOIN shift_slots slot ON slot.shift_id = target.shift_id
      JOIN assignments used ON used.slot_id = slot.id JOIN memberships m ON m.id = used.worker_membership_id
      JOIN account_contexts c ON c.account_id = m.account_id AND c.business_id = m.business_id AND c.role = 'worker'
      JOIN media_stages s ON s.context_id = c.id AND s.caller = 'progress' AND s.parent_scope_id = used.id
      JOIN attachments a ON a.stage_id = s.id AND a.state NOT IN ('expired', 'rejected') WHERE s.expires_at > ${at}
      UNION SELECT e.attachment_id FROM progress_target target JOIN shift_evidence e ON e.shift_id = target.shift_id
    )` : "";
  const totals = `${eligible}${useProgress}, totals AS MATERIALIZED (
    SELECT
      (SELECT count(*) FROM new_files WHERE kind = 'photo') + ${caller === "progress" ? "(SELECT count(*) FROM draft_photos)" :
        `(SELECT count(*) FROM attachments a JOIN eligible i ON i.id = a.stage_id
          WHERE a.state NOT IN ('expired', 'rejected') AND a.mime IN (${photoMimeSql}))`} AS photos,
      (SELECT count(*) FROM new_files WHERE kind = 'voice') + (SELECT count(*) FROM attachments a JOIN eligible i ON i.id = a.stage_id
        WHERE a.state NOT IN ('expired', 'rejected') AND a.mime NOT IN (${photoMimeSql})) AS voices
  ), within_caps AS MATERIALIZED (
    SELECT i.* FROM eligible i CROSS JOIN totals x WHERE ${fileCap[caller]}
      AND (NOT EXISTS (SELECT 1 FROM new_files) OR (
        (SELECT coalesce(sum(bytes), 0) FROM new_files) + (
          SELECT coalesce(sum(a.bytes), 0) FROM account_contexts c JOIN media_stages s ON s.context_id = c.id
          JOIN attachments a ON a.stage_id = s.id WHERE c.account_id = i.account_id
            AND s.expires_at > ${at} AND a.state <> 'expired'
            AND (a.state <> 'ready' OR NOT (${attachmentHasLink("a.id")}))
        ) <= ${mediaLimits.pendingBytes}))
  )`;
  const db = ctx.binding;
  const [status, , claims, found] = await db.batch<Status | ClaimRow | AttachmentRow>([
    statement(db, { sql: `${base}
      SELECT EXISTS (SELECT 1 FROM acting_session) AS signed_in, EXISTS (SELECT 1 FROM allowed) AS in_scope`, params }),
    statement(db, { sql: `${totals}
      INSERT INTO media_stages (id, context_id, caller, parent_scope_id, created_at, expires_at)
      SELECT i.id, i.context_id, i.caller, i.parent, ${at}, i.expires_at FROM within_caps i WHERE 1 ON CONFLICT(id) DO NOTHING`, params }),
    statement(db, { sql: `${totals}
      INSERT INTO attachments (id, stage_id, object_key, mime, bytes, duration_ms, state, lease_until, retention_class)
      SELECT f.id, i.id, 'evidence/' || lower(hex(randomblob(16))), f.mime, f.bytes, f.duration_ms,
        CASE WHEN f.bytes > ${singleBytes} THEN 'preparing' ELSE 'uploading' END,
        CASE WHEN f.bytes > ${singleBytes} THEN i.claim END, 'unlinked'
      FROM within_caps i CROSS JOIN requested f
      LEFT JOIN attachments a ON a.id = f.id
      WHERE a.id IS NULL OR (a.state = 'preparing' AND a.lease_until <= ${at} AND a.r2_upload_id IS NULL
        AND (a.delete_after IS NULL OR a.delete_after > ${at}))
      ON CONFLICT(id) DO UPDATE SET object_key = excluded.object_key, upload_generation = attachments.upload_generation + 1,
        lease_until = excluded.lease_until
      RETURNING id, state`, params }),
    statement(db, { sql: `${base}
      SELECT ${reservationColumns("a")}, i.expires_at, i.session_expires_at, ${visibleState("a", "i.expires_at")}
      FROM allowed i JOIN attachments a ON a.stage_id = i.id
      JOIN requested f ON f.id = a.id AND a.mime = f.mime AND a.bytes = f.bytes AND a.duration_ms IS f.duration_ms`, params }),
  ]);
  const rows = found!.results as AttachmentRow[];
  const newClaims = new Set((claims!.results as ClaimRow[]).filter((row) => row.state === "preparing").map((row) => row.id));
  // Read scope and existence in the same initial batch, including the 0-row case.
  return { status: status!.results[0] as Status, rows, newClaims };
}

const fileCap = {
  request: "x.photos <= 5 AND x.voices <= 1", chat: "(x.photos <= 3 AND x.voices = 0 OR x.photos = 0 AND x.voices = 1)",
  progress: "x.photos <= 6 AND x.voices = 0", update: "x.photos <= 1 AND x.voices = 0", completion: "x.photos <= 8 AND x.voices = 0",
  case: "x.photos <= 5 AND x.voices <= 1", quote: "x.photos <= 5 AND x.voices <= 1", change: "x.photos <= 5 AND x.voices <= 1",
} as const;

export function stageAccess(ctx: RequestScope, session: SessionAccess, stageId: string): SessionAccess {
  const access = mediaActor(session, ctx.now, {
    sql: "t.id = (SELECT parent_scope_id FROM media_stages WHERE id = ? AND caller = 'chat')", values: [stageId],
  });
  return { sql: `${access.sql}, allowed AS MATERIALIZED (
    SELECT stage.*, scope.session_expires_at FROM media_stages stage JOIN media_actor scope ON scope.context_id = stage.context_id
    WHERE stage.id = ? AND stage.created_at <= ${at} AND ${uploadAllowed("stage.parent_scope_id")}
  )`, params: [...access.params, stageId] };
}

const ownedRows = `SELECT a.*, s.expires_at, s.session_expires_at FROM allowed s JOIN attachments a ON a.stage_id = s.id`;

export async function claim(ctx: RequestScope, access: SessionAccess, files: SettleInput["files"] | RecoverInput["files"], mode: "settle" | "recover") {
  const base = `${access.sql}, requested AS MATERIALIZED (
    SELECT value ->> 'attachmentId' AS id, value ->> 'uploadGeneration' AS generation, value ->> 'kind' AS kind,
      json_array_length(value, '$.parts') AS part_count, (SELECT max(value ->> 'partNumber') FROM json_each(f.value, '$.parts')) AS last_part,
      value ->> 'unknown' AS probe FROM json_each(?) f
  ), selected AS MATERIALIZED (
    ${ownedRows} JOIN requested f ON f.id = a.id AND f.generation = a.upload_generation
    WHERE ${mode === "settle" ? `((f.kind = 'single' AND a.bytes <= ${singleBytes}) OR (
      f.kind = 'multipart' AND a.bytes > ${singleBytes} AND f.part_count = (a.bytes + ${partBytes} - 1) / ${partBytes}
      AND f.last_part = f.part_count))` : `((f.probe = 'put' AND a.bytes <= ${singleBytes}) OR (
      f.probe IN ('parts', 'completion') AND a.bytes > ${singleBytes}))`}
  )`;
  const params = [...access.params, JSON.stringify(files)];
  const transition = mode === "settle" ? `a.state = 'uploading' AND (a.bytes <= ${singleBytes} OR a.r2_upload_id IS NOT NULL)`
    : `(f.probe = 'put' AND a.state = 'uploading' OR (f.probe IN ('put', 'completion') AND a.state = 'verifying' AND a.lease_until <= ${at}))`;
  const db = ctx.binding;
  const [status, claimed, selected] = await db.batch<Status | ClaimRow | AttachmentRow>([
    statement(db, { sql: `${access.sql}
      SELECT EXISTS (SELECT 1 FROM acting_session) AS signed_in, EXISTS (SELECT 1 FROM allowed) AS in_scope`, params: access.params }),
    statement(db, { sql: `${base}
      UPDATE attachments SET state = 'verifying', lease_until = ? WHERE id IN (
        SELECT a.id FROM selected a JOIN requested f ON f.id = a.id
        WHERE a.expires_at > ${at} AND (a.delete_after IS NULL OR a.delete_after > ${at}) AND (${transition}))
      AND (SELECT count(*) FROM selected) = (SELECT count(*) FROM requested) RETURNING id, state`, params: [...params, ctx.now + claimLifetime] }),
    statement(db, { sql: `${base}
      SELECT ${reservationColumns("a")}, a.expires_at, a.session_expires_at, ${visibleState("a", "a.expires_at")} FROM selected a`, params }),
  ]);
  return { status: status!.results[0] as Status, rows: selected!.results as AttachmentRow[],
    claimed: new Set((claimed!.results as ClaimRow[]).map((row) => row.id)) };
}

export interface MediaResult {
  id: string;
  upload_generation: number;
  state: "uploading" | "ready" | "rejected";
  etag?: string;
  uploadId?: string;
}

export async function saveResults(ctx: RequestScope, access: SessionAccess, from: "preparing" | "verifying", results: MediaResult[]) {
  if (!results.length) return new Map<string, AttachmentState>();
  const [batch] = await ctx.binding.batch<ClaimRow>([statement(ctx.binding, { sql: `${access.sql}, result_rows AS MATERIALIZED (
      SELECT value ->> 'id' AS id, value ->> 'upload_generation' AS generation, value ->> 'state' AS state,
        value ->> 'etag' AS etag, value ->> 'uploadId' AS upload_id FROM json_each(?)
    )
    UPDATE attachments AS a SET state = r.state, lease_until = NULL,
      r2_upload_id = coalesce(r.upload_id, a.r2_upload_id), etag = coalesce(r.etag, a.etag)
    FROM result_rows r WHERE r.id = a.id AND r.generation = a.upload_generation AND a.state = '${from}' AND a.lease_until = ?
      AND (a.delete_after IS NULL OR a.delete_after > ${at})
      AND EXISTS (SELECT 1 FROM allowed s WHERE s.id = a.stage_id AND s.expires_at > ${at})
    RETURNING id, state`, params: [...access.params, JSON.stringify(results), ctx.now + claimLifetime] })]);
  return new Map(batch!.results.map(({ id, state }) => [id, state]));
}
