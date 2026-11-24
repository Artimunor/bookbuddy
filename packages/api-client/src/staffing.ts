import {
  acceptCoverRoute, closeCoverRoute, confirmCoverRoute, declineCoverRoute, getCoverRoute,
  issueCoverRoute, releaseCoverRoute, withdrawCoverRoute,
} from "@bookbuddy/api-contract";
import type { RouteRequest } from "@bookbuddy/api-contract";
import type { ApiClient, RequestOptions } from "./client";

export function createStaffingClient(api: ApiClient) {
  return {
    getCover: (g: string, options?: RequestOptions) => api.request(getCoverRoute, { params: { g } }, options),
    issueCover: (g: string, body: RouteRequest<typeof issueCoverRoute.input>["body"], options?: RequestOptions) =>
      api.request(issueCoverRoute, { params: { g }, body }, options),
    acceptCover: (g: string, body: RouteRequest<typeof acceptCoverRoute.input>["body"], options?: RequestOptions) =>
      api.request(acceptCoverRoute, { params: { g }, body }, options),
    declineCover: (g: string, body: RouteRequest<typeof declineCoverRoute.input>["body"], options?: RequestOptions) =>
      api.request(declineCoverRoute, { params: { g }, body }, options),
    withdrawCover: (g: string, body: RouteRequest<typeof withdrawCoverRoute.input>["body"], options?: RequestOptions) =>
      api.request(withdrawCoverRoute, { params: { g }, body }, options),
    releaseCover: (g: string, body: RouteRequest<typeof releaseCoverRoute.input>["body"], options?: RequestOptions) =>
      api.request(releaseCoverRoute, { params: { g }, body }, options),
    closeCover: (g: string, body: RouteRequest<typeof closeCoverRoute.input>["body"], options?: RequestOptions) =>
      api.request(closeCoverRoute, { params: { g }, body }, options),
    confirmCover: (g: string, body: RouteRequest<typeof confirmCoverRoute.input>["body"], options?: RequestOptions) =>
      api.request(confirmCoverRoute, { params: { g }, body }, options),
  };
}
