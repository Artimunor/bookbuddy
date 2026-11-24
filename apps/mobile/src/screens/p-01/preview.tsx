import { businessOverviewSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { BusinessNowView } from "./Screen";

const overview = businessOverviewSchema.parse({
  business: { id: "business1", publicName: "Reformas Ruiz", state: "approved", areaName: "Madrid", siteZone: "Europe/Madrid" },
  liveJob: null,
  nextVisit: { jobId: "job1031", reference: "BB-1031", title: "Pergola post repair", siteZone: "Europe/Madrid", startsAt: Date.parse("2026-11-26T09:00:00Z"), endsAt: Date.parse("2026-11-26T10:30:00Z") },
  handoffs: { offeredCount: 0, nextReplyAt: null, stuck: [{ jobId: "job1031", reference: "BB-1031", title: "Pergola post repair", siteZone: "Europe/Madrid", since: Date.parse("2026-11-24T08:50:00Z"), offeredTo: "Mateo Ruiz", accountableForeman: "Inés Vidal" }] },
  unassignedCount: 0, commercialReviewCount: 0, bills: { openCount: 2, totalMinor: 33500, currency: "EUR" }, eligibility: { status: "approved", pendingReviewCount: 1 },
});
const live = businessOverviewSchema.parse({ ...overview, liveJob: { jobId: "job1042", reference: "BB-1042", title: "Terrace door repair", siteZone: "Europe/Madrid", step: "working", since: Date.parse("2026-11-24T08:18:00Z"), accountableForeman: "Mateo Ruiz", sharedBy: "Mateo Ruiz", crewSize: 2 }, handoffs: { offeredCount: 1, nextReplyAt: Date.parse("2026-11-24T08:50:00Z"), stuck: [] }, bills: { openCount: 0, totalMinor: 0, currency: "EUR" } });

export const previews: ScreenPreview[] = [
  { id: "P-01", state: "action-needed", render: () => <BusinessNowView overview={overview} status="ready" actor="Mateo Ruiz" onProfile={() => {}} onNotifications={() => {}} onRetry={() => {}} onJob={() => {}} onJobs={() => {}} onPeople={() => {}} onEligibility={() => {}} /> },
  { id: "P-01", state: "active", render: () => <BusinessNowView overview={live} status="ready" actor="Mateo Ruiz" onProfile={() => {}} onNotifications={() => {}} onRetry={() => {}} onJob={() => {}} onJobs={() => {}} onPeople={() => {}} onEligibility={() => {}} /> },
];
