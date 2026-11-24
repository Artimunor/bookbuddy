import { expect, test } from "bun:test";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createApp } from "../src/app";
import { API_BASE_PATH } from "../src/config";
import { commitCommand, prepareCommand } from "../src/db/commit";
import { openRequestScope } from "../src/db/scope";
import { createTestD1 } from "./d1";

const fixtures = new URL("./fixtures/", import.meta.url);
const entries = sqliteTable("fixture_entries", {
  id: integer().primaryKey(),
  label: text().notNull(),
});

test("applies ordered fixtures and counts one bound command batch through Hono", async () => {
  const DB = await createTestD1(fixtures);
  try {
    const app = createApp();
    app.post(`${API_BASE_PATH}/fixture`, async (c) => {
      const ctx = openRequestScope(c.env.DB, c.var.requestId);
      const label = await c.req.text();
      const command = prepareCommand(ctx, {
        statements: [
          { sql: "INSERT INTO fixture_entries(parent_id, label) VALUES (?, ?) RETURNING id", params: ["parent", label] },
          { sql: "SELECT label FROM fixture_entries ORDER BY id" },
        ],
        decode: (results) => ({ changes: results[0]?.meta.changes, rows: results[1]?.results }),
      });
      return c.json(await commitCommand(ctx, command));
    });
    app.get(`${API_BASE_PATH}/fixture`, async (c) => {
      const { db } = openRequestScope(c.env.DB, c.var.requestId);
      return c.json(await db.select().from(entries).orderBy(entries.id));
    });

    const label = "value with 'quotes'";
    const command = await app.request(`${API_BASE_PATH}/fixture`, { method: "POST", body: label }, { DB });
    expect(command.status).toBe(200);
    expect(await command.json()).toEqual({ changes: 1, rows: [{ label: "seed" }, { label }] });
    expect(DB.calls).toEqual({ prepare: 2, batch: 1, query: 0 });

    const read = await app.request(`${API_BASE_PATH}/fixture`, {}, { DB });
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual([{ id: 1, label: "seed" }, { id: 2, label }]);
    expect(DB.calls).toEqual({ prepare: 3, batch: 1, query: 1 });
  } finally {
    DB.close();
  }
});

test("rolls back the entire counted batch on a foreign key violation", async () => {
  const DB = await createTestD1(fixtures);
  try {
    const insert = DB.prepare("INSERT INTO fixture_entries(parent_id, label) VALUES (?, ?)");
    await expect(DB.batch([insert.bind("parent", "valid"), insert.bind("other", "invalid")]))
      .rejects.toThrow(/foreign key/i);
    expect(await DB.prepare("SELECT label FROM fixture_entries").first<string>("label")).toBe("seed");
    expect(await DB.prepare("SELECT id, label FROM fixture_entries").raw({ columnNames: true }))
      .toEqual([["id", "label"], [1, "seed"]]);
    expect(DB.calls).toEqual({ prepare: 3, batch: 1, query: 2 });
  } finally {
    DB.close();
  }
});

test("returns private, request-correlated error envelopes without leaking errors", async () => {
  const app = createApp();
  app.get(`${API_BASE_PATH}/throws`, () => { throw new Error("private details"); });

  for (const [path, status, code] of [
    ["missing", 404, "NOT_FOUND"],
    ["throws", 500, "INTERNAL_ERROR"],
  ] as const) {
    const response = await app.request(`${API_BASE_PATH}/${path}`, { headers: { "X-Request-Id": "untrusted" } });
    const requestId = response.headers.get("X-Request-Id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: false, error: { code }, meta: { requestId } });
  }
});
