import { safetyInstructionSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { briefing } from "../w-09/preview";
import { SafetyView } from "./Screen";
const issued = Date.UTC(2026, 10, 24, 7, 41); const verified = Date.UTC(2026, 10, 24, 8, 16); const version = briefing.instruction!.version;
const base = { instructionId: "instruction1", assignmentId: "assignment1", viewer: "worker", workerName: "Diego Torres", siteZone: "Europe/Madrid", version, original: { language: "es", text: "No uses la puerta de la terraza hasta que Mateo lo indique. Mantén la entrada precintada mientras se cambian los rodillos." }, reviewedHumanReadingAid: { language: "en", text: "Do not use the terrace door until Mateo clears it. Keep the doorway taped off while the rollers are out." }, holds: briefing.shift.holds, questions: [], page: { cursor: null, hasMore: false } };
const teachBack = { id: "teach1", verifiedByName: "Mateo Ruiz", language: "es", interpreterRef: null, checklist: { hazard: true, control: true, response: true }, outcome: "passed", at: verified };
const pending = safetyInstructionSchema.parse({ ...base, state: "awaiting_teach_back", teachBack: null }); const ready = safetyInstructionSchema.parse({ ...base, state: "awaiting_acknowledgement", teachBack }); const acknowledged = safetyInstructionSchema.parse({ ...base, holds: briefing.shift.holds.map(hold => ({ ...hold, state: "cleared", clearedAt: verified + 60000 })), state: "acknowledged", teachBack, acknowledgement: { teachBackId: "teach1", workerName: "Diego Torres", at: verified + 60000 } }); const superseded = safetyInstructionSchema.parse({ ...base, state: "superseded", teachBack, acknowledgement: null, replacedBy: { ...version, id: "version3", no: 3, issuedAt: issued + 3600000 } }); const foreman = safetyInstructionSchema.parse({ ...base, viewer: "issuer", state: "awaiting_teach_back", teachBack: null });
const noop = () => {}; const props = { offline: false, loading: false, busy: false, checking: false, failed: false, questionSent: false, onBack: noop, onRetry: noop, onAcknowledge: noop, onVerify: noop, onQuestion: noop, onIssue: noop, onReplacement: noop };
export const previews: ScreenPreview[] = [
  { id: "S-11", state: "acknowledgement-pending", render: () => <SafetyView {...props} data={pending} /> },
  { id: "S-11", state: "ready", render: () => <SafetyView {...props} data={ready} /> },
  { id: "S-11", state: "acknowledged", render: () => <SafetyView {...props} data={acknowledged} /> },
  { id: "S-11", state: "superseded", render: () => <SafetyView {...props} data={superseded} /> },
  { id: "S-11", state: "foreman-verify", render: () => <SafetyView {...props} data={foreman} /> },
];
