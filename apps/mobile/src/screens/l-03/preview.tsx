import type { ScreenPreview } from "../../preview/screens/types";
import { detail, fullDetail, pausedDetail, viewerZone, noop } from "../l-01/fixture";
import { DetailView } from "../l-02/Screen";
import { SlotView } from "./Screen";
function SlotPreview({ state }: { state: "available" | "slot-just-taken" | "sold-out-day" | "no-times" | "offline" }) {
  const taken = state === "slot-just-taken";
  const current = state === "sold-out-day" ? { ...detail, slots: [...fullDetail.slots.slice(0, 2), ...detail.slots.slice(2)] } : state === "no-times" ? pausedDetail : detail;
  return <><DetailView detail={current} viewerZone={viewerZone} onBack={noop} onChoose={noop} onBrowse={noop} />
    <SlotView detail={current} initialSelection={state === "available" ? detail.nextSlotId ?? undefined : undefined} viewerZone={viewerZone}
      blocked={state === "offline" ? "offline" : undefined}
      refusal={taken ? { reason: "places_unavailable", slotId: "morning", placesLeft: 0 } : undefined}
      availability={taken ? new Map([["morning", 0]]) : undefined} onClose={noop} onHold={noop} /></>;
}
export const previews: ScreenPreview[] = (["available", "slot-just-taken", "sold-out-day", "no-times", "offline"] as const)
  .map(state => ({ id: "L-03", state, render: () => <SlotPreview state={state} /> }));
