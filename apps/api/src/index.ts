import { app } from "./app";
import type { Bindings } from "./bindings";
import { consumeEffects, sweepDueWork } from "./effects/index";
import type { EffectsWake } from "./effects/index";

export { LiveTopic } from "./realtime/live-topic";

export default {
  fetch: app.fetch,
  queue: consumeEffects,
  scheduled: sweepDueWork,
} satisfies Required<Pick<ExportedHandler<Bindings, EffectsWake>, "fetch" | "queue" | "scheduled">>;
