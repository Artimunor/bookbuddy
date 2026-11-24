import { businessIdSchema, contextIdSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import type { RoleChoice } from "./account";
import { YouView } from "./Screen";

const businessId = businessIdSchema.parse("reformas-ruiz");
export const providerChoices: RoleChoice[] = [
  { contextId: contextIdSchema.parse("foreman"), businessId, role: "foreman", businessName: "Reformas Ruiz · Xàbia" },
  { contextId: contextIdSchema.parse("admin"), businessId, role: "provider_admin", businessName: "Reformas Ruiz · Xàbia" },
];
const customer: RoleChoice = { contextId: contextIdSchema.parse("customer"), role: "customer", businessId: null };
const noop = () => {};

export function YouFixture({ state = "multi-role" }: { state?: "single-role" | "multi-role" | "pending-work" }) {
  const multi = state === "multi-role";
  return <YouView
    account={multi ? { displayName: "Mateo Ruiz", email: "mateo@example.com" } : { displayName: "Claire Martin", email: "claire@example.com" }}
    active={multi ? providerChoices[0] : customer} contexts={multi ? providerChoices : [customer]} readingLocale={multi ? "es" : "en"}
    place={multi ? undefined : "Villa Mar · Xàbia"} namedApprover={!multi} pending={state === "pending-work" ? { drafts: 1, waiting: 2, checking: 1, media: 1 } : undefined}
    canEdit onBack={noop} onEdit={noop} onSwitch={noop} onPlaces={noop} onDisplay={noop} onPrivacy={noop} onHelp={noop} onSignOut={noop} />;
}

export const previews: ScreenPreview[] = [
  { id: "S-06", state: "single-role", render: () => <YouFixture state="single-role" /> },
  { id: "S-06", state: "multi-role", render: () => <YouFixture /> },
  { id: "S-06", state: "pending-work", render: () => <YouFixture state="pending-work" /> },
];
