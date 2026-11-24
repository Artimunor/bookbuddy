import { invitationOpeningSchema, type InvitationOpening } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { InvitationView } from "./Screen";

const valid = invitationOpeningSchema.parse({ status: "pending", id: "invitation-diego", grant: { kind: "business_role", businessName: "Reformas Ruiz", role: "worker" }, inviterDisplayName: "Mateo Ruiz", issuedAt: Date.parse("2026-11-14T09:12:00Z"), expiresAt: Date.parse("2026-11-16T09:12:00Z"), siteZone: "Europe/Madrid", setupRequired: false });
const expired = invitationOpeningSchema.parse({ status: "unavailable", reason: "expired", supportReference: null });
const wrongAccount = invitationOpeningSchema.parse({ status: "unavailable", reason: "wrong_account", supportReference: null });
const accepted = invitationOpeningSchema.parse({ status: "accepted", id: "invitation-diego", acceptedAt: Date.parse("2026-11-16T09:00:00Z"), currentAccess: { kind: "business", context: { scope: { contextId: "diego-worker", role: "worker", businessId: "reformas-ruiz" }, businessName: "Reformas Ruiz" }, workEligibility: "pending", supportReference: null } });
const noop = () => {};
function Fixture({ invitation }: { invitation: InvitationOpening }) {
  return <InvitationView invitation={invitation} email="diego@example.com" status="ready" onBack={noop} onRetry={noop} onHelp={noop} onDifferentAccount={noop} onAccept={noop} onDecline={noop} onSetup={noop} />;
}
export const previews: ScreenPreview[] = [
  { id: "S-05", state: "valid", render: () => <Fixture invitation={valid} /> },
  { id: "S-05", state: "expired", render: () => <Fixture invitation={expired} /> },
  { id: "S-05", state: "wrong-account", render: () => <Fixture invitation={wrongAccount} /> },
  { id: "S-05", state: "accepted", render: () => <Fixture invitation={accepted} /> },
];
