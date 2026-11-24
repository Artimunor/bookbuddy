import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../ui";
import { usePortal } from "../now/common";
import { canRecordVoice, captureVoice } from "./capture";
import { preparePhoto, prepareVoice, uploadMedia, type PendingMedia } from "./upload";

export type SelectedMedia = { id: string; kind: "photo" | "voice" };
export function MediaPicker({ caller, parentScopeId, stageId, value, onChange, onBusyChange, disabled = false }: { caller: "request" | "case"; parentScopeId: string; stageId: string; value: SelectedMedia[]; onChange: (value: SelectedMedia[]) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean }) {
  const { api, t } = usePortal();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stopRecording, setStopRecording] = useState<(() => void) | null>(null);
  const pending = useRef<PendingMedia[]>([]);
  const batchStage = useRef<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => { onBusyChange?.(busy || (failed && pending.current.length > 0)); }, [busy, failed, onBusyChange]);
  useLayoutEffect(() => () => { active.current?.abort(); }, []);

  async function run(prepare: (signal: AbortSignal) => Promise<PendingMedia[]>) {
    if (active.current || disabled) return;
    const controller = new AbortController();
    const { signal } = controller;
    active.current = controller;
    setBusy(true); setFailed(false);
    try {
      const items = await prepare(signal);
      signal.throwIfAborted();
      if (!items.length) return;
      pending.current = items;
      const stage = batchStage.current ??= `${stageId}_${crypto.randomUUID()}`;
      const ids = await uploadMedia(api, stage, { caller, parentScopeId }, items, signal);
      signal.throwIfAborted();
      onChange([...value, ...items.filter(item => ids.includes(item.attachmentId)).map(item => ({ id: item.attachmentId, kind: item.file.kind }))]);
      pending.current = []; batchStage.current = null;
    } catch {
      if (!signal.aborted) setFailed(true);
    } finally {
      if (!signal.aborted) { active.current = null; setBusy(false); setStopRecording(null); }
    }
  }
  function photos(list: FileList | null) {
    if (!list?.length) return;
    const selected = Array.from(list).slice(0, Math.max(0, 5 - value.filter(item => item.kind === "photo").length));
    void run(() => Promise.all(selected.map(preparePhoto)));
  }
  function start() {
    void run(async signal => {
      const voice = await captureVoice(signal, stop => setStopRecording(() => stop));
      signal.throwIfAborted();
      setStopRecording(null);
      return [prepareVoice(voice.blob, voice.durationMs)];
    });
  }
  return <section className="space-y-3">
    <h2>{t("web.portal.media.title")}</h2><p>{t("web.portal.media.hint")}</p>
    <label className="block">{t("web.portal.media.addPhotos")}
      <input className="block" type="file" accept="image/*" capture="environment" multiple
        disabled={disabled || busy || !!pending.current.length || value.filter(item => item.kind === "photo").length >= 5}
        onChange={event => { photos(event.currentTarget.files); event.currentTarget.value = ""; }} />
    </label>
    {canRecordVoice() && (stopRecording ? <Button onClick={stopRecording}>{t("web.portal.media.stop")}</Button>
      : <Button disabled={disabled || busy || !!pending.current.length || value.some(item => item.kind === "voice")} onClick={start}>{t("web.portal.media.record")}</Button>)}
    {busy && !stopRecording && <p role="status">{t("web.portal.media.uploading")}</p>}
    {failed && <p role="alert">{t("web.portal.media.failed")}</p>}
    {failed && pending.current.length > 0 && <>
      <Button disabled={disabled || busy} onClick={() => void run(async () => pending.current)}>{t("web.portal.media.retry")}</Button>
      <Button disabled={busy} onClick={() => { pending.current = []; batchStage.current = null; setFailed(false); }}>{t("web.portal.media.remove")}</Button>
    </>}
    <ul>{value.map((item, index) => <li key={item.id}>{item.kind === "photo" ? t("web.portal.media.photo") : t("web.portal.media.voice")} {index + 1} <Button disabled={disabled || busy} onClick={() => onChange(value.filter(entry => entry.id !== item.id))}>{t("web.portal.media.remove")}</Button></li>)}</ul>
  </section>;
}
