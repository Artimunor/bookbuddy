import { requestReceiptSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { fixtureDraft, fixturePlace } from "../c-03/fixtures";
import { ReviewRequestView } from "./Screen";
const noop = () => {};
const props = { draft: fixtureDraft, place: fixturePlace, offline: false, status: "idle" as const, checking: false, failed: false, receipt: null, onBack: noop, onEditDescription: noop, onEditPlace: noop, onSend: noop, onOpenJob: noop, onClose: noop };
const receipt = requestReceiptSchema.parse({ jobId: "job-1042", reference: "BB-1042", siteZone: "Europe/Madrid", submittedAt: Date.UTC(2026, 10, 23, 7, 5), journey: { step: "requested", cancelled: false, complete: false } });
export const previews: ScreenPreview[] = [
  { id: "C-04", state: "ready", render: () => <ReviewRequestView {...props} /> },
  { id: "C-04", state: "sending", render: () => <ReviewRequestView {...props} status="sending" /> },
  { id: "C-04", state: "sent", render: () => <ReviewRequestView {...props} receipt={receipt} /> },
  { id: "C-04", state: "not-sent-offline", render: () => <ReviewRequestView {...props} offline /> },
  { id: "C-04", state: "not-sent", render: () => <ReviewRequestView {...props} failed /> },
  { id: "C-04", state: "checking", render: () => <ReviewRequestView {...props} checking status="checking" /> },
];
