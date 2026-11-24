import type { ScreenPreview } from "../../preview/screens/types";
import { detail, fullDetail, pausedDetail, viewerZone, noop } from "../l-01/fixture";
import { DetailView } from "./Screen";
export const previews: ScreenPreview[] = [
  { id: "L-02", state: "open", render: () => <DetailView detail={detail} viewerZone={viewerZone} onBack={noop} onChoose={noop} onBrowse={noop} /> },
  { id: "L-02", state: "fully-booked", render: () => <DetailView detail={fullDetail} viewerZone={viewerZone} onBack={noop} onChoose={noop} onBrowse={noop} /> },
  { id: "L-02", state: "paused", render: () => <DetailView detail={pausedDetail} viewerZone={viewerZone} onBack={noop} onChoose={noop} onBrowse={noop} /> },
];
