import type { ScreenPreview } from "../../preview/screens/types";
import { VettedPoolView, type PoolExample } from "./Screen";

const example: PoolExample = {
  reference: "BB-1042", task: "Terrace door repair", skill: "Door fitting", language: "Español", area: "Xàbia",
  business: "Reformas Ruiz", customer: "Claire Martin", zone: "Europe/Madrid",
  startsAt: Date.UTC(2026, 10, 24, 8), endsAt: Date.UTC(2026, 10, 24, 9), replyBy: Date.UTC(2026, 10, 24, 7, 50), now: Date.UTC(2026, 10, 24, 7, 42),
  matches: [{ name: "Alba Navarro", initials: "AN", languages: "Español, English" }, { name: "Óscar Ferrer", initials: "OF", languages: "Español" }],
};
const web = globalThis as typeof globalThis & { history?: { back: () => void } };
export const previews: ScreenPreview[] = (["matches", "no-match", "offers-out"] as const).map(state => ({
  id: "F-11", state, render: () => <VettedPoolView example={example} initial={state} onBack={() => web.history?.back()} />,
}));
