import type { CustomerUpdateKind, JobState } from "./states";

export const JOURNEY_STEPS = ["requested", "quoted", "booked", "visit", "signed_off", "paid"] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];

/** Only authoritative facts; proposals and open issues are not milestones. */
export type JourneyFacts = {
  readonly jobState: JobState;
  readonly quoteIssued: boolean;
  readonly windowConfirmed: boolean;
  readonly visitReached: boolean;
  readonly signedOff: boolean;
  readonly paymentMatched: boolean;
};

export type JourneyProjection = {
  readonly step: JourneyStep;
  readonly cancelled: boolean;
  readonly complete: boolean;
};

export function projectJourney(facts: JourneyFacts): JourneyProjection {
  const cancelled = facts.jobState === "cancelled";
  const step = facts.signedOff ? (facts.paymentMatched ? "paid" : "signed_off")
    : facts.visitReached ? "visit"
    : facts.windowConfirmed ? "booked"
    : facts.quoteIssued ? "quoted"
    : "requested";
  return { step, cancelled, complete: !cancelled && step === "paid" };
}

export const VISIT_STEPS = ["confirmed", "on_the_way", "on_site", "working", "finished"] as const;
export type VisitStep = (typeof VISIT_STEPS)[number];
export type VisitProjection = { readonly step: VisitStep | null; readonly complete: boolean };

/** Only effective customer-visible stamps, in server order, with corrections resolved. */
export function projectVisit(updates: readonly CustomerUpdateKind[]): VisitProjection {
  let step: VisitStep | null = null;
  let crewConfirmed = false;
  for (const update of updates) {
    switch (update) {
      case "crew_confirmed":
      case "crew_updated":
        crewConfirmed = true;
        if (step === null) step = "confirmed";
        break;
      case "cover_arranging":
        crewConfirmed = false;
        if (step === "confirmed" || step === "on_the_way") step = null;
        break;
      case "on_the_way":
      case "arrival_revised":
        if (step === null || step === "confirmed") step = "on_the_way";
        break;
      case "arrival_withdrawn":
        if (step === "on_the_way") step = crewConfirmed ? "confirmed" : null;
        break;
      case "on_site":
        if (step !== "working") step = "on_site";
        break;
      case "working":
        step = "working";
        break;
      case "finished":
        return { step: "finished", complete: true };
      // A pause or photo doesn't advance a milestone.
    }
  }
  return { step, complete: false };
}
