import type { CustomerLiveVisit, ForemanCover } from "@bookbuddy/api-contract";
import { projectStatusCard, STATUS_CARD_MAX_AGE_MS, statusCardText, type StatusCardCopy, type StatusCardFacts, type StatusCardModel, type StatusCardText } from "@bookbuddy/domain";
import type { Translator } from "@bookbuddy/i18n";
import type { AttendanceStatus } from "../../repository/attendance";

export type StatusCardTarget = {
  kind: StatusCardFacts["kind"];
  id: string;
  path: string;
};
export type StatusCardSource = {
  target: StatusCardTarget;
  facts: StatusCardFacts | null;
  zone: string;
  terminal: boolean;
};

export function visitCardSource(visit: CustomerLiveVisit): StatusCardSource {
  const { live } = visit;
  const expiredArrival = !live.status && visit.moments.some(moment =>
    (moment.kind === "on_the_way" || moment.kind === "arrival_revised") && moment.recordedAt === live.source?.at);
  return {
    target: { kind: "customer_visit", id: visit.visitId, path: `/c/jobs/${encodeURIComponent(visit.job.id)}?view=today` },
    facts: {
      kind: "customer_visit", stage: live.status ?? (expiredArrival || live.step === "on_the_way" ? "no_arrival_update" : "update"),
      arrivalBand: live.arrival?.band ?? null,
      // Never serialize the published individual roster or the name on an update stamp.
      publishedCrewName: visit.confirmedCrewNames.length ? visit.providerName : null,
    },
    zone: visit.siteZone,
    terminal: live.status === "finished" || live.step === "finished",
  };
}

type ShiftInput = {
  id: string; shiftId: string; state: string; siteZone: string;
  attendance: { arrival: { actualAt: number } | null; departure: unknown };
  holds: readonly { state: string }[];
};

export function shiftCardSource(shift: ShiftInput, attendance: AttendanceStatus): StatusCardSource {
  const arrival = attendance.arrival?.status === "recorded" ? attendance.arrival.actualAt : shift.attendance.arrival?.actualAt ?? null;
  // A pending departure stops the display without telling the OS or the worker that attendance was confirmed.
  const departing = !!shift.attendance.departure || (attendance.departure !== null && (attendance.departure.status === "recorded" || attendance.departure.status === "saved_on_device" || attendance.departure.status === "checking" || attendance.departure.status === "sent"));
  return {
    target: { kind: "worker_shift", id: shift.id, path: `/w/shifts/${encodeURIComponent(shift.shiftId)}?assignmentId=${encodeURIComponent(shift.id)}` },
    facts: { kind: "worker_shift", checkedInAt: arrival, checkedOut: departing, safetyHold: shift.holds.some(hold => hold.state === "active") },
    zone: shift.siteZone,
    terminal: departing || shift.state !== "confirmed" || arrival === null,
  };
}

export function coverCardSource(cover: ForemanCover): StatusCardSource {
  const { status } = cover;
  const stage = status.state === "accepted_pending_confirmation" ? "accepted" : status.state;
  const source = {
    target: { kind: "foreman_cover" as const, id: cover.gapId, path: `/f/cover/${encodeURIComponent(cover.gapId)}` },
    zone: cover.shift.siteZone,
  };
  if (stage === "gap" || stage === "new_visit_proposed") return { ...source, facts: null, terminal: true };
  let offersOut = 0;
  let noCover = 0;
  for (const candidate of cover.candidates) {
    switch (candidate.response?.state) {
      case "offered": case "on_hold": offersOut++; break;
      case "declined": case "withdrawn": case "not_confirmed": case "expired": noCover++; break;
    }
  }
  return {
    ...source,
    facts: { kind: "foreman_cover", stage, counts: { offersOut, accepted: stage === "accepted" ? 1 : 0, confirmed: stage === "confirmed" ? 1 : 0, noCover },
      deadline: status.state === "offers_out" ? status.replyBy : status.state === "accepted_pending_confirmation" ? status.hold.confirmBy : null },
    terminal: stage === "confirmed" || stage === "no_cover",
  };
}

type T = Translator<"mobile">["t"];
export type CardCopy = { t: T; locale: string };
type Surface = StatusCardText & {
  symbol: string;
  accent: "quiet" | "lime" | "amber";
  progress: number | null;
  steps: number | null;
  timerFrom: number | null;
  timerUntil: number | null;
};
export type NativeCard = {
  url: string;
  expiresAt: number;
  staleAt: number;
  openLabel: string;
  preview: Surface;
  details: Surface | null;
  stalePreview: Surface | null;
  staleDetails: Surface | null;
};

const visitVisuals = {
  confirmed: { symbol: "checkmark.circle.fill", step: 1 },
  on_the_way: { symbol: "truck.box.fill", step: 2 },
  on_site: { symbol: "mappin.circle.fill", step: 3 },
  working: { symbol: "hammer.fill", step: 4 },
  finished: { symbol: "checkmark.circle.fill", step: 5 },
  cover_arranging: { symbol: "person.2.fill", step: 0 },
  no_crew_available: { symbol: "circle", step: 0 },
  paused: { symbol: "pause.circle", step: 0 },
  no_arrival_update: { symbol: "clock", step: 0 },
  update: { symbol: "circle", step: 0 },
} as const;

function surface(model: StatusCardModel, words: StatusCardCopy): Surface {
  const text = statusCardText(model, words);
  const quiet = { ...text, symbol: "circle.hexagongrid.fill", accent: "quiet" as const, progress: null, steps: null, timerFrom: null, timerUntil: null };
  if (model.kind === "customer_visit") {
    const { symbol, step } = visitVisuals[model.stage];
    if (model.preview === "generic") return { ...quiet, symbol };
    return { ...quiet, symbol, accent: step ? "lime" : "quiet", progress: step, steps: 5, timerUntil: model.arrivalBand?.startsAt ?? null };
  }
  if (model.preview === "generic") return quiet;
  if (model.kind === "worker_shift") {
    return { ...quiet, symbol: model.safetyHold ? "hand.raised.fill" : "mappin.circle.fill", accent: model.safetyHold ? "amber" : "lime", timerFrom: model.safetyHold ? null : model.checkedInAt };
  }
  return { ...quiet, symbol: "person.2.fill", accent: model.deadline ? "lime" : "quiet", progress: model.stage === "offers_out" ? 2 : model.stage === "confirmed" ? 4 : 3, steps: 4, timerUntil: model.deadline };
}

export function cardExpiry(source: StatusCardSource, now: number, sessionEndsAt: number) {
  const checkIn = source.facts?.kind === "worker_shift" ? source.facts.checkedInAt : null;
  return Math.min(sessionEndsAt, (checkIn ?? now) + STATUS_CARD_MAX_AGE_MS, now + STATUS_CARD_MAX_AGE_MS);
}

export function nativeCard(source: StatusCardSource, copy: CardCopy, hideDetails: boolean, now: number, expiresAt: number): NativeCard | null {
  const { facts } = source;
  if (!facts || source.terminal) return null;
  const generic = projectStatusCard(facts, now);
  if (!generic) return null;
  const { t, locale } = copy;
  let clock: Intl.DateTimeFormat | undefined;
  function time(at: number) {
    try {
      clock ??= new Intl.DateTimeFormat(locale, { timeZone: source.zone, hour: "numeric", minute: "2-digit" });
      return clock.format(at);
    } catch { return ""; } // Never substitute the device zone for an invalid site clock.
  }
  const words: StatusCardCopy = {
    appTitle: t("mobile.statusCards.app"), visitTitle: t("mobile.statusCards.visit"), shiftTitle: t("mobile.statusCards.shift"), open: t("mobile.statusCards.open"),
    visitStage: stage => {
      switch (stage) {
        case "confirmed": return t("mobile.liveVisit.confirmed");
        case "on_the_way": return t("mobile.statusCards.onWay");
        case "on_site": return t("mobile.liveVisit.onSite");
        case "working": return t("mobile.liveVisit.working");
        case "finished": return t("mobile.liveVisit.stepFinished");
        case "cover_arranging": return t("mobile.liveVisit.cover");
        case "no_crew_available": return t("mobile.liveVisit.noCrew");
        case "paused": return t("mobile.liveVisit.paused");
        case "no_arrival_update": return t("mobile.statusCards.noArrival");
        case "update": return t("mobile.liveVisit.quiet");
      }
    },
    arrival: (start, end) => { const a = time(start), b = time(end); return a && b ? t("mobile.statusCards.arriving", { start: a, end: b }) : t("mobile.statusCards.open"); },
    sinceCheckIn: at => { const value = time(at); return value ? t("mobile.statusCards.since", { time: value }) : t("mobile.statusCards.open"); },
    onSite: t("mobile.liveShift.onSite"), safetyHold: t("mobile.liveShift.hold"), openBeforeWorking: t("mobile.statusCards.hold"),
    coverStage: stage => {
      switch (stage) {
        case "offers_out": return t("mobile.cover.offersOut");
        case "accepted": return t("mobile.statusCards.accepted");
        case "confirmed": return t("mobile.cover.confirmed");
        case "no_cover": return t("mobile.cover.noCover");
      }
    },
    coverDeadline: (stage, at) => { const value = time(at); return value ? stage === "offers_out" ? t("mobile.cover.replyBy", { time: value }) : t("mobile.cover.confirmBy", { time: value }) : t("mobile.statusCards.open"); },
    coverCounts: ({ offersOut, accepted, confirmed, noCover }) => t("mobile.statusCards.coverCounts", { out: offersOut, accepted, confirmed, closed: noCover }),
  };
  const preview = surface(generic, words);
  const detailed = hideDetails ? null : projectStatusCard(facts, now, "details");
  let details = detailed ? surface(detailed, words) : null;
  let stalePreview: Surface | null = null;
  let staleDetails: Surface | null = null;
  let staleAt = expiresAt;
  if (facts.kind === "customer_visit" && generic.kind === "customer_visit" && generic.stage === "on_the_way" && facts.arrivalBand) {
    staleAt = Math.min(expiresAt, facts.arrivalBand.endsAt);
    stalePreview = surface({ ...generic, stage: "no_arrival_update" }, words);
  } else if (facts.kind === "foreman_cover" && facts.deadline !== null && details) {
    staleAt = Math.min(expiresAt, facts.deadline);
    const title = t("mobile.cover.search"), summary = t("mobile.statusCards.coverResult");
    staleDetails = { ...preview, title, summary, accessibilityLabel: `${title}, ${summary}` };
    if (now >= staleAt) details = staleDetails;
  }
  return { url: `bookbuddy://${source.target.path}`, expiresAt, staleAt, openLabel: words.open, preview, details, stalePreview, staleDetails };
}
