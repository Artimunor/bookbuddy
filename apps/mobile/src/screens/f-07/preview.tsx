import type { ScreenPreview } from "../../preview/screens/types";
import { candidates, offered } from "../f-09/fixtures";
import { AssignCrewView } from "./Screen";
const noop = () => {}; const props = { status: "ready" as const, commandState: "idle" as const, selected: [], stale: false, onFilter: noop, onToggle: noop, onSend: noop, onWithdraw: noop, onProfile: noop, onSchedule: noop, onReview: noop, onClose: noop, onRetry: noop };
export const previews: ScreenPreview[] = [
  { id: "F-07", state: "eligible", render: () => <AssignCrewView {...props} data={candidates} filter="eligible" /> },
  { id: "F-07", state: "ineligible", render: () => <AssignCrewView {...props} data={candidates} filter="ineligible" /> },
  { id: "F-07", state: "offers-out", render: () => <AssignCrewView {...props} data={offered} filter="eligible" /> },
];
