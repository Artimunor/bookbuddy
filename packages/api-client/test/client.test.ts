import { expect, test } from "bun:test";
import {
  commandInputSchema,
  defineRoute,
  evidenceReferenceSchema,
  operationIdHeader,
  paginationInputSchema,
} from "@bookbuddy/api-contract";
import { createApiClient } from "../src";

const read = defineRoute({
  method: "GET", path: "/evidence", auth: "context",
  input: paginationInputSchema.transform((query) => ({ query })),
  output: evidenceReferenceSchema,
});
const command = defineRoute({
  method: "POST", path: "/evidence/:id/attach", auth: "context", command: true,
  input: commandInputSchema(evidenceReferenceSchema).transform((body) => ({
    body, params: { id: body.payload.attachmentId },
  })),
  output: evidenceReferenceSchema,
});
const data = { attachmentId: "attachment-1" };
const success = { ok: true, data, meta: { requestId: "req-1", serverTime: 1_800_000_000_000 } };
const commandInput = { operationId: "op-1", expectedRevision: 2, payload: data };

test("sends locale, native bearer and the same operation ID in one command call", async () => {
  let calls = 0;
  const api = createApiClient({
    baseUrl: "https://app.example.test/api/v1/",
    getSession: async () => "native-secret",
    getLocale: () => "pt-PT",
    fetch: async (url, init) => {
      calls++;
      const headers = new Headers(init.headers);
      expect(url).toBe("https://app.example.test/api/v1/evidence/attachment-1/attach");
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("omit");
      expect(init.redirect).toBe("error");
      expect(headers.get("Authorization")).toBe("Bearer native-secret");
      expect(headers.get("Accept-Language")).toBe("pt-PT");
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get(operationIdHeader)).toBe("op-1");
      expect(init.body).toBe(JSON.stringify(commandInput));
      return Response.json(success);
    },
  });
  expect(await api.request(command, commandInput)).toEqual(success);
  expect(calls).toBe(1);
});

test("uses same-origin browser credentials and leaves challenge requests free of native bearer", async () => {
  let sessionReads = 0;
  let calls = 0;
  const api = createApiClient({
    baseUrl: "/api/v1", getSession: () => { sessionReads++; return null; }, getLocale: () => "en",
    fetch: async (url, init) => {
      calls++;
      const headers = new Headers(init.headers);
      expect(url).toBe("/api/v1/evidence?cursor=p.1");
      expect(init.credentials).toBe("same-origin");
      expect(init.body).toBeUndefined();
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get(operationIdHeader)).toBeNull();
      return Response.json(success);
    },
  });
  const challenge = defineRoute({ ...read, auth: "challenge" });
  expect(await api.request(read, { cursor: "p.1" })).toEqual(success);
  expect(await api.request(challenge, { cursor: "p.1" })).toEqual(success);
  expect(sessionReads).toBe(1);
  expect(calls).toBe(2);
});

test("preserves a typed server error rather than treating non-2xx as network failure", async () => {
  let calls = 0;
  const conflict = {
    ok: false,
    error: { code: "STALE_REVISION", current: { kind: "revision", revision: 3 } },
    meta: { requestId: "req-2" },
  };
  const api = createApiClient({
    baseUrl: "/api/v1", getSession: () => null, getLocale: () => "en",
    fetch: async () => { calls++; return Response.json(conflict, { status: 409 }); },
  });
  expect(await api.request(command, commandInput)).toEqual(conflict);
  expect(calls).toBe(1);
});

test("reports a lost command response as unknown without retrying or replacing the operation ID", async () => {
  let calls = 0;
  const api = createApiClient({
    baseUrl: "/api/v1", getSession: () => null, getLocale: () => "en",
    fetch: async () => { calls++; throw new Error("disconnected"); },
  });
  expect(await api.request(command, commandInput)).toEqual({
    ok: false, error: { code: "NETWORK_ERROR", delivery: "unknown" },
  });
  expect(calls).toBe(1);
});

test("does not send invalid input or accept invalid projections and contradictory statuses", async () => {
  let calls = 0;
  const api = createApiClient({
    baseUrl: "/api/v1", getSession: () => null, getLocale: () => "en",
    fetch: async () => ++calls === 1
      ? Response.json({ ...success, data: {} })
      : Response.json(success, { status: 503 }),
  });
  expect(await api.request(read, { cursor: "%invalid" })).toEqual({
    ok: false, error: { code: "INVALID_INPUT", delivery: "not_sent" },
  });
  expect(calls).toBe(0);
  for (const status of [200, 503]) {
    expect(await api.request(read, {})).toEqual({
      ok: false, error: { code: "INVALID_RESPONSE", delivery: "unknown", status },
    });
  }
  expect(calls).toBe(2);
});
