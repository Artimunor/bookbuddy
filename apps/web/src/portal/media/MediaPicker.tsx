import { createApiClient } from "@bookbuddy/api-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../ui";
import { usePortal } from "../now/common";
import { preparePhoto, prepareVoice, uploadMedia, type PendingMedia } from "./upload";

export type SelectedMedia = { id: string; kind: "photo" | "voice" };
export function MediaPicker({ caller, parentScopeId, stageId, value, onChange, onBusyChange, disabled = false }: { caller: "request" | "case"; parentScopeId: string; stageId: string; value: SelectedMedia[]; onChange: (value: SelectedMedia[]) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean }) {
  const { locale, t } = usePortal();
  const api = useMemo(() => createApiClient({ baseUrl: "/api/v1", getSession: () => null, getLocale: () => locale }), [locale]);
  const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false); const [recording, setRecording] = useState(false);
  const pending = useRef<PendingMedia[]>([]); const batchStage = useRef(`${stageId}_${crypto.randomUUID()}`); const recorder = useRef<MediaRecorder | null>(null); const stream = useRef<MediaStream | null>(null); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { onBusyChange?.(busy || recording || (failed && pending.current.length > 0)); }, [busy, recording, failed, onBusyChange]);
  useEffect(() => () => { clearTimeout(timer.current ?? undefined); if (recorder.current) { recorder.current.onstop = null; if (recorder.current.state === "recording") recorder.current.stop(); } stream.current?.getTracks().forEach(track => track.stop()); }, []);
  async function send(items: PendingMedia[]) {
    if (!items.length) return;
    pending.current = items; setBusy(true); setFailed(false);
    try { const ids = await uploadMedia(api, batchStage.current, { caller, parentScopeId }, items); onChange([...value, ...items.filter(item => ids.includes(item.attachmentId)).map(item => ({ id: item.attachmentId, kind: item.file.kind }))]); pending.current = []; batchStage.current = crypto.randomUUID(); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  }
  async function photos(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true); setFailed(false);
    try { const selected = Array.from(list).slice(0, Math.max(0, 5 - value.filter(item => item.kind === "photo").length)); await send(await Promise.all(selected.map(preparePhoto))); }
    catch { setFailed(true); } finally { setBusy(false); }
  }
  async function start() {
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = media;
      const choice = ["audio/webm", "audio/mp4", "audio/ogg"].find(type => MediaRecorder.isTypeSupported(type));
      if (!choice) { media.getTracks().forEach(track => track.stop()); throw new Error("Recording unsupported"); }
      const instance = new MediaRecorder(media, { mimeType: choice }); recorder.current = instance; const chunks: Blob[] = []; const started = Date.now();
      instance.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      instance.onstop = () => { clearTimeout(timer.current ?? undefined); media.getTracks().forEach(track => track.stop()); stream.current = null; setRecording(false); try { void send([prepareVoice(new Blob(chunks, { type: choice }), Math.min(90_000, Date.now() - started))]); } catch { setFailed(true); } };
      instance.start(); setRecording(true); timer.current = setTimeout(() => instance.stop(), 90_000);
    } catch { setFailed(true); }
  }
  const supported = typeof MediaRecorder !== "undefined" && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && ["audio/webm", "audio/mp4", "audio/ogg"].some(type => MediaRecorder.isTypeSupported(type));
  return <section className="space-y-3"><h2>{t("web.portal.media.title")}</h2><p>{t("web.portal.media.hint")}</p><label className="block">{t("web.portal.media.addPhotos")}<input className="block" type="file" accept="image/*" capture="environment" multiple disabled={disabled || busy || recording || !!pending.current.length || value.filter(item => item.kind === "photo").length >= 5} onChange={event => { void photos(event.currentTarget.files); event.currentTarget.value = ""; }} /></label>{supported && (recording ? <Button onClick={() => recorder.current?.stop()}>{t("web.portal.media.stop")}</Button> : <Button disabled={disabled || busy || !!pending.current.length || value.some(item => item.kind === "voice")} onClick={() => void start()}>{t("web.portal.media.record")}</Button>)}{busy && <p role="status">{t("web.portal.media.uploading")}</p>}{failed && <p role="alert">{t("web.portal.media.failed")}</p>}{failed && pending.current.length > 0 && <><Button disabled={busy} onClick={() => void send(pending.current)}>{t("web.portal.media.retry")}</Button><Button disabled={busy} onClick={() => { pending.current = []; batchStage.current = crypto.randomUUID(); setFailed(false); }}>{t("web.portal.media.remove")}</Button></>}<ul>{value.map((item, index) => <li key={item.id}>{item.kind === "photo" ? t("web.portal.media.photo") : t("web.portal.media.voice")} {index + 1} <Button disabled={disabled || busy} onClick={() => onChange(value.filter(entry => entry.id !== item.id))}>{t("web.portal.media.remove")}</Button></li>)}</ul></section>;
}
