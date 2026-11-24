import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { EmailAttempt, Result, SessionBootstrap } from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { runEffectBatch } from "../src/effects/index";
import { loadDeliveryKey, loadOtpKey, mailboxKey, randomToken } from "../src/modules/auth/crypto";
import { otpEmailEffect } from "../src/modules/auth/mail-effect";
import { sessionCookieName } from "../src/modules/auth/session";
import { createTestD1 } from "./d1";
import type { TestD1 } from "./d1";

const origin = "https://bookbuddy.test";
const minute = 60_000;
const instant = 1_800_000_000_000;
const person = { email: "person@example.test", deviceId: "install-1", transport: "native" as const };
const open: TestD1[] = [];
let now = instant;

afterEach(() => {
  mock.restore();
  for (const db of open.splice(0)) db.close();
});

async function fixture() {
  const db = await createTestD1();
  open.push(db);
  now = instant;
  spyOn(Date, "now").mockImplementation(() => now);
  const wakes: string[] = [];
  const env = {
    DB: db, OTP_HMAC_KEY: "integration-fixture secret not for deployment",
    EFFECTS_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    POSTMARK_SENDER: "mail@example.test", POSTMARK_SERVER_TOKEN: "test-token",
    EFFECTS: { async send({ workKeys }: { workKeys: string[] }) { wakes.push(...workKeys); } },
  } as unknown as Bindings;
  const app = createApp();
  app.onError((error) => { throw error; });
  function req(path: string, method = "GET", input?: unknown, headers?: HeadersInit) {
    const requestHeaders = new Headers(headers);
    if (input !== undefined) requestHeaders.set("Content-Type", "application/json");
    return app.request(`${origin}/api/v1${path}`, { method, headers: requestHeaders, body: JSON.stringify(input) }, env);
  }
  async function code() {
    const id = wakes.at(-1)!;
    const job = await db.prepare("SELECT id, kind, resource_ref FROM effect_outbox WHERE id = ?").bind(id)
      .first<{ id: string; kind: string; resource_ref: string }>();
    const key = await loadDeliveryKey(env.EFFECTS_ENCRYPTION_KEY);
    const message = await otpEmailEffect.prepareMail(key!, job!);
    const captured = /\b\d{6}\b/.exec(message?.text ?? "")?.[0];
    expect(captured).toMatch(/^\d{6}$/);
    return captured!;
  }
  return { db, env, wakes, req, code };
}

const emailPath = (attemptId: string, action: string) => `/auth/email/${attemptId}/${action}`;
const resend = (expectedRevision: number, operationId = `reissue-${expectedRevision}`, payload = person) => ({ operationId, expectedRevision, payload });
const verify = (code: string, operationId = "verify-1", payload: { email: string; deviceId: string; transport: "native" | "web" } = person) =>
  ({ operationId, payload: { ...payload, code } });

type Verified = { status: "verified"; session: SessionBootstrap; credential?: string };
async function data<T>(response: Response): Promise<T> {
  const envelope = await response.json() as Result<T>;
  expect(response.status).toBe(200);
  if (!envelope.ok) throw new Error(envelope.error.code);
  return envelope.data;
}

async function error(response: Response, status: number) {
  expect(response.status).toBe(status);
  const envelope = await response.json() as Result<unknown>;
  if (envelope.ok) throw new Error("Expected an error envelope");
  return envelope.error;
}

const start = "/auth/email/start";
const auth = (credential: string) => ({ Authorization: `Bearer ${credential}` });

test("neutral start is possession-bound and replays a preallocated attempt without another send", async () => {
  const { db, req, wakes } = await fixture();
  await db.prepare("INSERT INTO accounts (id, email_normalized, verified_at, state) VALUES (?, ?, ?, 'active')")
    .bind("exists", person.email, now).run();
  const supplied = randomToken();
  const first = await data<EmailAttempt>(await req(start, "POST", { ...person, attemptId: supplied }));
  const second = await data<EmailAttempt>(await req(start, "POST", { ...person, email: "new@example.test" }));
  expect({ ...first, attemptId: null }).toEqual({ ...second, attemptId: null });
  expect(first.attemptId).toBe(supplied);
  expect(await data<EmailAttempt>(await req(emailPath(supplied, "status")))).toEqual(first);
  await error(await req(emailPath(randomToken(), "status")), 404);
  expect(await data<EmailAttempt>(await req(start, "POST", { ...person, attemptId: supplied }))).toEqual(first);
  const row = await db.prepare("SELECT id, email_key, device_key, code_mac FROM otp_attempts WHERE state = 'pending' LIMIT 1").first();
  expect(JSON.stringify(row)).not.toContain(person.email);
  expect(JSON.stringify(row)).not.toContain(person.deviceId);
  expect(JSON.stringify(row)).not.toContain(supplied);
  expect(wakes).toHaveLength(2);
});

test("resend waits one minute, invalidates the prior code, and caps a rolling mailbox window", async () => {
  const { req, code, wakes } = await fixture();
  const { attemptId } = await data<EmailAttempt>(await req(start, "POST", person));
  const original = await code();
  const send = emailPath(attemptId, "resend");
  expect((await error(await req(send, "POST", resend(1)), 429)).retryAt).toBe(instant + minute);
  now += minute;
  const second = await data<EmailAttempt>(await req(send, "POST", resend(1)));
  expect(second.generation).toBe(2);
  expect(await code()).not.toBe(original);
  expect(await data(await req(emailPath(attemptId, "verify"), "POST", verify(original))))
    .toEqual({ status: "wrong_code", triesLeft: 4 });
  expect((await data<EmailAttempt>(await req(send, "POST", resend(1)))).generation).toBe(2);
  now += minute;
  expect((await data<EmailAttempt>(await req(send, "POST", resend(2)))).generation).toBe(3);
  expect(wakes).toHaveLength(3);
  now += minute;
  expect((await error(await req(send, "POST", resend(3)), 429)).retryAt).toBe(instant + 30 * minute);
  expect((await error(await req(start, "POST", { ...person, deviceId: "other-device" }), 429)).retryAt).toBe(instant + 30 * minute);
  now = instant + 30 * minute;
  expect((await data<EmailAttempt>(await req(send, "POST", resend(3)))).generation).toBe(4);
});

test("OTP expiry is exact and stale possession still permits a gated reissue", async () => {
  const { req, code } = await fixture();
  const { attemptId, expiresAt } = await data<EmailAttempt>(await req(start, "POST", person));
  const original = await code();
  now = expiresAt;
  expect((await data<EmailAttempt>(await req(emailPath(attemptId, "status")))).state).toBe("expired");
  expect(await data(await req(emailPath(attemptId, "verify"), "POST", verify(original)))).toEqual({ status: "expired" });
  expect((await data<EmailAttempt>(await req(emailPath(attemptId, "resend"), "POST", resend(1)))).state).toBe("pending");
});

test("verify uses one batch, consumes once, and only an exact bounded replay returns the same session", async () => {
  const { db, req, code } = await fixture();
  const { attemptId } = await data<EmailAttempt>(await req(start, "POST", person));
  const correct = await code();
  const confirm = emailPath(attemptId, "verify");
  const before = { ...db.calls };
  const result = await data<Verified>(await req(confirm, "POST", verify(correct)));
  expect(result.status).toBe("verified");
  expect(db.calls.batch - before.batch).toBe(1);
  expect(db.calls.query - before.query).toBe(0);
  expect(result.session.setup).toBe("required");
  expect(result.session.contexts).toHaveLength(1);
  expect(result.session.activeContext?.role).toBe("customer");
  expect(result.session.preferences).toEqual({
    uiLocale: null, readingLocale: null, displayZone: null, theme: "system", fieldMode: null, twoClock: false, revision: 0,
  });
  expect((await data<Verified>(await req(confirm, "POST", verify(correct)))).credential).toBe(result.credential);
  await error(await req(confirm, "POST", verify(correct, "attempt-new-session")), 409);
  await error(await req(confirm, "POST", verify(correct, "verify-1", { ...person, deviceId: "another" })), 404);
  const stored = await db.prepare("SELECT count(*) AS count, secret_hash FROM sessions").first<{ count: number; secret_hash: string }>();
  expect(stored?.count).toBe(1);
  expect(stored?.secret_hash).not.toBe(result.credential);
  now += 2 * minute;
  await error(await req(confirm, "POST", verify(correct)), 409);
});

test("returning accounts get the keyed invite identity only on successful mailbox verification", async () => {
  const { db, env, req, code } = await fixture();
  await db.prepare("INSERT INTO accounts (id, email_normalized, verified_at, state) VALUES ('existing', ?, ?, 'active')")
    .bind(person.email, now).run();
  const { attemptId } = await data<EmailAttempt>(await req(start, "POST", person));
  const confirm = emailPath(attemptId, "verify");
  const correct = await code();
  const wrong = correct === "999999" ? "000000" : "999999";
  await data(await req(confirm, "POST", verify(wrong, "wrong")));
  const stored = () => db.prepare("SELECT email_key AS key FROM accounts WHERE id = 'existing'").first<{ key: string | null }>();
  expect((await stored())?.key).toBeNull();
  expect((await data<Verified>(await req(confirm, "POST", verify(correct)))).session.account.id).toBe("existing");
  const key = await loadOtpKey(env.OTP_HMAC_KEY);
  expect((await stored())?.key).toBe(await mailboxKey(key!, person.email));
});

test("five wrong checks lock verify and reissue for exactly 15 minutes", async () => {
  const { req, code } = await fixture();
  const { attemptId } = await data<EmailAttempt>(await req(start, "POST", person));
  const correct = await code();
  const wrong = correct === "999999" ? "000000" : "999999";
  const confirm = emailPath(attemptId, "verify");
  for (let i = 1; i <= 4; i++) {
    expect(await data(await req(confirm, "POST", verify(wrong, `wrong-${i}`))))
      .toEqual({ status: "wrong_code", triesLeft: 5 - i });
  }
  const retryAt = instant + 15 * minute;
  expect((await error(await req(confirm, "POST", verify(wrong, "wrong-5")), 429)).retryAt).toBe(retryAt);
  const send = emailPath(attemptId, "resend");
  expect((await error(await req(confirm, "POST", verify(correct)), 429)).retryAt).toBe(retryAt);
  now = retryAt - 1;
  expect((await error(await req(send, "POST", resend(1)), 429)).retryAt).toBe(retryAt);
  now = retryAt;
  await data(await req(send, "POST", resend(1)));
  expect((await data<Verified>(await req(confirm, "POST", verify(await code())))).status).toBe("verified");
});

test("settings validate viewer zones and revisions; sign-out revokes the bearer and only its device's push", async () => {
  const { db, req, code } = await fixture();
  const { attemptId } = await data<EmailAttempt>(await req(start, "POST", person));
  const session = await data<Verified>(await req(emailPath(attemptId, "verify"), "POST", verify(await code())));
  const headers = auth(session.credential!);
  const before = db.calls.batch;
  expect((await error(await req("/account/settings", "PATCH", { operationId: "invalid", expectedRevision: 0, payload: { uiLocale: "fr-FR" } }, headers), 422)).fieldErrors)
    .toEqual([{ path: ["payload", "uiLocale"], code: "INVALID_VALUE" }]);
  await error(await req("/account/settings", "PATCH", {
    operationId: "invalid-zone", expectedRevision: 0, payload: { displayZone: "Europe/Not_A_Zone" },
  }, headers), 422);
  expect(db.calls.batch).toBe(before);
  const patch = { operationId: "settings-1", expectedRevision: 0, payload: {
    displayName: "Name", uiLocale: "pt-PT", readingLocale: "de-DE", displayZone: "Europe/London", fieldMode: true, twoClock: true,
  } };
  const changed = await data<SessionBootstrap>(await req("/account/settings", "PATCH", patch, headers));
  expect(db.calls.batch).toBe(before + 1);
  expect(changed.setup).toBe("complete");
  expect(changed.preferences).toMatchObject({
    revision: 1, uiLocale: "pt-PT", readingLocale: "de-DE", displayZone: "Europe/London", fieldMode: true, twoClock: true,
  });
  expect(await data(await req("/account/settings", "PATCH", patch, headers))).toEqual(changed);
  expect((await error(await req("/account/settings", "PATCH", { ...patch, operationId: "stale" }, headers), 409)).current)
    .toEqual({ kind: "revision", revision: 1 });
  expect(await data(await req("/session", "GET", undefined, headers))).toEqual(changed);
  await data(await req("/push/installations/this-installation", "PUT", {
    operationId: "register-push", expectedRevision: 0, payload: { token: "ExpoPushToken[this_device]", platform: "ios" },
  }, { ...headers, "X-Operation-Id": "register-push" }));
  await db.batch([
    db.prepare(`INSERT INTO accounts (id, email_normalized, verified_at, state) VALUES ('other-account', 'other@example.test', ?, 'active')`).bind(now),
    db.prepare(`INSERT INTO push_installations (id, account_id, device_id, token, token_epoch, platform, state, updated_at)
      SELECT 'other-account', 'other-account', device_id, 'ExpoPushToken[other_account]', 1, 'ios', 'active', ?
      FROM sessions WHERE id = ?`).bind(now, session.session.sessionId),
    db.prepare(`INSERT INTO push_installations (id, account_id, device_id, token, token_epoch, platform, state, updated_at)
      VALUES ('other-device', ?, 'other-device', 'ExpoPushToken[other_device]', 1, 'ios', 'active', ?)`).bind(session.session.account.id, now),
  ]);
  const endBefore = db.calls.batch;
  expect(await data(await req("/session/end", "POST", undefined, headers))).toEqual({ ended: true });
  expect({
    batches: db.calls.batch - endBefore,
    states: (await db.prepare("SELECT id, state, token_epoch FROM push_installations ORDER BY id").all()).results,
  }).toEqual({ batches: 1, states: [
    { id: "other-account", state: "active", token_epoch: 1 },
    { id: "other-device", state: "active", token_epoch: 1 },
    { id: "this-installation", state: "revoked", token_epoch: 1 },
  ] });
  await error(await req("/session", "GET", undefined, headers), 401);
  await error(await req(emailPath(attemptId, "verify"), "POST", verify(await code())), 409);
});

test("sessions capability includes only enabled markets of live verified places", async () => {
  const { db, req, code } = await fixture();
  const { attemptId } = await data<EmailAttempt>(await req(start, "POST", person));
  const { credential, session } = await data<Verified>(await req(emailPath(attemptId, "verify"), "POST", verify(await code())));
  expect(session.capabilities).toEqual({ sessions: null });
  const { id } = session.account;
  await db.batch([
    db.prepare(`INSERT INTO operating_areas (id, name, site_zone, polygon) VALUES
      ('market', 'Market', 'Europe/Madrid', '[[0,0]]'), ('other', 'Other', 'Europe/Madrid', '[[0,0]]')`),
    db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, pin, area_id, site_zone, state) VALUES
      ('place', ?, 'Home', 'Home', '{"latitude":0,"longitude":0}', 'market', 'Europe/Madrid', 'pending_verification'),
      ('pending', ?, 'Pending', 'Pending', '{"latitude":0,"longitude":0}', 'other', 'Europe/Madrid', 'pending_verification')`).bind(id, id),
    db.prepare(`INSERT INTO place_people (place_id, account_id, verified_from, history_from)
      VALUES ('place', ?, ?, ?), ('pending', ?, ?, ?)`).bind(id, now, now, id, now, now),
    db.prepare("UPDATE places SET state = 'in_area', named_approver_id = ? WHERE id = 'place'").bind(id),
    db.prepare(`INSERT INTO feature_flags (key, scope_key, enabled, config_version) VALUES
      ('sessions', 'market:pilates', 1, 1), ('sessions', 'market:yoga', 1, 1), ('sessions', 'other:yoga', 1, 1)`),
  ]);
  const read = () => req("/session", "GET", undefined, auth(credential!)).then(data<SessionBootstrap>);
  expect((await read()).capabilities).toEqual({ sessions: { areaIds: ["market"] } });
  await db.prepare("UPDATE feature_flags SET enabled = 0 WHERE scope_key IN ('market:pilates', 'market:yoga')").run();
  expect((await read()).capabilities).toEqual({ sessions: null });
});

test("context switching uses current grant authority and cannot replay a revoked role", async () => {
  const { db, req, code } = await fixture();
  const { attemptId } = await data<EmailAttempt>(await req(start, "POST", person));
  const { credential, session } = await data<Verified>(await req(emailPath(attemptId, "verify"), "POST", verify(await code())));
  const { id } = session.account;
  const headers = auth(credential!);
  await db.batch([
    db.prepare("INSERT INTO operating_areas (id, name, site_zone, polygon) VALUES ('area', 'Area', 'Europe/Madrid', '[[0,0]]')"),
    db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
      VALUES ('business', 'Legal Name', 'Public Name', 'desk@example.test', 'area', 'approved')`),
    db.prepare("INSERT INTO memberships (id, business_id, account_id, state) VALUES ('membership', 'business', ?, 'active')").bind(id),
    db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at)
      VALUES ('grant', 'membership', 'business', ?, 'worker', ?)`).bind(id, now),
    db.prepare(`INSERT INTO account_contexts (id, account_id, role, business_id, role_grant_id)
      VALUES ('worker-context', ?, 'worker', 'business', 'grant')`).bind(id),
    db.prepare(`INSERT INTO feature_flags (key, scope_key, enabled, config_version) VALUES ('sessions', 'business', 1, 1)`),
  ]);
  const worker = { operationId: "switch-worker", payload: { contextId: "worker-context" } };
  const switchTo = (input: unknown) => req("/session/context", "POST", input, headers);
  const before = db.calls.batch;
  expect(await data<SessionBootstrap>(await switchTo(worker))).toMatchObject({
    activeContext: { role: "worker", businessName: "Public Name", membershipId: "membership" },
    capabilities: { sessions: { businessId: "business" } },
  });
  expect(db.calls.batch).toBe(before + 1);
  await db.prepare("UPDATE membership_roles SET revoked_at = ?, revoked_by = ? WHERE id = 'grant'").bind(now, id).run();
  await error(await switchTo(worker), 404);
  const revoked = await data<SessionBootstrap>(await req("/session", "GET", undefined, headers));
  expect(revoked.activeContext).toBeNull();
  expect(revoked.capabilities).toEqual({ sessions: null });
  expect(revoked.contexts).toEqual(session.contexts);
  expect((await data<SessionBootstrap>(await switchTo({ operationId: "switch-customer", payload: { contextId: session.activeContext!.contextId } }))).activeContext?.role).toBe("customer");
});

test("web verification uses an HttpOnly cookie and cookie writes require the same origin", async () => {
  const { req, code } = await fixture();
  const web = { ...person, transport: "web" as const };
  await error(await req(start, "POST", web, { Origin: "https://untrusted.test" }), 401);
  await error(await req(start, "POST", person, { Origin: origin }), 401);
  const { attemptId } = await data<EmailAttempt>(await req(start, "POST", web, { Origin: origin }));
  const response = await req(emailPath(attemptId, "verify"), "POST", verify(await code(), "web-verify", web), { Origin: origin });
  const cookie = response.headers.get("Set-Cookie")!;
  expect(cookie).toStartWith(`${sessionCookieName}=`);
  expect(cookie).toContain("Path=/; HttpOnly; Secure; SameSite=Lax");
  expect((await data<Verified>(response)).credential).toBeUndefined();
  const Cookie = cookie.split(";", 1)[0]!;
  await data(await req("/session", "GET", undefined, { Cookie }));
  await error(await req("/session/end", "POST", undefined, { Cookie }), 401);
  await error(await req("/session/end", "POST", undefined, { Cookie, Origin: "https://untrusted.test" }), 401);
  const ended = await req("/session/end", "POST", undefined, { Cookie, Origin: origin });
  expect(ended.headers.get("Set-Cookie")).toContain("Max-Age=0");
  await data(ended);
});

test("OTP mail claims encrypted payload once, batches delivery, and scrubs settled secrets", async () => {
  const { db, env, req, wakes } = await fixture();
  const { attemptId } = await data<EmailAttempt>(await req(start, "POST", person));
  const second = await data<EmailAttempt>(await req(start, "POST", { ...person, email: "second@example.test" }));
  const provider = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(url).toBe("https://api.postmarkapp.com/email/batch");
    expect(new Headers(init?.headers).get("x-postmark-server-token")).toBe("test-token");
    const messages = JSON.parse(String(init?.body)) as { To: string; TextBody: string }[];
    expect(messages.map(({ To }) => To).sort()).toEqual([person.email, "second@example.test"]);
    expect(messages.every(({ TextBody }) => /\b\d{6}\b/.test(TextBody))).toBe(true);
    return Response.json(messages.map(() => ({ ErrorCode: 0 })));
  });
  try {
    const before = db.calls.batch;
    await runEffectBatch(env, wakes, now);
    expect(db.calls.batch - before).toBe(2);
    for (const id of [attemptId, second.attemptId]) {
      expect((await data<EmailAttempt>(await req(emailPath(id, "status")))).delivery).toBe("accepted");
    }
    expect(await db.prepare("SELECT count(*) FROM effect_outbox WHERE length(resource_ref) <> 87").first<number>("count(*)")).toBe(0);
    await runEffectBatch(env, wakes, now);
    expect(provider).toHaveBeenCalledTimes(1);
  } finally {
    provider.mockRestore();
  }
});
