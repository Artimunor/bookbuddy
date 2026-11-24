import { jobsPageSchema } from "@bookbuddy/api-contract";
import { View } from "react-native";
import { useT } from "../../i18n";
import type { ScreenPreview } from "../../preview/screens/types";
import { BeaconTabIcon, BeaconTabLabel } from "../../ui/controls/tab-chrome";
import { useBeaconTheme } from "../../ui/theme";
import { bookingsFixture } from "../c-01/preview";
import { BookingsView, CachedBookingsView } from "./Screen";

const noop = () => {};
const props = { name: "Claire Martin", confirmed: Date.UTC(2026, 10, 24, 8), segment: "active" as const, place: null, filterOpen: false, places: [], placesStatus: "idle" as const, onSegment: noop, onToggleFilter: noop, onPlace: noop, onIdentity: noop, onBell: noop, onRetry: noop, onRetryPlaces: noop, onJob: noop, onNow: noop };
const seed = bookingsFixture.items[0]!;
const live = bookingsFixture.live!;
const active = pageFixture({ ...bookingsFixture, activeCount: 3, pastCount: 2, items: [
  { ...seed, journey: live.journey, nextVisit: live.visit, nextStep: null, live: true },
  { ...seed, jobId: "job-1047", reference: "BB-1047", title: "Bathroom tap leak", place: { placeId: "apartment", alias: "Apartamento Sol" },
    nextStep: { kind: "wait_for_approver", recordId: "quote-2", at: null, waitingOn: "Hugo Lambert" } },
  { ...seed, jobId: "job-1059", reference: "BB-1059", title: "Garden gate latch", place: { placeId: "casa-pinos", alias: "Casa Pinos" },
    journey: { step: "requested", cancelled: false, complete: false }, nextStep: null },
] });
const past = pageFixture({ ...active, segment: "past", live: null, items: [
  { ...seed, state: "closed", journey: { step: "paid", cancelled: false, complete: true }, nextStep: null, finalAt: Date.UTC(2026, 10, 25, 8, 5) },
  { ...seed, jobId: "job-1028", reference: "BB-1028", title: "Replace two outdoor lights", state: "cancelled", nextStep: null, finalAt: Date.UTC(2026, 10, 17, 8, 20),
    journey: { step: "booked", cancelled: true, complete: false } },
] });

function pageFixture(value: unknown) {
  const page = jobsPageSchema.parse(value);
  if (page.audience !== "customer") throw new Error("Expected a customer bookings fixture");
  return page;
}

function Preview({ segment }: { segment: "active" | "past" }) {
  const t = useT();
  const { color, field, space } = useBeaconTheme();
  const tabs = [
    { kind: "now", label: t("mobile.customerHome.now") },
    { kind: "bookings", label: t("mobile.customerHome.bookings") },
    { kind: "messages", label: t("mobile.chat.messages") },
  ] as const;
  return <View style={{ flex: 1 }}>
    <BookingsView {...props} segment={segment} page={segment === "active" ? active : past} status="ready" twoClock />
    <View style={{ flexDirection: "row", minHeight: field ? 64 : 56, paddingVertical: space.grid[1], backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.separator }}>
      {tabs.map(({ kind, label }) => <View key={kind} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <BeaconTabIcon kind={kind} focused={kind === "bookings"} />
        <BeaconTabLabel label={label} focused={kind === "bookings"} />
      </View>)}
    </View>
  </View>;
}
export const previews: ScreenPreview[] = [
  { id: "C-18", state: "active", render: () => <Preview segment="active" /> },
  { id: "C-18", state: "past", render: () => <Preview segment="past" /> },
  { id: "C-18", state: "filtered-empty", render: () => <BookingsView {...props} place={bookingsFixture.items[0]!.place ? { id: bookingsFixture.items[0]!.place.placeId, alias: "Villa Mar" } : null} page={{ ...bookingsFixture, items: [], live: null }} status="ready" /> },
  { id: "C-18", state: "offline", render: () => <CachedBookingsView {...props} page={bookingsFixture} /> },
  { id: "C-18", state: "error", render: () => <BookingsView {...props} page={null} status="error" /> },
];
