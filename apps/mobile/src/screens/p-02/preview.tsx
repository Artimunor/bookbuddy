import { useT } from "../../i18n";
import type { ScreenPreview } from "../../preview/screens/types";
import { Badge, BookingCard, Button, Card, SegmentedControl } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ProviderScreenView } from "../p-01/shared";

type State = "unassigned" | "offered" | "handoff-stuck" | "commercial-review" | "paid-recorded";
function Fixture({ state }: { state: State }) {
  const t = useT(); const unassigned = state === "unassigned"; const review = state === "commercial-review";
  return <ProviderScreenView title={t("mobile.provider.jobs")} actor="Mateo Ruiz" business="Reformas Ruiz" onProfile={() => {}} onNotifications={() => {}}>
    <SegmentedControl label={t("mobile.provider.segment")} value="needs_you" onChange={() => {}} options={[{ value: "needs_you", label: t("mobile.provider.needsYou") }, { value: "active", label: t("mobile.provider.active") }, { value: "past", label: t("mobile.provider.past") }]} />
    <Card><BookingCard title="Pergola post repair" place="BB-1031 · Casa Llum" stage={t("mobile.foremanHome.booked")} next={unassigned ? t("mobile.provider.noForeman") : t("mobile.provider.foreman", { name: "Inés Vidal" })} accessibilityLabel="Pergola post repair · BB-1031 · Casa Llum" onPress={() => {}} />
      {state === "handoff-stuck" && <Badge label={t("mobile.provider.handoffStuck")} tone="critical" />}
      {state === "offered" && <Badge label={t("mobile.provider.offered")} />}
      {(state === "offered" || state === "handoff-stuck") && <><Copy>{t("mobile.provider.offeredTo", { name: "Mateo Ruiz" })}</Copy><Copy>{t("mobile.provider.replyBy", { time: "24 Nov 2026, 09:50 GMT+1" })}</Copy></>}
      {review && <><Badge label={t("mobile.provider.review")} tone="attention" /><Copy>{t("mobile.provider.reviewVersion", { version: 1, person: "Mateo Ruiz", time: "23 Nov 2026, 08:14 GMT+1" })}</Copy></>}
      {state === "paid-recorded" && <><Copy>{t("mobile.provider.bill", { number: "RR-0412", amount: "€240.00" })}</Copy><Copy>{t("mobile.provider.paid", { amount: "€240.00", person: "Mateo Ruiz", time: "25 Nov 2026, 09:05 GMT+1" })}</Copy></>}
      {(unassigned || state === "handoff-stuck") && <><Copy>{t("mobile.provider.selectForeman")}</Copy><Button variant="neutral" label="Mateo Ruiz" onPress={() => {}} /><Copy>{t("mobile.provider.offerEffect")}</Copy><Button label={t("mobile.provider.offer")} onPress={() => {}} /></>}
      {state === "offered" && <Button variant="neutral" label={t("mobile.provider.withdrawOffer")} onPress={() => {}} />}
    </Card>
  </ProviderScreenView>;
}
export const previews: ScreenPreview[] = [
  { id: "P-02", state: "unassigned", render: () => <Fixture state="unassigned" /> },
  { id: "P-02", state: "offered", render: () => <Fixture state="offered" /> },
  { id: "P-02", state: "handoff-stuck", render: () => <Fixture state="handoff-stuck" /> },
  { id: "P-02", state: "commercial-review", render: () => <Fixture state="commercial-review" /> },
  { id: "P-02", state: "paid-recorded", render: () => <Fixture state="paid-recorded" /> },
];
