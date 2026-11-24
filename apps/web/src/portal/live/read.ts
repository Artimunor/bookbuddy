import type { ApiClient } from "@bookbuddy/api-client";
import { getVisitLiveRoute } from "@bookbuddy/api-contract";

export async function readCustomerLiveVisit(api: ApiClient, jobId: string, visitId: string, signal: AbortSignal, cursor?: string) {
  const result = await api.request(getVisitLiveRoute, { params: { id: visitId }, ...(cursor ? { query: { cursor } } : {}) }, { signal });
  return result.ok && "moments" in result.data && result.data.visitId === visitId && result.data.job.id === jobId ? result.data : null;
}
