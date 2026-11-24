import { visitLogSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { SiteLogView } from "./Screen";
const at = 1795511640000;
const control = { visitId: "visit", revision: 1, job: { id: "job", reference: "BB-1042", title: "Terrace door repair", placeAlias: "Villa Mar" }, siteZone: "Europe/Madrid", customerName: "Claire Martin", work: null, window: { id: "window", startsAt: at, endsAt: at + 3600000 }, customerPreview: { window: { id: "window", startsAt: at, endsAt: at + 3600000 }, confirmedCrewNames: [], live: { step: null, status: null, since: null, source: null, arrival: null, nextUpdateAt: null } }, crew: [], workGate: { status: "ready" }, permittedUpdates: [] };
const base = { view: "all", visitId: "visit", shiftId: null, control, page: { cursor: null, hasMore: false }, stamps: [] };
const event = { id: "event", assignmentId: "assignment", kind: "arrival", source: "self", actualAt: at, capturedAt: at, receivedAt: at, reviewState: "needs_review", correctsId: null, reasonCode: null, recordedByName: "Diego Torres" };
const noop = () => {};
const progress = { kind: "progress_photo", id: "progress", at, capturedAt: at - 120000, actorName: "Diego Torres", assignmentId: "assignment", shiftId: "shift", customerUpdateId: null, photo: { attachmentId: "progress-photo", availability: "available" }, caption: { original: { text: "Carril inferior desgastado", language: "es" }, reading: null }, canShareWithCustomer: true };
const update = { kind: "photo", id: "shared", recordedAt: at + 300000, sharedByName: "Mateo Ruiz", photo: { attachmentId: "shared-photo", availability: "available" }, caption: { original: { text: "Rodillos viejos retirados", language: "es" }, reading: { status: "ready", text: "Old rollers out", language: "en" } } };
const props = { status: "ready", onView: noop, onBack: noop, onRetry: noop, onShare: noop, onWrap: noop, onHold: noop, onChange: noop, onShareProgress: noop, onPhoto: noop };
export const previews: ScreenPreview[] = [
  ...["empty", "confirmed", "conflict"].map(state => ({ id: "F-13", state, render: () => <SiteLogView {...props} data={visitLogSchema.parse({ ...base, stamps: state === "empty" ? [] : [...(state === "confirmed" ? [progress] : []), { kind: "attendance", at, actorName: "Diego Torres", customerUpdateId: null, event: { ...event, reviewState: state === "conflict" ? "needs_review" : "accepted" } }] })} view="all" /> })),
  { id: "F-13", state: "customer-photo", render: () => <SiteLogView {...props} data={visitLogSchema.parse({ view: "customer", visitId: "visit", siteZone: control.siteZone, stamps: [update], page: base.page })} view="customer" /> },
];
