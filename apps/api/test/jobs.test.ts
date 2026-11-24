import { expect, test } from "bun:test";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { requestReceiptSchema, submitRequestPayloadSchema } from "@bookbuddy/api-contract";
import { createTestD1 } from "./d1";

const migrations = ["0001_identity.sql", "0002_access.sql", "0003_transport.sql", "0004_jobs.sql"] as const;

async function jobsDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "bookbuddy-jobs-"));
  try {
    await Promise.all(migrations.map((name) => copyFile(new URL(`../migrations/${name}`, import.meta.url), join(dir, name))));
    const db = await createTestD1(pathToFileURL(`${dir}/`));
    try {
      await db.batch([
        db.prepare(`INSERT INTO accounts (id, email_normalized, verified_at, state) VALUES
          ('owner', 'owner@example.test', 1, 'active'), ('first', 'first@example.test', 1, 'active'),
          ('second', 'second@example.test', 1, 'active'), ('third', 'third@example.test', 1, 'active')`),
        db.prepare(`INSERT INTO operating_areas (id, name, site_zone, polygon)
          VALUES ('area', 'Fixture', 'Etc/UTC', '[[[0,0],[1,0],[0,1],[0,0]]]')`),
        db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state) VALUES
          ('local', 'Local', 'Local', 'local@example.test', 'area', 'approved'),
          ('outside', 'Outside', 'Outside', 'outside@example.test', 'area', 'approved')`),
        db.prepare(`INSERT INTO memberships (id, business_id, account_id, state) VALUES
          ('incumbent', 'local', 'first', 'active'), ('alternate', 'local', 'second', 'active'),
          ('backup', 'local', 'third', 'active'), ('outside-member', 'outside', 'third', 'active')`),
        db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state)
          VALUES ('place', 'owner', 'Fixture', 'Synthetic Address', 'pending_verification')`),
        db.prepare(`INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES ('place', 'owner', 1, 1)`),
        db.prepare(`UPDATE places SET state = 'in_area', named_approver_id = 'owner', area_id = 'area', site_zone = 'Etc/UTC',
          pin = '{"latitude":0,"longitude":0}' WHERE id = 'place'`),
        db.prepare(`INSERT INTO jobs (id, reference, business_id, place_id, requester_id, accountable_foreman_membership_id, origin, state)
          VALUES ('job', 'BB-1', 'local', 'place', 'owner', 'incumbent', 'bookbuddy', 'open')`),
      ]);
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("one pending handoff per job, timely acceptance, one reoffer and same-business recipient", async () => {
  const db = await jobsDatabase();
  try {
    const offer = db.prepare(`INSERT INTO job_handoffs (id, job_id, business_id, incumbent_id, recipient_id, issuer_id,
      reoffer_of_id, policy, offered_at, expires_at, state) VALUES (?, 'job', 'local', 'incumbent', ?, 'first', ?, 'standard', ?, ?, 'offered')`);
    await expect(offer.bind("outside", "outside-member", null, 100, 200).run()).rejects.toThrow(/foreign key/i);
    await offer.bind("first", "alternate", null, 100, 200).run();
    await expect(offer.bind("duplicate", "backup", null, 100, 200).run()).rejects.toThrow(/unique constraint failed: job_handoffs\.job_id/i);
    await expect(db.prepare("UPDATE job_handoffs SET state = 'accepted', ended_at = 200 WHERE id = 'first'").run())
      .rejects.toThrow(/job_handoffs_resolution/i);
    await db.prepare("UPDATE job_handoffs SET state = 'expired', ended_at = 200 WHERE id = 'first'").run();
    await offer.bind("retry", "backup", "first", 201, 300).run();
    await db.prepare("UPDATE job_handoffs SET state = 'declined', ended_at = 250 WHERE id = 'retry'").run();
    await expect(offer.bind("second-retry", "backup", "first", 251, 400).run())
      .rejects.toThrow(/unique constraint failed: job_handoffs\.reoffer_of_id/i);
    await expect(offer.bind("chained-retry", "alternate", "retry", 251, 400).run()).rejects.toThrow(/foreign key/i);
    expect(await db.prepare("SELECT accountable_foreman_membership_id FROM jobs WHERE id = 'job'")
      .first("accountable_foreman_membership_id")).toBe("incumbent");
  } finally {
    db.close();
  }
});

test("requests reject blank supplied text and undeclared safe arrival details", async () => {
  const db = await jobsDatabase();
  try {
    const submit = db.prepare(`INSERT INTO requests (job_id, original_text, arrival_arrangement, arrival_contact_name, safe_note, submitted_at)
      VALUES ('job', ?, ?, ?, ?, 50)`);
    await expect(submit.bind(" \n\t", "requester", null, null).run()).rejects.toThrow(/requests_text/i);
    await expect(submit.bind("Door sticks", "nobody", null, null).run()).rejects.toThrow(/requests_arrival/i);
    await expect(submit.bind("Door sticks", "someone_else", null, null).run()).rejects.toThrow(/requests_arrival/i);
    await submit.bind("  Door sticks  ", "someone_else", "Site contact", null).run();
    expect(await db.prepare("SELECT original_text FROM requests WHERE job_id = 'job'").first("original_text")).toBe("  Door sticks  ");
  } finally {
    db.close();
  }
});

test("request input bounds attachment IDs and a sent receipt is not a booking", () => {
  const request = { placeId: "place", arrivalArrangement: "to_be_arranged" };
  expect(submitRequestPayloadSchema.safeParse(request).success).toBe(false);
  expect(submitRequestPayloadSchema.safeParse({ ...request, originalText: "\n\t" }).success).toBe(false);
  // The wire cannot tell a photo from a voice note; the guarded command checks MIME and readiness.
  expect(submitRequestPayloadSchema.safeParse({ ...request, originalText: "", attachmentIds: ["attachment"] }).success).toBe(true);
  expect(submitRequestPayloadSchema.safeParse({ ...request, originalText: "Door sticks", attachmentIds: ["photo", "photo"] }).success).toBe(false);
  const ids = Array.from({ length: 11 }, (_, i) => `photo-${i}`);
  expect(submitRequestPayloadSchema.safeParse({ ...request, attachmentIds: ids.slice(0, 10) }).success).toBe(true);
  expect(submitRequestPayloadSchema.safeParse({ ...request, attachmentIds: ids }).success).toBe(false);
  const receipt = { jobId: "job", reference: "BB-1", siteZone: "Etc/UTC", submittedAt: 50 };
  expect(requestReceiptSchema.safeParse({ ...receipt, journey: { step: "requested", cancelled: false, complete: false } }).success).toBe(true);
  expect(requestReceiptSchema.safeParse({ ...receipt, journey: { step: "booked", cancelled: false, complete: false } }).success).toBe(false);
});
