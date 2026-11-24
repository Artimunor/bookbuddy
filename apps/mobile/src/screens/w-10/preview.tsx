import { workerFieldShiftSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { briefing } from "../w-09/preview";
import { previews as shiftPreviews } from "../w-04/preview";
import { DepartSheet } from "./Screen";
const now = Date.UTC(2026, 10, 24, 8, 1); const noop = () => {}; const props = { offline: false, arrived: false, commandState: "idle", receipt: null, onSend: noop, onClose: noop, now };
const estimate = { id: "estimate1", band: { startsAt: now + 9 * 60000, endsAt: now + 19 * 60000 }, at: now, audience: "crew_only" as const, foremanName: "Mateo Ruiz" };
const ShiftBackdrop = shiftPreviews.find(({ state }) => state === "confirmed")!.render;
export const previews: ScreenPreview[] = [
  { id: "W-10", state: "ready", render: () => <><ShiftBackdrop /><DepartSheet {...props} data={briefing.shift} /></> },
  { id: "W-10", state: "crew-lead", render: () => <><ShiftBackdrop /><DepartSheet {...props} data={{ ...briefing.shift, isLead: true }} viewerZone="Europe/London" /></> },
  { id: "W-10", state: "late-update", render: () => <><ShiftBackdrop /><DepartSheet {...props} data={workerFieldShiftSchema.parse({ ...briefing.shift, estimate })} now={now + 21 * 60000} /></> },
  { id: "W-10", state: "sent", render: () => <><ShiftBackdrop /><DepartSheet {...props} data={briefing.shift} commandState="done" receipt={{ at: now }} /></> },
  { id: "W-10", state: "offline", render: () => <><ShiftBackdrop /><DepartSheet {...props} data={briefing.shift} offline /></> },
];
