import { customerLiveVisitSchema, type CustomerLiveVisit } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { SegmentedControl } from "../../ui/controls";
import { LiveVisitView } from "./Screen";

const time = (hour: number, minute: number) => Date.UTC(2026, 10, 24, hour - 1, minute);
const band = { startsAt: time(9, 10), endsAt: time(9, 20) };
const arrival = { kind: "on_the_way", id: "update-way", recordedAt: time(8, 52), sharedByName: "Mateo Ruiz", band };
const base = {
  visitId: "visit-1", job: { id: "job-1042", reference: "BB-1042", title: "Terrace door repair", placeAlias: "Villa Mar" },
  siteZone: "Europe/Madrid", providerName: "Reformas Ruiz", foremanName: "Mateo Ruiz", jobThreadId: "thread-1", completionId: null,
  window: { id: "window-1", startsAt: time(9, 0), endsAt: time(10, 0) }, confirmedCrewNames: ["Mateo Ruiz", "Diego Torres"],
  live: { step: "on_the_way", status: "on_the_way", since: time(8, 52), source: { at: time(8, 52), sharedByName: "Mateo Ruiz" }, arrival, nextUpdateAt: null },
  moments: [arrival, { kind: "crew_updated", id: "update-crew", recordedAt: time(8, 40), sharedByName: "Mateo Ruiz" }], page: { cursor: null, hasMore: false },
};
const fixture = (status: string | null, step: string | null, changes: Record<string, unknown> = {}) => customerLiveVisitSchema.parse({ ...base, ...changes, live: { ...base.live, status, step, arrival: status === "on_the_way" ? arrival : null, ...(status === "on_site" ? { source: { at: time(9, 14), sharedByName: null }, since: time(9, 14) } : {}), ...(status === "cover_arranging" ? { nextUpdateAt: time(8, 45) } : {}), ...(changes.live as object ?? {}) } });
const noop = () => {};
const switcher = <SegmentedControl label="Job view" hideLabel value="today" options={[{ value: "today", label: "Today" }, { value: "whole", label: "Whole job" }]} onChange={noop} />;
const render = (visit: CustomerLiveVisit, now = time(8, 58)) => <LiveVisitView visit={visit} status="ready" now={now} twoClock viewerZone="Europe/London" viewSwitcher={switcher} statusCardsAvailable onBack={noop} onRefresh={noop} onNavigate={noop} onFollow={noop} />;
const cover = fixture("cover_arranging", "confirmed", { confirmedCrewNames: ["Mateo Ruiz"], live: { source: { at: time(8, 36), sharedByName: "Mateo Ruiz" }, since: time(8, 36) }, moments: [{ kind: "cover_arranging", id: "update-cover", recordedAt: time(8, 36), sharedByName: "Mateo Ruiz", nextUpdateAt: time(8, 45) }] });
export const previews: ScreenPreview[] = [
  { id: "C-09", state: "on-the-way", render: () => render(fixture("on_the_way", "on_the_way")) },
  { id: "C-09", state: "crew-confirmed", render: () => render(fixture("confirmed", "confirmed", { moments: [] })) },
  { id: "C-09", state: "cover-being-arranged", render: () => render(cover, time(8, 36)) },
  { id: "C-09", state: "crew-changed", render: () => render(fixture("confirmed", "confirmed", { moments: [base.moments[1]] })) },
  { id: "C-09", state: "on-site", render: () => render(fixture("on_site", "on_site"), time(9, 15)) },
  { id: "C-09", state: "working", render: () => render(fixture("working", "working", { live: { source: { at: time(9, 18), sharedByName: "Mateo Ruiz" }, since: time(9, 18) }, moments: [{ kind: "photo", id: "update-photo", recordedAt: time(9, 36), sharedByName: "Mateo Ruiz", photo: { attachmentId: "photo-1", availability: "available" }, caption: { original: { language: "en", text: "Old rollers out" }, reading: null } }] }), time(9, 37)) },
  { id: "C-09", state: "no-update-since", render: () => render(fixture(null, "confirmed"), time(9, 25)) },
  { id: "C-09", state: "finished", render: () => render(fixture("finished", "finished", { completionId: "completion-1", live: { source: { at: time(10, 12), sharedByName: "Mateo Ruiz" }, since: time(10, 12) } }), time(10, 16)) },
  { id: "C-09", state: "quiet", render: () => render(fixture(null, null, { moments: [] })) },
  { id: "C-09", state: "offline", render: () => <LiveVisitView visit={null} status="offline" lastConfirmed={{ at: time(8, 52), zone: "Europe/Madrid" }} onBack={noop} onRefresh={noop} onNavigate={noop} onFollow={noop} /> },
];
