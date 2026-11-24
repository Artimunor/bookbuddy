import { useCallback, useEffect, useRef, useState } from "react";
import { useDraft, useRepository } from "../../repository/hooks";
import type { DraftKey } from "../../repository/repository";

export type CaseDraft = { category: string; item: string; billId: string; description: string; share: boolean; mediaStages?: string[]; omittedMedia?: string[]; pending: { operationId: string; caseId: string; eventId: string; language: string; audience: "provider_billing" | "provider_rectification" | null } | null };
export function useCaseDraft(key: DraftKey, initial: CaseDraft) {
  const storage = useDraft<CaseDraft>(key); const repo = useRepository();
  const [value, setValue] = useState(initial); const [loaded, setLoaded] = useState(false); const [saved, setSaved] = useState(false); const [failed, setFailed] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve()); const sequence = useRef(0);
  useEffect(() => {
    let active = true; setLoaded(false); setValue(initial); setSaved(false); setFailed(false); sequence.current++;
    if (repo) void repo.getDraft<CaseDraft>(key).then(draft => { if (active) { if (draft) { setValue(draft.value); setSaved(true); } setLoaded(true); } }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [repo, key]);
  const change = useCallback((next: CaseDraft) => {
    setValue(next); setSaved(false); setFailed(false); const current = ++sequence.current;
    const write = queue.current.catch(() => {}).then(() => storage.save(next)); queue.current = write;
    void write.then(() => { if (sequence.current === current) setSaved(true); }, () => { if (sequence.current === current) setFailed(true); });
    return write;
  }, [storage.save]);
  const remove = useCallback(async () => { await queue.current.catch(() => {}); await storage.remove(); }, [storage.remove]);
  return { value, loaded, saved, failed, change, remove };
}
