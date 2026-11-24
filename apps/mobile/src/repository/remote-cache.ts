import { getCrewAvailabilityRoute, getHomeRoute, getJobsRoute, listShiftsRoute, notificationsRoute } from "@bookbuddy/api-contract";
import type { RouteDefinition, RouteResponse } from "@bookbuddy/api-contract";

const routes = {
  home: getHomeRoute, jobs_list: getJobsRoute, shift_agenda: listShiftsRoute,
  crew_availability: getCrewAvailabilityRoute, notification: notificationsRoute,
};
export type RemoteCacheKind = keyof typeof routes;

type Scalar = string | number | boolean | null;
type Field = true | { readonly [key: string]: Field };
type SelectFields<T, Rule> = T extends Scalar ? T : T extends readonly (infer Item)[] ? SelectFields<Item, Rule>[] : {
  [K in keyof T as K extends keyof Rule ? K : never]: K extends keyof Rule ? SelectFields<T[K], Rule[K]> : never;
};

const span = { startsAt: true, endsAt: true } as const;
const heading = { jobId: true, reference: true, title: true, siteZone: true } as const;
const window = { visitId: true, window: span } as const;
const journey = { step: true, cancelled: true, complete: true } as const;
const action = { kind: true, at: true } as const;
const visit = { ...window, step: true, status: true, arrival: span, nextUpdateAt: true, source: { at: true } } as const;
const liveJob = { ...heading, journey, visit, providerName: true } as const;
const assignment = { assignmentId: true, shiftId: true, state: true, briefingLanguage: true, window: span, nextStep: true, safetyHold: true } as const;
const job = {
  ...heading, journey, state: true, place: { placeId: true }, nextVisit: window, finalAt: true, providerName: true, live: true,
  nextStep: action, assignment, handoff: { handoffId: true, state: true, policy: true, offeredAt: true, expiresAt: true, endedAt: true },
} as const;
const offer = { offerId: true, kind: true, gapId: true, town: true, skill: true, briefingLanguage: true, siteZone: true, window: span,
  replyBy: true, awaitingConfirmationUntil: true } as const;
const policies = {
  home: {
    audience: true, unreadCount: true, place: { placeId: true, siteZone: true }, businessName: true, siteZone: true,
    liveVisits: liveJob, upcoming: job, laterVisits: job, assignment: job, offers: offer, openToCoverUntil: true,
    decisions: { ...heading, journey, kind: true, sent: { at: true }, dueAt: true },
    recent: { jobId: true, kind: true, at: true },
    gaps: { ...heading, gapId: true, skill: true, reportedAt: true, visitStartsAt: true, customerNotified: true },
    needsYou: { ...heading, action }, needsYouCount: true,
    overview: {
      business: { id: true, publicName: true, state: true, areaName: true, siteZone: true },
      liveJob: { ...heading, step: true, since: true, crewSize: true }, nextVisit: { ...heading, ...span },
      handoffs: { offeredCount: true, nextReplyAt: true, stuck: { ...heading, since: true } },
      unassignedCount: true, commercialReviewCount: true, eligibility: { status: true, pendingReviewCount: true },
    },
  },
  jobs_list: {
    audience: true, segment: true, siteZone: true, businessName: true, unreadCount: true, activeCount: true, pastCount: true,
    incomingCount: true, needsYouCount: true, page: { cursor: true, hasMore: true }, items: job, live: liveJob,
    list: { segment: true, items: { ...job, town: true } },
  },
  shift_agenda: {
    segment: true, cursor: true, hasMore: true, total: true,
    rows: {
      kind: true, id: true, source: true, gapId: true, ...span, siteZone: true, areaName: true, replyBy: true, state: true,
      endedAt: true, outcome: true, nextAction: true,
      shift: { id: true, visitId: true, job: { id: true, reference: true, title: true }, ...span, siteZone: true, skill: true,
        briefingLanguage: true, state: true },
      assignment: { id: true, source: true, state: true, confirmedAt: true },
    },
  },
  crew_availability: {
    membershipId: true, businessId: true, siteZone: true,
    days: { date: true, revision: true, preference: { kind: true, hours: span, openToCover: true, savedAt: true, source: true },
      confirmedShifts: { shiftId: true, assignmentId: true, ...span, siteZone: true, conflictsWithPreference: true } },
  },
  notification: { items: { id: true, kind: true, createdAt: true, readAt: true }, page: { cursor: true, hasMore: true } },
} as const satisfies Record<RemoteCacheKind, Field>;

export type CachedRead<Kind extends RemoteCacheKind> = SelectFields<RouteResponse<(typeof routes)[Kind]["output"]>, (typeof policies)[Kind]>;

function selectFields(value: unknown, rule: Field): unknown {
  if (value === null) return null;
  if (rule === true) return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
  if (Array.isArray(value)) return value.map((item) => selectFields(item, rule));
  if (typeof value !== "object") return undefined;
  const projected: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(rule)) {
    if (!Object.hasOwn(value, key)) continue;
    const kept = selectFields((value as Record<string, unknown>)[key], child);
    if (kept !== undefined) projected[key] = kept;
  }
  return projected;
}

export function cacheRemoteResponse(kind: RemoteCacheKind, value: unknown): CachedRead<RemoteCacheKind> | null {
  const parsed = routes[kind].output.safeParse(value);
  return parsed.success ? selectFields(parsed.data, policies[kind]) as CachedRead<RemoteCacheKind> : null;
}

export function remoteReadKey(kind: RemoteCacheKind, route: RouteDefinition, input: unknown): string | null {
  // Only the nominated route can write this kind. Persist a key drawn solely from validated opaque IDs, enums and cursors.
  if (route !== routes[kind]) return null;
  switch (kind) {
    case "home": {
      const result = getHomeRoute.input.safeParse(input);
      return result.success ? JSON.stringify([result.data.query.placeId]) : null;
    }
    case "jobs_list": {
      const result = getJobsRoute.input.safeParse(input);
      return result.success ? JSON.stringify([result.data.query.segment, result.data.query.placeId, result.data.query.cursor]) : null;
    }
    case "shift_agenda": {
      const result = listShiftsRoute.input.safeParse(input);
      return result.success ? JSON.stringify([result.data.query?.segment, result.data.query?.cursor]) : null;
    }
    case "crew_availability": {
      const result = getCrewAvailabilityRoute.input.safeParse(input);
      return result.success ? JSON.stringify([result.data.params.member, result.data.query?.weekOf]) : null;
    }
    case "notification": {
      const result = notificationsRoute.input.safeParse(input);
      return result.success ? JSON.stringify([result.data.query.contextId, result.data.query.cursor]) : null;
    }
  }
}

export function decodeRemoteSnapshot<Kind extends RemoteCacheKind>(kind: Kind, value: unknown): CachedRead<Kind> {
  return selectFields(value, policies[kind]) as CachedRead<Kind>;
}
