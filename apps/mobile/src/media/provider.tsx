import { createMediaClient } from "@bookbuddy/api-client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { AppState } from "react-native";
import { useApiAccess } from "../api/provider";
import { useRepository } from "../repository/hooks";
import type { ScopedRepository } from "../repository/repository";
import { transferFiles } from "./files";
import { MediaQueue } from "./queue";
import type { AttachmentId, MediaScope } from "./types";

export type MediaPreviewText = {
  original: string;
  originalLanguage?: string;
  translation?: string;
  translationLanguage?: string;
};
export type MediaPreviewDetails = {
  titleContext?: string;
  author?: string;
  time?: string;
  originalLanguage?: string;
  caption?: MediaPreviewText;
  transcript?: MediaPreviewText;
};
type MediaPresentation = MediaScope & { attachmentId: AttachmentId; details: MediaPreviewDetails; repository: ScopedRepository };
type MediaAccess = {
  queue: (repository: ScopedRepository) => MediaQueue | null;
  preview: MediaPresentation | null;
  showPreview: Dispatch<SetStateAction<MediaPresentation | null>>;
};
const MediaContext = createContext<MediaAccess | null>(null);

export function MediaTransferProvider({ children }: { children: ReactNode }) {
  const repository = useRepository();
  const { client, requests, isOffline, offline } = useApiAccess();
  const runtime = useRef<{ repository: ScopedRepository; queue: MediaQueue } | null>(null);
  const priorOffline = useRef(offline);
  const [preview, showPreview] = useState<MediaPresentation | null>(null);

  useEffect(() => {
    if (!repository?.isActive || !client || !requests.active) return;
    let foreground = AppState.currentState !== "background" && AppState.currentState !== "inactive";
    const queue = new MediaQueue(repository, createMediaClient(client), transferFiles, () => foreground && requests.active && !isOffline());
    runtime.current = { repository, queue };
    const app = AppState.addEventListener("change", (state) => {
      const wasForeground = foreground;
      foreground = state === "active";
      if (foreground && !wasForeground) void queue.kick().catch(() => undefined);
    });
    const unsubscribe = repository.subscribe("media", () => { if (!repository.isActive) queue.stop(); });
    void queue.kick().catch(() => undefined);
    return () => { runtime.current = null; unsubscribe(); app.remove(); queue.stop(); };
  }, [repository, client, requests, isOffline]);

  useEffect(() => {
    const reconnect = priorOffline.current && !offline;
    priorOffline.current = offline;
    if (reconnect) void runtime.current?.queue.kick().catch(() => undefined);
  }, [offline]);

  useEffect(() => { showPreview((value) => value?.repository === repository ? value : null); }, [repository, requests]);
  const queue = useCallback((scope: ScopedRepository) => runtime.current?.repository === scope ? runtime.current.queue : null, []);
  const access = useMemo(() => ({ queue, preview, showPreview }), [queue, preview]);
  return <MediaContext.Provider value={access}>{children}</MediaContext.Provider>;
}

export function useMediaAccess() {
  const context = useContext(MediaContext);
  if (!context) throw new Error("MediaTransferProvider is required");
  return context;
}
