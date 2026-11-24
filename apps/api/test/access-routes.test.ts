import { expect, spyOn, test } from "bun:test";
import {
  acceptInvitationRoute, getBusinessEligibilityRoute, getBusinessPeopleRoute, getInvitationRoute, inviteBusinessMemberRoute,
  openLinkRoute, operationIdHeader, patchBusinessMemberRolesRoute, reissueInvitationRoute, resultSchema, revokeBusinessMemberRoute,
} from "@bookbuddy/api-contract";
import { INVITATION_POLICY } from "@bookbuddy/domain";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { invitationMailEffect, sealInviteEmail } from "../src/modules/access/mail";
import { loadDeliveryKey, loadOtpKey, mailboxKey, randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential } from "../src/modules/auth/session";
import { createTestD1 } from "./d1";

const secret = "test-only-key-for-bookbuddy-access-1234";
const deliverySecret = "A".repeat(43);
const origin = "https://bookbuddy.test";
const start = 1_800_000_000_000;
const missing = { code: "NOT_FOUND" };

async function fixture() {
  const db = await createTestD1(), app = createApp();
  const key = (await loadOtpKey(secret))!;
  const wakes: string[][] = [];
  const env = { DB: db, OTP_HMAC_KEY: secret, EFFECTS_ENCRYPTION_KEY: deliverySecret, PUBLIC_APP_ORIGIN: origin,
    EFFECTS: { async send(wake: { workKeys: string[] }) { wakes.push(wake.workKeys); } } } as unknown as Bindings;
  const execution = { waitUntil() {}, passThroughOnException() {} };

  async function account(id: string) {
    const email = `${id}@example.test`, credential = randomToken();
    const [digest, hash] = await Promise.all([mailboxKey(key, email), hashSessionCredential(credential)]);
    await db.batch([
      db.prepare(`INSERT INTO accounts(id, email_normalized, email_key, display_name, verified_at, setup_at, state)
        VALUES (?, ?, ?, ?, 1, 1, 'active')`).bind(id, email, digest, id),
      db.prepare("INSERT INTO account_contexts(id, account_id, role) VALUES (?, ?, 'customer')").bind(`${id}-customer`, id),
      db.prepare(`INSERT INTO sessions(id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
        VALUES (?, ?, ?, ?, 'device', 1, ?)`).bind(`${id}-session`, id, hash, `${id}-customer`, start + INVITATION_POLICY.reissueWindowMs * 3),
    ]);
    return credential;
  }

  const admin = await account("admin"), outsider = await account("outsider");
  await db.batch([
    db.prepare("INSERT INTO operating_areas(id, name, site_zone, polygon) VALUES ('area', 'Area', 'Europe/Lisbon', '[0]')"),
    db.prepare(`INSERT INTO businesses(id, legal_name, public_name, verified_work_contact, catchment_id, state) VALUES
      ('business', 'Provider LLC', 'Provider', 'work@example.test', 'area', 'approved'),
      ('other-business', 'Other LLC', 'Other', 'work@example.test', 'area', 'approved')`),
    db.prepare("INSERT INTO memberships(id, business_id, account_id, state) VALUES ('admin-member', 'business', 'admin', 'active')"),
    db.prepare(`INSERT INTO membership_roles(id, membership_id, business_id, account_id, role, granted_at)
      VALUES ('admin-role', 'admin-member', 'business', 'admin', 'provider_admin', 1)`),
    db.prepare(`INSERT INTO business_grants(id, business_id, membership_id, capability, issuer_id, valid_from)
      VALUES ('admin-capability', 'business', 'admin-member', 'membership_admin', 'admin', 1)`),
    db.prepare(`INSERT INTO account_contexts (id, account_id, role, business_id, role_grant_id)
      VALUES ('admin-business', 'admin', 'provider_admin', 'business', 'admin-role')`),
    db.prepare("UPDATE sessions SET active_context_id = 'admin-business' WHERE id = 'admin-session'"),
  ]);

  async function request(path: string, credential: string, operationId?: string, payload: unknown = {},
    method = operationId ? "POST" : "GET") {
    const { batch, query } = db.calls;
    const response = await app.request(`${origin}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${credential}`, ...(operationId ? { [operationIdHeader]: operationId, "Content-Type": "application/json" } : {}) },
      body: operationId ? JSON.stringify({ operationId, payload }) : undefined,
    }, env, execution);
    const directSessionRead = path === "/session";
    expect(db.calls.batch - batch).toBe(directSessionRead ? 0 : 1);
    expect(db.calls.query - query).toBe(directSessionRead ? 1 : 0);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    return { status: response.status, body: await response.json() as unknown };
  }

  async function issue(email: string, operation = "issue") {
    const response = await request("/businesses/business/invitations", admin, operation, { email, role: "worker" });
    const result = resultSchema(inviteBusinessMemberRoute.output).parse(response.body);
    if (!result.ok) throw new Error(`Issue failed: ${result.error.code}`);
    return result.data;
  }

  async function mailToken() {
    const effect = (await db.prepare("SELECT id, kind, resource_ref FROM effect_outbox WHERE id = ?").bind(wakes.at(-1)?.[0]).first<{
      id: string; kind: string; resource_ref: string;
    }>())!;
    expect(effect.resource_ref).not.toContain("https://");
    const message = await invitationMailEffect.prepareMail((await loadDeliveryKey(deliverySecret))!, effect);
    return new URL(message!.text.split(" ").at(-1)!).pathname.split("/").at(-1)!;
  }
  return { db, admin, outsider, account, request, issue, mailToken, wakes, key };
}

test("invite opens only for the verified mailbox and acceptance/revocation reconcile live access in one batch", async () => {
  const date = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    const invite = await f.issue("worker@example.test");
    expect(invite.expiresAt - invite.issuedAt).toBe(INVITATION_POLICY.validityMs);
    expect(f.wakes).toHaveLength(1);
    const token = await f.mailToken();
    const linkPath = `/links/${token}`;
    expect((await f.request(linkPath, f.outsider)).body).toMatchObject({ data: { kind: "unavailable", reason: "unavailable" } });
    expect((await f.request(`/invitations/${invite.id}`, f.outsider)).body).toMatchObject({ error: missing });
    // The mailbox did not have an account when invited. Only now does it obtain a verified session.
    const worker = await f.account("worker");
    const opened = resultSchema(openLinkRoute.output).parse((await f.request(linkPath, worker)).body);
    expect(opened).toMatchObject({ data: { kind: "invitation", invitation: { status: "pending", id: invite.id } } });
    expect((await f.request(`/invitations/${invite.id}/accept`, f.outsider, "accept")).body).toMatchObject({ error: missing });
    const acceptance = await f.request(`/invitations/${invite.id}/accept`, worker, "accept");
    const accepted = resultSchema(acceptInvitationRoute.output).parse(acceptance.body);
    if (!accepted.ok || accepted.data.currentAccess.kind !== "business") throw new Error(JSON.stringify(acceptance));
    const workerContext = accepted.data.currentAccess.context.scope.contextId;
    const membership = (await f.db.prepare(`SELECT m.id, g.id AS grant_id, c.id AS context_id FROM memberships m
      JOIN membership_roles g ON g.membership_id = m.id JOIN account_contexts c ON c.role_grant_id = g.id
      WHERE m.account_id = 'worker' AND m.state = 'active' AND g.role = 'worker'`).first<{ id: string; grant_id: string; context_id: string }>())!;
    expect(membership.context_id).toBe(workerContext);
    expect((await f.request(linkPath, worker)).body).toMatchObject({ data: { invitation: { status: "accepted" } } });
    await f.db.prepare("UPDATE sessions SET active_context_id = ? WHERE id = 'worker-session'").bind(workerContext).run();
    expect((await f.request(`/invitations/${invite.id}/accept`, worker, "accept")).body).toMatchObject({ data: accepted.data });
    expect((await f.request(`/invitations/${invite.id}/accept`, f.outsider, "accept")).body).toMatchObject({ error: missing });
    expect((await f.request("/members/admin-member/revoke", f.admin, "last-admin", { roleGrantId: "admin-role" })).status).toBe(409);
    expect(await f.db.prepare("SELECT revoked_at FROM membership_roles WHERE id = 'admin-role'").first("revoked_at")).toBeNull();
    await f.db.prepare("INSERT INTO sync_scope_state VALUES (?, 4)").bind(workerContext).run();
    const revokePath = `/members/${membership.id}/revoke`, removal = { roleGrantId: membership.grant_id };
    const revoked = await f.request(revokePath, f.admin, "revoke", removal);
    expect(resultSchema(revokeBusinessMemberRoute.output).parse(revoked.body)).toMatchObject({ data: { member: null, revoked: { role: "worker" } } });
    expect((await f.request(revokePath, f.admin, "revoke", removal)).status).toBe(200);
    expect((await f.request(revokePath, f.outsider, "revoke", removal)).body).toMatchObject({ error: missing });
    expect(await f.db.prepare("SELECT visibility_epoch FROM sync_scope_state WHERE context_id = ?").bind(workerContext).first("visibility_epoch")).toBe(5);
    expect((await f.request(linkPath, worker)).body).toMatchObject({ data: { kind: "unavailable", reason: "removed" } });
    expect((await f.request(`/invitations/${invite.id}/accept`, worker, "accept")).body).toMatchObject({ error: missing });
    expect(f.wakes).toHaveLength(1);
  } finally { f.db.close(); date.mockRestore(); }
});

test("expired invitation cannot be accepted and provider reissue enforces both rolling limits", async () => {
  const date = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    const worker = await f.account("worker");
    const initial = await f.issue("worker@example.test");
    const token = await f.mailToken();
    date.mockReturnValue(initial.expiresAt);
    const opening = resultSchema(getInvitationRoute.output).parse((await f.request(`/invitations/${initial.id}`, worker)).body);
    expect(opening).toMatchObject({ data: { status: "unavailable", reason: "expired" } });
    expect((await f.request(`/links/${token}`, f.outsider)).body).toMatchObject({ data: { kind: "unavailable", reason: "unavailable" } });
    expect((await f.request(`/invitations/${initial.id}/accept`, worker, "expired")).status).toBe(409);
    expect(await f.db.prepare("SELECT count(*) AS count FROM operation_receipts WHERE operation_id = 'expired'").first("count")).toBe(0);
    const response = await f.request(`/invitations/${initial.id}/reissue`, f.admin, "first");
    const first = resultSchema(reissueInvitationRoute.output).parse(response.body);
    if (!first.ok) throw new Error(JSON.stringify(response));
    const firstIssued = first.data.issuedAt;
    expect(first.data.id).not.toBe(initial.id);
    const tooSoon = await f.request(`/invitations/${first.data.id}/reissue`, f.admin, "too-soon");
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body).toMatchObject({ error: { code: "RATE_LIMITED", retryAt: firstIssued + INVITATION_POLICY.providerReissueCooldownMs } });
    date.mockReturnValue(firstIssued + INVITATION_POLICY.providerReissueCooldownMs);
    const second = resultSchema(reissueInvitationRoute.output).parse((await f.request(`/invitations/${first.data.id}/reissue`, f.admin, "second")).body);
    if (!second.ok) throw new Error(second.error.code);
    date.mockReturnValue(second.data.issuedAt + INVITATION_POLICY.providerReissueCooldownMs);
    const third = await f.request(`/invitations/${second.data.id}/reissue`, f.admin, "third");
    expect(third.body).toMatchObject({ error: { code: "RATE_LIMITED", retryAt: firstIssued + INVITATION_POLICY.reissueWindowMs } });
    expect(f.wakes).toHaveLength(3);
  } finally { f.db.close(); date.mockRestore(); }
});

test("provider delivery cooldown and rolling limit survive withdrawal and fresh invitation IDs", async () => {
  const date = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    const email = "worker@example.test", day = INVITATION_POLICY.providerReissueCooldownMs;
    const initial = await f.issue(email);
    const withdraw = (id: string, op: string) => f.request(`/invitations/${id}/withdraw`, f.admin, op);
    const issue = (op: string) => f.request("/businesses/business/invitations", f.admin, op, { email, role: "worker" });
    expect((await withdraw(initial.id, "withdraw-original")).status).toBe(200);
    expect(await issue("fresh")).toMatchObject({ status: 429, body: { error: { code: "RATE_LIMITED", retryAt: start + day } } });
    expect(f.wakes).toHaveLength(1);

    date.mockReturnValue(start + day);
    const fresh = await f.issue(email, "fresh");
    expect(fresh.id).not.toBe(initial.id);
    date.mockReturnValue(start + 2 * day);
    const reissued = resultSchema(reissueInvitationRoute.output).parse(
      (await f.request(`/invitations/${fresh.id}/reissue`, f.admin, "repeat")).body);
    if (!reissued.ok) throw new Error(reissued.error.code);
    expect((await withdraw(reissued.data.id, "withdraw-repeat")).status).toBe(200);
    date.mockReturnValue(start + 3 * day);
    const retryAt = fresh.issuedAt + INVITATION_POLICY.reissueWindowMs;
    expect(await issue("next")).toMatchObject({ status: 429, body: { error: { code: "RATE_LIMITED", retryAt } } });
    expect(f.wakes).toHaveLength(3);
    expect(await f.issue("another@example.test", "another")).toMatchObject({ issuedAt: start + 3 * day });
    date.mockReturnValue(retryAt);
    expect(await f.issue(email, "next")).toMatchObject({ issuedAt: retryAt });
    expect(f.wakes).toHaveLength(5);
  } finally { f.db.close(); date.mockRestore(); }
});

test("foreman reads only crew eligibility and a cold scoped link can offer that live context", async () => {
  const date = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    const foreman = await f.account("foreman");
    await f.db.batch([
      f.db.prepare("INSERT INTO memberships VALUES ('foreman-member', 'business', 'foreman', 'active')"),
      f.db.prepare("INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at) VALUES ('foreman-role', 'foreman-member', 'business', 'foreman', 'foreman', 1)"),
      f.db.prepare("INSERT INTO account_contexts VALUES ('foreman-context', 'foreman', 'foreman', 'business', 'foreman-role')"),
      f.db.prepare("INSERT INTO link_targets VALUES ('crew-eligibility', 'business_eligibility', 'business', 'foreman-context', ?)" ).bind(start + 60_000),
      f.db.prepare(`INSERT INTO eligibility_checks (id, business_id, membership_id, trade, work_language, scope, state, checked_by, checked_at, valid_until)
        VALUES ('check', 'business', 'foreman-member', 'carpentry', 'en', 'internal-proof', 'approved', 'admin', 1, ?)` ).bind(start + 60_000),
    ]);
    const link = await f.request("/links/crew-eligibility", foreman);
    expect(link.body).toMatchObject({ data: { kind: "switch_context", targetKind: "business", choices: [{ scope: { contextId: "foreman-context" } }] } });
    expect((await f.request("/links/crew-eligibility", f.admin)).body).toMatchObject({ data: { kind: "unavailable", reason: "unavailable" } });
    await f.db.prepare("UPDATE sessions SET active_context_id = 'foreman-context' WHERE id = 'foreman-session'").run();
    const eligibility = await f.request("/businesses/business/eligibility", foreman);
    expect(resultSchema(getBusinessEligibilityRoute.output).parse(eligibility.body)).toMatchObject({
      data: { audience: "foreman", members: [{ status: "expiring", trade: "carpentry", workLanguage: "en" }] },
    });
    expect((await f.request("/links/crew-eligibility", foreman)).body).toMatchObject({ data: { kind: "business_eligibility", eligibility: { audience: "foreman" } } });
    const people = await f.request("/businesses/business/people", foreman);
    expect(resultSchema(getBusinessPeopleRoute.output).parse(people.body)).toMatchObject({ data: { audience: "foreman", members: [{ id: "foreman-member" }] } });
    expect(JSON.stringify([eligibility.body, people.body])).not.toMatch(/checkedBy|internal-proof|example\.test|admin-member/);
    expect((await f.request("/businesses/business/people?view=invited", foreman)).body).toMatchObject({ error: missing });
    expect((await f.request("/businesses/other-business/people", foreman)).body).toMatchObject({ error: missing });
  } finally { f.db.close(); date.mockRestore(); }
});

test("future staff authority is absent from roster reads, the bootstrap, and context switching until effective", async () => {
  const date = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    await f.db.batch([
      f.db.prepare("UPDATE membership_roles SET granted_at = ? WHERE id = 'admin-role'").bind(start + 1),
      f.db.prepare("INSERT INTO account_preferences (account_id) VALUES ('admin')"),
    ]);
    const roster = () => f.request("/businesses/business/people", f.admin);
    expect(await roster()).toMatchObject({ status: 404, body: { error: missing } });
    expect((await f.request("/session", f.admin)).body).toMatchObject({
      data: { activeContext: null, contexts: [{ contextId: "admin-customer" }] },
    });
    await f.db.prepare("UPDATE sessions SET active_context_id = 'admin-customer' WHERE id = 'admin-session'").run();
    const select = () => f.request("/session/context", f.admin, "select-admin", { contextId: "admin-business" });
    expect(await select()).toMatchObject({ status: 404, body: { error: missing } });
    expect(await f.db.prepare("SELECT active_context_id FROM sessions WHERE id = 'admin-session'").first("active_context_id")).toBe("admin-customer");

    date.mockReturnValue(start + 1);
    expect(await select()).toMatchObject({ status: 200, body: { data: { activeContext: { contextId: "admin-business" } } } });
    expect((await roster()).body).toMatchObject({ data: { audience: "provider_admin", members: [{ email: "admin@example.test" }] } });
  } finally { f.db.close(); date.mockRestore(); }
});

test("verified place recipient gains a view grant without inheriting history or approval", async () => {
  const date = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    await f.db.batch([
      f.db.prepare(`INSERT INTO places(id, owner_id, alias, normalized_address, state)
        VALUES ('place', 'admin', 'Private house', 'Fixture address', 'pending_verification')`),
      f.db.prepare("INSERT INTO place_people(place_id, account_id, verified_from, history_from) VALUES ('place', 'admin', 1, 1)"),
      f.db.prepare(`UPDATE places SET named_approver_id = 'admin', state = 'in_area', area_id = 'area', site_zone = 'Europe/Lisbon',
        pin = '{"latitude":0,"longitude":0}' WHERE id = 'place'`),
      f.db.prepare(`INSERT INTO place_grants(id, place_id, account_id, capability, issuer_id, valid_from)
        VALUES ('owner-approve', 'place', 'admin', 'approve', 'admin', 1)`),
    ]);
    const viewer = await f.account("viewer");
    const recipient = await mailboxKey(f.key, "viewer@example.test");
    const sealed = await sealInviteEmail((await loadDeliveryKey(deliverySecret))!, recipient, "viewer@example.test");
    await f.db.prepare(`INSERT INTO invitations(id, token_hash, recipient_key, recipient_email_ciphertext, place_id, inviter_id,
      address_revision, grant_snapshot, issued_at, expires_at, pending_slot, state)
      VALUES ('place-invite','hash',?,?,'place','admin',0,'{"kind":"place_view"}',?,?,1,'pending')`)
      .bind(recipient, sealed, start, start + INVITATION_POLICY.validityMs).run();
    const response = await f.request("/invitations/place-invite/accept", viewer, "view-accept");
    expect(resultSchema(acceptInvitationRoute.output).parse(response.body)).toMatchObject({ data: { currentAccess: {
      kind: "place", placeId: "place", capabilities: ["view"], isOwner: false, historyFrom: start,
    } } });
    expect(await f.db.prepare("SELECT named_approver_id FROM places WHERE id = 'place'").first("named_approver_id")).toBe("admin");
  } finally { f.db.close(); date.mockRestore(); }
});

test("member role edits require the live admin capability and preserve the last admin", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    const path = "/businesses/business/members/admin-member/roles";
    const patch = (credential: string, operation: string) => f.request(path, credential, operation, { roles: [] }, "PATCH");
    expect(await patch(f.outsider, "customer-denied")).toMatchObject({ status: 404, body: { error: missing } });
    expect((await patch(f.admin, "last-admin-denied")).status).toBe(409);
    expect(await f.db.prepare("SELECT revoked_at FROM membership_roles WHERE id = 'admin-role'").first("revoked_at")).toBeNull();
    await f.db.prepare("UPDATE business_grants SET valid_until = ? WHERE id = 'admin-capability'").bind(start).run();
    expect(await patch(f.admin, "expired-admin-denied")).toMatchObject({ status: 404, body: { error: missing } });
    expect(await f.db.prepare("SELECT count(*) AS n FROM operation_receipts").first("n")).toBe(0);
  } finally { f.db.close(); clock.mockRestore(); }
});

test("verified foreman edits apply role and backup changes in one batch without dropping an accountable foreman", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    await f.account("crew");
    await f.account("ops");
    await f.db.batch([
      f.db.prepare("INSERT INTO memberships VALUES ('crew-member', 'business', 'crew', 'active')"),
      f.db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at)
        VALUES ('crew-role', 'crew-member', 'business', 'crew', 'worker', 1)`),
      f.db.prepare("INSERT INTO account_contexts VALUES ('crew-worker', 'crew', 'worker', 'business', 'crew-role')"),
      f.db.prepare("INSERT INTO sync_scope_state VALUES ('crew-worker', 4)"),
      f.db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state)
        VALUES ('place', 'outsider', 'Place', 'Fixture address', 'pending_verification')`),
      f.db.prepare("INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES ('place', 'outsider', 1, 1)"),
    ]);
    const path = "/businesses/business/members/crew-member/roles";
    const patch = (op: string, payload: unknown) => f.request(path, f.admin, op, payload, "PATCH");
    const promote = { roles: ["foreman", "worker"], backupForeman: true };
    expect((await patch("unverified", promote)).status).toBe(409);
    expect((await patch("new-admin-denied", { roles: ["provider_admin", "worker"] })).status).toBe(409);
    await f.db.prepare(`INSERT INTO authority_verifications (id, business_id, subject_account_id, kind, verified_by, verified_at)
      VALUES ('foreman-proof', 'business', 'crew', 'membership', 'ops', 1)`).run();
    const promoted = resultSchema(patchBusinessMemberRolesRoute.output).parse((await patch("promote", promote)).body);
    expect(promoted).toMatchObject({ data: { member: { backupForeman: true, roles: [{ role: "foreman" }, { role: "worker", grantId: "crew-role" }] } } });
    if (!promoted.ok) throw new Error(promoted.error.code);
    expect((await patch("promote", { ...promote, roles: ["worker", "foreman"] })).body).toMatchObject({ data: promoted.data });
    const epoch = (role: string) => f.db.prepare(`SELECT visibility_epoch FROM sync_scope_state s JOIN account_contexts c ON c.id = s.context_id
      WHERE c.account_id = 'crew' AND c.business_id = 'business' AND c.role = ?`).bind(role).first("visibility_epoch");
    expect([await epoch("worker"), await epoch("foreman")]).toEqual([4, 1]);
    const backupOff = resultSchema(patchBusinessMemberRolesRoute.output).parse((await patch("backup-off", { backupForeman: false })).body);
    expect(backupOff).toMatchObject({ data: { member: { backupForeman: false, roles: [{ role: "foreman" }, { role: "worker" }] } } });
    expect([await epoch("worker"), await epoch("foreman")]).toEqual([4, 2]);
    expect((await patch("backup-on", { backupForeman: true })).status).toBe(200);
    await f.db.prepare(`INSERT INTO jobs (id, reference, business_id, place_id, requester_id, accountable_foreman_membership_id, origin, state)
      VALUES ('open-job', 'BB-100', 'business', 'place', 'outsider', 'crew-member', 'bookbuddy', 'open')`).run();
    expect((await patch("job-denied", { roles: ["worker"] })).status).toBe(409);
    expect([await epoch("worker"), await epoch("foreman")]).toEqual([4, 3]);
    await f.db.prepare("UPDATE jobs SET state = 'closed' WHERE id = 'open-job'").run();
    expect(resultSchema(patchBusinessMemberRolesRoute.output).parse((await patch("drop-foreman", { roles: ["worker"] })).body))
      .toMatchObject({ data: { member: { backupForeman: false, roles: [{ role: "worker", grantId: "crew-role" }] } } });
    expect([await epoch("worker"), await epoch("foreman")]).toEqual([4, 4]);
    expect(await f.db.prepare("SELECT count(*) AS n FROM operation_receipts WHERE operation_id IN ('unverified', 'new-admin-denied', 'job-denied')")
      .first("n")).toBe(0);
  } finally { f.db.close(); clock.mockRestore(); }
});

test.each(["single", "bulk"] as const)("%s foreman removal retires backup authority before the context can be reused", async (mode) => {
  const clock = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    await f.account("crew");
    await f.db.batch([
      f.db.prepare("INSERT INTO memberships VALUES ('crew-member', 'business', 'crew', 'active')"),
      f.db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at) VALUES
        ('worker-role', 'crew-member', 'business', 'crew', 'worker', 1),
        ('foreman-role', 'crew-member', 'business', 'crew', 'foreman', 1)`),
      f.db.prepare(`INSERT INTO account_contexts VALUES
        ('crew-worker', 'crew', 'worker', 'business', 'worker-role'),
        ('crew-foreman', 'crew', 'foreman', 'business', 'foreman-role')`),
      f.db.prepare(`INSERT INTO business_grants (id, business_id, membership_id, capability, issuer_id, valid_from)
        VALUES ('backup-capability', 'business', 'crew-member', 'backup_foreman', 'admin', 1)`),
      f.db.prepare(`INSERT INTO authority_verifications (id, business_id, subject_account_id, kind, verified_by, verified_at)
        VALUES ('foreman-proof', 'business', 'crew', 'membership', 'outsider', 1)`),
      f.db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state)
        VALUES ('place', 'outsider', 'Place', 'Fixture address', 'pending_verification')`),
      f.db.prepare("INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES ('place', 'outsider', 1, 1)"),
      f.db.prepare(`INSERT INTO jobs (id, reference, business_id, place_id, requester_id, origin, state)
        VALUES ('job', 'BB-100', 'business', 'place', 'outsider', 'bookbuddy', 'open')`),
      f.db.prepare(`INSERT INTO job_grants (job_id, context_id, capability, valid_from, valid_until)
        VALUES ('job', 'crew-foreman', 'backup', 1, ?)`).bind(start + 60_000),
    ]);
    const edit = (op: string, roles: string[]) => f.request("/businesses/business/members/crew-member/roles", f.admin, op, { roles }, "PATCH");
    const removed = mode === "bulk" ? await edit("drop", ["worker"])
      : await f.request("/members/crew-member/revoke", f.admin, "drop", { roleGrantId: "foreman-role" });
    expect(removed).toMatchObject({ status: 200, body: { data: { member: { backupForeman: false, roles: [{ role: "worker" }] } } } });
    expect(await f.db.prepare("SELECT revoked_at FROM business_grants WHERE id = 'backup-capability'").first("revoked_at")).toBe(start);
    expect(await f.db.prepare("SELECT revoked_at FROM job_grants WHERE job_id = 'job' AND context_id = 'crew-foreman'")
      .first("revoked_at")).toBe(start);

    clock.mockReturnValue(start + 1);
    expect(await edit("restore-role", ["worker", "foreman"])).toMatchObject({
      status: 200, body: { data: { member: { backupForeman: false, roles: [{ role: "foreman" }, { role: "worker" }] } } },
    });
    expect(await f.db.prepare("SELECT id FROM account_contexts WHERE account_id = 'crew' AND role = 'foreman'").first("id")).toBe("crew-foreman");
  } finally { f.db.close(); clock.mockRestore(); }
});
