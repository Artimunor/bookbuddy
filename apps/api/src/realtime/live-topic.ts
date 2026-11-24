import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "../bindings";

export type LiveTopicKey = {
  readonly kind: "customer-visit" | "provider-job" | "provider-crew" | "scope-inbox" | "thread";
  readonly opaqueId: string;
};

// Use server-resolved topic IDs, never caller-selected DB keys or user-visible references.
export function getLiveTopic(live: Bindings["LIVE"], topic: LiveTopicKey): DurableObjectStub<LiveTopic> {
  return live.getByName(`${topic.kind}:${topic.opaqueId}`);
}

// Set only after the upgrade route has verified scope and obtained its catch-up page.
export interface LiveAttachment {
  readonly scopeId: string;
  readonly leaseUntil: number;
}

const INVALIDATION = '{"kind":"invalidate"}';

export class LiveTopic extends DurableObject<Bindings> {
  override fetch(): Response {
    // No upgrades until the realtime module can verify live scope and browser Origin.
    return new Response(null, { status: 404 });
  }

  publishInvalidation(revokedScopeIds: readonly string[] = []): void {
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const lease = socket.deserializeAttachment() as LiveAttachment | null;
      if (!lease || !(lease.leaseUntil > now) || revokedScopeIds.includes(lease.scopeId)) {
        socket.close(1008);
      } else {
        socket.send(INVALIDATION);
      }
    }
  }
}
