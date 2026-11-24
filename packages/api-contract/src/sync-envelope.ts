import { z } from "zod";
import { contextIdSchema, cursorSchema, scopeHeaderSchema } from "./common";

export const syncLimits = {
  operations: 8,
  changes: 100,
  requestBytes: 256 * 1024,
} as const;

// The sync module passes only its allowed operation schemas, never ordinary commands wholesale.
export function syncRequestSchema<Operation extends z.ZodType>(operation: Operation) {
  return z.object({
    contextId: contextIdSchema,
    cursor: cursorSchema.nullable(),
    operations: z.array(operation).max(syncLimits.operations),
  });
}

export function syncPageSchema<
  Outcome extends z.ZodType,
  Projection extends z.ZodType,
  Removal extends z.ZodType,
>({ outcome, projection, removal }: { outcome: Outcome; projection: Projection; removal: Removal }) {
  return z.object({
    mode: z.enum(["delta", "snapshot", "reset"]),
    context: scopeHeaderSchema,
    outcomes: z.array(outcome).max(syncLimits.operations),
    upserts: z.array(projection).max(syncLimits.changes),
    removals: z.array(removal).max(syncLimits.changes),
    cursor: cursorSchema,
    hasMore: z.boolean(),
  }).refine((page) => page.upserts.length + page.removals.length <= syncLimits.changes);
}
