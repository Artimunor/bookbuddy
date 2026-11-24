import { createMediaClient } from "@bookbuddy/api-client";
import type { MediaCaller, MediaReadGrant } from "@bookbuddy/api-contract";
import { useMemo, useState } from "react";
import { Button, Dialog } from "../../ui";
import { usePortal } from "../now/common";

export { MediaPicker } from "./MediaPicker";
export type { SelectedMedia } from "./MediaPicker";

type Attachment = { attachmentId: string; available: boolean; photo?: boolean; caption?: string };
type ReadyGrant = Extract<MediaReadGrant, { state: "ready" }>;
export function MediaViewer({ grant, caption, close }: { grant: ReadyGrant; caption?: string; close: () => void }) {
  const { t } = usePortal(); const [zoom, setZoom] = useState(1);
  return <Dialog open onOpenChange={open => { if (!open) close(); }} title={t("web.portal.media.viewer")} closeLabel={t("web.portal.media.close")}>{grant.file.kind === "photo" ? <><div className="overflow-auto"><img src={grant.url} alt={caption || t("web.portal.media.photo")} style={{ width: `${zoom * 100}%`, maxWidth: "none" }} /></div><Button disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 0.5))}>{t("web.portal.media.zoomOut")}</Button><Button disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.5))}>{t("web.portal.media.zoomIn")}</Button></> : <><audio controls src={grant.url} /><p>{t("web.portal.media.transcriptUnavailable")}</p></>}{caption && <p dir="auto">{caption}</p>}</Dialog>;
}

/** Fetch the whole visible group on the first open; capabilities stay in memory only. */
export function AttachmentThumb({ caller, parentScopeId, attachments }: { caller: MediaCaller; parentScopeId: string; attachments: Attachment[] }) {
  const { api, t } = usePortal(); const client = useMemo(() => createMediaClient(api), [api]);
  const [grants, setGrants] = useState<MediaReadGrant[]>([]); const [selected, setSelected] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  async function open(id: string) {
    if (busy) return;
    const current = grants.find(item => item.attachmentId === id && item.state === "ready" && item.expiresAt > Date.now());
    if (current) { setSelected(id); return; }
    setBusy(true); setFailed(false);
    const result = await client.createReadGrants({ scope: { caller, parentScopeId }, attachmentIds: attachments.filter(item => item.available).map(item => item.attachmentId) });
    setBusy(false);
    if (!result.ok) { setFailed(true); return; }
    setGrants(result.data.grants);
    if (result.data.grants.some(item => item.attachmentId === id && item.state === "ready")) setSelected(id); else setFailed(true);
  }
  const grant = grants.find((item): item is ReadyGrant => item.attachmentId === selected && item.state === "ready");
  return <div>{attachments.map(item => { const preview = grants.find((value): value is ReadyGrant => value.state === "ready" && value.file.kind === "photo" && value.attachmentId === item.attachmentId && value.expiresAt > Date.now()); return <Button key={item.attachmentId} disabled={!item.available || busy} onClick={() => void open(item.attachmentId)}>{preview && <img className="h-20 w-20 object-cover" src={preview.url} alt="" />}{item.photo ? t("web.portal.closeout.openPhoto") : t("web.portal.closeout.openEvidence")}</Button>; })}{failed && <p role="alert">{t("web.portal.closeout.photoUnavailable")}</p>}{grant && <MediaViewer key={grant.attachmentId} grant={grant} caption={attachments.find(item => item.attachmentId === grant.attachmentId)?.caption} close={() => setSelected(null)} />}</div>;
}

