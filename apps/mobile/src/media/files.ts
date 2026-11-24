import type { AttachmentId, PreparedMedia } from "./types";
import type { TransferFiles } from "./queue";

// The Expo web preview has a memory-only repository. Keep Blob references, not
// serialized bytes, in the matching in-memory file store for that process.
const stagedFiles = new Map<string, Blob>();

export async function prepareLocalMediaFile(uri: string, _attachmentId: AttachmentId, mime: string, limit: number, _persistent: boolean): Promise<PreparedMedia | null> {
  if (!uri.startsWith("blob:") && !uri.startsWith("data:")) return null;
  const blob = await (await fetch(uri)).blob();
  if (blob.size === 0 || blob.size > limit) return null;
  const fileUri = URL.createObjectURL(blob);
  return {
    fileUri, bytes: blob.size, mime: blob.type.split(";", 1)[0] || mime,
    copy() { stagedFiles.set(fileUri, blob); },
    release() { if (!stagedFiles.has(fileUri)) URL.revokeObjectURL(fileUri); },
  };
}

export async function releaseMediaCapture(uri: string) {
  if (uri.startsWith("blob:")) URL.revokeObjectURL(uri);
}

export const transferFiles: TransferFiles = {
  size: (uri) => stagedFiles.get(uri)?.size ?? null,
  async erase(uri) {
    if (stagedFiles.delete(uri)) URL.revokeObjectURL(uri);
  },
  async put(uri, { url, headers, offset, bytes, signal }) {
    const blob = stagedFiles.get(uri);
    if (!blob || offset < 0 || bytes <= 0 || offset + bytes > blob.size) throw new Error("Invalid file range for media PUT");
    const body = offset === 0 && bytes === blob.size ? blob : blob.slice(offset, offset + bytes);
    const init: RequestInit & { redirect: "error" } = { method: "PUT", headers, body, signal, credentials: "omit", redirect: "error" };
    const response = await fetch(url, init);
    return { status: response.status, etag: response.headers.get("ETag") ?? undefined };
  },
};
