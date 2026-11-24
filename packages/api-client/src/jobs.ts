import {
  acceptJobHandoffRoute, declineJobHandoffRoute, getBusinessOverviewRoute, getHandoffRoute, getHomeRoute, getJobRoute,
  getJobsRoute, getOperationRoute, offerJobHandoffRoute, submitRequestRoute, submitSupportRoute, withdrawJobHandoffRoute,
} from "@bookbuddy/api-contract";
import type { RouteRequest } from "@bookbuddy/api-contract";
import type { ApiClient, RequestOptions } from "./client";

export function createJobsClient(api: ApiClient) {
  return {
    getHome: (query?: RouteRequest<typeof getHomeRoute.input>["query"], options?: RequestOptions) =>
      api.request(getHomeRoute, { query }, options),
    getJobs: (query?: RouteRequest<typeof getJobsRoute.input>["query"], options?: RequestOptions) =>
      api.request(getJobsRoute, { query }, options),
    getJob: (j: string, query?: RouteRequest<typeof getJobRoute.input>["query"], options?: RequestOptions) =>
      api.request(getJobRoute, { params: { j }, query }, options),
    getHandoff: (h: string, options?: RequestOptions) => api.request(getHandoffRoute, { params: { h } }, options),
    getBusinessOverview: (b: string, options?: RequestOptions) => api.request(getBusinessOverviewRoute, { params: { b } }, options),
    submitRequest: (body: RouteRequest<typeof submitRequestRoute.input>["body"], options?: RequestOptions) =>
      api.request(submitRequestRoute, { body }, options),
    offerJobHandoff: (j: string, body: RouteRequest<typeof offerJobHandoffRoute.input>["body"], options?: RequestOptions) =>
      api.request(offerJobHandoffRoute, { params: { j }, body }, options),
    acceptJobHandoff: (j: string, h: string, body: RouteRequest<typeof acceptJobHandoffRoute.input>["body"], options?: RequestOptions) =>
      api.request(acceptJobHandoffRoute, { params: { j, h }, body }, options),
    declineJobHandoff: (j: string, h: string, body: RouteRequest<typeof declineJobHandoffRoute.input>["body"], options?: RequestOptions) =>
      api.request(declineJobHandoffRoute, { params: { j, h }, body }, options),
    withdrawJobHandoff: (j: string, h: string, body: RouteRequest<typeof withdrawJobHandoffRoute.input>["body"], options?: RequestOptions) =>
      api.request(withdrawJobHandoffRoute, { params: { j, h }, body }, options),
    getOperation: (id: string, options?: RequestOptions) => api.request(getOperationRoute, { params: { id } }, options),
    submitSupport: (body: RouteRequest<typeof submitSupportRoute.input>["body"], options?: RequestOptions) =>
      api.request(submitSupportRoute, { body }, options),
  };
}
