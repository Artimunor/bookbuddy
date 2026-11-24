import { expect, spyOn, test } from "bun:test";
import { openLinkRoute, resultSchema } from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { runEffectBatch } from "../src/effects";
import { sweepPushReceipts } from "../src/effects/push";
import { randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential } from "../src/modules/auth/session";
import { createLinkTarget, linkTokenFor } from "../src/modules/links";
import type { ExpoFetch, ExpoMessage } from "../src/providers/expo-push";
import { createTestD1 } from "./d1";

const now = 1_800_000_000_000;
const minute = 60_000;
const origin = "https://bookbuddy.test";
const unavailable = (reason: string) => ({ kind: "unavailable", status: "unavailable", reason, supportReference: null });

async function fixture() {
  const db = await createTestD1();
  const env = { DB: db, PUBLIC_APP_ORIGIN: origin, EXPO_ACCESS_TOKEN: "fake-provider-secret" } as unknown as Bindings;
  try {
    await db.batch([
      db.prepare(`INSERT INTO accounts (id, email_normalized, email_key, display_name, verified_at, state) VALUES
        ('recipient', 'r@example.test', 'recipient-mailbox', 'Recipient', 1, 'active'),
        ('sender', 's@example.test', 'sender-mailbox', 'Sender', 1, 'active'),
        ('other', 'o@example.test', 'other-mailbox', 'Other', 1, 'active')`),
      db.prepare(`INSERT INTO account_contexts (id, account_id, role) SELECT id || '-customer', id, 'customer' FROM accounts`),
      db.prepare("INSERT INTO account_preferences (account_id, ui_locale) VALUES ('recipient', 'pt-PT')"),
    ]);
  } catch (error) { db.close(); throw error; }
  return { db, env };
}

test("opaque open keeps invitation, recipient, role and live job checks in one D1 call", async () => {
  const { db, env } = await fixture();
  const clock = spyOn(Date, "now").mockReturnValue(now);
  const app = createApp();
  const inviteToken = randomToken(), recipient = randomToken(), other = randomToken();
  const expiry = now + 30 * minute;
  try {
    const [inviteHash, recipientHash, otherHash] = await Promise.all([inviteToken, recipient, other].map(hashSessionCredential));
    const targets = createLinkTarget({ sql: `SELECT 'job_update' AS kind, 'job' AS resource_id,
      'recipient-foreman' AS required_scope, ? AS expires_at`, params: [expiry] });
    await db.batch([
      db.prepare("INSERT INTO operating_areas (id, name, site_zone, polygon) VALUES ('area', 'Area', 'Europe/Lisbon', '[0]')"),
      db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
        VALUES ('business','Book Service LLC','Book Service','work@example.test','area','approved')`),
      db.prepare(`INSERT INTO memberships VALUES ('sender-member','business','sender','active'),
        ('foreman-member','business','recipient','active')`),
      db.prepare(`INSERT INTO membership_roles (id,membership_id,business_id,account_id,role,granted_at) VALUES
        ('sender-role','sender-member','business','sender','provider_admin',1),
        ('foreman-role','foreman-member','business','recipient','foreman',1)`),
      db.prepare(`INSERT INTO business_grants (id,business_id,membership_id,capability,issuer_id,valid_from)
        VALUES ('manage','business','sender-member','membership_admin','sender',1)`),
      db.prepare("INSERT INTO account_contexts VALUES ('recipient-foreman','recipient','foreman','business','foreman-role')"),
      db.prepare(`INSERT INTO sessions (id,account_id,secret_hash,active_context_id,device_id,issued_at,expires_at)
        VALUES ('recipient-session','recipient',?,'recipient-customer','device',1,?),
          ('other-session','other',?,'other-customer','device',1,?)`).bind(recipientHash, expiry, otherHash, expiry),
      db.prepare(`INSERT INTO invitations (id, token_hash, recipient_key, recipient_email_ciphertext, business_id,
        inviter_id, grant_snapshot, issued_at, expires_at, recipient_id, state)
        VALUES ('invite', ?, 'recipient-mailbox', 'sealed', 'business', 'sender', '{"kind":"business_role","role":"worker"}',
          ?, ? + 172800000, 'recipient', 'pending')`).bind(inviteHash, now - 1, now - 1),
      db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state)
        VALUES ('property','recipient','Private house','19 Private Street','pending_verification')`),
      db.prepare("INSERT INTO place_people (place_id,account_id,verified_from,history_from) VALUES ('property','recipient',1,1)"),
      db.prepare(`UPDATE places SET state='in_area', area_id='area', site_zone='Europe/Lisbon',
        named_approver_id='recipient', pin='{"latitude":0,"longitude":0}' WHERE id='property'`),
      db.prepare(`INSERT INTO place_grants (id,place_id,account_id,capability,issuer_id,valid_from)
        VALUES ('approve','property','recipient','approve','recipient',1)`),
      db.prepare(`INSERT INTO invitations (id, token_hash, recipient_key, recipient_email_ciphertext, place_id,
        inviter_id, grant_snapshot, issued_at, expires_at, recipient_id, pending_slot, state)
        VALUES ('place-invite', 'place-hash', 'other-mailbox', 'sealed', 'property', 'recipient', '{"kind":"place_view"}',
          ?, ? + 172800000, 'other', 1, 'pending')`).bind(now - 1, now - 1),
      db.prepare(`INSERT INTO jobs (id,reference,business_id,place_id,requester_id,accountable_foreman_membership_id,origin,state)
        VALUES ('job','BB-1','business','property','recipient','foreman-member','bookbuddy','open')`),
      db.prepare(`INSERT INTO requests (job_id, original_text, original_language, arrival_arrangement, submitted_at)
        VALUES ('job','Private request','en','requester',1)`),
      db.prepare("INSERT INTO terms_versions VALUES ('terms','business',1,'Book Service LLC','Terms','en','Consent','hash')"),
      db.prepare("INSERT INTO quotes VALUES ('quote','job')"),
      db.prepare(`INSERT INTO quote_versions (id,quote_id,job_id,business_id,no,author_id,terms_id,original_locale,
        scope,exclusions,net_minor,tax_minor,total_minor,currency,state) VALUES
        ('issued','quote','job','business',1,'sender','terms','en','Private scope','',100,20,120,'EUR','draft'),
        ('draft','quote','job','business',2,'sender','terms','en','Other draft','',200,40,240,'EUR','draft')`),
      db.prepare(`UPDATE quote_versions SET publisher_id='sender', issued_at=?, expires_at=?, state='issued' WHERE id='issued'`)
        .bind(now - 1, expiry),
      db.prepare(`INSERT INTO visits (id,job_id,kind,state) VALUES ('earlier-visit','job','assessment','booked'),
        ('target-visit','job','work','booked')`),
      db.prepare(`INSERT INTO visit_windows (id,visit_id,starts_at,ends_at,expires_at,provider_authorized,
        proposed_at,proposed_by,confirmed_at,confirmed_by,state) VALUES
        ('earlier-window','earlier-visit',?,?,?,1,1,'sender',2,'recipient','confirmed'),
        ('target-window','target-visit',?,?,?,1,1,'sender',2,'recipient','confirmed')`)
        .bind(now - 2 * minute, now + minute, now - 3 * minute, now - minute, now + 2 * minute, now - 2 * minute),
      db.prepare(`INSERT INTO link_targets VALUES ('stale','job_update','job','recipient-customer',?),
        ('live','visit_live','target-visit','recipient-customer',?),
        ('quote-link','quote_ready','issued','recipient-customer',?),
        ('partial','quote_ready','draft','recipient-customer',?),
        ('place-link','place_invite','place-invite','other-customer',?)`).bind(now, expiry, expiry, expiry, expiry),
      db.prepare(targets.sql).bind(...targets.params ?? []),
      db.prepare(targets.sql).bind(...targets.params ?? []),
    ]);
    const { token, total } = (await db.prepare(`SELECT ${linkTokenFor("'job_update'", "'job'", "'recipient-foreman'", "?")} AS token,
      (SELECT count(*) FROM link_targets WHERE required_scope='recipient-foreman') AS total`).bind(expiry)
      .first<{ token: string; total: number }>())!;
    expect(total).toBe(1);
    const open = async (opaque: string, credential = recipient) => {
      const base = { ...db.calls };
      const response = await app.request(`${origin}/api/v1/links/${opaque}`, { headers: { Authorization: `Bearer ${credential}` } }, env);
      expect(db.calls.batch - base.batch).toBe(1);
      expect(db.calls.query - base.query).toBe(0);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const parsed = resultSchema(openLinkRoute.output).parse(await response.json());
      if (!parsed.ok) throw new Error(parsed.error.code);
      return parsed.data;
    };
    const prepare = spyOn(db, "prepare");
    expect(await open(inviteToken)).toMatchObject({ kind: "invitation", invitation: { status: "pending", id: "invite" } });
    expect(prepare.mock.calls.length).toBeGreaterThan(0);
    for (const [sql] of prepare.mock.calls) expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(100_000);
    prepare.mockRestore();
    expect(await open(inviteToken, other)).toEqual(unavailable("unavailable"));
    expect(await open("place-link")).toEqual(unavailable("unavailable"));
    expect(await open("place-link", other)).toMatchObject({ kind: "invitation", invitation: {
      status: "pending", grant: { kind: "place_view", placeAlias: "Private house" },
    } });
    expect(await open("random-missing")).toEqual(unavailable("unavailable"));
    expect(await open("stale")).toEqual(unavailable("expired"));
    expect(await open("stale", other)).toEqual(unavailable("unavailable"));
    expect(await open("quote-link")).toMatchObject({ kind: "job", record: { audience: "customer",
      job: { jobId: "job", view: "whole", quote: { versionId: "issued" } } } });
    expect(await open("partial")).toEqual(unavailable("removed"));
    expect(await open("live")).toMatchObject({ kind: "job", record: { audience: "customer",
      job: { jobId: "job", view: "today", visit: { visitId: "target-visit" } } } });
    await db.prepare("UPDATE visits SET state='finished' WHERE id='target-visit'").run();
    clock.mockReturnValue(now + 3 * minute);
    expect(await open("live")).toMatchObject({ kind: "job", record: { audience: "customer",
      job: { view: "today", visit: { visitId: "target-visit" } } } });
    clock.mockReturnValue(now);
    expect(await open(token)).toEqual({ kind: "switch_context", targetKind: "job", activeContextId: "recipient-customer",
      choices: [{ scope: { contextId: "recipient-foreman", role: "foreman", businessId: "business" }, businessName: "Book Service" }] });
    await db.prepare("UPDATE businesses SET state='pending' WHERE id='business'").run();
    expect(await open(token)).toEqual(unavailable("pending"));
    await db.prepare("UPDATE businesses SET state='approved' WHERE id='business'").run();
    await db.prepare("UPDATE sessions SET active_context_id='recipient-foreman' WHERE id='recipient-session'").run();
    expect(await open(token)).toMatchObject({ kind: "job", record: { audience: "foreman", job: { jobId: "job", view: "whole" } } });
    await db.prepare("UPDATE membership_roles SET revoked_at=?, revoked_by='sender' WHERE id='foreman-role'").bind(now).run();
    expect(await open(token)).toEqual(unavailable("removed"));
    await db.prepare("UPDATE accounts SET email_key='new-mailbox' WHERE id='recipient'").run();
    expect(await open(inviteToken)).toEqual(unavailable("wrong_account"));
  } finally { clock.mockRestore(); db.close(); }
});

test("push claims once, localizes opaque-only notices and batches Expo tickets and receipts", async () => {
  const { db, env } = await fixture();
  const expiry = now + minute;
  try {
    await db.batch([
      db.prepare(`INSERT INTO link_targets VALUES
        ('recipient-link','job_update','private-job-id','recipient-customer',?),
        ('other-link','job_update','private-job-id','other-customer',?),
        ('stale-cover','cover_offer','withdrawn-cover','recipient-customer',?)`).bind(expiry, expiry, expiry),
      db.prepare(`INSERT INTO notifications (id,context_id,event_key,kind,link_token,created_at) VALUES
        ('recipient-notice','recipient-customer','Private property 19 Private Street','job_update','recipient-link',?),
        ('other-notice','other-customer','Private quote amount 100 EUR','quote_ready','other-link',?),
        ('no-link','recipient-customer','Private linkless event','quote_ready',NULL,?),
        ('old-cover','recipient-customer','Old cover event','cover_offer','stale-cover',?),
        ('wrong-scope','recipient-customer','Wrong context event','job_update','other-link',?)`).bind(now, now, now, now, now),
      db.prepare(`INSERT INTO effect_outbox SELECT 'effect-' || id, 'notification_push', event_key, id, ?, 'pending', ? FROM notifications`)
        .bind(now, expiry),
      db.prepare(`INSERT INTO push_installations SELECT 'i-' || value, 'recipient', 'ExpoPushToken[i-' || value || ']', 1,
        'ios', CASE WHEN value=100 THEN 'revoked' ELSE 'active' END, ? FROM json_each(?)`)
        .bind(now, JSON.stringify(Array.from({ length: 101 }, (_, i) => i))),
      db.prepare("INSERT INTO push_installations VALUES ('i-other','other','ExpoPushToken[i-other]',1,'android','active',?)").bind(now),
    ]);
    const sends: ExpoMessage[][] = [];
    const claimCounts: number[] = [];
    const sendHeaders: string[] = [];
    const baseline = { ...db.calls };
    const send: ExpoFetch = async (url, request) => {
      expect(url).toBe("https://exp.host/--/api/v2/push/send");
      const batch = JSON.parse(request.body as string) as ExpoMessage[];
      sends.push(batch);
      claimCounts.push(db.calls.batch - baseline.batch);
      sendHeaders.push(new Headers(request.headers).get("Authorization") ?? "");
      return Response.json({ data: batch.map(({ to }) => {
        const id = to.slice("ExpoPushToken[".length, -1);
        return id === "i-0" ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: `ticket-${id}` };
      }) });
    };
    const keys = ["effect-recipient-notice", "effect-other-notice", "effect-no-link", "effect-old-cover", "effect-wrong-scope"];
    await runEffectBatch(env, keys, now, send);
    expect(claimCounts).toEqual([1, 1]);
    expect(db.calls.batch - baseline.batch).toBe(2);
    expect(db.calls.query - baseline.query).toBe(0);
    expect(sends.map(({ length }) => length)).toEqual([100, 1]);
    expect(sendHeaders).toEqual(Array(2).fill(`Bearer ${env.EXPO_ACCESS_TOKEN}`));
    expect(new Set(sends.flat().map(({ to }) => to)).size).toBe(101);
    expect(sends.flat().find(({ to }) => to === "ExpoPushToken[i-1]")).toEqual({
      to: "ExpoPushToken[i-1]", title: "BookBuddy", body: "Tem uma atualização.", data: { url: `${origin}/l/recipient-link` },
    });
    expect(sends.flat().find(({ to }) => to === "ExpoPushToken[i-other]")).toEqual({
      to: "ExpoPushToken[i-other]", title: "BookBuddy", body: "You have an update.", data: { url: `${origin}/l/other-link` },
    });
    expect(JSON.stringify(sends)).not.toMatch(/Private Street|private-job-id|100 EUR|accept|i-100/);
    expect(await db.prepare("SELECT state FROM push_installations WHERE id='i-0'").first("state")).toBe("disabled");
    expect(await db.prepare("SELECT count(*) AS n FROM push_tickets WHERE state='due'").first("n")).toBe(100);
    expect(await db.prepare("SELECT count(*) AS n FROM effect_outbox WHERE state='skipped'").first("n")).toBe(3);

    const replay = { ...db.calls };
    await runEffectBatch(env, keys, now + 1, send);
    expect(sends).toHaveLength(2);
    expect(db.calls.batch - replay.batch).toBe(1);

    const due = now + 15 * minute;
    await db.batch([
      db.prepare("UPDATE push_installations SET token='ExpoPushToken[rotated]', token_epoch=2 WHERE id='i-2'"),
      db.prepare(`INSERT INTO push_tickets SELECT 'synthetic-' || value, 'effect-recipient-notice', 'i-3', 1, ?, 'due'
        FROM json_each(?)`).bind(due, JSON.stringify(Array.from({ length: 901 }, (_, i) => i))),
    ]);
    const receiptCalls: string[][] = [];
    const receipts: ExpoFetch = async (url, request) => {
      expect(url).toBe("https://exp.host/--/api/v2/push/getReceipts");
      const { ids } = JSON.parse(request.body as string) as { ids: string[] };
      receiptCalls.push(ids);
      return Response.json({ data: Object.fromEntries(ids.map((id) => [id, id === "ticket-i-1" || id === "ticket-i-2"
        ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok" }])) });
    };
    const receiptBaseline = { ...db.calls };
    await sweepPushReceipts(env, due, receipts);
    expect(receiptCalls.map(({ length }) => length)).toEqual([1000, 1]);
    expect(db.calls.query - receiptBaseline.query).toBe(1);
    expect(db.calls.batch - receiptBaseline.batch).toBe(1);
    expect(await db.prepare("SELECT state FROM push_installations WHERE id='i-1'").first("state")).toBe("disabled");
    expect(await db.prepare("SELECT state FROM push_installations WHERE id='i-2'").first("state")).toBe("active");
    expect(await db.prepare("SELECT state FROM push_tickets WHERE id='ticket-i-1'").first("state")).toBe("rejected");
    expect(await db.prepare("SELECT count(*) AS n FROM push_tickets WHERE state='delivered'").first("n")).toBe(999);
  } finally { db.close(); }
});

test("an ambiguous Expo send is not retried by a duplicate wake or due sweep", async () => {
  const { db, env } = await fixture();
  try {
    await db.batch([
      db.prepare("INSERT INTO link_targets VALUES ('dest','job_update','job','recipient-customer',?)").bind(now + minute),
      db.prepare("INSERT INTO notifications VALUES ('n','recipient-customer','event','job_update','dest',?,NULL)").bind(now),
      db.prepare("INSERT INTO effect_outbox VALUES ('effect','notification_push','event','n',?,'pending',?)").bind(now, now + minute),
      db.prepare("INSERT INTO push_installations VALUES ('phone','recipient','ExpoPushToken[phone]',1,'ios','active',?)").bind(now),
    ]);
    let calls = 0;
    const ambiguous: ExpoFetch = async () => { calls++; throw new Error("connection ended after request"); };
    await runEffectBatch(env, ["effect"], now, ambiguous);
    await runEffectBatch(env, ["effect"], now + 1, ambiguous);
    await runEffectBatch(env, null, now + 2 * minute, ambiguous);
    expect(calls).toBe(1);
    expect(await db.prepare("SELECT state FROM effect_outbox WHERE id='effect'").first("state")).toBe("unknown");
  } finally { db.close(); }
});
