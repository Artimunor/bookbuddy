import {
  cancelVisitRoute, confirmVisitWindowRoute, getBusinessScheduleRoute, getCrewAvailabilityRoute, getJobWindowsRoute, getShiftRoute,
  listShiftsRoute, patchCrewAvailabilityRoute, proposeVisitWindowsRoute, requestVisitRescheduleRoute, withdrawVisitWindowRoute,
} from "@bookbuddy/api-contract";
import type { RouteRequest } from "@bookbuddy/api-contract";
import type { ApiClient, RequestOptions } from "./client";

export function createScheduleClient(api: ApiClient) {
  return {
    getJobWindows: (j: string, options?: RequestOptions) => api.request(getJobWindowsRoute, { params: { j } }, options),
    getBusinessSchedule: (b: string, query: RouteRequest<typeof getBusinessScheduleRoute.input>["query"], options?: RequestOptions) =>
      api.request(getBusinessScheduleRoute, { params: { b }, query }, options),
    listShifts: (query?: RouteRequest<typeof listShiftsRoute.input>["query"], options?: RequestOptions) =>
      api.request(listShiftsRoute, { query }, options),
    getShift: (s: string, options?: RequestOptions) => api.request(getShiftRoute, { params: { s } }, options),
    getCrewAvailability: (member: string, query?: RouteRequest<typeof getCrewAvailabilityRoute.input>["query"], options?: RequestOptions) =>
      api.request(getCrewAvailabilityRoute, { params: { member }, query }, options),
    proposeVisitWindows: (j: string, body: RouteRequest<typeof proposeVisitWindowsRoute.input>["body"], options?: RequestOptions) =>
      api.request(proposeVisitWindowsRoute, { params: { j }, body }, options),
    confirmVisitWindow: (id: string, body: RouteRequest<typeof confirmVisitWindowRoute.input>["body"], options?: RequestOptions) =>
      api.request(confirmVisitWindowRoute, { params: { id }, body }, options),
    withdrawVisitWindow: (id: string, body: RouteRequest<typeof withdrawVisitWindowRoute.input>["body"], options?: RequestOptions) =>
      api.request(withdrawVisitWindowRoute, { params: { id }, body }, options),
    cancelVisit: (id: string, body: RouteRequest<typeof cancelVisitRoute.input>["body"], options?: RequestOptions) =>
      api.request(cancelVisitRoute, { params: { id }, body }, options),
    requestVisitReschedule: (id: string, body: RouteRequest<typeof requestVisitRescheduleRoute.input>["body"], options?: RequestOptions) =>
      api.request(requestVisitRescheduleRoute, { params: { id }, body }, options),
    patchCrewAvailability: (member: string, body: RouteRequest<typeof patchCrewAvailabilityRoute.input>["body"], options?: RequestOptions) =>
      api.request(patchCrewAvailabilityRoute, { params: { member }, body }, options),
  };
}
