import { expect, spyOn, test } from "bun:test";
import {
  approveChangeVersionRoute, approveQuoteVersionRoute, createQuoteVersionRoute, getQuoteVersionRoute,
  listContractNoticesRoute, listQuoteVersionsRoute, openLinkRoute, operationIdHeader, requestEarlyStartRoute, resultSchema,
  submitQuoteReviewRoute, withdrawContractRoute,
} from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential } from "../src/modules/auth/session";
import { commercialMailEffect } from "../src/modules/commercial/mail";
import { loadDeliveryKey } from "../src/modules/auth/crypto";
import { createTestD1 } from "./d1";

const start = Date.parse("2026-03-25T09:00:00.000Z");
const expiry = Date.parse("2026-04-01T08:00:00.000Z"); // DST starts at the site in between.
const day = 86_400_000;
const terms = { termsHash: "exact-terms-v1" };
const origin = "https://bookbuddy.test";
const secret = "A".repeat(43);
const viewers = ["customer", "guest", "stranger", "foreman", "reviewer", "backup", "admin"] as const;
type Viewer = (typeof viewers)[number];

async function fixture() {
  const db = await createTestD1();
  const app = createApp();
  // Keep SQLite failures observable while exercising the normal router mount.
  app.onError((error) => { throw error; });
  const wakes: string[][] = [];
  const env = { DB: db, EFFECTS: { async send({ workKeys }: { workKeys: string[] }) { wakes.push(workKeys); } } } as unknown as Bindings;
  const execution = { waitUntil() {}, passThroughOnException() {} };
  const accounts = await Promise.all(viewers.map(async (id) => {
    const credential = randomToken();
    return { id, credential, hash: await hashSessionCredential(credential) };
  }));
  await db.batch([
    ...accounts.flatMap(({ id, hash }) => [db.prepare(`INSERT INTO accounts(id, email_normalized, display_name, verified_at, setup_at, state)
      VALUES (?, ?, ?, 1, 1, 'active')`).bind(id, `${id}@example.test`, id),
    db.prepare("INSERT INTO account_contexts(id, account_id, role) VALUES (?, ?, 'customer')").bind(`${id}-customer`, id),
    db.prepare(`INSERT INTO sessions(id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
      VALUES (?, ?, ?, ?, 'device', 1, ?)`).bind(`${id}-session`, id, hash, `${id}-customer`, start + 100 * day)]),
    db.prepare("INSERT INTO operating_areas VALUES ('area', 'Area', 'Europe/Madrid', '[0]')"),
    db.prepare(`INSERT INTO businesses(id, legal_name, public_name, verified_work_contact, catchment_id, state)
      VALUES ('business', 'Provider Legal', 'Provider', 'work@example.test', 'area', 'approved')`),
    ...(["foreman", "reviewer", "backup", "admin"] as const).flatMap((id) => {
      const role = id === "foreman" ? "foreman" : "provider_admin";
      return [db.prepare("INSERT INTO memberships (id, business_id, account_id, state) VALUES (?, 'business', ?, 'active')").bind(`${id}-member`, id),
        db.prepare(`INSERT INTO membership_roles(id, membership_id, business_id, account_id, role, granted_at)
          VALUES (?, ?, 'business', ?, ?, 1)`).bind(`${id}-role`, `${id}-member`, id, role),
        db.prepare(`INSERT INTO account_contexts(id, account_id, role, business_id, role_grant_id)
          VALUES (?, ?, ?, 'business', ?)`).bind(`${id}-staff`, id, role, `${id}-role`),
        db.prepare("UPDATE sessions SET active_context_id = ? WHERE id = ?").bind(`${id}-staff`, `${id}-session`)];
    }),
    db.prepare(`INSERT INTO business_grants (id, business_id, membership_id, capability, issuer_id, valid_from) VALUES
      ('review', 'business', 'reviewer-member', 'review_commercial', 'admin', 1),
      ('backup', 'business', 'backup-member', 'review_commercial', 'admin', 1),
      ('admin-review', 'business', 'admin-member', 'review_commercial', 'admin', 1),
      ('publish', 'business', 'reviewer-member', 'publish_commercial', 'admin', 1)`),
    db.prepare(`INSERT INTO places(id, owner_id, alias, normalized_address, state)
      VALUES ('place', 'customer', 'Villa', 'Address', 'pending_verification')`),
    ...(["customer", "guest", "foreman", "reviewer"] as const).map((id) => db.prepare(`INSERT INTO place_people
      (place_id, account_id, verified_from, history_from) VALUES ('place', ?, 1, 1)`).bind(id)),
    db.prepare(`UPDATE places SET named_approver_id = 'customer', pin = '{"latitude":1,"longitude":1}',
      site_zone = 'Europe/Madrid', area_id = 'area', state = 'in_area' WHERE id = 'place'`),
    ...(["guest", "foreman", "reviewer"] as const).map((id) => db.prepare(`INSERT INTO place_grants
      (id, place_id, account_id, capability, issuer_id, valid_from) VALUES (?, 'place', ?, 'view', 'customer', 1)`).bind(`${id}-view`, id)),
    db.prepare(`INSERT INTO place_grants(id, place_id, account_id, capability, issuer_id, valid_from)
      VALUES ('approve-original', 'place', 'customer', 'approve', 'customer', 1)`),
    db.prepare(`INSERT INTO jobs(id, reference, business_id, place_id, requester_id, accountable_foreman_membership_id, trade, origin, state)
      VALUES ('job', 'BB-123', 'business', 'place', 'customer', 'foreman-member', 'Door repair', 'bookbuddy', 'open')`),
    db.prepare(`INSERT INTO requests(job_id, original_text, original_language, arrival_arrangement, submitted_at)
      VALUES ('job', 'Door repair', 'en', 'requester', 2)`),
    db.prepare(`INSERT INTO job_grants(job_id, context_id, capability, valid_from, valid_until) VALUES
      ('job', 'reviewer-staff', 'reviewer', 1, ?), ('job', 'backup-staff', 'backup', 1, ?)`).bind(start + 60 * day, start + 60 * day),
    db.prepare(`INSERT INTO terms_versions VALUES ('terms-v1', 'business', 1, 'Provider Legal', 'Exact original terms', 'es',
      'Exact contractual consent', '${terms.termsHash}')`),
  ]);

  async function request(path: string, viewer: Viewer, operationId?: string, payload: unknown = {}) {
    const { batch, query } = db.calls;
    const credential = accounts.find(({ id }) => id === viewer)!.credential;
    const response = await app.request(`${origin}/api/v1${path}`, {
      method: operationId ? "POST" : "GET",
      headers: { Authorization: `Bearer ${credential}`, ...(operationId ? { [operationIdHeader]: operationId, "Content-Type": "application/json" } : {}) },
      body: operationId ? JSON.stringify({ operationId, payload }) : undefined,
    }, env, execution);
    const batched = !!operationId || path.startsWith("/links/");
    expect(db.calls.batch - batch).toBe(batched ? 1 : 0);
    expect(db.calls.query - query).toBe(batched ? 0 : 1);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    return { status: response.status, body: await response.json() as unknown };
  }

  let transfers = 0;
  async function switchApprover(account: Viewer) {
    const id = `approve-transfer-${++transfers}`;
    await db.batch([
      db.prepare("UPDATE place_grants SET revoked_at = ? WHERE place_id = 'place' AND capability = 'approve' AND revoked_at IS NULL").bind(Date.now()),
      db.prepare("UPDATE places SET named_approver_id = ? WHERE id = 'place'").bind(account),
      db.prepare(`INSERT INTO place_grants(id, place_id, account_id, capability, issuer_id, valid_from)
        VALUES (?, 'place', ?, 'approve', 'customer', ?)`).bind(id, account, Date.now()),
      db.prepare("UPDATE sessions SET active_context_id = ? WHERE id = ?").bind(`${account}-customer`, `${account}-session`),
    ]);
    return id;
  }

  const quote = (id: string) => `/quote-versions/${id}`;
  const change = (id: string) => `/change-versions/${id}`;
  return { db, wakes, request, switchApprover, quote, change,
    draft: (id: string) => request("/jobs/job/quote-versions", "foreman", `create-${id}`, {
      id, termsVersionId: "terms-v1", originalLocale: "es", scope: "Cambiar los rodillos", exclusions: "No incluye el vidrio", evidence: [],
      items: [{ originalLabel: "Rodillos", quantity: 2, netMinor: 20_000, taxMinor: 4_000, evidenceRule: "Finished photo" }],
    }),
    changeDraft: (id: string) => request("/jobs/job/change-versions", "foreman", `create-${id}`, {
      id, termsVersionId: "terms-v1", originalLocale: "es", proposalId: "proposal", baseQuoteVersionId: "q1",
      originalText: "Sustituir el carril", affectedItems: "El carril", timing: "Same visit if separately confirmed", evidence: [],
      items: [{ originalLabel: "Carril", quantity: 1, netMinor: 3_000, taxMinor: 600, evidenceRule: "Finished photo" }],
    }),
    submit: (id: string) => request(`${quote(id)}/submit-review`, "foreman", `submit-${id}`),
    issue: (id: string) => request(`${quote(id)}/issue`, "reviewer", `issue-${id}`, terms),
    approve: (id: string, viewer: Viewer = "customer", operationId = `approve-${id}`) => request(`${quote(id)}/approve`, viewer, operationId, terms),
  };
}

const missing = { status: 404, body: { error: { code: "NOT_FOUND" } } };
const conflict = { status: 409, body: { error: { code: "CONFLICT" } } };

test("quote review, publication and exact approval respect live roles, privacy and immutable snapshots", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    expect(resultSchema(listQuoteVersionsRoute.output).parse((await f.request("/jobs/job/quotes", "foreman")).body))
      .toMatchObject({ data: { audience: "foreman", versions: [], currentTerms: { id: "terms-v1", version: 1 } } });
    const draft = resultSchema(createQuoteVersionRoute.output).parse((await f.draft("q1")).body);
    expect(draft).toMatchObject({ data: { audience: "foreman", state: "draft", totalMinor: 24000, actions: { submitReview: true, issue: false },
      items: [{ lineNo: 1, originalLabel: "Rodillos", quantity: 2 }] } });
    expect(await f.request("/jobs/job/quotes/q1", "customer")).toMatchObject(missing);
    expect(await f.request("/jobs/job/quotes/q1", "reviewer")).toMatchObject(missing);
    expect(resultSchema(listQuoteVersionsRoute.output).parse((await f.request("/jobs/job/quotes", "customer")).body))
      .toMatchObject({ data: { audience: "customer", versions: [] } });
    const submitted = resultSchema(submitQuoteReviewRoute.output).parse((await f.submit("q1")).body);
    expect(submitted).toMatchObject({ data: { state: "in_review", review: { reviewerDisplayName: "reviewer", backupDisplayName: "backup", dueAt: start + day } } });
    expect(await f.request("/jobs/job/quotes/q1", "customer")).toMatchObject(missing);
    expect(await f.request("/jobs/job/quotes/q1", "admin")).toMatchObject(missing);
    expect(await f.request("/jobs/job/quotes/q1", "backup")).toMatchObject(missing);
    expect(await f.request("/jobs/job/quotes", "reviewer")).toMatchObject({ body: { data: { audience: "reviewer", versions: [{ state: "in_review" }] } } });
    await expect(f.db.prepare("UPDATE quote_items SET net_minor = 100 WHERE version_id = 'q1'").run()).rejects.toThrow("immutable");
    expect(await f.request(`${f.quote("q1")}/issue`, "foreman", "ungranted", terms)).toMatchObject(conflict);
    expect(await f.issue("q1")).toMatchObject({ status: 200, body: { data: { state: "issued", publisherDisplayName: "reviewer", expiresAt: expiry } } });
    const link = await f.db.prepare(`SELECT t.token, t.kind, t.resource_id FROM effect_outbox e
      JOIN notifications n ON n.id = e.resource_ref JOIN link_targets t ON t.token = n.link_token AND t.required_scope = n.context_id
      WHERE e.kind = 'notification_push' AND n.kind = 'quote_ready' AND n.context_id = 'customer-customer'`).first<{ token: string }>();
    expect(link).toMatchObject({ kind: "quote_ready", resource_id: "q1" });
    expect(resultSchema(openLinkRoute.output).parse((await f.request(`/links/${link!.token}`, "customer")).body)).toMatchObject({
      data: { kind: "job", record: { audience: "customer", job: { jobId: "job", quote: { versionId: "q1" } } } },
    });
    expect((await f.request(`/links/${link!.token}`, "guest")).body).toMatchObject({ data: { kind: "unavailable", reason: "unavailable" } });
    const customerPath = "/jobs/job/quotes/q1";
    const publicQuote = resultSchema(getQuoteVersionRoute.output).parse((await f.request(customerPath, "customer")).body);
    expect(publicQuote).toMatchObject({ data: { audience: "customer", actions: { approve: true, decline: true }, terms: { hash: terms.termsHash } } });
    if (!publicQuote.ok) throw new Error(publicQuote.error.code);
    expect(publicQuote.data).not.toHaveProperty("review");
    expect(await f.request(customerPath, "stranger")).toMatchObject(missing);
    expect(await f.request("/jobs/another/quotes/q1", "customer")).toMatchObject(missing);
    expect(await f.request(customerPath, "guest")).toMatchObject({ body: { data: { viewerIsNamedApprover: false, actions: { approve: false } } } });
    expect(await f.approve("q1", "guest")).toMatchObject(conflict);
    await f.switchApprover("foreman");
    expect(await f.approve("q1", "foreman")).toMatchObject(conflict);
    await f.switchApprover("reviewer");
    expect(await f.approve("q1", "reviewer")).toMatchObject(conflict);
    const grantId = await f.switchApprover("customer");
    expect(await f.request(`${f.quote("q1")}/approve`, "customer", "stale-terms", { termsHash: "another" })).toMatchObject(conflict);
    const approved = resultSchema(approveQuoteVersionRoute.output).parse((await f.approve("q1")).body);
    expect(approved).toMatchObject({ data: { state: "approved", actions: { approve: false, decline: false },
      decision: { decision: "approve", actorDisplayName: "customer", termsHash: terms.termsHash, at: start } } });
    expect(await f.db.prepare("SELECT grant_id, quote_version_id, terms_hash FROM approvals").first())
      .toEqual({ grant_id: grantId, quote_version_id: "q1", terms_hash: terms.termsHash });
    await expect(f.db.prepare("UPDATE quote_versions SET scope = 'different' WHERE id = 'q1'").run()).rejects.toThrow("immutable");
    expect((await f.approve("q1")).body).toMatchObject({ data: approved.ok ? approved.data : {} });
    expect((await f.request(`${f.quote("q1")}/approve`, "customer", "approve-q1", { termsHash: "different" })).body)
      .toMatchObject({ error: { code: "OPERATION_ID_REUSED" } });
    expect(f.wakes).toHaveLength(3);
    expect(await f.db.prepare("SELECT kind FROM sync_changes WHERE kind IN ('quote', 'change')").first()).toBeNull();
    const deliveredCopy = await f.db.prepare(`SELECT ${commercialMailEffect.claimResource} AS resource_ref
      FROM effect_outbox e WHERE e.kind = ?`).bind(commercialMailEffect.kind).first<{ resource_ref: string }>();
    const mail = await commercialMailEffect.prepareMail((await loadDeliveryKey(secret))!, { id: "mail", kind: commercialMailEffect.kind, ...deliveredCopy! });
    expect(mail).toMatchObject({ to: "customer@example.test", text: expect.stringContaining("Exact original terms") });
  } finally { clock.mockRestore(); f.db.close(); }
});

test("only successful issue supersedes the prior live quote, and the deadline is exclusive", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    expect((await f.draft("q1")).status).toBe(200);
    expect((await f.submit("q1")).status).toBe(200);
    expect((await f.issue("q1")).status).toBe(200);
    expect((await f.draft("q2")).status).toBe(200);
    expect((await f.submit("q2")).status).toBe(200);
    expect(await f.request(`${f.quote("q2")}/issue`, "reviewer", "bad-issue", { termsHash: "other" })).toMatchObject(conflict);
    expect(await f.request("/jobs/job/quotes/q1", "customer")).toMatchObject({ body: { data: { state: "issued" } } });
    expect((await f.issue("q2")).status).toBe(200);
    expect(await f.approve("q1")).toMatchObject(conflict);
    expect(await f.request("/jobs/job/quotes/q1", "customer")).toMatchObject({ body: { data: { state: "superseded", replacedBy: { id: "q2", no: 2 } } } });
    clock.mockReturnValue(expiry);
    expect(await f.approve("q2")).toMatchObject(conflict);
    expect(await f.request("/jobs/job/quotes/q2", "customer")).toMatchObject({ body: { data: { state: "expired", actions: { approve: false } } } });
  } finally { clock.mockRestore(); f.db.close(); }
});

test("change review and approval retain the approved quote and do not move the booked visit", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    await f.db.prepare(`INSERT INTO business_grants(id,business_id,membership_id,capability,issuer_id,valid_from)
      VALUES ('direct','business','foreman-member','publish_commercial','admin',1)`).run();
    expect((await f.draft("q1")).status).toBe(200);
    expect((await f.request(`${f.quote("q1")}/issue`, "foreman", "direct-issue", terms)).status).toBe(200);
    expect((await f.approve("q1")).status).toBe(200);
    const bookedStart = start + 7_200_000;
    await f.db.batch([
      f.db.prepare("INSERT INTO visits(id,job_id,kind,state) VALUES ('visit','job','work','booked')"),
      f.db.prepare(`INSERT INTO visit_windows(id,visit_id,starts_at,ends_at,expires_at,provider_authorized,proposed_at,proposed_by,
        confirmed_at,confirmed_by,state) VALUES ('window','visit',?,?,?,1,?,'foreman',?,'customer','confirmed')`)
        .bind(bookedStart, bookedStart + 3_600_000, bookedStart - 1000, start - 2000, start - 1000),
    ]);
    expect((await f.changeDraft("ch1")).status).toBe(200);
    expect((await f.request(`${f.change("ch1")}/submit-review`, "foreman", "submit-ch1")).status).toBe(200);
    expect(await f.request(`${f.change("ch1")}/return`, "reviewer", "return-ch1", { reason: "Clarify the trim" }))
      .toMatchObject({ status: 200, body: { data: { state: "returned", review: { state: "returned", returnReason: "Clarify the trim" } } } });
    expect(await f.request("/jobs/job/changes/ch1", "customer")).toMatchObject(missing);
    expect((await f.changeDraft("ch2")).status).toBe(200);
    expect((await f.request(`${f.change("ch2")}/submit-review`, "foreman", "submit-ch2")).status).toBe(200);
    expect(await f.request(`${f.change("ch2")}/issue`, "reviewer", "issue-ch2", terms))
      .toMatchObject({ status: 200, body: { data: { state: "issued", expiresAt: bookedStart, deltaMinor: 3600, totalMinor: 27600 } } });
    const approved = await f.request(`${f.change("ch2")}/approve`, "customer", "approve-ch2", terms);
    expect(resultSchema(approveChangeVersionRoute.output).parse(approved.body)).toMatchObject({ data: { state: "approved", approvedBase: { id: "q1", totalMinor: 24000 } } });
    expect(await f.db.prepare("SELECT state, starts_at FROM visit_windows WHERE id = 'window'").first()).toEqual({ state: "confirmed", starts_at: bookedStart });
    expect(await f.request("/jobs/job/changes", "customer")).toMatchObject({ body: { data: { versions: [{ id: "ch2", state: "approved" }] } } });
    expect(await f.changeDraft("ch3")).toMatchObject(conflict);
  } finally { clock.mockRestore(); f.db.close(); }
});

test("early start and withdrawal require the exact reviewed contract and keep durable receipts", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    expect((await f.draft("q1")).status).toBe(200);
    expect((await f.submit("q1")).status).toBe(200);
    expect((await f.issue("q1")).status).toBe(200);
    expect((await f.approve("q1")).status).toBe(200);
    const v = { quoteVersionId: "q1", ...terms };
    const earlyStart = "/jobs/job/contract/early-start", withdrawal = "/jobs/job/contract/withdrawal";
    expect(await f.request(earlyStart, "customer", "not-configured", v)).toMatchObject(conflict);
    await f.db.prepare("INSERT INTO feature_flags VALUES ('commercial_consumer_distance_14_day', 'terms-v1', 1, 1)").run();
    expect(await f.request(withdrawal, "guest", "not-entitled", v)).toMatchObject(missing);
    const firstRequest = resultSchema(requestEarlyStartRoute.output).parse((await f.request(earlyStart, "customer", "request", v)).body);
    expect(firstRequest).toMatchObject({ data: { request: { kind: "early_start_request" }, acknowledgement: null } });
    const ack = resultSchema(requestEarlyStartRoute.output).parse((await f.request(earlyStart, "customer", "ack", { ...v, acknowledgement: true })).body);
    expect(ack).toMatchObject({ data: { request: firstRequest.ok ? firstRequest.data.request : {}, acknowledgement: { kind: "early_start_acknowledgement" } } });
    await f.db.prepare("UPDATE jobs SET state = 'closed' WHERE id = 'job'").run();
    expect(await f.request(withdrawal, "customer", "wrong-version", { ...v, termsHash: "wrong" })).toMatchObject(conflict);
    const receipt = resultSchema(withdrawContractRoute.output).parse((await f.request(withdrawal, "customer", "withdraw", v)).body);
    expect(receipt).toMatchObject({ data: { kind: "withdrawal", quoteVersionId: "q1", at: start, termsHash: terms.termsHash } });
    clock.mockReturnValue(start + 30 * day);
    expect((await f.request(withdrawal, "customer", "withdraw", v)).body).toMatchObject({ data: receipt.ok ? receipt.data : {} });
    expect(await f.request(withdrawal, "customer", "duplicate", v)).toMatchObject(conflict);
    expect(await f.db.prepare("SELECT count(*) FROM contract_notices").first("count(*)")).toBe(3);
    expect(await f.db.prepare("SELECT count(*) FROM effect_outbox WHERE kind = ?").bind(commercialMailEffect.kind).first("count(*)")).toBe(4);
    const history = "/jobs/job/contract/notices";
    const own = resultSchema(listContractNoticesRoute.output).parse((await f.request(history, "customer")).body);
    expect([own, await f.request(history, "guest")]).toMatchObject([
      { data: { notices: expect.arrayContaining([
        { ...(receipt.ok ? receipt.data : {}), noticeText: "Exact original terms", deliveryState: "pending" },
        { ...(ack.ok ? ack.data.acknowledgement : {}), noticeText: "Exact contractual consent", deliveryState: "pending" },
      ]) } },
      missing,
    ]);
  } finally { clock.mockRestore(); f.db.close(); }
});
