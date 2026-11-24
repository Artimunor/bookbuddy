import {
  bookSessionHoldRoute, cancelSessionBookingRoute, changeSessionHostRoute, createSessionHoldRoute, getSessionBookingFeedbackRoute,
  getSessionBookingRoute, getSessionHostOffersRoute, getSessionRosterRoute, getSessionRoute, listBusinessSessionsRoute, listSessionsRoute,
  listMySessionHostOffersRoute,
  moveSessionBookingRoute, publishSessionRoute, recordSessionAttendanceRoute, releaseSessionHoldRoute, replyToSessionHostOfferRoute,
  respondToSessionChangeRoute, updateSessionRosterRoute,
} from "@bookbuddy/api-contract";
import type { RouteRequest } from "@bookbuddy/api-contract";
import type { ApiClient, RequestOptions } from "./client";

export function createSessionsClient(api: ApiClient) {
  return {
    listSessions: (query: RouteRequest<typeof listSessionsRoute.input>["query"], options?: RequestOptions) =>
      api.request(listSessionsRoute, { query }, options),
    getSession: (id: string, query?: RouteRequest<typeof getSessionRoute.input>["query"], options?: RequestOptions) =>
      api.request(getSessionRoute, { params: { id }, query }, options),
    getSessionBooking: (id: string, options?: RequestOptions) => api.request(getSessionBookingRoute, { params: { id } }, options),
    createSessionHold: (id: string, body: RouteRequest<typeof createSessionHoldRoute.input>["body"], options?: RequestOptions) =>
      api.request(createSessionHoldRoute, { params: { id }, body }, options),
    bookSessionHold: (id: string, body: RouteRequest<typeof bookSessionHoldRoute.input>["body"], options?: RequestOptions) =>
      api.request(bookSessionHoldRoute, { params: { id }, body }, options),
    releaseSessionHold: (id: string, body: RouteRequest<typeof releaseSessionHoldRoute.input>["body"], options?: RequestOptions) =>
      api.request(releaseSessionHoldRoute, { params: { id }, body }, options),
    moveSessionBooking: (id: string, body: RouteRequest<typeof moveSessionBookingRoute.input>["body"], options?: RequestOptions) =>
      api.request(moveSessionBookingRoute, { params: { id }, body }, options),
    cancelSessionBooking: (id: string, body: RouteRequest<typeof cancelSessionBookingRoute.input>["body"], options?: RequestOptions) =>
      api.request(cancelSessionBookingRoute, { params: { id }, body }, options),
    respondToSessionChange: (id: string, body: RouteRequest<typeof respondToSessionChangeRoute.input>["body"], options?: RequestOptions) =>
      api.request(respondToSessionChangeRoute, { params: { id }, body }, options),
    listBusinessSessions: (b: string, query?: RouteRequest<typeof listBusinessSessionsRoute.input>["query"], options?: RequestOptions) =>
      api.request(listBusinessSessionsRoute, { params: { b }, query }, options),
    publishSession: (id: string, body: RouteRequest<typeof publishSessionRoute.input>["body"], options?: RequestOptions) =>
      api.request(publishSessionRoute, { params: { id }, body }, options),
    getSessionRoster: (id: string, query: RouteRequest<typeof getSessionRosterRoute.input>["query"], options?: RequestOptions) =>
      api.request(getSessionRosterRoute, { params: { id }, query }, options),
    updateSessionRoster: (id: string, body: RouteRequest<typeof updateSessionRosterRoute.input>["body"], options?: RequestOptions) =>
      api.request(updateSessionRosterRoute, { params: { id }, body }, options),
    getSessionHostOffers: (id: string, query: RouteRequest<typeof getSessionHostOffersRoute.input>["query"], options?: RequestOptions) =>
      api.request(getSessionHostOffersRoute, { params: { id }, query }, options),
    listMySessionHostOffers: (options?: RequestOptions) => api.request(listMySessionHostOffersRoute, {}, options),
    replyToSessionHostOffer: (id: string, body: RouteRequest<typeof replyToSessionHostOfferRoute.input>["body"], options?: RequestOptions) =>
      api.request(replyToSessionHostOfferRoute, { params: { id }, body }, options),
    changeSessionHost: (id: string, body: RouteRequest<typeof changeSessionHostRoute.input>["body"], options?: RequestOptions) =>
      api.request(changeSessionHostRoute, { params: { id }, body }, options),
    recordSessionAttendance: (id: string, body: RouteRequest<typeof recordSessionAttendanceRoute.input>["body"], options?: RequestOptions) =>
      api.request(recordSessionAttendanceRoute, { params: { id }, body }, options),
    getSessionBookingFeedback: (id: string, query: RouteRequest<typeof getSessionBookingFeedbackRoute.input>["query"], options?: RequestOptions) =>
      api.request(getSessionBookingFeedbackRoute, { params: { id }, query }, options),
  };
}
