import { visitLogSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { SiteLogView } from "./Screen";
const at = 1795511640000;
const control = { visitId: "visit", revision: 1, job: { id: "job", reference: "BB-1042", title: "Terrace door repair", placeAlias: "Villa Mar" }, siteZone: "Europe/Madrid", customerName: "Claire Martin", work: null, window: { id: "window", startsAt: at, endsAt: at + 3600000 }, customerPreview: { window: { id: "window", startsAt: at, endsAt: at + 3600000 }, confirmedCrewNames: [], live: { step: null, status: null, since: null, source: null, arrival: null, nextUpdateAt: null } }, crew: [], workGate: { status: "ready" }, permittedUpdates: [] };
const base = { view: "all", visitId: "visit", shiftId: null, control, page: { cursor: null, hasMore: false }, stamps: [] };
const event = { id: "event", assignmentId: "assignment", kind: "arrival", source: "self", actualAt: at, capturedAt: at, receivedAt: at, reviewState: "needs_review", correctsId: null, reasonCode: null, recordedByName: "Diego Torres" };
const noop = () => {};
export const previews: ScreenPreview[] = ["empty", "confirmed", "conflict"].map(state => ({ id: "F-13", state, render: () => <SiteLogView data={visitLogSchema.parse({ ...base, stamps: state === "empty" ? [] : [{ kind: "attendance", at, actorName: "Diego Torres", customerUpdateId: null, event: { ...event, reviewState: state === "conflict" ? "needs_review" : "accepted" } }] })} status="ready" view="all" onView={noop} onBack={noop} onRetry={noop} onShare={noop} onWrap={noop} onHold={noop} onChange={noop} /> }));
