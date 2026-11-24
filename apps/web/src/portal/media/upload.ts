import { createMediaClient, type ApiClient } from "@bookbuddy/api-client";
import type { MediaFile, MediaSettlement, MediaUploadGrant } from "@bookbuddy/api-contract";

export type PendingMedia = { attachmentId: string; blob: Blob; file: MediaFile; attempted?: boolean };

/** Decode and re-encode rather than forwarding metadata or location from the source file. */
export async function preparePhoto(file: File): Promise<PendingMedia> {
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 2400 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Encoding failed")), "image/jpeg", 0.8));
    if (blob.size > 5 * 1024 * 1024 || !blob.size) throw new Error("Photo too large");
    return { attachmentId: crypto.randomUUID(), blob, file: { kind: "photo", mime: "image/jpeg", bytes: blob.size } };
  } finally { image.close(); }
}

export function prepareVoice(blob: Blob, durationMs: number): PendingMedia {
  const mime = blob.type.split(";")[0];
  if (!(mime === "audio/webm" || mime === "audio/ogg" || mime === "audio/mp4" || mime === "audio/aac" || mime === "audio/mpeg") || !blob.size || blob.size > 2 * 1024 * 1024 || durationMs > 90_000) throw new Error("Unsupported recording");
  return { attachmentId: crypto.randomUUID(), blob, file: { kind: "voice", mime, bytes: blob.size, durationMs: Math.max(1, Math.round(durationMs)) } };
}

async function put(blob: Blob, grant: MediaUploadGrant): Promise<{ partNumber: number; etag: string }[]> {
  if (grant.kind === "single") {
    const response = await fetch(grant.url, { method: "PUT", headers: grant.headers, body: blob, cache: "no-store" });
    if (!response.ok) throw new Error("Upload outcome unknown");
    return [];
  }
  const results = await Promise.allSettled(grant.parts.map(async part => {
    const response = await fetch(part.url, { method: "PUT", body: blob.slice(part.offset, part.offset + part.bytes), cache: "no-store" });
    const etag = response.headers.get("ETag");
    if (!response.ok || !etag) throw new Error("Part outcome unknown");
    return { partNumber: part.partNumber, etag };
  }));
  if (results.some(result => result.status === "rejected")) throw new Error("Part outcome unknown");
  return results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
}

/** One grant and one settle per batch on the ordinary path; recovery probes only uncertain transfers. */
export async function uploadMedia(api: ApiClient, stageId: string, scope: { caller: "request" | "case"; parentScopeId: string }, files: PendingMedia[]): Promise<string[]> {
  const client = createMediaClient(api);
  const request = { stageId, scope, files: files.map(({ attachmentId, file }) => ({ attachmentId, file })) };
  let grants = await client.createGrants(request);
  // The exact reservation is safe to replay if the response to the reservation itself was lost.
  if (!grants.ok && "delivery" in grants.error && grants.error.delivery === "unknown") grants = await client.createGrants(request);
  if (!grants.ok || grants.data.grants.length !== files.length) throw new Error("Grant unavailable");
  const settlements: MediaSettlement[] = [];
  const alreadyReady: string[] = [];
  for (const outcome of grants.data.grants) {
    const pending = files.find(item => item.attachmentId === outcome.attachmentId)!;
    if (outcome.state === "ready") { alreadyReady.push(outcome.attachmentId); continue; }
    if (outcome.state !== "uploading") throw new Error("Grant not ready");
    const reservation = { attachmentId: outcome.attachmentId, uploadGeneration: outcome.uploadGeneration };
    try {
      if (pending.attempted) throw new Error("Reconcile before retry");
      pending.attempted = true;
      const parts = await put(pending.blob, outcome.grant);
      settlements.push(outcome.grant.kind === "single" ? { ...reservation, kind: "single" } : { ...reservation, kind: "multipart", parts });
    } catch {
      const recovery = await client.recover({ stageId, files: [{ ...reservation, unknown: outcome.grant.kind === "single" ? "put" : "parts" }] });
      if (!recovery.ok || !recovery.data.files[0]) throw new Error("Recovery unavailable");
      const state = recovery.data.files[0];
      if (state.state === "ready") { alreadyReady.push(state.attachmentId); continue; }
      if (state.state !== "uploading") throw new Error("Recovery incomplete");
      const missing = state.transfer.kind === "multipart" ? state.transfer.missingPartNumbers : undefined;
      let parts = state.transfer.kind === "multipart" ? state.transfer.completedParts : [];
      if (!missing || missing.length) {
        const refreshed = await client.createGrants({ ...request, files: [{ attachmentId: pending.attachmentId, file: pending.file, refresh: { uploadGeneration: state.uploadGeneration, ...(missing ? { missingPartNumbers: missing } : {}) } }] });
        const next = refreshed.ok ? refreshed.data.grants[0] : null;
        if (!next || next.state !== "uploading") throw new Error("Refresh unavailable");
        parts = [...parts, ...await put(pending.blob, next.grant)];
      }
      settlements.push(state.transfer.kind === "single" ? { ...reservation, kind: "single" } : { ...reservation, kind: "multipart", parts });
    }
  }
  if (settlements.length) {
    const result = await client.settle({ stageId, files: settlements });
    const unresolved = settlements.filter(file => !result.ok || !result.data.acknowledgements.some(item => item.attachmentId === file.attachmentId && item.uploadGeneration === file.uploadGeneration && item.state === "ready"));
    if (unresolved.length) {
      const recovered = await client.recover({ stageId, files: unresolved.map(({ attachmentId, uploadGeneration }) => ({ attachmentId, uploadGeneration, unknown: "completion" as const })) });
      if (!recovered.ok || unresolved.some(file => !recovered.data.files.some(item => item.attachmentId === file.attachmentId && item.uploadGeneration === file.uploadGeneration && item.state === "ready"))) throw new Error("Settlement incomplete");
    }
  }
  return [...alreadyReady, ...settlements.map(item => item.attachmentId)];
}
