import { idSchema, notificationSchema, timestampSchema } from "@bookbuddy/api-contract";
import type { NotificationProjection } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";
import { accessClock } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import type { SyncProjectionReader } from "../sync/registry";
import { inboxNoticeAllowed, noticeLink, scopedNoticeReader } from "./policy";

const pageSize = 50;
const visible = `EXISTS (SELECT 1 FROM link_targets l WHERE ${noticeLink} AND (${inboxNoticeAllowed}))`;

export const notificationSyncProjection: SyncProjectionReader = {
  kind: "notification",
  schema: notificationSchema,
  // The snapshot keyset is recipient-scoped; only the bounded page is tested
  // and serialized. This keeps unrelated projection statements below D1's SQL limit.
  snapshotIds: () => ({ sql: `SELECT n.id AS resource_id FROM snapshot_scope s
    CROSS JOIN notifications n ON n.context_id = s.context_id AND n.id > s.after_id
    JOIN link_targets l ON l.token = n.link_token AND l.required_scope = s.context_id AND l.expires_at > (SELECT at FROM clock)` }),
  project: () => ({ sql: `WITH ${scopedNoticeReader("live_scope")}
    SELECT n.id AS resource_id, json_object(
      'id', n.id, 'kind', n.kind, 'linkToken', n.link_token, 'createdAt', n.created_at, 'readAt', n.read_at) AS value
    FROM projection_keys k JOIN notifications n ON n.id = k.resource_id
    JOIN notice_scope scope ON scope.context_id = n.context_id WHERE k.kind = 'notification' AND ${visible}` }),
};

interface NotificationCursor { createdAt: number; id: string }
export function notificationCursor(cursor: string): NotificationCursor | null {
  const [created, id, extra] = cursor.split("~");
  if (extra !== undefined || created === undefined || !/^-?\d+$/.test(created)) return null;
  const createdAt = timestampSchema.safeParse(Number(created));
  const parsedId = idSchema.safeParse(id);
  return createdAt.success && parsedId.success ? { createdAt: createdAt.data, id: parsedId.data } : null;
}

export function readNotifications(access: SessionAccess, now: number, cursor: NotificationCursor | null): CommandStatement {
  const clock = accessClock(access, now);
  return {
    sql: `${clock.sql}, ${scopedNoticeReader("live_scope")}
      SELECT scope.context_id, n.id, n.kind, n.link_token AS linkToken, n.created_at AS createdAt, n.read_at AS readAt
      FROM acting_session a LEFT JOIN notice_scope scope ON scope.account_id = a.account_id
      LEFT JOIN notifications n ON n.context_id = scope.context_id${cursor ? " AND (n.created_at, n.id) < (?, ?)" : ""}
        AND ${visible}
      ORDER BY n.created_at DESC, n.id DESC LIMIT ${pageSize + 1}`,
    params: [...clock.params, ...cursor ? [cursor.createdAt, cursor.id] : []],
  };
}

export function decodeNotifications(rows: readonly unknown[]): {
  items: NotificationProjection[]; page: { cursor: string | null; hasMore: boolean };
} | "UNAUTHENTICATED" | "NOT_FOUND" {
  const inbox = rows as ({ context_id: string | null; id: string | null } & Record<string, unknown>)[];
  const first = inbox[0];
  if (!first) return "UNAUTHENTICATED";
  if (!first.context_id) return "NOT_FOUND";
  const hasMore = inbox.length > pageSize;
  const items = first.id === null ? [] : inbox.slice(0, pageSize).map(({ context_id: _scope, ...row }) => notificationSchema.parse(row));
  const last = items.at(-1);
  return { items, page: { cursor: hasMore && last ? `${last.createdAt}~${last.id}` : null, hasMore } };
}
