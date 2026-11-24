import { getBusinessEligibilityRoute } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { useRemote } from "../../api";
import { useT } from "../../i18n";
import { Badge, Button, Card, Dock, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ReadState, useProvider, useProviderFormat as useFormat, useProviderLabels } from "../p-01/shared";

export default function ProviderEligibilityScreen() {
  const { businessId } = useProvider(); const router = useRouter(); const t = useT(); const format = useFormat(); const labels = useProviderLabels();
  const [cursors, setCursors] = useState<string[]>([]); const cursor = cursors.at(-1);
  const remote = useRemote(getBusinessEligibilityRoute, { params: { b: businessId }, query: { ...(cursor ? { cursor } : {}) } }, { enabled: !!businessId });
  const data = remote.data?.audience === "provider_admin" ? remote.data : null;
  const back = () => router.canGoBack() ? router.back() : router.replace("/p/now" as Href);
  return <Screen title={t("mobile.provider.eligibility")} navigation={{ kind: "back", label: t("mobile.provider.back"), onPress: back }} dock={data ? <Dock primary={{ label: t("mobile.provider.contact"), onPress: () => router.push({ pathname: "/help", params: { reason: "pending", ...(data.supportReference ? { reference: data.supportReference } : {}) } } as Href) }} /> : undefined}>
    <ReadState status={remote.status} retry={() => { void remote.refresh(); }} />
    {data && <><Copy variant="sectionTitle">{t("mobile.provider.business")}</Copy><Card><Copy variant="sectionTitle">{data.business.publicName}</Copy><Badge label={labels.eligibility(data.business.state)} tone={data.business.state === "suspended" ? "critical" : "neutral"} /><Copy>{data.business.areaName}</Copy>{data.approvedScopes.map((scope) => <Copy key={`${scope.trade}-${scope.scope}`}>{scope.trade} · {scope.scope}</Copy>)}<Copy>{t("mobile.provider.ownCrew")}</Copy></Card>
      <Copy variant="sectionTitle">{t("mobile.provider.crewEligibility")}</Copy>
      {[...data.members].sort((a, b) => Number(b.status === "expiring") - Number(a.status === "expiring")).map((member) => <Card key={member.memberId}><Copy variant="sectionTitle">{member.displayName}</Copy><Badge label={labels.eligibility(member.status)} tone={member.status === "expiring" ? "attention" : member.status === "expired" || member.status === "suspended" ? "critical" : "neutral"} />{member.validUntil && <Copy>{t("mobile.provider.expires", { time: format.siteTime(member.validUntil, data.business.siteZone) })}</Copy>}</Card>)}
      <Copy>{t("mobile.provider.eligibilityNote")}</Copy>
      {cursors.length > 0 && <Button variant="quiet" label={t("mobile.provider.previous")} onPress={() => setCursors((v) => v.slice(0, -1))} />}
      {data.hasMore && data.cursor && <Button variant="quiet" label={t("mobile.provider.next")} onPress={() => setCursors((v) => [...v, data.cursor!])} />}
    </>}
  </Screen>;
}
