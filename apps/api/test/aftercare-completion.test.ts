import { expect, spyOn, test } from "bun:test";
import {
  getJobBillRoute, getJobCompletionRoute, getJobRatingEligibilityRoute, getJobsRoute, openLinkRoute, operationIdHeader, resultSchema,
} from "@bookbuddy/api-contract";
import type { CompletionSubmissionInput } from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { runEffectBatch } from "../src/effects";
import { randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential } from "../src/modules/auth/session";
import { createTestD1 } from "./d1";
import type { TestD1 } from "./d1";

const day = 86_400_000;
const hour = 3_600_000;
const now = Date.parse("2026-03-27T09:00:00Z");
const finishedAt = now - hour;
const termsHash = "exact-approved-terms";
const alternative = "Informe acordado: se comprobó con carga";
const people = ["customer", "guest", "foreman", "admin"] as const;
type Person = (typeof people)[number];
const completionPath = "/jobs/job/completion";
const submissions = "/jobs/job/completions";
const ratingPath = "/jobs/job/rating";
const eligibility = `${ratingPath}-eligibility`;
const approvedBillLines = [
  { originalLabel: "Puerta", originalLanguage: "es", netMinor: 12_000, taxMinor: 2_400 },
  { originalLabel: "Pestillo", originalLanguage: "es", netMinor: 8_000, taxMinor: 1_600 },
  { originalLabel: "Carril", originalLanguage: "es", netMinor: 1_000, taxMinor: 200 },
];

async function grantForemanIssuance(db: TestD1, validFrom: number) {
  await db.batch([
    db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at)
      VALUES ('foreman-admin-role', 'foreman-member', 'business', 'foreman', 'provider_admin', 1)`),
    db.prepare(`INSERT INTO account_contexts (id, account_id, role, business_id, role_grant_id)
      VALUES ('foreman-admin-context', 'foreman', 'provider_admin', 'business', 'foreman-admin-role')`),
    db.prepare(`INSERT INTO business_grants (id, business_id, membership_id, capability, issuer_id, valid_from)
      VALUES ('foreman-issue', 'business', 'foreman-member', 'issue_bill', 'admin', ?)`).bind(validFrom),
  ]);
}

async function fixture() {
  const db = await createTestD1();
  const app = createApp();
  app.onError((error) => { throw error; });
  const wakes: string[][] = [];
  const env = { DB: db, EFFECTS: { async send({ workKeys }: { workKeys: string[] }) { wakes.push(workKeys); } } } as unknown as Bindings;
  const execution = { waitUntil() {}, passThroughOnException() {} };
  const accounts = await Promise.all(people.map(async (id) => {
    const token = randomToken();
    return { id, token, hash: await hashSessionCredential(token) };
  }));
  await db.batch([
    ...accounts.flatMap(({ id }) => [db.prepare(`INSERT INTO accounts (id, email_normalized, display_name, verified_at, state)
      VALUES (?, ?, ?, 1, 'active')`).bind(id, `${id}@example.test`, id),
    db.prepare("INSERT INTO account_contexts (id, account_id, role) VALUES (?, ?, 'customer')").bind(`${id}-customer`, id)]),
    db.prepare("INSERT INTO operating_areas VALUES ('area', 'Area', 'Europe/Madrid', '[0]')"),
    db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
      VALUES ('business', 'Provider Legal', 'Provider', 'work@example.test', 'area', 'approved')`),
    db.prepare(`INSERT INTO memberships (id, business_id, account_id, state) VALUES
      ('foreman-member', 'business', 'foreman', 'active'), ('admin-member', 'business', 'admin', 'active')`),
    db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at) VALUES
      ('foreman-role', 'foreman-member', 'business', 'foreman', 'foreman', 1),
      ('admin-role', 'admin-member', 'business', 'admin', 'provider_admin', 1)`),
    db.prepare(`INSERT INTO account_contexts (id, account_id, role, business_id, role_grant_id) VALUES
      ('foreman-staff', 'foreman', 'foreman', 'business', 'foreman-role'), ('admin-staff', 'admin', 'provider_admin', 'business', 'admin-role')`),
    ...accounts.map(({ id, hash }) => db.prepare(`INSERT INTO sessions (id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
      VALUES (?, ?, ?, ?, 'device', 1, ?)`).bind(`${id}-session`, id, hash,
      id === "customer" || id === "guest" ? `${id}-customer` : `${id}-staff`, now + 100 * day)),
    db.prepare(`INSERT INTO business_grants (id, business_id, membership_id, capability, issuer_id, valid_from)
      VALUES ('pay', 'business', 'admin-member', 'record_paid', 'admin', 1),
        ('issue', 'business', 'admin-member', 'issue_bill', 'admin', 1)`),
    db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state)
      VALUES ('place', 'customer', 'Villa', 'Address', 'pending_verification')`),
    db.prepare("INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES ('place', 'customer', 1, 1), ('place', 'guest', 1, 1)"),
    db.prepare(`UPDATE places SET named_approver_id = 'customer', pin = '{"latitude":1,"longitude":1}', site_zone = 'Europe/Madrid',
      area_id = 'area', state = 'in_area' WHERE id = 'place'`),
    db.prepare(`INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, valid_from) VALUES
      ('approve', 'place', 'customer', 'approve', 'customer', 1), ('sign', 'place', 'customer', 'sign_off', 'customer', 1),
      ('bill-view', 'place', 'customer', 'bill_view', 'customer', 1),
      ('guest-view', 'place', 'guest', 'view', 'customer', 1), ('guest-sign', 'place', 'guest', 'sign_off', 'customer', 1)`),
    db.prepare(`INSERT INTO jobs (id, reference, business_id, place_id, requester_id, accountable_foreman_membership_id, trade, origin, state)
      VALUES ('job', 'BB-123', 'business', 'place', 'customer', 'foreman-member', 'Door repair', 'bookbuddy', 'open')`),
    db.prepare("INSERT INTO requests (job_id, original_text, original_language, arrival_arrangement, submitted_at) VALUES ('job', 'Repair door', 'en', 'requester', 2)"),
    db.prepare(`INSERT INTO terms_versions VALUES ('terms', 'business', 1, 'Provider Legal', 'Terms', 'es', 'Consent', ?)`).bind(termsHash),
    db.prepare("INSERT INTO quotes VALUES ('quote', 'job')"),
    db.prepare(`INSERT INTO quote_versions (id, quote_id, job_id, business_id, no, author_id, terms_id, original_locale,
      scope, exclusions, net_minor, tax_minor, total_minor, currency, state)
      VALUES ('quote-v1', 'quote', 'job', 'business', 1, 'foreman', 'terms', 'es', 'Puerta y pestillo', '', 20000, 4000, 24000, 'EUR', 'draft')`),
    db.prepare(`INSERT INTO quote_items (version_id, line_no, original_label, quantity, net_minor, tax_minor, evidence_rule, evidence_alternative)
      VALUES ('quote-v1', 1, 'Puerta', 1, 12000, 2400, 'Foto', NULL), ('quote-v1', 2, 'Pestillo', 1, 8000, 1600, 'Foto', ?)`).bind(alternative),
    db.prepare("UPDATE quote_versions SET publisher_id = 'admin', issued_at = 3, expires_at = 50, state = 'issued'") ,
    db.prepare(`INSERT INTO approvals (id, quote_version_id, account_id, grant_id, terms_hash, decision, at)
      VALUES ('quote-ok', 'quote-v1', 'customer', 'approve', ?, 'approve', 4)`).bind(termsHash),
    db.prepare("UPDATE quote_versions SET state = 'approved'"),
    db.prepare("INSERT INTO change_proposals VALUES ('change', 'job', 'quote-v1')"),
    db.prepare(`INSERT INTO change_versions (id, proposal_id, job_id, business_id, no, author_id, terms_id, original_locale,
      original_text, delta_minor, total_minor, timing, affected_items, created_at, state)
      VALUES ('change-v1', 'change', 'job', 'business', 1, 'foreman', 'terms', 'es', 'Carril', 1200, 25200, 'Same visit', 'Carril', 4, 'draft')`),
    db.prepare(`INSERT INTO change_items (version_id, line_no, original_label, quantity, net_minor, tax_minor, evidence_rule)
      VALUES ('change-v1', 1, 'Carril', 1, 1000, 200, 'Foto')`),
    db.prepare("UPDATE change_versions SET publisher_id = 'admin', issued_at = 5, expires_at = 50, state = 'issued'"),
    db.prepare(`INSERT INTO approvals (id, change_version_id, account_id, grant_id, terms_hash, decision, at)
      VALUES ('change-ok', 'change-v1', 'customer', 'approve', ?, 'approve', 6)`).bind(termsHash),
    db.prepare("UPDATE change_versions SET state = 'approved'"),
    db.prepare("INSERT INTO visits (id, job_id, kind, state) VALUES ('visit', 'job', 'work', 'finished')"),
    db.prepare(`INSERT INTO visit_windows (id, visit_id, starts_at, ends_at, expires_at, provider_authorized, proposed_at, proposed_by,
      confirmed_at, confirmed_by, state) VALUES ('booked', 'visit', ?, ?, ?, 1, 10, 'foreman', 12, 'guest', 'confirmed')`)
      .bind(finishedAt - hour, finishedAt, finishedAt - 2 * hour),
    db.prepare(`INSERT INTO visit_activity_events (id, visit_id, actor_id, kind, at)
      VALUES ('finish', 'visit', 'foreman', 'work_finished', ?)`).bind(finishedAt),
    db.prepare(`INSERT INTO media_stages (id, context_id, caller, parent_scope_id, created_at, expires_at)
      VALUES ('stage', 'foreman-staff', 'completion', 'job', 1, ?), ('other-stage', 'foreman-staff', 'completion', 'other-job', 1, ?)`)
      .bind(now + day, now + day),
    db.prepare(`INSERT INTO attachments (id, stage_id, object_key, mime, bytes, state, etag, retention_class, delete_after)
      VALUES ('photo', 'stage', 'private-photo', 'image/jpeg', 32, 'ready', 'valid', 'unlinked', ?),
        ('pending', 'stage', 'private-pending', 'image/jpeg', 32, 'uploading', NULL, 'unlinked', ?),
        ('wrong-photo', 'other-stage', 'private-other', 'image/jpeg', 32, 'ready', 'valid', 'unlinked', ?)`)
      .bind(now + day, now + day, now + day),
  ]);

  async function request(path: string, account: Person, operationId?: string, payload: unknown = {}, expectedRevision?: number) {
    const { batch, query } = db.calls;
    const token = accounts.find((person) => person.id === account)!.token;
    const response = await app.request(`https://bookbuddy.test/api/v1${path}`, {
      method: operationId ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(operationId ? { [operationIdHeader]: operationId, "Content-Type": "application/json" } : {}) },
      body: operationId ? JSON.stringify({ operationId, expectedRevision, payload }) : undefined,
    }, env, execution);
    const batched = !!operationId || path.startsWith("/links/") || path === "/jobs/job" || path.startsWith("/jobs?");
    expect(db.calls.batch - batch).toBe(batched ? 1 : 0);
    expect(db.calls.query - query).toBe(batched ? 0 : 1);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    return { status: response.status, body: await response.json() as unknown };
  }

  const signOff = (completion: string, id: string, account: Person = "customer", hash = termsHash) =>
    request(`/completions/${completion}/sign-off`, account, id, { id, termsHash: hash });
  const submit = (payload: CompletionSubmissionInput, operation = `send-${payload.id}`) => request(submissions, "foreman", operation, payload);
  return { db, env, wakes, request, signOff, submit };
}

function submission(id: string, expectedCompletionId: string | null = null, photo = "photo"): CompletionSubmissionInput {
  return { id, baseQuoteVersionId: "quote-v1", expectedCompletionId, items: [
    { id: `${id}-1`, scope: { kind: "quote", quoteVersionId: "quote-v1", lineNo: 1 }, outcome: "done", originalLanguage: "es",
      resultNote: "Desliza y cierra", photos: [{ attachmentId: photo, caption: { language: "es", text: "Después" } }] },
    { id: `${id}-2`, scope: { kind: "quote", quoteVersionId: "quote-v1", lineNo: 2 }, outcome: "done", originalLanguage: "es",
      resultNote: "Verificado", evidenceAlternative: alternative, photos: [] },
    { id: `${id}-3`, scope: { kind: "change", changeVersionId: "change-v1", lineNo: 1 }, outcome: "not_done", originalLanguage: "es",
      reason: "No había repuesto", photos: [] },
  ] } as CompletionSubmissionInput;
}

const conflict = { status: 409, body: { error: { code: "CONFLICT" } } };
const missing = { status: 404, body: { error: { code: "NOT_FOUND" } } };

test("publishes exactly the approved checklist with ready evidence and no invented bytes or timestamps", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    expect(await f.request(completionPath, "foreman")).toMatchObject({ status: 200, body: { data: {
      approvedScope: { totalMinor: 25_200, lines: [{ evidenceRule: "Foto" }, { evidenceAlternative: alternative }, { ref: { kind: "change" } }] },
      submission: null, work: { finishedAt, crewCheckedOutAt: null }, actions: { submit: true },
    } } });
    const incomplete = submission("incomplete");
    expect(await f.submit({ ...incomplete, items: incomplete.items.slice(0, -1) })).toMatchObject(conflict);
    expect(await f.submit(submission("uploading", null, "pending"))).toMatchObject(conflict);
    expect(await f.submit(submission("unrelated", null, "wrong-photo"))).toMatchObject(conflict);
    const falseAlternative = submission("not-agreed");
    falseAlternative.items[0] = { ...falseAlternative.items[0]!, outcome: "done", resultNote: "Done", evidenceAlternative: "Foto", photos: [] };
    expect(await f.submit(falseAlternative)).toMatchObject(conflict);
    expect(await f.db.prepare("SELECT count(*) AS n FROM completions").first("n")).toBe(0);
    expect(await f.db.prepare("SELECT count(*) AS n FROM operation_receipts").first("n")).toBe(0);

    expect(await f.submit({ ...submission("complete"), billReference: "Invoice draft", billAmountMinor: 25_200 })).toMatchObject({ status: 200, body: { data: {
      submission: { id: "complete", state: "submitted", billReference: "Invoice draft", billAmountMinor: 25_200, finishedAt },
    } } });
    const projected = resultSchema(getJobCompletionRoute.output).parse((await f.request(completionPath, "customer")).body);
    expect(projected).toMatchObject({ data: { audience: "customer", actions: { signOff: true }, submission: { items: [
      { outcome: "done", photos: [{ attachmentId: "photo", availability: "available", capturedAt: null, caption: { original: { text: "Después" } } }] },
      { outcome: "done", evidenceAlternative: { original: { text: alternative } } },
      { outcome: "not_done", reason: { original: { text: "No había repuesto" } } },
    ] } } });
    expect(JSON.stringify(projected)).not.toContain("Invoice draft");
    const token = await f.db.prepare("SELECT link_token FROM notifications WHERE kind = 'completion_ready'").first("link_token");
    const link = resultSchema(openLinkRoute.output).parse((await f.request(`/links/${token}`, "customer")).body);
    expect(link).toMatchObject({ data: { kind: "completion", completion: { submission: { id: "complete" } } } });
    expect((await f.request(`/links/${token}`, "guest")).body).toMatchObject({ data: { kind: "unavailable" } });
    expect(f.wakes).toHaveLength(1);
    expect(f.wakes[0]).toHaveLength(1); // No queue wake for timed, scheduled-only effects.

    await f.db.prepare("UPDATE attachments SET state = 'expired' WHERE id = 'photo'").run();
    expect(await f.request(completionPath, "customer")).toMatchObject({ body: { data: {
      actions: { signOff: true }, submission: { items: [{ photos: [{ attachmentId: "photo", availability: "unavailable", capturedAt: null }] }, {}, {}] },
    } } });
  } finally { f.db.close(); clock.mockRestore(); }
});

test("foreman wrap-up projects the stored VAT basis and rechecks the viewer's named billing authority", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    await f.db.batch([
      f.db.prepare(`INSERT INTO business_grants (id, business_id, membership_id, capability, issuer_id, valid_from)
        VALUES ('can-issue', 'business', 'foreman-member', 'issue_bill', 'admin', 1)`),
      f.db.prepare(`INSERT INTO change_proposals VALUES ('later-change', 'job', 'quote-v1'), ('private-change', 'job', 'quote-v1')`),
      f.db.prepare(`INSERT INTO change_versions (id, proposal_id, job_id, business_id, no, author_id, terms_id, original_locale,
        original_text, delta_minor, total_minor, timing, affected_items, created_at, state) VALUES
        ('late-version', 'later-change', 'job', 'business', 1, 'foreman', 'terms', 'es', 'Añadido', 600, 25800, 'Same visit', 'Carril', 7, 'draft'),
        ('private-version', 'private-change', 'job', 'business', 1, 'foreman', 'terms', 'es', 'Private revision', 8400, 34200, 'Same visit', 'Carril', 7, 'draft')`),
      f.db.prepare(`INSERT INTO change_items (version_id, line_no, original_label, quantity, net_minor, tax_minor, evidence_rule)
        VALUES ('late-version', 1, 'Pieza', 1, 500, 50, 'Foto'), ('late-version', 2, 'Mano de obra', 1, 50, 0, 'Foto'),
          ('private-version', 1, 'Private', 1, 7000, 1400, 'Foto')`),
      f.db.prepare(`UPDATE change_versions SET publisher_id = 'admin', issued_at = 8, expires_at = 50, state = 'issued' WHERE id = 'late-version'`),
      f.db.prepare(`INSERT INTO approvals (id, change_version_id, account_id, grant_id, terms_hash, decision, at)
        VALUES ('later-approved', 'late-version', 'customer', 'approve', ?, 'approve', 9)`).bind(termsHash),
      f.db.prepare("UPDATE change_versions SET state = 'approved' WHERE id = 'late-version'"),
    ]);
    expect(await f.request(completionPath, "foreman")).toMatchObject({ status: 200, body: { data: {
      approvedScope: { netMinor: 21_550, taxMinor: 4_250, totalMinor: 25_800, currency: "EUR" },
      actions: { canIssueBill: false },
    } } });
    await f.db.batch([
      f.db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at)
        VALUES ('foreman-admin-role', 'foreman-member', 'business', 'foreman', 'provider_admin', 1)`),
      f.db.prepare(`INSERT INTO account_contexts (id, account_id, role, business_id, role_grant_id)
        VALUES ('foreman-admin-context', 'foreman', 'provider_admin', 'business', 'foreman-admin-role')`),
    ]);
    expect(await f.request(completionPath, "foreman")).toMatchObject({ body: { data: { actions: { canIssueBill: true } } } });
    const customer = await f.request(completionPath, "customer");
    expect(customer).toMatchObject({ status: 200, body: { data: { approvedScope: { totalMinor: 25_800 } } } });
    expect(JSON.stringify(customer.body)).not.toMatch(/canIssueBill|netMinor|taxMinor|private-version|Private revision/);
    await f.db.prepare("UPDATE business_grants SET revoked_at = ? WHERE id = 'can-issue'").bind(now).run();
    expect(await f.request(completionPath, "foreman")).toMatchObject({ body: { data: { actions: { canIssueBill: false } } } });
  } finally { f.db.close(); clock.mockRestore(); }
});

test("requires the current named online approver, immutable version and terms; return preserves the superseded history", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    expect((await f.submit(submission("v1"))).status).toBe(200);
    expect(await f.signOff("v1", "not-named", "guest")).toMatchObject(missing);
    expect(await f.signOff("v1", "wrong-hash", "customer", "wrong-terms")).toMatchObject(conflict);
    expect(await f.request("/completions/v1/return", "foreman", "return-stale", {}, 0))
      .toMatchObject({ status: 409, body: { error: { code: "STALE_REVISION" } } });
    expect(await f.request("/completions/v1/return", "foreman", "return", {}, 1)).toMatchObject({ status: 200, body: { data: {
      submission: { id: "v1", state: "returned" }, actions: { submit: true },
    } } });
    expect(await f.signOff("v1", "returned")).toMatchObject(conflict);
    expect((await f.submit(submission("v2", "v1"))).status).toBe(200);
    expect(await f.request(`${completionPath}?versionId=v1`, "customer")).toMatchObject({ status: 200, body: { data: {
      submission: { id: "v1", state: "superseded" }, actions: { signOff: false },
    } } });
    expect(await f.signOff("v1", "stale-version")).toMatchObject(conflict);
    expect(await f.signOff("v2", "accepted")).toMatchObject({ status: 200, body: { data: {
      signOff: { id: "accepted", completionId: "v2", completionVersion: 2, termsHash },
      submission: { state: "signed_off" }, actions: { signOff: false, seeBill: true },
    } } });
    expect(await f.signOff("v2", "second-attempt")).toMatchObject(conflict);
    expect((await f.signOff("v2", "accepted")).status).toBe(200); // Transport replay, not a second sign-off.
    expect(await f.db.prepare("SELECT count(*) AS n FROM sign_offs").first("n")).toBe(1);
    expect(await f.db.prepare("SELECT count(*) AS n FROM bills").first("n")).toBe(0);
    expect(await f.request("/jobs/job", "customer")).toMatchObject({ body: { data: { job: { journey: { step: "signed_off" } } } } });
    expect((await f.db.prepare(`SELECT DISTINCT partition_key FROM sync_changes WHERE kind = 'job' ORDER BY partition_key`).all()).results)
      .toEqual([{ partition_key: "customer-customer" }, { partition_key: "guest-customer" }]);
    expect(await f.db.prepare("SELECT count(*) AS n FROM effect_outbox WHERE state = 'pending'").first("n")).toBe(0);
    const issue = await f.request("/jobs/job/bills", "admin", "manual-bill", { id: "manual", replacesId: null, number: "RR-43",
      currency: "EUR", providerDocumentRef: "doc", paymentInstructions: { instructions: { language: "en", text: "Pay the provider" }, reference: "RR-43" },
      lines: [
        { originalLabel: "Puerta", originalLanguage: "es", netMinor: 12000, taxMinor: 2400 },
        { originalLabel: "Pestillo", originalLanguage: "es", netMinor: 8000, taxMinor: 1600 },
        { originalLabel: "Carril", originalLanguage: "es", netMinor: 1000, taxMinor: 200 },
      ] });
    expect(issue).toMatchObject({ status: 200, body: { data: { bill: { id: "manual", totalMinor: 25200 } } } });
  } finally { f.db.close(); clock.mockRestore(); }
});

test("sweeps one site-calendar reminder and one accountable follow-up, with durable links and no device dependency", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    expect((await f.submit(submission("awaited"))).status).toBe(200);
    const reminder = now + 3 * day - hour, followUp = now + 7 * day - hour;
    expect((await f.db.prepare(`SELECT kind, due_at FROM effect_outbox WHERE kind <> 'notification_push' ORDER BY due_at`).all()).results)
      .toEqual([{ kind: "sign_off_reminder", due_at: reminder }, { kind: "sign_off_follow_up", due_at: followUp }]);
    await f.db.prepare("UPDATE places SET named_approver_id = 'guest' WHERE id = 'place'").run();
    for (const due of [reminder, followUp, followUp + 1]) {
      const { batch, query } = f.db.calls;
      await runEffectBatch(f.env, null, due);
      expect(f.db.calls.batch - batch).toBe(1);
      expect(f.db.calls.query - query).toBe(0);
    }
    expect((await f.db.prepare("SELECT kind, context_id FROM notifications ORDER BY created_at").all()).results).toEqual([
      { kind: "completion_ready", context_id: "customer-customer" },
      { kind: "sign_off_reminder", context_id: "guest-customer" },
      { kind: "sign_off_follow_up", context_id: "foreman-staff" },
    ]);
    clock.mockReturnValue(followUp);
    const token = await f.db.prepare("SELECT link_token FROM notifications WHERE kind = 'sign_off_follow_up'").first("link_token");
    expect(await f.request(`/links/${token}`, "foreman")).toMatchObject({ status: 200, body: { data: {
      kind: "completion", completion: { audience: "foreman", submission: { id: "awaited" } },
    } } });
  } finally { f.db.close(); clock.mockRestore(); }
});

test("rates verified closed work once, before its local service deadline, with no rating disclosure to other viewers", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    const rate = (id: string, account: Person = "customer") => f.request(ratingPath, account, id, { id, stars: 5,
      comment: { language: "en", text: "Private feedback" } });
    expect((await f.submit(submission("rated"))).status).toBe(200);
    expect(await rate("too-early")).toMatchObject(conflict);
    expect((await f.signOff("rated", "sign-for-rating")).status).toBe(200);
    expect(await rate("still-open")).toMatchObject(conflict);
    expect(await f.request(eligibility, "customer")).toMatchObject({ body: { data: { status: "unavailable", reason: "not_eligible" } } });
    await f.db.prepare("UPDATE jobs SET state = 'closed' WHERE id = 'job'").run(); // Provider's verified payment/close path.
    const expiresAt = finishedAt + 30 * day - hour;
    const ready = resultSchema(getJobRatingEligibilityRoute.output).parse((await f.request(eligibility, "customer")).body);
    expect(ready).toMatchObject({ data: { status: "eligible", expiresAt } });
    clock.mockReturnValue(expiresAt);
    expect(await rate("expired-at-cutoff")).toMatchObject(conflict);
    clock.mockReturnValue(expiresAt - 1);
    expect(await rate("private-rating")).toMatchObject({ status: 200, body: { data: { id: "private-rating", stars: 5 } } });
    expect(await rate("again")).toMatchObject(conflict);
    expect(await rate("other-author", "guest")).toMatchObject(conflict);
    expect(await f.request(eligibility, "customer")).toMatchObject({ body: { data: { status: "submitted", rating: { id: "private-rating" } } } });
    expect(await f.request(eligibility, "guest")).toMatchObject({ body: { data: { status: "unavailable", reason: "already_rated" } } });
    expect(await f.request(eligibility, "foreman")).toMatchObject(missing);
    expect(await f.db.prepare("SELECT count(*) AS n FROM ratings").first("n")).toBe(1);
  } finally { f.db.close(); clock.mockRestore(); }
});

test("sign-off closes an already matched job but never infers delivery from the payment alone", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    await f.db.batch([
      f.db.prepare(`INSERT INTO bills (id, job_id, business_id, number, version, net_minor, tax_minor, total_minor, currency,
        provider_document_ref, payment_instructions, line_items, issued_at, due_at, state)
        VALUES ('invoice', 'job', 'business', 'RR-42', 1, 20000, 4000, 24000, 'EUR', 'doc', ?,
          '[{"originalLabel":"Door","originalLanguage":"en","netMinor":20000,"taxMinor":4000}]', ?, ?, 'issued')`)
        .bind(JSON.stringify({ instructions: { language: "en", text: "Pay provider" }, reference: "RR-42" }), now - 2, now + 7 * day),
      f.db.prepare(`INSERT INTO paid_records (id, bill_id, actor_id, kind, amount_minor, verified_reference, at)
        VALUES ('payment', 'invoice', 'admin', 'matched', 24000, 'transfer', ?)`).bind(now - 1),
    ]);
    expect(await f.request(eligibility, "customer")).toMatchObject({ body: { data: { status: "unavailable", reason: "not_eligible" } } });
    expect((await f.submit({ ...submission("prepaid"), billReference: "RR-99", billAmountMinor: 25_200 })).status).toBe(200);
    expect(await f.db.prepare("SELECT state FROM jobs WHERE id = 'job'").first("state")).toBe("open");
    expect((await f.signOff("prepaid", "prepaid-signed")).status).toBe(200);
    expect(await f.db.prepare("SELECT id, number FROM bills").first()).toEqual({ id: "invoice", number: "RR-42" });
    expect(await f.request("/jobs/job", "customer")).toMatchObject({ body: { data: { job: { state: "closed", journey: { step: "paid" } } } } });
    expect(await f.request(eligibility, "customer")).toMatchObject({ body: { data: { status: "eligible" } } });
  } finally { f.db.close(); clock.mockRestore(); }
});

test("sign-off retains an unauthorized hint for the provider and never upgrades it using a later grant", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    const billReference = "RR-0412";
    const billAmountMinor = 25_200;
    await f.db.prepare(`INSERT INTO business_grants (id, business_id, membership_id, capability, issuer_id, valid_from)
      VALUES ('foreman-pay-grant', 'business', 'foreman-member', 'record_paid', 'admin', 1)`).run();
    const wrap = { ...submission("with-bill"), billReference, billAmountMinor };
    expect(await f.submit({ ...wrap, billAmountMinor: 24_000 }, "mismatched-bill")).toMatchObject(conflict);
    expect(await f.submit(wrap)).toMatchObject({ status: 200, body: { data: {
      submission: { billReference, billAmountMinor }, actions: { canIssueBill: false },
    } } });
    expect(await f.request("/jobs/job/bill", "customer")).toMatchObject({ status: 200, body: { data: { bill: null } } });
    expect(await f.db.prepare("SELECT count(*) FROM bills").first("count(*)")).toBe(0);

    await grantForemanIssuance(f.db, now + 1);
    clock.mockReturnValue(now + 1);
    expect((await f.signOff(wrap.id, "confirm-bill")).status).toBe(200);
    expect((await f.signOff(wrap.id, "confirm-bill")).status).toBe(200);
    expect(await f.db.prepare("SELECT state, bill_reference_hint, bill_hint_by, bill_hint_grant_id FROM completions").first())
      .toEqual({ state: "signed_off", bill_reference_hint: billReference, bill_hint_by: "foreman", bill_hint_grant_id: null });
    expect(await f.db.prepare("SELECT count(*) FROM bills").first("count(*)")).toBe(0);
    expect(await f.db.prepare("SELECT count(*) FROM notifications WHERE kind = 'bill_issued'").first("count(*)")).toBe(0);
    expect(await f.request("/jobs/job/bill", "customer")).toMatchObject({ body: { data: { bill: null } } });
    expect(await f.request("/jobs?segment=needs_you", "admin")).toMatchObject({ body: { data: {
      items: [{ jobId: "job", readyToBill: true }], unpaidBills: [],
    } } });
    expect(await f.request("/jobs/job", "admin")).toMatchObject({ body: { data: { job: {
      readyBill: { number: billReference, total: { minor: billAmountMinor }, lines: approvedBillLines },
    } } } });
    expect(JSON.stringify((await f.request("/jobs/job", "customer")).body)).not.toContain(billReference);
    expect(JSON.stringify((await f.request("/jobs/job", "foreman")).body)).not.toContain("readyBill");

    const issued = await f.request("/jobs/job/bills", "admin", "manual-bill", {
      id: "provider-issued", replacesId: null, number: billReference, currency: "EUR", providerDocumentRef: "doc",
      paymentInstructions: { instructions: { language: "en", text: "Pay the provider" }, reference: billReference },
      lines: approvedBillLines,
    });
    expect(issued).toMatchObject({ status: 200, body: { data: { bill: { id: "provider-issued", totalMinor: billAmountMinor } } } });
    expect(await f.request("/jobs/job", "admin")).toMatchObject({ body: { data: { job: { readyToBill: false, readyBill: null } } } });
    expect(f.wakes).toHaveLength(2);

    const queue = resultSchema(getJobsRoute.output).parse((await f.request("/jobs?segment=needs_you", "admin")).body);
    expect(queue).toMatchObject({ data: { unpaidBills: [{
      jobId: "job", number: billReference, expectedPriorId: null, canRecordPaid: true, total: { minor: billAmountMinor },
    }] } });
    if (!queue.ok || queue.data.audience !== "provider_admin") throw new Error("Missing provider bill queue");
    const pending = queue.data.unpaidBills[0]!;
    const path = `/bills/${pending.billId}/record-paid`;
    const payment = { id: "verified-payment", expectedPriorId: pending.expectedPriorId, amountMinor: pending.total.minor, verifiedReference: "matched-transfer" };
    expect(await f.request(path, "foreman", "foreman-pay", payment)).toMatchObject(missing);
    expect(await f.request("/jobs?segment=active", "foreman")).toMatchObject({ status: 200, body: { data: { audience: "foreman" } } });
    expect(await f.request(path, "admin", "admin-records-pay", payment)).toMatchObject({ status: 200, body: { data: {
      bill: { outcome: { status: "paid" } },
    } } });
    expect(await f.request("/jobs?segment=needs_you", "admin")).toMatchObject({ status: 200, body: { data: { unpaidBills: [] } } });
  } finally { f.db.close(); clock.mockRestore(); }
});

test("sign-off materializes one invoice only while the attributed same-business issuer is live", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    await grantForemanIssuance(f.db, now);
    const billReference = "RR-0413";
    expect(await f.submit({ ...submission("issuer-wrap"), billReference, billAmountMinor: 25_200 })).toMatchObject({
      status: 200, body: { data: { actions: { canIssueBill: true } } },
    });
    expect(await f.db.prepare("SELECT bill_hint_by, bill_hint_grant_id FROM completions").first())
      .toEqual({ bill_hint_by: "foreman", bill_hint_grant_id: "foreman-issue" });
    expect(await f.db.prepare("SELECT count(*) FROM bills").first("count(*)")).toBe(0);
    expect((await f.signOff("issuer-wrap", "publish-authorized")).status).toBe(200);
    expect((await f.signOff("issuer-wrap", "publish-authorized")).status).toBe(200);
    expect(await f.db.prepare("SELECT count(*) FROM bills").first("count(*)")).toBe(1);
    const bill = resultSchema(getJobBillRoute.output).parse((await f.request("/jobs/job/bill", "customer")).body);
    expect(bill).toMatchObject({ data: { bill: {
      number: billReference, totalMinor: 25_200, netMinor: 21_000, taxMinor: 4_200, issuedAt: now,
      dueAt: now + 7 * day - hour, paymentInstructions: null, documentUrl: null, matchesApprovedScope: true,
    } } });
    const notices = await f.db.prepare("SELECT link_token FROM notifications WHERE kind = 'bill_issued'").all<{ link_token: string }>();
    expect(notices.results).toHaveLength(1);
    expect(await f.request(`/links/${notices.results[0]!.link_token}`, "customer")).toMatchObject({
      status: 200, body: { data: { kind: "bill", bill: { bill: { number: billReference } } } },
    });
    expect(f.wakes).toHaveLength(2);
  } finally { f.db.close(); clock.mockRestore(); }
});

test.each(["expired", "replaced", "issuer role revoked"] as const)("sign-off keeps the bill hint when its issuing authority is %s", async (change) => {
  const clock = spyOn(Date, "now").mockReturnValue(now);
  const f = await fixture();
  try {
    await grantForemanIssuance(f.db, now);
    const cutoff = now + 1, billReference = "RR-0414";
    if (change === "expired") {
      await f.db.prepare("UPDATE business_grants SET valid_until = ? WHERE id = 'foreman-issue'").bind(cutoff).run();
    }
    expect((await f.submit({ ...submission("issuer-wrap"), billReference, billAmountMinor: 25_200 })).status).toBe(200);
    expect(await f.db.prepare("SELECT bill_hint_grant_id FROM completions").first("bill_hint_grant_id")).toBe("foreman-issue");
    if (change === "replaced") {
      await f.db.batch([
        f.db.prepare("UPDATE business_grants SET revoked_at = ? WHERE id = 'foreman-issue'").bind(cutoff),
        f.db.prepare(`INSERT INTO business_grants (id, business_id, membership_id, capability, issuer_id, valid_from)
          VALUES ('replacement-issue', 'business', 'foreman-member', 'issue_bill', 'admin', ?)`).bind(cutoff),
      ]);
    } else if (change === "issuer role revoked") {
      await f.db.prepare("UPDATE membership_roles SET revoked_at = ?, revoked_by = 'admin' WHERE id = 'foreman-admin-role'").bind(cutoff).run();
    }
    clock.mockReturnValue(cutoff);
    expect(await f.signOff("issuer-wrap", "customer-sign-off")).toMatchObject({
      status: 200, body: { data: { submission: { state: "signed_off" } } },
    });
    expect(await f.request("/jobs/job/bill", "customer")).toMatchObject({ status: 200, body: { data: { bill: null } } });
    expect(await f.request("/jobs/job", "admin")).toMatchObject({ status: 200, body: { data: { job: {
      readyBill: { number: billReference },
    } } } });
    expect(await f.db.prepare("SELECT count(*) FROM notifications WHERE kind = 'bill_issued'").first("count(*)")).toBe(0);
  } finally { f.db.close(); clock.mockRestore(); }
});
