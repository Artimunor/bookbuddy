import { jobsPageSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { JobsView } from "./Screen";

const at = Date.parse("2026-11-24T08:00:00Z");
const heading = { jobId: "job1", reference: "BB-1042", title: "Terrace door repair", siteZone: "Europe/Madrid" };
const visit = { visitId: "visit1", window: { startsAt: at, endsAt: at + 3600000 } };
const card = { ...heading, state: "open", place: { placeId: "villa", alias: "Villa Mar" }, customerName: "Claire Martin", finalAt: null, nextStep: null };
const page = jobsPageSchema.parse({
  audience: "foreman", unreadCount: 2, businessName: "Reformas Ruiz", siteZone: "Europe/Madrid",
  incomingCount: 0, activeCount: 28, pastCount: 0, page: { cursor: "active-more", hasMore: true },
  live: { ...heading, visit: { ...visit, step: "on_the_way", status: "on_the_way", arrival: { startsAt: at + 600000, endsAt: at + 1200000 }, nextUpdateAt: null, source: { at, by: "Mateo Ruiz" } } },
  list: { segment: "active", items: [
    { ...card, journey: { step: "visit", cancelled: false, complete: false }, nextVisit: visit, live: true, flags: [] },
    { ...card, jobId: "job2", reference: "BB-1045", title: "Kitchen shutter repair", journey: { step: "quoted", cancelled: false, complete: false }, nextVisit: null, live: false, flags: ["open_change"] },
    { ...card, jobId: "job3", reference: "BB-1038", title: "Bathroom tap replacement", journey: { step: "signed_off", cancelled: false, complete: false }, nextVisit: null, live: false, flags: ["unpaid_bill", "open_problem"] },
  ] },
});
if (page.audience !== "foreman") throw new Error("Invalid preview");
const noop = () => {};
export const previews: ScreenPreview[] = (["active", "empty", "offline"] as const).map(state => ({
  id: "F-02", state,
  render: () => <JobsView data={state === "offline" ? null : state === "empty" ? { ...page, list: { segment: "active", items: [] } } : page}
    segment="active" onSegment={noop} status={state === "offline" ? "offline" : "ready"} name="Mateo Ruiz"
    onRetry={noop} onMore={state === "active" ? noop : undefined} onNavigate={noop} />,
}));
