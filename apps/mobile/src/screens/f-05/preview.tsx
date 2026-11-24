import { foremanVisitControlSchema, jobDetailSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { JobControlView } from "./Screen";
const start = Date.parse("2026-11-24T08:00:00Z");
const detail = jobDetailSchema.parse({ audience: "foreman", job: { view: "whole", jobId: "job-1042", reference: "BB-1042", title: "Terrace door repair", siteZone: "Europe/Madrid", place: { placeId: "villa-mar", alias: "Villa Mar" }, state: "open", journey: { step: "visit", cancelled: false, complete: false }, nextVisit: { visitId: "visit-1", window: { startsAt: start, endsAt: start + 3600000 } }, finalAt: null, customerName: "Claire Martin", nextStep: { kind: "share_update", recordId: null, at: null, waitingOn: null }, live: true, flags: [], revision: 1, address: "Villa Mar", arrival: { arrangement: "requester", contactName: null, safeNote: null }, chatThreadId: "thread-1" } });
if (detail.audience !== "foreman" || detail.job.view !== "whole") throw new Error("Invalid foreman job fixture");
export const job = detail.job;
export const visit = foremanVisitControlSchema.parse({ visitId: "visit-1", revision: 3, job: { id: "job-1042", reference: "BB-1042", title: "Terrace door repair", placeAlias: "Villa Mar" }, siteZone: "Europe/Madrid", customerName: "Claire Martin", work: { id: "activity-1", kind: "work_started", at: start + 1080000, byName: "Mateo Ruiz" }, window: { id: "window-1", startsAt: start, endsAt: start + 3600000 }, customerPreview: { window: { id: "window-1", startsAt: start, endsAt: start + 3600000 }, confirmedCrewNames: ["Diego Torres"], live: { step: "working", status: "working", since: start + 1080000, source: { at: start + 1080000, sharedByName: "Mateo Ruiz" }, arrival: null, nextUpdateAt: null } }, crew: [{ assignmentId: "assignment-1", workerName: "Diego Torres", state: "confirmed", estimate: null, attendance: { arrival: { id: "arrival-1", assignmentId: "assignment-1", kind: "arrival", source: "self", actualAt: start + 840000, capturedAt: start + 840000, receivedAt: start + 840000, reviewState: "accepted", correctsId: null, reasonCode: null, recordedByName: "Diego Torres" }, departure: null, hasPendingReview: false }, holds: [], instruction: null, briefingReceipt: null }], workGate: { status: "ready" }, permittedUpdates: ["paused", "photo"] });
const noop = () => {};
const props = { status: "ready" as const, visitStatus: "ready" as const, busy: false, checking: false, failed: false, onBack: noop, onRetry: noop, onNavigate: noop, onWork: noop };
const signedAt = Date.parse("2026-11-24T09:40:00Z");
const signed = { kind: "signed_off" as const, jobId: job.jobId, recordId: "sign-off-1", at: signedAt, by: "Claire Martin" };
const sent = { kind: "bill_issued" as const, jobId: job.jobId, recordId: "bill-1", at: signedAt + 120000, by: null };
const paid = { kind: "paid" as const, jobId: job.jobId, recordId: "payment-1", at: Date.parse("2026-11-25T08:05:00Z"), by: "Mateo Ruiz" };
const quote = { versionId: "quote-v1" as NonNullable<typeof job.quote>["versionId"], no: 1, state: "approved" as const };
const total = { minor: 24000, currency: "EUR" as const };
const noMore = { cursor: null, hasMore: false };
const sentJob: typeof job = {
  ...job, journey: { step: "signed_off", cancelled: false, complete: false }, flags: ["unpaid_bill"], quote,
  bill: { state: "sent", total }, history: { items: [sent, signed], page: { cursor: "earlier-history", hasMore: true } },
};
const booked = jobDetailSchema.parse({ audience: "foreman", job: { ...job, journey: { step: "booked", cancelled: false, complete: false },
  nextStep: { kind: "assign_crew", recordId: "shift-1", at: start, waitingOn: null },
  visits: [{ visitId: "visit-1", vacantSlotId: "slot-1", shifts: [{ shiftId: "shift-1", slotIds: ["slot-1"] }] }],
  bill: { state: "none", total: null } } });
if (booked.audience !== "foreman" || booked.job.view !== "whole") throw new Error("Invalid booked fixture");
const bookedJob = booked.job;
export const previews: ScreenPreview[] = [
  { id: "F-05", state: "live", render: () => <JobControlView {...props} job={job} visit={visit} /> },
  { id: "F-05", state: "booked", render: () => <JobControlView {...props} initialView="whole" job={bookedJob} visit={null} /> },
  { id: "F-05", state: "change-pending", render: () => <JobControlView {...props} job={{ ...job, flags: ["open_change"] }} visit={visit} /> },
  { id: "F-05", state: "awaiting-sign-off", render: () => <JobControlView {...props} job={job} visit={{ ...visit, work: { ...visit.work!, kind: "work_finished" }, workGate: { status: "finished" } }} /> },
  { id: "F-05", state: "bill-draft", render: () => <JobControlView {...props} initialView="whole" job={{ ...job, quote, bill: { state: "draft", total } }} visit={null} /> },
  { id: "F-05", state: "bill-sent", render: () => <JobControlView {...props} initialView="whole" job={sentJob} visit={null} payee="Reformas Ruiz" canSwitchToProvider onEarlier={noop} /> },
  { id: "F-05", state: "paid-recorded", render: () => <JobControlView {...props} initialView="whole" job={{ ...sentJob, flags: [], journey: { step: "paid", cancelled: false, complete: true }, bill: { state: "paid_recorded", total }, history: { items: [paid, sent, signed], page: noMore } }} visit={null} /> },
];
