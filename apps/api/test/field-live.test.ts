import { expect, spyOn, test } from "bun:test";
import {
  cachedAssignmentBriefingSchema, customerLiveVisitSchema, foremanVisitControlSchema, operationIdHeader, resultSchema, syncRoute,
} from "@bookbuddy/api-contract";
import type { SyncPage, SyncRequest } from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential } from "../src/modules/auth/session";
import { createTestD1 } from "./d1";

const origin = "https://bookbuddy.test";
const now = Date.parse("2026-11-24T08:00:00Z");
const minute = 60_000;
const start = now - minute;
const end = now + 60 * minute;
const roles = { customer: "customer", outside: "customer", foreman: "foreman", worker: "worker", helper: "worker", candidate: "worker" } as const;
type Actor = keyof typeof roles;

async function fixture() {
  const db = await createTestD1();
  const app = createApp().onError((error) => { throw error; });
  const topics: string[] = [];
  const wakes: (readonly string[])[] = [];
  const env = {
    DB: db,
    SYNC_CURSOR_HMAC_KEY: "field-live-test-cursor-key-with-more-than-32-bytes",
    LIVE: { getByName: (name: string) => ({ async publishInvalidation() { topics.push(name); } }) },
    EFFECTS: { async send({ workKeys }: { workKeys: readonly string[] }) { wakes.push(workKeys); } },
  } as unknown as Bindings;
  const execution = { waitUntil() {}, passThroughOnException() {} };
  const credentials = await Promise.all((Object.keys(roles) as Actor[]).map(async (actor) => {
    const token = randomToken();
    return { actor, token, digest: await hashSessionCredential(token) };
  }));
  try {
    await db.batch([
      db.prepare("INSERT INTO operating_areas (id, name, site_zone, polygon) VALUES ('area', 'Area', 'Europe/Madrid', '[0]')"),
      db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
        VALUES ('business', 'Provider', 'Provider', 'provider@example.test', 'area', 'approved')`),
      ...credentials.flatMap(({ actor, digest }) => {
        const role = roles[actor];
        return [
          db.prepare("INSERT INTO accounts (id, email_normalized, display_name, verified_at, setup_at, state) VALUES (?, ?, ?, 1, 1, 'active')")
            .bind(actor, `${actor}@example.test`, `${actor} name`),
          ...(role === "customer" ? [db.prepare("INSERT INTO account_contexts (id, account_id, role) VALUES (?, ?, 'customer')")
            .bind(`${actor}-context`, actor)] : [
            db.prepare("INSERT INTO memberships VALUES (?, 'business', ?, 'active')").bind(`${actor}-member`, actor),
            db.prepare(`INSERT INTO membership_roles (id, membership_id, business_id, account_id, role, granted_at)
              VALUES (?, ?, 'business', ?, ?, 1)`).bind(`${actor}-role`, `${actor}-member`, actor, role),
            db.prepare("INSERT INTO account_contexts VALUES (?, ?, ?, 'business', ?)").bind(`${actor}-context`, actor, role, `${actor}-role`),
          ]),
          db.prepare(`INSERT INTO sessions (id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
            VALUES (?, ?, ?, ?, 'device', 1, ?)`).bind(`${actor}-session`, actor, digest, `${actor}-context`, end + minute),
        ];
      }),
      db.prepare("INSERT INTO member_languages VALUES ('worker-member', 'es')"),
      db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state)
        VALUES ('place', 'customer', 'Villa', 'Private address', 'pending_verification')`),
      db.prepare("INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES ('place', 'customer', 1, 1)"),
      db.prepare(`UPDATE places SET state = 'in_area', named_approver_id = 'customer', area_id = 'area', site_zone = 'Europe/Madrid',
        pin = '{"latitude":12,"longitude":34}' WHERE id = 'place'`),
      db.prepare(`INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, valid_from)
        VALUES ('approved', 'place', 'customer', 'approve', 'customer', 1)`),
      db.prepare(`INSERT INTO jobs (id, reference, business_id, place_id, requester_id, accountable_foreman_membership_id, trade, origin, state)
        VALUES ('job', 'BB-1', 'business', 'place', 'customer', 'foreman-member', 'carpentry', 'bookbuddy', 'open')`),
      db.prepare(`INSERT INTO requests (job_id, original_text, original_language, arrival_arrangement, safe_note, submitted_at)
        VALUES ('job', 'Private request', 'es', 'requester', 'Private arrival note', 2)`),
      db.prepare("INSERT INTO visits (id, job_id, kind, state) VALUES ('visit', 'job', 'work', 'booked')"),
      db.prepare(`INSERT INTO visit_windows (id, visit_id, starts_at, ends_at, expires_at, provider_authorized, proposed_at, proposed_by,
        confirmed_at, confirmed_by, state) VALUES ('window', 'visit', ?, ?, ?, 1, 1, 'foreman', 2, 'customer', 'confirmed')`)
        .bind(start, end, start - minute),
      db.prepare(`INSERT INTO shifts (id, visit_id, starts_at, ends_at, skill, briefing_language, state)
        VALUES ('shift', 'visit', ?, ?, 'carpentry', 'es', 'planned')`).bind(start, end),
      db.prepare("INSERT INTO shift_slots (id, shift_id, number, is_lead) VALUES ('lead', 'shift', 1, 1), ('second', 'shift', 2, 0)"),
      db.prepare(`INSERT INTO assignments (id, slot_id, worker_membership_id, source, state, confirmed_by, confirmed_at, starts_at, ends_at)
        VALUES ('assignment', 'lead', 'worker-member', 'ordinary', 'confirmed', 'foreman', 3, ?, ?),
          ('second-assignment', 'second', 'helper-member', 'ordinary', 'confirmed', 'foreman', 3, ?, ?)`)
        .bind(start, end, start, end),
      db.prepare(`INSERT INTO assignments (id, slot_id, worker_membership_id, source, state, confirmed_by, confirmed_at,
        starts_at, ends_at, dropped_at, dropout_reported_by, dropout_source, dropout_reason) VALUES
        ('old-assignment', 'lead', 'candidate-member', 'ordinary', 'dropped', 'foreman', 2, ?, ?, 3, 'candidate', 'self', 'transport')`).bind(start, end),
      db.prepare(`INSERT INTO customer_updates (id, visit_id, actor_id, kind, recorded_at)
        VALUES ('crew-confirmed', 'visit', 'foreman', 'crew_confirmed', 4)`),
      db.prepare("INSERT INTO chat_threads (id, job_id, audience, write_state) VALUES ('job-thread', 'job', 'job', 'open'), ('worker-chat', 'job', 'crew', 'open')"),
      db.prepare("INSERT INTO chat_members (thread_id, context_id, can_send, visible_from) VALUES ('job-thread', 'customer-context', 1, 1), ('worker-chat', 'customer-context', 0, 1)"),
    ]);
  } catch (error) {
    db.close();
    throw error;
  }
  async function call(actor: Actor, path: string, body?: { operationId: string; payload: unknown; expectedRevision?: number } | SyncRequest) {
    const { batch, query } = db.calls;
    const response = await app.request(`${origin}/api/v1${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${credentials.find(({ actor: id }) => id === actor)!.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(body && "operationId" in body ? { [operationIdHeader]: body.operationId } : {}),
      },
      body: body && JSON.stringify(body),
    }, env, execution);
    expect(db.calls.batch - batch).toBe(body ? 1 : 0);
    expect(db.calls.query - query).toBe(body ? 0 : 1);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    return { status: response.status, body: await response.json() };
  }
  async function sync(actor: Actor, cursor: string | null = null) {
    const response = await call(actor, "/sync", { contextId: `${actor}-context`, cursor, operations: [] });
    expect(response.status).toBe(200);
    const result = resultSchema(syncRoute.output).parse(response.body);
    if (!result.ok) throw new Error(`Sync failed: ${result.error.code}`);
    return result.data;
  }
  return { db, call, sync, wakes, topics };
}

const updatePath = "/visits/visit/updates";
const workPath = "/visits/visit/start-work";
const livePath = "/visits/visit/live";
const safetyPath = "/safety/instruction";
const briefingPath = "/assignments/assignment/briefing";
const operation = (operationId: string, payload: unknown, expectedRevision?: number) => ({ operationId, payload, expectedRevision });

test("live arrival corrections append and customer read never contains private roster or attendance", async () => {
  const f = await fixture();
  const clock = spyOn(Date, "now").mockReturnValue(now);
  try {
    await f.db.prepare(`INSERT INTO attendance_events (id, assignment_id, actor_id, kind, source, actual_at, captured_at, received_at,
      review_state, reason_code) VALUES ('private-attendance-id', 'assignment', 'worker', 'arrival', 'self', ?, ?, ?, 'needs_review', 'disputed')`)
      .bind(now, now, now).run();
    const band = { startsAt: now + 5 * minute, endsAt: now + 10 * minute };
    const original = operation("publish-estimate", { id: "estimate", kind: "on_the_way", band }, 0);
    expect((await f.call("helper", updatePath, original)).status).toBe(404);
    expect((await f.call("worker", updatePath, original)).body).toMatchObject({ data: { revision: 1, update: { id: "estimate", band } } });
    const revised = { startsAt: now + 10 * minute, endsAt: now + 17 * minute };
    const correction = operation("correct-estimate", { id: "corrected", kind: "arrival_revised", correctsId: "estimate", band: revised }, 1);
    expect((await f.call("foreman", updatePath, correction)).body).toMatchObject({ data: { revision: 2, update: { correctsId: "estimate", band: revised } } });
    expect((await f.call("foreman", updatePath, correction)).status).toBe(200);
    expect((await f.call("foreman", updatePath,
      operation("stale-estimate", { id: "stale", kind: "arrival_withdrawn", correctsId: "estimate" }, 2))).status).toBe(409);
    expect((await f.call("foreman", updatePath,
      operation("photo", { id: "photo", kind: "photo", attachmentId: "arbitrary" }, 2))).status).toBe(422);
    expect((await f.call("outside", livePath)).status).toBe(404);
    const customer = customerLiveVisitSchema.parse((await f.call("customer", livePath)).body.data);
    expect(customer.confirmedCrewNames).toEqual(["helper name", "worker name"]);
    expect(customer.siteZone).toBe("Europe/Madrid");
    expect(customer.jobThreadId).toBe("job-thread");
    expect(customer.window).toEqual({ id: "window", startsAt: start, endsAt: end });
    expect(customer.live.arrival).toMatchObject({ kind: "arrival_revised", band: revised });
    expect(customer.moments.map(({ id }) => id)).toEqual(["estimate", "corrected", "crew-confirmed"]);
    expect(JSON.stringify(customer)).not.toMatch(/latitude|longitude|candidate name|transport|private-attendance-id|Private address|Private arrival note|assignment/i);
    clock.mockReturnValue(revised.endsAt);
    expect((await f.call("customer", livePath)).body).toMatchObject({ data: { live: { status: null, arrival: null } } });
    clock.mockReturnValue(now);
    const control = foremanVisitControlSchema.parse((await f.call("foreman", livePath)).body.data);
    expect(control.crew.find(({ assignmentId }) => assignmentId === "assignment")?.attendance.hasPendingReview).toBe(true);
    const withdrawal = operation("withdraw-estimate", { id: "withdrawn", kind: "arrival_withdrawn", correctsId: "corrected" }, 2);
    expect((await f.call("foreman", updatePath, withdrawal)).body).toMatchObject({ data: { revision: 3,
      customerPreview: { live: { step: "confirmed", arrival: null } } } });
    expect(f.topics).toEqual(["customer-visit:visit", "customer-visit:visit", "customer-visit:visit"]);
    expect(f.wakes.map((keys) => keys.length)).toEqual([1, 1, 1]);
    const notices = await f.db.prepare(`SELECT n.context_id, n.link_token, t.kind, t.resource_id FROM notifications n
      JOIN link_targets t ON t.token = n.link_token ORDER BY n.event_key`).all();
    expect(notices.results).toHaveLength(3);
    expect(new Set(notices.results.map((row) => row.link_token)).size).toBe(1);
    for (const notice of notices.results) expect(notice).toMatchObject({ context_id: "customer-context", kind: "visit_live", resource_id: "visit" });
    expect((await f.db.prepare("SELECT DISTINCT kind FROM sync_changes WHERE partition_key = 'customer-context'").all()).results)
      .toEqual([{ kind: "notification" }]);
  } finally { clock.mockRestore(); f.db.close(); }
});

test("work start and resume require the active version's human teach-back and named acknowledgement", async () => {
  const f = await fixture();
  const clock = spyOn(Date, "now").mockReturnValue(now);
  try {
    await f.db.batch([
      f.db.prepare(`INSERT INTO safety_holds (id, assignment_id, kind, state) VALUES ('initial-hold', 'assignment', 'briefing', 'active')`),
      f.db.prepare(`INSERT INTO attendance_events (id, assignment_id, actor_id, kind, source, actual_at, captured_at, received_at, review_state)
        VALUES ('private-checkin', 'assignment', 'worker', 'arrival', 'self', ?, ?, ?, 'accepted')`).bind(start, start, start),
      f.db.prepare(`INSERT INTO customer_updates (id, visit_id, kind, occurred_at, recorded_at) VALUES ('crew-on-site', 'visit', 'on_site', ?, ?)`)
        .bind(start, start),
    ]);
    const startWork = operation("start-work", { id: "work-start", bookedWindowId: "window" }, 0);
    const instruction = { language: "es", text: "Brief the crew about the restricted doorway." };
    const issue = (id: string, expectedVersionId: string | null) => f.call("foreman", `${safetyPath}/issue`,
      operation(`issue-${id}`, { id, assignmentId: "assignment", expectedVersionId, original: instruction }));
    const teach = (id: string, versionId: string, progress: { language?: string; passed?: boolean } = {}) => f.call("foreman", `${safetyPath}/teach-back`,
      operation(`teach-${id}`, { id, versionId, language: progress.language ?? "es",
        outcome: progress.passed === false ? "not_understood" : "passed",
        checklist: { hazard: true, control: true, response: progress.passed !== false } }));
    const acknowledge = (actor: Actor, id: string, versionId: string, teachBackId: string) => f.call(actor, `${safetyPath}/acknowledge`,
      operation(id, { versionId, teachBackId }));
    expect((await f.call("foreman", workPath, startWork)).status).toBe(409);
    expect((await issue("v1", null)).body).toMatchObject({ data: { version: { no: 1 }, state: "awaiting_teach_back", holds: [{ state: "active" }] } });
    expect((await f.call("customer", safetyPath)).status).toBe(404);
    expect((await f.call("helper", briefingPath)).status).toBe(404);
    expect((await f.call("worker", briefingPath)).body).toMatchObject({ data: { shift: { id: "assignment" }, instruction: { version: { id: "v1" } } } });
    expect((await acknowledge("worker", "ack-v1", "v1", "proof-v1")).status).toBe(409);
    expect((await teach("wrong-language", "v1", { language: "fr" })).status).toBe(409);
    expect((await teach("a-failed", "v1", { passed: false })).body).toMatchObject({ data: { state: "awaiting_teach_back" } });
    expect((await acknowledge("worker", "ack-failed", "v1", "a-failed")).status).toBe(409);
    expect((await teach("proof-v1", "v1")).body).toMatchObject({ data: { state: "awaiting_acknowledgement", holds: [{ state: "active" }] } });
    expect((await f.call("foreman", workPath, startWork)).status).toBe(409);
    expect((await acknowledge("helper", "wrong-worker", "v1", "proof-v1")).status).toBe(404);
    expect((await acknowledge("worker", "ack-v1", "v1", "proof-v1")).body)
      .toMatchObject({ data: { state: "acknowledged", holds: [{ state: "cleared" }] } });
    expect((await f.call("worker", workPath, startWork)).body).toMatchObject({ data: { revision: 1, published: { kind: "working" } } });
    expect((await f.call("foreman", updatePath, operation("pause", { id: "pause", kind: "paused", nextUpdateAt: now + minute }, 1))).body)
      .toMatchObject({ data: { revision: 2, customerPreview: { live: { step: "working", status: "paused", nextUpdateAt: now + minute } } } });
    expect((await issue("v2", "v1")).body).toMatchObject({ data: { version: { no: 2 }, state: "awaiting_teach_back", holds: [{ state: "active" }] } });
    const question = { id: "q", versionId: "v2", original: { language: "es", text: "Could you show me the alternative route?" } };
    expect((await f.call("worker", `${safetyPath}/question`, operation("ask", question))).body).toMatchObject({ data: question });
    expect((await f.call("foreman", safetyPath)).body).toMatchObject({ data: { questions: [question] } });
    expect((await f.call("worker", `${safetyPath}?versionId=v1`)).body).toMatchObject({ data: { state: "superseded", replacedBy: { id: "v2" } } });
    expect((await acknowledge("worker", "stale-v1", "v1", "proof-v1")).status).toBe(409);
    const resume = operation("resume", { id: "work-resume", bookedWindowId: "window" }, 2);
    expect((await f.call("foreman", workPath, resume)).status).toBe(409);
    expect((await f.call("foreman", livePath)).body).toMatchObject({ data: { workGate: { status: "held", blockedAssignments: ["assignment"] } } });
    expect((await teach("proof-v2", "v2")).status).toBe(200);
    expect((await acknowledge("worker", "wrong-proof", "v2", "proof-v1")).status).toBe(409);
    expect((await acknowledge("worker", "ack-v2", "v2", "proof-v2")).status).toBe(200);
    expect((await f.call("foreman", workPath, resume)).status).toBe(200);
    const beforeFinish = await f.sync("worker");
    expect((await f.call("foreman", "/visits/visit/finish-work", operation("finish", { id: "finish", bookedWindowId: "window" }, 3))).body)
      .toMatchObject({ data: { revision: 4, published: { kind: "finished" } } });
    expect((await f.sync("worker", beforeFinish.cursor)).removals).toContainEqual({ kind: "assignment_briefing", resourceId: "assignment" });
    const customer = customerLiveVisitSchema.parse((await f.call("customer", livePath)).body.data);
    expect(customer.live.status).toBe("finished");
    expect(customer.moments.find(({ kind }) => kind === "on_site")).toEqual({ id: "crew-on-site", kind: "on_site", occurredAt: start, recordedAt: start });
    expect(JSON.stringify(customer)).not.toMatch(/brief|private-checkin|restricted doorway|teachback/i);
  } finally { clock.mockRestore(); f.db.close(); }
});

test("photo stamps require a ready attachment with the exact visit scope", async () => {
  const f = await fixture();
  const clock = spyOn(Date, "now").mockReturnValue(now);
  try {
    await f.db.batch([
      f.db.prepare(`INSERT INTO media_stages VALUES
        ('mine', 'foreman-context', 'update', 'visit', ?, ?),
        ('wrong-visit', 'foreman-context', 'update', 'other-visit', ?, ?),
        ('wrong-context', 'worker-context', 'update', 'visit', ?, ?),
        ('progress', 'worker-context', 'progress', 'shift', ?, ?)`)
        .bind(start, end, start, end, start, end, start, end),
      f.db.prepare(`INSERT INTO attachments (id, stage_id, object_key, mime, bytes, state, etag, retention_class)
        VALUES ('ready', 'mine', 'private-object', 'image/jpeg', 1024, 'ready', 'etag', 'unlinked'),
          ('pending', 'mine', 'private-pending', 'image/jpeg', 1024, 'uploading', NULL, 'unlinked'),
          ('wrong-place', 'wrong-visit', 'private-other', 'image/jpeg', 1024, 'ready', 'etag', 'unlinked'),
          ('wrong-scope', 'wrong-context', 'private-context', 'image/jpeg', 1024, 'ready', 'etag', 'unlinked'),
          ('progress-photo', 'progress', 'private-progress', 'image/jpeg', 1024, 'ready', 'etag', 'progress')`),
      f.db.prepare(`INSERT INTO visit_activity_events
        (id, visit_id, assignment_id, actor_id, kind, at, captured_at, safe_detail, detail_language) VALUES
        ('progress-note', 'visit', 'assignment', 'worker', 'progress_photo', ?, ?, 'Private caption', 'es')`).bind(start, start),
      f.db.prepare("INSERT INTO shift_evidence VALUES ('shift', 'progress-photo', 'progress-note')"),
    ]);
    for (const attachmentId of ["pending", "wrong-place", "wrong-scope", "progress-photo"]) {
      expect((await f.call("foreman", updatePath, operation(`try-${attachmentId}`,
        { id: `update-${attachmentId}`, kind: "photo", attachmentId }, 0))).status).toBe(422);
    }
    const caption = { language: "es", text: "Surface prepared." };
    const saved = await f.call("foreman", updatePath,
      operation("share-ready", { id: "photo", kind: "photo", attachmentId: "ready", caption }, 0));
    expect(saved.body).toMatchObject({ data: { revision: 1, update: {
      kind: "photo", photo: { attachmentId: "ready", availability: "available" }, caption: { original: caption, reading: null },
    } } });
    expect((await f.call("foreman", updatePath, operation("share-progress",
      { id: "shared-progress", kind: "photo", attachmentId: "progress-photo", progressEventId: "progress-note" }, 1))).status).toBe(200);
    await f.db.prepare("UPDATE attachments SET state = 'expired' WHERE id = 'ready'").run();
    const customer = customerLiveVisitSchema.parse((await f.call("customer", livePath)).body.data);
    expect(customer.moments.filter(({ kind }) => kind === "photo").map(({ photo }) => photo)).toEqual([
      { attachmentId: "progress-photo", availability: "available" }, { attachmentId: "ready", availability: "unavailable" },
    ]);
    expect(JSON.stringify(customer)).not.toMatch(/private-object|private-progress|progress-note|Private caption|etag/);
  } finally { clock.mockRestore(); f.db.close(); }
});

test("sync only caches the named worker's current safety briefing and removes it on assignment dropout", async () => {
  const f = await fixture();
  const clock = spyOn(Date, "now").mockReturnValue(now);
  try {
    const arrivalPlan = "Use the unlocked side gate.";
    await f.db.prepare(`INSERT INTO visit_activity_events (id, visit_id, actor_id, kind, at, safe_detail, detail_language)
      VALUES ('arrival-plan', 'visit', 'foreman', 'arrival_plan_set', ?, ?, 'en')`).bind(start, arrivalPlan).run();
    const briefings = (page: SyncPage) => page.upserts.filter(({ kind }) => kind === "assignment_briefing");
    const briefing = (page: SyncPage) => cachedAssignmentBriefingSchema.parse(briefings(page).find(({ resourceId }) => resourceId === "assignment")?.value);
    const initial = await f.sync("worker");
    expect(briefing(initial)).toEqual({
      assignmentId: "assignment", siteZone: "Europe/Madrid", bookedWindow: { id: "window", startsAt: start, endsAt: end },
      hasActiveHold: false, instruction: null,
    });
    expect(briefings(await f.sync("candidate"))).toEqual([]);
    expect(briefings(await f.sync("customer"))).toEqual([]);
    expect(briefings(await f.sync("helper")).map(({ resourceId }) => resourceId)).toEqual(["second-assignment"]);
    expect((await f.call("worker", briefingPath)).body).toMatchObject({ data: { site: { address: "Private address",
      arrivalPlan: { original: { text: arrivalPlan } } } } });

    const original = { language: "es", text: "Peligro: polvo. Control: usa la mascarilla. Si falla, avisa al encargado." };
    const reviewedHumanReadingAid = { language: "en", text: "Dust hazard. Wear a mask. If it fails, alert the foreman." };
    const issue = (version: string, expectedVersionId: string | null) => f.call("foreman", `${safetyPath}/issue`,
      operation(`issue-${version}`, { id: version, assignmentId: "assignment", expectedVersionId, original,
        ...(expectedVersionId === null ? { reviewedHumanReadingAid } : {}) }));
    expect((await issue("v1", null)).status).toBe(200);
    const issued = await f.sync("worker", initial.cursor);
    expect(briefing(issued)).toEqual({
      assignmentId: "assignment", siteZone: "Europe/Madrid", bookedWindow: { id: "window", startsAt: start, endsAt: end },
      hasActiveHold: true, instruction: { instructionId: "instruction", state: "awaiting_teach_back", original, reviewedHumanReadingAid,
        version: { id: "v1", no: 1, issuedAt: now, issuedByName: "foreman name" } },
    });
    expect(JSON.stringify(briefings(issued))).not.toMatch(/Private address|Private arrival note|side gate|9876|latitude|longitude/);
    expect(briefing(await f.sync("worker"))).toEqual(briefing(issued));
    expect((await f.call("foreman", `${safetyPath}/teach-back`, operation("teach-v1", {
      id: "private-proof", versionId: "v1", language: "es", outcome: "passed", checklist: { hazard: true, control: true, response: true },
    }))).status).toBe(200);
    const taught = await f.sync("worker", issued.cursor);
    expect(briefing(taught)).toMatchObject({ hasActiveHold: true, instruction: { state: "awaiting_acknowledgement" } });
    expect(JSON.stringify(briefings(taught))).not.toContain("private-proof");
    expect((await f.call("worker", `${safetyPath}/acknowledge`, operation("ack-v1", { versionId: "v1", teachBackId: "private-proof" }))).status).toBe(200);
    const acknowledged = await f.sync("worker", taught.cursor);
    expect(briefing(acknowledged)).toMatchObject({ hasActiveHold: false, instruction: { state: "acknowledged" } });
    expect((await issue("v2", "v1")).status).toBe(200);
    const replaced = await f.sync("worker", acknowledged.cursor);
    expect(briefing(replaced)).toMatchObject({ hasActiveHold: true, instruction: { version: { id: "v2", no: 2 },
      state: "awaiting_teach_back", reviewedHumanReadingAid: null } });

    expect((await f.call("worker", "/assignments/assignment/dropout", operation("drop", { source: "self" }))).status).toBe(200);
    const afterDrop = await f.sync("worker", replaced.cursor);
    expect(briefings(afterDrop)).toEqual([]);
    expect(afterDrop.removals).toContainEqual({ kind: "assignment_briefing", resourceId: "assignment" });
    expect(briefings(await f.sync("worker"))).toEqual([]);
  } finally { clock.mockRestore(); f.db.close(); }
});
