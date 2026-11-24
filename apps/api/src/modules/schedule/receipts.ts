import type { ErrorBody } from "@bookbuddy/api-contract";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { planOperation } from "../../db/operations";
import type { OperationResult, OperationSpec } from "../../db/operations";
import type { RequestScope } from "../../db/scope";
import { scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";

interface ReceiptRow { value: string | null; revision: number | null }
export interface ScheduleCommandResult { operation: OperationResult; value: string | null; error?: ErrorBody }

export async function scheduleReceipt(ctx: RequestScope, access: SessionAccess, spec: Omit<OperationSpec, "access">,
  projection: CommandStatement, revision: { sql: string; expected: number }): Promise<CommandInput<ScheduleCommandResult>> {
  const plan = await planOperation(ctx, { ...spec, access });
  const authorize = spec.authorize ?? { sql: "1" };
  const result = scopedStatement(access, `SELECT CASE WHEN r.operation_id IS NOT NULL
    ${spec.unchanged ? `OR (${spec.unchanged.sql})` : ""} THEN (${projection.sql}) END AS value,
    (${revision.sql}) AS revision
    FROM live_scope scope LEFT JOIN operation_receipts r ON r.account_id = scope.account_id AND r.context_id = scope.context_id
      AND r.operation_id = ? AND r.command = ? WHERE (${authorize.sql})`,
  ...spec.unchanged?.params ?? [], ...projection.params ?? [], spec.operationId, spec.command, ...authorize.params ?? []);
  const index = plan.statements.length;
  return { statements: [...plan.statements, result], decode(results) {
    const operation = plan.decode(results);
    const row = results[index]?.results[0] as ReceiptRow | undefined;
    if (operation.outcome.status !== "rejected") return { operation, value: row?.value ?? null };
    const error: ErrorBody = operation.outcome.error.code === "CONFLICT" && row?.revision != null && row.revision !== revision.expected
      ? { code: "STALE_REVISION", current: { kind: "revision", revision: row.revision } }
      : operation.outcome.error;
    return { operation, value: null, error };
  } };
}
