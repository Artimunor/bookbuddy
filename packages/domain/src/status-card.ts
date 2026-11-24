import { HOUR_MS } from "./units";
import type { VisitStep } from "./journey";

export const STATUS_CARD_MAX_AGE_MS = 8 * HOUR_MS;

export type StatusCardPreview = "generic" | "details";
export type VisitCardStage = VisitStep | "cover_arranging" | "no_crew_available" | "paused" | "no_arrival_update" | "update";
export type CoverCardStage = "offers_out" | "accepted" | "confirmed" | "no_cover";
export type SessionCardStage = "starts_in" | "doors_open" | "in_session" | "last_confirmed";
type SessionHostUpdate = { readonly name: string; readonly confirmedBy: string; readonly confirmedAt: number };
type SessionCardFields = {
  readonly providerName: string;
  readonly reference: string;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly confirmedAt: number;
  readonly hostUpdate: SessionHostUpdate | null;
};
type Band = { readonly startsAt: number; readonly endsAt: number };
type CoverCounts = { readonly offersOut: number; readonly accepted: number; readonly confirmed: number; readonly noCover: number };

/** Allowlisted facts from authorised records. Session host names must be customer-published facts. */
export type StatusCardFacts =
  | { readonly kind: "customer_visit"; readonly stage: VisitCardStage; readonly arrivalBand: Band | null; readonly publishedCrewName: string | null }
  | { readonly kind: "worker_shift"; readonly checkedInAt: number | null; readonly checkedOut: boolean; readonly safetyHold: boolean }
  | { readonly kind: "foreman_cover"; readonly stage: CoverCardStage; readonly counts: CoverCounts; readonly deadline: number | null }
  | ({ readonly kind: "session"; readonly stage: SessionCardStage | "ended" } & SessionCardFields);

/** The generic variants cannot carry any of their detailed counterparts' fields. */
export type StatusCardModel =
  | { readonly kind: "customer_visit"; readonly preview: "generic"; readonly stage: VisitCardStage }
  | { readonly kind: "worker_shift" | "foreman_cover" | "session"; readonly preview: "generic" }
  | { readonly kind: "customer_visit"; readonly preview: "details"; readonly stage: VisitCardStage; readonly arrivalBand: Band | null; readonly crewName: string | null }
  | { readonly kind: "worker_shift"; readonly preview: "details"; readonly checkedInAt: number; readonly safetyHold: boolean }
  | { readonly kind: "foreman_cover"; readonly preview: "details"; readonly stage: CoverCardStage; readonly counts: CoverCounts; readonly deadline: number | null }
  | ({ readonly kind: "session"; readonly preview: "details"; readonly stage: SessionCardStage } & SessionCardFields);

const visitStages: Record<VisitCardStage, true> = {
  confirmed: true, on_the_way: true, on_site: true, working: true, finished: true,
  cover_arranging: true, no_crew_available: true, paused: true, no_arrival_update: true, update: true,
};
const coverStages: Record<CoverCardStage, true> = { offers_out: true, accepted: true, confirmed: true, no_cover: true };
const sessionStages: Record<SessionCardStage, true> = { starts_in: true, doors_open: true, in_session: true, last_confirmed: true };
const shortLabel = (value: string) => typeof value === "string" ? value.trim().slice(0, 80) : "";
const isTime = (value: number | null): value is number => value !== null && Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15;
const count = (value: number) => Number.isSafeInteger(value) && value >= 0 ? value : 0;

export function projectStatusCard(facts: StatusCardFacts, now: number, preview: StatusCardPreview = "generic"): StatusCardModel | null {
  switch (facts.kind) {
    case "customer_visit": {
      let stage: VisitCardStage = Object.hasOwn(visitStages, facts.stage) ? facts.stage : "update";
      const band = facts.arrivalBand;
      let arrivalBand: Band | null = null;
      if (stage === "on_the_way") {
        if (!band || !isTime(band.startsAt) || !isTime(band.endsAt) || band.startsAt >= band.endsAt || now >= band.endsAt) {
          stage = "no_arrival_update";
        } else if (preview === "details") {
          arrivalBand = { startsAt: band.startsAt, endsAt: band.endsAt };
        }
      }
      if (preview !== "details") return { kind: "customer_visit", preview: "generic", stage };
      // Constrain the explicitly published crew-level label to the size of a native activity payload.
      const crewName = typeof facts.publishedCrewName === "string" ? facts.publishedCrewName.trim().slice(0, 80) || null : null;
      return { kind: "customer_visit", preview, stage, arrivalBand, crewName };
    }
    case "worker_shift": {
      const checkedInAt = facts.checkedInAt;
      if (!isTime(checkedInAt) || checkedInAt > now || facts.checkedOut || now >= checkedInAt + STATUS_CARD_MAX_AGE_MS) return null;
      if (preview !== "details") return { kind: "worker_shift", preview: "generic" };
      return { kind: "worker_shift", preview, checkedInAt, safetyHold: facts.safetyHold === true };
    }
    case "foreman_cover": {
      if (!Object.hasOwn(coverStages, facts.stage)) return null;
      if (preview !== "details") return { kind: "foreman_cover", preview: "generic" };
      const { offersOut, accepted, confirmed, noCover } = facts.counts;
      const deadline = (facts.stage === "offers_out" || facts.stage === "accepted") && isTime(facts.deadline) ? facts.deadline : null;
      return {
        kind: "foreman_cover", preview, stage: facts.stage, deadline,
        counts: { offersOut: count(offersOut), accepted: count(accepted), confirmed: count(confirmed), noCover: count(noCover) },
      };
    }
    case "session": {
      const { startsAt, endsAt, confirmedAt, hostUpdate } = facts;
      if (facts.stage === "ended" || !Object.hasOwn(sessionStages, facts.stage) || !isTime(startsAt) ||
          !isTime(endsAt) || startsAt >= endsAt || now >= endsAt || !isTime(confirmedAt) || confirmedAt > now) return null;
      if (preview !== "details") return { kind: "session", preview: "generic" };
      const stage = now >= startsAt && facts.stage !== "in_session" ? "last_confirmed" : facts.stage;
      return { kind: "session", preview, stage, startsAt, endsAt, confirmedAt,
        providerName: shortLabel(facts.providerName), reference: shortLabel(facts.reference),
        hostUpdate: hostUpdate && isTime(hostUpdate.confirmedAt) && hostUpdate.confirmedAt <= now ? {
          name: shortLabel(hostUpdate.name), confirmedBy: shortLabel(hostUpdate.confirmedBy), confirmedAt: hostUpdate.confirmedAt,
        } : null };
    }
  }
}

export type StatusCardCopy = {
  visitTitle: string; shiftTitle: string; appTitle: string; open: string;
  visitStage: (stage: VisitCardStage) => string;
  arrival: (startsAt: number, endsAt: number) => string;
  sinceCheckIn: (at: number) => string;
  onSite: string; safetyHold: string; openBeforeWorking: string;
  coverStage: (stage: CoverCardStage) => string;
  coverDeadline: (stage: "offers_out" | "accepted", at: number) => string;
  coverCounts: (counts: CoverCounts) => string;
  sessionTitle: string;
  sessionStage: (stage: SessionCardStage, at: number) => string;
  sessionDetails: (providerName: string, reference: string, startsAt: number, endsAt: number) => string;
  sessionHostUpdate: (update: SessionHostUpdate) => string;
};

export type StatusCardText = Readonly<{ title: string; summary: string; expanded: string | null; accessibilityLabel: string }>;

/** Native accessibility follows exactly the visible copy, not the source record. */
export function statusCardText(model: StatusCardModel, copy: StatusCardCopy): StatusCardText {
  let title: string;
  let summary: string;
  let expanded: string | null = null;
  if (model.kind === "customer_visit") {
    title = model.preview === "details" ? copy.visitStage(model.stage) : copy.visitTitle;
    summary = model.preview === "details" && model.arrivalBand
      ? copy.arrival(model.arrivalBand.startsAt, model.arrivalBand.endsAt)
      : model.preview === "generic" ? copy.visitStage(model.stage) : copy.open;
    if (model.preview === "details") expanded = model.crewName;
  } else if (model.preview === "generic") {
    title = model.kind === "worker_shift" ? copy.shiftTitle : model.kind === "session" ? copy.sessionTitle : copy.appTitle;
    summary = copy.open;
  } else if (model.kind === "worker_shift") {
    title = model.safetyHold ? copy.safetyHold : copy.onSite;
    summary = copy.sinceCheckIn(model.checkedInAt);
    if (model.safetyHold) expanded = copy.openBeforeWorking;
  } else if (model.kind === "session") {
    title = copy.sessionStage(model.stage, model.confirmedAt);
    summary = copy.sessionDetails(model.providerName, model.reference, model.startsAt, model.endsAt);
    if (model.hostUpdate) expanded = copy.sessionHostUpdate(model.hostUpdate);
  } else {
    title = copy.coverStage(model.stage);
    summary = model.deadline !== null && (model.stage === "offers_out" || model.stage === "accepted") ? copy.coverDeadline(model.stage, model.deadline) : copy.open;
    expanded = copy.coverCounts(model.counts);
  }
  return { title, summary, expanded, accessibilityLabel: expanded ? `${title}, ${summary}, ${expanded}` : `${title}, ${summary}` };
}
