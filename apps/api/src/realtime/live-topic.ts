import { DurableObject } from "cloudflare:workers";
import { parseLiveTopic } from "@bookbuddy/api-contract";
import type { LiveFrame } from "@bookbuddy/api-contract";
import type { Bindings } from "../bindings";
import { resolveSession } from "../modules/auth/session";
import { sessionThreadProvision } from "../modules/chat/policy";
import { liveAccess } from "./access";

const leaseLengthMs = 5 * 60_000;
const INVALIDATION = JSON.stringify({ kind: "invalidate" } satisfies LiveFrame);
const READY = JSON.stringify({ kind: "ready" } satisfies LiveFrame);
type LiveRow = { scope_id: string | null; expires_at: number; value: string | null };

// Set only after the upgrade route has verified scope and obtained its catch-up page.
export interface LiveAttachment {
  readonly scopeId: string;
  readonly leaseUntil: number;
}

// Expiry is enforced before any traffic, without an alarm or resident timer.
export class LiveTopic extends DurableObject<Bindings> {
  override async fetch(request: Request): Promise<Response> {
    const topic = parseLiveTopic(new URL(request.url).searchParams.get("topic"));
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket" || !topic) {
      return new Response(null, { status: 404 });
    }
    const now = Date.now();
    const session = await resolveSession(request, null, now);
    if (!session) return new Response(null, { status: 401 });

    // Do not let a concurrent revoke RPC pass between the scope read and attachment.
    return this.ctx.blockConcurrencyWhile(async () => {
      const { sql, params } = liveAccess(session, now, topic, this.env);
      const query = this.env.DB.prepare(sql).bind(...params ?? []);
      const provision = topic.kind === "thread" ? sessionThreadProvision(session, now, topic.opaqueId) : null;
      const row = provision ? (await this.env.DB.batch<LiveRow>([
        this.env.DB.prepare(provision.sql).bind(...provision.params ?? []), query,
      ]))[1]?.results[0] : await query.first<LiveRow>();
      const leaseUntil = Math.min(row?.expires_at ?? 0, now + leaseLengthMs);
      if (!row || leaseUntil <= Date.now()) return new Response(null, { status: 401 });
      if (!row.scope_id || (topic.kind === "thread" && row.value === null)) return new Response(null, { status: 404 });

      const { 0: client, 1: socket } = new WebSocketPair();
      const attachment: LiveAttachment = { scopeId: row.scope_id, leaseUntil };
      this.ctx.acceptWebSocket(socket);
      socket.serializeAttachment(attachment);
      socket.send(row.value ?? READY);
      return new Response(null, { status: 101, webSocket: client, headers: { "Cache-Control": "private, no-store" } });
    });
  }

  override webSocketMessage(socket: WebSocket): void {
    socket.close(1008); // A subscription is never a client command channel.
  }

  publishInvalidation(revokedScopeIds: readonly string[] = []): void {
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      // A hibernated socket can disappear while being woken; isolate each delivery.
      try {
        const lease = socket.deserializeAttachment() as LiveAttachment | null;
        if (!lease || !(lease.leaseUntil > now) || revokedScopeIds.includes(lease.scopeId)) socket.close(1008);
        else socket.send(INVALIDATION);
      } catch {
        // Transport can disappear during fan-out; one socket never blocks the others.
      }
    }
  }
}
