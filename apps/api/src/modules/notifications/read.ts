import { idSchema, notificationSchema, timestampSchema } from "@bookbuddy/api-contract";
import type { NotificationProjection } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";
import type { SessionAccess } from "../auth/session";
import type { SyncProjectionReader } from "../sync/registry";

const pageSize = 50;
const linkJoin = `LEFT JOIN link_targets l ON l.token = n.link_token AND l.required_scope = n.context_id AND l.expires_at > ?`;

export const notificationSyncProjection: SyncProjectionReader = {
  kind: "notification",
  schema: notificationSchema,
  snapshotIds: () => ({ sql: `SELECT n.id AS resource_id FROM notifications n
    WHERE n.context_id = (SELECT context_id FROM snapshot_scope) AND n.id > (SELECT after_id FROM snapshot_scope)` }),
  project: (now) => ({ sql: `SELECT n.id AS resource_id, json_object(
      'id', n.id, 'kind', n.kind, 'linkToken', l.token, 'createdAt', n.created_at, 'readAt', n.read_at) AS value
    FROM projection_keys k JOIN notifications n ON n.id = k.resource_id
    JOIN live_scope s ON s.context_id = n.context_id ${linkJoin} WHERE k.kind = 'notification'`, params: [now] }),
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
  return {
    sql: `${access.sql}
      SELECT s.context_id, n.id, n.kind, l.token AS linkToken, n.created_at AS createdAt, n.read_at AS readAt
      FROM acting_session a LEFT JOIN live_scope s ON s.account_id = a.account_id
      LEFT JOIN notifications n ON n.context_id = s.context_id${cursor ? " AND (n.created_at, n.id) < (?, ?)" : ""}
      ${linkJoin}
      ORDER BY n.created_at DESC, n.id DESC LIMIT ${pageSize + 1}`,
    params: [...access.params ?? [], ...cursor ? [cursor.createdAt, cursor.id] : [], now],
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
