import { useState } from "react";
import { useT } from "../../i18n";
import type { ScreenPreview } from "../../preview/screens/types";
import { Button, Dock, SegmentedControl, Sheet, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";

type State = "new" | "invite-pending" | "cannot-grant";
function Fixture({ state }: { state: State }) {
  const t = useT(); const [email, setEmail] = useState(""); const [role, setRole] = useState<"worker" | "foreman">("worker");
  return <Sheet visible title={state === "invite-pending" ? t("mobile.provider.people") : t("mobile.provider.invite")} closeLabel={t("mobile.provider.close")} onClose={() => {}} dock={state !== "invite-pending" ? <Dock context={t("mobile.provider.inviteContext")} primary={{ label: t("mobile.provider.sendInvite"), disabled: true, onPress: () => {} }} /> : undefined}>
    <Copy variant="sectionTitle">Reformas Ruiz</Copy><Copy>Mateo Ruiz · {t("mobile.provider.admin")}</Copy>
    {state === "invite-pending" ? <><Copy variant="sectionTitle">diego@example.com</Copy><Copy>{t("mobile.provider.worker")}</Copy><Copy>{t("mobile.provider.expires", { time: "16 Nov 2026, 10:12 GMT+1" })}</Copy><Copy>{t("mobile.provider.waitUntil", { time: "15 Nov 2026, 10:12 GMT+1" })}</Copy><Button label={t("mobile.provider.reissue")} disabled onPress={() => {}} /><Button variant="destructive" label={t("mobile.provider.withdrawInvite")} onPress={() => {}} /></> : <><TextField label={t("mobile.provider.email")} value={email} onChangeText={setEmail} /><SegmentedControl label={t("mobile.provider.role")} value={role} onChange={setRole} options={[{ value: "worker", label: t("mobile.provider.worker") }, { value: "foreman", label: t("mobile.provider.foremanRole") }]} /><Copy>{t("mobile.provider.adminLocked")}</Copy>{state === "cannot-grant" && <Copy>{t("mobile.provider.roleUnavailable")}</Copy>}</>}
  </Sheet>;
}
export const previews: ScreenPreview[] = [
  { id: "P-05", state: "new", render: () => <Fixture state="new" /> },
  { id: "P-05", state: "invite-pending", render: () => <Fixture state="invite-pending" /> },
  { id: "P-05", state: "cannot-grant", render: () => <Fixture state="cannot-grant" /> },
];
