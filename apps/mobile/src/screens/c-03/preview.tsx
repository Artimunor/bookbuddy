import type { ScreenPreview } from "../../preview/screens/types";
import { emptyDraft } from "../c-02/draft";
import { fixtureDraft, fixturePlace } from "./fixtures";
import { PlaceRequestView } from "./Screen";
const noop = () => {};
const props = { onChange: noop, onBack: noop, onNext: noop, onAdd: noop, onRetry: noop, saved: true, failed: false };
export const previews: ScreenPreview[] = [
  { id: "C-03", state: "known-place", render: () => <PlaceRequestView {...props} draft={fixtureDraft} place={fixturePlace} places={[fixturePlace]} status="ready" /> },
  { id: "C-03", state: "new-place", render: () => <PlaceRequestView {...props} draft={emptyDraft} place={null} places={[]} status="ready" /> },
  { id: "C-03", state: "outside-service-area", render: () => <PlaceRequestView {...props} draft={fixtureDraft} place={{ ...fixturePlace, state: "out_of_area" }} places={[fixturePlace]} status="ready" /> },
  { id: "C-03", state: "offline", render: () => <PlaceRequestView {...props} draft={fixtureDraft} place={fixturePlace} places={[]} status="offline" /> },
];
