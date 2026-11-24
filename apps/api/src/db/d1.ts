import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

export type Db = DrizzleD1Database;

export function openDb(binding: D1Database): Db {
  return drizzle(binding);
}
