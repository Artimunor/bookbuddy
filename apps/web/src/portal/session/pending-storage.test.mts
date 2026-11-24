import { afterEach, beforeEach, expect, test } from "bun:test";
import { submitRequestRoute } from "@bookbuddy/api-contract";
import { requestReplay, sameRequestIntent } from "./pending-request";
import {
  activatePendingOperations, clearPendingOperation, clearPendingOperationsForSession, migrateLegacyPendingOperations,
  pendingOperationKey, readPendingOperation, savePendingOperation, settleMissingPendingOperation, suspendPendingOperations,
} from "./pending-storage";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
const entries = new Map<string, string>();
const identity = "session-a:context-a";
const requestIntent = "submit-request";

beforeEach(() => {
  entries.clear();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    get length() { return entries.size; },
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  } });
});

afterEach(() => {
  activatePendingOperations(null);
  if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "sessionStorage");
});

test("only operation metadata survives reload; legacy bodies and signed-out scopes are cleared", () => {
  const intent = "place:new";
  entries.set("bookbuddy.pending-operation.v1:scope", identity);
  entries.set(`bookbuddy.pending-operation.v1:entry:${JSON.stringify([identity, intent])}`,
    '{"operationId":"legacy-operation","routeId":"POST /places","input":{"address":"Private address"}}');
  entries.set("bookbuddy.pending-operation.v1:entry:legacy", '{"input":{"address":"Private address"}}');
  migrateLegacyPendingOperations();
  activatePendingOperations(identity);
  const originalKey = pendingOperationKey(identity, intent)!;
  expect(readPendingOperation(originalKey)).toEqual({ operationId: "legacy-operation", routeId: "POST /places" });
  expect(Array.from(entries.values()).join(" ")).not.toContain("Private");
  const metadata = { operationId: "new-place", routeId: "POST /places", resourceIds: ["place-id"] };
  const input = { ...metadata, input: { address: "Private address", safeArrivalNote: "Private note" } };
  expect(savePendingOperation(originalKey, input)).toBe(true);
  expect(Array.from(entries.values()).join(" ")).not.toContain("Private");

  suspendPendingOperations();
  expect(readPendingOperation(originalKey)).toBeNull();
  activatePendingOperations(identity);
  expect(readPendingOperation(pendingOperationKey(identity, intent)!)).toEqual(metadata);
  expect(pendingOperationKey(identity, "place:somebody@example.test")).toBeNull();
  clearPendingOperationsForSession("different-session");
  expect(readPendingOperation(pendingOperationKey(identity, intent)!)).toEqual(metadata);
  clearPendingOperationsForSession("session-a");
  expect(entries.size).toBe(0);
  expect(savePendingOperation(originalKey, input)).toBe(false);
});

test("an early missing receipt keeps the original ID recoverable across remount", () => {
  activatePendingOperations(identity);
  const key = pendingOperationKey(identity, requestIntent)!;
  const operation = { operationId: "first-request", routeId: "POST /requests", attemptedAt: 10_000 };
  expect(savePendingOperation(key, operation)).toBe(true);
  expect(settleMissingPendingOperation(key, operation, 129_999, true)).toBe(false);

  suspendPendingOperations();
  activatePendingOperations(identity);
  const remounted = pendingOperationKey(identity, requestIntent)!;
  expect(readPendingOperation(remounted)).toEqual(operation);
  clearPendingOperation(remounted, operation.operationId);
  expect(readPendingOperation(remounted)).toBeNull();
});

test("request retries preserve only receipt metadata and require an in-memory intent match", () => {
  activatePendingOperations(identity);
  const key = pendingOperationKey(identity, requestIntent)!;
  const first = submitRequestRoute.input.parse({ body: {
    operationId: "first-request",
    expectedRevision: 4,
    payload: { placeId: "place-id", originalText: "Private request", safeNote: "Private arrival note", attachmentIds: ["photo"], arrivalArrangement: "requester" },
  } }).body;
  const operation = { operationId: first.operationId, routeId: "POST /requests", attemptedAt: 10_000,
    expectedRevision: first.expectedRevision, resourceIds: [first.payload.placeId] };
  expect(savePendingOperation(key, operation)).toBe(true);
  expect(JSON.parse(entries.get(key.key)!)).toEqual(operation);
  expect(requestReplay(operation, first, first, sameRequestIntent)).toBeNull();
  expect(settleMissingPendingOperation(key, operation, 130_000, true)).toBe(true);
  const readyInPage = readPendingOperation(key)!;
  const reentered = { ...first, expectedRevision: 5, payload: { ...first.payload, attachmentIds: [...first.payload.attachmentIds!] } };
  expect(requestReplay(readyInPage, first, reentered, sameRequestIntent)).toEqual(first);
  expect(requestReplay(readyInPage, first, { ...reentered, payload: { ...reentered.payload, originalText: "Changed request" } }, sameRequestIntent)).toBeNull();
  expect(requestReplay(readyInPage, first, { ...reentered, payload: { ...reentered.payload, attachmentIds: [] } }, sameRequestIntent)).toBeNull();

  suspendPendingOperations();
  activatePendingOperations(identity);
  const remounted = pendingOperationKey(identity, requestIntent)!;
  const ready = readPendingOperation(remounted)!;
  expect(ready).toEqual({ ...operation, retryReady: true });
  expect(requestReplay(ready, undefined, reentered, sameRequestIntent)).toBeNull();
  expect(readPendingOperation(remounted)).toEqual(ready);

  const retried = { ...operation, attemptedAt: 140_000 };
  expect(savePendingOperation(remounted, retried)).toBe(true);
  expect(settleMissingPendingOperation(remounted, operation, 140_001, true)).toBe(false);
  expect(settleMissingPendingOperation(remounted, retried, 259_999, true)).toBe(false);
  expect(readPendingOperation(remounted)).toEqual(retried);
});
