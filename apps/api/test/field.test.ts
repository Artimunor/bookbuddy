import { expect, test } from "bun:test";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { customerLiveVisitSchema, customerUpdateSchema, recordAttendanceRoute } from "@bookbuddy/api-contract";
import { ATTENDANCE_REVIEW_POLICY } from "@bookbuddy/domain";
import { createTestD1 } from "./d1";

const startsAt = 9 * 3_600_000;
const endsAt = startsAt + 3_600_000;

async function fieldDatabase() {
  const migrations = new URL("../migrations/", import.meta.url);
  const names = (await readdir(migrations)).filter((name) => /^000[1-8]_.*\.sql$/.test(name));
  expect(names).toHaveLength(8);
  const dir = await mkdtemp(join(tmpdir(), "bookbuddy-field-"));
  try {
    await Promise.all(names.map((name) => copyFile(new URL(name, migrations), join(dir, name))));
    const db = await createTestD1(pathToFileURL(`${dir}/`));
    try {
      await db.batch([
        db.prepare(`INSERT INTO accounts (id, email_normalized, verified_at, state) VALUES
          ('foreman', 'foreman@example.test', 1, 'active'), ('worker', 'worker@example.test', 1, 'active')`),
        db.prepare(`INSERT INTO operating_areas (id, name, site_zone, polygon)
          VALUES ('area', 'Test area', 'Etc/UTC', '[[[0,0],[1,0],[0,1],[0,0]]]')`),
        db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
          VALUES ('business', 'Provider', 'Provider', 'provider@example.test', 'area', 'approved')`),
        db.prepare(`INSERT INTO memberships (id, business_id, account_id, state) VALUES
          ('lead', 'business', 'foreman', 'active'), ('crew', 'business', 'worker', 'active')`),
        db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state)
          VALUES ('place', 'foreman', 'Site', 'Test address', 'pending_verification')`),
        db.prepare("INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES ('place', 'foreman', 1, 1)"),
        db.prepare(`INSERT INTO jobs (id, reference, business_id, place_id, requester_id, accountable_foreman_membership_id, origin, state)
          VALUES ('job', 'BB-1', 'business', 'place', 'foreman', 'lead', 'bookbuddy', 'open')`),
        db.prepare("INSERT INTO visits (id, job_id, kind, state) VALUES ('visit', 'job', 'work', 'booked'), ('other', 'job', 'work', 'booked')"),
        db.prepare(`INSERT INTO shifts (id, visit_id, starts_at, ends_at, skill, briefing_language, state)
          VALUES ('shift', 'visit', ?, ?, 'joinery', 'es', 'planned')`).bind(startsAt, endsAt),
        db.prepare("INSERT INTO shift_slots (id, shift_id, number) VALUES ('slot', 'shift', 1)"),
        db.prepare(`INSERT INTO assignments (id, slot_id, worker_membership_id, source, state, confirmed_by, confirmed_at, starts_at, ends_at)
          VALUES ('assignment', 'slot', 'crew', 'ordinary', 'confirmed', 'foreman', 1, ?, ?)`).bind(startsAt, endsAt),
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

test("field migration preserves ordered, unique accepted attendance even on a safety hold", async () => {
  const db = await fieldDatabase();
  try {
    await db.prepare("INSERT INTO safety_holds (id, assignment_id, kind, state) VALUES ('hold', 'assignment', 'briefing', 'active')").run();
    const insert = db.prepare(`INSERT INTO attendance_events
      (id, assignment_id, actor_id, kind, source, actual_at, captured_at, received_at, review_state, corrects_id, reason_code)
      VALUES (?, 'assignment', 'worker', ?, 'self', ?, ?, ?, ?, ?, ?)`);
    const receivedAt = endsAt + 5_000;
    const arrival = startsAt - ATTENDANCE_REVIEW_POLICY.arrivalBeforeStartMs;
    const departure = endsAt + ATTENDANCE_REVIEW_POLICY.departureAfterEndMs;
    await expect(insert.bind("no-arrival", "departure", startsAt, startsAt, receivedAt, "accepted", null, null).run())
      .rejects.toThrow(/requires an accepted arrival/);
    await insert.bind("no-arrival", "departure", startsAt, startsAt, receivedAt, "needs_review", null, "missing_arrival").run();
    await expect(insert.bind("early", "arrival", arrival - 1, startsAt, receivedAt, "accepted", null, null).run())
      .rejects.toThrow(/out-of-window attendance/);
    await expect(insert.bind("future", "arrival", startsAt + 120001, startsAt + 120001, startsAt, "accepted", null, null).run())
      .rejects.toThrow(/attendance_events_received_time/);
    await insert.bind("arrive", "arrival", arrival, startsAt, receivedAt, "accepted", null, null).run();
    await expect(insert.bind("duplicate", "arrival", startsAt, startsAt, receivedAt, "accepted", null, null).run())
      .rejects.toThrow(/already has an accepted event/);
    await insert.bind("duplicate", "arrival", startsAt, startsAt, receivedAt, "needs_review", null, "duplicate_event").run();
    await expect(insert.bind("out-of-order", "departure", arrival - 1, startsAt, receivedAt, "accepted", null, null).run())
      .rejects.toThrow(/requires an accepted arrival/);
    await expect(insert.bind("late", "departure", departure + 1, departure + 1, departure + 2, "accepted", null, null).run())
      .rejects.toThrow(/out-of-window attendance/);
    await insert.bind("leave", "departure", departure, departure, departure + 5, "accepted", null, null).run();
    await expect(insert.bind("other-leave", "departure", startsAt, startsAt, receivedAt, "accepted", null, null).run())
      .rejects.toThrow(/already has an accepted event/);
    await expect(insert.bind("bad-edit", "arrival", departure + 1, departure + 2, departure + 3, "accepted", "arrive", "correction").run())
      .rejects.toThrow(/cannot follow its accepted departure/);
    await insert.bind("correction", "arrival", arrival - 1, departure + 2, departure + 3, "accepted", "arrive", "correction").run();
    expect(await db.prepare("SELECT actual_at, captured_at, received_at FROM attendance_events WHERE id = 'arrive'").first())
      .toEqual({ actual_at: arrival, captured_at: startsAt, received_at: receivedAt });
    expect(await db.prepare("SELECT state FROM safety_holds WHERE id = 'hold'").first("state")).toBe("active");
  } finally {
    db.close();
  }
});

test("customer arrival estimates append revisions and withdrawals on the same visit", async () => {
  const db = await fieldDatabase();
  try {
    const estimate = db.prepare(`INSERT INTO customer_updates
      (id, visit_id, actor_id, kind, band_start, band_end, corrects_id, recorded_at) VALUES (?, ?, 'foreman', ?, ?, ?, ?, ?)`);
    await estimate.bind("original", "visit", "on_the_way", startsAt, startsAt + 60_000, null, 2).run();
    await expect(estimate.bind("other", "other", "arrival_revised", startsAt, startsAt + 60_000, "original", 3).run())
      .rejects.toThrow(/current arrival stamp on this visit/);
    await estimate.bind("revised", "visit", "arrival_revised", startsAt + 60_000, startsAt + 120_000, "original", 3).run();
    await expect(estimate.bind("stale", "visit", "arrival_withdrawn", null, null, "original", 4).run())
      .rejects.toThrow(/current arrival stamp on this visit/);
    await estimate.bind("withdrawn", "visit", "arrival_withdrawn", null, null, "revised", 4).run();
    await expect(db.prepare("UPDATE customer_updates SET recorded_at = 4 WHERE id = 'original'").run())
      .rejects.toThrow(/append-only/);
    const onSite = db.prepare(`INSERT INTO customer_updates (id, visit_id, actor_id, kind, occurred_at, recorded_at)
      VALUES (?, 'visit', ?, 'on_site', ?, ?)`);
    await expect(onSite.bind("named", "worker", startsAt, startsAt + 1).run()).rejects.toThrow(/customer_updates_attribution/);
    await onSite.bind("crew", null, startsAt, startsAt + 1).run();
    await expect(onSite.bind("again", null, startsAt + 2, startsAt + 3).run()).rejects.toThrow(/append-only/);
  } finally {
    db.close();
  }
});

test("an active incident hold cannot be deleted instead of cleared", async () => {
  const db = await fieldDatabase();
  try {
    await db.prepare("INSERT INTO safety_holds (id, assignment_id, kind, state) VALUES ('incident', 'assignment', 'incident', 'active')").run();
    const remove = db.prepare("DELETE FROM safety_holds WHERE id = 'incident'");
    await expect(remove.run()).rejects.toThrow(/active safety holds must be cleared/);
    expect(await db.prepare("SELECT state FROM safety_holds WHERE id = 'incident'").first("state")).toBe("active");
    await db.prepare("UPDATE safety_holds SET state = 'cleared', cleared_at = ? WHERE id = 'incident'").bind(startsAt).run();
    expect((await remove.run()).meta.changes).toBe(1);
  } finally {
    db.close();
  }
});

test("briefing clearance requires the named worker and current positive human teach-back", async () => {
  const db = await fieldDatabase();
  try {
    await db.prepare("INSERT INTO safety_instructions (id, job_id, assignment_id) VALUES ('instruction', 'job', 'assignment')").run();
    const version = db.prepare(`INSERT INTO safety_versions (id, instruction_id, no, issuer_id, original, language, issued_at)
      VALUES (?, 'instruction', ?, 'foreman', 'Do not use the door.', 'es', ?)`);
    await version.bind("v1", 1, 2).run();
    await db.prepare(`INSERT INTO safety_holds (id, assignment_id, version_id, kind, state)
      VALUES ('hold', 'assignment', 'v1', 'briefing', 'active')`).run();
    const clear = db.prepare("UPDATE safety_holds SET state = 'cleared', cleared_at = ? WHERE id = 'hold'");
    await expect(clear.bind(8).run()).rejects.toThrow(/requires that version/);
    const proof = db.prepare(`INSERT INTO teach_backs (id, version_id, assignment_id, verified_by, language, checklist, outcome, at)
      VALUES (?, ?, 'assignment', 'foreman', 'es', ?, ?, ?)`);
    const pass = JSON.stringify({ hazard: true, control: true, response: true });
    const fail = JSON.stringify({ hazard: true, control: true, response: false });
    await proof.bind("pass-old", "v1", pass, "passed", 3).run();
    await proof.bind("fail", "v1", fail, "not_understood", 4).run();
    const acknowledge = db.prepare(`INSERT INTO safety_acknowledgements (version_id, assignment_id, worker_id, teach_back_id, at)
      VALUES (?, 'assignment', ?, ?, ?)`);
    await expect(acknowledge.bind("v1", "worker", "fail", 5).run()).rejects.toThrow(/current positive teach-back/);
    await expect(acknowledge.bind("v1", "worker", "pass-old", 5).run()).rejects.toThrow(/current positive teach-back/);
    await proof.bind("pass", "v1", pass, "passed", 6).run();
    await expect(acknowledge.bind("v1", "foreman", "pass", 7).run()).rejects.toThrow(/current positive teach-back/);
    await acknowledge.bind("v1", "worker", "pass", 7).run();
    await clear.bind(8).run();
    await version.bind("v2", 2, 9).run();
    await expect(acknowledge.bind("v2", "worker", "pass", 10).run()).rejects.toThrow(/current positive teach-back/);
  } finally {
    db.close();
  }
});

test("field wire shapes reject location and individual attendance in customer live data", () => {
  const capture = { id: "arrival", kind: "arrival", actualAt: 10, capturedAt: 11 };
  const input = { params: { id: "assignment" }, body: { operationId: "op", payload: capture } };
  expect(recordAttendanceRoute.input.safeParse(input).success).toBe(true);
  expect(recordAttendanceRoute.input.safeParse({ ...input, body: { ...input.body, payload: { ...capture, latitude: 0 } } }).success).toBe(false);
  const onSite = { id: "update", kind: "on_site", occurredAt: 10, recordedAt: 12 };
  expect(customerUpdateSchema.safeParse({ ...onSite, sharedByName: "Worker" }).success).toBe(false);
  const live = {
    visitId: "visit", job: { id: "job", reference: "BB-1", title: null, placeAlias: "Site" }, siteZone: "Etc/UTC",
    window: { id: "window", startsAt: 9, endsAt: 15 }, confirmedCrewNames: ["Worker"],
    providerName: "Provider", foremanName: "Foreman", jobThreadId: null, completionId: null,
    live: { step: "on_site", status: "on_site", since: 10, source: { at: 10, sharedByName: null }, arrival: null, nextUpdateAt: null },
    moments: [onSite], page: { cursor: null, hasMore: false },
  };
  expect(customerLiveVisitSchema.safeParse(live).success).toBe(true);
  expect(customerLiveVisitSchema.safeParse({ ...live, attendance: [capture] }).success).toBe(false);
  expect(customerLiveVisitSchema.safeParse({ ...live, live: { ...live.live, source: { at: 10, sharedByName: "Worker" } } }).success).toBe(false);
});
