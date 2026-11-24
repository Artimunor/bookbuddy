import { serialize } from "./executor";
import type { Executor, Rows, Select, SqlValue, Table, Where } from "./executor";

type RecordRow = Record<string, SqlValue>;
type Store = Map<string, Map<string, RecordRow>>;

function compare(a: SqlValue, b: SqlValue) {
  return a === b ? 0 : a === null || (b !== null && a < b) ? -1 : 1;
}

function matches(row: RecordRow, where: object) {
  return Object.entries(where).every(([column, condition]) => {
    const value = row[column] ?? null;
    if (condition === null || typeof condition !== "object") return value === condition;
    if (condition.op === "in") return value !== null && condition.value.includes(value);
    if (condition.op === "prefix") return typeof value === "string" && value.startsWith(condition.value);
    if (value === null || condition.value === null) return false;
    return condition.op === ">" ? compare(value, condition.value) > 0 : compare(value, condition.value) <= 0;
  });
}

function memoryRows(store: Store): Rows {
  function tableRows(name: string) {
    let rows = store.get(name);
    if (!rows) store.set(name, rows = new Map());
    return rows;
  }
  return {
    async select<Row extends Record<keyof Row, SqlValue>>(table: Table<Row>, where: Where<NoInfer<Row>>, { order, limit }: Select<NoInfer<Row>> = {}) {
      const found = [...tableRows(table.name).values()].filter((row) => matches(row, where));
      if (order) found.sort((a, b) => {
        for (const column of order) {
          const delta = compare(a[column] ?? null, b[column] ?? null);
          if (delta) return delta;
        }
        return 0;
      });
      return (limit === undefined ? found : found.slice(0, limit)).map((row) => ({ ...row }) as Row);
    },
    async count(table, where) {
      let total = 0;
      for (const row of tableRows(table.name).values()) if (matches(row, where)) total++;
      return total;
    },
    async put(table, row) {
      const record = row as RecordRow;
      tableRows(table.name).set(JSON.stringify(table.key.map((column) => record[column])), { ...record });
    },
    async update(table, where, patch) {
      const rows = tableRows(table.name);
      for (const [key, row] of rows) if (matches(row, where)) rows.set(key, { ...row, ...patch });
    },
    async remove(table, where) {
      const rows = tableRows(table.name);
      for (const [key, row] of rows) if (matches(row, where)) rows.delete(key);
    },
  };
}

export function createMemoryExecutor(): Executor {
  const schedule = serialize();
  let store: Store = new Map();
  return {
    read: (work) => schedule(() => work(memoryRows(store))),
    transaction: (work) => schedule(async () => {
      const next: Store = new Map([...store].map(([table, rows]) => [table, new Map(rows)]));
      const result = await work(memoryRows(next));
      store = next;
      return result;
    }),
  };
}
