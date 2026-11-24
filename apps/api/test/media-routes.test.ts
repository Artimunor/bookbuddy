import { expect, spyOn, test } from "bun:test";
import { createMediaGrantsRoute, createMediaReadGrantsRoute, recoverMediaRoute, resultSchema, settleMediaRoute } from "@bookbuddy/api-contract";
import type { MediaUploadGrant } from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { hashSessionCredential } from "../src/modules/auth/session";
import { sweepMediaRetention } from "../src/modules/media/retention";
import { createTestD1 } from "./d1";
import type { TestD1 } from "./d1";

const now = Date.parse("2026-11-24T12:00:00Z");
const expiry = 7 * 86_400_000;
const base = "https://bookbuddy.test/api/v1/media";
const bucket = "evidence-fixture";
const account = "0123456789abcdef0123456789abcdef";
const keyId = "EXAMPLEKEY";
const signingSecret = "synthetic-test-key-for-sigv4";
const etag = "1f1b1e5989998d4c82c77d311f9e1fc2";
const scope = { caller: "request", parentScopeId: "place" } as const;
const bytes = 1_024;
const largeBytes = 4_500_000;
const attachment = (attachmentId: string, size = bytes) => ({ attachmentId, file: { kind: "photo", mime: "image/jpeg", bytes: size } });
const requested = (attachmentId: string) => ({ attachmentId, uploadGeneration: 1 });
const settling = (attachmentId: string) => ({ ...requested(attachmentId), kind: "single" });

type ObjectMetadata = { key: string; size: number; etag: string; httpMetadata?: R2HTTPMetadata };
type Upload = { key: string; uploadId: string; httpMetadata?: R2HTTPMetadata };
class MemoryR2 {
  readonly objects = new Map<string, ObjectMetadata>();
  readonly uploads = new Map<string, Upload>();
  readonly calls: string[] = [];
  readonly deletions: string[][] = [];
  failCompletionResponse = false;
  blockHead: Promise<void> | undefined;
  headStarted: (() => void) | undefined;

  async head(key: string) {
    this.calls.push("head");
    this.headStarted?.();
    await this.blockHead;
    return this.objects.get(key) ?? null;
  }

  async createMultipartUpload(key: string, options: { httpMetadata: R2HTTPMetadata }) {
    this.calls.push("create");
    const uploadId = `upload+/${this.uploads.size + 1}=`;
    this.uploads.set(uploadId, { key, uploadId, httpMetadata: options.httpMetadata });
    return { key, uploadId };
  }

  resumeMultipartUpload(key: string, uploadId: string) {
    return { complete: async (parts: R2UploadedPart[]) => {
      this.calls.push("complete");
      const upload = this.uploads.get(uploadId);
      if (!upload || upload.key !== key || parts.length !== 1 || parts[0]?.etag !== etag || parts[0]?.partNumber !== 1) throw new Error("Invalid part");
      this.uploads.delete(uploadId);
      const object = { key, size: largeBytes, etag, httpMetadata: upload.httpMetadata };
      this.objects.set(key, object);
      if (this.failCompletionResponse) throw new Error("Response lost after commit");
      return object;
    } };
  }

  async delete(keys: string[]) {
    this.calls.push("delete");
    this.deletions.push(keys);
    for (const key of keys) this.objects.delete(key);
  }

  put(grant: Extract<MediaUploadGrant, { kind: "single" }>, size = bytes) {
    const key = new URL(grant.url).pathname.slice(`/${bucket}/`.length);
    this.objects.set(key, { key, size, etag,
      httpMetadata: { contentType: grant.headers["Content-Type"], cacheControl: grant.headers["Cache-Control"] } });
  }
}

async function seed(db: TestD1, credentials: Record<"owner" | "visitor", string>) {
  const principals = await Promise.all(Object.entries(credentials).map(async ([id, secret]) => [id, await hashSessionCredential(secret)] as const));
  await db.batch([
    ...principals.flatMap(([id, digest]) => [
      db.prepare("INSERT INTO accounts (id, email_normalized, verified_at, state) VALUES (?, ?, 1, 'active')").bind(id, `${id}@example.test`),
      db.prepare("INSERT INTO account_contexts (id, account_id, role) VALUES (?, ?, 'customer')").bind(`${id}-context`, id),
      db.prepare("INSERT INTO sessions (id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at) VALUES (?, ?, ?, ?, 'device', 1, ?)")
        .bind(`${id}-session`, id, digest, `${id}-context`, now + 3 * expiry),
    ]),
    db.prepare("INSERT INTO operating_areas VALUES ('area', 'Fixture', 'Europe/Lisbon', '[0]')"),
    db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
      VALUES ('provider', 'Provider LLC', 'Provider', 'work@example.test', 'area', 'approved')`),
    db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state) VALUES ('place', 'owner', 'Home', 'Address', 'pending_verification')`),
    db.prepare("INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES ('place', 'owner', 1, 1)"),
    db.prepare(`UPDATE places SET state = 'in_area', named_approver_id = 'owner', area_id = 'area', site_zone = 'Europe/Lisbon',
      pin = '{"latitude":0,"longitude":0}' WHERE id = 'place'`),
    db.prepare(`INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, valid_from)
      VALUES ('request-grant', 'place', 'owner', 'request', 'owner', 1)`),
    db.prepare(`INSERT INTO jobs (id, reference, business_id, place_id, requester_id, origin, state) VALUES
      ('job', 'BB-JOB', 'provider', 'place', 'owner', 'bookbuddy', 'open'),
      ('other-job', 'BB-OTHER', 'provider', 'place', 'owner', 'bookbuddy', 'open')`),
    db.prepare(`INSERT INTO requests (job_id, original_text, arrival_arrangement, submitted_at) VALUES
      ('job', 'Work', 'requester', 1), ('other-job', 'Other work', 'requester', 1)`),
  ]);
}

async function fixture() {
  const db = await createTestD1();
  const app = createApp();
  // Expose failure evidence without changing the production envelope.
  app.onError((error) => { throw error; });
  const r2 = new MemoryR2();
  const env = { DB: db, EVIDENCE: r2 as unknown as R2Bucket, R2_ACCOUNT_ID: account, R2_EVIDENCE_BUCKET: bucket,
    R2_ACCESS_KEY_ID: keyId, R2_SECRET_ACCESS_KEY: signingSecret } as Bindings;
  const credentials = { owner: "A".repeat(43), visitor: `${"B".repeat(42)}A` };
  try { await seed(db, credentials); } catch (error) { db.close(); throw error; }
  const clock = spyOn(Date, "now").mockReturnValue(now);
  const request = async (path: string, body: unknown, as: keyof typeof credentials = "owner") => {
    const response = await app.request(`${base}${path}`, {
      method: "POST", headers: { Authorization: `Bearer ${credentials[as]}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    }, env);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    return { status: response.status, json: await response.json() };
  };
  async function call(path: string, body: unknown, batches: number, operations: string[] = [], as?: keyof typeof credentials) {
    const before = { ...db.calls }, objects = r2.calls.length;
    const response = await request(path, body, as);
    expect(response.status).not.toBe(500);
    expect(db.calls.batch - before.batch).toBe(batches);
    expect(db.calls.query - before.query).toBe(0);
    expect(r2.calls.slice(objects)).toEqual(operations);
    return response;
  }
  return { db, r2, env, clock, request, call, close() { db.close(); clock.mockRestore(); } };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function withFixture(run: (f: Fixture) => Promise<void>) {
  const f = await fixture();
  try { await run(f); } finally { f.close(); }
}

const grantResult = resultSchema(createMediaGrantsRoute.output);
const settleResult = resultSchema(settleMediaRoute.output);
const readResult = resultSchema(createMediaReadGrantsRoute.output);
const recoverResult = resultSchema(recoverMediaRoute.output);

async function firstGrant(f: Fixture, id: string) {
  const outcome = grantResult.parse((await f.call("/grants", { stageId: "draft", scope, files: [attachment(id)] }, 1)).json);
  if (!outcome.ok || outcome.data.grants[0]?.state !== "uploading" || outcome.data.grants[0].grant.kind !== "single") throw new Error("Missing grant");
  return outcome.data.grants[0].grant;
}

function assertPutVector(grant: Extract<MediaUploadGrant, { kind: "single" }>) {
  // Independent SigV4 vector: explicit canonical fields and Bun's HMAC rather
  // than the production code's header, URI, query or Web Crypto helpers.
  const url = new URL(grant.url);
  expect(url.host).toBe("0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com");
  expect(url.pathname).toMatch(/^\/evidence-fixture\/evidence\/[a-f0-9]{32}$/);
  expect(grant).toMatchObject({ method: "PUT", expiresAt: now + 600_000,
    headers: { "If-None-Match": "*", "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } });
  const query = "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD"
    + "&X-Amz-Credential=EXAMPLEKEY%2F20261124%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261124T120000Z&X-Amz-Expires=600"
    + "&X-Amz-SignedHeaders=cache-control%3Bcontent-length%3Bcontent-type%3Bhost%3Bif-none-match";
  const canonical = `PUT\n${url.pathname}\n${query}\ncache-control:private, no-store\ncontent-length:1024\ncontent-type:image/jpeg\n`
    + "host:0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com\nif-none-match:*\n\n"
    + "cache-control;content-length;content-type;host;if-none-match\nUNSIGNED-PAYLOAD";
  const digest = new Bun.CryptoHasher("sha256").update(canonical).digest("hex");
  const stringToSign = `AWS4-HMAC-SHA256\n20261124T120000Z\n20261124/auto/s3/aws4_request\n${digest}`;
  const date = new Bun.CryptoHasher("sha256", `AWS4${signingSecret}`).update("20261124").digest();
  const region = new Bun.CryptoHasher("sha256", date).update("auto").digest();
  const service = new Bun.CryptoHasher("sha256", region).update("s3").digest();
  const key = new Bun.CryptoHasher("sha256", service).update("aws4_request").digest();
  const signature = new Bun.CryptoHasher("sha256", key).update(stringToSign).digest("hex");
  expect(url.search.slice(1)).toBe(`${query}&X-Amz-Signature=${signature}`);
}

test("conditional small PUTs, batched settle, ready skip, and current exact-link read grants", () => withFixture(async (f) => {
  const primary = await firstGrant(f, "primary");
  assertPutVector(primary);
  f.r2.put(primary);
  const file = { ...attachment("primary"), refresh: { uploadGeneration: 1 } };
  f.clock.mockReturnValue(now + 10_000);
  const refresh = await f.call("/grants", { stageId: "draft", scope, files: [file] }, 1);
  expect(refresh.json).toMatchObject({ data: { grants: [{ grant: primary }] } });
  f.clock.mockReturnValue(now + 600_000);
  const expired = await f.call("/grants", { stageId: "draft", scope, files: [file] }, 1);
  expect(expired.json).toMatchObject({ data: { grants: [{ grant: { expiresAt: now + 1_200_000 } }] } });

  const second = await firstGrant(f, "second");
  await firstGrant(f, "unready");
  f.r2.put(second);
  const files = [settling("primary"), settling("second")];
  const settled = settleResult.parse((await f.call("/settle", { stageId: "draft", files }, 2, ["head", "head"])).json);
  const acknowledgements = ["primary", "second"].map((id) => ({ ...requested(id), state: "ready" }));
  expect(settled).toMatchObject({ ok: true, data: { acknowledgements } });
  expect((await f.call("/settle", { stageId: "draft", files }, 1)).json).toMatchObject({ ok: true, data: { acknowledgements } });
  await f.db.prepare("INSERT INTO request_attachments VALUES ('job', 'primary'), ('job', 'unready')").run();
  const read = { scope: { caller: "request", parentScopeId: "job" }, attachmentIds: ["primary", "second", "unready"] };
  const result = readResult.parse((await f.call("/read-grants", read, 1)).json);
  if (!result.ok || result.data.grants[0]?.state !== "ready") throw new Error("No read grant");
  expect(result.data.grants).toEqual([expect.objectContaining({ state: "ready", method: "GET", attachmentId: "primary" }),
    { state: "unavailable", attachmentId: "second" }, { state: "unavailable", attachmentId: "unready" }]);
  expect(new URL(result.data.grants[0].url).searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  expect((await f.call("/read-grants", read, 1, [], "visitor")).json).toMatchObject({ data: { grants: read.attachmentIds.map((attachmentId) => ({ attachmentId, state: "unavailable" })) } });
  expect((await f.call("/read-grants", { ...read, scope: { caller: "request", parentScopeId: "other-job" } }, 1)).json)
    .toMatchObject({ data: { grants: read.attachmentIds.map((attachmentId) => ({ attachmentId, state: "unavailable" })) } });
  expect((await f.call("/grants", { stageId: "foreign", scope, files: [attachment("foreign-file")] }, 1, [], "visitor")).status).toBe(404);
  expect((await f.call("/settle", { stageId: "draft", files }, 1, [], "visitor")).status).toBe(404);
}));

test("multipart keeps sessions, lists only a known upload, and recovers a lost completion without repeating it", () => withFixture(async (f) => {
  const body = { stageId: "draft", scope, files: [attachment("clip-a", largeBytes), attachment("clip-b", largeBytes)] };
  const first = grantResult.parse((await f.call("/grants", body, 2, ["create", "create"])).json);
  if (!first.ok || first.data.grants[0]?.state !== "uploading" || first.data.grants[0].grant.kind !== "multipart") throw new Error("No multipart grant");
  const [part] = first.data.grants[0].grant.parts;
  expect(part).toMatchObject({ partNumber: 1, offset: 0, bytes: largeBytes });
  const url = new URL(part!.url);
  const uploadId = url.searchParams.get("uploadId");
  expect(uploadId).toBe("upload+/1=");
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;host");
  expect(grantResult.parse((await f.call("/grants", body, 1)).json)).toMatchObject({ data: first.data });

  const list = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const partListUrl = new URL(String(input));
    expect(partListUrl.pathname).toBe(url.pathname);
    expect(partListUrl.searchParams.get("uploadId")).toBe(uploadId);
    expect(partListUrl.searchParams.get("max-parts")).toBe("20");
    return new Response(`<ListPartsResult><IsTruncated>false</IsTruncated><Part><PartNumber>1</PartNumber><ETag>&quot;${etag}&quot;</ETag><Size>${largeBytes}</Size></Part></ListPartsResult>`);
  });
  try {
    const partRecovery = recoverResult.parse((await f.call("/recover", { stageId: "draft", files: [{ ...requested("clip-a"), unknown: "parts" }] }, 1)).json);
    expect(partRecovery).toMatchObject({ ok: true, data: { files: [{ state: "uploading", transfer: {
      kind: "multipart", completedParts: [{ partNumber: 1, etag }], missingPartNumbers: [],
    } }] } });
    expect(list).toHaveBeenCalledTimes(1);
  } finally { list.mockRestore(); }

  f.r2.failCompletionResponse = true;
  const files = [{ ...requested("clip-a"), kind: "multipart", parts: [{ partNumber: 1, etag: `"${etag}"` }] }];
  expect((await f.call("/settle", { stageId: "draft", files }, 1, ["complete"])).json)
    .toMatchObject({ data: { acknowledgements: [{ state: "verifying" }] } });
  expect((await f.call("/settle", { stageId: "draft", files }, 1)).json)
    .toMatchObject({ data: { acknowledgements: [{ state: "verifying" }] } });
  f.clock.mockReturnValue(now + 125_000);
  const unknown = { stageId: "draft", files: [{ ...requested("clip-a"), unknown: "completion" }] };
  expect((await f.call("/recover", unknown, 2, ["head"])).json).toMatchObject({ data: { files: [{ state: "ready" }] } });
  expect((await f.call("/recover", unknown, 1)).json).toMatchObject({ data: { files: [{ state: "ready" }] } });
  expect((await f.call("/settle", { stageId: "draft", files }, 1)).json).toMatchObject({ data: { acknowledgements: [{ state: "ready" }] } });
}));

test("settle claims once even when two requests share the same clock", () => withFixture(async (f) => {
  f.r2.put(await firstGrant(f, "pending"));
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  f.r2.blockHead = release.promise;
  f.r2.headStarted = entered.resolve;
  const body = { stageId: "draft", files: [settling("pending")] };
  const first = f.request("/settle", body);
  await Promise.race([entered.promise, first.then(() => { throw new Error("No claim"); })]);
  try {
    expect((await f.call("/settle", body, 1)).json).toMatchObject({ data: { acknowledgements: [{ state: "verifying" }] } });
  } finally { release.resolve(); }
  expect((await first).json).toMatchObject({ data: { acknowledgements: [{ state: "ready" }] } });
  expect(f.r2.calls).toEqual(["head"]);
}));

test("retention expires unlinked reservations and deletes due objects in one batch, preserving links and holds", () => withFixture(async (f) => {
  for (const id of ["unlinked", "kept", "due", "held"]) f.r2.put(await firstGrant(f, id));
  await f.call("/settle", { stageId: "draft", files: ["unlinked", "kept", "due", "held"].map(settling) }, 2, ["head", "head", "head", "head"]);
  await f.db.batch([
    f.db.prepare("INSERT INTO request_attachments VALUES ('job', 'kept'), ('job', 'due'), ('job', 'held')"),
    f.db.prepare("UPDATE attachments SET delete_after = ? WHERE id IN ('due', 'held')").bind(now + expiry),
    f.db.prepare("INSERT INTO retention_holds (id, record_kind, record_id, reason, review_at) VALUES ('hold', 'attachment', 'held', 'case', ?)").bind(now + expiry),
  ]);
  const before = { ...f.db.calls };
  await sweepMediaRetention(f.env, now + expiry);
  expect(f.db.calls.batch - before.batch).toBe(2);
  expect(f.db.calls.query - before.query).toBe(0);
  expect(f.r2.deletions).toHaveLength(1);
  expect(f.r2.deletions[0]).toHaveLength(2);
  expect(f.r2.objects.size).toBe(2);
  const result = await f.db.prepare("SELECT id, state FROM attachments ORDER BY id").all();
  expect(result.results).toEqual([{ id: "due", state: "expired" }, { id: "held", state: "ready" },
    { id: "kept", state: "ready" }, { id: "unlinked", state: "expired" }]);
  const passes = f.db.calls.batch;
  await sweepMediaRetention(f.env, now + expiry);
  expect(f.db.calls.batch - passes).toBe(1);
  expect(f.r2.deletions).toHaveLength(1);
}));

test("chat grants require current send authority and do not bypass entry history boundaries", () => withFixture(async (f) => {
  await f.db.batch([
    f.db.prepare(`INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, valid_from)
      VALUES ('message-grant', 'place', 'owner', 'message', 'owner', 1)`),
    f.db.prepare(`INSERT INTO chat_threads (id, job_id, audience, write_state, last_position)
      VALUES ('thread', 'job', 'job', 'open', 2)`),
    f.db.prepare("INSERT INTO chat_members (thread_id, context_id, can_send, visible_from) VALUES ('thread', 'owner-context', 1, 2)"),
    f.db.prepare(`INSERT INTO chat_messages (id, thread_id, author_context_id)
      VALUES ('old-entry', 'thread', 'owner-context'), ('new-entry', 'thread', 'owner-context')`),
    f.db.prepare(`INSERT INTO chat_entries (id, root_id, thread_id, revision, position, source_language, original_text, received_at) VALUES
      ('old-entry', 'old-entry', 'thread', 1, 1, 'en', 'Old', 1), ('new-entry', 'new-entry', 'thread', 1, 2, 'en', 'New', 2)`),
  ]);
  const body = { stageId: "chat-draft", scope: { caller: "chat", parentScopeId: "thread" }, files: [attachment("entry-photo")] };
  expect((await f.call("/grants", body, 1, [], "visitor")).status).toBe(404);
  const upload = grantResult.parse((await f.call("/grants", body, 1)).json);
  if (!upload.ok || upload.data.grants[0]?.state !== "uploading" || upload.data.grants[0].grant.kind !== "single") throw new Error("Missing chat grant");
  f.r2.put(upload.data.grants[0].grant);
  await f.call("/settle", { stageId: "chat-draft", files: [settling("entry-photo")] }, 2, ["head"]);
  await f.db.prepare("INSERT INTO entry_attachments VALUES ('old-entry', 'entry-photo'), ('new-entry', 'entry-photo')").run();
  const read = (entry: string) => f.call("/read-grants", { scope: { caller: "chat", parentScopeId: entry }, attachmentIds: ["entry-photo"] }, 1);
  expect((await read("old-entry")).json).toMatchObject({ data: { grants: [{ state: "unavailable" }] } });
  expect((await read("new-entry")).json).toMatchObject({ data: { grants: [{ state: "ready" }] } });
  await f.db.prepare("UPDATE place_grants SET revoked_at = ? WHERE id = 'message-grant'").bind(now).run();
  expect((await read("new-entry")).json).toMatchObject({ data: { grants: [{ state: "unavailable" }] } });
  expect((await f.call("/grants", body, 1)).status).toBe(404);
}));

test("a missing PUT spends no result batch on settle and can be recovered only for the correct generation", () => withFixture(async (f) => {
  const grant = await firstGrant(f, "missing");
  const files = [settling("missing")];
  expect((await f.call("/settle", { stageId: "draft", files }, 1, ["head"])).json)
    .toMatchObject({ data: { acknowledgements: [{ state: "verifying" }] } });
  f.clock.mockReturnValue(now + 125_000);
  const body = { stageId: "draft", files: [{ ...requested("missing"), unknown: "put" }] };
  expect((await f.call("/recover", { ...body, files: [{ ...body.files[0], uploadGeneration: 2 }] }, 1)).status).toBe(404);
  expect((await f.call("/recover", body, 2, ["head"])).json).toMatchObject({
    data: { files: [{ state: "uploading", transfer: { kind: "single", object: "missing" } }] },
  });
  f.r2.put(grant);
  expect((await f.call("/recover", body, 2, ["head"])).json).toMatchObject({ data: { files: [{ state: "ready" }] } });
}));

test("commercial evidence can be staged and settled against the accountable job before a version exists", () => withFixture(async (f) => {
  await f.db.batch([
    f.db.prepare("INSERT INTO memberships (id, business_id, account_id, state) VALUES ('member', 'provider', 'visitor', 'active')"),
    f.db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at)
      VALUES ('foreman-role', 'member', 'provider', 'visitor', 'foreman', 1)`),
    f.db.prepare(`INSERT INTO account_contexts (id, account_id, role, business_id, role_grant_id)
      VALUES ('foreman-context', 'visitor', 'foreman', 'provider', 'foreman-role')`),
    f.db.prepare("UPDATE sessions SET active_context_id = 'foreman-context' WHERE id = 'visitor-session'"),
    f.db.prepare("UPDATE jobs SET accountable_foreman_membership_id = 'member' WHERE id = 'job'"),
  ]);
  for (const caller of ["quote", "change"] as const) {
    const id = `${caller}-photo`;
    const body = { stageId: `${caller}-draft`, scope: { caller, parentScopeId: "job" }, files: [attachment(id)] };
    expect((await f.call("/grants", body, 1)).status).toBe(404);
    expect((await f.call("/grants", { ...body, scope: { caller, parentScopeId: "other-job" } }, 1, [], "visitor")).status).toBe(404);
    const result = grantResult.parse((await f.call("/grants", body, 1, [], "visitor")).json);
    if (!result.ok || result.data.grants[0]?.state !== "uploading" || result.data.grants[0].grant.kind !== "single") throw new Error("Missing commercial grant");
    f.r2.put(result.data.grants[0].grant);
    const settled = await f.call("/settle", { stageId: body.stageId, files: [settling(id)] }, 2, ["head"], "visitor");
    expect(settled.json).toMatchObject({ data: { acknowledgements: [{ attachmentId: id, state: "ready" }] } });
  }
}));
