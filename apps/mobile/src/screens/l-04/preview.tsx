import type { ScreenPreview } from "../../preview/screens/types";
import { hold, heldAt, booking, viewerZone, noop } from "../l-01/fixture";
import { ReviewView } from "./Screen";
const props = { hold, left: hold.expiresAt - heldAt, viewerZone, onBack: noop, onBook: noop };
export const previews: ScreenPreview[] = [
  { id: "L-04", state: "held", render: () => <ReviewView {...props} state="held" /> },
  { id: "L-04", state: "processing", render: () => <ReviewView {...props} state="processing" /> },
  { id: "L-04", state: "booked", render: () => <ReviewView {...props} state="booked" booked={booking} /> },
  { id: "L-04", state: "not-booked", render: () => <ReviewView {...props} state="not_booked" left={0} failure={{ reason: "expired", expiresAt: hold.expiresAt }} /> },
  { id: "L-04", state: "checking", render: () => <ReviewView {...props} state="checking" /> },
];
