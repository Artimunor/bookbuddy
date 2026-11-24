import {
  acceptCoverRoute, acceptOfferRoute, closeCoverRoute, confirmCoverRoute, declineCoverRoute, declineOfferRoute, dropoutAssignmentRoute,
  getCoverRoute, getCrewMemberRoute, getOfferRoute, getShiftCandidatesRoute, issueAssignmentOfferRoute, issueCoverRoute,
  listCrewRoute, releaseCoverRoute, withdrawCoverRoute, withdrawOfferRoute,
} from "@bookbuddy/api-contract";
import type { RouteRequest } from "@bookbuddy/api-contract";
import type { ApiClient, RequestOptions } from "./client";

export function createStaffingClient(api: ApiClient) {
  return {
    listCrew: (query?: RouteRequest<typeof listCrewRoute.input>["query"], options?: RequestOptions) =>
      api.request(listCrewRoute, { query }, options),
    getCrewMember: (id: string, query?: RouteRequest<typeof getCrewMemberRoute.input>["query"], options?: RequestOptions) =>
      api.request(getCrewMemberRoute, { params: { id }, query }, options),
    getShiftCandidates: (s: string, options?: RequestOptions) => api.request(getShiftCandidatesRoute, { params: { s } }, options),
    issueAssignmentOffer: (id: string, body: RouteRequest<typeof issueAssignmentOfferRoute.input>["body"], options?: RequestOptions) =>
      api.request(issueAssignmentOfferRoute, { params: { id }, body }, options),
    getOffer: (id: string, options?: RequestOptions) => api.request(getOfferRoute, { params: { id } }, options),
    acceptOffer: (id: string, body: RouteRequest<typeof acceptOfferRoute.input>["body"], options?: RequestOptions) =>
      api.request(acceptOfferRoute, { params: { id }, body }, options),
    declineOffer: (id: string, body: RouteRequest<typeof declineOfferRoute.input>["body"], options?: RequestOptions) =>
      api.request(declineOfferRoute, { params: { id }, body }, options),
    withdrawOffer: (id: string, body: RouteRequest<typeof withdrawOfferRoute.input>["body"], options?: RequestOptions) =>
      api.request(withdrawOfferRoute, { params: { id }, body }, options),
    dropoutAssignment: (id: string, body: RouteRequest<typeof dropoutAssignmentRoute.input>["body"], options?: RequestOptions) =>
      api.request(dropoutAssignmentRoute, { params: { id }, body }, options),
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
