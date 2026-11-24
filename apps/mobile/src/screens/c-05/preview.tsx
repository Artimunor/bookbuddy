import { idSchemaFor, jobDetailSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { JobHomeView } from "./Screen";

const issued = Date.UTC(2026, 10, 23, 7, 14);
const booked = Date.UTC(2026, 10, 24, 8);
const detail = jobDetailSchema.parse({ audience: "customer", job: {
  view: "whole", jobId: "job-1042", reference: "BB-1042", title: "Terrace door repair", siteZone: "Europe/Madrid",
  place: { placeId: "villa-mar", alias: "Villa Mar" }, state: "open", journey: { step: "quoted", cancelled: false, complete: false },
  nextVisit: null, finalAt: null, providerName: "Reformas Ruiz", nextStep: { kind: "review_quote", recordId: "quote-1", at: null, waitingOn: null }, live: false,
  revision: 1, hasTodayView: false, quote: { versionId: "quote-1", version: 1, total: { minor: 24000, currency: "EUR" }, state: "issued" },
  foremanName: "Mateo Ruiz", chatThreadId: "thread-1", change: null, openCase: null, bill: null,
  attachmentIds: [],
  history: { items: [{ jobId: "job-1042", recordId: "quote-1", kind: "quote_issued", at: issued, by: "Mateo Ruiz" }, { jobId: "job-1042", recordId: "job-1042", kind: "requested", at: issued - 540000, by: "Claire Martin" }], page: { cursor: null, hasMore: false } },
} });
if (detail.audience !== "customer" || detail.job.view !== "whole") throw new Error("Invalid customer job fixture");
const job = detail.job;
const noop = () => {};
const props = { onBack: noop, onRetry: noop, onNavigate: noop, twoClock: true };
const visit = { visitId: idSchemaFor<"visit">().parse("visit-1"), window: { startsAt: booked, endsAt: booked + 3600000 } };
export const previews: ScreenPreview[] = [
  { id: "C-05", state: "quote-ready", render: () => <JobHomeView {...props} job={job} status="ready" /> },
  { id: "C-05", state: "requested", render: () => <JobHomeView {...props} job={{ ...job, quote: null, foremanName: null, chatThreadId: null, journey: { step: "requested", cancelled: false, complete: false }, nextStep: { kind: "wait_for_quote", recordId: null, at: null, waitingOn: null } }} status="ready" /> },
  { id: "C-05", state: "booked", render: () => <JobHomeView {...props} job={{ ...job, quote: { ...job.quote!, state: "approved" }, nextVisit: visit, journey: { step: "booked", cancelled: false, complete: false }, nextStep: { kind: "visit", recordId: "visit-1", at: booked, waitingOn: null } }} status="ready" /> },
  { id: "C-05", state: "signed-off", render: () => <JobHomeView {...props} job={{ ...job, journey: { step: "signed_off", cancelled: false, complete: false }, nextStep: { kind: "see_bill", recordId: "bill-1", at: null, waitingOn: null }, bill: { billId: idSchemaFor<"bill">().parse("bill-1"), total: { minor: 24000, currency: "EUR" }, status: "due" } }} status="ready" /> },
  { id: "C-05", state: "closed", render: () => <JobHomeView {...props} job={{ ...job, state: "closed", journey: { step: "paid", cancelled: false, complete: true }, nextStep: null }} status="ready" /> },
  { id: "C-05", state: "cancelled", render: () => <JobHomeView {...props} job={{ ...job, state: "cancelled", journey: { step: "quoted", cancelled: true, complete: false }, nextStep: null }} status="ready" /> },
  { id: "C-05", state: "problem-open", render: () => <JobHomeView {...props} job={{ ...job, openCase: { caseId: idSchemaFor<"case">().parse("case-1"), state: "awaiting_plan" }, nextStep: { kind: "open_case", recordId: "case-1", at: null, waitingOn: null } }} status="ready" /> },
  { id: "C-05", state: "offline", render: () => <JobHomeView {...props} job={null} status="offline" /> },
];
