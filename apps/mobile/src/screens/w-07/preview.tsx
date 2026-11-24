import type { ScreenPreview } from "../../preview/screens/types";
import { BeaconThemeProvider } from "../../ui/theme";
import { trackPhoto } from "../c-02/attachment-fixtures";
import { ProgressPhotosView, type ProgressPhoto } from "./Screen";

const capturedAt = Date.UTC(2026, 10, 24, 8, 29);
const queuedAt = capturedAt + 120000;
const noop = () => {};
const photo = { id: "track", uri: trackPhoto, note: { text: "Carril inferior desgastado", language: "es", capturedAt }, open: noop };
const props = { job: "BB-1042 · Terrace door repair", recipient: "Mateo", confirmedTime: "09:29 · Europe/Madrid", time: (at: number) => at === capturedAt ? "09:29" : "09:31", canAdd: true, onBack: noop, onAdd: noop, onSend: noop, onNote: noop };
const variants: { state: string; item?: ProgressPhoto; offline?: boolean }[] = [
  { state: "empty" }, { state: "review", item: { ...photo, status: "review", remove: noop } },
  { state: "queued-offline", item: { ...photo, status: "queued", queuedAt, remove: noop }, offline: true },
  { state: "uploading", item: { ...photo, status: "uploading", queuedAt } },
  { state: "checking", item: { ...photo, status: "checking", queuedAt, retry: noop } },
  { state: "failed", item: { ...photo, status: "failed", queuedAt, remove: noop, retry: noop } },
  { state: "sent", item: { ...photo, status: "sent", receivedAt: queuedAt } },
];
export const previews: ScreenPreview[] = variants.map(({ state, item, offline }) => ({ id: "W-07", state, render: () => <BeaconThemeProvider field><ProgressPhotosView {...props} offline={!!offline} items={item ? [item] : []} /></BeaconThemeProvider> }));
