import { getBusinessPeopleRoute, type BusinessPeople } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { I18nManager, View } from "react-native";
import { useRemote } from "../../api";
import { useFormat, useT } from "../../i18n";
import { Badge, Button, Card, Dock, SegmentedControl } from "../../ui/controls";
import { Copy, Target, controlMetrics } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { initials } from "../s-06/account";
import { ProviderScreen, ReadState, useProvider, useProviderLabels } from "../p-01/shared";

type PeopleSegment = "active" | "invited" | "past";
type Member = Extract<BusinessPeople, { audience: "provider_admin"; view: "active" }>["members"][number];

export function PeopleMembers({ members, onSelect }: { members: readonly Member[]; onSelect: (id: string) => void }) {
  const t = useT(); const labels = useProviderLabels(); const { color, radius, field, space } = useBeaconTheme();
  if (!members.length) return null;
  return <Card dense>
    {members.map((member, i) => {
      const roles = member.roles.map((role) => labels.role(role.role)).join(" · ");
      const badge = member.isViewer ? t("mobile.provider.you") : null;
      const eligibility = member.eligibility && member.eligibility !== "approved" ? labels.eligibility(member.eligibility) : null;
      const description = [roles, eligibility].filter(Boolean).join(" · ");
      return <Target key={member.id} accessibilityRole="button" accessibilityLabel={[member.displayName, badge, description].filter(Boolean).join(" · ")} onPress={() => onSelect(member.id)}
        style={({ pressed }) => ({ minHeight: controlMetrics(field).rowMinHeight, flexDirection: "row", alignItems: "center", flexWrap: "wrap",
          gap: space.grid[3], backgroundColor: pressed ? color.subtle : color.surface, borderColor: color.separator,
          borderBottomWidth: i === members.length - 1 ? 0 : 1, paddingBottom: space.grid[2] })}>
        <View aria-hidden style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: [color.personB, color.personC, color.personD, color.personA][i % 4] }}>
          <Copy variant="caption">{initials(member.displayName)}</Copy>
        </View>
        <View style={{ flexGrow: 1, flexShrink: 1, minWidth: "42%" }}>
          <Copy variant="label">{member.displayName}</Copy>
          <Copy variant="supporting" style={{ color: color.muted }}>{description}</Copy>
        </View>
        {badge && <Badge label={badge} />}
        <Copy aria-hidden variant="label">{I18nManager.isRTL ? "‹" : "›"}</Copy>
      </Target>;
    })}
  </Card>;
}
export default function ProviderPeopleScreen() {
  const { businessId } = useProvider(); const router = useRouter(); const t = useT(); const format = useFormat(); const labels = useProviderLabels();
  const [view, setView] = useState<PeopleSegment>("active"); const [cursors, setCursors] = useState<string[]>([]); const cursor = cursors.at(-1);
  const remote = useRemote(getBusinessPeopleRoute, { params: { b: businessId }, query: { view, ...(cursor ? { cursor } : {}) } }, { enabled: !!businessId });
  const data = remote.data?.audience === "provider_admin" ? remote.data : null;
  const edit = (kind: string, id?: string) => router.push({ pathname: "/p/people/edit", params: { kind, ...(id ? { id } : {}), ...(cursor ? { cursor } : {}) } } as Href);
  return <ProviderScreen title={t("mobile.provider.people")} business={data?.business.publicName} dock={data?.canInvite ? <Dock context={t("mobile.provider.inviteContext")} primary={{ label: t("mobile.provider.invite"), glyph: "+", onPress: () => edit("new") }} /> : undefined}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
      {data && <Copy variant="supporting" style={{ flexShrink: 1 }}>{t("mobile.provider.peopleContext", { business: data.business.publicName })}</Copy>}
      <Button variant="quiet" label={t("mobile.provider.eligibilityLink")} onPress={() => router.push("/p/eligibility" as Href)} />
    </View>
    <SegmentedControl label={t("mobile.provider.segment")} value={view} onChange={(v) => { setView(v); setCursors([]); }} options={[{ value: "active", label: `${t("mobile.provider.active")} ${data?.counts.active ?? ""}` }, { value: "invited", label: `${t("mobile.provider.invited")} ${data?.counts.invited ?? ""}` }, { value: "past", label: `${t("mobile.provider.past")} ${data?.counts.past ?? ""}` }]} />
    <ReadState status={remote.status} retry={() => { void remote.refresh(); }} />
    {data?.view === "active" && <PeopleMembers members={data.members} onSelect={id => edit("member", id)} />}
    {data?.view === "invited" && data.invitations.map(invite => <Card dense key={invite.id} onPress={() => edit("invitation", invite.id)} accessibilityLabel={`${invite.email} · ${labels.role(invite.role)}`}>
      <Copy variant="label">{invite.email}</Copy><Copy variant="supporting">{labels.role(invite.role)}</Copy>
      <Copy variant="supporting">{t("mobile.provider.expires", { time: format.lines(invite.expiresAt, invite.siteZone ?? data.business.siteZone)?.site ?? t("mobile.provider.unavailable") })}</Copy>
    </Card>)}
    {data?.view === "past" && data.roles.map(role => <Card dense key={role.grantId}>
      <Copy variant="label">{role.displayName}</Copy><Copy variant="supporting">{labels.role(role.role)}</Copy><Badge label={t("mobile.provider.revokedStatus")} />
      <Copy variant="supporting">{t("mobile.provider.revoked", { person: role.revokedBy, time: format.lines(role.revokedAt, data.business.siteZone)?.site ?? t("mobile.provider.unavailable") })}</Copy>
    </Card>)}
    {data && ((data.view === "active" && !data.members.length) || (data.view === "invited" && !data.invitations.length) || (data.view === "past" && !data.roles.length)) && <Copy>{t("mobile.provider.empty")}</Copy>}
    {cursors.length > 0 && <Button variant="quiet" label={t("mobile.provider.previous")} onPress={() => setCursors((v) => v.slice(0, -1))} />}
    {data?.hasMore && data.cursor && <Button variant="quiet" label={t("mobile.provider.next")} onPress={() => setCursors((v) => [...v, data.cursor!])} />}
  </ProviderScreen>;
}
