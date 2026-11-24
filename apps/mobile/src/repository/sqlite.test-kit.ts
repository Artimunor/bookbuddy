/// <reference types="bun" />
import { cursorSchema, scopeHeaderSchema } from "@bookbuddy/api-contract";
import type { SyncPage, SyncProjection } from "@bookbuddy/api-contract";
import { Database } from "bun:sqlite";
import { MobileRepository } from "./repository";
import { createSqliteExecutor } from "./sqlite";

export const context = scopeHeaderSchema.parse({ contextId: "context-test", role: "customer", businessId: null });
export const accountId = "account-test";

export async function testRepository() {
  const database = new Database(":memory:");
  const sql = await createSqliteExecutor({
    exec: async (statement) => { database.exec(statement); },
    run: async (statement, values) => { database.query(statement).run(...values); },
    all: async <Row>(statement: string, values: (string | number | null)[]) => database.query<Row, typeof values>(statement).all(...values),
  });
  let id = 0;
  const clock = { now: 1_000 };
  const mobile = new MobileRepository(sql, () => `op-${++id}`, () => clock.now);
  return { database, repository: mobile.openScope({ accountId, contextId: context.contextId }), mobile, clock };
}

export function page(cursor: string, changes: Partial<SyncPage> = {}): SyncPage {
  return { mode: "delta", context, cursor: cursorSchema.parse(cursor), upserts: [], removals: [], outcomes: [], hasMore: false, ...changes };
}

export function notification(id: string, readAt: number | null): SyncProjection {
  return { kind: "notification", resourceId: id, value: { id, kind: "offer", createdAt: 789, readAt, linkToken: "do-not-cache", address: "do-not-cache" } };
}
