import type { ChatEntryProjection } from "@bookbuddy/api-contract";

export function chatEntryMedia(entry: Pick<ChatEntryProjection, "id" | "attachments">) {
  const photoIds: string[] = [];
  for (const attachment of entry.attachments) {
    if (attachment.kind === "photo" && attachment.availability === "available") photoIds.push(attachment.attachmentId);
  }
  return { scope: { caller: "chat", parentScopeId: entry.id } as const, photoIds };
}
