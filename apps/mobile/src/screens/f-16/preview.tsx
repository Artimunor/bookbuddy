import { shiftDetailSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { ShiftView } from "./Screen";
const start = Date.UTC(2026, 10, 24, 8); const minute = 60000;
const shift = { id: "shift1", visitId: "visit1", job: { id: "job1", reference: "BB-1042", title: "Terrace door repair" }, startsAt: start, endsAt: start + 60 * minute, siteZone: "Europe/Madrid", placeAlias: "Villa Mar", task: "Terrace door repair", skill: "Door fitting", briefingLanguage: "es", state: "planned" };
const nadia = { id: "assignment1", source: "ordinary", state: "dropped", confirmedAt: start - 86400000, member: { id: "nadia", displayName: "Nadia Benali" }, confirmedByName: "Mateo Ruiz", droppedAt: start - 28 * minute, dropoutReason: "transport" };
const diego = { id: "assignment2", source: "cover", state: "confirmed", confirmedAt: start - 20 * minute, member: { id: "diego", displayName: "Diego Torres" }, confirmedByName: "Mateo Ruiz" };
const base = { view: "foreman", shift, slots: [{ id: "slot1", number: 1, isLead: false, assignments: [], pendingOffer: null }], holds: [], customerUpdate: { state: "not_shared" }, crewThreadId: null, nextAction: "assign_crew" };
const unassigned = shiftDetailSchema.parse(base); const dropped = shiftDetailSchema.parse({ ...base, slots: [{ ...base.slots[0], assignments: [nadia] }], nextAction: "find_cover" });
const covered = shiftDetailSchema.parse({ ...base, slots: [{ ...base.slots[0], assignments: [nadia, diego] }], holds: [{ id: "hold1", kind: "briefing", instruction: { id: "safety1", version: 1 }, assignmentId: "assignment2" }], customerUpdate: { state: "published", kind: "crew_updated", publishedAt: start - 20 * minute }, nextAction: "share_update" });
const confirmed = shiftDetailSchema.parse({ ...base, slots: [{ ...base.slots[0], assignments: [{ ...diego, source: "ordinary" }] }], nextAction: "share_update" });
if (unassigned.view !== "foreman" || dropped.view !== "foreman" || covered.view !== "foreman" || confirmed.view !== "foreman") throw new Error("Invalid preview");
const noop = () => {}; const props = { status: "ready" as const, gapId: "gap1", onBack: noop, onRetry: noop, onCover: noop, onAssign: noop, onShare: noop, onBriefing: noop, onLog: noop };
export const previews: ScreenPreview[] = [
  { id: "F-16", state: "unassigned", render: () => <ShiftView {...props} data={unassigned} /> },
  { id: "F-16", state: "dropped", render: () => <ShiftView {...props} data={dropped} /> },
  { id: "F-16", state: "confirmed", render: () => <ShiftView {...props} data={confirmed} /> },
  { id: "F-16", state: "covered", render: () => <ShiftView {...props} data={covered} /> },
];
