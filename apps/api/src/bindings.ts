import type { AuthBindings } from "./config";
import type { EffectsWake } from "./effects/index";
import type { LiveTopic } from "./realtime/live-topic";

export interface Bindings extends AuthBindings {
  DB: D1Database;
  EVIDENCE: R2Bucket;
  // The deployed S3 bucket name must match EVIDENCE.
  R2_ACCOUNT_ID?: string;
  R2_EVIDENCE_BUCKET?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  LIVE: DurableObjectNamespace<LiveTopic>;
  EFFECTS: Queue<EffectsWake>;
  SYNC_CURSOR_HMAC_KEY?: string;
  PUBLIC_APP_ORIGIN?: string;
  EXPO_ACCESS_TOKEN?: string;
  // Deploy with the independently verified local BookBuddy case steward's account ID.
  CASE_STEWARD_ACCOUNT_ID?: string;
}

export type ApiEnv = {
  Bindings: Bindings;
  Variables: { requestId: string };
};
