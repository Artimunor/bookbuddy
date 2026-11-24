import type { ApiResult } from "@bookbuddy/api-client";
import { expect, test } from "bun:test";
import { CommandIntents, RemoteRead, RequestBook, commandSnapshot, requestKey, requestNotSent } from "./requests";

const success = (data: string): ApiResult<string> => ({ ok: true, data, meta: { requestId: "request", serverTime: 100 } });

test("a read shares one flight and reuses a fresh result until explicitly refreshed or stale", async () => {
  let now = 1_000;
  let calls = 0;
  const read = new RemoteRead<string>(() => now);
  const held = Promise.withResolvers<ApiResult<string>>();
  const send = async () => {
    calls++;
    return calls === 1 ? held.promise : success(`value-${calls}`);
  };
  const isOffline = () => false;
  const first = read.load(send, { isOffline });
  expect(read.getSnapshot().status).toBe("loading");
  expect(read.load(send, { isOffline })).toBe(first);
  held.resolve(success("first"));
  await first;
  await read.load(send, { isOffline });
  expect(calls).toBe(1);
  expect(read.getSnapshot()).toEqual({ status: "ready", data: "first", error: null });
  await read.load(send, { isOffline, refresh: true });
  expect(calls).toBe(2);
  now += 30_000;
  await read.load(send, { isOffline });
  expect(read.getSnapshot().data).toBe("value-3");
});

test("offline start and reconnect never make an implicit request", async () => {
  let offline = true;
  let calls = 0;
  const read = new RemoteRead<string>();
  const send = async () => { calls++; return success("connected"); };
  const isOffline = () => offline;
  await read.load(send, { isOffline });
  expect(read.getSnapshot()).toMatchObject({ status: "offline", data: null });
  offline = false;
  expect(calls).toBe(0);
  await read.load(send, { isOffline, refresh: true });
  expect(calls).toBe(1);
});

test("equivalent inputs share a root result only for the same route and active scope", () => {
  const book = new RequestBook(true);
  const guest = new RequestBook(false);
  const context = { isActive: true };
  const route = {};
  const first = requestKey({ query: { view: ["today", "whole"], id: "job" } })!;
  const second = requestKey({ query: { id: "job", view: ["today", "whole"] } })!;
  const other = requestKey({ query: { id: "job", view: ["whole", "today"] } })!;
  expect(book.read(context, route, first)).toBe(book.read(context, route, second));
  expect(book.read(context, route, first)).not.toBe(book.read(context, route, other));
  expect(book.read(context, route, first)).not.toBe(book.read(context, {}, first));
  expect(book.read(context, route, first)).not.toBe(book.read({ isActive: true }, route, first));
  expect(book.allows("context", context)).toBe(true);
  expect(guest.allows("context", context)).toBe(false);
  context.isActive = false;
  expect(book.allows("context", context)).toBe(false);
  book.active = false;
  expect(book.allows("session", null)).toBe(false);
});

test("same-intent retries keep their original ID and Checking survives a proven-unsent retry", async () => {
  let created = 0;
  const seen: string[] = [];
  const replies = Promise.withResolvers<ApiResult<string>>();
  const intents = new CommandIntents<string>();
  const newId = () => `op-${++created}`;
  const send = async (id: string) => { seen.push(id); return replies.promise; };
  const first = intents.run("same", newId, send);
  expect(intents.run("same", newId, send)).toBe(first);
  replies.resolve({ ok: false, error: { code: "NETWORK_ERROR", delivery: "unknown" } });
  expect(commandSnapshot(await first).state).toBe("checking");
  const unsent = await intents.run("same", newId, async () => requestNotSent);
  expect(commandSnapshot(unsent).state).toBe("checking");
  const retry = (id: string) => { seen.push(id); return Promise.resolve(success("confirmed")); };
  expect(commandSnapshot(await intents.run("same", newId, retry)).state).toBe("done");
  expect(commandSnapshot(await intents.run("same", newId, retry)).state).toBe("done");
  expect(seen).toEqual(["op-1", "op-1", "op-2"]);
  expect(commandSnapshot({ ok: false, error: { code: "STALE_REVISION" }, meta: { requestId: "request" } }).state).toBe("conflict");
});
