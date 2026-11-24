import { expect, test } from "bun:test";
import {
  activatePendingOperations, clearPendingOperationsForSession, migrateLegacyPendingOperations,
  pendingOperationKey, readPendingOperation, savePendingOperation, suspendPendingOperations,
} from "./pending-storage";

test("only operation metadata survives reload; legacy bodies and signed-out scopes are cleared", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    get length() { return entries.size; },
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  } });
  try {
    const identity = "session-a:context-a";
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
  } finally {
    if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
