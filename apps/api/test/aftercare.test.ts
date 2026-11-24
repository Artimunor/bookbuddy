import { expect, test } from "bun:test";
import { customerBillProjectionSchema, recordPaidRoute, submitCompletionPayloadSchema } from "@bookbuddy/api-contract";
import { projectBillPaymentStatus } from "@bookbuddy/domain";
import type { PaidRecordKind } from "@bookbuddy/domain";
import { createTestD1 } from "./d1";
import type { TestD1 } from "./d1";

const termsHash = "exact-terms-v1";

async function withJob(run: (db: TestD1) => Promise<void>) {
  const db = await createTestD1();
  try {
    await db.batch([
      db.prepare(`INSERT INTO accounts (id, email_normalized, verified_at, state) VALUES
        ('customer', 'owner@example.test', 1, 'active'), ('foreman', 'foreman@example.test', 1, 'active'),
        ('admin', 'admin@example.test', 1, 'active'), ('desk', 'desk@example.test', 1, 'active')`),
      db.prepare("INSERT INTO operating_areas VALUES ('area', 'Area', 'Europe/Madrid', '[0]')"),
      db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
        VALUES ('business', 'Provider Legal', 'Provider', 'work@example.test', 'area', 'approved')`),
      db.prepare(`INSERT INTO memberships (id, business_id, account_id, state) VALUES
        ('foreman-member', 'business', 'foreman', 'active'), ('admin-member', 'business', 'admin', 'active')`),
      db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at) VALUES
        ('foreman-role', 'foreman-member', 'business', 'foreman', 'foreman', 1),
        ('admin-role', 'admin-member', 'business', 'admin', 'provider_admin', 1)`),
      db.prepare(`INSERT INTO business_grants (id, business_id, membership_id, capability, issuer_id, valid_from) VALUES
        ('paid-grant', 'business', 'admin-member', 'record_paid', 'admin', 1),
        ('defer-grant', 'business', 'admin-member', 'billing_deferral', 'admin', 1)`),
      db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state)
        VALUES ('place', 'customer', 'Villa', 'Address', 'pending_verification')`),
      db.prepare(`INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES ('place', 'customer', 1, 1)`),
      db.prepare(`UPDATE places SET named_approver_id = 'customer', pin = '{"latitude":1,"longitude":1}',
        site_zone = 'Europe/Madrid', area_id = 'area', state = 'in_area' WHERE id = 'place'`),
      db.prepare(`INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, valid_from) VALUES
        ('approve-grant', 'place', 'customer', 'approve', 'customer', 1),
        ('sign-off-grant', 'place', 'customer', 'sign_off', 'customer', 1)`),
      db.prepare(`INSERT INTO jobs (id, reference, business_id, place_id, requester_id, accountable_foreman_membership_id, origin, state)
        VALUES ('job', 'BB-123', 'business', 'place', 'customer', 'foreman-member', 'bookbuddy', 'open')`),
      db.prepare(`INSERT INTO terms_versions VALUES ('terms', 'business', 1, 'Provider Legal', 'Terms', 'es', 'Consent', ?)`)
        .bind(termsHash),
      db.prepare("INSERT INTO quotes VALUES ('quote', 'job')"),
      db.prepare(`INSERT INTO quote_versions (id, quote_id, job_id, business_id, no, author_id, terms_id, original_locale,
        scope, exclusions, net_minor, tax_minor, total_minor, currency, state)
        VALUES ('quote-v1', 'quote', 'job', 'business', 1, 'foreman', 'terms', 'es', 'Door repair', '', 20000, 4000, 24000, 'EUR', 'draft')`),
      db.prepare(`INSERT INTO quote_items (version_id, line_no, original_label, quantity, net_minor, tax_minor, evidence_rule)
        VALUES ('quote-v1', 1, 'Door', 1, 20000, 4000, 'Agreed test report')`),
      db.prepare("UPDATE quote_versions SET publisher_id = 'admin', issued_at = 2, expires_at = 50, state = 'issued' WHERE id = 'quote-v1'"),
      db.prepare(`INSERT INTO approvals (id, quote_version_id, account_id, grant_id, terms_hash, decision, at)
        VALUES ('approved-quote', 'quote-v1', 'customer', 'approve-grant', ?, 'approve', 3)`).bind(termsHash),
      db.prepare("UPDATE quote_versions SET state = 'approved' WHERE id = 'quote-v1'"),
      db.prepare(`INSERT INTO change_proposals VALUES ('change', 'job', 'quote-v1'), ('pending-change', 'job', 'quote-v1')`),
      db.prepare(`INSERT INTO change_versions (id, proposal_id, job_id, business_id, no, author_id, terms_id, original_locale,
        original_text, delta_minor, total_minor, timing, affected_items, created_at, state) VALUES
        ('change-v1', 'change', 'job', 'business', 1, 'foreman', 'terms', 'es', 'Rail', 1000, 25000, 'Same visit', 'Rail', 3, 'draft'),
        ('pending-v1', 'pending-change', 'job', 'business', 1, 'foreman', 'terms', 'es', 'Lock', 2000, 26000, 'Same visit', 'Lock', 3, 'draft')`),
      db.prepare(`INSERT INTO change_items (version_id, line_no, original_label, quantity, net_minor, tax_minor, evidence_rule) VALUES
        ('change-v1', 1, 'Rail', 1, 800, 200, 'Result note'), ('pending-v1', 1, 'Lock', 1, 1600, 400, 'Result note')`),
      db.prepare("UPDATE change_versions SET publisher_id = 'admin', issued_at = 4, expires_at = 50, state = 'issued'"),
      db.prepare(`INSERT INTO approvals (id, change_version_id, account_id, grant_id, terms_hash, decision, at)
        VALUES ('approved-change', 'change-v1', 'customer', 'approve-grant', ?, 'approve', 5)`).bind(termsHash),
      db.prepare("UPDATE change_versions SET state = 'approved' WHERE id = 'change-v1'"),
    ]);
    await run(db);
  } finally {
    db.close();
  }
}

function submit(db: TestD1, id: string, no: number) {
  return db.prepare(`INSERT INTO completions (id, job_id, base_quote_version_id, no, submitter_id, finished_at, submitted_at, state)
    VALUES (?, 'job', 'quote-v1', ?, 'foreman', 60, ?, 'submitted')`).bind(id, no, 60 + no);
}
function quoteLine(db: TestD1, id: string) {
  return db.prepare(`INSERT INTO completion_items (id, completion_id, quote_version_id, line_no, outcome, original_language, result_note, evidence_alternative)
    VALUES (?, ?, 'quote-v1', 1, 'done', 'es', 'Slides and locks', 'Agreed test report')`).bind(`${id}-quote`, id);
}
function changeLine(db: TestD1, id: string, version = "change-v1", reason: string | null = "Replacement unavailable") {
  return db.prepare(`INSERT INTO completion_items (id, completion_id, change_version_id, line_no, outcome, original_language, not_done_reason)
    VALUES (?, ?, ?, 1, 'not_done', 'es', ?)`).bind(`${id}-${version}`, id, version, reason);
}
function signOff(db: TestD1, id: string, completion: string, grant = "sign-off-grant", terms = termsHash) {
  return db.prepare(`INSERT INTO sign_offs (id, job_id, completion_id, approver_id, grant_id, terms_hash, at)
    VALUES (?, 'job', ?, 'customer', ?, ?, 80)`).bind(id, completion, grant, terms);
}

test("requires exact approved scope and a current version, then rejects a second sign-off for the job", () => withJob(async (db) => {
  await db.batch([submit(db, "first", 1), quoteLine(db, "first")]);
  await expect(submit(db, "second", 2).run()).rejects.toThrow(/current completion/);
  await expect(changeLine(db, "first", "pending-v1").run()).rejects.toThrow(/exact approved scope/);
  await expect(changeLine(db, "first", "change-v1", null).run()).rejects.toThrow(/completion_items_explanation/);
  await expect(signOff(db, "accept", "first").run()).rejects.toThrow(/current complete submission/);
  await db.batch([
    db.prepare("UPDATE completions SET state = 'returned' WHERE id = 'first'"),
    db.prepare("UPDATE completions SET state = 'superseded' WHERE id = 'first'"),
    submit(db, "second", 2), quoteLine(db, "second"), changeLine(db, "second"),
  ]);
  await expect(signOff(db, "stale", "first").run()).rejects.toThrow(/current complete submission/);
  await expect(signOff(db, "wrong-grant", "second", "approve-grant").run()).rejects.toThrow(/named sign-off grant/);
  await expect(signOff(db, "wrong-terms", "second", "sign-off-grant", "other-terms").run()).rejects.toThrow(/terms/);
  await signOff(db, "accept", "second").run();
  expect(await db.prepare("SELECT state FROM completions WHERE id = 'second'").first("state")).toBe("signed_off");
  await expect(signOff(db, "duplicate-sign-off", "second").run()).rejects.toThrow(/already signed off/);
  await expect(db.prepare("DELETE FROM sign_offs WHERE id = 'accept'").run()).rejects.toThrow(/immutable/);
  await expect(db.prepare("UPDATE completion_items SET result_note = 'Different test' WHERE id = 'second-quote'").run()).rejects.toThrow(/immutable/);
}));

test("completion bill hints cannot borrow issuer proof or gain it after submission", () => withJob(async (db) => {
  const hinted = db.prepare(`INSERT INTO completions (id, job_id, base_quote_version_id, no, submitter_id, finished_at, submitted_at,
    bill_reference_hint, bill_amount_minor, bill_hint_by, bill_hint_grant_id, state)
    VALUES ('hinted', 'job', 'quote-v1', 1, 'foreman', 60, 61, 'REF-0412', 25000, 'foreman', ?, 'submitted')`);
  await expect(hinted.bind("paid-grant").run()).rejects.toThrow(/named provider issuer/);
  await hinted.bind(null).run();
  await expect(db.prepare("UPDATE completions SET bill_hint_grant_id = 'paid-grant'").run()).rejects.toThrow(/immutable/);
  await expect(db.prepare("UPDATE completions SET bill_hint_by = 'admin'").run()).rejects.toThrow(/immutable/);
}));

const instructions = { instructions: { language: "en", text: "Pay the provider directly" }, reference: "RR-0412" };
const line = { originalLabel: "Door", originalLanguage: "es", netMinor: 20_000, taxMinor: 4_000 };
function invoice(db: TestD1, id: string, number: string, version = 1, replacesId: string | null = null, document = "invoice-doc") {
  return db.prepare(`INSERT INTO bills (id, job_id, business_id, number, version, replaces_id, net_minor, tax_minor, total_minor,
    currency, provider_document_ref, payment_instructions, line_items, issued_at, due_at, state)
    VALUES (?, 'job', 'business', ?, ?, ?, 20000, 4000, 24000, 'EUR', ?, ?, ?, 100, 700, 'issued')`)
    .bind(id, number, version, replacesId, document, JSON.stringify(instructions), JSON.stringify([
      { ...line, scope: { quoteVersionId: "quote-v1", lineNo: 1 } },
    ]));
}

test("rejects a second effective bill and keeps a changed replacement linked to the original", () => withJob(async (db) => {
  await invoice(db, "invoice", "RR-0412").run();
  await expect(invoice(db, "another", "RR-0413").run()).rejects.toThrow(/effective bill/);
  await expect(db.batch([
    db.prepare("UPDATE bills SET state = 'replaced' WHERE id = 'invoice'"), invoice(db, "same-copy", "RR-0412", 2, "invoice"),
  ])).rejects.toThrow(/new issued version/);
  await db.batch([
    db.prepare("UPDATE bills SET state = 'replaced' WHERE id = 'invoice'"), invoice(db, "revision", "RR-0412", 2, "invoice", "corrected-doc"),
  ]);
  expect((await db.prepare("SELECT id, state, replaces_id FROM bills ORDER BY version").all()).results).toEqual([
    { id: "invoice", state: "replaced", replaces_id: null }, { id: "revision", state: "issued", replaces_id: "invoice" },
  ]);
}));

test("steward grants are independently issued and revocation blocks direct case event writes", () => withJob(async (db) => {
  await expect(db.prepare("INSERT INTO steward_grants VALUES ('desk', 'desk', 1, NULL)").run()).rejects.toThrow(/CHECK/);
  await db.batch([
    db.prepare("INSERT INTO steward_grants VALUES ('desk', 'admin', 1, NULL)"),
    db.prepare(`INSERT INTO problem_cases (id, job_id, reference, reporter_id, case_owner_id, category,
      state, opened_at, acknowledge_by, first_update_by, next_update_at)
      VALUES ('case', 'job', 'BB-C43', 'customer', 'desk', 'quality', 'open', 105, 200, 300, 200)`),
    db.prepare(`INSERT INTO case_events (id, case_id, job_id, actor_id, kind, audience, at)
      VALUES ('ack', 'case', 'job', 'desk', 'acknowledged', 'reporter_and_owner', 106)`),
    db.prepare("UPDATE steward_grants SET revoked_at = 107 WHERE account_id = 'desk'"),
  ]);
  await expect(db.prepare(`INSERT INTO case_events (id, case_id, job_id, actor_id, kind, audience, original_text, original_language, at)
    VALUES ('resolved', 'case', 'job', 'desk', 'resolved', 'reporter_and_owner', 'Closed privately', 'en', 108)`).run())
    .rejects.toThrow(/attributed actor/);
  await expect(db.prepare("UPDATE steward_grants SET revoked_at = NULL WHERE account_id = 'desk'").run()).rejects.toThrow(/can only be revoked/);
}));

function payment(db: TestD1, id: string, kind: PaidRecordKind, prior: string | null, actor = "admin") {
  const verified = kind === "matched";
  return db.prepare(`INSERT INTO paid_records (id, bill_id, actor_id, kind, prior_id, amount_minor, verified_reference, reason, at)
    VALUES (?, 'invoice', ?, ?, ?, ?, ?, ?, 110)`)
    .bind(id, actor, kind, prior, verified ? 24_000 : null, verified ? "provider-only-reference" : null, verified ? null : "Reference did not match");
}

async function status(db: TestD1) {
  const head = await db.prepare(`SELECT p.kind FROM paid_records AS p WHERE p.bill_id = 'invoice'
    AND NOT EXISTS (SELECT 1 FROM paid_records AS next WHERE next.prior_id = p.id)`).first<{ kind: PaidRecordKind }>();
  return projectBillPaymentStatus(head?.kind ?? null);
}

test("provider-only corrections keep the stamped history and do not restore due or defer collection while checking", () => withJob(async (db) => {
  await db.batch([
    invoice(db, "invoice", "RR-0412"),
    db.prepare(`INSERT INTO problem_cases (id, job_id, reference, reporter_id, case_owner_id, category, bill_id, quote_version_id, line_no,
      state, opened_at, acknowledge_by, first_update_by, next_update_at)
      VALUES ('case', 'job', 'BB-C42', 'customer', 'desk', 'bill', 'invoice', 'quote-v1', 1, 'open', 105, 200, 300, 200)`),
    db.prepare(`INSERT INTO case_events (id, case_id, job_id, actor_id, kind, audience, original_text, original_language, at)
      VALUES ('report', 'case', 'job', 'customer', 'reported', 'reporter_and_owner', 'Please check the invoice.', 'en', 105)`),
  ]);
  const defer = db.prepare(`INSERT INTO bill_deferrals (id, job_id, bill_id, case_id, actor_id, grant_id, amount_minor, basis,
    affected_line_nos, at, review_at) VALUES ('defer', 'job', 'invoice', 'case', 'admin', 'defer-grant', 4000, 'Disputed amount', ?, 120, 300)`);
  await expect(payment(db, "customer-report", "matched", null, "customer").run()).rejects.toThrow(/provider billing authority/);
  await expect(payment(db, "foreman-report", "matched", null, "foreman").run()).rejects.toThrow(/provider billing authority/);
  await payment(db, "matched", "matched", null).run();
  expect(await status(db)).toBe("paid");
  await payment(db, "correction", "corrected", "matched").run();
  expect(await status(db)).toBe("checking");
  await expect(payment(db, "stale", "corrected", "matched").run()).rejects.toThrow(/current record/);
  await expect(defer.bind("[1]").run()).rejects.toThrow(/active unpaid dispute/);
  await payment(db, "unmatched", "no_funds_received", "correction").run();
  expect(await status(db)).toBe("due");
  await expect(defer.bind("[1,1]").run()).rejects.toThrow(/active unpaid dispute/);
  await defer.bind("[1]").run();
  await db.prepare("UPDATE problem_cases SET state = 'resolved', next_update_at = NULL WHERE id = 'case'").run();
  expect(await db.prepare("SELECT released_at FROM bill_deferrals WHERE id = 'defer'").first()).toEqual({ released_at: null });
  await db.prepare(`UPDATE bill_deferrals SET released_at = 150, released_by = 'admin', release_grant_id = 'defer-grant',
    disposition = 'resume_collection' WHERE id = 'defer'`).run();
  expect(await status(db)).toBe("due");
  expect(await db.prepare("SELECT count(*) AS n FROM paid_records").first("n")).toBe(3);
  expect(await db.prepare("SELECT state FROM bills WHERE id = 'invoice'").first("state")).toBe("issued");
}));

test("rating requires current verified closed delivery and stays once-per-job after withdrawal", () => withJob(async (db) => {
  const eligibility = db.prepare(`INSERT INTO rating_eligibilities VALUES ('job', 'customer', 'finished', 'desk', 90, 180)`);
  const rate = db.prepare(`INSERT INTO ratings (id, job_id, author_id, stars, submitted_at, state) VALUES (?, 'job', 'customer', 4, ?, 'submitted')`);
  await db.batch([submit(db, "finished", 1), quoteLine(db, "finished"), changeLine(db, "finished"), signOff(db, "accept", "finished")]);
  await expect(eligibility.run()).rejects.toThrow(/verified closed delivery/);
  await db.prepare("UPDATE jobs SET state = 'closed' WHERE id = 'job'").run();
  await expect(rate.bind("unverified", 95).run()).rejects.toThrow(/eligibility/);
  await eligibility.run();
  await expect(rate.bind("expired", 180).run()).rejects.toThrow(/eligibility/);
  await rate.bind("first-rating", 100).run();
  await db.prepare("UPDATE ratings SET state = 'withdrawn' WHERE id = 'first-rating'").run();
  await expect(rate.bind("second-rating", 101).run()).rejects.toThrow(/eligibility/);
}));

test("completion and bill contracts require exact items and do not prompt or expose reconciliation while checking", () => {
  const item = {
    id: "line-1", scope: { kind: "quote", quoteVersionId: "quote-v1", lineNo: 1 }, originalLanguage: "es",
    photos: [], outcome: "not_done", reason: "Replacement unavailable",
  };
  const submit = { id: "submission", baseQuoteVersionId: "quote-v1", expectedCompletionId: null, items: [item] };
  expect(submitCompletionPayloadSchema.safeParse(submit).success).toBe(true);
  expect(submitCompletionPayloadSchema.safeParse({ ...submit, items: [{ ...item, reason: "   " }] }).success).toBe(false);
  expect(submitCompletionPayloadSchema.safeParse({ ...submit, items: [item, { ...item, id: "line-2" }] }).success).toBe(false);

  const projection = {
    audience: "customer", signOff: null, priorBills: [],
    job: { jobId: "job", reference: "BB-123", title: "Door", providerDisplayName: "Provider", placeAlias: "Villa", siteZone: "Europe/Madrid" },
  };
  const corrected = { id: "record", priorId: "match", at: 110, actorDisplayName: "Admin", actorRole: "provider_admin", kind: "corrected", reason: "Reference did not match" };
  const bill = {
    id: "invoice", replacesId: null, number: "RR-0412", version: 1, state: "issued", currency: "EUR", netMinor: 20_000, taxMinor: 4_000,
    totalMinor: 24_000, issuedAt: 100, dueAt: 700, lines: [{ ...line, lineNo: 1, labelReading: null }], matchesApprovedScope: true,
    activeDeferral: null, documentUrl: null, history: [corrected], openCases: [], paymentInstructions: null,
    outcome: { status: "checking", record: corrected },
  };
  expect(customerBillProjectionSchema.safeParse({ ...projection, bill }).success).toBe(true);
  expect(customerBillProjectionSchema.safeParse({ ...projection, bill: { ...bill, paymentInstructions: instructions } }).success).toBe(false);
  expect(customerBillProjectionSchema.safeParse({ ...projection, bill: { ...bill, history: [{ ...corrected, verifiedReference: "PRIVATE" }] } }).success).toBe(false);
  const payload = { id: "new-match", expectedPriorId: null, amountMinor: 24_000, verifiedReference: "provider-match" };
  const request = { params: { id: "invoice" }, body: { operationId: "operation", payload } };
  expect(recordPaidRoute.input.safeParse(request).success).toBe(true);
  expect(recordPaidRoute.input.safeParse({ ...request, body: { ...request.body, payload: { ...payload, actorId: "customer" } } }).success).toBe(false);
});
