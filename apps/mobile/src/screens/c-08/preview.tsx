import { jobWindowsSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { WindowView } from "./Screen";
const tue = Date.UTC(2026, 10, 24, 8); const wed = Date.UTC(2026, 10, 25, 8); const hour = 3600000;
const offer = (id: string, startsAt: number, replacesWindowId: string | null = null) => ({ id, startsAt, endsAt: startsAt + hour, expiresAt: tue - hour, proposedAt: tue - 86400000, replacesWindowId, confirmationMode: replacesWindowId ? "agreed_reschedule" : "booking" });
const booked = { id: "window-tue", startsAt: tue, endsAt: tue + hour, confirmedAt: tue - 86400000, crewAvailability: "as_agreed" };
const base = { job: { id: "job-1042", reference: "BB-1042", title: "Terrace door repair" }, siteZone: "Europe/Madrid", foremanName: "Mateo Ruiz", approvedQuote: { id: "quote-1", number: 1, totalMinor: 24000, currency: "EUR" }, withdrawalQuoteVersionId: null, visits: [{ id: "visit-1", kind: "work", state: "planned", revision: 1, bookedWindow: null, offeredWindows: [offer("window-tue", tue), offer("window-tue-late", tue + 6 * hour), offer("window-wed", wed)], rescheduleRequest: null, cancellation: null, actions: { canCancelFeeFree: false, canRequestReschedule: false } }] };
export const proposed = jobWindowsSchema.parse(base);
export const revised = jobWindowsSchema.parse({ ...base, visits: [{ ...base.visits[0], state: "booked", bookedWindow: { ...booked, crewAvailability: "no_crew_available" }, offeredWindows: [offer("window-wed", wed, booked.id)], actions: { canCancelFeeFree: true, canRequestReschedule: true } }] });
export const confirmed = jobWindowsSchema.parse({ ...base, visits: [{ ...base.visits[0], state: "booked", bookedWindow: booked, offeredWindows: [], actions: { canCancelFeeFree: true, canRequestReschedule: true } }] });
export const none = jobWindowsSchema.parse({ ...base, visits: [{ ...base.visits[0], offeredWindows: [] }] });
const many = jobWindowsSchema.parse({ ...base, visits: [{ ...base.visits[0], offeredWindows: Array.from({ length: 7 }, (_, i) => offer(`window-${i}`, tue + i * 86400000)) }] });
const noop = () => {};
const props = { status: "ready" as const, twoClock: true, viewerZone: "Europe/London", onSelect: noop, onConfirm: noop, onBack: noop, onRetry: noop, onManage: noop, onMessage: noop };
export const previews: ScreenPreview[] = [
 { id: "C-08", state: "proposed", render: () => <WindowView {...props} data={proposed} selection="window-tue" /> },
 { id: "C-08", state: "revised-visit-proposed", render: () => <WindowView {...props} data={revised} selection="window-wed" /> },
 { id: "C-08", state: "none-available", render: () => <WindowView {...props} data={none} selection={null} /> },
 { id: "C-08", state: "confirmed", render: () => <WindowView {...props} data={confirmed} selection={null} /> },
 { id: "C-08", state: "just-taken", render: () => <WindowView {...props} data={proposed} selection={null} taken /> },
 { id: "C-08", state: "many-windows", render: () => <WindowView {...props} data={many} selection={null} /> },
];
