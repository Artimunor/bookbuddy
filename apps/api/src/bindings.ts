import type { EffectsWake } from "./effects/index";
import type { LiveTopic } from "./realtime/live-topic";

export interface Bindings {
  DB: D1Database;
  EVIDENCE: R2Bucket;
  LIVE: DurableObjectNamespace<LiveTopic>;
  EFFECTS: Queue<EffectsWake>;
}

export type ApiEnv = {
  Bindings: Bindings;
  Variables: { requestId: string };
};
