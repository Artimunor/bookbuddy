import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { operationIdHeader, parseLiveFrame } from "@bookbuddy/api-contract";
import { createApp } from "../src/app";
import type { Bindings } from "../src/bindings";
import { randomToken } from "../src/modules/auth/crypto";
import { hashSessionCredential, sessionCookieName } from "../src/modules/auth/session";
import type { LiveAttachment } from "../src/realtime/live-topic";
import { createTestD1 } from "./d1";

// Bun supplies SQLite but not the Workers socket upgrade/hibernation primitives.
// Exercise the real Worker route, DO class and SQL against transport-shaped fakes.
mock.module("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(protected readonly ctx: DurableObjectState, protected readonly env: Bindings) {}
  },
}));
// Load the Workers-only class after its Bun module replacement is registered.
const { LiveTopic } = await import("../src/realtime/live-topic");

class TestSocket {
  readyState = WebSocket.OPEN;
  attachment: LiveAttachment | null = null;
  tags: readonly string[] = [];
  readonly messages: string[] = [];
  readonly closeCodes: number[] = [];
  serializeAttachment(value: LiveAttachment) { this.attachment = structuredClone(value); }
  deserializeAttachment() { return structuredClone(this.attachment); }
  send(frame: string) { this.messages.push(frame); }
  close(code: number) { this.closeCodes.push(code); this.readyState = WebSocket.CLOSED; }
}
const NativeResponse = Response;
class UpgradeResponse extends NativeResponse {
  readonly webSocket: WebSocket | null;
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body, init?.status === 101 ? { ...init, status: 200 } : init);
    if (init?.status === 101) Object.defineProperty(this, "status", { value: 101 });
    this.webSocket = init?.webSocket ?? null;
  }
}
const pairDescriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocketPair");
beforeEach(() => {
  globalThis.Response = UpgradeResponse as typeof Response;
  Object.defineProperty(globalThis, "WebSocketPair", { configurable: true, value: class {
    0 = new TestSocket();
    1 = new TestSocket();
  } });
});
afterEach(() => {
  globalThis.Response = NativeResponse;
  if (pairDescriptor) Object.defineProperty(globalThis, "WebSocketPair", pairDescriptor);
  else Reflect.deleteProperty(globalThis, "WebSocketPair");
});

const origin = "https://bookbuddy.test";
const people = ["customer", "outside", "foreman", "admin", "worker"] as const;
type Person = typeof people[number];
const secret = "a private original message";

async function fixture() {
  const db = await createTestD1();
  const app = createApp().onError((error) => { throw error; });
  const now = Date.now();
  const wakes: Promise<unknown>[] = [];
  const calls = { upgrade: 0, publish: 0, fanout: 0, queue: 0 };
  const closedSessions: string[] = [];
  const objects = new Map<string, { topic: InstanceType<typeof LiveTopic>; sockets: TestSocket[] }>();
  const env = {
    DB: db,
    LIVE: { getByName(name: string) {
      let object = objects.get(name);
      if (!object) {
        const sockets: TestSocket[] = [];
        const state = {
          acceptWebSocket(socket: TestSocket, tags: readonly string[]) { socket.tags = tags; sockets.push(socket); },
          getWebSockets(tag: string) { calls.fanout++; return sockets.filter((socket) => socket.tags.includes(tag)); },
          blockConcurrencyWhile<T>(run: () => Promise<T>) { return run(); },
        } as unknown as DurableObjectState;
        object = { topic: new LiveTopic(state, env), sockets };
        objects.set(name, object);
      }
      const { topic } = object;
      return {
        fetch(request: Request) { calls.upgrade++; return topic.fetch(request); },
        async publishInvalidation(name: string, revokedScopeIds?: readonly string[]) {
          calls.publish++;
          await topic.publishInvalidation(name, revokedScopeIds);
        },
        async closeSession(sessionId: string) { closedSessions.push(sessionId); await topic.closeSession(sessionId); },
      };
    } },
    EFFECTS: { async send() { calls.queue++; } },
  } as unknown as Bindings;
  const ctx = { waitUntil(task: Promise<unknown>) { wakes.push(task); }, passThroughOnException() {} };
  const credentials = new Map<Person, string>();
  try {
    await db.batch([
      db.prepare("INSERT INTO operating_areas(id,name,site_zone,polygon) VALUES ('area','Area','Europe/Lisbon','[0]')"),
      db.prepare(`INSERT INTO businesses(id,legal_name,public_name,verified_work_contact,catchment_id,state)
        VALUES ('provider','Provider Ltd','Provider','work@example.test','area','approved')`),
      ...people.map((person) => db.prepare(`INSERT INTO accounts (id,email_normalized,display_name,verified_at,setup_at,state)
        VALUES (?,?,?,1,1,'active')`).bind(person, `${person}@example.test`, person)),
      ...([ ["foreman", "foreman"], ["admin", "provider_admin"], ["worker", "worker"] ] as const).flatMap(([person, role]) => [
        db.prepare("INSERT INTO memberships VALUES (?,'provider',?,'active')").bind(`${person}-member`, person),
        db.prepare(`INSERT INTO membership_roles (id,membership_id,business_id,account_id,role,granted_at)
          VALUES (?,?,'provider',?,?,1)`).bind(`${person}-role`, `${person}-member`, person, role),
        db.prepare("INSERT INTO account_contexts VALUES (?,?,?,'provider',?)").bind(`${person}-scope`, person, role, `${person}-role`),
      ]),
      db.prepare(`INSERT INTO business_grants (id,business_id,membership_id,capability,issuer_id,valid_from)
        VALUES ('manage','provider','admin-member','membership_admin','admin',1)`),
      db.prepare(`INSERT INTO account_contexts (id,account_id,role)
        VALUES ('customer-scope','customer','customer'),('outside-scope','outside','customer')`),
      ...await Promise.all(people.map(async (person) => {
        const token = randomToken();
        credentials.set(person, token);
        return db.prepare(`INSERT INTO sessions (id,account_id,secret_hash,active_context_id,device_id,issued_at,expires_at)
          VALUES (?,?,?,?,'device',1,?)`).bind(`${person}-session`, person, await hashSessionCredential(token), `${person}-scope`, now + 3_600_000);
      })),
      db.prepare(`INSERT INTO places (id,owner_id,alias,normalized_address,state)
        VALUES ('place','customer','Private site','Private address','pending_verification')`),
      db.prepare(`INSERT INTO place_people (place_id,account_id,verified_from,history_from) VALUES ('place','customer',1,1)`),
      db.prepare(`UPDATE places SET state='in_area',area_id='area',site_zone='Europe/Lisbon',named_approver_id='customer',
        pin='{"latitude":1,"longitude":2}' WHERE id='place'`),
      db.prepare(`INSERT INTO place_grants (id,place_id,account_id,capability,issuer_id,valid_from)
        VALUES ('message','place','customer','message','customer',1)`),
      db.prepare(`INSERT INTO jobs (id,reference,business_id,place_id,requester_id,accountable_foreman_membership_id,trade,origin,state)
        VALUES ('job','BB-TEST','provider','place','customer','foreman-member','carpentry','bookbuddy','open')`),
      db.prepare("INSERT INTO visits (id,job_id,kind,state) VALUES ('visit','job','work','booked')"),
      db.prepare(`INSERT INTO visit_windows (id,visit_id,starts_at,ends_at,expires_at,provider_authorized,proposed_at,proposed_by,
        confirmed_at,confirmed_by,state) VALUES ('window','visit',?,?,?,1,1,'foreman',2,'customer','confirmed')`)
        .bind(now - 60_000, now + 60_000, now - 120_000),
      db.prepare(`INSERT INTO chat_threads (id,job_id,audience,write_state,last_position)
        VALUES ('thread','job','job','open',18),('crew','job','crew','open',0)`),
      db.prepare(`INSERT INTO chat_members VALUES ('thread','customer-scope',1,1,NULL),('thread','foreman-scope',1,1,NULL)`),
      ...Array.from({ length: 18 }, (_, index) => {
        const position = index + 1, id = `message-${position}`;
        return [db.prepare("INSERT INTO chat_messages VALUES (?,'thread','foreman-scope')").bind(id),
          db.prepare(`INSERT INTO chat_entries (id,root_id,thread_id,revision,position,source_language,original_text,received_at)
            VALUES (?,?,'thread',1,?,'en',?,?)`).bind(id, id, position, secret, now - 1000)];
      }).flat(),
    ]);
  } catch (error) { db.close(); throw error; }

  async function open(topic: string, person?: Person, mode: "bearer" | "cookie" | "untrusted" = "bearer",
    expectedReads = 1, extra?: HeadersInit) {
    const before = { ...db.calls };
    const previousCalls = { ...calls };
    const headers = new Headers(extra);
    headers.set("Upgrade", "websocket");
    if (person && mode === "bearer") headers.set("Authorization", `Bearer ${credentials.get(person)}`);
    if (person && mode !== "bearer") {
      headers.set("Cookie", `${sessionCookieName}=${credentials.get(person)}`);
      headers.set("Origin", mode === "cookie" ? origin : "https://other.test");
    }
    const response = await app.request(`${origin}/api/v1/live?topic=${encodeURIComponent(topic)}`, { headers }, env, ctx);
    expect(db.calls.query - before.query).toBe(expectedReads);
    expect(db.calls.prepare - before.prepare).toBe(expectedReads);
    expect(db.calls.batch).toBe(before.batch);
    expect(calls.upgrade - previousCalls.upgrade).toBe(expectedReads);
    expect(calls.fanout).toBe(previousCalls.fanout);
    expect(calls.queue).toBe(previousCalls.queue);
    expect(calls.publish).toBe(previousCalls.publish);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    return { response, socket: response.status === 101 ? objects.values().next().value?.sockets.at(-1) : undefined };
  }
  async function command(person: Person, path: string, body: unknown, operationId?: string) {
    const before = { ...db.calls };
    const response = await app.request(`${origin}/api/v1${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credentials.get(person)}`,
        ...(operationId ? { [operationIdHeader]: operationId } : {}) }, body: JSON.stringify(body),
    }, env, ctx);
    expect(db.calls.batch - before.batch).toBe(1);
    expect(db.calls.query).toBe(before.query);
    return response;
  }
  return { db, calls, objects, wakes, open, command, closedSessions };
}

test("live authenticates cookie and bearer, rejects unauthorized topics and never exposes a different scope", async () => {
  const f = await fixture();
  try {
    expect((await f.open("thread:thread", undefined, "bearer", 0)).response.status).toBe(401);
    expect((await f.open("thread:thread", "customer", "untrusted", 0)).response.status).toBe(401);
    expect((await f.open("thread:not/a/topic", "customer", "bearer", 0)).response.status).toBe(404);
    for (const [topic, person] of [["thread:thread", "outside"], ["thread:crew", "customer"], ["scope-inbox:outside-scope", "customer"],
      ["provider-job:job", "customer"], ["provider-crew:provider", "customer"], ["customer-visit:visit", "outside"]] as const) {
      const { response } = await f.open(topic, person);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    }
    for (const [topic, person] of [["customer-visit:visit", "customer"], ["provider-job:job", "foreman"],
      ["provider-crew:provider", "admin"], ["scope-inbox:customer-scope", "customer"]] as const) {
      const { response, socket } = await f.open(topic, person, "cookie");
      expect(response.status).toBe(101);
      expect(socket?.messages.map(parseLiveFrame)).toEqual([{ kind: "ready" }]);
    }
  } finally { f.db.close(); }
});

test("cold thread catch-up is bounded and later committed hints reveal no projection data", async () => {
  const f = await fixture();
  try {
    const { response, socket } = await f.open("thread:thread", "customer", "cookie");
    expect(response.status).toBe(101);
    expect(socket).toBeDefined();
    expect(socket!.messages).toHaveLength(1);
    expect(socket!.attachment).toEqual({ sessionId: "customer-session", scopeId: "customer-scope", leaseUntil: expect.any(Number) });
    const initial = parseLiveFrame(socket!.messages[0]);
    expect(initial).toMatchObject({ kind: "thread_catch_up", details: { id: "thread" }, page: { threadId: "thread",
      page: { hasMore: true, cursor: "before~3" } } });
    if (initial?.kind !== "thread_catch_up") throw new Error("No authorized thread catch-up");
    expect(initial.page.entries).toHaveLength(16);
    expect(initial.page.entries[0]?.originalText).toBe(secret);
    expect(initial.page.entries.some(({ id }) => id === "message-1")).toBe(false);

    const operations = ["append-one", "append-two"].map((id) => ({ operationId: `${id}-op`, payload: { id,
      originalText: secret, sourceLanguage: "en" } }));
    const append = () => f.command("foreman", "/threads/thread/entries", { operations });
    expect((await append()).status).toBe(200);
    expect(f.wakes).toHaveLength(1);
    await Promise.all(f.wakes.splice(0));
    expect(f.calls).toEqual({ upgrade: 1, publish: 1, fanout: 1, queue: 0 });
    expect(socket!.messages.slice(1)).toEqual(['{"kind":"invalidate"}']);
    expect((await append()).status).toBe(200);
    expect(f.wakes).toHaveLength(0);
    expect(f.calls.publish).toBe(1);
    f.objects.values().next().value!.sockets.length = 0;
    expect((await f.command("foreman", "/threads/thread/entries", { operations: [{
      operationId: "idle-append-op", payload: { id: "idle-append", originalText: secret, sourceLanguage: "en" },
    }] })).status).toBe(200);
    expect(f.wakes).toHaveLength(1);
    await Promise.all(f.wakes.splice(0));
    expect(f.calls).toEqual({ upgrade: 1, publish: 2, fanout: 2, queue: 0 });
  } finally { f.db.close(); }
});

test("committed scope revoke closes the attached socket without another read; expiry also closes before fan-out", async () => {
  const f = await fixture();
  try {
    const { socket: revoked } = await f.open("scope-inbox:worker-scope", "worker");
    const { socket: current } = await f.open("thread:thread", "customer");
    const { socket: expired } = await f.open("thread:thread", "foreman");
    const thread = f.objects.values().next().value!;
    expired!.attachment = { ...expired!.attachment!, leaseUntil: Date.now() - 1 };
    const before = { ...f.db.calls };
    const response = await f.command("admin", "/members/worker-member/revoke", {
      operationId: "revoke-worker", payload: { roleGrantId: "worker-role" },
    }, "revoke-worker");
    expect(response.status).toBe(200);
    expect(f.wakes).toHaveLength(1);
    await Promise.all(f.wakes.splice(0));
    expect(f.calls.publish).toBe(1);
    expect(revoked?.closeCodes).toEqual([1008]);
    expect(revoked?.messages).toEqual(['{"kind":"ready"}']);
    await thread.topic.publishInvalidation("thread:thread");
    expect(expired?.closeCodes).toEqual([1008]);
    expect(expired?.messages).toHaveLength(1);
    expect(current?.messages.at(-1)).toBe('{"kind":"invalidate"}');
    expect(f.db.calls.batch - before.batch).toBe(1);
    expect(f.db.calls.query).toBe(before.query);
    expect(f.calls.fanout).toBe(2);
    expect(f.calls.queue).toBe(0);
    expect((await f.open("scope-inbox:worker-scope", "worker")).response.status).toBe(404);
  } finally { f.db.close(); }
});

test("live ingress rejects malformed credentials without routing arbitrary topics", async () => {
  const f = await fixture();
  try {
    const token = randomToken();
    const malformed: HeadersInit[] = [
      { Authorization: "Basic ignored" }, { Authorization: "Bearer malformed" },
      { Cookie: "unrelated=value", Origin: origin },
      { Cookie: `${sessionCookieName}=malformed`, Origin: origin },
      { Cookie: `${sessionCookieName}=${token}; ${sessionCookieName}=${token}`, Origin: origin },
    ];
    for (const headers of malformed) {
      expect((await f.open("thread:another", undefined, "bearer", 0, headers)).response.status).toBe(401);
    }
    expect(f.objects.size).toBe(0);
    for (const topic of ["thread:another", "provider-job:different"]) {
      expect((await f.open(topic, undefined, "bearer", 1, { Authorization: `Bearer ${token}` })).response.status).toBe(401);
    }
    expect(f.objects.size).toBe(1);
  } finally { f.db.close(); }
});

test("committed session end closes all of that session's sockets but preserves a second session in the same scope", async () => {
  const f = await fixture();
  try {
    const otherToken = randomToken();
    await f.db.prepare(`INSERT INTO sessions (id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
      SELECT 'second-session', account_id, ?, active_context_id, 'other-device', issued_at, expires_at
      FROM sessions WHERE id = 'customer-session'`).bind(await hashSessionCredential(otherToken)).run();
    const { socket: first } = await f.open("thread:thread", "customer");
    const { socket: secondTopic } = await f.open("scope-inbox:customer-scope", "customer");
    const { socket: other } = await f.open("thread:thread", undefined, "bearer", 1, { Authorization: `Bearer ${otherToken}` });
    const { socket: otherTopic } = await f.open("customer-visit:visit", undefined, "bearer", 1, { Authorization: `Bearer ${otherToken}` });
    expect(f.objects.size).toBe(1);
    const response = await f.command("customer", "/session/end", undefined);
    expect(response.status).toBe(200);
    expect(f.closedSessions).toEqual(["customer-session"]);
    expect(first?.closeCodes).toEqual([1008]);
    expect(secondTopic?.closeCodes).toEqual([1008]);
    expect(other?.closeCodes).toEqual([]);
    expect(otherTopic?.closeCodes).toEqual([]);
    const hub = f.objects.values().next().value!.topic;
    await hub.publishInvalidation("thread:thread");
    expect(first?.messages).toHaveLength(1);
    expect(other?.messages.at(-1)).toBe('{"kind":"invalidate"}');
    expect(otherTopic?.messages).toEqual(['{"kind":"ready"}']);
    expect((await f.open("thread:thread", "customer")).response.status).toBe(401);
  } finally { f.db.close(); }
});
