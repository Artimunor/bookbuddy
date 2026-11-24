import type { Table } from "./executor";

type Partition = { account_id: string; context_id: string };
type Saved = { value: string; updated_at: number };
export type OutboxStatus = "queued" | "checking" | "conflict" | "rejected";

function table<Row extends Record<keyof Row, string | number | null>>(
  name: string, key: Table<Row>["key"], columns: string,
): Table<Row> {
  return { name, key, schema: `CREATE TABLE IF NOT EXISTS ${name} (${columns}, PRIMARY KEY (${key.join(", ")})) STRICT;` };
}
const partition = "account_id TEXT NOT NULL, context_id TEXT NOT NULL";
const partitionKey = ["account_id", "context_id"] as const;

export const projection = table<Partition & { kind: string; id: string; value: string }>(
  "projection", [...partitionKey, "kind", "id"], `${partition}, kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL`,
);
export const syncState = table<Partition & { cursor: string | null; confirmed_at: number | null; authorized_at: number | null }>(
  "sync_state", partitionKey, `${partition}, cursor TEXT, confirmed_at INTEGER, authorized_at INTEGER`,
);
export const drafts = table<Partition & Saved & { key: string }>(
  "drafts", [...partitionKey, "key"], `${partition}, key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL`,
);
export const outbox = table<Partition & { operation_id: string; value: string; status: OutboxStatus; created_at: number; error: string | null }>(
  "outbox", [...partitionKey, "operation_id"], `${partition}, operation_id TEXT NOT NULL, value TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'checking', 'conflict', 'rejected')), created_at INTEGER NOT NULL, error TEXT`,
);

// Acknowledged attendance must not go back into the send queue while its
// assignment projection is on a later sync page.
export const attendanceReceipts = table<Partition & {
  operation_id: string; assignment_id: string; created_at: number; value: string; result_ref: string | null;
}>("attendance_receipts", [...partitionKey, "operation_id"], `${partition}, operation_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL, created_at INTEGER NOT NULL, value TEXT NOT NULL, result_ref TEXT`);
export const stagedMedia = table<Partition & Saved & { attachment_id: string }>(
  "staged_media", [...partitionKey, "attachment_id"], `${partition}, attachment_id TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL`,
);
export const pendingOnlineReceipts = table<Partition & { operation_id: string; kind: string; resource_id: string; created_at: number }>(
  "pending_online_receipts", [...partitionKey, "operation_id"], `${partition}, operation_id TEXT NOT NULL,
    kind TEXT NOT NULL, resource_id TEXT NOT NULL, created_at INTEGER NOT NULL`,
);
export const localSettings = table<{ account_id: string; key: string; value: string }>(
  "local_settings", ["account_id", "key"], "account_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL",
);

export const schema = [projection, syncState, drafts, outbox, attendanceReceipts, stagedMedia, pendingOnlineReceipts, localSettings]
  .map(({ schema }) => schema).join("\n") + `
  CREATE INDEX IF NOT EXISTS outbox_drain ON outbox(account_id, context_id, status, created_at, operation_id);
  CREATE INDEX IF NOT EXISTS attendance_by_assignment ON attendance_receipts(account_id, context_id, assignment_id, created_at, operation_id);
  CREATE INDEX IF NOT EXISTS draft_expiry ON drafts(account_id, context_id, updated_at);`;
