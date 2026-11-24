import { idSchema } from "@bookbuddy/api-contract";
import type { SyncOp, SyncOpKind, SyncProjection } from "@bookbuddy/api-contract";
import type { CommandInput, CommandStatement } from "../../db/commit";
import type { OperationResult } from "../../db/operations";
import type { RequestScope } from "../../db/scope";
import type { SessionAccess } from "../auth/session";

export type SyncCommandContext = Pick<RequestScope, "now" | "requestId"> & { access: SessionAccess; contextId: string };
type Plan = (ctx: SyncCommandContext, operation: SyncOp) => Promise<CommandInput<OperationResult>>;
export interface SyncOperationHandler { kind: SyncOpKind; plan: Plan }

export function syncOperation<K extends SyncOpKind>(kind: K, plan: (
  ctx: SyncCommandContext, operation: Extract<SyncOp, { kind: K }>,
) => Promise<CommandInput<OperationResult>>): SyncOperationHandler {
  return { kind, plan(ctx, operation) {
    if (operation.kind !== kind) throw new TypeError("Wrong sync operation handler");
    return plan(ctx, operation as Extract<SyncOp, { kind: K }>);
  } };
}

export interface SyncProjectionReader {
  kind: string;
  schema: { parse(value: unknown): SyncProjection["value"] };
  // Read authorized resource_id keys from snapshot_scope, after snapshot_scope.after_id.
  // The surrounding query orders and limits each branch; expose no values here.
  snapshotIds: (now: number) => CommandStatement;
  // Join projection_keys(resource_id, kind) and live_scope, reapplying resource grants.
  // Return resource_id and JSON-text value, one row per authorized key, never a raw record.
  project: (now: number) => CommandStatement;
}

export interface SyncRegistry {
  operations: ReadonlyMap<SyncOpKind, SyncOperationHandler>;
  projections: ReadonlyMap<string, SyncProjectionReader>;
}

export function createSyncRegistry(operations: readonly SyncOperationHandler[], projections: readonly SyncProjectionReader[]): SyncRegistry {
  const operationMap = new Map<SyncOpKind, SyncOperationHandler>();
  const projectionMap = new Map<string, SyncProjectionReader>();
  for (const operation of operations) {
    if (operationMap.has(operation.kind)) throw new TypeError(`Duplicate sync operation: ${operation.kind}`);
    operationMap.set(operation.kind, operation);
  }
  for (const reader of projections) {
    const kind = idSchema.parse(reader.kind);
    if (kind === "scope" || projectionMap.has(kind)) throw new TypeError(`Reserved or duplicate projection kind: ${kind}`);
    projectionMap.set(kind, reader);
  }
  return { operations: operationMap, projections: projectionMap };
}