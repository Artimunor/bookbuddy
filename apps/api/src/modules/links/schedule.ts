import { linkOpeningSchema } from "@bookbuddy/api-contract";
import { at } from "../access/policy";
import { availabilityJson, availabilityWeekFilter, projectAvailability, weekBounds } from "../schedule/availability";
import type { LinkResolver } from ".";

export const crewAvailabilityLinkResolver: LinkResolver = {
  targetKind: "update",
  project(resource, scope) {
    const boundary = `instr(${resource}, ':')`;
    const date = "input.day";
    const availability = availabilityJson("m", "area.site_zone", at, availabilityWeekFilter(at, date), weekBounds(at, date));
    return `(WITH input AS (SELECT substr(${resource}, 1, ${boundary} - 1) AS member, substr(${resource}, ${boundary} + 1) AS day)
      SELECT json_object('kind', 'crew_availability', 'date', ${date}, 'availability', json(${availability}))
      FROM input JOIN memberships m ON m.id = input.member
      JOIN businesses b ON b.id = m.business_id JOIN operating_areas area ON area.id = b.catchment_id
      WHERE ${scope}.role = 'worker' AND m.id = ${scope}.membership_id AND m.business_id = ${scope}.business_id)`;
  },
  decode(value) {
    const { date, availability } = value as { date: string; availability: unknown }; // Internal SQL projection above.
    return linkOpeningSchema.parse({ kind: "crew_availability", date, availability: projectAvailability(availability, date) });
  },
};
