import type { Bindings } from "../../bindings";
import { attachmentHasLink } from "./policy";

const sweepLimit = 100;
const deleteClaimMs = 120_000;

interface DueAttachment { id: string; object_key: string | null }

export async function sweepMediaRetention(env: Pick<Bindings, "DB" | "EVIDENCE">, now = Date.now()): Promise<void> {
  const db = env.DB;
  const claim = now + deleteClaimMs;
  const [batch] = await db.batch<DueAttachment>([db.prepare(`WITH clock(now, claim) AS (VALUES (?, ?)),
    candidates AS (
      SELECT a.id, a.delete_after AS due FROM attachments a
      WHERE a.delete_after <= (SELECT now FROM clock)
      UNION ALL
      SELECT a.id, s.expires_at FROM media_stages s JOIN attachments a ON a.stage_id = s.id
      WHERE s.expires_at <= (SELECT now FROM clock) AND a.delete_after IS NULL AND a.state <> 'expired'
        AND NOT (${attachmentHasLink("a.id")})
    ), due AS MATERIALIZED (
      SELECT a.id, CASE WHEN a.state NOT IN ('reserved', 'preparing') THEN a.object_key END AS key
      FROM candidates c JOIN attachments a ON a.id = c.id
      WHERE (a.lease_until IS NULL OR a.lease_until <= (SELECT now FROM clock)) AND NOT EXISTS (
        SELECT 1 FROM retention_holds hold WHERE hold.record_kind = 'attachment' AND hold.record_id = a.id AND hold.released_at IS NULL)
      ORDER BY c.due, a.id LIMIT ${sweepLimit}
    )
    UPDATE attachments SET state = 'expired', lease_until = NULL,
      delete_after = CASE WHEN (SELECT key FROM due WHERE due.id = attachments.id) IS NOT NULL THEN (SELECT claim FROM clock) END
    WHERE id IN (SELECT id FROM due)
    RETURNING id, CASE WHEN delete_after IS NOT NULL THEN object_key END AS object_key`).bind(now, claim)]);
  const objects = batch!.results.filter((item): item is DueAttachment & { object_key: string } => item.object_key !== null);
  if (!objects.length) return;
  // Mark unavailable before deleting, and leave a bounded retry deadline on any failed deletion.
  await env.EVIDENCE.delete(objects.map(({ object_key }) => object_key));
  await db.batch([db.prepare(`UPDATE attachments SET delete_after = NULL WHERE state = 'expired' AND delete_after = ?
    AND id IN (SELECT value FROM json_each(?))`).bind(claim, JSON.stringify(objects.map(({ id }) => id)))]);
}
