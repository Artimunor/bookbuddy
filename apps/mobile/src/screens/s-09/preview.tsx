import type { ScreenPreview } from "../../preview/screens/types";
import { NotificationsView } from "./Screen";

const timestamp = Date.UTC(2026, 10, 24, 7, 52);
const base = { status: "ready", confirmed: null, onBack: () => {}, onOpen: () => {}, onMarkAll: () => {}, onNext: () => {}, onPrevious: () => {}, onRetry: () => {} };
export const previews: ScreenPreview[] = [
  { id: "S-09", state: "unread", render: () => <NotificationsView {...base} items={[{ id: "n1", kind: "update", createdAt: timestamp, readAt: null }, { id: "n2", kind: "message", createdAt: timestamp - 180000, readAt: timestamp }]} /> },
  { id: "S-09", state: "cover-offer", render: () => <NotificationsView {...base} items={[{ id: "n3", kind: "cover_offer", createdAt: timestamp, readAt: null }]} /> },
  { id: "S-09", state: "expired", render: () => <NotificationsView {...base} items={[{ id: "n4", kind: "cover_offer", createdAt: timestamp, readAt: timestamp, linkToken: null }]} /> },
];
