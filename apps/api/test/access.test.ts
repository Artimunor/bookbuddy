import { expect, test } from "bun:test";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { invitationExpiresAt } from "@bookbuddy/domain";
import { createTestD1 } from "./d1";

const migrations = ["0001_identity.sql", "0002_access.sql"] as const;

// Later migrations do not change the input snapshot of this constraint test.
async function accessDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "bookbuddy-access-"));
  try {
    await Promise.all(migrations.map((name) => copyFile(new URL(`../migrations/${name}`, import.meta.url), join(dir, name))));
    return await createTestD1(pathToFileURL(`${dir}/`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("enforces unique contexts, same-scope grants, one current approver and place invite caps", async () => {
  const DB = await accessDatabase();
  try {
    const context = DB.prepare("INSERT INTO account_contexts (id, account_id, role, business_id, role_grant_id) VALUES (?, ?, ?, ?, ?)");
    await DB.batch([
      DB.prepare(`INSERT INTO accounts (id, email_normalized, verified_at, state) VALUES
        ('owner', 'owner@example.test', 1, 'active'), ('successor', 'successor@example.test', 1, 'active')`),
      DB.prepare(`INSERT INTO operating_areas (id, name, site_zone, polygon)
        VALUES ('area', 'Fixture', 'Etc/UTC', '[[[0,0],[1,0],[0,1],[0,0]]]')`),
      DB.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state) VALUES
        ('one', 'One', 'One', 'work@example.test', 'area', 'approved'),
        ('two', 'Two', 'Two', 'work@example.test', 'area', 'approved')`),
      DB.prepare("INSERT INTO memberships (id, business_id, account_id, state) VALUES ('member', 'one', 'owner', 'active')"),
      DB.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at)
        VALUES ('grant', 'member', 'one', 'owner', 'foreman', 1)`),
      context.bind("customer", "owner", "customer", null, null),
      context.bind("staff", "owner", "foreman", "one", "grant"),
    ]);
    await expect(context.bind("duplicate-customer", "owner", "customer", null, null).run())
      .rejects.toThrow(/unique constraint failed: account_contexts\.account_id/i);
    await expect(context.bind("duplicate-staff", "owner", "foreman", "one", "grant").run())
      .rejects.toThrow(/unique constraint failed: account_contexts\.account_id, account_contexts\.role, account_contexts\.business_id/i);
    await expect(context.bind("cross-business", "owner", "foreman", "two", "grant").run())
      .rejects.toThrow(/foreign key/i);
    await expect(DB.prepare(`INSERT INTO sessions (id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
      VALUES ('session', 'successor', 'hash', 'customer', 'device', 1, 2)`).run()).rejects.toThrow(/foreign key/i);

    const setApprover = DB.prepare(`UPDATE places SET named_approver_id = ?, state = 'in_area', area_id = 'area',
      site_zone = 'Etc/UTC', pin = '{"latitude":0,"longitude":0}' WHERE id = 'place'`);
    const approveGrant = DB.prepare(`INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, valid_from)
      VALUES (?, 'place', ?, 'approve', 'owner', ?)`);
    await DB.batch([
      DB.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state)
        VALUES ('place', 'owner', 'Fixture', 'Synthetic Address', 'pending_verification')`),
      DB.prepare(`INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES
        ('place', 'owner', 1, 1), ('place', 'successor', 1, 1)`),
      setApprover.bind("owner"),
      approveGrant.bind("approve-owner", "owner", 1),
    ]);
    await expect(setApprover.bind(null).run()).rejects.toThrow(/places_verified/i);
    await expect(DB.prepare("UPDATE place_people SET ends_at = 2 WHERE account_id = 'owner'").run()).rejects.toThrow(/foreign key/i);
    await expect(approveGrant.bind("approve-other", "successor", 2).run()).rejects.toThrow(/unique constraint failed: place_grants\.place_id/i);
    await DB.batch([
      DB.prepare("UPDATE place_grants SET revoked_at = 2 WHERE id = 'approve-owner'"),
      setApprover.bind("successor"),
      approveGrant.bind("approve-other", "successor", 2),
    ]);
    expect(await DB.prepare("SELECT named_approver_id FROM places WHERE id = 'place'").first("named_approver_id")).toBe("successor");

    const issuedAt = 3;
    const expiresAt = invitationExpiresAt(issuedAt);
    const invite = DB.prepare(`INSERT INTO invitations (id, token_hash, recipient_key, recipient_email_ciphertext, place_id,
      address_revision, inviter_id, grant_snapshot, issued_at, expires_at, pending_slot, state)
      VALUES (?, ?, ?, 'ciphertext', 'place', 0, 'owner', '{"kind":"place_view"}', ?, ?, ?, 'pending')`);
    const intoSlot = (id: string, recipientKey: string, slot: number) => invite.bind(id, `${id}-hash`, recipientKey, issuedAt, expiresAt, slot);
    await intoSlot("invite-1", "recipient-1", 1).run();
    await expect(intoSlot("duplicate-recipient", "recipient-1", 2).run())
      .rejects.toThrow(/unique constraint failed: invitations\.place_id, invitations\.recipient_key/i);
    await DB.batch([2, 3, 4, 5].map((slot) => intoSlot(`invite-${slot}`, `recipient-${slot}`, slot)));
    await expect(intoSlot("sixth", "recipient-6", 6).run()).rejects.toThrow(/invitations_slot/i);
    await expect(intoSlot("taken-slot", "recipient-6", 5).run())
      .rejects.toThrow(/unique constraint failed: invitations\.place_id, invitations\.pending_slot/i);

    const move = DB.prepare("UPDATE places SET normalized_address = 'New address', address_revision = 1 WHERE id = 'place'");
    await expect(DB.prepare("UPDATE places SET normalized_address = 'New address' WHERE id = 'place'").run())
      .rejects.toThrow(/next address revision/i);
    await expect(move.run()).rejects.toThrow(/foreign key/i);
    await DB.batch([
      DB.prepare(`INSERT INTO authority_verifications (id, place_id, address_revision, subject_account_id, kind, verified_by, verified_at)
        VALUES ('old-proof', 'place', 0, 'successor', 'place_approver', 'owner', 2)`),
      DB.prepare("UPDATE place_grants SET revoked_at = 3 WHERE id = 'approve-other'"),
      move,
    ]);
    await expect(approveGrant.bind("wrong-revision", "successor", 3).run()).rejects.toThrow(/foreign key/i);
    await expect(DB.prepare(`INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, valid_from, address_revision, approval_verification_id)
      VALUES ('wrong-proof', 'place', 'successor', 'approve', 'owner', 3, 1, 'old-proof')`).run()).rejects.toThrow(/foreign key/i);
  } finally {
    DB.close();
  }
});

test("authorization deadlines reject noninteger storage classes and still allow intended null terms", async () => {
  const db = await accessDatabase();
  try {
    await db.batch([
      db.prepare("INSERT INTO accounts (id, email_normalized, verified_at, state) VALUES ('owner', 'owner@example.test', 1, 'active')"),
      db.prepare("INSERT INTO operating_areas VALUES ('area', 'Area', 'Etc/UTC', '[0]')"),
      db.prepare("INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state) VALUES ('biz', 'Biz', 'Biz', 'work@example.test', 'area', 'approved')"),
      db.prepare("INSERT INTO memberships VALUES ('member', 'biz', 'owner', 'active')"),
      db.prepare("INSERT INTO sessions (id, account_id, secret_hash, device_id, issued_at, expires_at) VALUES ('session', 'owner', 'hash', 'device', 1, 3)"),
      db.prepare("INSERT INTO places (id, owner_id, alias, normalized_address, state) VALUES ('place', 'owner', 'Home', 'Address', 'pending_verification')"),
      db.prepare("INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES ('place', 'owner', 1, 1)"),
      db.prepare("INSERT INTO business_grants (id, business_id, membership_id, capability, issuer_id, valid_from) VALUES ('biz-grant', 'biz', 'member', 'membership_admin', 'owner', 1)"),
      db.prepare("INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, valid_from) VALUES ('place-grant', 'place', 'owner', 'view', 'owner', 1)"),
      db.prepare("INSERT INTO eligibility_checks (id, business_id, trade, work_language, scope, state, checked_by, checked_at, review_by) VALUES ('check', 'biz', 'carpentry', 'en', 'fixture', 'approved', 'owner', 1, 3)"),
      db.prepare("INSERT INTO otp_lockouts (bucket_kind, bucket_key, until) VALUES ('email', 'key', 3)"),
    ]);
    for (const [update, constraint] of [
      ["UPDATE sessions SET expires_at = ? WHERE id = 'session'", "sessions_term"],
      ["UPDATE business_grants SET valid_until = ? WHERE id = 'biz-grant'", "business_grants_term"],
      ["UPDATE place_grants SET valid_until = ? WHERE id = 'place-grant'", "place_grants_term"],
      ["UPDATE eligibility_checks SET valid_until = ? WHERE id = 'check'", "eligibility_checks_review"],
      ["UPDATE eligibility_checks SET review_by = ? WHERE id = 'check'", "eligibility_checks_review"],
      ["UPDATE otp_lockouts SET until = ? WHERE bucket_key = 'key'", "otp_lockouts_until"],
    ] as const) {
      const statement = db.prepare(update);
      for (const invalid of ["unspecified", 2.5]) await expect(statement.bind(invalid).run()).rejects.toThrow(constraint);
      await statement.bind(3).run();
    }
  } finally { db.close(); }
});
