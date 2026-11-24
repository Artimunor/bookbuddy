import { idSchema } from "@bookbuddy/api-contract";
import type { ErrorBody, OperationId } from "@bookbuddy/api-contract";
import type { OpOutcome } from "@bookbuddy/api-contract";
import type { CommandInput, CommandStatement } from "./commit";
import type { RequestScope } from "./scope";
import type { LiveTopicKey } from "../realtime/live-topic";

export interface OperationResult {
  outcome: OpOutcome;
  workKeys: string[];
  topics: readonly LiveTopicKey[];
}

export interface OperationWrites {
  statements: readonly CommandStatement[];
  changes?: CommandStatement;
  effects?: CommandStatement;
  topics?: readonly LiveTopicKey[];
}

export interface OperationSpec {
  operationId: OperationId;
  command: string;
  input: unknown;
  resultRef: string;
  // The first SQL fragment provides the acting_session and live_scope CTEs.
  access: CommandStatement;
  // Account-wide commands can select a stable receipt context from acting_session.
  // Otherwise use the active live_scope. Predicates use the selected row as scope.
  scope?: CommandStatement;
  // Resource authorization also protects replay, independently of state eligibility.
  authorize?: CommandStatement;
  eligible: CommandStatement;
  unchanged?: CommandStatement;
  ineligible?: ErrorBody;
  writes: (invocation: CommandStatement) => OperationWrites;
}

const encoder = new TextEncoder();
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const fields = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${fields.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("Operation input must be JSON");
  return encoded;
}

// The select's columns are kind, resource_id, partition_key, op, at. A partition
// is an exact audience context, never a business-wide bag of inaccessible IDs.
export function recordSyncChanges(guard: CommandStatement, select: CommandStatement): CommandStatement {
  return {
    sql: `INSERT INTO sync_changes (kind, resource_id, partition_key, op, at)
          SELECT kind, resource_id, partition_key, op, at FROM (${select.sql}) WHERE ${guard.sql}`,
    params: [...select.params ?? [], ...guard.params ?? []],
  };
}

// Pass a select of distinct context_id values. Epochs and removals belong in
// the same transaction as the domain change that revoked those projections.
export function bumpVisibilityEpoch(guard: CommandStatement, contexts: CommandStatement): CommandStatement {
  return {
    sql: `INSERT INTO sync_scope_state (context_id, visibility_epoch)
          SELECT context_id, 1 FROM (${contexts.sql}) WHERE ${guard.sql}
          ON CONFLICT (context_id) DO UPDATE SET visibility_epoch = visibility_epoch + 1`,
    params: [...contexts.params ?? [], ...guard.params ?? []],
  };
}

// The select yields new id, kind, dedupe_key, resource_ref, due_at, expires_at.
export function recordEffectIntents(guard: CommandStatement, select: CommandStatement): CommandStatement {
  return {
    sql: `INSERT INTO effect_outbox (id, kind, dedupe_key, resource_ref, due_at, state, expires_at)
          SELECT id, kind, dedupe_key, resource_ref, due_at, 'pending', expires_at
          FROM (${select.sql}) WHERE ${guard.sql} ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    params: [...select.params ?? [], ...guard.params ?? []],
  };
}

interface StoredResult { authorized: number; result_ref: string | null; matches_input: number | null; unchanged: number }

// Compose the returned input with prepareCommand. Only this invocation's
// temporary receipt can authorize writes; all valid result references exclude
// the private pending namespace. A D1 failure rolls back the entire batch.
export async function planOperation(ctx: Pick<RequestScope, "now">, spec: OperationSpec): Promise<CommandInput<OperationResult>> {
  const { operationId, command, access, scope, authorize = { sql: "1" }, eligible, unchanged } = spec;
  const prefix = scope ? `${access.sql}, command_scope AS MATERIALIZED (${scope.sql})` : access.sql;
  const scopeName = scope ? "command_scope" : "live_scope";
  const prefixParams = scope?.params ? [...access.params ?? [], ...scope.params] : access.params ?? [];
  const resultRef = idSchema.parse(spec.resultRef);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(canonical([command, spec.input]))));
  const inputHash = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const pending = `pending:${crypto.randomUUID()}`;
  const pendingWhere = "result_ref = ? AND result_ref GLOB 'pending:*'";
  const guard = { sql: `EXISTS (SELECT 1 FROM operation_receipts WHERE ${pendingWhere})`, params: [pending] };
  const { statements: mutations, changes, effects, topics = [] } = spec.writes(guard);
  const statements: [CommandStatement, ...CommandStatement[]] = [{
    sql: `${prefix}
          INSERT INTO operation_receipts (account_id, context_id, operation_id, input_hash, command, result_ref, committed_at)
          SELECT scope.account_id, scope.context_id, ?, ?, ?, ?, ? FROM ${scopeName} scope
          WHERE (${authorize.sql}) AND NOT EXISTS (
            SELECT 1 FROM operation_receipts r WHERE r.account_id = scope.account_id AND r.context_id = scope.context_id AND r.operation_id = ?
          ) AND (${eligible.sql})
          ON CONFLICT (account_id, context_id, operation_id) DO NOTHING`,
    params: [...prefixParams, operationId, inputHash, command, pending, ctx.now, ...authorize.params ?? [], operationId, ...eligible.params ?? []],
  }, ...mutations];
  if (changes) statements.push(recordSyncChanges(guard, changes));
  const effectIndex = effects ? statements.push(recordEffectIntents(guard, effects)) - 1 : -1;
  const finalizeIndex = statements.push({
    sql: `UPDATE operation_receipts SET result_ref = ? WHERE ${pendingWhere} RETURNING result_ref`,
    params: [resultRef, pending],
  }) - 1;
  const replayIndex = statements.push({
    sql: `${prefix}
          SELECT scope.context_id IS NOT NULL AS authorized, r.result_ref, r.input_hash = ? AND r.command = ? AS matches_input,
                 CASE WHEN scope.context_id IS NOT NULL AND r.operation_id IS NULL
                      THEN (${unchanged?.sql ?? "0"}) ELSE 0 END AS unchanged
          FROM acting_session s LEFT JOIN (SELECT scope.* FROM ${scopeName} scope WHERE (${authorize.sql})) scope
            ON scope.account_id = s.account_id
          LEFT JOIN operation_receipts r
            ON r.account_id = scope.account_id AND r.context_id = scope.context_id AND r.operation_id = ?`,
    params: [...prefixParams, inputHash, command, ...unchanged?.params ?? [], ...authorize.params ?? [], operationId],
  }) - 1;

  return { statements, decode(results) {
    const finalized = results[finalizeIndex]?.results[0];
    if (finalized) {
      const workKeys = (results[effectIndex]?.results as { id: string }[] | undefined)?.map((row) => row.id) ?? [];
      return { outcome: { operationId, status: "committed", resultRef }, workKeys, topics };
    }
    const row = results[replayIndex]?.results[0] as StoredResult | undefined;
    let outcome: OpOutcome;
    if (!row) outcome = { operationId, status: "rejected", error: { code: "UNAUTHENTICATED" } };
    else if (!row.authorized) outcome = { operationId, status: "rejected", error: { code: "NOT_FOUND" } };
    else if (row.result_ref !== null) outcome = row.matches_input
      ? { operationId, status: "replayed", resultRef: row.result_ref }
      : { operationId, status: "rejected", error: { code: "OPERATION_ID_REUSED", current: { kind: "operation_id_reused" } } };
    else if (row.unchanged) outcome = { operationId, status: "unchanged" };
    else outcome = { operationId, status: "rejected", error: spec.ineligible ?? { code: "CONFLICT" } };
    return { outcome, workKeys: [], topics: [] };
  } };
}
