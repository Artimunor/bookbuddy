import { crewAvailabilitySchema } from "@bookbuddy/api-contract";
import type { SyncProjectionReader } from "../sync/registry";
import { availabilityJson, availabilityWeekFilter, projectAvailability, weekBounds } from "./availability";
import { cachedAgendaJson, cachedAgendaSchema } from "./shifts";

export const workerAgendaKind = "shift_agenda";
export const crewAvailabilityKind = "crew_availability";
const clock = "(SELECT at FROM schedule_clock)";
const workerKey = (scope: string) => `FROM ${scope} s JOIN account_contexts c ON c.id = s.context_id
  JOIN membership_roles r ON r.id = c.role_grant_id AND r.role = 'worker' AND r.granted_at <= ${clock}
  WHERE s.role = 'worker'`;

const snapshotIds: SyncProjectionReader["snapshotIds"] = (now) => ({
  sql: `WITH schedule_clock(at) AS (VALUES (?)) SELECT r.membership_id AS resource_id ${workerKey("snapshot_scope")}
    AND r.membership_id > s.after_id`, params: [now],
});
const projectIds = (kind: string) => `WITH schedule_clock(at) AS (VALUES (?)), worker AS MATERIALIZED (
  SELECT r.membership_id AS resource_id, s.business_id ${workerKey("live_scope")}
  AND r.membership_id IN (SELECT resource_id FROM projection_keys WHERE kind = '${kind}'))`;

export const scheduleSyncProjections: readonly SyncProjectionReader[] = [
  {
    kind: workerAgendaKind,
    schema: cachedAgendaSchema,
    snapshotIds,
    project: (now) => ({ sql: `${projectIds(workerAgendaKind)}
      SELECT worker.resource_id, ${cachedAgendaJson("worker.resource_id", "worker.business_id", clock)} AS value
      FROM worker`, params: [now] }),
  },
  {
    kind: crewAvailabilityKind,
    schema: { parse: (value) => crewAvailabilitySchema.parse(projectAvailability(value)) },
    snapshotIds,
    project: (now) => ({ sql: `${projectIds(crewAvailabilityKind)}
      SELECT worker.resource_id, ${availabilityJson("m", "area.site_zone", clock, availabilityWeekFilter(clock, "NULL"),
        weekBounds(clock, "NULL"))} AS value
      FROM worker JOIN memberships m ON m.id = worker.resource_id JOIN businesses b ON b.id = m.business_id
      JOIN operating_areas area ON area.id = b.catchment_id`, params: [now] }),
  },
];
