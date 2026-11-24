import {
  archivePlaceRoute, changePlaceApproverRoute, createPlaceRoute, getPlaceRoute, invitePlacePersonRoute,
  listPlacesRoute, patchPlacePersonRoute, patchPlaceRoute, transferPlaceRoute, verifyPlacePinRoute,
} from "@bookbuddy/api-contract";
import type { RouteRequest } from "@bookbuddy/api-contract";
import type { ApiClient, RequestOptions } from "./client";

export function createPlacesClient(api: ApiClient) {
  return {
    listPlaces: (query?: RouteRequest<typeof listPlacesRoute.input>["query"], options?: RequestOptions) =>
      api.request(listPlacesRoute, { query }, options),
    getPlace: (p: string, options?: RequestOptions) => api.request(getPlaceRoute, { params: { p } }, options),
    createPlace: (body: RouteRequest<typeof createPlaceRoute.input>["body"], options?: RequestOptions) =>
      api.request(createPlaceRoute, { body }, options),
    patchPlace: (p: string, body: RouteRequest<typeof patchPlaceRoute.input>["body"], options?: RequestOptions) =>
      api.request(patchPlaceRoute, { params: { p }, body }, options),
    patchPlacePerson: (p: string, person: string, body: RouteRequest<typeof patchPlacePersonRoute.input>["body"], options?: RequestOptions) =>
      api.request(patchPlacePersonRoute, { params: { p, person }, body }, options),
    verifyPlacePin: (p: string, body: RouteRequest<typeof verifyPlacePinRoute.input>["body"], options?: RequestOptions) =>
      api.request(verifyPlacePinRoute, { params: { p }, body }, options),
    invitePlacePerson: (p: string, body: RouteRequest<typeof invitePlacePersonRoute.input>["body"], options?: RequestOptions) =>
      api.request(invitePlacePersonRoute, { params: { p }, body }, options),
    changePlaceApprover: (p: string, body: RouteRequest<typeof changePlaceApproverRoute.input>["body"], options?: RequestOptions) =>
      api.request(changePlaceApproverRoute, { params: { p }, body }, options),
    transferPlace: (p: string, body: RouteRequest<typeof transferPlaceRoute.input>["body"], options?: RequestOptions) =>
      api.request(transferPlaceRoute, { params: { p }, body }, options),
    archivePlace: (p: string, body: RouteRequest<typeof archivePlaceRoute.input>["body"], options?: RequestOptions) =>
      api.request(archivePlaceRoute, { params: { p }, body }, options),
  };
}
