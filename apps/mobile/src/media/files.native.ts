import { Directory, File, Paths, UploadType } from "expo-file-system";
import { removeStagedFiles, stagedMediaDirectory } from "../repository/open";
import type { AttachmentId } from "./types";
import type { TransferFiles } from "./queue";

export async function stageLocalMediaFile(uri: string, attachmentId: AttachmentId, mime: string, limit: number) {
  const source = new File(uri);
  const bytes = source.size;
  if (bytes <= 0 || bytes > limit) return null;
  const directory = new Directory(stagedMediaDirectory());
  directory.create({ intermediates: true, idempotent: true });
  const destination = new File(directory, `${attachmentId}.${mime === "image/jpeg" ? "jpg" : "m4a"}`);
  try {
    await source.copy(destination);
    if (destination.size !== bytes) throw new Error("Incomplete local media copy");
  } catch {
    if (destination.exists) destination.delete();
    throw new Error("Unable to stage media");
  }
  return { fileUri: destination.uri, bytes, mime };
}

export async function releaseMediaCapture(uri: string) {
  const cache = new URL(Paths.cache.uri);
  const file = new URL(uri);
  if (file.protocol !== "file:" || file.host !== cache.host || !file.pathname.startsWith(cache.pathname.replace(/\/?$/, "/"))) return;
  const captured = new File(file.href);
  if (captured.exists) captured.delete();
}

export const transferFiles: TransferFiles = {
  size: (uri) => new File(uri).size,
  erase: (uri) => removeStagedFiles([uri]),
  async put(uri, { url, headers, offset, bytes, signal }) {
    const file = new File(uri);
    // The current contract caps photos at one 5 MiB R2 part. Use the same staged
    // file directly for that part: File.slice would copy bytes through JS.
    if (offset !== 0 || bytes !== file.size) throw new Error("Invalid file range for media PUT");
    const task = file.createUploadTask(url, {
      httpMethod: "PUT", uploadType: UploadType.BINARY_CONTENT, sessionType: "background", signal,
      headers: { ...headers, "Content-Length": String(bytes) },
    });
    try {
      const response = await task.uploadAsync();
      const etag = Object.entries(response.headers).find(([name]) => name.toLowerCase() === "etag")?.[1];
      return { status: response.status, etag };
    } finally {
      task.release();
    }
  },
};
