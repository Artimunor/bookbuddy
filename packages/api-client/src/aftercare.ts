import {
  appendCaseEventRoute, confirmNoFundsRoute, correctPaymentRoute, deferCollectionRoute, getJobBillRoute, getJobCompletionRoute,
  getJobRatingEligibilityRoute, getProblemCaseRoute, issueBillRoute, listJobCasesRoute, recordCheckingRoute, recordPaidRoute,
  releaseDeferralRoute, returnCompletionRoute, signOffCompletionRoute, submitCompletionRoute, submitProblemCaseRoute, submitRatingRoute,
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
    getJobBill: (j: string, query?: RouteRequest<typeof getJobBillRoute.input>["query"], options?: RequestOptions) =>
      api.request(getJobBillRoute, { params: { j }, query }, options),
    issueBill: (j: string, body: RouteRequest<typeof issueBillRoute.input>["body"], options?: RequestOptions) =>
      api.request(issueBillRoute, { params: { j }, body }, options),
    recordPaid: (id: string, body: RouteRequest<typeof recordPaidRoute.input>["body"], options?: RequestOptions) =>
      api.request(recordPaidRoute, { params: { id }, body }, options),
    correctPayment: (id: string, body: RouteRequest<typeof correctPaymentRoute.input>["body"], options?: RequestOptions) =>
      api.request(correctPaymentRoute, { params: { id }, body }, options),
    recordChecking: (id: string, body: RouteRequest<typeof recordCheckingRoute.input>["body"], options?: RequestOptions) =>
      api.request(recordCheckingRoute, { params: { id }, body }, options),
    confirmNoFunds: (id: string, body: RouteRequest<typeof confirmNoFundsRoute.input>["body"], options?: RequestOptions) =>
      api.request(confirmNoFundsRoute, { params: { id }, body }, options),
    deferCollection: (id: string, body: RouteRequest<typeof deferCollectionRoute.input>["body"], options?: RequestOptions) =>
      api.request(deferCollectionRoute, { params: { id }, body }, options),
    releaseDeferral: (id: string, body: RouteRequest<typeof releaseDeferralRoute.input>["body"], options?: RequestOptions) =>
      api.request(releaseDeferralRoute, { params: { id }, body }, options),
    listJobCases: (j: string, query?: RouteRequest<typeof listJobCasesRoute.input>["query"], options?: RequestOptions) =>
      api.request(listJobCasesRoute, { params: { j }, query }, options),
    getProblemCase: (id: string, query?: RouteRequest<typeof getProblemCaseRoute.input>["query"], options?: RequestOptions) =>
      api.request(getProblemCaseRoute, { params: { id }, query }, options),
    submitProblemCase: (j: string, body: RouteRequest<typeof submitProblemCaseRoute.input>["body"], options?: RequestOptions) =>
      api.request(submitProblemCaseRoute, { params: { j }, body }, options),
    appendCaseEvent: (id: string, body: RouteRequest<typeof appendCaseEventRoute.input>["body"], options?: RequestOptions) =>
      api.request(appendCaseEventRoute, { params: { id }, body }, options),
  };
}
