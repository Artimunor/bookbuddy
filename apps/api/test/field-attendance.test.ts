import { expect, test } from "bun:test";
import {
  departAssignmentRoute, getVisitLogRoute, getWorkerFieldShiftRoute, operationIdHeader, recordAssignmentProgressRoute, recordAttendanceRoute,
  requestAttendanceCorrectionRoute, resultSchema, syncLimits, syncProgressPhotoLimit, syncRoute,
} from "@bookbuddy/api-contract";
import type { ResponseSchema } from "@bookbuddy/api-contract";
import { ATTENDANCE_REVIEW_POLICY } from "@bookbuddy/domain";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { hashSessionCredential } from "../src/modules/auth/session";
import { createTestD1 } from "./d1";

const minute = 60_000;
const people = {
  worker: { name: "Diego Torres", credential: `${"A".repeat(42)}A`, role: "worker" },
  lead: { name: "Lucía Martín", credential: `${"A".repeat(42)}E`, role: "worker" },
  foreman: { name: "Mateo Ruiz", credential: `${"A".repeat(42)}I`, role: "foreman" },
  customer: { name: "Claire Jones", credential: `${"A".repeat(42)}M`, role: "customer" },
} as const;
type Person = keyof typeof people;

async function fieldFixture() {
  const db = await createTestD1();
  const app = createApp();
  app.onError((error) => { throw error; });
  const hints: string[] = [];
  const env = { DB: db, SYNC_CURSOR_HMAC_KEY: "field-test-cursor-key-with-enough-bytes", LIVE: { getByName: (name: string) => ({
    publishInvalidation: async () => { hints.push(name); },
  }) } } as unknown as Bindings;
  const execution = { props: {}, waitUntil() {}, passThroughOnException() {} };
  const startsAt = Date.now() - 10 * minute;
  const endsAt = startsAt + 60 * minute;
  const confirmedAt = startsAt - 90 * minute;
  const sessions = await Promise.all(Object.entries(people).map(async ([id, person]) => ({ id, ...person, hash: await hashSessionCredential(person.credential) })));
  try {
    await db.batch([
      ...sessions.map(({ id, name }) => db.prepare("INSERT INTO accounts (id, email_normalized, display_name, verified_at, state) VALUES (?, ?, ?, 1, 'active')")
        .bind(id, `${id}@example.test`, name)),
      db.prepare("INSERT INTO operating_areas (id, name, site_zone, polygon) VALUES ('area', 'Test area', 'Europe/Madrid', '[0]')"),
      db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
        VALUES ('business', 'Provider', 'Provider', 'provider@example.test', 'area', 'approved')`),
      ...sessions.flatMap(({ id, role, hash }) => [
        ...(role === "customer" ? [db.prepare("INSERT INTO account_contexts (id, account_id, role) VALUES ('customer-context', 'customer', 'customer')")] : [
          db.prepare("INSERT INTO memberships (id, business_id, account_id, state) VALUES (?, 'business', ?, 'active')").bind(`${id}-member`, id),
          db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at)
            VALUES (?, ?, 'business', ?, ?, 1)`).bind(`${id}-grant`, `${id}-member`, id, role),
          db.prepare(`INSERT INTO account_contexts (id, account_id, role, business_id, role_grant_id)
            VALUES (?, ?, ?, 'business', ?)`).bind(`${id}-context`, id, role, `${id}-grant`),
        ]),
        db.prepare(`INSERT INTO sessions (id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
          VALUES (?, ?, ?, ?, 'device', 1, ?)`).bind(`${id}-session`, id, hash, `${id}-context`, endsAt),
      ]),
      db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state)
        VALUES ('place', 'customer', 'Villa Mar', 'Test address', 'pending_verification')`),
      db.prepare("INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES ('place', 'customer', 1, 1)"),
      db.prepare(`UPDATE places SET state = 'in_area', site_zone = 'Europe/Madrid', area_id = 'area', named_approver_id = 'customer',
        pin = '{"latitude":0,"longitude":0}', safe_arrival_note = 'Call before going in' WHERE id = 'place'`),
      db.prepare(`INSERT INTO jobs (id, reference, business_id, place_id, requester_id, accountable_foreman_membership_id, trade, origin, state)
        VALUES ('job', 'BB-1042', 'business', 'place', 'customer', 'foreman-member', 'joinery', 'bookbuddy', 'open')`),
      db.prepare("INSERT INTO visits (id, job_id, kind, state) VALUES ('visit', 'job', 'work', 'booked')"),
      db.prepare(`INSERT INTO visit_windows (id, visit_id, starts_at, ends_at, expires_at, provider_authorized, proposed_at, proposed_by,
        confirmed_at, confirmed_by, state) VALUES ('window', 'visit', ?, ?, ?, 1, ?, 'foreman', ?, 'customer', 'confirmed')`)
        .bind(startsAt, endsAt, startsAt - 60 * minute, startsAt - 120 * minute, confirmedAt),
      db.prepare(`INSERT INTO shifts (id, visit_id, starts_at, ends_at, skill, briefing_language, state)
        VALUES ('shift', 'visit', ?, ?, 'joinery', 'es', 'planned')`).bind(startsAt, endsAt),
      db.prepare("INSERT INTO shift_slots (id, shift_id, number, is_lead) VALUES ('slot', 'shift', 1, 0), ('lead-slot', 'shift', 2, 1)"),
      ...[["assignment", "slot", "worker-member"], ["lead-assignment", "lead-slot", "lead-member"]].map(([id, slot, worker]) => db.prepare(`
        INSERT INTO assignments (id, slot_id, worker_membership_id, source, state, confirmed_by, confirmed_at, starts_at, ends_at)
        VALUES (?, ?, ?, 'ordinary', 'confirmed', 'foreman', ?, ?, ?)`).bind(id, slot, worker, confirmedAt, startsAt, endsAt)),
      db.prepare("INSERT INTO safety_holds (id, assignment_id, kind, state) VALUES ('hold', 'assignment', 'briefing', 'active')"),
    ]);
  } catch (error) {
    db.close();
    throw error;
  }

  async function request(person: Person, path: string, method: string, body?: unknown, operationId?: string) {
    return app.request(`https://bookbuddy.test/api/v1${path}`, {
      method, headers: { Authorization: `Bearer ${people[person].credential}`, "Content-Type": "application/json",
        ...(operationId ? { [operationIdHeader]: operationId } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env, execution);
  }
  async function batchRequest(person: Person, path: string, body: unknown, operationId?: string) {
    const before = { ...db.calls };
    const response = await request(person, path, "POST", body, operationId);
    expect(db.calls.batch - before.batch).toBe(1);
    expect(db.calls.query - before.query).toBe(0);
    return response;
  }
  return { db, hints, startsAt, endsAt, request, batchRequest,
    command: (path: string, operationId: string, payload: unknown, person: Person = "worker", assignment = "assignment") =>
      batchRequest(person, `/assignments/${assignment}/${path}`, { operationId, payload }, operationId),
    sync: (cursor: string | null, operations: readonly unknown[] = [], person: Person = "worker") =>
      batchRequest(person, "/sync", { contextId: `${person}-context`, cursor, operations }),
  };
}

const capture = (id: string, kind: "arrival" | "departure", actualAt: number) => ({ id, kind, actualAt, capturedAt: actualAt + 15 });
async function data<Output extends ResponseSchema>(response: Response, schema: Output) {
  const result = resultSchema(schema).parse(await response.json());
  if (!result.ok) throw new Error(`Request failed: ${response.status} ${result.error.code}`);
  expect(response.status).toBe(200);
  return result.data;
}

test("attendance preserves actual, captured and received times without clearing the hold", async () => {
  const f = await fieldFixture();
  try {
    const arrival = capture("arrival-id", "arrival", f.startsAt);
    const recorded = await data(await f.command("attendance", "arrival-op", arrival), recordAttendanceRoute.output);
    expect(recorded).toMatchObject({ outcome: "recorded", event: { ...arrival, source: "self", reviewState: "accepted", recordedByName: "Diego Torres" },
      holds: [{ id: "hold", kind: "briefing", state: "active", instruction: null }] });
    expect(recorded.event.receivedAt).toBeGreaterThan(recorded.event.capturedAt);
    const departure = capture("departure-id", "departure", f.startsAt + minute);
    const receipt = await data(await f.command("attendance", "departure-op", departure), recordAttendanceRoute.output);
    expect(receipt.event).toMatchObject({ ...departure, reviewState: "accepted" });
    expect(receipt.holds).toEqual(recorded.holds);

    let before = { ...f.db.calls };
    const shift = await data(await f.request("worker", "/assignments/assignment/field", "GET"), getWorkerFieldShiftRoute.output);
    expect(f.db.calls.query - before.query).toBe(1);
    expect(f.db.calls.batch - before.batch).toBe(0);
    expect(shift).toMatchObject({ attendance: { arrival: recorded.event, departure: receipt.event, hasPendingReview: false },
      nextAction: null, job: { placeAlias: "Villa Mar" } });
    expect(JSON.stringify(shift)).not.toContain("Test address");
    expect((await f.request("lead", "/assignments/assignment/field", "GET")).status).toBe(404);

    before = { ...f.db.calls };
    const log = await data(await f.request("foreman", "/visits/visit/log?shiftId=shift", "GET"), getVisitLogRoute.output);
    expect(f.db.calls.query - before.query).toBe(1);
    expect(f.db.calls.batch - before.batch).toBe(0);
    if (log.view !== "all") throw new Error("Expected private log");
    expect(log.control?.crew.find(({ assignmentId }) => assignmentId === "assignment")?.holds).toEqual(recorded.holds);
    const stamps = log.stamps.filter((stamp) => stamp.kind === "attendance");
    expect(stamps.map(({ event }) => event.id)).toEqual(["departure-id", "arrival-id"]);
    const preview = await data(await f.request("foreman", "/visits/visit/log?view=customer", "GET"), getVisitLogRoute.output);
    expect(preview).toMatchObject({ view: "customer", stamps: [
      { kind: "on_site", occurredAt: arrival.actualAt, recordedAt: recorded.event.receivedAt },
    ] });
    if (preview.view !== "customer") throw new Error("Expected customer-filtered log");
    expect(Object.keys(preview.stamps[0]!).sort()).toEqual(["id", "kind", "occurredAt", "recordedAt"]);
    expect(stamps[1]?.customerUpdateId).toBe(preview.stamps[0]?.id);
    expect((await f.request("customer", "/visits/visit/log", "GET")).status).toBe(404);
  } finally { f.db.close(); }
});

test("attendance enforces order, named assignment, review bounds and a location-free wire", async () => {
  const f = await fieldFixture();
  try {
    const before = capture("before", "departure", f.startsAt);
    expect((await f.command("attendance", "no-arrival-yet", before)).status).toBe(409);
    expect((await f.command("attendance", "foreign-worker", capture("foreign-id", "arrival", f.startsAt), "lead")).status).toBe(404);
    const early = capture("early-id", "arrival", f.startsAt - ATTENDANCE_REVIEW_POLICY.arrivalBeforeStartMs - 1);
    const reviewed = await data(await f.command("attendance", "review-op", early), recordAttendanceRoute.output);
    expect(reviewed.event).toMatchObject({ ...early, reviewState: "needs_review", reasonCode: "out_of_window" });
    expect((await f.command("attendance", "arrival-not-accepted", before)).status).toBe(409);
    expect(f.hints).not.toContain("customer-visit:visit");

    const arrival = capture("accepted-id", "arrival", f.startsAt + minute);
    await data(await f.command("attendance", "accepted-op", arrival), recordAttendanceRoute.output);
    expect((await f.command("attendance", "inverted-pair", before)).status).toBe(409);
    const late = capture("late-id", "departure", f.endsAt + ATTENDANCE_REVIEW_POLICY.departureAfterEndMs + 1);
    expect((await data(await f.command("attendance", "late-op", late), recordAttendanceRoute.output)).event)
      .toMatchObject({ reviewState: "needs_review", reasonCode: "out_of_window" });
    const disputed = await data(await f.command("request-correction", "dispute-op", {
      id: "dispute", eventId: arrival.id, reasonCode: "disputed",
    }), requestAttendanceCorrectionRoute.output);
    expect(disputed).toMatchObject({ state: "requested", reasonCode: "disputed", requestedByName: "Diego Torres", eventId: arrival.id });
    const shift = await data(await f.request("worker", "/assignments/assignment/field", "GET"), getWorkerFieldShiftRoute.output);
    expect(shift.attendance).toMatchObject({ arrival: { id: arrival.id, reviewState: "accepted" }, departure: null,
      hasPendingReview: true, pendingReviewEventIds: ["early-id", "late-id"] });

    const calls = { ...f.db.calls };
    for (const body of [
      { operationId: "location", payload: { ...arrival, latitude: 0 } },
      { operationId: "location", payload: arrival, longitude: 0 },
    ]) {
      expect((await f.request("worker", "/assignments/assignment/attendance", "POST", body, "location")).status).toBe(422);
    }
    expect((await f.request("worker", "/sync", "POST", { contextId: "worker-context", cursor: null, operations: [
      { kind: "attendance", operationId: "location", payload: { ...arrival, assignmentId: "assignment", location: [0, 0] } },
    ] })).status).toBe(422);
    expect(f.db.calls).toEqual(calls);
    expect(await f.db.prepare("SELECT count(*) AS events FROM attendance_events").first()).toEqual({ events: 3 });
  } finally { f.db.close(); }
});

test("sync applies attendance and snapshots in one batch and replays the same receipt without writes", async () => {
  const f = await fieldFixture();
  try {
    const arrival = { kind: "attendance", operationId: "sync-arrival", payload: { ...capture("sync-event", "arrival", f.startsAt), assignmentId: "assignment" } };
    const departure = { kind: "attendance", operationId: "sync-departure", payload: { ...capture("sync-out", "departure", f.startsAt + minute), assignmentId: "assignment" } };
    const review = { ...arrival, operationId: "review-op", payload: { ...arrival.payload, id: "review-event", actualAt: f.startsAt + 1 } };
    const page = await data(await f.sync(null, [arrival, arrival, departure, review]), syncRoute.output);
    expect(page.outcomes).toEqual([
      { operationId: "sync-arrival", status: "committed", resultRef: "sync-event" },
      { operationId: "sync-arrival", status: "replayed", resultRef: "sync-event" },
      { operationId: "sync-departure", status: "committed", resultRef: "sync-out" },
      { operationId: "review-op", status: "committed", resultRef: "review-event" },
    ]);
    const upserts = page.upserts.filter(({ kind }) => kind === "worker_field_shift");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ resourceId: "assignment", value: { attendance: {
      arrival: { id: "sync-event", reviewState: "accepted" }, departure: { id: "sync-out", reviewState: "accepted" },
      pendingReviewEventIds: ["review-event"],
    } } });
    expect(JSON.stringify(upserts)).not.toMatch(/placeAlias|Villa Mar|Test address|Call before going in|lead-assignment/);
    const other = { ...arrival, payload: { ...arrival.payload, actualAt: arrival.payload.actualAt + 1 } };
    const replay = await data(await f.sync(page.cursor, [arrival, other]), syncRoute.output);
    expect(replay.outcomes).toMatchObject([{ status: "replayed" }, { status: "rejected", error: { code: "OPERATION_ID_REUSED" } }]);
    expect(replay.upserts).toEqual([]);
    const { assignmentId: _assignmentId, ...payload } = arrival.payload;
    expect((await data(await f.command("attendance", arrival.operationId, payload), recordAttendanceRoute.output)).outcome).toBe("existing");
    expect(await f.db.prepare(`SELECT (SELECT count(*) FROM attendance_events) AS events,
      (SELECT count(*) FROM sync_changes WHERE kind = 'worker_field_shift') AS changes,
      (SELECT count(*) FROM customer_updates) AS updates, (SELECT count(*) FROM operation_receipts) AS receipts`).first())
      .toEqual({ events: 3, changes: 3, updates: 1, receipts: 3 });
    expect(f.hints.filter((hint) => hint === "customer-visit:visit")).toHaveLength(1);
  } finally { f.db.close(); }
});

test("departure publishes only where a current lead previewed the customer audience", async () => {
  const f = await fieldFixture();
  try {
    const band = { startsAt: f.endsAt - 30 * minute, endsAt: f.endsAt - 15 * minute };
    const privateSend = { id: "private-trip", band, expectedAudience: "crew_only" };
    expect((await f.command("depart", "bad-preview", { ...privateSend, expectedAudience: "crew_and_customer" })).status).toBe(409);
    expect((await data(await f.command("depart", "worker-trip", privateSend), departAssignmentRoute.output)).audience).toBe("crew_only");
    expect(f.hints).not.toContain("customer-visit:visit");
    const leadSend = { id: "lead-trip", band, expectedAudience: "crew_and_customer" };
    expect((await data(await f.command("depart", "lead-trip-op", leadSend, "lead", "lead-assignment"), departAssignmentRoute.output)).audience)
      .toBe("crew_and_customer");
    await data(await f.command("attendance", "worker-on-site", capture("worker-arrival", "arrival", f.startsAt)), recordAttendanceRoute.output);
    await data(await f.command("attendance", "lead-on-site", capture("lead-arrival", "arrival", f.startsAt), "lead", "lead-assignment"), recordAttendanceRoute.output);
    expect((await f.db.prepare("SELECT kind, actor_id FROM customer_updates ORDER BY rowid").all()).results)
      .toEqual([{ kind: "on_the_way", actor_id: "lead" }, { kind: "on_site", actor_id: null }]);
  } finally { f.db.close(); }
});

test("assisted attendance and corrections require verified authority and keep the actual actor", async () => {
  const f = await fieldFixture();
  try {
    const arrival = { ...capture("assisted-arrival", "arrival", f.startsAt), source: "assisted" };
    expect((await f.command("attendance", "unverified", arrival, "foreman")).status).toBe(404);
    await f.db.batch([
      f.db.prepare(`INSERT INTO authority_verifications (id, business_id, subject_account_id, kind, verified_by, verified_at)
        VALUES ('verification', 'business', 'foreman', 'business_grant', 'customer', 1)`),
      f.db.prepare(`INSERT INTO business_grants (id, business_id, membership_id, capability, issuer_id, approval_verification_id, valid_from)
        VALUES ('correction-grant', 'business', 'foreman-member', 'schedule_correction', 'customer', 'verification', 1)`),
    ]);
    const event = await data(await f.command("attendance", "assisted-op", arrival, "foreman"), recordAttendanceRoute.output);
    expect(event.event).toMatchObject({ assignmentId: "assignment", source: "assisted", recordedByName: "Mateo Ruiz" });
    const request = await data(await f.command("request-correction", "assisted-correction", { id: "correction", eventId: arrival.id,
      reasonCode: "wrong_time", proposedActualAt: arrival.actualAt + minute }, "foreman"), requestAttendanceCorrectionRoute.output);
    expect(request).toMatchObject({ state: "requested", assignmentId: "assignment", requestedByName: "Mateo Ruiz" });
    await f.db.prepare("UPDATE business_grants SET revoked_at = ? WHERE id = 'correction-grant'").bind(Date.now()).run();
    expect((await f.command("attendance", "assisted-op", arrival, "foreman")).status).toBe(404);
  } finally { f.db.close(); }
});

test("progress links only ready photos for the named worker and remains private until deliberately shared", async () => {
  const f = await fieldFixture();
  try {
    await data(await f.command("attendance", "lead-on-site", capture("lead-arrival", "arrival", f.startsAt), "lead", "lead-assignment"),
      recordAttendanceRoute.output);
    await f.db.batch([
      f.db.prepare(`INSERT INTO visit_activity_events (id, visit_id, actor_id, kind, at)
        VALUES ('start', 'visit', 'foreman', 'work_started', ?)`).bind(f.startsAt + minute),
      f.db.prepare(`INSERT INTO media_stages (id, context_id, caller, parent_scope_id, created_at, expires_at)
        VALUES ('stage', 'lead-context', 'progress', 'lead-assignment', ?, ?)`).bind(f.startsAt + minute, f.endsAt),
      f.db.prepare(`INSERT INTO attachments (id, stage_id, object_key, mime, bytes, state, etag, retention_class, delete_after)
        VALUES ('ready-photo', 'stage', 'object-ready', 'image/jpeg', 1024, 'ready', 'etag', 'unlinked', ?),
          ('unverified-photo', 'stage', 'object-unverified', 'image/jpeg', 2048, 'uploading', NULL, 'unlinked', ?)`).bind(f.endsAt, f.endsAt),
    ]);
    const photo = { id: "photo-stamp", attachmentId: "ready-photo", capturedAt: f.startsAt + 2 * minute,
      caption: { language: "es", text: "Listo" } };
    const command = (id: string, payload: unknown) => f.command("progress", id, payload, "lead", "lead-assignment");
    expect((await command("mixed", { photos: [photo, { ...photo, id: "bad-stamp", attachmentId: "unverified-photo" }] })).status).toBe(422);
    expect((await f.command("progress", "foreign-photo", { photos: [photo] }, "worker", "lead-assignment")).status).toBe(404);
    const result = await data(await command("private-photo", { photos: [photo] }), recordAssignmentProgressRoute.output);
    expect(result).toMatchObject({ assignmentId: "lead-assignment",
      receipts: [{ id: "photo-stamp", attachmentId: "ready-photo", receivedAt: expect.any(Number) }] });
    expect(await data(await command("private-photo", { photos: [photo] }), recordAssignmentProgressRoute.output)).toEqual(result);
    expect(await f.db.prepare(`SELECT (SELECT count(*) FROM shift_evidence) AS links,
      (SELECT count(*) FROM visit_activity_events WHERE kind = 'progress_photo') AS photos,
      (SELECT count(*) FROM operation_receipts WHERE command = 'assignment_progress') AS receipts`).first()).toEqual({ links: 1, photos: 1, receipts: 1 });
    const log = await data(await f.request("foreman", "/visits/visit/log", "GET"), getVisitLogRoute.output);
    if (log.view !== "all") throw new Error("Expected private log");
    expect(log.stamps.find(({ kind }) => kind === "progress_photo")).toMatchObject({ shiftId: "shift", actorName: "Lucía Martín", capturedAt: photo.capturedAt,
      photo: { attachmentId: "ready-photo", availability: "available" }, caption: { original: photo.caption }, customerUpdateId: null,
      canShareWithCustomer: true });
    const preview = await data(await f.request("foreman", "/visits/visit/log?view=customer", "GET"), getVisitLogRoute.output);
    expect(JSON.stringify(preview)).not.toMatch(/ready-photo|Listo/);
  } finally { f.db.close(); }
});

test("sync links each eligible photo once and returns an exact receipt, rejection or replay per activity", async () => {
  const f = await fieldFixture();
  try {
    await data(await f.command("attendance", "lead-arrival-op", capture("lead-arrival", "arrival", f.startsAt),
      "lead", "lead-assignment"), recordAttendanceRoute.output);
    await f.db.batch([
      f.db.prepare(`INSERT INTO visit_activity_events (id, visit_id, actor_id, kind, at)
        VALUES ('start', 'visit', 'foreman', 'work_started', ?)`).bind(f.startsAt + minute),
      f.db.prepare(`INSERT INTO media_stages (id, context_id, caller, parent_scope_id, created_at, expires_at)
        VALUES ('mine', 'lead-context', 'progress', 'lead-assignment', ?, ?),
          ('other-stage', 'worker-context', 'progress', 'assignment', ?, ?)`)
        .bind(f.startsAt + minute, f.endsAt, f.startsAt + minute, f.endsAt),
      f.db.prepare(`INSERT INTO attachments (id, stage_id, object_key, mime, bytes, state, etag, retention_class)
        VALUES ('ready', 'mine', 'obj-ready', 'image/jpeg', 1024, 'ready', 'etag', 'unlinked'),
          ('pending', 'mine', 'obj-pending', 'image/jpeg', 1024, 'uploading', NULL, 'unlinked'),
          ('other', 'other-stage', 'obj-other', 'image/jpeg', 1024, 'ready', 'etag', 'unlinked')`),
    ]);
    const capturedAt = f.startsAt + 2 * minute;
    const ready = { activityId: "photo-ready", attachmentId: "ready", capturedAt, caption: { language: "es", text: "Listo" } };
    const pending = { activityId: "photo-pending", attachmentId: "pending", capturedAt };
    const other = { activityId: "photo-other", attachmentId: "other", capturedAt };
    const operation = { kind: "attachment_link", operationId: "offline-photos", payload: { assignmentId: "lead-assignment",
      photos: [pending, ready, other] } };
    const denied = await data(await f.sync(null, [operation]), syncRoute.output);
    expect(denied.outcomes[0]).toMatchObject({ status: "rejected", error: { code: "NOT_FOUND" }, photoOutcomes:
      [pending, ready, other].map(({ activityId }) => ({ activityId, status: "rejected", error: { code: "NOT_FOUND" } })) });

    const page = await data(await f.sync(null, [operation, operation], "lead"), syncRoute.output);
    const [committed, replayed] = page.outcomes;
    expect(committed).toMatchObject({ operationId: operation.operationId, status: "committed", resultRef: operation.operationId, photoOutcomes: [
      { activityId: pending.activityId, status: "rejected", error: { code: "VALIDATION_FAILED" } },
      { activityId: ready.activityId, status: "committed", receivedAt: expect.any(Number) },
      { activityId: other.activityId, status: "rejected", error: { code: "VALIDATION_FAILED" } },
    ] });
    const receipt = committed?.photoOutcomes?.[1];
    if (!receipt || receipt.status === "rejected") throw new Error("Missing committed photo");
    expect(replayed).toEqual({ ...committed, status: "replayed", photoOutcomes: [
      committed?.photoOutcomes?.[0], { ...receipt, status: "replayed" }, committed?.photoOutcomes?.[2],
    ] });
    const { activityId, ...fields } = ready;
    const online = await data(await f.command("progress", "online-same-photo", { photos: [{ id: activityId, ...fields }] },
      "lead", "lead-assignment"), recordAssignmentProgressRoute.output);
    expect(online.receipts).toEqual([{ id: activityId, attachmentId: ready.attachmentId, receivedAt: receipt.receivedAt }]);
    const changed = { ...operation, payload: { ...operation.payload, photos: [{ ...ready, capturedAt: ready.capturedAt + 1 }] } };
    const consumed = { ...operation, operationId: "new-id-same-photo", payload: { ...operation.payload, photos: [ready] } };
    const conflictingId = { ...changed, operationId: "new-id-changed-photo" };
    const reconciliation = await data(await f.sync(page.cursor, [changed, consumed, conflictingId], "lead"), syncRoute.output);
    expect(reconciliation.outcomes).toMatchObject([
      { status: "rejected", error: { code: "OPERATION_ID_REUSED" }, photoOutcomes: [{ activityId, status: "rejected" }] },
      { status: "unchanged", photoOutcomes: [{ activityId, status: "replayed", receivedAt: receipt.receivedAt }] },
      { status: "rejected", error: { code: "VALIDATION_FAILED" }, photoOutcomes: [{ activityId, status: "rejected" }] },
    ]);
    await f.db.batch([
      f.db.prepare("UPDATE attachments SET state = 'verifying' WHERE id = 'pending'"),
      f.db.prepare("UPDATE attachments SET state = 'ready', etag = 'etag' WHERE id = 'pending'"),
    ]);
    const retry = { ...operation, operationId: "retry-pending", payload: { ...operation.payload, photos: [pending] } };
    const reconciled = await data(await f.sync(reconciliation.cursor, [operation, retry], "lead"), syncRoute.output);
    expect(reconciled.outcomes).toMatchObject([
      { status: "replayed", photoOutcomes: [{ status: "rejected" }, { status: "replayed" }, { status: "rejected" }] },
      { status: "committed", photoOutcomes: [{ activityId: pending.activityId, status: "committed", receivedAt: expect.any(Number) }] },
    ]);
    const log = await data(await f.request("foreman", "/visits/visit/log", "GET"), getVisitLogRoute.output);
    if (log.view !== "all") throw new Error("Expected private log");
    expect(log.stamps.filter(({ kind }) => kind === "progress_photo")).toMatchObject([
      { id: expect.any(String), shiftId: "shift" }, { id: expect.any(String), shiftId: "shift" },
    ]);
    const preview = await data(await f.request("foreman", "/visits/visit/log?view=customer", "GET"), getVisitLogRoute.output);
    expect(JSON.stringify(preview)).not.toMatch(/photo-ready|photo-pending|Listo/);
    expect(await f.db.prepare(`SELECT (SELECT count(*) FROM shift_evidence) AS links,
      (SELECT count(*) FROM visit_activity_events WHERE kind = 'progress_photo') AS photos,
      (SELECT count(*) FROM operation_receipts WHERE command = 'assignment_progress') AS receipts`).first())
      .toEqual({ links: 2, photos: 2, receipts: 2 });
  } finally { f.db.close(); }
});

test("eight five-photo operations fit a single sync batch and cannot exceed the six-photo shift cap", async () => {
  const f = await fieldFixture();
  try {
    await data(await f.command("attendance", "lead-arrival-op", capture("lead-arrival", "arrival", f.startsAt),
      "lead", "lead-assignment"), recordAttendanceRoute.output);
    await f.db.batch([
      f.db.prepare(`INSERT INTO visit_activity_events (id, visit_id, actor_id, kind, at)
        VALUES ('start', 'visit', 'foreman', 'work_started', ?)`).bind(f.startsAt + minute),
      f.db.prepare(`INSERT INTO media_stages VALUES ('mine', 'lead-context', 'progress', 'lead-assignment', ?, ?)`)
        .bind(f.startsAt + minute, f.endsAt),
      f.db.prepare(`INSERT INTO attachments (id, stage_id, object_key, mime, bytes, state, etag, retention_class)
        SELECT 'photo-' || value, 'mine', 'object-' || value, 'image/jpeg', 1024, 'ready', 'etag', 'unlinked' FROM json_each(?)`)
        .bind(JSON.stringify(Array.from({ length: syncProgressPhotoLimit * syncLimits.operations }, (_, index) => index))),
    ]);
    const operations = Array.from({ length: syncLimits.operations }, (_, i) => ({
      operationId: `op-${i}`, kind: "attachment_link",
      payload: { assignmentId: "lead-assignment", photos: Array.from({ length: syncProgressPhotoLimit }, (_, j) => {
        const slot = i * syncProgressPhotoLimit + j;
        return { activityId: `activity-${slot}`, attachmentId: `photo-${slot}`, capturedAt: f.startsAt + 2 * minute };
      }) },
    }));
    const before = { ...f.db.calls };
    const page = await data(await f.sync(null, operations, "lead"), syncRoute.output);
    expect(f.db.calls.prepare - before.prepare).toBeLessThanOrEqual(7 * syncLimits.operations + 3);
    expect(page.outcomes.flatMap(({ photoOutcomes }) => photoOutcomes ?? []).map(({ status }) => status)).toEqual([
      ...Array<string>(6).fill("committed"), ...Array<string>(syncProgressPhotoLimit * syncLimits.operations - 6).fill("rejected"),
    ]);
    expect(await f.db.prepare("SELECT count(*) AS links FROM shift_evidence").first()).toEqual({ links: 6 });
    const first = operations[0]!;
    const invalidPayloads = [
      { assignmentId: "lead-assignment", attachmentIds: ["photo-0"] },
      { ...first.payload, photos: [...first.payload.photos, { activityId: "extra", attachmentId: "extra", capturedAt: f.startsAt }] },
    ];
    for (const payload of invalidPayloads) {
      const rejected = await f.request("lead", "/sync", "POST", { contextId: "lead-context", cursor: page.cursor,
        operations: [{ ...first, payload }] });
      expect(rejected.status).toBe(422);
    }
  } finally { f.db.close(); }
});
