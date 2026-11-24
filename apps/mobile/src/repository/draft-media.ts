import { operationIdSchema, revisionSchema } from "@bookbuddy/api-contract";
import type { MediaCaller } from "@bookbuddy/api-contract";
import type { DraftValue } from "./repository";

function record(value: DraftValue | undefined) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

export function legacyRequestMarker(value: DraftValue) {
  const marker = record(record(value)?.pendingOperation);
  const operation = operationIdSchema.safeParse(marker?.id);
  const revision = revisionSchema.safeParse(marker?.revision);
  return operation.success && revision.success ? { operationId: operation.data, expectedRevision: revision.data } : null;
}

export function mediaOmittedFromDraft(value: DraftValue) {
  const ids = record(value)?.omittedMedia;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

export function ownedMediaStages(key: string, value: DraftValue): { caller: MediaCaller; stages: string[] } | null {
  const colon = key.indexOf(":");
  const kind = key.slice(0, colon);
  const parent = key.slice(colon + 1);
  const saved = record(value);
  const strings = (values: readonly (DraftValue | undefined)[]) => values.filter((v): v is string => typeof v === "string");
  switch (kind) {
    case "request":
    case "case":
      return { caller: kind, stages: strings(Array.isArray(saved?.mediaStages) ? saved.mediaStages : kind === "request" ? [parent] : []) };
    case "chat-media": return { caller: "chat", stages: strings([value]) };
    case "quote":
    case "change": return { caller: kind, stages: strings([saved?.mediaStageId]) };
    case "progress": return { caller: "progress", stages: [parent] };
    case "wrapup": return { caller: "completion", stages: strings(Object.values(record(saved?.items) ?? {}).map((item) => record(item)?.photoStage)) };
    case "share-photo": return { caller: "update", stages: strings([saved?.stage, saved?.previousStage]) };
    default: return null;
  }
}
