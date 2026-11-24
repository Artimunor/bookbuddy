import type { ScreenPreview } from "../../preview/screens/types";
import { bookingsFixture } from "../c-01/preview";
import { BookingsView, CachedBookingsView } from "./Screen";

const noop = () => {};
const props = { name: "Claire Martin", confirmed: Date.UTC(2026, 10, 24, 8), segment: "active" as const, place: null, filterOpen: false, places: [], placesStatus: "idle" as const, onSegment: noop, onToggleFilter: noop, onPlace: noop, onIdentity: noop, onBell: noop, onRetry: noop, onRetryPlaces: noop, onJob: noop, onNow: noop };
export const previews: ScreenPreview[] = [
  { id: "C-18", state: "active", render: () => <BookingsView {...props} page={bookingsFixture} status="ready" /> },
  { id: "C-18", state: "past", render: () => <BookingsView {...props} segment="past" page={{ ...bookingsFixture, segment: "past", items: [], live: null }} status="ready" /> },
  { id: "C-18", state: "filtered-empty", render: () => <BookingsView {...props} place={bookingsFixture.items[0]!.place ? { id: bookingsFixture.items[0]!.place.placeId, alias: "Villa Mar" } : null} page={{ ...bookingsFixture, items: [], live: null }} status="ready" /> },
  { id: "C-18", state: "offline", render: () => <CachedBookingsView {...props} page={bookingsFixture} /> },
  { id: "C-18", state: "error", render: () => <BookingsView {...props} page={null} status="error" /> },
];
