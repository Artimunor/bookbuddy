import { businessMemberSchema } from "@bookbuddy/api-contract";
import { useState } from "react";
import { View } from "react-native";
import { useFormat, useT } from "../../i18n";
import type { ScreenPreview } from "../../preview/screens/types";
import { Button, Card, Dock, Sheet } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { previews as peoplePreviews } from "../p-03/preview";
import { InviteFields, MemberRoleFields } from "./Screen";

type State = "new" | "invite-pending" | "cannot-grant";
const PeopleBackdrop = peoplePreviews.find(({ state }) => state === "active")!.render;
function Fixture({ state }: { state: State }) {
  const t = useT(); const format = useFormat(); const [email, setEmail] = useState(state === "new" ? "diego@example.com" : "");
  const [role, setRole] = useState<"worker" | "foreman">("worker");
  return <View style={{ flex: 1 }}><PeopleBackdrop /><Sheet visible title={state === "invite-pending" ? t("mobile.provider.people") : t("mobile.provider.invite")} closeLabel={t("mobile.provider.close")} onClose={() => {}} dock={state !== "invite-pending" ? <Dock context={t("mobile.provider.inviteContext")} primary={{ label: t("mobile.provider.sendInvite"), disabled: state === "cannot-grant" || !email.trim(), onPress: () => {} }} /> : undefined}>
    <Copy variant="supporting">Reformas Ruiz · Mateo Ruiz · {t("mobile.provider.admin")}</Copy>
    {state === "invite-pending" ? <>
      <Card dense><Copy variant="sectionTitle">diego@example.com</Copy><Copy variant="supporting">{t("mobile.provider.worker")}</Copy>
        <Copy variant="supporting">{t("mobile.provider.expires", { time: format.lines(Date.UTC(2026, 10, 16, 9, 12), "Europe/Madrid")?.site ?? "" })}</Copy>
        <Copy variant="supporting">{t("mobile.provider.waitUntil", { time: format.lines(Date.UTC(2026, 10, 15, 9, 12), "Europe/Madrid")?.site ?? "" })}</Copy>
      </Card>
      <Button label={t("mobile.provider.reissue")} disabled onPress={() => {}} />
      <Button variant="destructive" label={t("mobile.provider.withdrawInvite")} onPress={() => {}} />
    </> : <>
      <InviteFields business="Reformas Ruiz" email={email} role={role} onEmail={setEmail} onRole={setRole} disabled={state === "cannot-grant"} />
      {state === "cannot-grant" && <Copy>{t("mobile.provider.roleUnavailable")}</Copy>}
    </>}
  </Sheet></View>;
}

const member = businessMemberSchema.parse({
  id: "ines", displayName: "Inés Vidal", email: null, isViewer: false, eligibility: null, backupForeman: false,
  roles: [
    { grantId: "foreman-grant", role: "foreman", grantedAt: 1795500000000, removal: { status: "accountable_foreman", affectedJobCount: 2 } },
    { grantId: "worker-grant", role: "worker", grantedAt: 1795500000000, removal: { status: "allowed" } },
  ],
});
function EditFixture() {
  const t = useT();
  const [draft, setDraft] = useState({ roles: member.roles.map(grant => grant.role), backupForeman: true });
  return <Sheet visible title={t("mobile.provider.editRoles")} closeLabel={t("mobile.provider.close")} onClose={() => {}}
    dock={<Dock primary={{ label: t("mobile.provider.saveRoles"), onPress: () => {} }} />}>
    <Copy variant="sectionTitle">Reformas Ruiz</Copy><Copy>Mateo Ruiz · {t("mobile.provider.admin")}</Copy>
    <MemberRoleFields member={member} draft={draft} canManage disabled={false} onChange={setDraft} />
  </Sheet>;
}
export const previews: ScreenPreview[] = [
  { id: "P-05", state: "new", render: () => <Fixture state="new" /> },
  { id: "P-05", state: "invite-pending", render: () => <Fixture state="invite-pending" /> },
  { id: "P-05", state: "cannot-grant", render: () => <Fixture state="cannot-grant" /> },
  { id: "P-05", state: "edit-roles", render: () => <EditFixture /> },
];
