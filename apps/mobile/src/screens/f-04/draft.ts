import { useCallback, useEffect, useRef, useState } from "react";
import { useDraft, useRepository } from "../../repository/hooks";
import type { DraftKey, DraftValue } from "../../repository/repository";

// Serialize writes so a slow earlier save cannot replace a later edit.
export function useLocalDraft<T extends { [key: string]: DraftValue }>(key: DraftKey, initial: T) {
  const storage = useDraft<T>(key);
  const repo = useRepository();
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const touched = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const sequence = useRef(0);
  const previousScope = useRef({ key, repo });
  const scopeChanged = previousScope.current.key !== key || previousScope.current.repo !== repo;
  useEffect(() => {
    if (previousScope.current.key !== key || previousScope.current.repo !== repo) {
      previousScope.current = { key, repo }; touched.current = false; sequence.current++;
      setValue(initial); setSaved(false); setFailed(false);
    }
  }, [key, repo, initial]);
  useEffect(() => { if (!touched.current && storage.draft) { touched.current = true; setValue(storage.draft.value); setSaved(true); } }, [storage.draft]);
  const change = useCallback((next: T) => {
    touched.current = true; setValue(next); setSaved(false); setFailed(false);
    const current = ++sequence.current;
    queue.current = queue.current.catch(() => {}).then(() => storage.save(next)).then(
      () => { if (sequence.current === current) setSaved(true); },
      () => { if (sequence.current === current) setFailed(true); },
    );
  }, [storage.save]);
  const remove = useCallback(async () => { await queue.current.catch(() => {}); await storage.remove(); }, [storage.remove]);
  return { value: scopeChanged ? initial : value, change, saved: !scopeChanged && saved, failed: !scopeChanged && failed, remove };
}

export function minorAmount(text: string, signed = false): number | null {
  const value = text.trim().replace(",", ".");
  if (!(signed ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/).test(value)) return null;
  const n = Number(value); const minor = Math.round(n * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}
