import type { AttachmentId, MediaScope, MediaStageId, MediaTransfer, MediaTransferState } from "../media/types";

type MediaTransferValue = Pick<MediaTransfer, "file" | "operationId" | "started" | "generation" | "probe" | "settlement" | "completedParts" | "terminal">;
type MediaTransferColumns = {
  attachment_id: AttachmentId;
  stage_id: MediaStageId;
  caller: MediaScope["caller"];
  parent_scope_id: string;
  state: MediaTransferState;
  selected: 0 | 1;
  file_uri: string | null;
  value: string;
};

export function decodeTransfer(row: MediaTransferColumns & { created_at: number }): MediaTransfer {
  return {
    ...JSON.parse(row.value) as MediaTransferValue,
    attachmentId: row.attachment_id, stageId: row.stage_id, caller: row.caller, parentScopeId: row.parent_scope_id,
    state: row.state, selected: row.selected === 1, fileUri: row.file_uri, capturedAt: row.created_at,
  };
}

export function encodeTransfer(transfer: MediaTransfer): MediaTransferColumns {
  const { attachmentId, stageId, caller, parentScopeId, state, selected, fileUri, capturedAt: _capturedAt, ...value } = transfer;
  return {
    attachment_id: attachmentId, stage_id: stageId, caller, parent_scope_id: parentScopeId,
    state, selected: selected ? 1 : 0, file_uri: fileUri, value: JSON.stringify(value),
  };
}
