import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Card, Glyph } from "../../ui";
import { usePortal } from "../now/common";
import { canRecordVoice, captureVoice } from "./capture";
import { preparePhoto, prepareVoice, uploadMedia, type PendingMedia } from "./upload";

export type SelectedMedia = { id: string; kind: "photo" | "voice" };
export function MediaPicker({ caller, parentScopeId, stageId, value, onChange, onBusyChange, disabled = false }: { caller: "request" | "case"; parentScopeId: string; stageId: string; value: SelectedMedia[]; onChange: (value: SelectedMedia[]) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean }) {
  const { api, t } = usePortal();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stopRecording, setStopRecording] = useState<(() => void) | null>(null);
  const [previews, setPreviews] = useState(() => new Map<string, Blob>());
  const input = useRef<HTMLInputElement>(null);
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
      const attached = items.filter(item => ids.includes(item.attachmentId));
      const photos = attached.filter(item => item.file.kind === "photo");
      if (photos.length) setPreviews(previous => {
        const next = new Map(previous);
        for (const photo of photos) next.set(photo.attachmentId, photo.blob);
        return next;
      });
      onChange([...value, ...attached.map(item => ({ id: item.attachmentId, kind: item.file.kind }))]);
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
  const photoDisabled = disabled || busy || !!pending.current.length || value.filter(item => item.kind === "photo").length >= 5;
  return <Card title={t("web.portal.media.title")}><div className="space-y-3">
    <p className="text-supporting text-muted">{t("web.portal.media.hint")}</p>
    <input ref={input} hidden type="file" accept="image/*" capture="environment" multiple disabled={photoDisabled}
      onChange={event => { photos(event.currentTarget.files); event.currentTarget.value = ""; }} />
    <div className="flex flex-wrap gap-3">
      <Button variant="secondary" disabled={photoDisabled} onClick={() => input.current?.click()}><Glyph name="photo" />{t("web.portal.media.addPhotos")}</Button>
      {canRecordVoice() && (stopRecording ? <Button onClick={stopRecording}>{t("web.portal.media.stop")}</Button>
        : <Button variant="secondary" disabled={disabled || busy || !!pending.current.length || value.some(item => item.kind === "voice")} onClick={start}>{t("web.portal.media.record")}</Button>)}
    </div>
    {busy && !stopRecording && <p className="text-supporting text-muted" role="status">{t("web.portal.media.uploading")}</p>}
    {failed && <p className="text-supporting text-critical-ink" role="alert">{t("web.portal.media.failed")}</p>}
    {failed && pending.current.length > 0 && <div className="flex flex-wrap gap-3">
      <Button variant="secondary" disabled={disabled || busy} onClick={() => void run(async () => pending.current)}>{t("web.portal.media.retry")}</Button>
      <Button variant="text" disabled={busy} onClick={() => { pending.current = []; batchStage.current = null; setFailed(false); }}>{t("web.portal.media.remove")}</Button>
    </div>}
    {value.length > 0 && <ul className="bb-inset-list">{value.map((item, index) => {
      const title = `${item.kind === "photo" ? t("web.portal.media.photo") : t("web.portal.media.voice")} ${index + 1}`;
      const preview = previews.get(item.id);
      return <li key={item.id} className="flex flex-wrap items-center gap-3">
        {preview ? <PhotoPreview blob={preview} /> : <span className="bb-stamp-icon"><Glyph name={item.kind === "photo" ? "photo" : "message"} /></span>}
        <span className="text-label">{title}</span>
        <Button variant="text" className="ms-auto" aria-label={`${t("web.portal.media.remove")}: ${title}`} disabled={disabled || busy}
          onClick={() => {
            if (preview) setPreviews(previous => { const next = new Map(previous); next.delete(item.id); return next; });
            onChange(value.filter(entry => entry.id !== item.id));
          }}>{t("web.portal.media.remove")}</Button>
      </li>;
    })}</ul>}
  </div></Card>;
}

function PhotoPreview({ blob }: { blob: Blob }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return src ? <img className="bb-stamp-photo" src={src} alt="" width={64} height={64} /> : null;
}
