import type { getJobRoute, offerJobHandoffRoute, RouteResponse } from "@bookbuddy/api-contract";
import type { ApiError } from "../../api/requests";

export type ProviderJob = Extract<Extract<RouteResponse<typeof getJobRoute.output>, { audience: "provider_admin" }>["job"], { view: "whole" }>;
type Preview = NonNullable<ProviderJob["handoffPreview"]>;
type Handoff = NonNullable<ProviderJob["handoff"]>;
type Offer = RouteResponse<typeof offerJobHandoffRoute.output>;
type HandoffDetail = Pick<ProviderJob, "revision"> & {
  handoffPreview: Pick<Preview, "deadlines"> | null;
  handoff: Pick<Handoff, "handoffId" | "expiresAt"> | null;
};

export function handoffPresentation(job: HandoffDetail | null, offer: Offer | null, selected: string | null, detailError: ApiError | null) {
  const status = detailError?.code === "INVALID_RESPONSE" ? detailError.status : null;
  const denied = detailError?.code === "NOT_FOUND" || status === 403 || status === 404;
  const unauthenticated = detailError?.code === "UNAUTHENTICATED" || status === 401;
  const matchingOffer = offer?.jobId === selected ? offer : null;
  const receipt = denied || unauthenticated ? null : matchingOffer;
  const awaitingDetail = receipt !== null && (!job || job.revision < receipt.revision);
  const deadlines = awaitingDetail ? null : job?.handoffPreview?.deadlines;
  const handoff = awaitingDetail ? null : job?.handoff;
  const currentReceipt = receipt && (awaitingDetail || receipt.handoffId === handoff?.handoffId) ? receipt : null;
  return {
    awaitingDetail,
    discardReceipt: denied && matchingOffer !== null,
    standard: deadlines?.standard != null,
    urgent: deadlines?.urgent != null,
    replyAt: currentReceipt?.expiresAt ?? handoff?.expiresAt ?? null,
  };
}
