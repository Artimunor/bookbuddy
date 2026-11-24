import type { Bindings } from "../bindings";

// Durable intent data stays in D1. Queue wakeups carry keys only.
export interface EffectsWake {
  readonly workKeys: readonly string[];
}

export function consumeEffects(batch: MessageBatch<EffectsWake>, _env: Bindings): void {
  // Until the claim handler is implemented, don't acknowledge work as processed.
  batch.retryAll();
}

export function sweepDueWork(_controller: ScheduledController, _env: Bindings): void {
  // The delivery slice will claim due work directly here, without another queue wake.
}
