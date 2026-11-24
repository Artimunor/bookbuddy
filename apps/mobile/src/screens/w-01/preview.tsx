import { homeProjectionSchema } from "@bookbuddy/api-contract";
import { View } from "react-native";
import { PreviewLocaleProvider } from "../../i18n";
import { BeaconThemeProvider } from "../../ui/theme";
import type { ScreenPreview } from "../../preview/screens/types";
import { NowView } from "./Screen";
const start = Date.parse("2026-11-24T08:00:00Z"), end = Date.parse("2026-11-24T09:00:00Z"), now = Date.parse("2026-11-24T07:36:00Z");
const offer = { kind: "cover", offerId: "offer_diego", gapId: "gap_nadia", town: "Xàbia", task: "Terrace door repair", skill: "Door fitting", briefingLanguage: "es", siteZone: "Europe/Madrid", window: { startsAt: start, endsAt: end }, replyBy: Date.parse("2026-11-24T07:42:00Z"), awaitingConfirmationUntil: null };
const assignment = { jobId: "job_1", reference: "BB-1042", title: "Terrace door repair", siteZone: "Europe/Madrid", place: { placeId: "place_1", alias: "Villa Mar" }, assignment: { assignmentId: "assignment_1", shiftId: "shift_1", state: "confirmed", task: "Terrace door repair", briefingLanguage: "es", window: { startsAt: start, endsAt: end }, nextStep: "travel", safetyHold: false } };
const base = { audience: "worker", unreadCount: 1, businessName: "Reformas Ruiz", siteZone: "Europe/Madrid", assignment: null, offers: [offer], openToCoverUntil: Date.parse("2026-11-24T17:00:00Z") };
const noop = () => {};
export const previews: ScreenPreview[] = ["cover-offer", "shift-today", "on-site", "nothing-scheduled", "offline", "portuguese", "rtl", "field-mode"].map(state => ({ id: "W-01", state, render: () => {
  const shift = state === "shift-today" ? assignment : state === "on-site" ? { ...assignment, assignment: { ...assignment.assignment, nextStep: "check_out", safetyHold: true } } : null;
  const data = homeProjectionSchema.parse({ ...base, assignment: shift, offers: state === "nothing-scheduled" || shift ? [] : [offer] });
  return <BeaconThemeProvider field><PreviewLocaleProvider initialLocale={state === "portuguese" ? "pt-PT" : "en"}><View style={{ flex: 1, direction: state === "rtl" ? "rtl" : "ltr" }}><NowView data={data.audience === "worker" ? data : null} status={state === "offline" ? "offline" : "ready"} lastConfirmedAt={state === "offline" ? now : null} agenda={null} name="Diego Torres" now={state === "on-site" ? Date.parse("2026-11-24T08:15:00Z") : now} onRetry={noop} onNavigate={noop} /></View></PreviewLocaleProvider></BeaconThemeProvider>;
} }));
