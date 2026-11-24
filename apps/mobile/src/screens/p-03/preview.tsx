import { businessMemberSchema } from "@bookbuddy/api-contract";
import { View } from "react-native";
import { useFormat, useT } from "../../i18n";
import type { ScreenPreview } from "../../preview/screens/types";
import { Badge, Button, Card, Dock, SegmentedControl } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ProviderScreenView } from "../p-01/shared";
import { PeopleMembers } from "./Screen";

const business = "Reformas Ruiz";
const members = [
  ["Mateo Ruiz", "provider_admin", "foreman"], ["Inés Vidal", "foreman"], ["Nadia Benali", "worker"],
  ["Diego Torres", "worker"], ["Lucía Ortega", "worker"], ["Pau Soler", "worker"],
].map(([displayName, ...roles], index) => businessMemberSchema.parse({
  id: `member-${index}`, displayName, email: null, isViewer: index === 0, backupForeman: false, eligibility: index === 5 ? "pending" : null,
  roles: roles.map((role, grant) => ({ grantId: `grant-${index}-${grant}`, role, grantedAt: Date.UTC(2026, 10, 16, 8), removal: { status: "allowed" } })),
}));

type State = "active" | "pending" | "revoked";
function Fixture({ state }: { state: State }) {
  const t = useT(); const format = useFormat(); const view = state === "active" ? "active" : state === "pending" ? "invited" : "past";
  return <ProviderScreenView title={t("mobile.provider.people")} actor="Mateo Ruiz" business={business} onProfile={() => {}} onNotifications={() => {}} dock={<Dock context={t("mobile.provider.inviteContext")} primary={{ label: t("mobile.provider.invite"), glyph: "+", onPress: () => {} }} />}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
      <Copy variant="supporting">{t("mobile.provider.peopleContext", { business })}</Copy>
      <Button variant="quiet" label={t("mobile.provider.eligibilityLink")} onPress={() => {}} />
    </View>
    <SegmentedControl label={t("mobile.provider.segment")} value={view} onChange={() => {}} options={[{ value: "active", label: `${t("mobile.provider.active")} · ${members.length}` }, { value: "invited", label: t("mobile.provider.invited") }, { value: "past", label: t("mobile.provider.past") }]} />
    {state === "active" && <PeopleMembers members={members} onSelect={() => {}} />}
    {state === "pending" && <Card dense onPress={() => {}} accessibilityLabel="diego@example.com"><Copy variant="label">diego@example.com</Copy><Copy variant="supporting">{t("mobile.provider.worker")}</Copy><Copy variant="supporting">{t("mobile.provider.expires", { time: format.lines(Date.UTC(2026, 10, 16, 9, 12), "Europe/Madrid")?.site ?? "" })}</Copy></Card>}
    {state === "revoked" && <Card dense><Copy variant="label">Pau Soler</Copy><Copy variant="supporting">{t("mobile.provider.worker")}</Copy><Badge label={t("mobile.provider.revokedStatus")} /><Copy variant="supporting">{t("mobile.provider.revoked", { person: "Mateo Ruiz", time: format.lines(Date.UTC(2026, 10, 24, 15, 20), "Europe/Madrid")?.site ?? "" })}</Copy></Card>}
  </ProviderScreenView>;
}
export const previews: ScreenPreview[] = [
  { id: "P-03", state: "active", render: () => <Fixture state="active" /> },
  { id: "P-03", state: "pending", render: () => <Fixture state="pending" /> },
  { id: "P-03", state: "revoked", render: () => <Fixture state="revoked" /> },
];
