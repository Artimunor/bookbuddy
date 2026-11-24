import { homeProjectionSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { HomeView } from "./Screen";

const at = (hour: number, minute: number) => Date.UTC(2026, 10, 24, hour - 1, minute);
const heading = { jobId: "job1", reference: "BB-1042", title: "Terrace door repair", siteZone: "Europe/Madrid" };
const visit = { visitId: "visit1", window: { startsAt: at(9, 0), endsAt: at(10, 0) }, step: "on_the_way", status: "on_the_way", arrival: { startsAt: at(9, 10), endsAt: at(9, 20) }, nextUpdateAt: null, source: { at: at(8, 52), by: "Mateo Ruiz" } };
const home = homeProjectionSchema.parse({
  audience: "foreman", unreadCount: 2, businessName: "Reformas Ruiz", siteZone: heading.siteZone, gaps: [],
  liveVisits: [{ ...heading, place: { placeId: "villa", alias: "Villa Mar" }, visit, customerStatus: visit,
    crew: [{ membershipId: "mateo", displayName: "Mateo Ruiz", state: "on_the_way", at: at(8, 52), briefing: "acknowledged" }, { membershipId: "diego", displayName: "Diego Torres", state: "confirmed", at: at(8, 40), briefing: "due" }] }],
  laterVisits: [],
  needsYou: [{ ...heading, action: { kind: "review_briefing", recordId: "shift1", at: null, waitingOn: null } }], needsYouCount: 1,
});
if (home.audience !== "foreman") throw new Error("Invalid preview");
const gap = homeProjectionSchema.parse({ ...home, gaps: [{ gapId: "gap1", ...heading, worker: { membershipId: "nadia", displayName: "Nadia Benali" }, skill: "Door fitting", reportedAt: at(8, 32), visitStartsAt: at(9, 0), customerNotified: false }] });
if (gap.audience !== "foreman") throw new Error("Invalid preview");
export const previews: ScreenPreview[] = (["visit-live", "crew-gap", "quiet-day", "offline"] as const).map(state => ({ id: "F-01", state, render: () => <HomeView data={state === "offline" ? null : state === "crew-gap" ? gap : state === "quiet-day" ? { ...home, liveVisits: [], needsYou: [], needsYouCount: 0 } : home} status={state === "offline" ? "offline" : "ready"} name="Mateo Ruiz" onRetry={() => {}} onNavigate={() => {}} /> }));
