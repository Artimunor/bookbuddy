import { attachmentIdSchema, mediaFileSchema, mediaLimits, mediaScopeSchema, mediaStageIdSchema, operationIdSchema } from "@bookbuddy/api-contract";
import type { MediaCaller } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRepository } from "../repository/hooks";
import type { ScopedRepository } from "../repository/repository";
import { prepareLocalMediaFile, releaseMediaCapture, transferFiles } from "./files";
import { useMediaAccess } from "./provider";
import { allowsVoice, photoResizeTarget } from "./types";
import type { AttachmentId, MediaScope, MediaStageId, MediaTransfer, TransferQuery } from "./types";

export type AttachSource = "camera" | "library" | { kind: "voice"; uri: string; durationMs: number };
export type PickResult =
  | { status: "staged"; item: MediaTransfer }
  | { status: "cancelled" | "denied" | "tooLarge" | "draftLimit" | "storageFull" | "unavailable" };
const emptyTransfers: readonly MediaTransfer[] = [];

export function useTransferRows(query: TransferQuery | null) {
  const repo = useRepository();
  const subscribe = useCallback((listener: () => void) => query ? repo?.subscribe("media", listener) ?? (() => {}) : () => {}, [repo, query]);
  const getRevision = useCallback(() => query ? repo?.revision("media") ?? 0 : 0, [repo, query]);
  const revision = useSyncExternalStore(subscribe, getRevision, getRevision);
  const [result, setResult] = useState<{ repo: ScopedRepository; query: TransferQuery; revision: number; rows: MediaTransfer[] | null }>();
  useEffect(() => {
    if (!repo?.isActive || !query) return;
    let live = true;
    void repo.listMediaTransfers(query).then((rows) => { if (live) setResult({ repo, query, revision, rows }); }, () => {
      if (live) setResult({ repo, query, revision, rows: null });
    });
    return () => { live = false; };
  }, [repo, query, revision]);
  const current = repo?.isActive && query && result?.repo === repo && result.query === query ? result : null;
  return {
    rows: current?.rows ?? null,
    loaded: current?.revision === revision && current.rows !== null,
    failed: current?.revision === revision && current.rows === null,
  };
}

async function normalizePhoto({ uri, width, height }: ImagePicker.ImagePickerAsset) {
  const context = ImageManipulator.manipulate(uri);
  try {
    const resize = photoResizeTarget(width, height);
    if (resize) context.resize(resize);
    const image = await context.renderAsync();
    try {
      // A fresh JPEG contains pixels, not the picked file's GPS/EXIF metadata.
      return (await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 })).uri;
    } finally { image.release(); }
  } finally { context.release(); }
}

async function capturePhoto(source: "camera" | "library"): Promise<PickResult | { status: "photo"; uri: string }> {
  if (source === "camera" && !(await ImagePicker.requestCameraPermissionsAsync()).granted) return { status: "denied" };
  // The system library picker grants access only to the chosen asset on modern iOS/Android.
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsMultipleSelection: false, exif: false, quality: 1 };
  const result = await (source === "camera" ? ImagePicker.launchCameraAsync(options) : ImagePicker.launchImageLibraryAsync(options));
  const asset = result.assets?.[0];
  if (result.canceled || !asset) return { status: "cancelled" };
  try { return { status: "photo", uri: await normalizePhoto(asset) }; }
  finally { await releaseMediaCapture(asset.uri).catch(() => undefined); }
}

async function stage(repo: ScopedRepository, scope: MediaScope, source: AttachSource, stageId?: MediaStageId): Promise<PickResult> {
  let uri: string | undefined;
  let release: (() => void) | undefined;
  try {
    const voice = typeof source === "object";
    if (voice) {
      uri = source.uri;
      if (!allowsVoice(scope.caller)) return { status: "unavailable" };
    } else {
      const capture = await capturePhoto(source);
      if (capture.status !== "photo") return capture;
      uri = capture.uri;
    }
    if (!repo.isActive) return { status: "unavailable" };
    const attachmentId = attachmentIdSchema.parse(uuid.v4());
    const staged = await prepareLocalMediaFile(uri, attachmentId, voice ? "audio/mp4" : "image/jpeg",
      voice ? mediaLimits.voiceBytes : mediaLimits.photoBytes, repo.persistentAuthoring);
    if (!staged) return { status: "tooLarge" };
    release = staged.release;
    const file = mediaFileSchema.safeParse(voice
      ? { kind: "voice", mime: staged.mime, bytes: staged.bytes, durationMs: Math.max(1, Math.round(source.durationMs)) }
      : { kind: "photo", mime: staged.mime, bytes: staged.bytes });
    if (!file.success) return { status: "unavailable" };
    const result = await repo.createMediaTransfer({ ...scope, attachmentId, operationId: operationIdSchema.parse(uuid.v4()),
      stageId, fileUri: staged.fileUri, file: file.data }, staged.copy);
    return repo.isActive ? result : { status: "unavailable" };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    return { status: typeof code === "string" && code.includes("PERMISSION") ? "denied" : "unavailable" };
  } finally {
    if (uri) await releaseMediaCapture(uri).catch(() => undefined);
    release?.();
  }
}

export function useAttach(caller: MediaCaller | undefined, parentScopeId: string | undefined, draftStageId?: string) {
  const repo = useRepository();
  const { queue } = useMediaAccess();
  const scope = useMemo(() => mediaScopeSchema.safeParse({ caller, parentScopeId }).data, [caller, parentScopeId]);
  const stageId = useMemo(() => mediaStageIdSchema.safeParse(draftStageId).data, [draftStageId]);
  const validStage = draftStageId === undefined || stageId !== undefined;
  const query = useMemo(() => scope && validStage ? { ...scope, stageId } : null, [scope, validStage, stageId]);
  const { rows, loaded } = useTransferRows(query);
  const pick = useCallback((source: AttachSource): Promise<PickResult> => repo?.isActive && scope && validStage
    ? stage(repo, scope, source, stageId) : Promise.resolve({ status: "unavailable" }), [repo, scope, validStage, stageId]);
  const retry = useCallback(async (id: string) => {
    const attachmentId = attachmentIdSchema.safeParse(id).data;
    if (repo?.isActive && attachmentId) await queue(repo)?.retry(attachmentId);
  }, [repo, queue]);
  const remove = useCallback(async (id: string) => {
    const attachmentId = attachmentIdSchema.safeParse(id).data;
    if (!repo?.isActive || !attachmentId) return false;
    const runtime = queue(repo);
    const removed = await (runtime ? runtime.remove(attachmentId) : repo.removeMediaTransfer(attachmentId, transferFiles.erase));
    // Existing drafts rotate after a reservation was started, since its server
    // stage may still count the cancelled item until it expires.
    return removed && !rows?.find((item) => item.attachmentId === attachmentId)?.started;
  }, [repo, queue, rows]);
  return { pick, items: rows ?? emptyTransfers, loaded, retry, remove };
}

export function useDraftMediaActions() {
  const repo = useRepository();
  const { queue } = useMediaAccess();
  async function useInDraft(attachmentId: AttachmentId) {
    if (!repo?.isActive) return false;
    const selected = await repo.updateMediaTransfer(attachmentId, (item) => !item.selected && item.state === "queued" ? { selected: true } : null);
    if (!selected) return false;
    void queue(repo)?.kick().catch(() => undefined);
    return true;
  }
  async function removeFromDraft(attachmentId: AttachmentId) {
    if (!repo?.isActive) return false;
    const runtime = queue(repo);
    return runtime ? runtime.remove(attachmentId) : repo.removeMediaTransfer(attachmentId, transferFiles.erase);
  }
  return { useInDraft, removeFromDraft };
}
