import type { MediaCaller, MediaFile, MediaSettlement, OperationId } from "@bookbuddy/api-contract";
import type { OpaqueId } from "@bookbuddy/domain";

export type AttachmentId = OpaqueId<"attachment">;
export type MediaStageId = OpaqueId<"media_stage">;
export type MediaScope = { caller: MediaCaller; parentScopeId: string };
export type MediaTransferState = "queued" | "uploading" | "verifying" | "ready" | "failed";
export type RecoveryProbe = "put" | "parts" | "completion";
export type CompletedPart = Extract<MediaSettlement, { kind: "multipart" }>["parts"][number];
export type MediaCancellation = { attachmentId: AttachmentId; stageId: MediaStageId; generation: number; probe: RecoveryProbe };

export type TransferProgress = {
  state: MediaTransferState;
  selected: boolean;
  started: boolean;
  fileUri: string | null;
  generation: number | null;
  probe: RecoveryProbe | null;
  settlement: MediaSettlement | null;
  completedParts: CompletedPart[];
  terminal: boolean;
  /** A committed journal row whose private copy is not yet ready for use. */
  staging?: boolean;
  cancelled?: boolean;
  sendReviewed?: boolean;
};
export type MediaTransfer = MediaScope & TransferProgress & {
  attachmentId: AttachmentId;
  stageId: MediaStageId;
  operationId: OperationId;
  /** Local staging time, not capture metadata from the picked file. */
  readonly capturedAt?: number;
  file: MediaFile;
};
export type NewMediaTransfer = Omit<MediaTransfer, keyof TransferProgress | "stageId" | "capturedAt"> & {
  fileUri: string;
  stageId?: MediaStageId;
};
export type TransferQuery = Partial<MediaScope> & { attachmentId?: AttachmentId; stageId?: MediaStageId };
export type PreparedMedia = { fileUri: string; bytes: number; mime: string; copy: () => void | Promise<void>; release?: () => void };

export function isSentDraft(item: MediaTransfer): boolean {
  return !item.cancelled && item.selected && item.state === "ready" && item.fileUri === null;
}

export function photoResizeTarget(width: number, height: number): { width: number } | { height: number } | undefined {
  const longEdge = 2048;
  if (Math.max(width, height) <= longEdge) return undefined;
  return width >= height ? { width: longEdge } : { height: longEdge };
}

export function allowsVoice(caller: MediaCaller): boolean {
  return caller !== "progress" && caller !== "update" && caller !== "completion";
}

export function fitsDraft(caller: MediaCaller, files: readonly MediaFile[], next: MediaFile): boolean {
  const photos = files.filter(({ kind }) => kind === "photo").length + Number(next.kind === "photo");
  const voices = files.length + 1 - photos;
  if (caller === "chat") return voices === 0 ? photos <= 3 : photos === 0 && voices === 1;
  const photoLimit = caller === "progress" ? 6 : caller === "update" ? 1 : caller === "completion" ? 8 : 5;
  return photos <= photoLimit && voices <= (allowsVoice(caller) ? 1 : 0);
}
