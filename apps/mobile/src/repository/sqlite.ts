import { serialize } from "./executor";
import type { Executor, Rows, SqlValue } from "./executor";
import { schema } from "./schema";

export interface SqliteConnection {
  exec(sql: string): Promise<void>;
  run(sql: string, values: SqlValue[]): Promise<void>;
  all<Row>(sql: string, values: SqlValue[]): Promise<Row[]>;
}

function predicate<Row>(where: Partial<Row>, bindings: SqlValue[]): string {
  const conditions = Object.entries(where).map(([column, condition]) => {
    if (condition === null) return `${column} IS NULL`;
    if (typeof condition === "object") {
      const { op, value } = condition as { op: ">" | "<=" | "in" | "prefix"; value: SqlValue | SqlValue[] };
      if (op === "in") {
        const values = value as SqlValue[];
        if (values.length === 0) return "0";
        bindings.push(...values);
        return `${column} IN (${values.map(() => "?").join(", ")})`;
      }
      if (op === "prefix") {
        bindings.push(value as string, value as string);
        return `substr(${column}, 1, length(?)) = ?`;
      }
      bindings.push(value as SqlValue);
      return `${column} ${op} ?`;
    }
    bindings.push(condition as SqlValue);
    return `${column} = ?`;
  });
  return conditions.join(" AND ") || "1";
}

export async function createSqliteExecutor(connection: SqliteConnection): Promise<Executor> {
  await connection.exec(schema);
  const rows: Rows = {
    select(table, where, { order, limit } = {}) {
      const bindings: SqlValue[] = [];
      const filter = predicate(where, bindings);
      if (limit !== undefined) bindings.push(limit);
      return connection.all(`SELECT * FROM ${table.name} WHERE ${filter}${order ? ` ORDER BY ${order.join(", ")}` : ""}${limit !== undefined ? " LIMIT ?" : ""}`, bindings);
    },
    async count(table, where) {
      const values: SqlValue[] = [];
      const [row] = await connection.all<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table.name} WHERE ${predicate(where, values)}`, values);
      return row?.count ?? 0;
    },
    put(table, row) {
      const columns = Object.keys(row);
      const update = columns.filter((key) => !table.key.some((part) => key === part));
      return connection.run(`INSERT INTO ${table.name} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})
        ON CONFLICT (${table.key.join(", ")}) DO UPDATE SET ${update.map((key) => `${key} = excluded.${key}`).join(", ")}`,
      Object.values(row) as SqlValue[]);
    },
    update(table, where, patch) {
      const values = Object.values(patch) as SqlValue[];
      const filter = predicate(where, values);
      return connection.run(`UPDATE ${table.name} SET ${Object.keys(patch).map((column) => `${column} = ?`).join(", ")} WHERE ${filter}`, values);
    },
    remove(table, where) {
      const values: SqlValue[] = [];
      return connection.run(`DELETE FROM ${table.name} WHERE ${predicate(where, values)}`, values);
    },
  };
  const schedule = serialize();
  return {
    read: (work) => schedule(() => work(rows)),
    transaction: (work) => schedule(async () => {
      await connection.exec("BEGIN IMMEDIATE");
      try {
        const result = await work(rows);
        await connection.exec("COMMIT");
        return result;
      } catch (error) {
        await connection.exec("ROLLBACK");
        throw error;
      }
    }),
  };
}
