import { linkOpeningSchema } from "@bookbuddy/api-contract";
import { at } from "../access/policy";
import { projectIntake, projectIntakeLinkSql, projectJob, projectJobLinkSql } from "../jobs/read";
import type { ReadRows } from "../jobs/read";
import { placeCapability } from "../places/policy";
import { unavailableLink } from ".";
import type { LinkResolver } from ".";

// The ready/live events name an exact version or visit, not whichever record
// happens to be current when the link opens. The job reader rechecks job access.
export const jobRecordLinkResolver: LinkResolver = {
  targetKind: "job",
  project(resource, scope) {
    const kind = `${scope}.kind`;
    const visit = `CASE WHEN ${kind} = 'visit_live' THEN ${resource} END`;
    const job = `CASE ${kind}
      WHEN 'quote_ready' THEN (SELECT q.job_id FROM quote_versions q JOIN jobs j ON j.id = q.job_id
        JOIN places p ON p.id = j.place_id WHERE q.id = ${resource} AND q.state = 'issued' AND q.issued_at <= ${at}
        AND q.expires_at > ${at} AND j.state = 'open' AND ${scope}.role = 'customer'
        AND p.named_approver_id = ${scope}.account_id AND ${placeCapability("p.id", `${scope}.account_id`, "approve")})
      WHEN 'visit_live' THEN (SELECT v.job_id FROM visits v JOIN jobs j ON j.id = v.job_id
        JOIN visit_windows w ON w.visit_id = v.id AND w.state = 'confirmed'
        WHERE v.id = ${resource} AND v.state IN ('booked', 'finished') AND j.state <> 'cancelled' AND w.confirmed_at <= ${at})
      ELSE ${resource} END`;
    return `(SELECT json_object('kind', 'job', 'view', CASE WHEN ${kind} = 'visit_live' THEN 'today' ELSE 'whole' END,
      'record', json(value)) FROM (SELECT ${projectJobLinkSql(job, scope, visit)} AS value LIMIT 1) WHERE value IS NOT NULL)`;
  },
  decode(value, now) {
    const { record, view } = value as { record: ReadRows; view: "whole" | "today" };
    const opened = projectJob(record, view, now, view === "today");
    return opened ? linkOpeningSchema.parse({ kind: "job", record: opened }) : unavailableLink("removed");
  },
};

export const jobIntakeLinkResolver: LinkResolver = {
  targetKind: "job",
  project(resource, scope) {
    return `(SELECT json_object('kind', 'job', 'intake', json(value))
      FROM (SELECT ${projectIntakeLinkSql(resource, scope)} AS value LIMIT 1) WHERE value IS NOT NULL)`;
  },
  decode(value) {
    const { intake } = value as { intake: ReadRows["incoming"][number] }; // Internal SQL projection above.
    const opened = projectIntake(intake);
    return opened ? linkOpeningSchema.parse({ kind: "job", record: opened }) : unavailableLink("removed");
  },
};
