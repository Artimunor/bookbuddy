import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createJobsClient } from "@bookbuddy/api-client";
import { operationIdHeader, submitRequestRoute, submitSupportRoute, type SubmitRequest } from "@bookbuddy/api-contract";
import { createWebTranslator } from "@bookbuddy/i18n/web";
import { createPortalApi } from "./api";
import { attemptPendingOperation } from "./pending-attempt";
import {
  activatePendingOperations, anonymousSupportScope, clearPendingOperation, clearPendingOperationsForSession, migrateLegacyPendingOperations,
  pendingOperationKey, preparePendingRetry, readPendingOperation, savePendingOperation, settleMissingPendingOperation, supportIntent, suspendPendingOperations,
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
  expect(readPendingOperation(originalKey)).toEqual({ operationId: "legacy-operation" });
  expect(Array.from(entries.values()).join(" ")).not.toContain("Private");
  const metadata = { operationId: "new-place", placeId: "place-id" };
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

test("activating the same identity rewrites old request fingerprints to allowlisted v3 metadata", () => {
  activatePendingOperations(identity);
  const v2 = `bookbuddy.pending-operation.v2:entry:${JSON.stringify([identity, requestIntent])}`;
  entries.set("bookbuddy.pending-operation.v2:scope", identity);
  entries.set(v2, JSON.stringify({
    operationId: "old-request", routeId: "POST /requests", resourceIds: ["saved-place"],
    attemptedAt: 10_000, retryReady: true,
    request: { expectedRevision: 4, digest: "private-input-digest", payload: { originalText: "Private request" } },
  }));
  const v2Decline = `bookbuddy.pending-operation.v2:entry:${JSON.stringify([identity, "invitation:invite-id"])}`;
  entries.set(v2Decline, JSON.stringify({ operationId: "old-decline", routeId: "POST /invitations/:id/decline", resourceIds: ["invite-id"] }));
  const foreign = `bookbuddy.pending-operation.v2:entry:${JSON.stringify(["other:context-b", requestIntent])}`;
  entries.set(foreign, JSON.stringify({ operationId: "foreign-request", digest: "foreign-digest" }));

  activatePendingOperations(identity);

  const key = pendingOperationKey(identity, requestIntent)!;
  expect(key.key).toStartWith("bookbuddy.pending-operation.v3:");
  expect(JSON.parse(entries.get(key.key)!)).toEqual({ operationId: "old-request", expectedRevision: 4, placeId: "saved-place" });
  expect(readPendingOperation(pendingOperationKey(identity, "invitation-decline:invite-id")!)).toEqual({ operationId: "old-decline" });
  expect([...entries.keys()]).not.toContain(v2);
  expect([...entries.keys()].some(entry => entry.startsWith("bookbuddy.pending-operation.v2:"))).toBe(false);
  expect([...entries.values()].join(" ")).not.toContain("digest");
  expect([...entries.values()].join(" ")).not.toContain("Private request");
});

test("receipt-only operations keep the original ID until a settled negative lookup", () => {
  activatePendingOperations(identity);
  const key = pendingOperationKey(identity, "setup")!;
  const operation = { operationId: "first-settings" };
  expect(savePendingOperation(key, operation)).toBe(true);
  expect(settleMissingPendingOperation(key, operation.operationId, 10_000, 129_999)).toBe(false);

  suspendPendingOperations();
  activatePendingOperations(identity);
  const remounted = pendingOperationKey(identity, "setup")!;
  expect(readPendingOperation(remounted)).toEqual(operation);
  expect(settleMissingPendingOperation(remounted, "different-settings", 140_000, 260_000)).toBe(false);
  expect(settleMissingPendingOperation(remounted, operation.operationId, 140_000, 260_000)).toBe(true);
  expect(readPendingOperation(remounted)).toBeNull();
});

test("request resend after reload tries the old ID and revision before any changed-intent confirmation", async () => {
  activatePendingOperations(identity);
  const key = pendingOperationKey(identity, requestIntent)!;
  const first = submitRequestRoute.input.parse({ body: {
    operationId: "first-request",
    expectedRevision: 4,
    payload: { placeId: "place-id", originalText: "Private request", safeNote: "Private arrival note", arrivalArrangement: "requester" },
  } }).body;
  expect(savePendingOperation(key, { operationId: first.operationId, expectedRevision: first.expectedRevision, placeId: first.payload.placeId })).toBe(true);
  suspendPendingOperations();
  activatePendingOperations(identity);
  const old = readPendingOperation(pendingOperationKey(identity, requestIntent)!)!;
  const reentered = submitRequestRoute.input.parse({ body: { ...first, operationId: "new-draft", expectedRevision: 5 } }).body;
  const requests: SubmitRequest[] = [];
  const uuid = spyOn(crypto, "randomUUID");
  try {
    const same = await attemptPendingOperation(async input => {
      requests.push(input);
      return { ok: true, data: { jobId: "earlier-job" } };
    }, reentered, old);
    expect(requests).toEqual([first]);
    expect(same).toMatchObject({ kind: "committed", data: { jobId: "earlier-job" } });
    const edited = { ...reentered, payload: { ...reentered.payload, originalText: "Changed request" } };
    const conflict = await attemptPendingOperation(async input => {
      requests.push(input);
      return { ok: false, error: { code: "OPERATION_ID_REUSED" } };
    }, edited, old);
    expect(requests).toEqual([first, { ...first, payload: edited.payload }]);
    expect(uuid).not.toHaveBeenCalled();
    expect(conflict.kind).toBe("changed");
    if (conflict.kind !== "changed") throw new Error("Expected a changed-intent confirmation");
    const confirmed = conflict.replacement();
    expect(confirmed).toEqual({ ...edited, operationId: expect.any(String) });
    expect(confirmed.operationId).not.toBe(first.operationId);
    expect(uuid).toHaveBeenCalledTimes(1);
  } finally { uuid.mockRestore(); }
});

test("only a definitive stale revision allows reviewed details to retry with the original request ID", async () => {
  activatePendingOperations(identity);
  const key = pendingOperationKey(identity, requestIntent)!;
  const original = submitRequestRoute.input.parse({ body: {
    operationId: "first-request", expectedRevision: 4,
    payload: { placeId: "place-id", originalText: "Private request", arrivalArrangement: "requester" },
  } }).body;
  const metadata = { operationId: original.operationId, expectedRevision: original.expectedRevision, placeId: original.payload.placeId };
  const placeId = (input: SubmitRequest) => input.payload.placeId;
  expect(savePendingOperation(key, metadata)).toBe(true);
  const updated = { ...original, operationId: "reentered-request", expectedRevision: 5 };
  const prior = preparePendingRetry(key, metadata.operationId, metadata.placeId, updated.expectedRevision)!;
  expect(prior).toEqual(metadata);
  expect(await attemptPendingOperation(async () => ({ ok: false, error: { code: "STALE_REVISION", delivery: "unknown" } }), updated, prior, placeId))
    .toEqual({ kind: "uncertain" });
  expect(readPendingOperation(key)).toEqual(metadata);

  const rejectStale = async () => ({ ok: false as const, error: { code: "STALE_REVISION" } });
  const rejected = await attemptPendingOperation(rejectStale, updated, prior, placeId);
  expect(rejected).toEqual({ kind: "stale", operation: { ...metadata, reviewPlace: true } });
  expect(await attemptPendingOperation(rejectStale, original, undefined, placeId)).toEqual(rejected);
  if (rejected.kind !== "stale") throw new Error("Expected a definitive stale revision");
  expect(savePendingOperation(key, rejected.operation)).toBe(true);
  suspendPendingOperations();
  activatePendingOperations(identity);
  const remounted = pendingOperationKey(identity, requestIntent)!;

  expect(readPendingOperation(remounted)).toEqual({ ...metadata, reviewPlace: true });
  expect(preparePendingRetry(remounted, metadata.operationId, metadata.placeId, 4)).toBeNull();
  expect(preparePendingRetry(remounted, metadata.operationId, "different-place", 5)).toBeNull();
  const reviewed = preparePendingRetry(remounted, metadata.operationId, metadata.placeId, 5)!;
  expect(readPendingOperation(remounted)).toEqual({ ...metadata, expectedRevision: 5 });
  const requests: SubmitRequest[] = [];
  expect(await attemptPendingOperation(async input => {
    requests.push(input);
    throw new Error("Lost revised response");
  }, updated, reviewed)).toEqual({ kind: "uncertain" });
  expect(requests).toEqual([{ ...updated, operationId: original.operationId }]);
  expect(preparePendingRetry(remounted, metadata.operationId, metadata.placeId, 6)).toEqual(reviewed);
});

test.each([anonymousSupportScope, identity])("Help replays a lost response after reload in its original scope (%s)", async (scope) => {
  activatePendingOperations(scope);
  const original = submitSupportRoute.input.parse({ body: {
    operationId: "first-help", payload: { kind: "access", message: "Private support message", replyEmail: "help@example.test" },
  } }).body;
  const key = pendingOperationKey(scope, supportIntent)!;
  expect(savePendingOperation(key, original)).toBe(true);
  expect(entries.get(key.key)).toBe('{"operationId":"first-help"}');
  const data = { reference: "recorded-case", receivedAt: 123 };
  const calls: unknown[] = [];
  const api = createPortalApi({
    identity: scope === anonymousSupportScope ? null : { sessionId: "session-a", contextId: "context-a" },
    getLocale: () => "en", isCurrent: () => true, onSessionChanged: () => {},
    fetch: async (url, init) => {
      expect(url).toBe("/api/v1/support");
      const id = new Headers(init.headers).get(operationIdHeader);
      calls.push([id, JSON.parse(init.body as string)]);
      if (calls.length === 1) throw new Error("Lost response");
      return Response.json({ ok: true, data, meta: { serverTime: 124, requestId: "replayed-help" } });
    },
  });
  const { submitSupport } = createJobsClient(api);
  expect(await attemptPendingOperation(submitSupport, original)).toEqual({ kind: "uncertain" });

  suspendPendingOperations();
  activatePendingOperations(scope);
  const remounted = pendingOperationKey(scope, supportIntent)!;
  const stored = readPendingOperation(remounted);
  expect(stored).toEqual({ operationId: original.operationId });
  const reentered = { ...original, operationId: "new-help-draft" };
  expect(await attemptPendingOperation(submitSupport, reentered, stored!)).toMatchObject({ kind: "committed", data });
  expect(calls).toEqual([[original.operationId, original], [original.operationId, original]]);
  clearPendingOperation(remounted, original.operationId);
  expect(readPendingOperation(remounted)).toBeNull();
});

test("Help's account-and-access topic is localized in both portal locales", () => {
  expect(createWebTranslator("en").t("web.portal.help.kind")).toBe("Topic: account and access");
  expect(createWebTranslator("pt-PT").t("web.portal.help.kind")).toBe("Assunto: conta e acesso");
});
