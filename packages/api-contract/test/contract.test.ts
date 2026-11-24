import { expect, test } from "bun:test";
import { z } from "zod";
import {
  activeContextSchema,
  commandInputSchema,
  createOpaqueLink,
  defineRoute,
  evidenceReferenceSchema,
  localePreferencesSchema,
  opaqueLinkUrlSchema,
  parseOpaqueLink,
  parseResult,
  resultSchema,
  syncLimits,
  syncPageSchema,
  syncRequestSchema,
} from "../src";

const meta = { requestId: "request-1" };
const successMeta = { ...meta, serverTime: 1_800_000_000_000 };

test("round-trips both wire envelopes and validates the success projection", () => {
  const success = { ok: true, data: { attachmentId: "attachment-1" }, meta: successMeta };
  const failure = {
    ok: false,
    error: { code: "RATE_LIMITED", retryAt: successMeta.serverTime + 60_000 },
    meta,
  };
  const schema = resultSchema(evidenceReferenceSchema);
  for (const original of [success, failure]) {
    const wire = JSON.parse(JSON.stringify(schema.parse(original)));
    expect(parseResult(evidenceReferenceSchema, wire)).toEqual(original);
  }
  expect(parseResult(evidenceReferenceSchema, { ...success, data: {} })).toBeNull();
  expect(parseResult(z.unknown(), { ok: true, meta: successMeta })).toBeNull();
  expect(parseResult(z.unknown(), { ...failure, error: { code: "unexpected" } })).toBeNull();
});

test("safe competing outcomes expose only the public status", () => {
  const current = { kind: "cover", status: "accepted_pending_confirmation" };
  const failure = { ok: false, error: { code: "CONFLICT", current }, meta };
  expect(parseResult(z.unknown(), failure)).toEqual(failure);
  expect(parseResult(z.unknown(), {
    ...failure,
    error: { ...failure.error, current: { ...current, workerId: "competing-worker" } },
  })).toBeNull();
});

test("opaque links accept only a canonical HTTPS destination on the configured origin", () => {
  const origin = "https://app.example.test";
  const href = createOpaqueLink(origin, "v5_YM-1");
  expect(href).toBe(`${origin}/l/v5_YM-1`);
  expect(opaqueLinkUrlSchema.parse(href)).toBe(href);
  expect(parseOpaqueLink(origin, href)).toBe("v5_YM-1");
  for (const invalid of [
    `${href}?ignore=1`, `${href}#x`, `${href}/`, `${href}\n`, `${origin}/l/%76`,
    "http://app.example.test/l/token", "https://app.example.test:443/l/token",
    "https://app.example.test@other.example.test/l/token",
  ]) {
    expect(opaqueLinkUrlSchema.safeParse(invalid).success).toBe(false);
    expect(parseOpaqueLink(origin, invalid)).toBeNull();
  }
  expect(parseOpaqueLink(origin, "https://other.example.test/l/token")).toBeNull();
});

test("common routes model a versioned command and nullable, forward-compatible language choices", () => {
  const route = defineRoute({
    method: "POST", path: "/jobs/:job/command", auth: "context", command: true,
    input: z.object({ params: z.object({ job: z.string() }), body: commandInputSchema(z.object({})) }),
    output: z.object({}),
  });
  const params = { job: "job-1" };
  const body = { operationId: "op-1", expectedRevision: 3, payload: {} };
  expect(route.input.safeParse({ params, body }).success).toBe(true);
  expect(route.input.safeParse({ params, body: { ...body, expectedRevision: -1 } }).success).toBe(false);
  expect(localePreferencesSchema.parse({ uiLocale: "es-MX", readingLocale: null })).toEqual({
    uiLocale: "es-MX", readingLocale: null,
  });
  expect(activeContextSchema.safeParse({ contextId: "ctx-1", role: "customer", businessId: "b-1" }).success).toBe(false);
});

test("sync envelopes limit the operation batch and combined upserts and removals", () => {
  const operation = commandInputSchema(z.object({}));
  const operations = Array.from({ length: syncLimits.operations }, (_, i) => ({ operationId: `op-${i}`, payload: {} }));
  const request = { contextId: "ctx-1", cursor: null, operations };
  expect(syncRequestSchema(operation).safeParse(request).success).toBe(true);
  expect(syncRequestSchema(operation).safeParse({ ...request, operations: [...operations, operations[0]] }).success).toBe(false);

  const pageSchema = syncPageSchema({ outcome: z.string(), projection: z.string(), removal: z.string() });
  const page = {
    mode: "reset", context: { contextId: "ctx-1", role: "worker", businessId: "b-1" }, outcomes: [],
    upserts: Array.from({ length: syncLimits.changes - 1 }, (_, i) => `p-${i}`),
    removals: ["p-100"], cursor: "opaque.signature", hasMore: true,
  };
  expect(pageSchema.safeParse(page).success).toBe(true);
  expect(pageSchema.safeParse({ ...page, removals: [...page.removals, "p-101"] }).success).toBe(false);
});
