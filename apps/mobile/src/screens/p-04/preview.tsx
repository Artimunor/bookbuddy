import { useT } from "../../i18n";
import type { ScreenPreview } from "../../preview/screens/types";
import { Badge, Card, Dock, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";

type State = "approved" | "expiring" | "suspended";
function Fixture({ state }: { state: State }) {
  const t = useT();
  return <Screen title={t("mobile.provider.eligibility")} navigation={{ kind: "back", label: t("mobile.provider.back"), onPress: () => {} }} dock={<Dock primary={{ label: t("mobile.provider.contact"), onPress: () => {} }} />}>
    <Copy variant="sectionTitle">{t("mobile.provider.business")}</Copy><Card><Copy variant="sectionTitle">Reformas Ruiz</Copy><Badge label={state === "suspended" ? t("mobile.provider.suspended") : t("mobile.provider.approved")} tone={state === "suspended" ? "critical" : "neutral"} /><Copy>Madrid</Copy><Copy>{t("mobile.provider.ownCrew")}</Copy></Card>
    <Copy variant="sectionTitle">{t("mobile.provider.crewEligibility")}</Copy><Card><Copy variant="sectionTitle">Diego Torres</Copy><Badge label={state === "expiring" ? t("mobile.provider.expiring") : t("mobile.provider.approved")} tone={state === "expiring" ? "attention" : "neutral"} /><Copy>{t("mobile.provider.expires", { time: "31 Dec 2026, 23:59 GMT+1" })}</Copy></Card><Copy>{t("mobile.provider.eligibilityNote")}</Copy>
  </Screen>;
}
export const previews: ScreenPreview[] = [
  { id: "P-04", state: "approved", render: () => <Fixture state="approved" /> },
  { id: "P-04", state: "expiring", render: () => <Fixture state="expiring" /> },
  { id: "P-04", state: "suspended", render: () => <Fixture state="suspended" /> },
];
