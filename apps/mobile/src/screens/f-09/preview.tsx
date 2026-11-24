import type { ScreenPreview } from "../../preview/screens/types";
import { availableMember, conflictMember, ineligibleMember, rosterMember } from "./fixtures";
import { CrewMemberView } from "./Screen";
const noop = () => {}; const props = { status: "ready" as const, onBack: noop, onRetry: noop, onSelect: noop, onMessage: noop, onReview: noop };
export const previews: ScreenPreview[] = [
  { id: "F-09", state: "available", render: () => <CrewMemberView {...props} data={availableMember} /> },
  { id: "F-09", state: "conflict", render: () => <CrewMemberView {...props} data={conflictMember} /> },
  { id: "F-09", state: "not-eligible", render: () => <CrewMemberView {...props} data={ineligibleMember} /> },
  { id: "F-09", state: "roster", render: () => <CrewMemberView {...props} onSelect={undefined} data={rosterMember} /> },
];
