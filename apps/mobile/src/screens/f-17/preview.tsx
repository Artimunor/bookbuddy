import { idSchemaFor } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { visit } from "../f-05/preview";
import { ShareUpdateView } from "./Screen";
const start = Date.parse("2026-11-24T08:10:00Z");
const before = { ...visit, work: null, crew: [], workGate: { status: "not_on_site" as const }, customerPreview: { ...visit.customerPreview, live: { step: "confirmed" as const, status: "confirmed" as const, since: null, source: null, arrival: null, nextUpdateAt: null } }, permittedUpdates: ["on_the_way", "photo"] as ("on_the_way" | "photo")[] };
const late = { ...before, customerPreview: { ...before.customerPreview, live: { ...before.customerPreview.live, step: "on_the_way" as const, status: "on_the_way" as const, arrival: { id: idSchemaFor<"customer_update">().parse("update-1"), kind: "on_the_way" as const, recordedAt: start - 1080000, sharedByName: "Mateo Ruiz", band: { startsAt: start, endsAt: start + 600000 } } } }, permittedUpdates: ["arrival_revised", "arrival_withdrawn", "photo"] as ("arrival_revised" | "arrival_withdrawn" | "photo")[] };
const noop = () => {};
const props = { status: "ready" as const, commandState: "idle" as const, onClose: noop, onRetry: noop, onSend: noop, onRetract: noop };
export const previews: ScreenPreview[] = [
  { id: "F-17", state: "on-the-way", render: () => <ShareUpdateView {...props} data={before} initialKind="on_the_way" initialBand={{ startsAt: start, endsAt: start + 600000 }} /> },
  { id: "F-17", state: "running-late", render: () => <ShareUpdateView {...props} data={late} initialKind="arrival_revised" /> },
  { id: "F-17", state: "photo", render: () => <ShareUpdateView {...props} data={before} initialKind="photo" /> },
  { id: "F-17", state: "sent", render: () => <ShareUpdateView {...props} data={late} visible={false} /> },
];
