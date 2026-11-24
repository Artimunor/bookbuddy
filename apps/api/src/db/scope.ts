import { openDb } from "./d1";
import type { Db } from "./d1";

export interface RequestScope {
  readonly requestId: string;
  readonly now: number;
  readonly binding: D1Database;
  readonly db: Db;
}

// Explicit request data, not proof of authority. Commands guard live scope in their SQL.
export function openRequestScope(binding: D1Database, requestId: string, now = Date.now()): RequestScope {
  return { binding, requestId, now, db: openDb(binding) };
}
