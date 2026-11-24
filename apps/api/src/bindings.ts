import type { AuthBindings } from "./config";
import type { EffectsWake } from "./effects/index";
import type { LiveTopic } from "./realtime/live-topic";

export interface Bindings extends AuthBindings {
  DB: D1Database;
  EVIDENCE: R2Bucket;
  LIVE: DurableObjectNamespace<LiveTopic>;
  EFFECTS: Queue<EffectsWake>;
  SYNC_CURSOR_HMAC_KEY?: string;
}

export type ApiEnv = {
  Bindings: Bindings;
  Variables: { requestId: string };
};
