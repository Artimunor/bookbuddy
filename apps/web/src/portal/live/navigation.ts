import type { HomeProjection, JobDetail } from "@bookbuddy/api-contract";

type CustomerHome = Extract<HomeProjection, { audience: "customer" }>;
type WholeJob = Extract<Extract<JobDetail, { audience: "customer" }>["job"], { view: "whole" }>;
type Upcoming = CustomerHome["upcoming"][number];
type Window = NonNullable<Upcoming["nextVisit"]>["window"];

export function liveVisitPath(jobId: string, visitId: string) {
  return `/portal/jobs/${encodeURIComponent(jobId)}/live?visit=${encodeURIComponent(visitId)}`;
}

export function jobHomeVisitLinks({ jobId, journey, visit, todayVisitId, nextStep }: Pick<WholeJob, "jobId" | "journey" | "visit" | "todayVisitId" | "nextStep">) {
  const visitId = visit?.visitId ?? todayVisitId;
  return {
    live: !journey.cancelled && visitId ? liveVisitPath(jobId, visitId) : null,
    windows: !journey.cancelled && (nextStep?.kind === "pick_window" || nextStep?.kind === "review_revised_visit")
      ? `/portal/jobs/${encodeURIComponent(jobId)}/windows` : null,
  };
}

const dayFormatters = new Map<string, Intl.DateTimeFormat | null>();

export function visitOnSiteDay({ startsAt, endsAt }: Window, siteZone: string, now: number): boolean {
  if (startsAt <= now && now < endsAt) return true;
  let formatter = dayFormatters.get(siteZone);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat("en", { timeZone: siteZone, year: "numeric", month: "numeric", day: "numeric" });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      formatter = null;
    }
    dayFormatters.set(siteZone, formatter);
  }
  if (!formatter) return false;
  const currentDay = formatter.format(now);
  return formatter.format(startsAt) === currentDay || formatter.format(endsAt - 1) === currentDay;
}

export function splitUpcomingVisits({ liveVisits, upcoming }: Pick<CustomerHome, "liveVisits" | "upcoming">, now: number) {
  const today: Upcoming[] = [];
  const later: Upcoming[] = [];
  for (const item of upcoming) {
    if (!item.journey.cancelled && visitOnSiteDay(item.nextVisit.window, item.siteZone, now)) {
      if (!liveVisits.some((live) => live.jobId === item.jobId)) today.push(item);
    } else {
      later.push(item);
    }
  }
  return { today, later };
}
