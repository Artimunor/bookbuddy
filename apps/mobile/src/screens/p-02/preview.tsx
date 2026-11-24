import { staffQuoteVersionSchema } from "@bookbuddy/api-contract";
import { useFormat, useT } from "../../i18n";
import type { ScreenPreview } from "../../preview/screens/types";
import { Badge, BookingCard, Button, Card, Dock, ListRow, Screen, SegmentedControl, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ProviderScreenView } from "../p-01/shared";
import { Journey } from "../c-01/common";
import { ChoiceRadio } from "../s-12/ChoiceRadio";
import { quote } from "../f-04/preview";
import { ReviewVersion } from "./Review";

type State = "unassigned" | "offered" | "handoff-stuck" | "commercial-review" | "paid-recorded";
function Fixture({ state }: { state: State }) {
  const t = useT(); const format = useFormat(); const unassigned = state === "unassigned"; const review = state === "commercial-review";
  const active = unassigned || state === "offered";
  const recipient = "Mateo Ruiz";
  const handoff = unassigned || state === "handoff-stuck";
  const reply = format.lines(Date.UTC(2026, 10, 24, 8, 50), "Europe/Madrid")?.site ?? "";
  const siteDay = format.siteTime(Date.UTC(2026, 10, 23, 16, 50), "Europe/Madrid");
  return <ProviderScreenView title={t("mobile.provider.jobs")} subtitle={siteDay.kind === "available" ? `${siteDay.site.date} · ${format.zoneLabel("Europe/Madrid", siteDay.site)}` : undefined} actor={recipient} business="Reformas Ruiz" onProfile={() => {}} onNotifications={() => {}}
    dock={handoff || state === "offered" ? <Dock context={t("mobile.provider.offerEffect")}
      primary={{ label: handoff ? t("mobile.provider.offerTo", { name: recipient }) : t("mobile.provider.withdrawOffer"), onPress: () => {} }} /> : undefined}>
    <SegmentedControl label={t("mobile.provider.segment")} value={active ? "active" : "needs_you"} onChange={() => {}} options={[{ value: "needs_you", label: t("mobile.provider.needsYou") }, { value: "active", label: t("mobile.provider.active") }, { value: "past", label: t("mobile.provider.past") }]} />
    <Card dense><BookingCard title="Pergola post repair" place="BB-1031 · Casa Llum" stage={t("mobile.foremanHome.booked")} next={unassigned ? t("mobile.provider.noForeman") : t("mobile.provider.foreman", { name: "Inés Vidal" })} accessibilityLabel="Pergola post repair · BB-1031 · Casa Llum"
      progress={<Journey journey={{ step: state === "paid-recorded" ? "paid" : "booked", complete: state === "paid-recorded", cancelled: false }} />} onPress={() => {}} />
      {state === "handoff-stuck" && <Badge label={t("mobile.provider.handoffStuck")} tone="critical" />}
      {state === "offered" && <Badge label={t("mobile.provider.offered")} />}
      {(state === "offered" || state === "handoff-stuck") && <><Copy>{t("mobile.provider.offeredTo", { name: recipient })}</Copy><Copy>{t("mobile.provider.replyBy", { time: reply })}</Copy></>}
      {review && <ListRow label={t("mobile.provider.review")} description={t("mobile.provider.reviewVersion", { version: 1, person: recipient, time: format.lines(Date.UTC(2026, 10, 23, 7, 14), "Europe/Madrid")?.site ?? "" })} onPress={() => {}} />}
      {state === "paid-recorded" && <><Copy>{t("mobile.provider.bill", { number: "RR-0412", amount: format.money(24000, "EUR") })}</Copy><Copy>{t("mobile.provider.paid", { amount: format.money(24000, "EUR"), person: recipient, time: format.lines(Date.UTC(2026, 10, 25, 8, 5), "Europe/Madrid")?.site ?? "" })}</Copy></>}
      {handoff && <>
        <Copy variant="label">{t("mobile.provider.selectForeman")}</Copy>
        <ChoiceRadio selected label={recipient} description={t("mobile.provider.foremanRole")} onPress={() => {}} />
        {unassigned && <Copy variant="supporting">{t("mobile.provider.replyBy", { time: reply })}</Copy>}
      </>}
    </Card>
  </ProviderScreenView>;
}
const pendingQuote = staffQuoteVersionSchema.parse({ ...quote, audience: "reviewer", state: "in_review", actions: { createRevision: false, submitReview: false, return: true, issue: true },
  review: { id: "review", state: "pending", reviewerDisplayName: "Inés Vidal", backupDisplayName: "Luis García", submittedAt: 1795421580000, dueAt: 1795507980000 },
});
function ReviewerFixture() {
  const t = useT();
  return <Screen title={t("mobile.provider.reviewDetail")} navigation={{ kind: "back", label: t("mobile.provider.back"), onPress: () => {} }}>
    <ReviewVersion version={pendingQuote} />
    <TextField label={t("mobile.provider.reviewReturnReason")} value="" onChangeText={() => {}} multiline />
    <Button variant="neutral" label={t("mobile.provider.returnReview")} disabled onPress={() => {}} />
    <Button label={t("mobile.foremanQuote.issue")} onPress={() => {}} />
  </Screen>;
}
export const previews: ScreenPreview[] = [
  { id: "P-02", state: "unassigned", render: () => <Fixture state="unassigned" /> },
  { id: "P-02", state: "offered", render: () => <Fixture state="offered" /> },
  { id: "P-02", state: "handoff-stuck", render: () => <Fixture state="handoff-stuck" /> },
  { id: "P-02", state: "commercial-review", render: () => <Fixture state="commercial-review" /> },
  { id: "P-02", state: "reviewer-quote", render: () => <ReviewerFixture /> },
  { id: "P-02", state: "paid-recorded", render: () => <Fixture state="paid-recorded" /> },
];
