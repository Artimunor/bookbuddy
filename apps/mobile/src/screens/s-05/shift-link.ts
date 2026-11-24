import type { LinkOpening } from "@bookbuddy/api-contract";
import type { Href } from "expo-router";

type ShiftLink = Extract<LinkOpening, { kind: "shift" }>["shift"];

export function shiftLinkDestination(link: ShiftLink): Href {
  const { id: shiftId, job } = link.shift;
  switch (link.view) {
    case "worker": return { pathname: "/w/shifts/[shiftId]", params: { shiftId, assignmentId: link.assignment.id } };
    case "foreman": return { pathname: "/f/shifts/[shiftId]", params: { shiftId } };
    case "provider_admin": return { pathname: "/p/jobs", params: { jobId: job.id } };
  }
}
