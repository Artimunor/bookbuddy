import type { ScreenPreview } from "../../preview/screens/types";
import type { StatusCardSource } from "../../system/status-cards/model";
import { SessionCardView } from "./Screen";

const now = Date.UTC(2026, 10, 28, 8, 20);
const facts = { kind: "session", stage: "starts_in", providerName: "Estudi Mar Pilates", reference: "BB-S1042",
  confirmedAt: now - 50 * 60_000, startsAt: now + 40 * 60_000, endsAt: now + 85 * 60_000, hostUpdate: null } as const;
const original: StatusCardSource = { facts, target: { kind: "session", id: "session-s1042", path: "/c/session-bookings/session-s1042" }, zone: "Europe/Madrid", terminal: false };
const changed: StatusCardSource = { ...original, facts: { ...facts, hostUpdate: { name: "Lucía Vidal", confirmedBy: "Marina Serra", confirmedAt: now - 15 * 60_000 } } };
const ended: StatusCardSource = { ...original, terminal: true, facts: { ...facts, stage: "ended" } };
export const previews: ScreenPreview[] = [
  { id: "L-07", state: "starts-in", render: () => <SessionCardView source={original} now={now} /> },
  { id: "L-07", state: "host-changed", render: () => <SessionCardView source={changed} now={now} /> },
  { id: "L-07", state: "stale", render: () => <SessionCardView source={original} now={facts.startsAt + 60_000} /> },
  { id: "L-07", state: "ended", render: () => <SessionCardView source={ended} now={facts.endsAt} /> },
  { id: "L-07", state: "island-compact", render: () => <SessionCardView source={original} now={now} area="island" hidden /> },
  { id: "L-07", state: "android", render: () => <SessionCardView source={original} now={now} area="android" hidden /> },
];
