import { getBusinessPeopleRoute } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { useRemote } from "../../api";
import { useT } from "../../i18n";
import { Badge, Button, Card, Dock, SegmentedControl } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ProviderScreen, ReadState, useProvider, useProviderFormat as useFormat, useProviderLabels } from "../p-01/shared";

type View = "active" | "invited" | "past";
export default function ProviderPeopleScreen() {
  const { businessId } = useProvider(); const router = useRouter(); const t = useT(); const format = useFormat(); const labels = useProviderLabels();
  const [view, setView] = useState<View>("active"); const [cursors, setCursors] = useState<string[]>([]); const cursor = cursors.at(-1);
  const remote = useRemote(getBusinessPeopleRoute, { params: { b: businessId }, query: { view, ...(cursor ? { cursor } : {}) } }, { enabled: !!businessId });
  const data = remote.data?.audience === "provider_admin" ? remote.data : null;
  const edit = (kind: string, id?: string) => router.push({ pathname: "/p/people/edit", params: { kind, ...(id ? { id } : {}), ...(cursor ? { cursor } : {}) } } as Href);
  return <ProviderScreen title={t("mobile.provider.people")} business={data?.business.publicName} dock={data?.canInvite ? <Dock context={t("mobile.provider.inviteContext")} primary={{ label: t("mobile.provider.invite"), onPress: () => edit("new") }} /> : undefined}>
    <Button variant="quiet" label={t("mobile.provider.eligibility")} onPress={() => router.push("/p/eligibility" as Href)} />
    <SegmentedControl label={t("mobile.provider.segment")} value={view} onChange={(v) => { setView(v); setCursors([]); }} options={[{ value: "active", label: `${t("mobile.provider.active")} ${data?.counts.active ?? ""}` }, { value: "invited", label: `${t("mobile.provider.invited")} ${data?.counts.invited ?? ""}` }, { value: "past", label: `${t("mobile.provider.past")} ${data?.counts.past ?? ""}` }]} />
    <ReadState status={remote.status} retry={() => { void remote.refresh(); }} />
    {data?.view === "active" && data.members.map((member) => <Card key={member.id} onPress={() => edit("member", member.id)} accessibilityLabel={[member.displayName, member.isViewer ? t("mobile.provider.you") : "", ...member.roles.map((role) => labels.role(role.role))].filter(Boolean).join(" · ")}><Copy variant="sectionTitle">{member.displayName}</Copy>{member.isViewer && <Badge label={t("mobile.provider.you")} />}<Copy>{member.roles.map((role) => labels.role(role.role)).join(" · ")}</Copy>{member.eligibility && <Badge label={labels.eligibility(member.eligibility)} />}</Card>)}
    {data?.view === "invited" && data.invitations.map((invite) => <Card key={invite.id} onPress={() => edit("invitation", invite.id)} accessibilityLabel={`${invite.email} · ${labels.role(invite.role)}`}><Copy variant="sectionTitle">{invite.email}</Copy><Copy>{labels.role(invite.role)}</Copy><Copy>{t("mobile.provider.expires", { time: format.siteTime(invite.expiresAt, invite.siteZone ?? data.business.siteZone) })}</Copy></Card>)}
    {data?.view === "past" && data.roles.map((role) => <Card key={role.grantId}><Copy variant="sectionTitle">{role.displayName}</Copy><Copy>{labels.role(role.role)}</Copy><Badge label={t("mobile.provider.past")} /><Copy>{t("mobile.provider.revoked", { person: role.revokedBy, time: format.siteTime(role.revokedAt, data.business.siteZone) })}</Copy></Card>)}
    {data && ((data.view === "active" && !data.members.length) || (data.view === "invited" && !data.invitations.length) || (data.view === "past" && !data.roles.length)) && <Copy>{t("mobile.provider.empty")}</Copy>}
    {cursors.length > 0 && <Button variant="quiet" label={t("mobile.provider.previous")} onPress={() => setCursors((v) => v.slice(0, -1))} />}
    {data?.hasMore && data.cursor && <Button variant="quiet" label={t("mobile.provider.next")} onPress={() => setCursors((v) => [...v, data.cursor!])} />}
  </ProviderScreen>;
}
