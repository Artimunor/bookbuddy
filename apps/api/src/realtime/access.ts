import type { LiveTopicKey } from "@bookbuddy/api-contract";
import type { Bindings } from "../bindings";
import { enabledTranslationPairs } from "../providers/translate";
import { accessClock, at, scopedStatement } from "../modules/access/policy";
import type { SessionAccess } from "../modules/auth/session";
import { readLiveThread } from "../modules/chat/read";
import { currentMembership } from "../modules/jobs/projections";
import { placeCapability } from "../modules/places/policy";
import { confirmedWindow, customer, foreman, provider, scheduleAccess, targetId } from "../modules/schedule/policy";
import { approvedJob } from "../modules/staffing/crew";

// Match the corresponding HTTP read's authority, not just the active role or an opaque ID.
const visitAccess = `EXISTS (SELECT 1 FROM visits v JOIN schedule_job j ON j.id = v.job_id ${confirmedWindow("v")}
  WHERE v.id = ${targetId} AND booked.id IS NOT NULL AND v.state IN ('booked', 'finished') AND j.state <> 'cancelled'
    AND ${customer("s")} AND (j.owner_id = s.account_id OR ${placeCapability("j.place_id", "s.account_id", "view")}))`;
const providerJobAccess = `EXISTS (SELECT 1 FROM jobs j WHERE j.id = ? AND (${foreman("s")} OR ${provider("s")}))`;
const providerCrewAccess = `s.business_id = ? AND ${currentMembership("s", at)} IS NOT NULL AND
  (s.role = 'provider_admin' OR (s.role = 'foreman' AND EXISTS (
    SELECT 1 FROM jobs j JOIN places p ON p.id = j.place_id AND p.state = 'in_area'
    WHERE j.business_id = s.business_id AND j.state = 'open' AND ${foreman("s", "j")} AND ${approvedJob("j")})))`;
const readScope = (access: SessionAccess, predicate: string, ...params: string[]) => scopedStatement(access, `
  SELECT (SELECT s.context_id FROM live_scope s WHERE ${predicate}) AS scope_id, expires_at, NULL AS value FROM acting_session`, ...params);

export function liveAccess(session: SessionAccess, now: number, topic: LiveTopicKey, env: Bindings) {
  const id = topic.opaqueId;
  switch (topic.kind) {
    case "thread": return readLiveThread(session, now, id, enabledTranslationPairs(env));
    case "customer-visit": return readScope(scheduleAccess(session, now, { kind: "visit", id }), visitAccess);
    case "provider-job": return readScope(accessClock(session, now), providerJobAccess, id);
    case "provider-crew": return readScope(accessClock(session, now), providerCrewAccess, id);
    case "scope-inbox": return readScope(session, "s.context_id = ?", id);
  }
}
