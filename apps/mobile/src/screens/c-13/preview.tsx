import { placeSummarySchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { PlacesView } from "./Screen";
const villa = placeSummarySchema.parse({ id: "villa", alias: "Villa Mar", state: "in_area", areaName: "Xàbia", siteZone: "Europe/Madrid", relationship: "owner", ownerDisplayName: "Claire Martin", namedApproverDisplayName: "Claire Martin", viewerIsNamedApprover: true, openBookingCount: 1, liveBookingCount: 0 });
const apartment = placeSummarySchema.parse({ ...villa, id: "apartamento-sol", alias: "Apartamento Sol", areaName: "Dénia", relationship: "manager", ownerDisplayName: "Hugo Lambert", namedApproverDisplayName: "Hugo Lambert", viewerIsNamedApprover: false, openBookingCount: 1 });
const casa = placeSummarySchema.parse({ ...villa, id: "casa-pinos", alias: "Casa Pinos", areaName: "Moraira", openBookingCount: 0 });
const noop = () => {};
const props = { query: "", onQuery: noop, status: "ready" as const, onRetry: noop, onBack: noop, onOpen: noop, onAdd: noop };
export const previews: ScreenPreview[] = [
  { id: "C-13", state: "one", render: () => <PlacesView {...props} places={[villa]} total={1} /> },
  { id: "C-13", state: "many", render: () => <PlacesView {...props} places={[villa, apartment, casa]} total={3} /> },
];
