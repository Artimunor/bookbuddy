import type { ErrorBody } from "@bookbuddy/api-contract";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { planOperation } from "../../db/operations";
import type { OperationResult, OperationSpec } from "../../db/operations";
import type { RequestScope } from "../../db/scope";
import { scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { routing } from "./policy";

export interface CommercialResult {
  value: string | null;
  operation: OperationResult;
  error?: ErrorBody;
}

type Projection = { value: string | null; revision: number | null };

export async function commercialReceipt(ctx: RequestScope, access: SessionAccess, spec: OperationSpec,
  projection: CommandStatement, expected?: number,
): Promise<CommandInput<CommercialResult>> {
  const operation = await planOperation(ctx, spec);
  const result = scopedStatement(access, `, ${routing} SELECT
    CASE WHEN receipt.operation_id IS NOT NULL AND receipt.command = ? THEN (${projection.sql}) END AS value,
    j.revision FROM commercial_actor scope CROSS JOIN commercial_job j LEFT JOIN operation_receipts receipt
      ON receipt.account_id = scope.account_id AND receipt.context_id = scope.context_id AND receipt.operation_id = ?`,
  spec.command, ...projection.params ?? [], spec.operationId);
  return { statements: [...operation.statements, result], decode(results) {
    const decoded = operation.decode(results);
    const row = results[operation.statements.length]?.results[0] as Projection | undefined;
    if (decoded.outcome.status === "rejected") {
      const original = decoded.outcome.error;
      const error: ErrorBody = original.code === "CONFLICT" && expected !== undefined && row?.revision != null && row.revision !== expected
        ? { code: "STALE_REVISION", current: { kind: "revision", revision: row.revision } } : original;
      return { operation: decoded, value: null, error };
    }
    return { operation: decoded, value: row?.value ?? null };
  } };
}

export const revisionGuard = "(? IS NULL OR j.revision = ?)";