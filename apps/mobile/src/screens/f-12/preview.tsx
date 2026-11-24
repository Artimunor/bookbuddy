import type { ScreenPreview } from "../../preview/screens/types";
import { accepted, confirmed, noCover } from "../f-10/preview";
import { ConfirmCoverView } from "./Screen";
const noop = () => {};
const props = { status: "ready" as const, onClose: noop, onConfirm: noop, onShift: noop, onRetry: noop };
export const previews: ScreenPreview[] = [
  { id: "F-12", state: "ready", render: () => <ConfirmCoverView {...props} data={accepted} outcome={null} /> },
  { id: "F-12", state: "already-filled", render: () => <ConfirmCoverView {...props} data={confirmed} outcome="already_filled" /> },
  { id: "F-12", state: "no-longer-eligible", render: () => <ConfirmCoverView {...props} data={noCover} outcome="not_confirmed" /> },
  { id: "F-12", state: "confirmed", render: () => <ConfirmCoverView {...props} data={confirmed} outcome="confirmed" /> },
];
