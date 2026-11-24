import {
  acceptInvitationRoute, declineInvitationRoute, getBusinessEligibilityRoute, getBusinessPeopleRoute, getInvitationRoute,
  inviteBusinessMemberRoute, openLinkRoute, patchBusinessMemberRolesRoute, reissueInvitationRoute, revokeBusinessMemberRoute, withdrawInvitationRoute,
} from "@bookbuddy/api-contract";
import type { RouteRequest } from "@bookbuddy/api-contract";
import type { ApiClient, RequestOptions } from "./client";

export function createAccessClient(api: ApiClient) {
  return {
    openLink: (opaque: string, options?: RequestOptions) => api.request(openLinkRoute, { params: { opaque } }, options),
    getBusinessPeople: (b: string, query?: RouteRequest<typeof getBusinessPeopleRoute.input>["query"], options?: RequestOptions) =>
      api.request(getBusinessPeopleRoute, { params: { b }, query }, options),
    getBusinessEligibility: (b: string, query?: RouteRequest<typeof getBusinessEligibilityRoute.input>["query"], options?: RequestOptions) =>
      api.request(getBusinessEligibilityRoute, { params: { b }, query }, options),
    inviteBusinessMember: (b: string, body: RouteRequest<typeof inviteBusinessMemberRoute.input>["body"], options?: RequestOptions) =>
      api.request(inviteBusinessMemberRoute, { params: { b }, body }, options),
    patchBusinessMemberRoles: (b: string, m: string, body: RouteRequest<typeof patchBusinessMemberRolesRoute.input>["body"], options?: RequestOptions) =>
      api.request(patchBusinessMemberRolesRoute, { params: { b, m }, body }, options),
    revokeBusinessMember: (member: string, body: RouteRequest<typeof revokeBusinessMemberRoute.input>["body"], options?: RequestOptions) =>
      api.request(revokeBusinessMemberRoute, { params: { member }, body }, options),
    getInvitation: (id: string, options?: RequestOptions) => api.request(getInvitationRoute, { params: { id } }, options),
    reissueInvitation: (id: string, body: RouteRequest<typeof reissueInvitationRoute.input>["body"], options?: RequestOptions) =>
      api.request(reissueInvitationRoute, { params: { id }, body }, options),
    withdrawInvitation: (id: string, body: RouteRequest<typeof withdrawInvitationRoute.input>["body"], options?: RequestOptions) =>
      api.request(withdrawInvitationRoute, { params: { id }, body }, options),
    acceptInvitation: (id: string, body: RouteRequest<typeof acceptInvitationRoute.input>["body"], options?: RequestOptions) =>
      api.request(acceptInvitationRoute, { params: { id }, body }, options),
    declineInvitation: (id: string, body: RouteRequest<typeof declineInvitationRoute.input>["body"], options?: RequestOptions) =>
      api.request(declineInvitationRoute, { params: { id }, body }, options),
  };
}
