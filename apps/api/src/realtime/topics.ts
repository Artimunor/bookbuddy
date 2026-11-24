import { liveTopicName } from "@bookbuddy/api-contract";
import type { LiveTopicKey } from "@bookbuddy/api-contract";
import type { Bindings } from "../bindings";
import type { LiveTopic } from "./live-topic";

export type LiveTopicSignal = LiveTopicKey & { readonly revokedScopeIds?: readonly string[] };

export function getLiveTopic(live: Bindings["LIVE"]): DurableObjectStub<LiveTopic> {
  return live.getByName("foreground-live-v1");
}

export async function closeRevokedSession(live: Bindings["LIVE"] | undefined, sessionId: string): Promise<void> {
  if (live) await getLiveTopic(live).closeSession(sessionId);
}

export function publishLiveTopics(live: Bindings["LIVE"], topics: Iterable<LiveTopicSignal>): Promise<void>[] {
  const distinct = new Map<string, Set<string> | undefined>();
  for (const topic of topics) {
    const name = liveTopicName(topic);
    let revoked = distinct.get(name);
    if (topic.revokedScopeIds?.length) {
      revoked ??= new Set();
      for (const scope of topic.revokedScopeIds) revoked.add(scope);
    }
    distinct.set(name, revoked);
  }
  let target: DurableObjectStub<LiveTopic> | undefined;
  return Array.from(distinct, async ([name, revoked]) => {
    await (target ??= getLiveTopic(live)).publishInvalidation(name, revoked && [...revoked]);
  });
}
