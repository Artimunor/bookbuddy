import type { ScreenPreview } from "../../preview/screens/types";
import { roster } from "../f-09/fixtures";
import { CrewView } from "./Screen";
const noop = () => {}; const props = { status: "ready" as const, search: "", filter: "all" as const, canPrevious: false, onSearch: noop, onFilter: noop, onClear: noop, onNext: noop, onPrevious: noop, onMember: noop, onRetry: noop };
export const previews: ScreenPreview[] = [
  { id: "F-08", state: "active", render: () => <CrewView {...props} data={roster} /> },
  { id: "F-08", state: "unavailable", render: () => <CrewView {...props} data={{ ...roster, members: roster.members.filter(m => m.status.state === "unavailable") }} /> },
  { id: "F-08", state: "review-pending", render: () => <CrewView {...props} data={{ ...roster, members: roster.members.filter(m => m.status.state === "not_assignable") }} /> },
];
