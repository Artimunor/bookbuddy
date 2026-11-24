import { jobsPageSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { JobsView } from "./Screen";

const page = jobsPageSchema.parse({ audience: "foreman", unreadCount: 2, businessName: "Reformas Ruiz", siteZone: "Europe/Madrid", incomingCount: 0, activeCount: 1, pastCount: 0, page: { cursor: null, hasMore: false }, live: null, list: { segment: "active", items: [{ jobId: "job1", reference: "BB-1042", title: "Terrace door repair", siteZone: "Europe/Madrid", journey: { step: "visit", cancelled: false, complete: false }, state: "open", place: { placeId: "villa", alias: "Villa Mar" }, customerName: "Claire Martin", nextVisit: { visitId: "visit1", window: { startsAt: 1795510800000, endsAt: 1795514400000 } }, finalAt: null, nextStep: null, live: true, flags: [] }] } });
if (page.audience !== "foreman") throw new Error("Invalid preview");
export const previews: ScreenPreview[] = (["active", "empty", "offline"] as const).map(state => ({ id: "F-02", state, render: () => <JobsView data={state === "offline" ? null : state === "empty" ? { ...page, list: { segment: "active", items: [] } } : page} segment="active" onSegment={() => {}} status={state === "offline" ? "offline" : "ready"} name="Mateo Ruiz" onRetry={() => {}} onNavigate={() => {}} /> }));
