import { useT } from "../../i18n";
import type { ScreenPreview } from "../../preview/screens/types";
import { Badge, Button, Card, Dock, SegmentedControl } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ProviderScreenView } from "../p-01/shared";

type State = "active" | "pending" | "revoked";
function Fixture({ state }: { state: State }) {
  const t = useT(); const view = state === "active" ? "active" : state === "pending" ? "invited" : "past";
  return <ProviderScreenView title={t("mobile.provider.people")} actor="Mateo Ruiz" business="Reformas Ruiz" onProfile={() => {}} onNotifications={() => {}} dock={<Dock context={t("mobile.provider.inviteContext")} primary={{ label: t("mobile.provider.invite"), onPress: () => {} }} />}>
    <Button variant="quiet" label={t("mobile.provider.eligibility")} onPress={() => {}} />
    <SegmentedControl label={t("mobile.provider.segment")} value={view} onChange={() => {}} options={[{ value: "active", label: t("mobile.provider.active") }, { value: "invited", label: t("mobile.provider.invited") }, { value: "past", label: t("mobile.provider.past") }]} />
    {state === "active" && <><Card onPress={() => {}} accessibilityLabel={`Mateo Ruiz · ${t("mobile.provider.you")}`}><Copy variant="sectionTitle">Mateo Ruiz</Copy><Badge label={t("mobile.provider.you")} /><Copy>{t("mobile.provider.admin")} · {t("mobile.provider.foremanRole")}</Copy></Card><Card onPress={() => {}} accessibilityLabel="Pau Soler"><Copy variant="sectionTitle">Pau Soler</Copy><Copy>{t("mobile.provider.worker")}</Copy><Badge label={t("mobile.provider.pending")} /></Card></>}
    {state === "pending" && <Card onPress={() => {}} accessibilityLabel="diego@example.com"><Copy variant="sectionTitle">diego@example.com</Copy><Copy>{t("mobile.provider.worker")}</Copy><Copy>{t("mobile.provider.expires", { time: "16 Nov 2026, 10:12 GMT+1" })}</Copy></Card>}
    {state === "revoked" && <Card><Copy variant="sectionTitle">Pau Soler</Copy><Copy>{t("mobile.provider.worker")}</Copy><Badge label={t("mobile.provider.past")} /><Copy>{t("mobile.provider.revoked", { person: "Mateo Ruiz", time: "24 Nov 2026, 16:20 GMT+1" })}</Copy></Card>}
  </ProviderScreenView>;
}
export const previews: ScreenPreview[] = [
  { id: "P-03", state: "active", render: () => <Fixture state="active" /> },
  { id: "P-03", state: "pending", render: () => <Fixture state="pending" /> },
  { id: "P-03", state: "revoked", render: () => <Fixture state="revoked" /> },
];
