import { expect, test } from "bun:test";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { acceptCoverRoute, getCoverRoute, issueCoverRoute, safeConflictSchema } from "@bookbuddy/api-contract";
import { createTestD1 } from "./d1";

const migrations = ["0001_identity.sql", "0002_access.sql", "0003_transport.sql", "0004_jobs.sql", "0005_commercial.sql", "0006_schedule.sql", "0007_staffing.sql"];

async function staffingDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "bookbuddy-staffing-"));
  try {
    await Promise.all(migrations.map((name) => copyFile(new URL(`../migrations/${name}`, import.meta.url), join(dir, name))));
    const db = await createTestD1(pathToFileURL(`${dir}/`));
    try {
      await db.batch([
        db.prepare(`INSERT INTO accounts (id, email_normalized, verified_at, state) VALUES
          ('owner', 'owner@example.test', 1, 'active'), ('foreman', 'foreman@example.test', 1, 'active'),
          ('prior', 'prior@example.test', 1, 'active'), ('first', 'first@example.test', 1, 'active'), ('second', 'second@example.test', 1, 'active')`),
        db.prepare(`INSERT INTO operating_areas (id, name, site_zone, polygon)
          VALUES ('area', 'Fixture', 'Etc/UTC', '[[[0,0],[1,0],[0,1],[0,0]]]')`),
        db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
          VALUES ('business', 'Fixture', 'Fixture', 'work@example.test', 'area', 'approved')`),
        db.prepare(`INSERT INTO memberships (id, business_id, account_id, state) VALUES
          ('prior-member', 'business', 'prior', 'active'), ('first-member', 'business', 'first', 'active'),
          ('second-member', 'business', 'second', 'active')`),
        db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state)
          VALUES ('place', 'owner', 'Fixture', 'Synthetic Address', 'pending_verification')`),
        db.prepare(`INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES ('place', 'owner', 1, 1)`),
        db.prepare(`INSERT INTO jobs (id, reference, business_id, place_id, requester_id, origin, state)
          VALUES ('job', 'BB-7', 'business', 'place', 'owner', 'bookbuddy', 'open')`),
        db.prepare(`INSERT INTO visits (id, job_id, kind, state) VALUES ('visit', 'job', 'work', 'booked')`),
        db.prepare(`INSERT INTO shifts (id, visit_id, starts_at, ends_at, skill, briefing_language, state)
          VALUES ('shift', 'visit', 1200000, 1800000, 'door_fitting', 'es', 'planned')`),
        db.prepare(`INSERT INTO shift_slots (id, shift_id, number) VALUES ('slot', 'shift', 1)`),
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

const confirmAssignment = `INSERT INTO assignments (id, slot_id, worker_membership_id, cover_gap_id, source,
  state, confirmed_by, confirmed_at, starts_at, ends_at)
  VALUES (?, 'slot', ?, ?, ?, 'confirmed', 'foreman', ?, 1200000, 1800000)`;

test("one live assignment and one live ordinary offer per slot; prior assignments remain history", async () => {
  const db = await staffingDatabase();
  try {
    const issue = db.prepare(`INSERT INTO assignment_offers (id, slot_id, recipient_id, issued_by, issued_at, expires_at, state)
      VALUES (?, 'slot', ?, 'foreman', 100, 1000000, 'offered')`);
    await issue.bind("offer-a", "first-member").run();
    await expect(issue.bind("offer-b", "second-member").run()).rejects.toThrow(/unique constraint failed: assignment_offers\.slot_id/i);
    await db.prepare(`UPDATE assignment_offers SET state = 'withdrawn', resolved_at = 200 WHERE id = 'offer-a'`).run();
    await issue.bind("offer-b", "second-member").run();

    const confirm = db.prepare(confirmAssignment);
    await confirm.bind("ordinary-a", "first-member", null, "ordinary", 300).run();
    await expect(confirm.bind("ordinary-b", "second-member", null, "ordinary", 400).run())
      .rejects.toThrow(/unique constraint failed: assignments\.slot_id/i);
    await db.prepare(`UPDATE assignments SET state = 'released' WHERE id = 'ordinary-a'`).run();
    await confirm.bind("ordinary-b", "second-member", null, "ordinary", 400).run();
    expect(await db.prepare(`SELECT count(*) AS history FROM assignments WHERE slot_id = 'slot'`).first("history")).toBe(2);
  } finally {
    db.close();
  }
});

test("staffing cannot link a foreign worker or confirm an ordinary offer for a different recipient", async () => {
  const db = await staffingDatabase();
  try {
    await db.batch([
      db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
        VALUES ('other', 'Other', 'Other', 'other@example.test', 'area', 'approved')`),
      db.prepare("INSERT INTO memberships VALUES ('foreign-member', 'other', 'first', 'active')"),
      db.prepare("INSERT INTO jobs (id, reference, business_id, place_id, requester_id, origin, state) VALUES ('other-job', 'BB-8', 'other', 'place', 'owner', 'bookbuddy', 'open')"),
      db.prepare(confirmAssignment).bind("ordinary", "first-member", null, "ordinary", 100),
    ]);
    await expect(db.prepare(confirmAssignment).bind("foreign", "foreign-member", null, "ordinary", 100).run())
      .rejects.toThrow(/assignment worker must belong to the slot business/);
    const issue = db.prepare(`INSERT INTO assignment_offers (id, slot_id, recipient_id, issued_by, issued_at, expires_at, state)
      VALUES ('ordinary-offer', 'slot', ?, 'foreman', 100, 1000000, 'offered')`);
    await expect(issue.bind("foreign-member").run()).rejects.toThrow(/ordinary offer recipient must belong to the slot business/);
    await issue.bind("second-member").run();
    await expect(db.prepare(`UPDATE assignment_offers SET state = 'confirmed', resolved_at = 200, assignment_id = 'ordinary'
      WHERE id = 'ordinary-offer'`).run()).rejects.toThrow(/foreign key constraint failed/i);
    await expect(db.prepare("UPDATE assignments SET worker_membership_id = 'foreign-member' WHERE id = 'ordinary'").run())
      .rejects.toThrow(/assignment identity is immutable/);
    await expect(db.prepare("UPDATE memberships SET business_id = 'other' WHERE id = 'second-member'").run())
      .rejects.toThrow(/membership identity is immutable/);
    await expect(db.prepare("UPDATE jobs SET business_id = 'other' WHERE id = 'job'").run())
      .rejects.toThrow(/job business is immutable/);
    await expect(db.prepare("INSERT OR REPLACE INTO visits (id, job_id, kind, state) VALUES ('visit', 'other-job', 'work', 'booked')").run())
      .rejects.toThrow(/visit job is immutable/);
  } finally {
    db.close();
  }
});

test("cover CAS has one immutable winner per round, even when a fresh epoch reuses its dispatch", async () => {
  const db = await staffingDatabase();
  try {
    await db.batch([
      db.prepare(confirmAssignment).bind("prior-assignment", "prior-member", null, "ordinary", 100),
      db.prepare(`UPDATE assignments SET state = 'dropped', dropped_at = 100000,
        dropout_reported_by = 'prior', dropout_source = 'self' WHERE id = 'prior-assignment'`),
      db.prepare(`INSERT INTO cover_gaps (id, slot_id, prior_assignment_id, safe_cutoff, state)
        VALUES ('gap', 'slot', 'prior-assignment', 1000000, 'open')`),
      db.prepare(`INSERT INTO cover_dispatches (gap_id, dispatch_no, issued_by, issued_at, reply_until, state)
        VALUES ('gap', 1, 'foreman', 120000, 700000, 'open')`),
      db.prepare(`INSERT INTO cover_offers (id, gap_id, dispatch_no, recipient_id, expires_at, state) VALUES
        ('offer-a', 'gap', 1, 'first-member', 700000, 'offered'), ('offer-b', 'gap', 1, 'second-member', 700000, 'offered')`),
      db.prepare(`INSERT INTO cover_rounds (gap_id, round_no, dispatch_no, state, opened_at)
        VALUES ('gap', 1, 1, 'open', 120000)`),
      db.prepare(`UPDATE cover_gaps SET current_round_no = 1, revision = 1 WHERE id = 'gap'`),
    ]);
    await db.batch([
      db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
        VALUES ('other', 'Other', 'Other', 'other@example.test', 'area', 'approved')`),
      db.prepare("INSERT INTO memberships VALUES ('foreign-member', 'other', 'second', 'active')"),
    ]);
    await expect(db.prepare(`INSERT INTO cover_offers (id, gap_id, dispatch_no, recipient_id, expires_at, state)
      VALUES ('foreign-offer', 'gap', 1, 'foreign-member', 700000, 'offered')`).run())
      .rejects.toThrow(/cover offer recipient must belong to the gap business/);

    const accept = (offerId: string, recipient: string, round: number, revision: number, at: number) => db.batch([
      db.prepare(`UPDATE cover_rounds SET state = 'accepted_pending_confirmation', winner_offer_id = ?1, accepted_at = ?2, confirm_by = ?2 + 300000
        WHERE gap_id = 'gap' AND round_no = ?3 AND state = 'open' AND EXISTS (
          SELECT 1 FROM cover_gaps g
          JOIN cover_dispatches d ON d.gap_id = g.id AND d.dispatch_no = cover_rounds.dispatch_no
          JOIN cover_offers o ON o.gap_id = d.gap_id AND o.dispatch_no = d.dispatch_no AND o.id = ?1
          WHERE g.id = cover_rounds.gap_id AND g.current_round_no = ?3 AND g.revision = ?4 AND g.state = 'open'
            AND d.state = 'open' AND d.reply_until > ?2 AND o.recipient_id = ?5 AND o.state = 'offered' AND o.expires_at > ?2
            AND ?2 + 300000 <= g.safe_cutoff
        )`).bind(offerId, at, round, revision, recipient),
      db.prepare(`UPDATE cover_gaps SET state = 'accepted_pending_confirmation', revision = revision + 1
        WHERE id = 'gap' AND current_round_no = ?1 AND revision = ?2 AND state = 'open' AND EXISTS (
          SELECT 1 FROM cover_rounds WHERE gap_id = 'gap' AND round_no = ?1 AND winner_offer_id = ?3 AND accepted_at = ?4
        )`).bind(round, revision, offerId, at),
    ]);
    const [first, rival] = await Promise.all([
      accept("offer-a", "first-member", 1, 1, 200000),
      accept("offer-b", "second-member", 1, 1, 200001),
    ]);
    expect(first.map(({ meta }) => meta.changes)).toEqual([1, 1]);
    expect(rival.map(({ meta }) => meta.changes)).toEqual([0, 0]);
    await expect(db.prepare(`UPDATE cover_rounds SET winner_offer_id = 'offer-b' WHERE gap_id = 'gap' AND round_no = 1`).run())
      .rejects.toThrow(/cover round winner is immutable/i);

    await db.batch([
      db.prepare(`UPDATE cover_rounds SET state = 'closed', ended_at = 250000 WHERE gap_id = 'gap' AND round_no = 1`),
      db.prepare(`INSERT INTO cover_rounds (gap_id, round_no, dispatch_no, state, opened_at)
        VALUES ('gap', 2, 1, 'open', 250000)`),
      db.prepare(`UPDATE cover_gaps SET state = 'open', current_round_no = 2, revision = 3 WHERE id = 'gap'`),
    ]);
    expect((await accept("offer-b", "second-member", 1, 3, 260000)).map(({ meta }) => meta.changes)).toEqual([0, 0]);
    expect((await accept("offer-b", "second-member", 2, 3, 260000)).map(({ meta }) => meta.changes)).toEqual([1, 1]);
    expect(await db.prepare(`SELECT winner_offer_id FROM cover_rounds WHERE gap_id = 'gap' AND round_no = 1`).first("winner_offer_id"))
      .toBe("offer-a");

    const confirm = db.prepare(confirmAssignment);
    await expect(db.prepare("UPDATE cover_rounds SET state = 'confirmed', ended_at = 270000 WHERE gap_id = 'gap' AND round_no = 2").run())
      .rejects.toThrow(/cover confirmation requires the current accepted offer and assignment/);
    await expect(confirm.bind("wrong-recipient", "first-member", "gap", "cover", 270000).run())
      .rejects.toThrow(/cover assignment worker must match the current accepted offer/);
    await expect(db.prepare("UPDATE cover_offers SET recipient_id = 'foreign-member' WHERE id = 'offer-b'").run())
      .rejects.toThrow(/cover offer identity is immutable/);
    await confirm.bind("replacement", "second-member", "gap", "cover", 270000).run();
    await db.prepare(`UPDATE assignments SET state = 'released' WHERE id = 'replacement'`).run();
    await expect(confirm.bind("second-replacement", "second-member", "gap", "cover", 280000).run())
      .rejects.toThrow(/unique constraint failed: assignments\.cover_gap_id/i);
  } finally {
    db.close();
  }
});

test("cover commands require an epoch and safe worker outcomes cannot name a competing person", () => {
  const request = { params: { g: "gap" }, body: { operationId: "operation", payload: { offerId: "offer-b" } } };
  expect(acceptCoverRoute.input.safeParse({ ...request, body: { ...request.body, expectedRevision: 2 } }).success).toBe(false);
  expect(acceptCoverRoute.input.safeParse({ ...request, body: { ...request.body, expectedRoundNo: 1 } }).success).toBe(false);
  expect(acceptCoverRoute.input.safeParse({ ...request, body: { ...request.body, expectedRevision: 2, expectedRoundNo: 1 } }).success).toBe(true);
  expect(issueCoverRoute.input.safeParse({
    ...request, body: { operationId: "operation", expectedRevision: 0, expectedRoundNo: null, payload: { recipientMembershipIds: ["first-member", "first-member"] } },
  }).success).toBe(false);

  const offer = { kind: "cover", state: "filled_elsewhere", offerId: "offer-b", endedAt: 270000, siteZone: "Etc/UTC" };
  expect(getCoverRoute.output.safeParse({ audience: "worker", offer }).success).toBe(true);
  expect(getCoverRoute.output.safeParse({ audience: "worker", offer: { ...offer, winnerName: "First" } }).success).toBe(false);
  expect(safeConflictSchema.safeParse({ kind: "cover", status: "filled" }).success).toBe(true);
  expect(safeConflictSchema.safeParse({ kind: "cover", status: "filled", winnerOfferId: "offer-a" }).success).toBe(false);
});
