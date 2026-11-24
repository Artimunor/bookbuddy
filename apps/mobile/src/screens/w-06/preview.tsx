import { PreviewLocaleProvider } from "../../i18n";
import type { ScreenPreview } from "../../preview/screens/types";
import { BeaconThemeProvider } from "../../ui/theme";
import { arrival, fixture } from "../w-04/preview";
import { AttendanceSheet } from "./Screen";
const noop = () => {};
const at = Date.parse("2026-11-24T08:14:00Z");
export const previews: ScreenPreview[] = ["ready", "large-text", "saved-on-device", "recorded", "needs-review", "attendance-only", "check-out"].map(state => ({ id: "W-06", state, render: () => {
  const progress = state === "saved-on-device" ? { ...arrival, status: "saved_on_device" as const, receivedAt: null } : state === "recorded" ? arrival : state === "needs-review" ? { ...arrival, status: "needs_review" as const, receivedAt: null } : null;
  return <BeaconThemeProvider field><PreviewLocaleProvider><AttendanceSheet data={fixture} event={state === "check-out" ? "departure" : "arrival"} progress={progress} offline={state === "saved-on-device"} lastConfirmedAt={at - 120000} eligible={!progress} busy={false} failed={false} preference={state === "ready" || state === "large-text"} now={at} onPreference={noop} onRecord={noop} onClose={noop} /></PreviewLocaleProvider></BeaconThemeProvider>;
} }));
