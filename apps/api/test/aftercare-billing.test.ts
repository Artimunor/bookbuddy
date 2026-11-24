import { expect, spyOn, test } from "bun:test";
import {
  businessOverviewSchema, getJobBillRoute, getProblemCaseRoute, listJobCasesRoute, openLinkRoute, operationIdHeader,
} from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { runEffectBatch } from "../src/effects";
import { randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential } from "../src/modules/auth/session";
import { createTestD1 } from "./d1";

const friday = Date.parse("2026-03-27T10:00:00Z");
const tuesday = Date.parse("2026-03-31T09:00:00Z"); // Monday is a staffed-calendar holiday and DST starts on Sunday.
const wednesday = Date.parse("2026-04-01T09:00:00Z");
const viewers = ["customer", "steward", "reader", "foreman", "billing", "admin"] as const;
type Viewer = (typeof viewers)[number];
const lines = [
  { originalLabel: "Repair", originalLanguage: "en", netMinor: 20_000, taxMinor: 4_000 },
  { originalLabel: "Rail", originalLanguage: "en", netMinor: 3_000, taxMinor: 600 },
];
const instructions = { instructions: { language: "en", text: "Transfer to the provider account" }, reference: "REF-0412" };
const total = 27_600;
const invoice = (id: string, replacesId: string | null = null) => ({ id, replacesId, number: "RR-0412", currency: "EUR",
  providerDocumentRef: `document-${id}`, paymentInstructions: instructions, lines });
const report = { id: "bill-case", reportEventId: "opening-event", category: "bill", billId: "bill-v1",
  affectedItem: { kind: "quote", quoteVersionId: "approved-quote", lineNo: 1 },
  description: { language: "en", text: "Private report about this line" }, evidence: ["report-photo"], expectedProviderAudience: "provider_billing" };

async function fixture() {
  const db = await createTestD1();
  const app = createApp();
  app.onError((error) => { throw error; });
  const env = { DB: db, CASE_STEWARD_ACCOUNT_ID: "steward", EFFECTS: { async send() {} } } as unknown as Bindings;
  const execution = { waitUntil() {}, passThroughOnException() {} };
  const identities = await Promise.all(viewers.map(async (id) => {
    const credential = randomToken();
    return { id, credential, hash: await hashSessionCredential(credential) };
  }));
  await db.batch([
    ...identities.flatMap(({ id, hash }) => [db.prepare(`INSERT INTO accounts(id, email_normalized, display_name, verified_at, setup_at, state)
      VALUES (?, ?, ?, 1, 1, 'active')`).bind(id, `${id}@example.test`, id),
    db.prepare("INSERT INTO account_contexts(id, account_id, role) VALUES (?, ?, 'customer')").bind(`${id}-customer`, id),
    db.prepare(`INSERT INTO sessions(id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
      VALUES (?, ?, ?, ?, 'device', 1, ?)`).bind(`${id}-session`, id, hash, `${id}-customer`, friday + 30 * 86_400_000)]),
    db.prepare("INSERT INTO operating_areas VALUES ('area', 'Area', 'Europe/Madrid', '[0]')"),
    db.prepare(`INSERT INTO staffed_calendar(id, area_id, local_date) VALUES ('holiday', 'area', '2026-03-30')`),
    db.prepare(`INSERT INTO businesses(id, legal_name, public_name, verified_work_contact, catchment_id, state)
      VALUES ('business', 'Provider Legal', 'Provider', 'work@example.test', 'area', 'approved')`),
    ...(["foreman", "billing", "admin"] as const).flatMap((id) => {
      const role = id === "foreman" ? "foreman" : "provider_admin";
      return [db.prepare(`INSERT INTO memberships (id, business_id, account_id, state) VALUES (?, 'business', ?, 'active')`).bind(`${id}-member`, id),
        db.prepare(`INSERT INTO membership_roles(id, membership_id, business_id, account_id, role, granted_at)
          VALUES (?, ?, 'business', ?, ?, 1)`).bind(`${id}-role`, `${id}-member`, id, role),
        db.prepare(`INSERT INTO account_contexts(id, account_id, role, business_id, role_grant_id)
          VALUES (?, ?, ?, 'business', ?)`).bind(`${id}-staff`, id, role, `${id}-role`),
        db.prepare("UPDATE sessions SET active_context_id = ? WHERE id = ?").bind(`${id}-staff`, `${id}-session`)];
    }),
    db.prepare(`INSERT INTO business_grants (id, business_id, membership_id, capability, issuer_id, valid_from) VALUES
      ('issue', 'business', 'billing-member', 'issue_bill', 'admin', 1),
      ('paid', 'business', 'billing-member', 'record_paid', 'admin', 1),
      ('defer', 'business', 'billing-member', 'billing_deferral', 'admin', 1)`),
    db.prepare(`INSERT INTO places(id, owner_id, alias, normalized_address, state)
      VALUES ('place', 'customer', 'Villa', 'Private address', 'pending_verification')`),
    db.prepare(`INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES ('place', 'customer', 1, 1), ('place', 'reader', 1, 1)`),
    db.prepare(`UPDATE places SET named_approver_id = 'customer', pin = '{"latitude":1,"longitude":1}',
      site_zone = 'Europe/Madrid', area_id = 'area', state = 'in_area' WHERE id = 'place'`),
    db.prepare(`INSERT INTO place_grants(id, place_id, account_id, capability, issuer_id, valid_from) VALUES
      ('reader-view', 'place', 'reader', 'view', 'customer', 1),
      ('approve', 'place', 'customer', 'approve', 'customer', 1),
      ('sign-off', 'place', 'customer', 'sign_off', 'customer', 1),
      ('bill-view', 'place', 'customer', 'bill_view', 'customer', 1)`),
    db.prepare(`INSERT INTO jobs(id, reference, business_id, place_id, requester_id, accountable_foreman_membership_id, trade, origin, state)
      VALUES ('job', 'BB-123', 'business', 'place', 'customer', 'foreman-member', 'Door repair', 'bookbuddy', 'open')`),
    db.prepare(`INSERT INTO requests(job_id, original_text, original_language, arrival_arrangement, submitted_at)
      VALUES ('job', 'Door repair', 'en', 'requester', 2)`),
    db.prepare(`INSERT INTO terms_versions VALUES ('terms', 'business', 1, 'Provider Legal', 'Terms', 'en', 'Consent', 'terms-hash')`),
    db.prepare("INSERT INTO quotes VALUES ('quote', 'job')"),
    db.prepare(`INSERT INTO quote_versions (id, quote_id, job_id, business_id, no, author_id, terms_id, original_locale,
      scope, exclusions, net_minor, tax_minor, total_minor, currency, state)
      VALUES ('approved-quote', 'quote', 'job', 'business', 1, 'foreman', 'terms', 'en', 'Repair', '', 20000, 4000, 24000, 'EUR', 'draft')`),
    db.prepare("INSERT INTO quote_items VALUES ('approved-quote', 1, 'Repair', 1, 20000, 4000, 'Photo', NULL)"),
    db.prepare("UPDATE quote_versions SET state = 'issued', publisher_id = 'admin', issued_at = 3, expires_at = 50"),
    db.prepare(`INSERT INTO approvals (id, quote_version_id, account_id, grant_id, terms_hash, decision, at)
      VALUES ('quote-approval', 'approved-quote', 'customer', 'approve', 'terms-hash', 'approve', 4)`),
    db.prepare("UPDATE quote_versions SET state = 'approved'"),
    db.prepare("INSERT INTO change_proposals VALUES ('proposal', 'job', 'approved-quote')"),
    db.prepare(`INSERT INTO change_versions (id, proposal_id, job_id, business_id, no, author_id, terms_id, original_locale,
      original_text, delta_minor, total_minor, timing, affected_items, created_at, state)
      VALUES ('approved-change', 'proposal', 'job', 'business', 1, 'foreman', 'terms', 'en', 'Rail', 3600, 27600, 'Same visit', 'Door', 4, 'draft')`),
    db.prepare("INSERT INTO change_items VALUES ('approved-change', 1, 'Rail', 1, 3000, 600, 'Photo', NULL)"),
    db.prepare("UPDATE change_versions SET state = 'issued', publisher_id = 'admin', issued_at = 5, expires_at = 50"),
    db.prepare(`INSERT INTO approvals (id, change_version_id, account_id, grant_id, terms_hash, decision, at)
      VALUES ('change-approval', 'approved-change', 'customer', 'approve', 'terms-hash', 'approve', 6)`),
    db.prepare("UPDATE change_versions SET state = 'approved'"),
    db.prepare(`INSERT INTO media_stages(id, context_id, caller, parent_scope_id, created_at, expires_at) VALUES
      ('draft', 'customer-customer', 'case', 'job', 1, ?), ('reader-draft', 'reader-customer', 'case', 'job', 1, ?)`)
      .bind(friday + 86_400_000, friday + 86_400_000),
    db.prepare(`INSERT INTO attachments(id, stage_id, object_key, mime, bytes, state, retention_class, etag) VALUES
      ('report-photo', 'draft', 'fixture/photo', 'image/jpeg', 100, 'ready', 'unlinked', 'etag'),
      ('pending-photo', 'draft', 'fixture/pending', 'image/jpeg', 100, 'reserved', 'unlinked', NULL),
      ('reader-photo', 'reader-draft', 'fixture/reader', 'image/jpeg', 100, 'ready', 'unlinked', 'etag')`),
  ]);

  async function request(path: string, viewer: Viewer, operationId?: string, payload: unknown = {}) {
    const { batch, query } = db.calls;
    const authorization = `Bearer ${identities.find(({ id }) => id === viewer)!.credential}`;
    const response = await app.request(`https://bookbuddy.test/api/v1${path}`, {
      method: operationId ? "POST" : "GET",
      headers: operationId ? { Authorization: authorization, [operationIdHeader]: operationId, "Content-Type": "application/json" }
        : { Authorization: authorization },
      body: operationId ? JSON.stringify({ operationId, payload }) : undefined,
    }, env, execution);
    expect(db.calls.batch - batch + db.calls.query - query).toBe(1);
    if (operationId) expect(db.calls.batch - batch).toBe(1);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    return { status: response.status, body: await response.json() as { ok: boolean; data?: unknown; error?: { code: string } } };
  }
  const signOff = () => db.batch([
    db.prepare(`INSERT INTO completions (id, job_id, base_quote_version_id, no, submitter_id, finished_at, submitted_at, state)
      VALUES ('completion', 'job', 'approved-quote', 1, 'foreman', 7, 8, 'submitted')`),
    db.prepare(`INSERT INTO completion_items (id, completion_id, quote_version_id, line_no, outcome, original_language, result_note)
      VALUES ('item-1', 'completion', 'approved-quote', 1, 'done', 'en', 'Repaired')`),
    db.prepare(`INSERT INTO completion_items (id, completion_id, change_version_id, line_no, outcome, original_language, result_note)
      VALUES ('item-2', 'completion', 'approved-change', 1, 'done', 'en', 'Installed')`),
    db.prepare("INSERT INTO sign_offs VALUES ('signed', 'job', 'completion', 'customer', 'sign-off', 'terms-hash', 9)"),
  ]);
  return { db, env, request, signOff };
}

function projection<T>(schema: { parse(value: unknown): T }, result: { status: number; body: { ok: boolean; data?: unknown } }) {
  expect(result.status).toBe(200);
  expect(result.body.ok).toBe(true);
  return schema.parse(result.body.data);
}

const billingPath = "/jobs/job/bills";
const overviewPath = "/businesses/business/overview";
const billPath = "/jobs/job/bill";
const reportsPath = "/jobs/job/problem-cases";
const casesPath = "/jobs/job/cases";
const casePath = "/cases/bill-case";
const eventsPath = `${casePath}/events`;

test("only live billing grants can issue and reconcile the effective approved invoice", async () => {
  const now = spyOn(Date, "now").mockReturnValue(friday);
  try {
    const f = await fixture();
    expect((await f.request(billingPath, "admin", "admin-issue", invoice("bill-v1"))).status).toBe(404);
    expect((await f.request(billingPath, "billing", "wrong-scope", { ...invoice("bill-v1"), lines: lines.slice(0, 1) })).status).toBe(409);
    const issued = projection(getJobBillRoute.output, await f.request(billingPath, "billing", "issue-v1", invoice("bill-v1")));
    expect(issued.bill).toMatchObject({ version: 1, totalMinor: total, dueAt: Date.parse("2026-04-03T09:00:00Z") });
    expect((await f.request(billingPath, "billing", "duplicate-effective", invoice("bill-v2"))).status).toBe(409);
    expect((await f.request(billingPath, "billing", "unchanged-invoice", { ...invoice("bill-v1", "bill-v1"), id: "other-id" })).status).toBe(409);
    const replacement = projection(getJobBillRoute.output, await f.request(billingPath, "billing", "replace", invoice("bill-v2", "bill-v1")));
    expect(replacement.bill).toMatchObject({ id: "bill-v2", replacesId: "bill-v1", version: 2, state: "issued" });
    expect((await f.request(billPath, "reader")).status).toBe(404);
    const customer = projection(getJobBillRoute.output, await f.request(billPath, "customer"));
    expect(customer).toMatchObject({ audience: "customer", bill: { matchesApprovedScope: true, paymentInstructions: instructions },
      priorBills: [{ id: "bill-v1", state: "replaced" }] });
    const foreman = projection(getJobBillRoute.output, await f.request(billPath, "foreman"));
    expect(foreman).toMatchObject({ audience: "foreman", bill: { totalMinor: total } });
    expect(foreman.bill).not.toHaveProperty("paymentInstructions");
    expect(projection(businessOverviewSchema, await f.request(overviewPath, "admin")).bills).toEqual({ openCount: 1, totalMinor: total, currency: "EUR" });

    const paidPath = "/bills/bill-v2/record-paid";
    const paid = { id: "matched-payment", expectedPriorId: "transfer-check", amountMinor: total, verifiedReference: "provider-bank-reference" };
    expect((await f.request(paidPath, "admin", "forbidden-match", paid)).status).toBe(404);
    await f.signOff();
    projection(getJobBillRoute.output, await f.request("/bills/bill-v2/record-checking", "billing", "check", {
      id: "transfer-check", expectedPriorId: null, reason: "Match still pending",
    }));
    expect((await f.request(paidPath, "billing", "stale-head", { ...paid, expectedPriorId: null })).status).toBe(409);
    const checking = projection(getJobBillRoute.output, await f.request(billPath, "customer"));
    expect(checking.bill).toMatchObject({ paymentInstructions: null, outcome: { status: "checking", record: { id: "transfer-check" } } });
    const matched = projection(getJobBillRoute.output, await f.request(paidPath, "billing", "match", paid));
    expect(matched.bill).toMatchObject({ outcome: { status: "paid", record: { id: "matched-payment", priorId: "transfer-check" } } });
    expect(await f.db.prepare("SELECT state FROM jobs WHERE id = 'job'").first("state")).toBe("closed");
    expect((await f.request(paidPath, "billing", "match", paid)).status).toBe(200);
    expect(projection(businessOverviewSchema, await f.request(overviewPath, "admin")).bills.openCount).toBe(0);
    const token = await f.db.prepare("SELECT link_token FROM notifications WHERE kind = 'bill_paid'").first<string>("link_token");
    expect(projection(openLinkRoute.output, await f.request(`/links/${token}`, "customer"))).toMatchObject({ kind: "bill", bill: { bill: { id: "bill-v2" } } });
    expect((await f.request(`/links/${token}`, "reader")).body.data).toMatchObject({ kind: "unavailable" });
    const corrected = projection(getJobBillRoute.output, await f.request("/bills/bill-v2/correct-payment", "billing", "correct", {
      id: "corrected-payment", expectedPriorId: "matched-payment", reason: "Wrong transfer reference",
    }));
    expect(corrected.bill).toMatchObject({ outcome: { status: "checking", record: { id: "corrected-payment" } } });
    expect(await f.db.prepare("SELECT state FROM jobs WHERE id = 'job'").first("state")).toBe("open");
    await f.request("/bills/bill-v2/confirm-no-funds", "billing", "no-funds", {
      id: "no-funds", expectedPriorId: "corrected-payment", reason: "No funds received",
    });
    const due = projection(getJobBillRoute.output, await f.request(billPath, "customer"));
    expect(due.bill).toMatchObject({ paymentInstructions: instructions, outcome: { status: "due", record: { id: "no-funds" } },
      history: [{ id: "transfer-check" }, { id: "matched-payment", corrected: true }, { id: "corrected-payment" }, { id: "no-funds" }] });
    expect(JSON.stringify(due)).not.toContain(paid.verifiedReference);
  } finally { now.mockRestore(); }
});

test("case evidence, due reminders and minimum provider packet obey the live audience", async () => {
  const now = spyOn(Date, "now").mockReturnValue(friday);
  try {
    const f = await fixture();
    await f.request(billingPath, "billing", "issue", invoice("bill-v1"));
    expect(projection(listJobCasesRoute.output, await f.request(`${casesPath}?category=bill`, "customer"))).toMatchObject({
      cases: [], newCaseAudience: { businessId: "business", providerName: "Provider" },
    });
    expect(projection(listJobCasesRoute.output, await f.request(`${casesPath}?category=quality`, "customer")).newCaseAudience).toBeNull();
    expect((await f.request(reportsPath, "reader", "reader-report", report)).status).toBe(404);
    expect((await f.request(reportsPath, "customer", "foreign-attachment", { ...report, evidence: ["reader-photo"] })).status).toBe(409);
    expect((await f.request(reportsPath, "customer", "not-ready", { ...report, evidence: ["pending-photo"] })).status).toBe(409);
    const opened = projection(getProblemCaseRoute.output, await f.request(reportsPath, "customer", "open", report));
    expect(opened).toMatchObject({ audience: "reporter", signOff: null, receipt: { state: "open", acknowledgeBy: tuesday, firstUpdateBy: wednesday, nextUpdateAt: tuesday },
      report: { evidence: [{ attachmentId: "report-photo", availability: "available" }] }, affectedItem: { ref: report.affectedItem } });
    expect(await f.db.prepare("SELECT attachment_id, case_event_id FROM case_attachments").first()).toEqual({
      attachment_id: "report-photo", case_event_id: "opening-event",
    });
    expect((await f.request(casePath, "reader")).status).toBe(404);
    expect((await f.request(casePath, "admin")).status).toBe(404);
    expect((await f.request(casePath, "foreman")).status).toBe(404);
    expect((await f.request(casesPath, "admin")).status).toBe(404);
    expect(projection(getProblemCaseRoute.output, await f.request(casePath, "steward"))).toMatchObject({ audience: "case_owner" });
    const beforePacket = projection(getProblemCaseRoute.output, await f.request(casePath, "billing"));
    expect(beforePacket).toMatchObject({ audience: "provider_billing", packets: [], replies: [], canRespond: false });
    expect(JSON.stringify(beforePacket)).not.toContain(report.description.text);
    const reply = { id: "reply", kind: "substantive_update", content: { language: "en", text: "Provider reply" }, evidence: [] };
    expect((await f.request(eventsPath, "billing", "premature", reply)).status).toBe(409);
    const packet = { id: "packet", kind: "provider_packet", content: { language: "en", text: "Review invoice line one" }, evidence: [] };
    await f.request(eventsPath, "steward", "share", packet);
    const provider = projection(getProblemCaseRoute.output, await f.request(eventsPath, "billing", "reply", reply));
    expect(provider).toMatchObject({ packets: [{ id: "packet", content: { original: packet.content } }], replies: [{ id: "reply" }] });
    expect(JSON.stringify(provider)).not.toContain("Villa");
    expect(JSON.stringify(provider)).not.toContain(report.description.text);

    const deferred = { id: "deferral", caseId: "bill-case", expectedPriorId: null, amountMinor: total, basis: "Disputed invoice",
      affectedLineNos: [1, 2], reviewAt: tuesday };
    expect((await f.request("/bills/bill-v1/defer-collection", "admin", "forbidden-deferral", deferred)).status).toBe(404);
    projection(getJobBillRoute.output, await f.request("/bills/bill-v1/defer-collection", "billing", "defer", deferred));
    expect(projection(getJobBillRoute.output, await f.request(billPath, "customer")).bill).toMatchObject({
      activeDeferral: { id: "deferral", amountMinor: total }, outcome: { status: "due" }, paymentInstructions: null,
    });
    await f.request("/bills/bill-v1/release-deferral", "billing", "release", { deferralId: "deferral", disposition: "resume_collection" });

    now.mockReturnValue(tuesday);
    await runEffectBatch(f.env, null, tuesday);
    const reminder = await f.db.prepare("SELECT link_token FROM notifications WHERE kind = 'case_acknowledgement_due'").first<string>("link_token");
    expect(projection(openLinkRoute.output, await f.request(`/links/${reminder}`, "steward"))).toMatchObject({ kind: "problem_case", case: { audience: "case_owner" } });
    expect(projection(getProblemCaseRoute.output, await f.request(eventsPath, "steward", "ack", { id: "ack", kind: "acknowledged" }))).toMatchObject({
      receipt: { state: "open", nextUpdateAt: wednesday },
    });
    const progress = projection(getProblemCaseRoute.output, await f.request(eventsPath, "steward", "progress", {
      ...reply, id: "owner-progress", content: { language: "en", text: "Awaiting the plan" },
    }));
    expect(progress.receipt).toMatchObject({ state: "awaiting_plan", nextUpdateAt: Date.parse("2026-04-02T09:00:00Z") });
    await f.signOff();
    const privateCase = projection(getProblemCaseRoute.output, await f.request(reportsPath, "customer", "private", {
      ...report, id: "private-case", reportEventId: "private-event", evidence: [], expectedProviderAudience: null,
    }));
    expect(privateCase).toMatchObject({ disclosedProviderAudience: null, signOff: { id: "signed" } });
    expect((await f.request("/cases/private-case", "billing")).status).toBe(404);
    expect((await f.request(eventsPath, "steward", "undo-signoff", { id: "undo", kind: "correction_requested", completionId: "completion",
      content: { language: "en", text: "Review completion" } })).status).toBe(409);
    await f.request(eventsPath, "steward", "resolve", { ...reply, id: "resolved", kind: "resolved" });
    const closed = projection(getProblemCaseRoute.output, await f.request(eventsPath, "steward", "close", { id: "closed", kind: "closed" }));
    expect(closed.receipt).toMatchObject({ state: "closed", nextUpdateAt: null });
    expect(projection(getJobBillRoute.output, await f.request(billPath, "customer"))).toMatchObject({
      bill: { totalMinor: total, outcome: { status: "due" }, paymentInstructions: instructions }, signOff: { id: "signed" },
    });
    expect(await f.db.prepare("SELECT count(*) AS n FROM effect_outbox WHERE resource_ref = 'bill-case' AND state = 'pending'").first("n")).toBe(0);
    await f.db.prepare("UPDATE case_grants SET revoked_at = ? WHERE case_id = 'bill-case'").bind(tuesday).run();
    expect((await f.request(casePath, "billing")).status).toBe(404);
  } finally { now.mockRestore(); }
});
