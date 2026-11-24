import {
  approveChangeVersionRoute, approveQuoteVersionRoute, createChangeVersionRoute, createQuoteVersionRoute,
  declineChangeVersionRoute, declineQuoteVersionRoute, getChangeVersionRoute, getQuoteVersionRoute,
  issueChangeVersionRoute, issueQuoteVersionRoute, listChangeVersionsRoute, listContractNoticesRoute, listQuoteVersionsRoute,
  requestEarlyStartRoute, returnChangeVersionRoute, returnQuoteVersionRoute, submitChangeReviewRoute,
  submitQuoteReviewRoute, withdrawContractRoute,
} from "@bookbuddy/api-contract";
import type { RouteRequest } from "@bookbuddy/api-contract";
import type { ApiClient, RequestOptions } from "./client";

export function createCommercialClient(api: ApiClient) {
  return {
    listQuoteVersions: (j: string, query?: RouteRequest<typeof listQuoteVersionsRoute.input>["query"], options?: RequestOptions) =>
      api.request(listQuoteVersionsRoute, { params: { j }, query }, options),
    listChangeVersions: (j: string, query?: RouteRequest<typeof listChangeVersionsRoute.input>["query"], options?: RequestOptions) =>
      api.request(listChangeVersionsRoute, { params: { j }, query }, options),
    getQuoteVersion: (j: string, id: string, options?: RequestOptions) => api.request(getQuoteVersionRoute, { params: { j, id } }, options),
    getChangeVersion: (j: string, id: string, options?: RequestOptions) => api.request(getChangeVersionRoute, { params: { j, id } }, options),
    createQuoteVersion: (j: string, body: RouteRequest<typeof createQuoteVersionRoute.input>["body"], options?: RequestOptions) =>
      api.request(createQuoteVersionRoute, { params: { j }, body }, options),
    createChangeVersion: (j: string, body: RouteRequest<typeof createChangeVersionRoute.input>["body"], options?: RequestOptions) =>
      api.request(createChangeVersionRoute, { params: { j }, body }, options),
    submitQuoteReview: (id: string, body: RouteRequest<typeof submitQuoteReviewRoute.input>["body"], options?: RequestOptions) =>
      api.request(submitQuoteReviewRoute, { params: { id }, body }, options),
    submitChangeReview: (id: string, body: RouteRequest<typeof submitChangeReviewRoute.input>["body"], options?: RequestOptions) =>
      api.request(submitChangeReviewRoute, { params: { id }, body }, options),
    returnQuoteVersion: (id: string, body: RouteRequest<typeof returnQuoteVersionRoute.input>["body"], options?: RequestOptions) =>
      api.request(returnQuoteVersionRoute, { params: { id }, body }, options),
    returnChangeVersion: (id: string, body: RouteRequest<typeof returnChangeVersionRoute.input>["body"], options?: RequestOptions) =>
      api.request(returnChangeVersionRoute, { params: { id }, body }, options),
    issueQuoteVersion: (id: string, body: RouteRequest<typeof issueQuoteVersionRoute.input>["body"], options?: RequestOptions) =>
      api.request(issueQuoteVersionRoute, { params: { id }, body }, options),
    issueChangeVersion: (id: string, body: RouteRequest<typeof issueChangeVersionRoute.input>["body"], options?: RequestOptions) =>
      api.request(issueChangeVersionRoute, { params: { id }, body }, options),
    approveQuoteVersion: (id: string, body: RouteRequest<typeof approveQuoteVersionRoute.input>["body"], options?: RequestOptions) =>
      api.request(approveQuoteVersionRoute, { params: { id }, body }, options),
    declineQuoteVersion: (id: string, body: RouteRequest<typeof declineQuoteVersionRoute.input>["body"], options?: RequestOptions) =>
      api.request(declineQuoteVersionRoute, { params: { id }, body }, options),
    approveChangeVersion: (id: string, body: RouteRequest<typeof approveChangeVersionRoute.input>["body"], options?: RequestOptions) =>
      api.request(approveChangeVersionRoute, { params: { id }, body }, options),
    declineChangeVersion: (id: string, body: RouteRequest<typeof declineChangeVersionRoute.input>["body"], options?: RequestOptions) =>
      api.request(declineChangeVersionRoute, { params: { id }, body }, options),
    listContractNotices: (j: string, options?: RequestOptions) => api.request(listContractNoticesRoute, { params: { j } }, options),
    requestEarlyStart: (j: string, body: RouteRequest<typeof requestEarlyStartRoute.input>["body"], options?: RequestOptions) =>
      api.request(requestEarlyStartRoute, { params: { j }, body }, options),
    withdrawContract: (j: string, body: RouteRequest<typeof withdrawContractRoute.input>["body"], options?: RequestOptions) =>
      api.request(withdrawContractRoute, { params: { j }, body }, options),
  };
}
