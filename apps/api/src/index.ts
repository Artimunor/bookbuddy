import { app } from "./app";
import type { Bindings } from "./bindings";
import { consumeEffects, sweepDueWork } from "./effects/index";
import type { EffectsWake } from "./effects/index";
import { sweepMediaRetention } from "./modules/media/retention";

export { LiveTopic } from "./realtime/live-topic";

export default {
  fetch: app.fetch,
  queue: consumeEffects,
  async scheduled(controller, env) {
    await Promise.all([sweepDueWork(controller, env), sweepMediaRetention(env)]);
  },
} satisfies Required<Pick<ExportedHandler<Bindings, EffectsWake>, "fetch" | "queue" | "scheduled">>;
