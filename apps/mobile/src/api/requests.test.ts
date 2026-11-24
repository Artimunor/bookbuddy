import type { ApiResult } from "@bookbuddy/api-client";
import { approveQuoteVersionRoute, declineQuoteVersionRoute, notificationsRoute } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { accountId, context, testRepository } from "../repository/sqlite.test-kit";
import { RemoteRead, RequestBook, commandIntentForRequest, commandIntentKey, commandSnapshot, initialReadConnection, observeReadConnection, remoteRequestKey, requestKey, requestNotSent } from "./requests";

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
  const getConnection = () => initialReadConnection;
  const first = read.load(send, { getConnection });
  expect(read.getSnapshot(getConnection()).status).toBe("loading");
  expect(read.load(send, { getConnection })).toBe(first);
  held.resolve(success("first"));
  await first;
  await read.load(send, { getConnection });
  expect(calls).toBe(1);
  expect(read.getSnapshot(getConnection())).toEqual({ status: "ready", data: "first", error: null, lastConfirmedAt: 100 });
  await read.load(send, { getConnection, refresh: true });
  expect(calls).toBe(2);
  now += 30_000;
  await read.load(send, { getConnection });
  expect(read.getSnapshot(getConnection()).data).toBe("value-3");
});

test("a fast disconnect and reconnect hides a fresh ready result without requesting again", async () => {
  let connection = initialReadConnection;
  let calls = 0;
  const read = new RemoteRead<string>();
  const send = async () => success(`value-${++calls}`);
  const getConnection = () => connection;
  await read.load(send, { getConnection });
  connection = observeReadConnection(connection, { isConnected: false });
  expect(read.getSnapshot(connection)).toMatchObject({ status: "offline", data: null });
  connection = observeReadConnection(connection, { isConnected: true });
  expect(read.getSnapshot(connection)).toMatchObject({ status: "error", data: null });
  expect(calls).toBe(1);
  await read.load(send, { getConnection, refresh: true });
  expect(read.getSnapshot(connection)).toMatchObject({ status: "ready", data: "value-2" });
});

test("an old grant response cannot overwrite a new flight after disconnect or visibility change", async () => {
  let connection = initialReadConnection;
  let visibility = 2;
  const read = new RemoteRead<string>();
  const stale = Promise.withResolvers<ApiResult<string>>();
  const announced = Promise.withResolvers<void>();
  const getConnection = () => ({ ...connection, visibility });
  const first = read.load(() => { announced.resolve(); return stale.promise; }, { getConnection });
  await announced.promise;
  connection = observeReadConnection(connection, { isInternetReachable: false });
  connection = observeReadConnection(connection, { isInternetReachable: true });
  await read.load(() => Promise.resolve(success("new grant")), { getConnection, refresh: true });
  stale.resolve(success("old private projection"));
  await first;
  expect(read.getSnapshot(getConnection()).data).toBe("new grant");
  visibility++;
  expect(read.getSnapshot(getConnection())).toMatchObject({ status: "error", data: null });
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

test("a typed seed warms the destination read only for the same live scope, without a GET", async () => {
  const book = new RequestBook(true);
  const scope = { isActive: true };
  const other = { isActive: true };
  const route = notificationsRoute;
  const input = { query: { contextId: context.contextId } };
  const key = remoteRequestKey(route, input)!;
  const data = { items: [], page: { cursor: null, hasMore: false } };
  const entry = book.read(scope, route, key);
  const fence = { ...initialReadConnection, visibility: 1 };
  expect(book.seedRead(scope, route, {}, data, 120, fence)).toBeNull();
  expect(book.seedRead(scope, route, input, { ...data, items: "invalid" }, 120, fence)).toBeNull();
  expect(book.seedRead(null, route, input, data, 120, fence)).toBeNull();
  expect(book.seedRead(scope, route, input, data, 120, { ...fence, offline: true })).toBeNull();
  expect(book.seedRead(scope, route, input, data, 120, fence)).toEqual({ data });
  expect(book.seedRead(scope, route, input, data, 119, fence)).toBeNull();
  let fetched = false;
  await entry.load(async () => { fetched = true; return requestNotSent; }, { getConnection: () => fence });
  expect(fetched).toBe(false);
  expect(entry.getSnapshot(fence)).toMatchObject({ status: "ready", data, lastConfirmedAt: 120 });
  expect(book.read(other, route, key).getSnapshot(fence).status).toBe("idle");
  expect(entry.getSnapshot({ ...fence, visibility: 2 }).data).toBeNull();
});

test("command status and the original operation ID survive remounts without saving the request body", async () => {
  const { database, repository, mobile } = await testRepository();
  try {
    const key = commandIntentKey(approveQuoteVersionRoute, "version")!;
    expect(key).toBe(commandIntentForRequest(approveQuoteVersionRoute, { params: { id: "version" } }));
    expect(key).not.toBe(commandIntentKey(declineQuoteVersionRoute, "version"));
    expect(commandIntentKey(approveQuoteVersionRoute, "private/address")).toBeNull();
    const book = new RequestBook(true);
    const original = book.command<string>(repository, key);
    const states: string[] = [];
    const unsubscribe = original.subscribe(() => states.push(original.getSnapshot()));
    const sent = Promise.withResolvers<string>();
    const replies = Promise.withResolvers<ApiResult<string>>();
    const online = () => true;
    const send = (id: string) => { sent.resolve(id); return replies.promise; };
    const body = "private request body";
    const first = original.run(body, "op-first", undefined, online, send);
    expect(book.command(repository, key)).toBe(original);
    expect(original.run(body, "op-ignored", undefined, online, send)).toBe(first);
    expect(await sent.promise).toBe("op-first");
    const rows = () => database.query("SELECT * FROM pending_online_receipts").all();
    expect(rows()).toMatchObject([{ operation_id: "op-first", kind: "POST /quote-versions/:id/approve", resource_id: "version" }]);
    expect(JSON.stringify(rows())).not.toContain(body);
    replies.resolve({ ok: false, error: { code: "NETWORK_ERROR", delivery: "unknown" } });
    expect(commandSnapshot(await first).state).toBe("checking");
    expect(states).toEqual(["sending", "checking"]);
    expect(commandSnapshot(await original.run("different body", "op-new", undefined, online, () => Promise.resolve(success("not expected")))).state).toBe("checking");
    unsubscribe();
    repository.close();

    const restarted = new RequestBook(true);
    const reopened = mobile.openScope(repository.scope);
    const pending = restarted.command<string>(reopened, key);
    await pending.hydrate();
    expect(pending.getSnapshot()).toBe("checking");
    const unprivileged = restarted.command(mobile.openScope({ accountId, contextId: "other-role" }), key);
    await unprivileged.hydrate();
    expect(unprivileged.getSnapshot()).toBe("idle");
    expect(commandSnapshot(await pending.run(body, "op-new", undefined, online, () => Promise.resolve(requestNotSent))).state).toBe("checking");
    const seen: string[] = [];
    const retry = (id: string) => { seen.push(id); return Promise.resolve(success("confirmed")); };
    expect(commandSnapshot(await pending.run(body, "op-new", undefined, online, retry)).state).toBe("done");
    expect(seen).toEqual(["op-first"]);
    expect(pending.getSnapshot()).toBe("idle");
    expect(rows()).toEqual([]);

    const conflict = { ok: false, error: { code: "STALE_REVISION" }, meta: { requestId: "request" } } as const;
    expect(commandSnapshot(await pending.run(body, "op-new", undefined, online, () => Promise.resolve(conflict))).state).toBe("conflict");
    expect(rows()).toEqual([]);
    await pending.run(body, "op-remaining", undefined, online, () => replies.promise);
    expect(rows()).toHaveLength(1);
    reopened.close();
    await mobile.wipeAccount(accountId, async () => {});
    expect(rows()).toEqual([]);
  } finally { database.close(); }
});
