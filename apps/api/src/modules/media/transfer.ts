import { mediaFileSchema, mediaLimits } from "@bookbuddy/api-contract";
import type { MediaRecovery, MediaUploadGrant, RouteResponse, createMediaGrantsRoute, settleMediaRoute, recoverMediaRoute } from "@bookbuddy/api-contract";
import type { Bindings } from "../../bindings";
import { PRIVATE_CACHE_CONTROL } from "../../config";
import type { RequestScope } from "../../db/scope";
import { createR2Presigner } from "../../providers/r2-presign";
import type { R2Presigner } from "../../providers/r2-presign";
import type { SessionAccess } from "../auth/session";
import { claim, partBytes, reserve, saveResults, singleBytes, stageAccess } from "./storage";
import type { AttachmentRow, GrantInput, MediaResult, RecoverInput, SettleInput } from "./storage";

const uploadLifetime = 10 * 60_000;
export const readLifetime = 5 * 60_000;

type Grant = RouteResponse<typeof createMediaGrantsRoute.output>["grants"][number];
type Acknowledgement = RouteResponse<typeof settleMediaRoute.output>["acknowledgements"][number];
type Recovery = RouteResponse<typeof recoverMediaRoute.output>["files"][number];
type MultipartRecovery = Extract<Extract<MediaRecovery, { state: "uploading" }>["transfer"], { kind: "multipart" }>;

export type MediaFailure = "UNAUTHENTICATED" | "NOT_FOUND" | "CONFLICT" | "VALIDATION_FAILED" | "UNAVAILABLE";

function ack(row: AttachmentRow, state = row.state): Acknowledgement {
  return { attachmentId: row.id as Acknowledgement["attachmentId"], uploadGeneration: row.upload_generation, state };
}

function partSize(total: number, number: number) {
  return Math.min(partBytes, total - (number - 1) * partBytes);
}

async function signUpload(signer: R2Presigner, row: AttachmentRow, now: number, missing?: readonly number[]): Promise<MediaUploadGrant | null> {
  // Presigns for the same reservation and part are deterministic in an expiry
  // window. A replay or early refresh returns the existing capability, not a longer lease.
  const signedAt = Math.floor(now / uploadLifetime) * uploadLifetime;
  const expiresAt = Math.floor(Math.min(signedAt + uploadLifetime, row.expires_at, row.session_expires_at) / 1_000) * 1_000;
  if (expiresAt <= now) return null;
  const key = row.object_key;
  if (row.bytes <= singleBytes) {
    const mime = mediaFileSchema.parse(row.duration_ms === null ? { kind: "photo", mime: row.mime, bytes: row.bytes }
      : { kind: "voice", mime: row.mime, bytes: row.bytes, durationMs: row.duration_ms }).mime;
    const headers = { "If-None-Match": "*", "Content-Type": mime, "Cache-Control": PRIVATE_CACHE_CONTROL } as const;
    const url = await signer({ method: "PUT", key, signedAt, expiresAt,
      headers: { ...headers, "Content-Length": String(row.bytes) } });
    return { kind: "single", method: "PUT", url, headers, expiresAt };
  }
  if (!row.r2_upload_id) return null;
  const uploadId = row.r2_upload_id;
  const numbers = missing ?? Array.from({ length: Math.ceil(row.bytes / partBytes) }, (_, i) => i + 1);
  const parts = await Promise.all(numbers.map(async (partNumber) => {
    const bytes = partSize(row.bytes, partNumber);
    const url = await signer({ method: "PUT", key, signedAt, expiresAt, query: { uploadId, partNumber: String(partNumber) },
      headers: { "Content-Length": String(bytes) } });
    return { partNumber, url, offset: (partNumber - 1) * partBytes, bytes };
  }));
  return { kind: "multipart", method: "PUT", parts, expiresAt };
}

export async function grantMedia(ctx: RequestScope, session: SessionAccess, env: Bindings, body: GrantInput): Promise<Grant[] | MediaFailure> {
  for (const { file, refresh } of body.files) {
    if (refresh?.missingPartNumbers && (file.bytes <= singleBytes || refresh.missingPartNumbers.some((n) => partSize(file.bytes, n) <= 0))) {
      return "VALIDATION_FAILED";
    }
  }
  const signer = createR2Presigner(env);
  if (!signer) return "UNAVAILABLE";
  const { status, rows, newClaims } = await reserve(ctx, session, body);
  if (!status.signed_in) return "UNAUTHENTICATED";
  if (!status.in_scope) return "NOT_FOUND";
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (body.files.some(({ attachmentId, refresh }) => {
    const row = byId.get(attachmentId);
    return !row || (refresh && row.upload_generation !== refresh.uploadGeneration &&
      !(newClaims.has(attachmentId) && row.upload_generation === refresh.uploadGeneration + 1));
  })) return "CONFLICT";

  if (newClaims.size) {
    const created = (await Promise.all(rows.filter(({ id }) => newClaims.has(id)).map(async (row): Promise<MediaResult | null> => {
      try {
        const { uploadId } = await env.EVIDENCE.createMultipartUpload(row.object_key, {
          httpMetadata: { contentType: row.mime, cacheControl: PRIVATE_CACHE_CONTROL },
        });
        return { id: row.id, upload_generation: row.upload_generation, state: "uploading", uploadId };
      } catch {
        // No URL was issued. If the outcome was unknown, the R2 lifecycle
        // aborts the abandoned session and a later lease can use a new key.
        return null;
      }
    }))).filter((result) => result !== null);
    if (created.length) {
      const saved = await saveResults(ctx, stageAccess(ctx, session, body.stageId), "preparing", created);
      if (saved.size !== created.length) return "CONFLICT";
      for (const result of created) {
        const row = byId.get(result.id)!;
        row.state = "uploading";
        row.r2_upload_id = result.uploadId!;
      }
    }
  }

  const outcomes = await Promise.all(body.files.map(async ({ attachmentId, refresh }): Promise<Grant | null> => {
    const row = byId.get(attachmentId)!;
    const { state } = row;
    const reservation = { attachmentId, uploadGeneration: row.upload_generation };
    if (state !== "uploading") return { ...reservation, state };
    const grant = await signUpload(signer, row, ctx.now, refresh?.missingPartNumbers);
    return grant ? { ...reservation, state, grant } : null;
  }));
  return outcomes.every((grant) => grant !== null) ? outcomes : "UNAVAILABLE";
}

function verified(row: AttachmentRow, object: R2Object): MediaResult {
  const metadata = object.httpMetadata;
  const ready = object.key === row.object_key && object.size === row.bytes && object.etag && metadata?.contentType === row.mime
    && metadata.cacheControl === PRIVATE_CACHE_CONTROL && !metadata.contentEncoding && !metadata.contentDisposition;
  return { id: row.id, upload_generation: row.upload_generation, ...(ready ? { state: "ready", etag: object.etag } : { state: "rejected" }) };
}

function etagWithoutQuotes(etag: string) {
  return etag.replace(/^"(.*)"$/, "$1");
}

export async function settleMedia(ctx: RequestScope, session: SessionAccess, env: Bindings,
  { stageId, files }: SettleInput): Promise<Acknowledgement[] | MediaFailure> {
  const access = stageAccess(ctx, session, stageId);
  const { status, rows, claimed } = await claim(ctx, access, files, "settle");
  if (!status.signed_in) return "UNAUTHENTICATED";
  if (!status.in_scope || rows.length !== files.length) return "NOT_FOUND";
  const byId = new Map(rows.map((row) => [row.id, row]));
  const results = (await Promise.all(files.filter(({ attachmentId }) => claimed.has(attachmentId)).map(async (file) => {
    const row = byId.get(file.attachmentId)!;
    try {
      const object = file.kind === "single" ? await env.EVIDENCE.head(row.object_key)
        : await env.EVIDENCE.resumeMultipartUpload(row.object_key, row.r2_upload_id!).complete(file.parts
          .map(({ partNumber, etag }) => ({ partNumber, etag: etagWithoutQuotes(etag) })).sort((a, b) => a.partNumber - b.partNumber));
      return object ? verified(row, object) : null;
    } catch {
      // Do not repeat an ambiguous completion. Recovery probes this exact key.
      return null;
    }
  }))).filter((result) => result !== null);
  const saved = await saveResults(ctx, access, "verifying", results);
  return files.map(({ attachmentId }) => {
    const row = byId.get(attachmentId)!;
    return ack(row, saved.get(row.id) ?? row.state);
  });
}

// The Worker binding has no ListParts API. Use one authenticated, bounded S3
// GET for this known upload ID only, and never expose this URL to the client.
async function listParts(signer: R2Presigner, row: AttachmentRow, now: number): Promise<MultipartRecovery | null> {
  const url = await signer({ method: "GET", key: row.object_key, signedAt: now, expiresAt: now + 30_000,
    query: { uploadId: row.r2_upload_id!, "max-parts": String(mediaLimits.parts) } });
  const response = await fetch(url, { redirect: "error", cache: "no-store" });
  const xml = await response.text();
  if (response.status === 404 && /<Code>\s*NoSuchUpload\s*<\/Code>/.test(xml)) return null;
  if (!response.ok || !/<ListPartsResult(?:\s[^>]*)?>[\s\S]*<\/ListPartsResult>\s*$/.test(xml)
    || !/<IsTruncated>\s*false\s*<\/IsTruncated>/.test(xml)) throw new Error("Invalid R2 ListParts result");
  const completedParts: R2UploadedPart[] = [];
  const complete = new Set<number>();
  for (const [, part] of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
    const partNumber = Number(/<PartNumber>(\d+)<\/PartNumber>/.exec(part!)?.[1]);
    const size = Number(/<Size>(\d+)<\/Size>/.exec(part!)?.[1]);
    const etag = /<ETag>(?:&quot;|")?([A-Za-z0-9-]{1,126})(?:&quot;|")?<\/ETag>/.exec(part!)?.[1];
    if (!etag || !Number.isInteger(partNumber) || partNumber < 1 || complete.has(partNumber) || size !== partSize(row.bytes, partNumber) || size <= 0) {
      throw new Error("Invalid R2 multipart part metadata");
    }
    complete.add(partNumber);
    completedParts.push({ partNumber, etag });
  }
  const missingPartNumbers = Array.from({ length: Math.ceil(row.bytes / partBytes) }, (_, i) => i + 1).filter((n) => !complete.has(n));
  return { kind: "multipart", completedParts, missingPartNumbers };
}

export async function recoverMedia(ctx: RequestScope, session: SessionAccess, env: Bindings,
  { stageId, files }: RecoverInput): Promise<Recovery[] | MediaFailure> {
  const access = stageAccess(ctx, session, stageId);
  const { status, rows, claimed } = await claim(ctx, access, files, "recover");
  if (!status.signed_in) return "UNAUTHENTICATED";
  if (!status.in_scope || rows.length !== files.length) return "NOT_FOUND";
  const byId = new Map(rows.map((row) => [row.id, row]));
  let signer: R2Presigner | null | undefined;
  const checks = await Promise.all(files.map(async ({ attachmentId }) => {
    const row = byId.get(attachmentId)!;
    const multipart = row.bytes > singleBytes;
    try {
      if (claimed.has(row.id)) {
        const object = await env.EVIDENCE.head(row.object_key);
        if (object) return { row, result: verified(row, object) };
        if (!multipart) return { row, result: { id: row.id, upload_generation: row.upload_generation, state: "uploading" } as const,
          transfer: { kind: "single", object: "missing" } as const };
        // A missing final object after ambiguous completion does not tell us
        // whether the known session still exists or which parts it retained.
      } else if (row.state !== "uploading" || !multipart) return { row };
      signer ??= createR2Presigner(env);
      if (!signer || !row.r2_upload_id) return { row, failed: true };
      const transfer = await listParts(signer, row, ctx.now);
      if (!claimed.has(row.id)) return transfer ? { row, transfer } : { row, failed: true };
      const result: MediaResult = { id: row.id, upload_generation: row.upload_generation, state: transfer ? "uploading" : "rejected" };
      return { row, result, ...(transfer ? { transfer } : {}) };
    } catch {
      return { row, failed: true };
    }
  }));
  const saved = await saveResults(ctx, access, "verifying", checks.flatMap(({ result }) => result ? [result] : []));
  if (checks.some(({ failed }) => failed)) return "UNAVAILABLE";
  const outcomes = checks.map(({ row, transfer }): Recovery | null => {
    const state = saved.get(row.id) ?? row.state;
    const reservation = { attachmentId: row.id as Recovery["attachmentId"], uploadGeneration: row.upload_generation };
    if (state !== "uploading") return { ...reservation, state };
    return transfer ? { ...reservation, state, transfer } : null;
  });
  return outcomes.every((outcome) => outcome !== null) ? outcomes : "UNAVAILABLE";
}
