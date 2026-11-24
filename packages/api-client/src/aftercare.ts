import {
  getJobCompletionRoute, getJobRatingEligibilityRoute, returnCompletionRoute, signOffCompletionRoute,
  submitCompletionRoute, submitRatingRoute,
} from "@bookbuddy/api-contract";
import type { RouteRequest } from "@bookbuddy/api-contract";
import type { ApiClient, RequestOptions } from "./client";

export function createAftercareClient(api: ApiClient) {
  return {
    getJobCompletion: (j: string, query?: RouteRequest<typeof getJobCompletionRoute.input>["query"], options?: RequestOptions) =>
      api.request(getJobCompletionRoute, { params: { j }, query }, options),
    submitCompletion: (j: string, body: RouteRequest<typeof submitCompletionRoute.input>["body"], options?: RequestOptions) =>
      api.request(submitCompletionRoute, { params: { j }, body }, options),
    returnCompletion: (id: string, body: RouteRequest<typeof returnCompletionRoute.input>["body"], options?: RequestOptions) =>
      api.request(returnCompletionRoute, { params: { id }, body }, options),
    signOffCompletion: (id: string, body: RouteRequest<typeof signOffCompletionRoute.input>["body"], options?: RequestOptions) =>
      api.request(signOffCompletionRoute, { params: { id }, body }, options),
    getJobRatingEligibility: (j: string, options?: RequestOptions) =>
      api.request(getJobRatingEligibilityRoute, { params: { j } }, options),
    submitRating: (j: string, body: RouteRequest<typeof submitRatingRoute.input>["body"], options?: RequestOptions) =>
      api.request(submitRatingRoute, { params: { j }, body }, options),
  };
}
