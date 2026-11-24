import { threadLinkKind, threadLinkResolver } from "../chat/links";
import { jobIntakeLinkResolver, jobRecordLinkResolver } from "../links/job";
import { crewAvailabilityLinkResolver } from "../links/schedule";
import { registerLinkResolver } from "../links";
import type { LinkResolver } from "../links";
import { inviteKind, managesBusiness } from "./policy";
import { businessEligibilityPayload, businessHeader, businessMemberProjection, decodeBusinessEligibility } from "./businesses";
import { invitationOpeningSql } from "./invitations";
import { coverLinkResolver } from "../staffing/cover";

function invitationResolver(placeCondition = "1"): LinkResolver {
  return {
    targetKind: "invitation",
    project(resource, scope) {
      return `(SELECT CASE
        WHEN json_extract(value, '$.status') = 'unavailable' THEN json_set(value, '$.kind', 'unavailable')
        WHEN value IS NOT NULL THEN json_object('kind', 'invitation', 'invitation', json(value))
        WHEN EXISTS (SELECT 1 FROM invitations i JOIN accounts recipient ON recipient.id = i.recipient_id
          WHERE i.id = ${resource} AND (${placeCondition}) AND i.recipient_id = ${scope}.account_id AND i.state = 'pending'
            AND recipient.email_key IS NOT i.recipient_key) THEN
          json_object('kind', 'unavailable', 'status', 'unavailable', 'reason', 'wrong_account', 'supportReference', NULL)
        END FROM (SELECT (${invitationOpeningSql(`${scope}.account_id`)} AND i.id = ${resource} AND (${placeCondition})) AS value LIMIT 1))`;
    },
  };
}

registerLinkResolver("invitation", {
  ...invitationResolver(),
  legacyResource: (hash) => `(SELECT i.id FROM invitations i WHERE i.token_hash = ${hash})`,
});
// Place grants use the same recipient gate, but a scoped place token cannot
// open a business invitation or a different place-grant kind.
registerLinkResolver("place_invite", invitationResolver("i.place_id IS NOT NULL"));
registerLinkResolver("place_transfer", invitationResolver(`i.place_id IS NOT NULL AND ${inviteKind("i")} = 'place_transfer'`));

registerLinkResolver("business_eligibility", {
  targetKind: "business",
  project(resource, scope) {
    return `(WITH position(id) AS (VALUES ('')) SELECT json_object(
      'kind', 'business_eligibility', 'eligibility', json(${businessEligibilityPayload(`${scope}.role`)}))
      FROM businesses b JOIN operating_areas area ON area.id = b.catchment_id
      WHERE b.id = ${resource} AND b.id = ${scope}.business_id AND ${scope}.role IN ('provider_admin', 'foreman'))`;
  },
  decode(value) {
    const { eligibility } = value as { eligibility: unknown };
    return { kind: "business_eligibility", eligibility: decodeBusinessEligibility(JSON.stringify(eligibility)) };
  },
});

registerLinkResolver("business_member", {
  targetKind: "business",
  project(resource, scope) {
    return `(SELECT json_object('kind', 'business_member', 'business', ${businessHeader("b")},
      'member', json(${businessMemberProjection("m", `${scope}.account_id`, managesBusiness(`${scope}.account_id`, `${scope}.business_id`))}))
      FROM memberships m JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
      JOIN businesses b ON b.id = m.business_id JOIN operating_areas area ON area.id = b.catchment_id
      WHERE m.id = ${resource} AND m.business_id = ${scope}.business_id AND m.state = 'active' AND ${scope}.role = 'provider_admin')`;
  },
});

for (const [kind, resolver] of Object.entries(coverLinkResolver)) registerLinkResolver(kind, resolver);
for (const kind of ["job_update", "quote_ready", "visit_live"]) registerLinkResolver(kind, jobRecordLinkResolver);
registerLinkResolver("job_handoff", jobIntakeLinkResolver);
registerLinkResolver("crew_availability", crewAvailabilityLinkResolver);
registerLinkResolver(threadLinkKind, threadLinkResolver);
