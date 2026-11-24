import { expect, spyOn, test } from "bun:test";
import { getJobRoute, offerJobHandoffRoute, openLinkRoute, operationIdHeader, resultSchema, submitRequestRoute, submitSupportRoute } from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { runEffectBatch } from "../src/effects";
import { randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential } from "../src/modules/auth/session";
import { createTestD1 } from "./d1";

const origin = "https://bookbuddy.test";
const friday = Date.parse("2026-10-23T15:50:00Z"); // 17:50 in Spain, before the weekend's clock change.
const tuesday = Date.parse("2026-10-27T08:50:00Z");
const hour = 60 * 60_000;
const requestPayload = { placeId: "place", trade: "carpentry", originalText: "  Door needs a repair  ", arrivalArrangement: "requester" };

async function fixture() {
  const db = await createTestD1();
  const app = createApp();
  const notices: (readonly string[])[] = [];
  const env = { DB: db, OTP_HMAC_KEY: "a-test-only-support-lookup-key-of-32-bytes", EFFECTS_ENCRYPTION_KEY: "A".repeat(43),
    EFFECTS: { async send(wake: { workKeys: readonly string[] }) { notices.push(wake.workKeys); } },
    LIVE: { getByName() { return { async publishInvalidation() {} }; } },
  } as unknown as Bindings;
  const execution = { waitUntil() {}, passThroughOnException() {} };
  const actors = ["customer", "other", "admin", "peer", "first", "second", "third"] as const;
  const tokens = await Promise.all(actors.map(async (actor) => {
    const token = randomToken();
    return { actor, token, digest: await hashSessionCredential(token) };
  }));
  await db.batch([
    ...tokens.flatMap(({ actor, digest }) => [
      db.prepare("INSERT INTO accounts (id, email_normalized, display_name, verified_at, setup_at, state) VALUES (?, ?, ?, 1, 1, 'active')")
        .bind(actor, `${actor}@example.test`, actor),
      db.prepare("INSERT INTO account_contexts (id, account_id, role) VALUES (?, ?, 'customer')").bind(`${actor}-customer`, actor),
      db.prepare(`INSERT INTO sessions (id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
        VALUES (?, ?, ?, ?, 'device', 1, ?)`).bind(`${actor}-session`, actor, digest, `${actor}-customer`, friday + 120 * 24 * hour),
    ]),
    db.prepare("INSERT INTO operating_areas (id, name, site_zone, polygon) VALUES ('area', 'Fixture', 'Europe/Madrid', '[0]')"),
    ...[1, 2, 3, 4, 5].map((day) => db.prepare(`INSERT INTO staffed_calendar (id, area_id, weekday, opens_minute, closes_minute)
      VALUES (?, 'area', ?, 480, 1080)`).bind(`staffed-${day}`, day)),
    db.prepare("INSERT INTO staffed_calendar (id, area_id, local_date) VALUES ('closed-monday', 'area', '2026-10-26')"),
    db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
      VALUES ('business', 'Provider LLC', 'Provider', 'work@example.test', 'area', 'approved')`),
    ...(["admin", "peer", "first", "second", "third"] as const).flatMap((actor) => {
      const role = ["admin", "peer"].includes(actor) ? "provider_admin" : "foreman";
      return [
        db.prepare("INSERT INTO memberships (id, business_id, account_id, state) VALUES (?, 'business', ?, 'active')").bind(`${actor}-member`, actor),
        db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at)
          VALUES (?, ?, 'business', ?, ?, 1)`).bind(`${actor}-role`, `${actor}-member`, actor, role),
        db.prepare(`INSERT INTO account_contexts (id, account_id, role, business_id, role_grant_id)
          VALUES (?, ?, ?, 'business', ?)`).bind(`${actor}-staff`, actor, role, `${actor}-role`),
        db.prepare("UPDATE sessions SET active_context_id = ? WHERE account_id = ?").bind(`${actor}-staff`, actor),
      ];
    }),
    db.prepare(`INSERT INTO business_grants (id, business_id, membership_id, capability, issuer_id, valid_from) VALUES
      ('handoff', 'business', 'admin-member', 'handoff', 'peer', 1),
      ('peer-handoff', 'business', 'peer-member', 'handoff', 'admin', 1),
      ('membership-admin', 'business', 'admin-member', 'membership_admin', 'peer', 1)`),
    db.prepare("UPDATE businesses SET default_foreman_id = 'first-member' WHERE id = 'business'"),
    db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state)
      VALUES ('place', 'customer', 'Home', 'Private address', 'pending_verification')`),
    db.prepare("INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES ('place', 'customer', 1, 1)"),
    db.prepare(`UPDATE places SET state = 'in_area', named_approver_id = 'customer', area_id = 'area', site_zone = 'Europe/Madrid',
      pin = '{"latitude":0,"longitude":0}' WHERE id = 'place'`),
    db.prepare(`INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, valid_from)
      VALUES ('request-grant', 'place', 'customer', 'request', 'customer', 1)`),
  ]);
  const credentials = new Map(tokens.map(({ actor, token }) => [actor, token]));
  type Actor = typeof actors[number];
  type Body = { operationId: string; expectedRevision?: number; payload: unknown };
  async function call(path: string, actor: Actor | null, body?: Body, verifyBatches: 0 | 1 | false = 1, source = "192.0.2.5") {
    const { batch, query } = db.calls;
    const response = await app.request(`${origin}/api/v1${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        ...(actor ? { Authorization: `Bearer ${credentials.get(actor)}` } : { "CF-Connecting-IP": source }),
        ...(body ? { [operationIdHeader]: body.operationId, "Content-Type": "application/json" } : {}),
      },
      body: body && JSON.stringify(body),
    }, env, execution);
    if (verifyBatches !== false) {
      expect(db.calls.batch - batch).toBe(verifyBatches);
      expect(db.calls.query - query).toBe(0);
    }
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    return { status: response.status, body: await response.json() };
  }
  async function job(incumbent = "first-member") {
    await db.prepare(`INSERT INTO jobs (id, reference, business_id, place_id, requester_id, accountable_foreman_membership_id, origin, state)
      VALUES ('job', 'BB-JOB', 'business', 'place', 'customer', ?, 'provider', 'open')`).bind(incumbent).run();
  }
  return { db, call, job, notices };
}

test("text request makes an unassigned job, durable intake offer and safe replay, never a booking", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(friday);
  const f = await fixture();
  try {
    const safeNote = "Ring at number 24 after 10:30";
    const body = { operationId: "submit", expectedRevision: 0, payload: { ...requestPayload, safeNote } };
    expect(await f.call("/requests", "customer", { ...body, payload: { ...body.payload, safeNote: "Gate code: 4321" } }, 0))
      .toEqual({ status: 422, body: { ok: false, error: { code: "VALIDATION_FAILED" }, meta: { requestId: expect.any(String) } } });
    expect((await f.call("/requests", "other", body)).status).toBe(404);
    expect((await f.call("/requests", "customer", { ...body, expectedRevision: 1 })).body)
      .toMatchObject({ error: { code: "STALE_REVISION", current: { kind: "revision", revision: 0 } } });
    const response = resultSchema(submitRequestRoute.output).parse((await f.call("/requests", "customer", body)).body);
    if (!response.ok) throw new Error(JSON.stringify(response));
    const { jobId } = response.data;
    expect(response.data.journey).toEqual({ step: "requested", cancelled: false, complete: false });
    expect(await f.db.prepare("SELECT state, accountable_foreman_membership_id AS incumbent FROM jobs WHERE id = ?").bind(jobId).first())
      .toEqual({ state: "open", incumbent: null });
    expect(await f.db.prepare("SELECT original_text, safe_note FROM requests WHERE job_id = ?").bind(jobId).first())
      .toEqual({ original_text: requestPayload.originalText, safe_note: safeNote });
    expect(await f.db.prepare("SELECT count(*) AS count FROM visits WHERE job_id = ?").bind(jobId).first("count")).toBe(0);
    const offer = await f.db.prepare("SELECT id, recipient_id, expires_at FROM job_handoffs WHERE job_id = ?").bind(jobId)
      .first<{ id: string; recipient_id: string; expires_at: number }>();
    expect(offer).toMatchObject({ recipient_id: "first-member", expires_at: tuesday });
    expect(await f.db.prepare("SELECT valid_until FROM job_grants WHERE job_id = ? AND context_id = 'first-staff' AND capability = 'intake'")
      .bind(jobId).first("valid_until")).toBe(tuesday);
    expect(await f.db.prepare("SELECT kind, partition_key FROM sync_changes WHERE resource_id = ?").bind(offer!.id).first())
      .toMatchObject({ kind: "job_handoff", partition_key: "first-staff" });
    const link = await f.db.prepare(`SELECT t.token, t.resource_id, t.expires_at FROM notifications n
      JOIN link_targets t ON t.token = n.link_token AND t.required_scope = n.context_id
      WHERE n.context_id = 'first-staff' AND t.kind = 'job_handoff'`).first<{ token: string }>();
    expect(link).toMatchObject({ resource_id: offer!.id, expires_at: tuesday });
    expect((await f.call(`/jobs/${jobId}`, "first")).status).toBe(404);
    const path = `/links/${link!.token}`;
    const opened = resultSchema(openLinkRoute.output).parse((await f.call(path, "first")).body);
    expect(opened).toMatchObject({ data: { kind: "job", record: { audience: "foreman",
      job: { jobId, view: "intake", handoff: { handoffId: offer!.id }, request: { originalText: requestPayload.originalText } } } } });
    expect(JSON.stringify(opened)).not.toContain("Private address");
    expect((await f.call(path, "second")).body).toMatchObject({ data: { kind: "unavailable", reason: "unavailable" } });
    expect(f.notices).toHaveLength(1);
    await f.db.prepare(`INSERT INTO push_installations (id,account_id,device_id,session_id,token,token_epoch,platform,state,updated_at)
      VALUES ('phone','first','device','first-session','ExpoPushToken[phone]',1,'ios','active',?)`).bind(friday).run();
    const sent: unknown[] = [];
    await runEffectBatch({ DB: f.db, PUBLIC_APP_ORIGIN: origin } as Bindings, f.notices[0]!, friday, async (_url, request) => {
      sent.push(JSON.parse(request.body as string));
      return Response.json({ data: [{ status: "ok", id: "intake-delivery" }] });
    });
    expect(sent).toEqual([[{ to: "ExpoPushToken[phone]", title: "BookBuddy", body: "You have an update.", data: { url: `${origin}/l/${link!.token}` } }]]);
    expect((await f.call("/requests", "customer", body)).body).toMatchObject({ data: response.data });
    expect((await f.call("/requests", "customer", { ...body, payload: { ...requestPayload, originalText: "Changed" } })).body)
      .toMatchObject({ error: { code: "OPERATION_ID_REUSED" } });
    expect((await f.call("/operations/submit", "customer")).body).toMatchObject({ data: { operationId: "submit", status: "committed", committedAt: friday } });
    expect((await f.call("/operations/submit", "other")).status).toBe(404);
    expect(f.notices).toHaveLength(1);
    await f.db.prepare("DELETE FROM operation_receipts WHERE operation_id = 'submit'").run();
    expect((await f.call("/requests", "customer", body)).status).toBe(409);
    expect(await f.db.prepare("SELECT count(*) AS count FROM jobs").first("count")).toBe(1);
  } finally { f.db.close(); clock.mockRestore(); }
});

test("request links staged media, accepts voice instead of text, and projects IDs to authorized readers", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(friday);
  const f = await fixture();
  try {
    await f.db.batch([
      f.db.prepare(`INSERT INTO media_stages VALUES ('draft', 'customer-customer', 'request', 'place', 1, ?)`).bind(tuesday),
      f.db.prepare(`INSERT INTO attachments (id, stage_id, object_key, mime, bytes, duration_ms, state, etag, retention_class)
        VALUES ('voice', 'draft', 'private-voice-key', 'audio/mp4', 1024, 1200, 'ready', 'voice-etag', 'unlinked'),
               ('photo', 'draft', 'private-photo-key', 'image/jpeg', 1024, NULL, 'ready', 'photo-etag', 'unlinked')`),
    ]);
    const body = { operationId: "request-with-voice", expectedRevision: 0, payload: {
      ...requestPayload, originalText: " \n\t", originalLanguage: "en", attachmentIds: ["voice", "photo"],
    } };
    const response = resultSchema(submitRequestRoute.output).parse((await f.call("/requests", "customer", body)).body);
    if (!response.ok) throw new Error(JSON.stringify(response));
    const { jobId } = response.data;
    expect(await f.db.prepare("SELECT original_text FROM requests WHERE job_id = ?").bind(jobId).first()).toEqual({ original_text: null });
    expect((await f.db.prepare(`SELECT a.id, a.retention_class FROM request_attachments link
      JOIN attachments a ON a.id = link.attachment_id WHERE link.job_id = ? ORDER BY a.id`).bind(jobId).all()).results)
      .toEqual([{ id: "photo", retention_class: "ordinary" }, { id: "voice", retention_class: "ordinary" }]);

    const customer = resultSchema(getJobRoute.output).parse((await f.call(`/jobs/${jobId}`, "customer")).body);
    expect(customer).toMatchObject({ ok: true, data: { job: { attachmentIds: ["photo", "voice"] } } });
    const intake = resultSchema(getJobRoute.output).parse((await f.call(`/jobs/${jobId}?view=intake`, "first")).body);
    expect(intake).toMatchObject({ ok: true, data: { job: { request: {
      originalText: null, attachmentIds: ["photo", "voice"],
      photos: [{ attachmentId: "photo", availability: "available" }],
      originalVoice: { attachmentId: "voice", availability: "available", durationMs: 1200, language: "en" },
    } } } });
    expect(JSON.stringify([customer, intake])).not.toMatch(/private-(voice|photo)-key|voice-etag|photo-etag/);
    expect((await f.call(`/jobs/${jobId}`, "other")).status).toBe(404);
    expect((await f.call(`/jobs/${jobId}?view=intake`, "second")).status).toBe(404);

    // Receipt replay does not depend on the state of the already consumed draft.
    await f.db.prepare("UPDATE media_stages SET expires_at = ? WHERE id = 'draft'").bind(friday).run();
    expect((await f.call("/requests", "customer", body)).body).toMatchObject({ data: response.data });
    expect(await f.db.prepare("SELECT count(*) AS count FROM request_attachments").first("count")).toBe(2);
    expect(f.notices).toHaveLength(1);
  } finally { f.db.close(); clock.mockRestore(); }
});

test("invalid request evidence rejects the entire command in one D1 batch", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(friday);
  const f = await fixture();
  try {
    await f.db.batch([
      f.db.prepare(`INSERT INTO media_stages VALUES
        ('draft', 'customer-customer', 'request', 'place', 1, ?),
        ('foreign-draft', 'other-customer', 'request', 'place', 1, ?),
        ('other-place-draft', 'customer-customer', 'request', 'other-place', 1, ?),
        ('wrong-caller-draft', 'customer-customer', 'chat', 'place', 1, ?),
        ('second-draft', 'customer-customer', 'request', 'place', 1, ?),
        ('expired-draft', 'customer-customer', 'request', 'place', 1, ?)`).bind(tuesday, tuesday, tuesday, tuesday, tuesday, friday),
      f.db.prepare(`INSERT INTO attachments (id, stage_id, object_key, mime, bytes, duration_ms, state, etag, retention_class)
        VALUES ('photo', 'draft', 'key-photo', 'image/jpeg', 1024, NULL, 'ready', 'etag', 'unlinked'),
               ('unready', 'draft', 'key-unready', 'audio/mp4', 1024, 1200, 'uploading', NULL, 'unlinked'),
               ('foreign', 'foreign-draft', 'key-foreign', 'image/jpeg', 1024, NULL, 'ready', 'etag', 'unlinked'),
               ('other-place', 'other-place-draft', 'key-other', 'image/jpeg', 1024, NULL, 'ready', 'etag', 'unlinked'),
               ('wrong-caller', 'wrong-caller-draft', 'key-caller', 'image/jpeg', 1024, NULL, 'ready', 'etag', 'unlinked'),
               ('expired', 'expired-draft', 'key-expired', 'image/jpeg', 1024, NULL, 'ready', 'etag', 'unlinked'),
               ('first-voice', 'draft', 'key-first-voice', 'audio/mp4', 1024, 1200, 'ready', 'etag', 'unlinked'),
               ('second-voice', 'second-draft', 'key-second-voice', 'audio/mp4', 1024, 1200, 'ready', 'etag', 'unlinked')`),
      f.db.prepare(`INSERT INTO attachments (id, stage_id, object_key, mime, bytes, state, etag, retention_class)
        SELECT value, 'second-draft', 'key-' || value, 'image/jpeg', 1024, 'ready', 'etag', 'unlinked'
        FROM json_each('["extra-1","extra-2","extra-3","extra-4","extra-5"]')`),
    ]);
    for (const id of ["foreign", "unready", "other-place", "wrong-caller", "expired", "missing"]) {
      expect(await f.call("/requests", "customer", { operationId: `with-${id}`, expectedRevision: 0,
        payload: { ...requestPayload, attachmentIds: ["photo", id] } })).toMatchObject({
        status: 409, body: { error: { code: "CONFLICT" } },
      });
    }
    expect(await f.call("/requests", "customer", { operationId: "photo-only", expectedRevision: 0,
      payload: { ...requestPayload, originalText: "", attachmentIds: ["photo"] } })).toMatchObject({
      status: 409, body: { error: { code: "CONFLICT" } },
    });
    for (const [operationId, attachmentIds] of [
      ["too-many-photos", ["photo", "extra-1", "extra-2", "extra-3", "extra-4", "extra-5"]],
      ["too-many-voices", ["first-voice", "second-voice"]],
    ] as const) {
      expect(await f.call("/requests", "customer", { operationId, expectedRevision: 0,
        payload: { ...requestPayload, attachmentIds } })).toMatchObject({ status: 409, body: { error: { code: "CONFLICT" } } });
    }
    expect(await f.db.prepare(`SELECT (SELECT count(*) FROM jobs) AS jobs,
      (SELECT count(*) FROM requests) AS requests, (SELECT count(*) FROM request_attachments) AS links,
      (SELECT count(*) FROM operation_receipts) AS receipts, (SELECT count(*) FROM job_handoffs) AS handoffs,
      (SELECT count(*) FROM sync_changes) AS changes, (SELECT count(*) FROM effect_outbox) AS effects,
      (SELECT retention_class FROM attachments WHERE id = 'photo') AS photo`).first())
      .toEqual({ jobs: 0, requests: 0, links: 0, receipts: 0, handoffs: 0, changes: 0, effects: 0, photo: "unlinked" });
    expect(f.notices).toHaveLength(0);
  } finally { f.db.close(); clock.mockRestore(); }
});

test("only the intended foreman takes an open job; a non-default incumbent cannot be revoked before handoff", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(tuesday);
  const f = await fixture();
  try {
    await f.job("third-member");
    const revoke = { operationId: "revoke", payload: { roleGrantId: "third-role" } };
    expect((await f.call("/members/third-member/revoke", "admin", revoke)).status).toBe(409);
    const body = { operationId: "offer", expectedRevision: 0, payload: { recipientMembershipId: "second-member", urgentCallConfirmed: true } };
    expect((await f.call("/jobs/job/handoffs", "first", body)).status).toBe(404);
    const opened = resultSchema(offerJobHandoffRoute.output).parse((await f.call("/jobs/job/handoffs", "admin", body)).body);
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    expect(opened.data).toMatchObject({ expiresAt: tuesday + hour / 2, revision: 1, state: "offered" });
    expect(await f.db.prepare("SELECT accountable_foreman_membership_id FROM jobs WHERE id = 'job'").first("accountable_foreman_membership_id"))
      .toBe("third-member");
    const token = await f.db.prepare(`SELECT token FROM link_targets
      WHERE kind='job_handoff' AND resource_id=? AND required_scope='second-staff'`).bind(opened.data.handoffId).first<string>("token");
    expect(token).toBeTruthy();
    expect((await f.call(`/links/${token}`, "second")).body).toMatchObject({ data: { kind: "job", record: {
      audience: "foreman", job: { jobId: "job", view: "intake", request: null, handoff: { handoffId: opened.data.handoffId } },
    } } });
    const path = `/jobs/job/handoffs/${opened.data.handoffId}`;
    const decide = { operationId: "accept", expectedRevision: 1, payload: {} };
    expect((await f.call(`${path}/withdraw`, "peer", decide)).status).toBe(404);
    expect((await f.call(`${path}/accept`, "first", decide)).status).toBe(404);
    const accepted = await f.call(`${path}/accept`, "second", decide);
    expect(accepted.body).toMatchObject({ data: { state: "accepted", revision: 2, endedAt: tuesday } });
    expect(await f.db.prepare("SELECT accountable_foreman_membership_id FROM jobs WHERE id = 'job'").first("accountable_foreman_membership_id"))
      .toBe("second-member");
    expect(await f.db.prepare("SELECT revoked_at FROM job_grants WHERE context_id = 'second-staff'").first("revoked_at")).toBe(tuesday);
    expect(await f.db.prepare("SELECT visibility_epoch FROM sync_scope_state WHERE context_id = 'third-staff'").first("visibility_epoch")).toBe(1);
    expect((await f.call(`/links/${token}`, "second")).body).toMatchObject({ data: { kind: "unavailable", reason: "removed" } });
    expect((await f.call(`${path}/accept`, "second", decide)).body).toMatchObject({ data: accepted.body.data });
    expect((await f.call("/jobs/job/handoffs", "admin", body)).body).toMatchObject({ data: opened.data });
    expect(f.notices).toHaveLength(2);
    expect((await f.call("/members/third-member/revoke", "admin", revoke)).status).toBe(200);
    await f.db.prepare("UPDATE sessions SET active_context_id = 'second-customer' WHERE account_id = 'second'").run();
    expect((await f.call("/operations/accept", "second")).status).toBe(404);
  } finally { f.db.close(); clock.mockRestore(); }
});

test("accept and withdraw race to one committed outcome and no losing effects", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(tuesday);
  const f = await fixture();
  try {
    await f.job();
    const opened = resultSchema(offerJobHandoffRoute.output).parse((await f.call("/jobs/job/handoffs", "admin", {
      operationId: "offer", expectedRevision: 0, payload: { recipientMembershipId: "second-member" },
    })).body);
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    const path = `/jobs/job/handoffs/${opened.data.handoffId}`;
    const { batch, query } = f.db.calls;
    const [accept, withdraw] = await Promise.all([
      f.call(`${path}/accept`, "second", { operationId: "race-accept", expectedRevision: 1, payload: {} }, false),
      f.call(`${path}/withdraw`, "admin", { operationId: "race-withdraw", expectedRevision: 1, payload: {} }, false),
    ]);
    expect(f.db.calls.batch - batch).toBe(2);
    expect(f.db.calls.query - query).toBe(0);
    expect([accept.status, withdraw.status].sort()).toEqual([200, 409]);
    expect(await f.db.prepare("SELECT state FROM job_handoffs WHERE id = ?").bind(opened.data.handoffId).first("state"))
      .toBe(accept.status === 200 ? "accepted" : "withdrawn");
    expect(await f.db.prepare("SELECT accountable_foreman_membership_id, revision FROM jobs WHERE id = 'job'").first())
      .toMatchObject({ accountable_foreman_membership_id: accept.status === 200 ? "second-member" : "first-member", revision: 2 });
    expect(await f.db.prepare("SELECT count(*) AS count FROM operation_receipts WHERE operation_id LIKE 'race-%'").first("count")).toBe(1);
    expect(f.notices).toHaveLength(2);
  } finally { f.db.close(); clock.mockRestore(); }
});

test("the deadline is exclusive; an expired offer may be reoffered only once to an alternate", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(friday);
  const f = await fixture();
  try {
    await f.job();
    const offer = { operationId: "offer", expectedRevision: 0, payload: { recipientMembershipId: "second-member" } };
    const opened = resultSchema(offerJobHandoffRoute.output).parse((await f.call("/jobs/job/handoffs", "admin", offer)).body);
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    expect(opened.data.expiresAt).toBe(tuesday);
    clock.mockReturnValue(tuesday);
    const id = opened.data.handoffId, decline = { operationId: "decline", expectedRevision: 2, payload: { reason: "Not available" } };
    expect((await f.call(`/jobs/job/handoffs/${id}/accept`, "second", { ...decline, expectedRevision: 1, payload: {} })).status).toBe(409);
    const reoffer = { operationId: "reoffer", expectedRevision: 1, payload: { recipientMembershipId: "third-member", reofferOfId: id } };
    expect((await f.call("/jobs/job/handoffs", "admin", { ...reoffer, payload: { ...reoffer.payload, recipientMembershipId: "second-member" } })).status).toBe(409);
    const reopened = resultSchema(offerJobHandoffRoute.output).parse((await f.call("/jobs/job/handoffs", "admin", reoffer)).body);
    if (!reopened.ok) throw new Error(JSON.stringify(reopened));
    expect(await f.db.prepare("SELECT state FROM job_handoffs WHERE id = ?").bind(id).first("state")).toBe("expired");
    expect((await f.call(`/jobs/job/handoffs/${reopened.data.handoffId}/decline`, "third", decline)).body)
      .toMatchObject({ data: { state: "declined", revision: 3 } });
    expect((await f.call("/jobs/job/handoffs", "admin", { ...offer, operationId: "reset", expectedRevision: 3 })).status).toBe(409);
    expect((await f.call("/jobs/job/handoffs", "admin", { ...reoffer, operationId: "chained", expectedRevision: 3, payload: {
      recipientMembershipId: "second-member", reofferOfId: reopened.data.handoffId,
    } })).status).toBe(409);
    expect(await f.db.prepare("SELECT accountable_foreman_membership_id FROM jobs WHERE id = 'job'").first("accountable_foreman_membership_id"))
      .toBe("first-member");
  } finally { f.db.close(); clock.mockRestore(); }
});

test("support takes opaque contact intake with independent anonymous limits and scoped receipts", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(tuesday);
  const f = await fixture();
  try {
    const contact = { operationId: "need-help", payload: { kind: "access", reference: "unknown-record", message: "Cannot open my link", replyEmail: "person@example.test" } };
    const anonymous = resultSchema(submitSupportRoute.output).parse((await f.call("/support", null, contact)).body);
    if (!anonymous.ok) throw new Error(JSON.stringify(anonymous));
    expect(anonymous.data.reference).not.toBe(contact.payload.reference);
    expect(await f.db.prepare("SELECT reporter_id, reply_email_ciphertext FROM support_cases WHERE id = ?").bind(anonymous.data.reference).first())
      .toMatchObject({ reporter_id: null, reply_email_ciphertext: expect.any(String) });
    expect(await f.db.prepare("SELECT reply_email_ciphertext FROM support_cases WHERE id = ?").bind(anonymous.data.reference).first("reply_email_ciphertext"))
      .not.toBe(contact.payload.replyEmail);
    for (const operationId of ["another", "third"]) expect((await f.call("/support", null, { ...contact, operationId })).status).toBe(200);
    expect((await f.call("/support", null, { ...contact, operationId: "limited" })).body)
      .toMatchObject({ error: { code: "RATE_LIMITED", retryAt: tuesday + hour } });
    expect((await f.call("/support", null, contact)).body).toMatchObject({ data: anonymous.data });
    expect((await f.call("/support", null, { ...contact, payload: { ...contact.payload, message: "Different" } })).body)
      .toMatchObject({ error: { code: "OPERATION_ID_REUSED" } });
    expect((await f.call("/support", "customer", contact)).status).toBe(200);
    expect((await f.call("/operations/need-help", "customer")).status).toBe(200);
    expect((await f.call("/operations/need-help", "other")).status).toBe(404);
    expect(f.notices).toHaveLength(4);
  } finally { f.db.close(); clock.mockRestore(); }
});

test("signed-in support caps new cases per account in a rolling day but replays for free", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(tuesday);
  const f = await fixture();
  const contact = { operationId: "first-help", payload: { kind: "access", message: "Cannot open my link" } };
  try {
    const original = await f.call("/support", "admin", contact);
    expect(original.status).toBe(200);
    clock.mockReturnValue(tuesday + hour);
    for (let i = 0; i < 8; i++) {
      expect((await f.call("/support", "admin", { ...contact, operationId: `help-${i}` })).status).toBe(200);
    }
    await f.db.prepare("UPDATE sessions SET active_context_id = 'admin-customer' WHERE account_id = 'admin'").run();
    const { batch, query } = f.db.calls;
    const competing = await Promise.all(["race-a", "race-b"].map((operationId) =>
      f.call("/support", "admin", { ...contact, operationId }, false)));
    expect(f.db.calls.batch - batch).toBe(2);
    expect(f.db.calls.query - query).toBe(0);
    expect(competing.map(({ status }) => status).sort()).toEqual([200, 429]);
    expect(competing.find(({ status }) => status === 429)?.body)
      .toMatchObject({ error: { code: "RATE_LIMITED", retryAt: tuesday + 24 * hour } });
    expect((await f.call("/support", "admin", contact)).body).toMatchObject({ data: original.body.data });
    expect((await f.call("/support", "admin", { ...contact, payload: { ...contact.payload, message: "Different" } })).body)
      .toMatchObject({ error: { code: "OPERATION_ID_REUSED" } });
    expect((await f.call("/support", "other", contact)).status).toBe(200);
    expect(f.notices).toHaveLength(11);
    clock.mockReturnValue(tuesday + 24 * hour);
    expect((await f.call("/support", "admin", { ...contact, operationId: "after-window" })).status).toBe(200);
    expect((await f.call("/support", "admin", { ...contact, operationId: "next-window" })).body)
      .toMatchObject({ error: { code: "RATE_LIMITED", retryAt: tuesday + 25 * hour } });
  } finally { f.db.close(); clock.mockRestore(); }
});
