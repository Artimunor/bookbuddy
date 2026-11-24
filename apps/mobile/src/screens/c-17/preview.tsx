import { jobWindowsSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { confirmed, revised } from "../c-08/preview";
import { CancelView } from "./Screen";
const visit = confirmed.visits[0]!;
const requested = jobWindowsSchema.parse({ ...confirmed, visits: [{ ...visit, rescheduleRequest: { id: "request-1", state: "requested", requestedAt: Date.UTC(2026,10,23), replyBy: Date.UTC(2026,10,24) } }] });
const cancelled = jobWindowsSchema.parse({ ...confirmed, visits: [{ ...visit, state: "cancelled", cancellation: { at: Date.UTC(2026,10,23), byViewer: true }, actions: { canCancelFeeFree: false, canRequestReschedule: false } }] });
const noop = () => {}; const props = { status: "ready" as const, twoClock: true, viewerZone: "Europe/London", onChoice: noop, onClose: noop, onAction: noop };
export const previews: ScreenPreview[] = [
 { id: "C-17", state: "reschedule", render: () => <CancelView {...props} data={revised} choice="reschedule" /> },
 { id: "C-17", state: "cancel", render: () => <CancelView {...props} data={confirmed} choice="cancel" /> },
 { id: "C-17", state: "needs-provider-agreement", render: () => <CancelView {...props} data={confirmed} choice="reschedule" /> },
 { id: "C-17", state: "requested", render: () => <CancelView {...props} data={requested} choice="reschedule" /> },
 { id: "C-17", state: "cancelled", render: () => <CancelView {...props} data={cancelled} choice="cancel" /> },
];
