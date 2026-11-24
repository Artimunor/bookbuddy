import { idSchemaFor } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { trackPhoto } from "../c-02/attachment-fixtures";
import { visit } from "../f-05/preview";
import { ShareUpdateView } from "./Screen";
const start = Date.parse("2026-11-24T08:10:00Z");
const before = { ...visit, customerZone: "Europe/London", work: null, crew: [], workGate: { status: "not_on_site" as const }, customerPreview: { ...visit.customerPreview, live: { step: "confirmed" as const, status: "confirmed" as const, since: null, source: null, arrival: null, nextUpdateAt: null } }, permittedUpdates: ["on_the_way", "photo"] as ("on_the_way" | "photo")[] };
const late = { ...before, customerPreview: { ...before.customerPreview, live: { ...before.customerPreview.live, step: "on_the_way" as const, status: "on_the_way" as const, arrival: { id: idSchemaFor<"customer_update">().parse("update-1"), kind: "on_the_way" as const, recordedAt: start - 1080000, sharedByName: "Mateo Ruiz", band: { startsAt: start, endsAt: start + 600000 } } } }, permittedUpdates: ["arrival_revised", "arrival_withdrawn", "photo"] as ("arrival_revised" | "arrival_withdrawn" | "photo")[] };
const noop = () => {};
const props = { status: "ready" as const, commandState: "idle" as const, now: start - 18 * 60_000, author: "Mateo Ruiz", providerName: "Reformas Ruiz", onClose: noop, onRetry: noop, onSend: noop, onRetract: noop };
const photo = { source: { attachmentId: "rollers", uri: trackPhoto, at: start + 25 * 60000, ready: true }, author: "Mateo Ruiz", caption: "Rodillos viejos retirados", language: "es", onAdd: noop, onOpen: noop, onCaption: noop, onLanguage: noop };
export const previews: ScreenPreview[] = [
  { id: "F-17", state: "on-the-way", render: () => <ShareUpdateView {...props} data={before} initialKind="on_the_way" initialBand={{ startsAt: start, endsAt: start + 600000 }} /> },
  { id: "F-17", state: "running-late", render: () => <ShareUpdateView {...props} now={start - 4 * 60_000} data={late} initialKind="arrival_revised" initialBand={{ startsAt: start + 15 * 60_000, endsAt: start + 25 * 60_000 }} /> },
  { id: "F-17", state: "photo", render: () => <ShareUpdateView {...props} data={before} initialKind="photo" photo={photo} /> },
  { id: "F-17", state: "photo-offline", render: () => <ShareUpdateView {...props} status="offline" data={before} initialKind="photo" photo={photo} /> },
  { id: "F-17", state: "sent", render: () => <ShareUpdateView {...props} data={late} visible={false} /> },
];
