import { placeSummarySchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { PlacesView } from "./Screen";
const places = [placeSummarySchema.parse({ id: "villa", alias: "Villa Mar", state: "in_area", areaName: "Xàbia", siteZone: "Europe/Madrid", relationship: "owner", ownerDisplayName: "Claire Martin", namedApproverDisplayName: "Claire Martin", viewerIsNamedApprover: true, openBookingCount: 1, liveBookingCount: 0 })];
export const previews: ScreenPreview[] = [{ id: "C-13", state: "one", render: () => <PlacesView query="" onQuery={() => {}} places={places} total={1} status="ready" onRetry={() => {}} onBack={() => {}} onOpen={() => {}} onAdd={() => {}} /> }];
