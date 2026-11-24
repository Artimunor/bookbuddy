import { appendChatPayloadSchema } from "@bookbuddy/api-contract";
import { syncOperation } from "../sync/registry";
import { invalidSyncAppend, planChatAppend, planChatReadMark } from "./commands";

export const chatAppendSyncOperation = syncOperation("chat_append", async (ctx, operation) => {
  const { threadId, ...entry } = operation.payload;
  const parsed = appendChatPayloadSchema.safeParse(entry);
  if (!parsed.success) return invalidSyncAppend(operation.operationId);
  return planChatAppend(ctx, ctx.access, threadId, { ...operation, payload: parsed.data }, ctx.translationPairs ?? []);
});

export const chatReadSyncOperation = syncOperation("chat_read_mark", (ctx, operation) =>
  planChatReadMark(ctx, ctx.access, operation.payload.threadId, operation));
