import type { ActiveContext } from "@bookbuddy/api-contract";
import type { Executor, Rows } from "./executor";
import { projection, syncState } from "./schema";

export type CachePolicy = "memory" | "persistent";
export function cachePolicy(role: ActiveContext["role"] | undefined, persistentAuthoring: boolean): CachePolicy {
  return persistentAuthoring && (role === "worker" || role === "foreman" || role === "provider_admin") ? "persistent" : "memory";
}

const cached = (table: { name: string }) => table.name === projection.name || table.name === syncState.name;
type ReadRows = Pick<Rows, "select" | "count">;
function cacheReads(authored: ReadRows, volatile: ReadRows): ReadRows {
  return {
    select: (table, where, options) => (cached(table) ? volatile : authored).select(table, where, options),
    count: (table, where) => (cached(table) ? volatile : authored).count(table, where),
  };
}

/** Customer job snapshots and their sync cursor never enter the authored store. */
export function withVolatileCache(authored: Executor, cache: Executor): Executor {
  return {
    read: (work) => cache.read((volatile) => authored.read((rows) => work(cacheReads(rows, volatile)))),
    // Publish the volatile snapshot only after the durable transaction commits.
    transaction: (work) => cache.transaction((volatile) => authored.transaction((rows) => work({
      ...cacheReads(rows, volatile),
      put: (table, row) => (cached(table) ? volatile : rows).put(table, row),
      update: (table, where, patch) => (cached(table) ? volatile : rows).update(table, where, patch),
      remove: (table, where) => (cached(table) ? volatile : rows).remove(table, where),
    }))),
  };
}
