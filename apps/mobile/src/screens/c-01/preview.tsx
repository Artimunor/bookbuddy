import { homeProjectionSchema, jobsPageSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { CachedNowView, NowView } from "./Screen";

const at = Date.UTC(2026, 10, 24, 8, 0);
const journey = { step: "quoted", cancelled: false, complete: false };
const heading = { jobId: "job-1042", reference: "BB-1042", title: "Terrace door repair", siteZone: "Europe/Madrid" };
const place = { placeId: "villa-mar", alias: "Villa Mar" };
const card = { ...heading, place, journey, state: "open", nextVisit: null, finalAt: null, providerName: "Reformas Ruiz", nextStep: { kind: "review_quote", recordId: "quote-1", at: null, waitingOn: null }, live: false };
const liveVisit = { ...heading, journey: { ...journey, step: "visit" }, providerName: "Reformas Ruiz", crewName: "Mateo Ruiz", visit: { visitId: "visit-1", window: { startsAt: at, endsAt: at + 3600000 }, step: "on_the_way", status: "on_the_way", arrival: { startsAt: at + 600000, endsAt: at + 1200000 }, nextUpdateAt: null, source: { at: at - 480000, by: "Mateo Ruiz" } } };
const homeBase = { audience: "customer", unreadCount: 1, place: { ...place, siteZone: "Europe/Madrid" }, liveVisits: [], decisions: [], upcoming: [], recent: [] };
const parsed = (value: unknown) => {
  const result = homeProjectionSchema.parse(value);
  if (result.audience !== "customer") throw new Error("Expected customer fixture");
  return result;
};
export const firstHome = parsed(homeBase);
export const decisionHome = parsed({ ...homeBase, decisions: [{ ...heading, journey, place, kind: "review_quote", recordId: "quote-1", amount: { minor: 24000, currency: "EUR" }, sent: { at: at - 86400000, by: "Mateo Ruiz" }, dueAt: null }] });
export const upcomingHome = parsed({ ...homeBase, upcoming: [{ ...card, journey: { ...journey, step: "booked" }, nextVisit: { visitId: "visit-1", window: { startsAt: at, endsAt: at + 3600000 } } }] });
export const liveHome = parsed({ ...homeBase, liveVisits: [liveVisit], recent: [
  { jobId: heading.jobId, recordId: "update-way", kind: "on_the_way", at: at - 480000, by: "Mateo Ruiz" },
  { jobId: heading.jobId, recordId: "update-crew", kind: "crew_updated", at: at - 1200000, by: "Mateo Ruiz" },
] });
export const bookingsFixture = (() => {
  const result = jobsPageSchema.parse({ audience: "customer", segment: "active", siteZone: "Europe/Madrid", unreadCount: 1, page: { cursor: null, hasMore: false }, activeCount: 1, pastCount: 0, items: [card], live: liveVisit });
  if (result.audience !== "customer") throw new Error("Expected customer fixture");
  return result;
})();
const noop = () => {};
const props = { name: "Claire Martin", confirmed: at, onAsk: noop, onResume: noop, onIdentity: noop, onBell: noop, onRetry: noop, onJob: noop, onDecision: noop };
export const previews: ScreenPreview[] = [
  { id: "C-01", state: "first-use", render: () => <NowView {...props} home={firstHome} status="ready" /> },
  { id: "C-01", state: "draft", render: () => <NowView {...props} home={firstHome} status="ready" draftCount={1} draftDescription="The terrace door sticks when I close it." /> },
  { id: "C-01", state: "decision-due", render: () => <NowView {...props} home={decisionHome} status="ready" /> },
  { id: "C-01", state: "upcoming", render: () => <NowView {...props} home={upcomingHome} status="ready" /> },
  { id: "C-01", state: "live", render: () => <NowView {...props} home={liveHome} status="ready" twoClock /> },
  { id: "C-01", state: "offline", render: () => <CachedNowView {...props} home={liveHome} /> },
  { id: "C-01", state: "error", render: () => <NowView {...props} home={null} status="error" /> },
];
