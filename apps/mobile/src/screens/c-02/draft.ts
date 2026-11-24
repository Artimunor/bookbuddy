import { useCallback, useEffect, useRef, useState } from "react";
import { useDraft, useRepository } from "../../repository/hooks";

export type RequestDraft = {
  step: "describe" | "place" | "review";
  description: string;
  language: string;
  placeId: string;
  arrivalArrangement: "nobody" | "requester" | "someone_else";
  arrivalContactName: string;
  safeNote: string;
  attachments: [];
  pendingOperation: { id: string; revision: number } | null;
};
export const emptyDraft: RequestDraft = { step: "describe", description: "", language: "", placeId: "", arrivalArrangement: "requester", arrivalContactName: "", safeNote: "", attachments: [], pendingOperation: null };

// Serialize every edit, including the operation marker, before navigation or sending.
export function useRequestDraft() {
  const storage = useDraft<RequestDraft>("request:new");
  const repo = useRepository();
  const [value, setValue] = useState<RequestDraft>(emptyDraft);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const sequence = useRef(0);
  useEffect(() => {
    let active = true;
    setLoaded(false); setValue(emptyDraft); setSaved(false); setFailed(false); sequence.current++;
    if (repo) void repo.getDraft<RequestDraft>("request:new").then(draft => {
      if (!active) return;
      if (draft) { setValue({ ...emptyDraft, ...draft.value }); setSaved(true); }
      setLoaded(true);
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [repo]);
  const change = useCallback((next: RequestDraft) => {
    setValue(next); setSaved(false); setFailed(false);
    const current = ++sequence.current;
    const write = queue.current.catch(() => {}).then(() => storage.save(next));
    queue.current = write;
    void write.then(() => { if (current === sequence.current) setSaved(true); }, () => { if (current === sequence.current) setFailed(true); });
    return write;
  }, [storage.save]);
  const remove = useCallback(async () => { await queue.current.catch(() => {}); await storage.remove(); }, [storage.remove]);
  return { value, saved, failed, loaded, warn: storage.warn, change, remove };
}
