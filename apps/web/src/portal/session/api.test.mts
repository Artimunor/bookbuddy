import { expect, test } from "bun:test";
import { createAuthClient, createJobsClient } from "@bookbuddy/api-client";
import { expectedContextHeader, expectedSessionHeader, getOperationRoute, operationIdHeader, sessionEndRoute } from "@bookbuddy/api-contract";
import { createPortalApi } from "./api";

test("a stale response reloads identity once, and a receipt check is bound without a body", async () => {
  let current = true;
  let reloads = 0;
  const calls: { url: string; init: RequestInit }[] = [];
  const api = createPortalApi({ identity: { sessionId: "session-a", contextId: "context-a" },
    getLocale: () => "en", isCurrent: () => current,
    onSessionChanged: () => { reloads++; current = false; },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (init.method === "GET") return Response.json({ ok: true, data: { operationId: "pending-id", status: "committed", committedAt: 123 }, meta: { requestId: "receipt", serverTime: 124 } });
      return Response.json({ ok: false, error: { code: "CONFLICT", current: { kind: "session_changed" } }, meta: { requestId: "fence" } }, { status: 409 });
    },
  });
  const receipt = await api.request(getOperationRoute, { params: { id: "pending-id" } });
  expect(receipt.ok && receipt.data.status).toBe("committed");
  await api.request(sessionEndRoute, {});
  const blocked = await api.request(sessionEndRoute, {});
  expect(blocked).toEqual({ ok: false, error: { code: "REQUEST_SETUP_FAILED", delivery: "not_sent" } });
  expect(reloads).toBe(1);
  expect(calls.map(({ url, init }) => [url, init.method, init.body])).toEqual([
    ["/api/v1/operations/pending-id", "GET", undefined], ["/api/v1/session/end", "POST", undefined],
  ]);
  for (const { init } of calls) {
    expect(new Headers(init.headers).get(expectedSessionHeader)).toBe("session-a");
    expect(new Headers(init.headers).get(expectedContextHeader)).toBe("context-a");
  }
});

const supportBody = { operationId: "support-request", payload: { kind: "access" as const, message: "Help signing in" } };

test("signed-out portal support omits cookies without changing session bootstrap", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const api = createPortalApi({ identity: null, getLocale: () => "en", isCurrent: () => true, onSessionChanged: () => {},
    fetch: async (url, init) => {
      calls.push({ url, init });
      return url === "/api/v1/support"
        ? Response.json({ ok: true, data: { reference: "support-ref", receivedAt: 123 }, meta: { requestId: "support", serverTime: 123 } })
        : unauthenticated();
    },
  });
  expect((await createAuthClient(api).getSession()).ok).toBe(false);
  expect((await createJobsClient(api).submitSupport(supportBody)).ok).toBe(true);
  expect(calls.map(({ url, init }) => [url, init.credentials])).toEqual([
    ["/api/v1/session", "same-origin"], ["/api/v1/support", "omit"],
  ]);
  const headers = new Headers(calls[1]?.init.headers);
  expect(headers.get(expectedSessionHeader)).toBeNull();
  expect(headers.get(expectedContextHeader)).toBeNull();
  expect(headers.get("Authorization")).toBeNull();
  expect(headers.get(operationIdHeader)).toBe(supportBody.operationId);
});

test("an authenticated support write is bound to the view and never retried anonymously", async () => {
  const calls: RequestInit[] = [];
  const api = createPortalApi({ identity: { sessionId: "session-a", contextId: "context-a" },
    getLocale: () => "en", isCurrent: () => true, onSessionChanged: () => {},
    fetch: async (_url, init) => { calls.push(init); return unauthenticated(); },
  });
  const result = await createJobsClient(api).submitSupport(supportBody);
  expect(!result.ok && result.error.code).toBe("UNAUTHENTICATED");
  expect(calls.map(init => init.credentials)).toEqual(["same-origin"]);
  const headers = new Headers(calls[0]?.headers);
  expect(headers.get(expectedSessionHeader)).toBe("session-a");
  expect(headers.get(expectedContextHeader)).toBe("context-a");
});

function unauthenticated() {
  return Response.json({ ok: false, error: { code: "UNAUTHENTICATED" }, meta: { requestId: "auth" } }, { status: 401 });
}
