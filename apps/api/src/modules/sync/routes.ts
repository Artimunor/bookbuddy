import { syncRoute } from "@bookbuddy/api-contract";
import type { OpOutcome, SyncPage } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { ApiEnv } from "../../bindings";
import { prepareCommand } from "../../db/commit";
import type { CommandInput } from "../../db/commit";
import type { OperationResult } from "../../db/operations";
import { openRequestScope } from "../../db/scope";
import { enabledTranslationPairs } from "../../providers/translate";
import { withCaseSteward } from "../aftercare/case-policy";
import { resolveSession } from "../auth/session";
import { notificationReadSyncOperation } from "../notifications/commands";
import { notificationSyncProjection } from "../notifications/read";
import { notificationRoutes } from "../notifications/routes";
import { createCursorCodec } from "./cursor";
import { boundedBody, scheduleOperationSignals, transportFailure, transportSuccess } from "./http";
import { decodeFeed, syncFeed } from "./read";
import { createSyncRegistry } from "./registry";
import type { SyncOperationHandler, SyncProjectionReader } from "./registry";

// D1 counts the whole batch as one invocation query. Bound the app's work
// independently so eight valid operations can still share one atomic batch.
const statementBudget = 128;

export function createTransportRoutes({ operations = [], projections = [] }: {
  operations?: readonly SyncOperationHandler[];
  projections?: readonly SyncProjectionReader[];
} = {}) {
  const registry = createSyncRegistry([notificationReadSyncOperation, ...operations], [notificationSyncProjection, ...projections]);
  const routes = new Hono<ApiEnv>();
  routes.route("/", notificationRoutes);
  routes.post(syncRoute.path, async (c) => {
    const parsed = syncRoute.input.safeParse({ body: await boundedBody(c.req.raw) });
    if (!parsed.success) return transportFailure(c, "VALIDATION_FAILED");
    const { contextId, operations, cursor: token } = parsed.data.body;
    const ctx = openRequestScope(c.env.DB, c.var.requestId);
    const secret = c.env.SYNC_CURSOR_HMAC_KEY;
    if (!secret || secret.length < 32) return transportFailure(c, "UNAVAILABLE");
    const codec = await createCursorCodec(secret);
    const cursor = token === null ? null : await codec.read(token);
    if (token !== null && !cursor) return transportFailure(c, "VALIDATION_FAILED");
    if (cursor && cursor.context.contextId !== contextId) return transportFailure(c, "NOT_FOUND");
    const access = await resolveSession(c.req.raw, contextId, ctx.now, cursor?.accountId);
    if (!access) return transportFailure(c, "UNAUTHENTICATED");
    const translationPairs = operations.some(({ kind }) => kind === "chat_append") ? enabledTranslationPairs(c.env) : [];

    const plans: (CommandInput<OperationResult> | null)[] = await Promise.all(operations.map((operation) => {
      const handler = registry.operations.get(operation.kind);
      return handler ? handler.plan({ now: ctx.now, requestId: ctx.requestId, access, contextId, translationPairs }, operation) : null;
    }));
    const feed = syncFeed(withCaseSteward(access, c.env.CASE_STEWARD_ACCOUNT_ID), cursor, ctx.now, registry);
    const count = plans.reduce((sum, plan) => sum + (plan?.statements.length ?? 0), feed.length);
    if (count > statementBudget) return transportFailure(c, "VALIDATION_FAILED");
    const prepared = plans.map((plan) => plan === null ? null : prepareCommand(ctx, plan));
    const projections = feed.map(({ sql, params }) => ctx.binding.prepare(sql).bind(...params ?? []));
    const batch = await ctx.binding.batch([...prepared.flatMap((plan) => plan?.statements ?? []), ...projections]);
    const page = decodeFeed(batch.slice(-feed.length), cursor, registry);
    if (typeof page === "string") return transportFailure(c, page);

    const outcomes: OpOutcome[] = [], results: OperationResult[] = [];
    let offset = 0;
    for (const [index, operation] of operations.entries()) {
      const plan = prepared[index];
      if (plan) {
        const end = offset + plan.statements.length;
        const result = plan.decode(batch.slice(offset, end));
        outcomes.push(result.outcome);
        results.push(result);
        offset = end;
      } else {
        outcomes.push({ operationId: operation.operationId, status: "rejected", error: { code: "UNAVAILABLE" } });
      }
    }
    scheduleOperationSignals(c, results);
    const { accountId, epoch, nextExpiry, position, ...content } = page;
    const response: SyncPage = { ...content, outcomes,
      cursor: await codec.issue({ accountId, epoch, nextExpiry, context: page.context }, position, ctx.now) };
    return transportSuccess(c, response, ctx.now);
  });
  return routes;
}

export const transportRoutes = createTransportRoutes();
