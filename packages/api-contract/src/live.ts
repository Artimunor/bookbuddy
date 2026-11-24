import { z } from "zod";
import { threadDetailsSchema, threadEntriesPageSchema } from "./chat";
import { idSchema, timestampSchema } from "./common";

export const livePath = "/live";
export const liveTopicKinds = ["customer-visit", "provider-job", "provider-crew", "scope-inbox", "thread"] as const;
const topicKind = z.enum(liveTopicKinds);

export type LiveTopicKey = Readonly<{ kind: (typeof liveTopicKinds)[number]; opaqueId: string }>;

export function liveTopicName({ kind, opaqueId }: LiveTopicKey): string {
  return `${kind}:${opaqueId}`;
}

export function parseLiveTopic(value: string | null): LiveTopicKey | null {
  if (value === null) return null;
  const separator = value.indexOf(":");
  if (separator < 0) return null;
  const kind = topicKind.safeParse(value.slice(0, separator));
  const id = idSchema.safeParse(value.slice(separator + 1));
  return kind.success && id.success ? { kind: kind.data, opaqueId: id.data } : null;
}

// A thread's first frame is a checked read, not a hint. Subsequent frames are only invalidations.
export const liveFrameSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("invalidate") }),
  z.strictObject({ kind: z.literal("ready") }),
  z.strictObject({ kind: z.literal("thread_catch_up"), at: timestampSchema, details: threadDetailsSchema, page: threadEntriesPageSchema }),
]);
export type LiveFrame = z.output<typeof liveFrameSchema>;
export type LiveThreadCatchUp = Extract<LiveFrame, { kind: "thread_catch_up" }>;

export function parseLiveFrame(data: unknown): LiveFrame | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = liveFrameSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
