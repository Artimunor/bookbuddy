import { expect, test } from "bun:test";
import { expectedContextHeader, expectedSessionHeader, getOperationRoute, sessionEndRoute } from "@bookbuddy/api-contract";
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
