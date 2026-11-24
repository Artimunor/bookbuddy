import { idSchema } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useIsFocused, useLocalSearchParams, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDraft, useRepository } from "../../repository/hooks";
import type { ScopedRepository } from "../../repository";

export type RequestDraft = {
  step: "describe" | "place" | "review";
  description: string;
  language: string;
  placeId: string;
  arrivalArrangement: "nobody" | "requester" | "someone_else";
  arrivalContactName: string;
  safeNote: string;
  attachments: [];
  mediaPlaceId?: string;
  mediaStages?: string[];
  omittedMedia?: string[];
  pendingOperation: { id: string; revision: number } | null;
};
export const emptyDraft: RequestDraft = { step: "describe", description: "", language: "", placeId: "", arrivalArrangement: "requester", arrivalContactName: "", safeNote: "", attachments: [], pendingOperation: null };

export function requestDraftHref(step: RequestDraft["step"], draftId: string, params: {
  mode?: "voice" | "photo"; returnTo?: "review"; changed?: "1";
} = {}): Href {
  return { pathname: `/c/request/${step}`, params: { draftId, ...params } } as Href;
}

export async function savedRequestHref(repo: ScopedRepository | null, draftId: string): Promise<Href | null> {
  if (!repo?.isActive) return null;
  const row = await repo.getDraft<RequestDraft>(`request:${draftId}`);
  return row && repo.isActive ? requestDraftHref(row.value.step, draftId) : null;
}

// Serialize every edit, including the operation marker, before navigation or sending.
export function useRequestDraft() {
  const { draftId: rawId } = useLocalSearchParams<{ draftId?: string }>();
  const parsed = idSchema.safeParse(rawId);
  const routeId = parsed.success && parsed.data !== "new" ? parsed.data : undefined;
  const [initialId] = useState(() => routeId ?? uuid.v4());
  const draftId = routeId ?? initialId;
  const storage = useDraft<RequestDraft>(`request:${draftId}`);
  const repo = useRepository();
  const focused = useIsFocused();
  const [value, setValue] = useState<RequestDraft>(emptyDraft);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hydrated, setHydrated] = useState<{ repo: ScopedRepository; draftId: string } | null>(null);
  const loaded = !!repo?.isActive && hydrated?.repo === repo && hydrated.draftId === draftId;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const sequence = useRef(0);
  const unsaved = useRef(false);
  const hydratedDraft = useRef(storage.draft);
  useEffect(() => {
    if (!repo || !focused || !storage.loaded || (loaded && (unsaved.current || storage.draft === hydratedDraft.current))) return;
    if (!loaded) { sequence.current++; unsaved.current = false; }
    hydratedDraft.current = storage.draft;
    setValue(storage.draft ? { ...emptyDraft, ...storage.draft.value } : emptyDraft);
    setSaved(storage.draft !== null);
    setFailed(false);
    setHydrated({ repo, draftId });
  }, [repo, draftId, focused, loaded, saved, storage.loaded, storage.draft]);
  const change = useCallback((next: RequestDraft) => {
    setValue(next); setSaved(false); setFailed(false);
    unsaved.current = true;
    const current = ++sequence.current;
    const write = queue.current.catch(() => {}).then(() => storage.save(next));
    queue.current = write;
    void write.then(() => {
      if (current === sequence.current) { unsaved.current = false; setSaved(true); }
    }, () => { if (current === sequence.current) setFailed(true); });
    return write;
  }, [storage.save]);
  const remove = useCallback(async () => { await queue.current.catch(() => {}); await storage.remove(); }, [storage.remove]);
  return { draftId, value: loaded ? value : emptyDraft, saved: loaded && saved, failed: loaded && failed, loaded, warn: storage.warn, change, remove };
}
