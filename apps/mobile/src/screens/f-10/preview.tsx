import { foremanCoverSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { CoverView } from "./Screen";
const minute = 60000; const start = Date.UTC(2026, 10, 24, 8); const sent = start - 27 * minute; const acceptedAt = start - 22 * minute;
const fit = { result: "available", checkedAt: sent, skillMatches: true, briefingLanguageMatches: true, availability: { state: "free" }, eligibility: { state: "approved", validUntil: Date.UTC(2026, 11, 31) } };
const candidate = (membershipId: string, displayName: string) => ({ membershipId, displayName, skills: ["Door fitting"], workingLanguages: ["es"], openToCoverUntil: start + 9 * 60 * minute, fit, onDuty: true, response: null });
const diego = candidate("diego", "Diego Torres"); const lucia = candidate("lucia", "Lucía Ortega");
const base = { audience: "foreman", gapId: "gap1", slotId: "slot1", shift: { shiftId: "shift1", reference: "BB-1042", window: { startsAt: start, endsAt: start + 60 * minute }, siteZone: "Europe/Madrid", task: "Terrace door repair", skill: "Door fitting", briefingLanguage: "es" }, safeCutoff: start - 13 * minute, revision: 1, currentRoundNo: null, dispatchesUsed: 0, status: { state: "gap", reportedAt: start - 28 * minute }, candidates: [diego, lucia], customerUpdate: { state: "not_shared" }, actions: { canIssue: true, canClose: false, canRelease: false, canConfirm: false } };
export const gap = foremanCoverSchema.parse(base);
export const offers = foremanCoverSchema.parse({ ...base, currentRoundNo: 1, dispatchesUsed: 1, status: { state: "offers_out", sentAt: sent, replyBy: start - 18 * minute }, candidates: [diego, lucia].map((c, i) => ({ ...c, response: { offerId: `offer${i}`, state: "offered", at: sent, declineReason: null } })), customerUpdate: { state: "published", kind: "cover_arranging", publishedAt: start - 26 * minute, nextUpdateAt: start - 15 * minute }, actions: { canIssue: false, canClose: true, canRelease: false, canConfirm: false } });
export const accepted = foremanCoverSchema.parse({ ...offers, status: { state: "accepted_pending_confirmation", hold: { offerId: "offer0", worker: { membershipId: "diego", displayName: "Diego Torres" }, acceptedAt, confirmBy: start - 17 * minute, fit, onDuty: true, gapStillOpen: true } }, candidates: offers.candidates.map((c, i) => ({ ...c, response: { ...c.response!, state: i === 0 ? "held" : "on_hold", at: acceptedAt } })), actions: { canIssue: false, canClose: false, canRelease: true, canConfirm: true } });
export const confirmed = foremanCoverSchema.parse({ ...accepted, status: { state: "confirmed", assignmentId: "assignment1", worker: { membershipId: "diego", displayName: "Diego Torres" }, confirmedAt: start - 20 * minute, confirmedByName: "Mateo Ruiz", confirmedByViewer: true }, actions: { canIssue: false, canClose: false, canRelease: false, canConfirm: false } });
export const noCover = foremanCoverSchema.parse({ ...offers, status: { state: "no_cover", endedAt: start - 18 * minute }, actions: { canIssue: false, canClose: false, canRelease: false, canConfirm: false } });
export const proposed = foremanCoverSchema.parse({ ...noCover, status: { state: "new_visit_proposed", proposedAt: start - 16 * minute, windowId: "window2", window: { startsAt: start + 24 * 60 * minute, endsAt: start + 25 * 60 * minute } } });
const noop = () => {};
const props = { status: "ready" as const, selected: [], now: start - 24 * minute, onToggle: noop, onSend: noop, onCloseRound: noop, onReview: noop, onShift: noop, onPropose: noop, onBack: noop, onRetry: noop };
export const previews: ScreenPreview[] = [
  { id: "F-10", state: "gap", render: () => <CoverView {...props} data={gap} /> },
  { id: "F-10", state: "crew-offers-out", render: () => <CoverView {...props} data={offers} /> },
  { id: "F-10", state: "accepted", render: () => <CoverView {...props} data={accepted} /> },
  { id: "F-10", state: "confirmed", render: () => <CoverView {...props} data={confirmed} /> },
  { id: "F-10", state: "no-cover", render: () => <CoverView {...props} data={noCover} /> },
  { id: "F-10", state: "new-visit-proposed", render: () => <CoverView {...props} data={proposed} /> },
];
