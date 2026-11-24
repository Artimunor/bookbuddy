import { businessScheduleSchema } from "@bookbuddy/api-contract";
import { useState } from "react";
import type { ScreenPreview } from "../../preview/screens/types";
import { ScheduleView, type Window } from "./View";

const hour = 60 * 60_000;
const now = Date.UTC(2026, 10, 23, 7, 20);
const start = Date.UTC(2026, 10, 24, 8);
const makeWindow = (id: string, startsAt: number): Window => ({ id, startsAt, endsAt: startsAt + hour });
const tuesday = makeWindow("window_morning", start);
const afternoon = makeWindow("window_afternoon", start + 6 * hour);
const wednesday = makeWindow("window_next", start + 24 * hour);
const collision = makeWindow("window_conflict", start + 2 * hour);
const crew = [["nadia", "Nadia Benali"], ["diego", "Diego Torres"], ["lucia", "Lucía Ortega"]] as const;
const noop = () => {};
const states = ["proposal", "conflict", "revised-visit", "agreed", "site-only"] as const;

function Example({ state }: { state: typeof states[number] }) {
  const revised = state === "revised-visit";
  const bookedWindow = revised || state === "agreed" ? { ...tuesday, confirmedAt: start - 24 * hour, crewAvailability: revised ? "no_crew_available" : "as_agreed" } : null;
  const data = businessScheduleSchema.parse({
    businessId: "business_ruiz", job: { id: "job_1", reference: "BB-1042", title: "Terrace door repair" }, siteZone: "Europe/Madrid",
    customerZone: state === "site-only" ? null : "Europe/London",
    approvedQuote: { id: "quote_1", number: 1, totalMinor: 24000, currency: "EUR" },
    visit: { id: "visit_1", kind: "work", state: bookedWindow ? "booked" : "planned", revision: 1, bookedWindow, offeredWindows: [], rescheduleRequest: null, cancellation: null, actions: { canCancelFeeFree: false, canRequestReschedule: false } },
    bookedByName: bookedWindow ? "Claire Martin" : null,
    capacity: { state: "ready", days: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-11-${23 + i}`,
      lanes: crew.map(([membershipId, displayName], j) => ({
        membershipId, displayName,
        available: [{ startsAt: Date.UTC(2026, 10, 23 + i, 7), endsAt: Date.UTC(2026, 10, 23 + i, 17) }],
        busy: i !== 1 ? [] : [
          ...(state === "conflict" ? [{ startsAt: collision.startsAt, endsAt: collision.endsAt + hour }] : []),
          ...(j === 1 ? [{ startsAt: afternoon.startsAt, endsAt: afternoon.endsAt }] : []),
        ],
      })),
    })) },
  });
  const [windows, setWindows] = useState(() => revised ? [wednesday] : state === "conflict" ? [collision] : state === "agreed" ? [] : [tuesday, afternoon, wednesday]);
  return <ScheduleView data={data} now={revised ? start - 18 * 60_000 : now} status="ready" windows={windows}
    capacity={window => ({ free: window.id === collision.id ? 0 : window.id === afternoon.id ? 2 : 3, total: 3 })}
    busy={false} checking={false} failed={false} onBack={noop} onRetry={noop} onWeek={noop} onWindows={setWindows} onSend={noop} />;
}

export const previews: ScreenPreview[] = states.map(state => ({ id: "F-06", state, render: () => <Example state={state} /> }));
