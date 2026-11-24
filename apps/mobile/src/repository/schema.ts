import type { Table } from "./executor";
import type { AttachmentId, MediaScope, MediaStageId, MediaTransferState } from "../media/types";

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
export type ProgressReceiptState = "sent" | "recorded" | "rejected";
export const progressReceipts = table<Partition & {
  operation_id: string; assignment_id: string; state: ProgressReceiptState; confirmed_at: number; photos: string;
}>("progress_receipts", [...partitionKey, "operation_id"], `${partition}, operation_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('sent', 'recorded', 'rejected')),
  confirmed_at INTEGER NOT NULL, photos TEXT NOT NULL`);
export const stagedMedia = table<Partition & Saved & { attachment_id: string }>(
  "staged_media", [...partitionKey, "attachment_id"], `${partition}, attachment_id TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL`,
);
export const mediaTransfers = table<Partition & {
  attachment_id: AttachmentId; stage_id: MediaStageId; caller: MediaScope["caller"]; parent_scope_id: string;
  state: MediaTransferState; selected: 0 | 1; file_uri: string | null; created_at: number; value: string;
}>("media_transfers", [...partitionKey, "attachment_id"], `${partition}, attachment_id TEXT NOT NULL, stage_id TEXT NOT NULL,
  caller TEXT NOT NULL, parent_scope_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'uploading', 'verifying', 'ready', 'failed')),
  selected INTEGER NOT NULL CHECK (selected IN (0, 1)), file_uri TEXT, created_at INTEGER NOT NULL, value TEXT NOT NULL`);
export const pendingOnlineReceipts = table<Partition & { operation_id: string; kind: string; resource_id: string; created_at: number }>(
  "pending_online_receipts", [...partitionKey, "operation_id"], `${partition}, operation_id TEXT NOT NULL,
    kind TEXT NOT NULL, resource_id TEXT NOT NULL, created_at INTEGER NOT NULL`,
);
export const localSettings = table<{ account_id: string; key: string; value: string }>(
  "local_settings", ["account_id", "key"], "account_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL",
);

export const schema = [projection, syncState, drafts, outbox, attendanceReceipts, progressReceipts, stagedMedia, mediaTransfers, pendingOnlineReceipts, localSettings]
  .map(({ schema }) => schema).join("\n") + `
  CREATE INDEX IF NOT EXISTS outbox_drain ON outbox(account_id, context_id, status, created_at, operation_id);
  CREATE INDEX IF NOT EXISTS attendance_by_assignment ON attendance_receipts(account_id, context_id, assignment_id, created_at, operation_id);
  CREATE INDEX IF NOT EXISTS progress_by_assignment ON progress_receipts(account_id, context_id, assignment_id, confirmed_at, operation_id);
  CREATE INDEX IF NOT EXISTS draft_expiry ON drafts(account_id, context_id, updated_at);
  CREATE INDEX IF NOT EXISTS media_transfer_parent ON media_transfers(account_id, context_id, caller, parent_scope_id, created_at, attachment_id);
  CREATE INDEX IF NOT EXISTS media_transfer_work ON media_transfers(account_id, context_id, selected, state, created_at, attachment_id);`;
