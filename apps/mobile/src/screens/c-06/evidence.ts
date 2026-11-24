import type { AttachmentId, MediaScope } from "../../media/types";

export type QuoteEvidenceOpener = { id: AttachmentId; uri: string | undefined; open: () => void };

export function quoteEvidenceOpeners(evidence: readonly { attachmentId: AttachmentId }[], urls: ReadonlyMap<string, string>,
  scope: MediaScope, open: (id: AttachmentId, scope: MediaScope) => void): QuoteEvidenceOpener[] {
  return evidence.map(({ attachmentId }) => ({ id: attachmentId, uri: urls.get(attachmentId), open: () => open(attachmentId, scope) }));
}
