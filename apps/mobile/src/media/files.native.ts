import { Directory, File, Paths, UploadType } from "expo-file-system";
import type { AttachmentId, PreparedMedia } from "./types";
import type { TransferFiles } from "./queue";

function stagingDirectory(persistent: boolean) {
  return persistent ? new Directory(Paths.document, "BookBuddyOffline", "staged-media") : new Directory(Paths.cache, "BookBuddyStagedMedia");
}

export function listStagedFiles(persistent = true): string[] {
  const directory = stagingDirectory(persistent);
  return directory.exists ? directory.list().flatMap((entry) => entry instanceof File ? [entry.uri] : []) : [];
}

export async function eraseStagedFile(uri: string) {
  const file = new URL(uri);
  const valid = file.protocol === "file:" && !/%2[ef]|%5c/i.test(file.pathname) && [true, false].some((persistent) => {
    const root = new URL(stagingDirectory(persistent).uri);
    const path = root.pathname.replace(/\/?$/, "/");
    const name = file.pathname.slice(path.length);
    return file.host === root.host && file.pathname.startsWith(path) && !!name && !name.includes("/");
  });
  if (!valid) throw new Error("Staged file is outside the app's private staging directory");
  const staged = new File(file.href);
  if (staged.exists) staged.delete();
}

export function clearEphemeralStagedFiles() {
  for (const uri of listStagedFiles(false)) {
    const file = new File(uri);
    if (file.exists) file.delete();
  }
}

export function prepareLocalMediaFile(uri: string, attachmentId: AttachmentId, mime: string, limit: number, persistent: boolean): PreparedMedia | null {
  const source = new File(uri);
  const bytes = source.size;
  if (bytes <= 0 || bytes > limit) return null;
  const directory = stagingDirectory(persistent);
  const destination = new File(directory, `${attachmentId}.${mime === "image/jpeg" ? "jpg" : "m4a"}`);
  return {
    fileUri: destination.uri, bytes, mime,
    async copy() {
      directory.create({ intermediates: true, idempotent: true });
      if (destination.exists) throw new Error("Duplicate private media destination");
      await source.copy(destination);
      if (destination.size !== bytes) throw new Error("Incomplete local media copy");
    },
  };
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
  erase: eraseStagedFile,
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
