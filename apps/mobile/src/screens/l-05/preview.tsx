import type { ScreenPreview } from "../../preview/screens/types";
import { booking, todayBooking, substituteBooking, proposedBooking, startsAt, viewerZone, siteZone, noop } from "../l-01/fixture";
import { BookingView } from "./Screen";
const props = { viewerZone, onBack: noop, onRespond: noop, onMove: noop, onMessage: noop, onFollow: noop };
export const previews: ScreenPreview[] = [
  { id: "L-05", state: "upcoming", render: () => <BookingView {...props} booking={booking} now={Date.UTC(2026, 10, 25, 9)} /> },
  { id: "L-05", state: "today", render: () => <BookingView {...props} viewerZone={siteZone} booking={todayBooking} now={startsAt - 40 * 60_000} /> },
  { id: "L-05", state: "substitute-host", render: () => <BookingView {...props} booking={substituteBooking} now={Date.UTC(2026, 10, 27, 17, 15)} /> },
  { id: "L-05", state: "pending-change", render: () => <BookingView {...props} booking={proposedBooking} now={Date.UTC(2026, 10, 26, 9, 41)} /> },
];
