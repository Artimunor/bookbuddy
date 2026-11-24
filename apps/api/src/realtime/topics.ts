import { liveTopicName } from "@bookbuddy/api-contract";
import type { LiveTopicKey } from "@bookbuddy/api-contract";
import type { Bindings } from "../bindings";
import type { LiveTopic } from "./live-topic";

export type LiveTopicSignal = LiveTopicKey & { readonly revokedScopeIds?: readonly string[] };

export function getLiveTopic(live: Bindings["LIVE"], topic: LiveTopicKey): DurableObjectStub<LiveTopic> {
  return live.getByName(liveTopicName(topic));
}

export function publishLiveTopics(live: Bindings["LIVE"], topics: Iterable<LiveTopicSignal>): Promise<void>[] {
  const distinct = new Map<string, { topic: LiveTopicKey; revoked?: Set<string> }>();
  for (const topic of topics) {
    const name = liveTopicName(topic);
    let signal = distinct.get(name);
    if (!signal) distinct.set(name, signal = { topic });
    if (topic.revokedScopeIds?.length) {
      const revoked = signal.revoked ??= new Set();
      for (const scope of topic.revokedScopeIds) revoked.add(scope);
    }
  }
  return Array.from(distinct.values(), async ({ topic, revoked }) => {
    await getLiveTopic(live, topic).publishInvalidation(revoked && [...revoked]);
  });
}
