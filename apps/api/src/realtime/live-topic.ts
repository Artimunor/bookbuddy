import { DurableObject } from "cloudflare:workers";
import { liveTopicName, parseLiveTopic } from "@bookbuddy/api-contract";
import type { LiveFrame } from "@bookbuddy/api-contract";
import type { Bindings } from "../bindings";
import { resolveSession } from "../modules/auth/session";
import { liveAccess } from "./access";

const leaseLengthMs = 5 * 60_000;
// All topics currently share one pilot object. Bound its open-socket pool
// before doing a D1 read; wider rollout still needs isolated topic shards.
export const liveSocketCap = 128;
const INVALIDATION = JSON.stringify({ kind: "invalidate" } satisfies LiveFrame);
const READY = JSON.stringify({ kind: "ready" } satisfies LiveFrame);
type LiveRow = { session_id: string; scope_id: string | null; expires_at: number; value: string | null };

const encoder = new TextEncoder();
// A tag can carry only 256 characters. Prefix the uncommon long-ID hash
// differently so a literal ID can never collide with the hashed namespace.
async function socketTag(kind: "topic" | "session", value: string): Promise<string> {
  const tag = `${kind}:${value}`;
  if (tag.length <= 256) return tag;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return `${kind}-hash:${btoa(String.fromCharCode(...digest))}`;
}

// Set only after the upgrade route has verified scope and obtained its catch-up page.
export interface LiveAttachment {
  readonly sessionId: string;
  readonly scopeId: string;
  readonly leaseUntil: number;
}

// The hibernation alarm tracks the earliest open lease, with no idle timer.
export class LiveTopic extends DurableObject<Bindings> {
  #alarmAt: number | null | undefined;

  async #scheduleAlarm(next: number | null, soonerOnly = false): Promise<void> {
    if (this.#alarmAt === undefined) this.#alarmAt = await this.ctx.storage.getAlarm();
    if (this.#alarmAt === next || (soonerOnly && next !== null && this.#alarmAt !== null && next >= this.#alarmAt)) return;
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
    this.#alarmAt = next;
  }

  async #reap(excluded?: WebSocket): Promise<void> {
    let next: number | null = null;
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === excluded || socket.readyState !== WebSocket.OPEN) continue;
      try {
        const lease = socket.deserializeAttachment() as LiveAttachment | null;
        if (!lease || !(lease.leaseUntil > now)) socket.close(1008);
        else if (next === null || lease.leaseUntil < next) next = lease.leaseUntil;
      } catch { /* The socket already disappeared. */ }
    }
    await this.#scheduleAlarm(next);
  }

  override async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      this.#alarmAt = null; // The alarm being delivered is no longer pending.
      await this.#reap();
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const topic = parseLiveTopic(new URL(request.url).searchParams.get("topic"));
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket" || !topic) {
      return new Response(null, { status: 404 });
    }
    const now = Date.now();
    const session = await resolveSession(request, null, now);
    if (!session) return new Response(null, { status: 401 });
    const topicTag = await socketTag("topic", liveTopicName(topic));

    // Do not let a concurrent revoke RPC pass between the scope read and attachment.
    return this.ctx.blockConcurrencyWhile(async () => {
      if (this.ctx.getWebSockets().length >= liveSocketCap) return new Response(null, { status: 503 });
      const { sql, params } = liveAccess(session, now, topic, this.env);
      const row = await this.env.DB.prepare(sql).bind(...params ?? []).first<LiveRow>();
      const leaseUntil = Math.min(row?.expires_at ?? 0, now + leaseLengthMs);
      if (!row || leaseUntil <= Date.now()) return new Response(null, { status: 401 });
      if (!row.scope_id || (topic.kind === "thread" && row.value === null)) return new Response(null, { status: 404 });

      const { 0: client, 1: socket } = new WebSocketPair();
      const attachment: LiveAttachment = { sessionId: row.session_id, scopeId: row.scope_id, leaseUntil };
      this.ctx.acceptWebSocket(socket, [topicTag, await socketTag("session", row.session_id)]);
      socket.serializeAttachment(attachment);
      try {
        await this.#scheduleAlarm(leaseUntil, true);
      } catch (error) {
        socket.close(1011);
        throw error;
      }
      if (leaseUntil <= Date.now()) {
        socket.close(1008);
        await this.#reap(socket);
        return new Response(null, { status: 401 });
      }
      socket.send(row.value ?? READY);
      return new Response(null, { status: 101, webSocket: client, headers: { "Cache-Control": "private, no-store" } });
    });
  }

  override webSocketMessage(socket: WebSocket): Promise<void> {
    socket.close(1008); // A subscription is never a client command channel.
    return this.ctx.blockConcurrencyWhile(() => this.#reap(socket));
  }

  override webSocketClose(socket: WebSocket): Promise<void> {
    return this.ctx.blockConcurrencyWhile(() => this.#reap(socket));
  }

  override webSocketError(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.OPEN) {
      try { socket.close(1011); } catch { /* The socket already disappeared. */ }
    }
    return this.ctx.blockConcurrencyWhile(() => this.#reap(socket));
  }

  async closeSession(sessionId: string): Promise<void> {
    let closed = false;
    for (const socket of this.ctx.getWebSockets(await socketTag("session", sessionId))) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try { socket.close(1008); closed = true; } catch { /* The socket already disappeared. */ }
    }
    if (closed) await this.ctx.blockConcurrencyWhile(() => this.#reap());
  }

  async publishInvalidation(topicName: string, revokedScopeIds: readonly string[] = []): Promise<void> {
    const tag = await socketTag("topic", topicName);
    const now = Date.now();
    let closed = false;
    for (const socket of this.ctx.getWebSockets(tag)) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      // A hibernated socket can disappear while being woken; isolate each delivery.
      try {
        const lease = socket.deserializeAttachment() as LiveAttachment | null;
        if (!lease || !(lease.leaseUntil > now) || revokedScopeIds.includes(lease.scopeId)) {
          socket.close(1008);
          closed = true;
        } else socket.send(INVALIDATION);
      } catch {
        // Transport can disappear during fan-out; one socket never blocks the others.
      }
    }
    if (closed) await this.ctx.blockConcurrencyWhile(() => this.#reap());
  }
}
