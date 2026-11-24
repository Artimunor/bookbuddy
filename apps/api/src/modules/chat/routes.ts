import {
  appendThreadEntriesRoute, getThreadEntriesRoute, getThreadRoute, listThreadsRoute, markThreadReadRoute, operationIdHeader,
  reportTranslationRoute, requestTranslationRoute, syncLimits,
} from "@bookbuddy/api-contract";
import type { ChatAppendOutcome, ResponseSchema } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { ApiEnv } from "../../bindings";
import { commitCommand, prepareCommand } from "../../db/commit";
import type { CommandInput, CommandStatement } from "../../db/commit";
import type { OperationResult } from "../../db/operations";
import { openRequestScope } from "../../db/scope";
import type { RequestScope } from "../../db/scope";
import { enabledTranslationPairs } from "../../providers/translate";
import type { LanguagePair } from "../../providers/translate";
import { resolveSession } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { boundedBody, scheduleOperationSignals, transportFailure, transportSuccess } from "../sync/http";
import {
  appendReceipts, planChatAppend, planChatReadMark, planTranslationReport, planTranslationRetry, readMarkResult, withChatValue,
} from "./commands";
import type { CommandValue } from "./commands";
import { chatScope, ensureChatMember, ensureInboxThreads, inboxThreadScope } from "./policy";
import { entryCursor, inboxCursor, readThread, readThreadEntries, readThreadList } from "./read";
import { isSessionThread } from "./session";

export const chatRoutes = new Hono<ApiEnv>();
type ValueRow = { value: string | null };
type Definition<Input> = {
  path: string;
  input: { safeParse(value: unknown): { success: true; data: Input } | { success: false } };
  output: ResponseSchema;
};

chatRoutes.get(listThreadsRoute.path, async (c) => {
  const parsed = listThreadsRoute.input.safeParse({ query: c.req.query() });
  const after = parsed.success && inboxCursor(parsed.data.query?.cursor);
  if (!after) return transportFailure(c, "VALIDATION_FAILED");
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const session = await resolveSession(c.req.raw, null, ctx.now);
  if (!session) return transportFailure(c, "UNAUTHENTICATED");
  const scoped = inboxThreadScope(session, ctx.now, after);
  const statements = [ensureInboxThreads(session, ctx.now, after), ensureChatMember(scoped, {
    sql: `id IN (SELECT id FROM chat_scope ORDER BY coalesce(job_id, session_booking_id), audience LIMIT ${syncLimits.changes})`,
  }), readThreadList(session, ctx.now, after, enabledTranslationPairs(c.env))];
  const [, , page] = await ctx.binding.batch<ValueRow>(statements.map(({ sql, params }) => ctx.binding.prepare(sql).bind(...params ?? [])));
  const row = page?.results[0];
  if (!row) return transportFailure(c, "UNAUTHENTICATED");
  if (row.value === null) return transportFailure(c, "NOT_FOUND");
  return transportSuccess(c, listThreadsRoute.output.parse(JSON.parse(row.value)), ctx.now);
});

function get<Input extends { params: { id: string } }>(route: Definition<Input>, plan: (session: SessionAccess, now: number, input: Input,
  pairs: readonly LanguagePair[]) => CommandStatement | null) {
  chatRoutes.get(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), ...(route.path === getThreadEntriesRoute.path ? { query: c.req.query() } : {}) });
    if (!input.success) return transportFailure(c, "VALIDATION_FAILED");
    const ctx = openRequestScope(c.env.DB, c.var.requestId);
    const session = await resolveSession(c.req.raw, null, ctx.now);
    if (!session) return transportFailure(c, "UNAUTHENTICATED");
    const statement = plan(session, ctx.now, input.data, enabledTranslationPairs(c.env));
    if (!statement) return transportFailure(c, "VALIDATION_FAILED");
    const row = await ctx.binding.prepare(statement.sql).bind(...statement.params ?? []).first<ValueRow>();
    if (!row) return transportFailure(c, "UNAUTHENTICATED");
    if (row.value === null) return transportFailure(c, "NOT_FOUND");
    return transportSuccess(c, route.output.parse(JSON.parse(row.value)), ctx.now);
  });
}

get(getThreadRoute, (session, now, { params }) => readThread(session, now, params.id));
get(getThreadEntriesRoute, (session, now, { params, query }, pairs) => {
  const cursor = entryCursor(query?.cursor);
  return cursor === undefined ? null : readThreadEntries(session, now, params.id, cursor, pairs);
});

chatRoutes.post(appendThreadEntriesRoute.path, async (c) => {
  const parsed = appendThreadEntriesRoute.input.safeParse({ params: c.req.param(), body: await boundedBody(c.req.raw) });
  if (!parsed.success) return transportFailure(c, "VALIDATION_FAILED");
  const { params: { id }, body: { operations } } = parsed.data;
  const ctx = openRequestScope(c.env.DB, c.var.requestId);
  const session = await resolveSession(c.req.raw, null, ctx.now);
  if (!session) return transportFailure(c, "UNAUTHENTICATED");
  const pairs = enabledTranslationPairs(c.env);
  const plans = (await Promise.all(operations.map((input) => planChatAppend(ctx, session, id, input, pairs))))
    .map((plan) => prepareCommand(ctx, plan));
  const receiptQuery = appendReceipts(session, ctx.now, id, operations.map(({ payload }) => payload.id));
  const results = await ctx.binding.batch([
    ...plans.flatMap(({ statements }) => statements), ctx.binding.prepare(receiptQuery.sql).bind(...receiptQuery.params ?? []),
  ]);
  type Receipt = Extract<ChatAppendOutcome, { status: "committed" | "replayed" }>["receipt"];
  const receipts = new Map((results.at(-1)?.results as { id: string; value: string }[] ?? [])
    .map(({ id: key, value }) => [key, JSON.parse(value) as Receipt]));
  let offset = 0;
  const signals: OperationResult[] = [];
  const outcomes = plans.map((plan): ChatAppendOutcome => {
    const end = offset + plan.statements.length;
    const result = plan.decode(results.slice(offset, end));
    offset = end;
    signals.push(result);
    const outcome = result.outcome;
    if (outcome.status === "rejected") return outcome;
    if (outcome.status !== "unchanged") {
      const receipt = receipts.get(outcome.resultRef);
      if (receipt) return { operationId: outcome.operationId, status: outcome.status, receipt };
    }
    return { operationId: outcome.operationId, status: "rejected", error: { code: "NOT_FOUND" } };
  });
  if (outcomes.every((outcome) => outcome.status === "rejected" && outcome.error.code === "UNAUTHENTICATED")) {
    return transportFailure(c, "UNAUTHENTICATED");
  }
  if (isSessionThread(id) && outcomes.every((outcome) => outcome.status === "rejected" && outcome.error.code === "NOT_FOUND")) {
    return transportFailure(c, "NOT_FOUND");
  }
  scheduleOperationSignals(c, signals);
  return transportSuccess(c, appendThreadEntriesRoute.output.parse({ outcomes }), ctx.now);
});

function command<Input extends { body: { operationId: string } }>(route: Definition<Input>, plan: (
  ctx: RequestScope, session: SessionAccess, input: Input, pairs: readonly LanguagePair[],
) => Promise<CommandInput<CommandValue>>) {
  chatRoutes.post(route.path, async (c) => {
    const input = route.input.safeParse({ params: c.req.param(), body: await boundedBody(c.req.raw) });
    if (!input.success || input.data.body.operationId !== c.req.header(operationIdHeader)) return transportFailure(c, "VALIDATION_FAILED");
    const ctx = openRequestScope(c.env.DB, c.var.requestId);
    const session = await resolveSession(c.req.raw, null, ctx.now);
    if (!session) return transportFailure(c, "UNAUTHENTICATED");
    const result = await commitCommand(ctx, prepareCommand(ctx, await plan(ctx, session, input.data, enabledTranslationPairs(c.env))));
    if (result.error) return transportFailure(c, result.error);
    if (result.value === null) return transportFailure(c, "NOT_FOUND");
    scheduleOperationSignals(c, [result.operation]);
    return transportSuccess(c, route.output.parse(JSON.parse(result.value)), ctx.now);
  });
}

command(markThreadReadRoute, async (ctx, session, { params, body }) => withChatValue(
  await planChatReadMark(ctx, session, params.id, body), readMarkResult(session, ctx.now, params.id)));
command(reportTranslationRoute, (ctx, session, { params, body }) => planTranslationReport(ctx, session, params.id, body));
command(requestTranslationRoute, (ctx, session, { params, body }, pairs) => planTranslationRetry(ctx, session, params.id, body, pairs));
