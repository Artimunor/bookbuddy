import type { NotificationReadPayload, OperationId, RegisterPushInstallation, RevokePushInstallation } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";
import { planOperation, recordSyncChanges } from "../../db/operations";
import type { SessionAccess } from "../auth/session";
import { syncOperation } from "../sync/registry";
import type { SyncCommandContext } from "../sync/registry";

export function planNotificationRead(ctx: SyncCommandContext, operation: {
  operationId: OperationId; expectedRevision?: number; payload: NotificationReadPayload;
}) {
  const { operationId, expectedRevision, payload } = operation;
  // ID marks are sets; sorted IDs make the same direct/queued command replayable.
  const ids = payload.mode === "ids" ? JSON.stringify([...payload.ids].sort()) : null;
  const selected = payload.mode === "ids"
    ? { sql: "n.id IN (SELECT value FROM json_each(?))", params: [ids] }
    : { sql: "(n.created_at, n.id) <= (?, ?)", params: [payload.through.createdAt, payload.through.id] };
  const unread = `n.context_id = ? AND n.read_at IS NULL AND ${selected.sql}`;
  const unreadParams = [ctx.contextId, ...selected.params];
  const hasUnread = `EXISTS (SELECT 1 FROM notifications n WHERE ${unread})`;
  return planOperation(ctx, {
    operationId, command: "notification_read_mark", access: ctx.access, resultRef: operationId,
    input: { expectedRevision, payload: payload.mode === "ids" ? { mode: "ids", ids } : payload },
    authorize: payload.mode === "ids" ? {
      sql: `(SELECT count(*) FROM notifications n WHERE n.context_id = scope.context_id AND ${selected.sql}) = ?`,
      params: [ids, payload.ids.length],
    } : undefined,
    eligible: { sql: hasUnread, params: unreadParams },
    unchanged: { sql: `NOT ${hasUnread}`, params: unreadParams },
    writes: (guard) => ({
      statements: [
        // Capture precisely the rows transitioning from unread, even if another
        // operation in this same sync page uses the same receipt timestamp.
        recordSyncChanges(guard, {
          sql: `SELECT 'notification' AS kind, n.id AS resource_id, n.context_id AS partition_key, 'upsert' AS op, ? AS at
                FROM notifications n WHERE ${unread}`,
          params: [ctx.now, ...unreadParams],
        }),
        { sql: `UPDATE notifications AS n SET read_at = ? WHERE ${unread} AND ${guard.sql}`,
          params: [ctx.now, ...unreadParams, ...guard.params ?? []] },
      ],
      topics: [{ kind: "scope-inbox", opaqueId: ctx.contextId }],
    }),
  });
}

export const notificationReadSyncOperation = syncOperation("notification_read_mark", (ctx, operation) => planNotificationRead(ctx, {
  operationId: operation.operationId, expectedRevision: operation.expectedRevision, payload: { mode: "ids", ids: operation.payload.ids },
}));

type PushOperation = { method: "PUT"; body: RegisterPushInstallation } | { method: "DELETE"; body: RevokePushInstallation };

// Registration is bound to the authenticated device, independent of the active role.
const installationScope = { sql: `SELECT a.account_id, a.device_id, c.id AS context_id FROM acting_session a
  JOIN account_contexts c ON c.account_id = a.account_id AND c.role = 'customer'` };

export function planPushInstallation(ctx: { now: number; access: SessionAccess }, id: string, operation: PushOperation) {
  const { operationId, expectedRevision, payload } = operation.body;
  const nextEpoch = expectedRevision + 1;
  const existing = `i.id = ? AND i.account_id = scope.account_id AND i.token_epoch = ?`;
  const ownsInstallation = "i.account_id = scope.account_id AND (i.device_id IS NULL OR i.device_id = scope.device_id)";
  const authorize: CommandStatement = operation.method === "PUT"
    ? { sql: `NOT EXISTS (SELECT 1 FROM push_installations i WHERE i.id = ? AND NOT (${ownsInstallation}))`, params: [id] }
    : { sql: `EXISTS (SELECT 1 FROM push_installations i WHERE i.id = ? AND ${ownsInstallation})`, params: [id] };
  if (operation.method === "DELETE") {
    return planOperation(ctx, {
      operationId, command: "push_installation_revoke", access: ctx.access, scope: installationScope, input: { id, expectedRevision },
      resultRef: String(nextEpoch), authorize,
      eligible: { sql: `EXISTS (SELECT 1 FROM push_installations i WHERE ${existing} AND i.state <> 'revoked')`, params: [id, expectedRevision] },
      unchanged: { sql: `EXISTS (SELECT 1 FROM push_installations i WHERE ${existing} AND i.state = 'revoked')`, params: [id, expectedRevision] },
      writes: (guard) => ({ statements: [{
        sql: `UPDATE push_installations SET state = 'revoked', token_epoch = ?, updated_at = ? WHERE id = ? AND ${guard.sql}`,
        params: [nextEpoch, ctx.now, id, ...guard.params ?? []],
      }] }),
    });
  }
  const { token, platform } = operation.body.payload;
  return planOperation(ctx, {
    operationId, command: "push_installation_put", access: ctx.access, scope: installationScope, input: { id, expectedRevision, payload },
    resultRef: String(nextEpoch), authorize,
    eligible: {
      sql: `NOT EXISTS (SELECT 1 FROM push_installations WHERE token = ? AND state = 'active' AND id <> ?)
        AND ((? = 0 AND NOT EXISTS (SELECT 1 FROM push_installations WHERE id = ?)) OR EXISTS (
          SELECT 1 FROM push_installations i WHERE ${existing}
          AND (i.device_id IS NULL OR i.token <> ? OR i.state = 'revoked' OR (i.state = 'active' AND i.platform <> ?))
        ))`,
      params: [token, id, expectedRevision, id, id, expectedRevision, token, platform],
    },
    unchanged: {
      sql: `EXISTS (SELECT 1 FROM push_installations i WHERE ${existing}
        AND i.device_id = scope.device_id AND i.state = 'active' AND i.token = ? AND i.platform = ?)`,
      params: [id, expectedRevision, token, platform],
    },
    writes: (guard) => ({ statements: [{
      sql: `${ctx.access.sql}
        INSERT INTO push_installations (id, account_id, device_id, token, token_epoch, platform, state, updated_at)
        SELECT ?, a.account_id, a.device_id, ?, ?, ?, 'active', ? FROM acting_session a WHERE ${guard.sql}
        ON CONFLICT (id) DO UPDATE SET device_id = excluded.device_id, token = excluded.token, token_epoch = excluded.token_epoch,
          platform = excluded.platform, state = excluded.state, updated_at = excluded.updated_at`,
      params: [...ctx.access.params ?? [], id, token, nextEpoch, platform, ctx.now, ...guard.params ?? []],
    }] }),
  });
}
