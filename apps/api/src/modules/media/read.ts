import { mediaFileSchema } from "@bookbuddy/api-contract";
import type { MediaReadGrant, RouteResponse, createMediaReadGrantsRoute } from "@bookbuddy/api-contract";
import type { Bindings } from "../../bindings";
import type { RequestScope } from "../../db/scope";
import { createR2Presigner } from "../../providers/r2-presign";
import type { SessionAccess } from "../auth/session";
import { mediaActor, readLinks, readyAttachmentSql } from "./policy";
import { statement } from "./storage";
import type { AttachmentRow } from "./storage";
import { readLifetime } from "./transfer";
import type { MediaFailure } from "./transfer";

type ReadInput = RouteResponse<typeof createMediaReadGrantsRoute.input>["body"];
type ReadRow = Pick<AttachmentRow, "id" | "object_key" | "mime" | "bytes" | "duration_ms" | "session_expires_at"> & { delete_after: number | null };

export async function readMedia(ctx: RequestScope, session: SessionAccess, env: Bindings,
  { scope, attachmentIds }: ReadInput): Promise<MediaReadGrant[] | MediaFailure> {
  const { caller, parentScopeId } = scope;
  const access = mediaActor(session, ctx.now, caller === "chat" ? {
    sql: "t.id = (SELECT thread_id FROM chat_entries WHERE id = ?)", values: [parentScopeId],
  } : undefined);
  const db = ctx.binding;
  const [auth, records] = await db.batch<{ signed_in: number } | ReadRow>([
    statement(db, { sql: `${session.sql} SELECT EXISTS (SELECT 1 FROM acting_session) AS signed_in`, params: session.params }),
    statement(db, { sql: `${access.sql}, input(parent, ids) AS (VALUES (?, ?))
      SELECT a.id, a.object_key, a.mime, a.bytes, a.duration_ms, a.delete_after, scope.session_expires_at
      FROM media_actor scope CROSS JOIN input i CROSS JOIN json_each(i.ids) x JOIN attachments a ON a.id = x.value
      WHERE ${readyAttachmentSql("a")} AND a.id IN (${readLinks(caller, "i.parent")})`,
    params: [...access.params, parentScopeId, JSON.stringify(attachmentIds)] }),
  ]);
  const authorization = auth?.results[0];
  if (!authorization || !("signed_in" in authorization) || !authorization.signed_in) return "UNAUTHENTICATED";
  const rows = new Map((records!.results as ReadRow[]).map((row) => [row.id, row]));
  const signer = rows.size ? createR2Presigner(env) : null;
  if (rows.size && !signer) return "UNAVAILABLE";
  return Promise.all(attachmentIds.map(async (attachmentId): Promise<MediaReadGrant> => {
    const row = rows.get(attachmentId);
    if (!row) return { state: "unavailable", attachmentId };
    const expiresAt = Math.floor(Math.min(ctx.now + readLifetime, row.session_expires_at, row.delete_after ?? Infinity) / 1_000) * 1_000;
    if (expiresAt <= ctx.now) return { state: "unavailable", attachmentId };
    const parsed = mediaFileSchema.safeParse(row.duration_ms === null ? { kind: "photo", mime: row.mime, bytes: row.bytes }
      : { kind: "voice", mime: row.mime, bytes: row.bytes, durationMs: row.duration_ms });
    if (!parsed.success) return { state: "unavailable", attachmentId };
    const file = parsed.data.kind === "voice" ? { ...parsed.data, transcriptState: "unavailable" as const } : parsed.data;
    const url = await signer!({ method: "GET", key: row.object_key, signedAt: ctx.now, expiresAt });
    return { state: "ready", attachmentId, file, method: "GET", url, expiresAt };
  }));
}
