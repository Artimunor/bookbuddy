import {
  acknowledgeSafetyInstructionRoute, askSafetyQuestionRoute, departAssignmentRoute, finishVisitWorkRoute, getAssignmentBriefingRoute,
  getSafetyInstructionRoute, getVisitLiveRoute, getVisitLogRoute, getWorkerFieldShiftRoute, issueSafetyInstructionRoute,
  publishVisitUpdateRoute, recordAssignmentProgressRoute, recordAttendanceRoute, recordSafetyTeachBackRoute,
  requestAttendanceCorrectionRoute, startVisitWorkRoute,
} from "@bookbuddy/api-contract";
import type { RouteRequest } from "@bookbuddy/api-contract";
import type { ApiClient, RequestOptions } from "./client";

export function createFieldClient(api: ApiClient) {
  return {
    getVisitLive: (id: string, query?: RouteRequest<typeof getVisitLiveRoute.input>["query"], options?: RequestOptions) =>
      api.request(getVisitLiveRoute, { params: { id }, query }, options),
    getVisitLog: (id: string, query?: RouteRequest<typeof getVisitLogRoute.input>["query"], options?: RequestOptions) =>
      api.request(getVisitLogRoute, { params: { id }, query }, options),
    getWorkerFieldShift: (id: string, options?: RequestOptions) => api.request(getWorkerFieldShiftRoute, { params: { id } }, options),
    departAssignment: (id: string, body: RouteRequest<typeof departAssignmentRoute.input>["body"], options?: RequestOptions) =>
      api.request(departAssignmentRoute, { params: { id }, body }, options),
    recordAttendance: (id: string, body: RouteRequest<typeof recordAttendanceRoute.input>["body"], options?: RequestOptions) =>
      api.request(recordAttendanceRoute, { params: { id }, body }, options),
    requestAttendanceCorrection: (id: string, body: RouteRequest<typeof requestAttendanceCorrectionRoute.input>["body"], options?: RequestOptions) =>
      api.request(requestAttendanceCorrectionRoute, { params: { id }, body }, options),
    recordAssignmentProgress: (id: string, body: RouteRequest<typeof recordAssignmentProgressRoute.input>["body"], options?: RequestOptions) =>
      api.request(recordAssignmentProgressRoute, { params: { id }, body }, options),
    startVisitWork: (id: string, body: RouteRequest<typeof startVisitWorkRoute.input>["body"], options?: RequestOptions) =>
      api.request(startVisitWorkRoute, { params: { id }, body }, options),
    finishVisitWork: (id: string, body: RouteRequest<typeof finishVisitWorkRoute.input>["body"], options?: RequestOptions) =>
      api.request(finishVisitWorkRoute, { params: { id }, body }, options),
    publishVisitUpdate: (id: string, body: RouteRequest<typeof publishVisitUpdateRoute.input>["body"], options?: RequestOptions) =>
      api.request(publishVisitUpdateRoute, { params: { id }, body }, options),
    getAssignmentBriefing: (id: string, options?: RequestOptions) => api.request(getAssignmentBriefingRoute, { params: { id } }, options),
    getSafetyInstruction: (id: string, query?: RouteRequest<typeof getSafetyInstructionRoute.input>["query"], options?: RequestOptions) =>
      api.request(getSafetyInstructionRoute, { params: { id }, query }, options),
    issueSafetyInstruction: (id: string, body: RouteRequest<typeof issueSafetyInstructionRoute.input>["body"], options?: RequestOptions) =>
      api.request(issueSafetyInstructionRoute, { params: { id }, body }, options),
    recordSafetyTeachBack: (id: string, body: RouteRequest<typeof recordSafetyTeachBackRoute.input>["body"], options?: RequestOptions) =>
      api.request(recordSafetyTeachBackRoute, { params: { id }, body }, options),
    acknowledgeSafetyInstruction: (id: string, body: RouteRequest<typeof acknowledgeSafetyInstructionRoute.input>["body"], options?: RequestOptions) =>
      api.request(acknowledgeSafetyInstructionRoute, { params: { id }, body }, options),
    askSafetyQuestion: (id: string, body: RouteRequest<typeof askSafetyQuestionRoute.input>["body"], options?: RequestOptions) =>
      api.request(askSafetyQuestionRoute, { params: { id }, body }, options),
  };
}
