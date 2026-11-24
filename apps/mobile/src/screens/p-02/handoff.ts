import type { getJobRoute, offerJobHandoffRoute, RouteResponse } from "@bookbuddy/api-contract";

export type ProviderJob = Extract<Extract<RouteResponse<typeof getJobRoute.output>, { audience: "provider_admin" }>["job"], { view: "whole" }>;
type Preview = NonNullable<ProviderJob["handoffPreview"]>;
type Handoff = NonNullable<ProviderJob["handoff"]>;
type Offer = RouteResponse<typeof offerJobHandoffRoute.output>;
type HandoffDetail = Pick<ProviderJob, "revision"> & {
  handoffPreview: Pick<Preview, "deadlines"> | null;
  handoff: Pick<Handoff, "handoffId" | "expiresAt"> | null;
};

export function handoffPresentation(job: HandoffDetail | null, offer: Offer | null, selected: string | null) {
  const receipt = offer?.jobId === selected ? offer : null;
  const awaitingDetail = receipt !== null && (!job || job.revision < receipt.revision);
  const deadlines = awaitingDetail ? null : job?.handoffPreview?.deadlines;
  const handoff = awaitingDetail ? null : job?.handoff;
  const currentReceipt = receipt && (awaitingDetail || receipt.handoffId === handoff?.handoffId) ? receipt : null;
  return {
    awaitingDetail,
    standard: deadlines?.standard != null,
    urgent: deadlines?.urgent != null,
    replyAt: currentReceipt?.expiresAt ?? handoff?.expiresAt ?? null,
  };
}
