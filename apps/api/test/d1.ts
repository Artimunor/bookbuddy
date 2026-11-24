import { Database } from "bun:sqlite";
import type { SQLQueryBindings } from "bun:sqlite";
import { Buffer } from "node:buffer";
import { readdir } from "node:fs/promises";

export interface D1CallCounts {
  prepare: number;
  batch: number;
  query: number;
}

// SQLite's local defaults are looser than deployed D1. Each db.batch item is
// still subject to these limits: https://developers.cloudflare.com/d1/platform/limits/
const tokens = /--[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|[$A-Za-z0-9_\u0080-\uffff]+|[();]/g;

function d1Limit(message: string, sql: string, offset = 0): never {
  const error = new RangeError(`D1 statement ${message}: ${sql.slice(Math.max(0, offset - 80), offset + 160).trim()}`);
  // Route error envelopes may hide the originating SQL from a test failure.
  console.error(error.message);
  throw error;
}

function checkStatement(sql: string) {
  if (Buffer.byteLength(sql, "utf8") > 100_000) d1Limit("exceeds 100 KB", sql);
  // Parenthesized subqueries and CTEs have separate compound SELECT counts.
  const terms = [1];
  for (const match of sql.matchAll(tokens)) {
    switch (match[0].toUpperCase()) {
      case "(": terms.push(1); break;
      case ")": if (terms.length > 1) terms.pop(); break;
      case ";": terms[terms.length - 1] = 1; break;
      case "UNION":
      case "INTERSECT":
      case "EXCEPT": {
        const depth = terms.length - 1;
        const count = (terms[depth] ?? 1) + 1;
        if (count > 5) d1Limit("exceeds five compound SELECT terms", sql, match.index);
        terms[depth] = count;
        break;
      }
    }
  }
}

function toSqlite(value: unknown): SQLQueryBindings {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return Number(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return Uint8Array.from(value);
  }
  throw new TypeError("Unsupported D1 bind value");
}

function fromSqlite(value: unknown): unknown {
  return value instanceof Uint8Array ? Array.from(value) : value;
}

class SqliteStatement implements D1PreparedStatement {
  constructor(readonly owner: TestD1, readonly sql: string, readonly params: SQLQueryBindings[] = []) {}

  bind(...values: unknown[]): D1PreparedStatement {
    if (values.length > 100) d1Limit(`has ${values.length} bound parameters (max 100)`, this.sql);
    return new SqliteStatement(this.owner, this.sql, values.map(toSqlite));
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    this.owner.calls.query++;
    const row = this.owner.compile(this.sql).get(...this.params);
    if (!row) return null;
    if (colName !== undefined) {
      if (!Object.hasOwn(row, colName)) throw new Error(`D1 column not found: ${colName}`);
      return fromSqlite(row[colName]) as T;
    }
    for (const column of Object.keys(row)) row[column] = fromSqlite(row[column]);
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    this.owner.calls.query++;
    return this.owner.execute<T>(this);
  }

  run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.all<T>();
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    this.owner.calls.query++;
    const statement = this.owner.compile(this.sql);
    const rows = statement.values(...this.params).map((row) => row.map(fromSqlite)) as T[];
    return options?.columnNames ? [statement.columnNames, ...rows] : rows;
  }
}

export class TestD1 implements D1Database {
  readonly calls: D1CallCounts = { prepare: 0, batch: 0, query: 0 };

  constructor(private readonly sqlite: Database) {}

  prepare(sql: string): D1PreparedStatement {
    checkStatement(sql);
    this.calls.prepare++;
    return new SqliteStatement(this, sql);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.calls.batch++;
    return this.sqlite.transaction(() => statements.map((statement) => {
      if (!(statement instanceof SqliteStatement) || statement.owner !== this) {
        throw new TypeError("D1 batch statement belongs to a different binding");
      }
      return this.execute<T>(statement);
    }))();
  }

  compile(sql: string) {
    return this.sqlite.query<Record<string, unknown>, SQLQueryBindings[]>(sql);
  }

  execute<T>(statement: SqliteStatement): D1Result<T> {
    const getMeta = this.sqlite.query<{ totalChanges: number; lastRowId: number }, []>(
      "SELECT total_changes() AS totalChanges, last_insert_rowid() AS lastRowId",
    );
    const before = getMeta.get()!;
    const started = performance.now();
    const rows = this.compile(statement.sql).all(...statement.params);
    for (const row of rows) {
      for (const column of Object.keys(row)) row[column] = fromSqlite(row[column]);
    }
    const after = getMeta.get()!;
    const changes = after.totalChanges - before.totalChanges;
    return {
      success: true,
      results: rows as T[],
      meta: {
        duration: performance.now() - started,
        last_row_id: after.lastRowId,
        changes,
        changed_db: changes > 0 || after.lastRowId !== before.lastRowId,
        // SQLite does not expose workerd's billing metrics here.
        rows_read: rows.length,
        rows_written: changes,
        size_after: 0,
      },
    };
  }

  async exec(): Promise<D1ExecResult> {
    throw new Error("Tests use prepared statements; D1 exec is not emulated");
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error("D1 dump is not emulated");
  }

  withSession(): D1DatabaseSession {
    throw new Error("D1 replica sessions are not emulated");
  }

  close(): void {
    this.sqlite.close();
  }
}

export async function createTestD1(migrations = new URL("../migrations/", import.meta.url)): Promise<TestD1> {
  const sqlite = new Database(":memory:", { strict: true });
  try {
    sqlite.run("PRAGMA foreign_keys = ON");
    const files = await readdir(migrations, { withFileTypes: true });
    const names = files.filter((file) => file.isFile() && file.name.endsWith(".sql")).map((file) => file.name).sort();
    for (const name of names) {
      const sql = await Bun.file(new URL(name, migrations)).text();
      sqlite.transaction(() => sqlite.run(sql))();
    }
    return new TestD1(sqlite);
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
