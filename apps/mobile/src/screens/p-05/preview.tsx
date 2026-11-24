import { businessMemberSchema } from "@bookbuddy/api-contract";
import { useState } from "react";
import { useT } from "../../i18n";
import type { ScreenPreview } from "../../preview/screens/types";
import { Button, Dock, SegmentedControl, Sheet, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { MemberRoleFields } from "./Screen";

type State = "new" | "invite-pending" | "cannot-grant";
function Fixture({ state }: { state: State }) {
  const t = useT(); const [email, setEmail] = useState(""); const [role, setRole] = useState<"worker" | "foreman">("worker");
  return <Sheet visible title={state === "invite-pending" ? t("mobile.provider.people") : t("mobile.provider.invite")} closeLabel={t("mobile.provider.close")} onClose={() => {}} dock={state !== "invite-pending" ? <Dock context={t("mobile.provider.inviteContext")} primary={{ label: t("mobile.provider.sendInvite"), disabled: true, onPress: () => {} }} /> : undefined}>
    <Copy variant="sectionTitle">Reformas Ruiz</Copy><Copy>Mateo Ruiz · {t("mobile.provider.admin")}</Copy>
    {state === "invite-pending" ? <><Copy variant="sectionTitle">diego@example.com</Copy><Copy>{t("mobile.provider.worker")}</Copy><Copy>{t("mobile.provider.expires", { time: "16 Nov 2026, 10:12 GMT+1" })}</Copy><Copy>{t("mobile.provider.waitUntil", { time: "15 Nov 2026, 10:12 GMT+1" })}</Copy><Button label={t("mobile.provider.reissue")} disabled onPress={() => {}} /><Button variant="destructive" label={t("mobile.provider.withdrawInvite")} onPress={() => {}} /></> : <><TextField label={t("mobile.provider.email")} value={email} onChangeText={setEmail} /><SegmentedControl label={t("mobile.provider.role")} value={role} onChange={setRole} options={[{ value: "worker", label: t("mobile.provider.worker") }, { value: "foreman", label: t("mobile.provider.foremanRole") }]} /><Copy>{t("mobile.provider.adminLocked")}</Copy>{state === "cannot-grant" && <Copy>{t("mobile.provider.roleUnavailable")}</Copy>}</>}
  </Sheet>;
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
