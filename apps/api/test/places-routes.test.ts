import { expect, spyOn, test } from "bun:test";
import {
  acceptInvitationRoute, archivePlaceRoute, getPlaceRoute, invitePlacePersonRoute, listPlacesRoute, openLinkRoute,
  operationIdHeader, reissueInvitationRoute, resultSchema, transferPlaceRoute,
} from "@bookbuddy/api-contract";
import type { ResponseSchema } from "@bookbuddy/api-contract";
import { INVITATION_POLICY } from "@bookbuddy/domain";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { invitationMailEffect } from "../src/modules/access/mail";
import { loadDeliveryKey, loadOtpKey, mailboxKey, randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential } from "../src/modules/auth/session";
import { createTestD1 } from "./d1";

const origin = "https://bookbuddy.test", lookup = "places-test-only-mailbox-lookup-key", delivery = "A".repeat(43);
const start = 1_800_000_000_000;
const candidate = { longitude: -8, latitude: 38 };
const notFound = { error: { code: "NOT_FOUND" } };
const placeEdit = { alias: "Casa Azul", address: "12  Praça\u00a0 do  Mar", safeArrivalNote: "Meet at the side gate" };

async function fixture() {
  const db = await createTestD1(), app = createApp(), key = (await loadOtpKey(lookup))!;
  const wakes: string[][] = [];
  const env = { DB: db, OTP_HMAC_KEY: lookup, EFFECTS_ENCRYPTION_KEY: delivery, PUBLIC_APP_ORIGIN: origin,
    SYNC_CURSOR_HMAC_KEY: lookup, EFFECTS: { async send(wake: { workKeys: string[] }) { wakes.push(wake.workKeys); } },
  } as unknown as Bindings;
  const execution = { waitUntil() {}, passThroughOnException() {} };

  async function account(id: string) {
    const email = `${id}@example.test`, credential = randomToken();
    const [digest, hash] = await Promise.all([mailboxKey(key, email), hashSessionCredential(credential)]);
    await db.batch([
      db.prepare(`INSERT INTO accounts (id, email_normalized, email_key, display_name, verified_at, setup_at, state)
        VALUES (?, ?, ?, ?, 1, 1, 'active')`).bind(id, email, digest, id),
      db.prepare("INSERT INTO account_contexts (id, account_id, role) VALUES (?, ?, 'customer')").bind(`${id}-context`, id),
      db.prepare(`INSERT INTO sessions (id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
        VALUES (?, ?, ?, ?, 'device', 1, ?)`).bind(`${id}-session`, id, hash, `${id}-context`, start + INVITATION_POLICY.reissueWindowMs * 3),
    ]);
    return credential;
  }

  const owner = await account("owner"), outside = await account("outside");
  await account("ops");
  await db.batch([
    db.prepare(`INSERT INTO operating_areas VALUES ('area', 'Atlantic', 'Europe/Lisbon',
      '[[[-10,36],[-6,36],[-6,40],[-10,40],[-10,36]],[[-9,37],[-8.5,37],[-8.5,37.5],[-9,37.5],[-9,37]]]')`),
    db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
      VALUES ('business', 'Builder', 'Builder', 'work@example.test', 'area', 'approved')`),
  ]);

  async function request(path: string, credential: string, options: {
    op?: string; revision?: number; payload?: unknown; method?: string; zeroCalls?: boolean;
  } = {}) {
    const { op, revision, payload = {}, method = op ? "POST" : "GET", zeroCalls = false } = options;
    const { batch, query } = db.calls;
    const response = await app.request(`${origin}/api/v1${path}`, {
      method, headers: { Authorization: `Bearer ${credential}`, ...(op ? { [operationIdHeader]: op, "Content-Type": "application/json" } : {}) },
      body: op ? JSON.stringify(path === "/sync" ? payload : { operationId: op, expectedRevision: revision, payload }) : undefined,
    }, env, execution);
    expect(db.calls.batch - batch).toBe(zeroCalls ? 0 : 1);
    expect(db.calls.query - query).toBe(0);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    return { status: response.status, body: await response.json() as unknown };
  }

  const verify = (place: string, accountId: string, kind: string) => db.prepare(`INSERT INTO authority_verifications
    (id, place_id, subject_account_id, kind, verified_by, verified_at) VALUES (?, ?, ?, ?, 'ops', ?)`)
    .bind(`${accountId}-${kind}-${Date.now()}`, place, accountId, kind, Date.now()).run();
  const create = async () => data(getPlaceRoute.output, await request("/places", owner, { op: "create", payload: placeEdit }));
  const activate = async (place: { id: string; revision: number }) => {
    await verify(place.id, "owner", "place_owner");
    return data(getPlaceRoute.output, await request(`/places/${place.id}/verify-pin`, owner,
      { op: "pin", revision: place.revision, payload: { pin: candidate } }));
  };
  const issue = (place: { id: string; revision: number }, email: string, op: string) =>
    request(`/places/${place.id}/invite`, owner, { op, revision: place.revision, payload: { email } });
  const epoch = (accountId: string) => db.prepare("SELECT visibility_epoch FROM sync_scope_state WHERE context_id = ?")
    .bind(`${accountId}-context`).first<number>("visibility_epoch");

  async function lastMailToken() {
    const effect = (await db.prepare("SELECT id, kind, resource_ref FROM effect_outbox WHERE id = ?").bind(wakes.at(-1)?.[0]).first<{
      id: string; kind: string; resource_ref: string;
    }>())!;
    const message = await invitationMailEffect.prepareMail((await loadDeliveryKey(delivery))!, effect);
    return new URL(message!.text.split(" ").at(-1)!).pathname.split("/").at(-1)!;
  }
  return { db, owner, outside, account, request, verify, create, activate, issue, epoch, lastMailToken, wakes };
}

function data<T extends ResponseSchema>(schema: T, response: { status: number; body: unknown }) {
  const parsed = resultSchema(schema).parse(response.body);
  if (!parsed.ok) throw new Error(`${response.status}: ${parsed.error.code}`);
  return parsed.data;
}

test("create, scoped address search, normalization, patch, and local pin verification use one batch", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    const created = await f.create(), path = `/places/${created.id}`;
    expect(created).toMatchObject({ address: "12 Praça do Mar", state: "pending_verification", revision: 0,
      viewerIsNamedApprover: true, pendingInvitations: null });
    expect((await f.create()).id).toBe(created.id);
    const matches = data(listPlacesRoute.output, await f.request("/places?q=Pra%C3%A7a", f.owner));
    expect(matches).toMatchObject({ total: 1, places: [{ id: created.id }] });
    expect(matches.places[0]).not.toHaveProperty("address");
    expect(data(listPlacesRoute.output, await f.request("/places?q=Pra%C3%A7a", f.outside)).total).toBe(0);
    expect((await f.request(path, f.outside)).body).toMatchObject(notFound);
    expect((await f.request(path, f.outside, { op: "outsider", revision: 0, payload: { alias: "Other" }, method: "PATCH" })).body)
      .toMatchObject(notFound);
    const alias = "Main house";
    expect(data(getPlaceRoute.output, await f.request(path, f.owner, { op: "rename", revision: 0,
      method: "PATCH", payload: { alias, safeArrivalNote: null } }))).toMatchObject({ alias, safeArrivalNote: null, revision: 1 });
    const secret = await f.request(path, f.owner, { op: "secret", revision: 1, method: "PATCH", zeroCalls: true,
      payload: { safeArrivalNote: "Alarm code: １２３４" } });
    expect(secret.body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    expect(JSON.stringify(secret.body)).not.toContain("１２３４");
    await f.verify(created.id, "owner", "place_owner");
    const hole = data(getPlaceRoute.output, await f.request(`${path}/verify-pin`, f.owner,
      { op: "hole", revision: 1, payload: { pin: { longitude: -8.8, latitude: 37.2 } } }));
    expect(hole).toMatchObject({ state: "pending_verification", areaName: null, siteZone: null });
    const inside = data(getPlaceRoute.output, await f.request(`${path}/verify-pin`, f.owner,
      { op: "inside", revision: hole.revision, payload: { pin: candidate } }));
    expect(inside).toMatchObject({ state: "in_area", areaName: "Atlantic", siteZone: "Europe/Lisbon", pin: candidate });
    const moved = data(getPlaceRoute.output, await f.request(path, f.owner, { op: "move", revision: inside.revision,
      method: "PATCH", payload: { address: "18 Praça do Mar" } }));
    expect(moved).toMatchObject({ state: "pending_verification", pin: null, actions: { invite: false, transfer: false } });
    const reused = data(getPlaceRoute.output, await f.request(`${path}/verify-pin`, f.owner,
      { op: "stale-proof", revision: moved.revision, payload: { pin: candidate } }));
    expect(reused.state).toBe("pending_verification");
    clock.mockReturnValue(start + 1);
    await f.verify(created.id, "owner", "place_owner");
    expect(data(getPlaceRoute.output, await f.request(`${path}/verify-pin`, f.owner,
      { op: "verified-move", revision: reused.revision, payload: { pin: candidate } })).state).toBe("in_area");
    const sync = await f.request("/sync", f.owner, { op: "sync", payload: { contextId: "owner-context", cursor: null, operations: [] } });
    expect(sync.body).toMatchObject({ data: { upserts: [{ kind: "place", value: { id: created.id, alias, state: "in_area" } }] } });
    expect(JSON.stringify(sync.body)).not.toContain("Praça");
  } finally { f.db.close(); clock.mockRestore(); }
});

test("independently verified approver replaces the current grant atomically; losing revision has no receipt", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    const person = await f.account("approver");
    const active = await f.activate(await f.create()), path = `/places/${active.id}/change-approver`;
    const invite = data(invitePlacePersonRoute.output, await f.issue(active, "approver@example.test", "invite"));
    await f.request(`/invitations/${invite.id}/accept`, person, { op: "accept" });
    const change = { op: "change", revision: active.revision, payload: { successorAccountId: "approver" } };
    expect((await f.request(path, f.owner, change)).status).toBe(409);
    await f.verify(active.id, "approver", "place_approver");
    const before = [await f.epoch("owner"), await f.epoch("approver")];
    expect(data(getPlaceRoute.output, await f.request(path, f.owner, change))).toMatchObject({
      revision: active.revision + 1, namedApproverDisplayName: "approver", viewerIsNamedApprover: false,
    });
    const grants = await f.db.prepare("SELECT account_id FROM place_grants WHERE place_id = ? AND capability = 'approve' AND revoked_at IS NULL")
      .bind(active.id).all();
    expect(grants.results).toEqual([{ account_id: "approver" }]);
    expect([await f.epoch("owner"), await f.epoch("approver")]).toEqual(before.map((epoch) => epoch! + 1));
    expect((await f.request(path, f.owner, { ...change, op: "stale" })).body).toMatchObject({ error: { code: "STALE_REVISION" } });
    expect(await f.db.prepare("SELECT count(*) AS n FROM operation_receipts WHERE operation_id = 'stale'").first("n")).toBe(0);
  } finally { f.db.close(); clock.mockRestore(); }
});

test("place invite caps, safe link opening, and reissue timing use the live recipient and slots", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    const active = await f.activate(await f.create());
    const invite = data(invitePlacePersonRoute.output, await f.issue(active, "one@example.test", "one"));
    expect(invite.expiresAt - invite.issuedAt).toBe(INVITATION_POLICY.validityMs);
    expect(invite.capabilities).toEqual(["view"]);
    const token = await f.lastMailToken();
    const one = await f.account("one");
    const link = `/links/${token}`;
    expect(data(openLinkRoute.output, await f.request(link, f.outside))).toMatchObject({ kind: "unavailable" });
    expect(data(openLinkRoute.output, await f.request(link, one))).toMatchObject({ kind: "invitation", invitation: { status: "pending" } });
    expect((await f.issue(active, "one@example.test", "duplicate")).status).toBe(409);
    for (const n of [2, 3, 4, 5]) expect((await f.issue(active, `person${n}@example.test`, `invite-${n}`)).status).toBe(200);
    expect((await f.issue(active, "six@example.test", "overflow")).status).toBe(409);
    expect(f.wakes).toHaveLength(5);
    const cooldown = INVITATION_POLICY.placeReissueCooldownMs;
    expect((await f.request(`/invitations/${invite.id}/reissue`, f.owner, { op: "early" })).body)
      .toMatchObject({ error: { code: "RATE_LIMITED", retryAt: start + cooldown } });
    clock.mockReturnValue(start + cooldown);
    const first = data(reissueInvitationRoute.output, await f.request(`/invitations/${invite.id}/reissue`, f.owner, { op: "first" }));
    clock.mockReturnValue(start + 2 * cooldown);
    const second = data(reissueInvitationRoute.output, await f.request(`/invitations/${first.id}/reissue`, f.owner, { op: "second" }));
    clock.mockReturnValue(start + 3 * cooldown);
    expect((await f.request(`/invitations/${second.id}/reissue`, f.owner, { op: "third" })).body)
      .toMatchObject({ error: { code: "RATE_LIMITED", retryAt: first.issuedAt + INVITATION_POLICY.reissueWindowMs } });
    expect(f.wakes).toHaveLength(7);
    const accepted = data(acceptInvitationRoute.output, await f.request(`/invitations/${second.id}/accept`, one, { op: "accept" }));
    expect(accepted.currentAccess).toMatchObject({ capabilities: ["view"], historyFrom: start + 3 * cooldown });
    expect(await f.epoch("one")).toBe(1);
    expect((await f.issue(active, "six@example.test", "space-now")).status).toBe(200);
  } finally { f.db.close(); clock.mockRestore(); }
});

test("a transfer stays pending until the verified named successor accepts from the bound mailbox; archive guards bookings", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(start);
  const f = await fixture();
  try {
    const successor = await f.account("successor");
    const active = await f.activate(await f.create()), path = `/places/${active.id}`;
    const transfer = { op: "transfer", revision: active.revision, payload: { successorAccountId: "successor" } };
    expect((await f.request(`${path}/transfer`, f.owner, transfer)).status).toBe(409);
    await f.verify(active.id, "successor", "place_transfer");
    const invite = data(transferPlaceRoute.output, await f.request(`${path}/transfer`, f.owner, transfer));
    const token = await f.db.prepare("SELECT link_token FROM notifications WHERE context_id = 'successor-context' AND id = ?")
      .bind(invite.id).first<string>("link_token");
    expect(token).toBeTruthy();
    expect(f.wakes).toHaveLength(0);
    expect(data(openLinkRoute.output, await f.request(`/links/${token}`, f.outside))).toMatchObject({ kind: "unavailable" });
    expect(data(openLinkRoute.output, await f.request(`/links/${token}`, successor))).toMatchObject({ kind: "invitation", invitation: { status: "pending" } });
    expect(await f.db.prepare("SELECT owner_id FROM places WHERE id = ?").bind(active.id).first("owner_id")).toBe("owner");
    expect((await f.request(`/invitations/${invite.id}/accept`, f.outside, { op: "bad-accept" })).body).toMatchObject(notFound);
    const oldMailbox = await f.db.prepare("SELECT email_key FROM accounts WHERE id = 'successor'").first<string>("email_key");
    await f.db.prepare("UPDATE accounts SET email_key = 'new-mailbox-key' WHERE id = 'successor'").run();
    expect((await f.request(`/invitations/${invite.id}/accept`, successor, { op: "wrong-mailbox" })).body).toMatchObject(notFound);
    await f.db.prepare("UPDATE accounts SET email_key = ? WHERE id = 'successor'").bind(oldMailbox).run();
    const result = data(acceptInvitationRoute.output, await f.request(`/invitations/${invite.id}/accept`, successor, { op: "accept" }));
    expect(result.currentAccess).toMatchObject({ kind: "place", isOwner: true });
    expect((await f.request(path, f.owner)).body).toMatchObject(notFound);
    const owned = data(getPlaceRoute.output, await f.request(path, successor));
    expect(owned).toMatchObject({ viewerIsNamedApprover: true, revision: active.revision + 1 });
    expect(await f.db.prepare("SELECT op FROM sync_changes WHERE partition_key = 'owner-context' ORDER BY seq DESC LIMIT 1").first("op")).toBe("remove");
    await f.db.batch([
      f.db.prepare(`INSERT INTO jobs (id, reference, business_id, place_id, requester_id, origin, state)
        VALUES ('job', 'BB-1000', 'business', ?, 'successor', 'bookbuddy', 'open')`).bind(active.id),
      f.db.prepare("INSERT INTO visits (id, job_id, kind, state) VALUES ('visit', 'job', 'work', 'booked')"),
    ]);
    const archive = { op: "archive", revision: owned.revision };
    expect((await f.request(`${path}/archive`, successor, archive)).status).toBe(409);
    await f.db.prepare("UPDATE visits SET state = 'finished' WHERE id = 'visit'").run();
    const done = data(archivePlaceRoute.output, await f.request(`${path}/archive`, successor, archive));
    expect(done).toMatchObject({ state: "archived", revision: owned.revision + 1, archivedAt: start });
    expect(data(archivePlaceRoute.output, await f.request(`${path}/archive`, successor, archive))).toEqual(done);
    expect(data(listPlacesRoute.output, await f.request("/places", successor)).total).toBe(0);
  } finally { f.db.close(); clock.mockRestore(); }
});
