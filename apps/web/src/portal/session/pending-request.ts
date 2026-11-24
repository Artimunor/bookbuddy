import type { SubmitRequest } from "@bookbuddy/api-contract";
import type { StoredOperation } from "./pending-storage";

export function sameRequestIntent({ payload: a }: SubmitRequest, { payload: b }: SubmitRequest) {
  return a.placeId === b.placeId && a.trade === b.trade && a.originalText === b.originalText &&
    a.originalLanguage === b.originalLanguage && a.arrivalArrangement === b.arrivalArrangement &&
    a.arrivalContactName === b.arrivalContactName && a.safeNote === b.safeNote &&
    a.attachmentIds?.length === b.attachmentIds?.length &&
    (a.attachmentIds?.every((id, index) => id === b.attachmentIds?.[index]) ?? true);
}

export function requestReplay<P extends { operationId: string; expectedRevision?: number }>(
  operation: StoredOperation, attempted: P | undefined, input: P, sameIntent: (attempted: P, input: P) => boolean,
): P | null {
  if (!operation.retryReady || operation.expectedRevision === undefined ||
    attempted?.operationId !== operation.operationId || !sameIntent(attempted, input)) return null;
  return { ...input, operationId: operation.operationId, expectedRevision: operation.expectedRevision };
}
