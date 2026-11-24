import { getBusinessPeopleRoute, inviteBusinessMemberRoute, reissueInvitationRoute, revokeBusinessMemberRoute, withdrawInvitationRoute } from "@bookbuddy/api-contract";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useCommand, useRemote } from "../../api";
import { useT } from "../../i18n";
import { Button, Dock, SegmentedControl, Sheet, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ReadState, useProvider, useProviderFormat as useFormat, useProviderLabels } from "../p-01/shared";
import { confirmAction } from "../s-17/confirmAction";

type Action = "invite" | "reissue" | "withdraw" | "revoke";
export default function ProviderMemberSheet() {
  const { kind, id, cursor } = useLocalSearchParams<{ kind?: string; id?: string; cursor?: string }>();
  const { businessId, actor } = useProvider(); const router = useRouter(); const t = useT(); const format = useFormat(); const labels = useProviderLabels();
  const [email, setEmail] = useState(""); const [role, setRole] = useState<"worker" | "foreman">("worker"); const [completed, setCompleted] = useState(false);
  const view = kind === "invitation" ? "invited" : "active";
  const remote = useRemote(getBusinessPeopleRoute, { params: { b: businessId }, query: { view, ...(cursor && kind !== "new" ? { cursor } : {}) } }, { enabled: !!businessId });
  const invite = useCommand(inviteBusinessMemberRoute); const reissue = useCommand(reissueInvitationRoute); const withdraw = useCommand(withdrawInvitationRoute); const revoke = useCommand(revokeBusinessMemberRoute);
  const data = remote.data?.audience === "provider_admin" ? remote.data : null;
  const member = data?.view === "active" ? data.members.find((value) => value.id === id) : undefined;
  const invitation = data?.view === "invited" ? data.invitations.find((value) => value.id === id) : undefined;
  const busy = [invite.state, reissue.state, withdraw.state, revoke.state].some((state) => state === "sending" || state === "checking");
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  function act(action: Action, grantId?: string) {
    if (!data || busy || completed) return;
    const label = action === "invite" ? t("mobile.provider.sendInvite") : action === "reissue" ? t("mobile.provider.reissue") : action === "withdraw" ? t("mobile.provider.withdrawInvite") : t("mobile.provider.revoke");
    const key = action === "invite" ? "mobile.provider.sendInvite" : action === "reissue" ? "mobile.provider.reissue" : action === "withdraw" ? "mobile.provider.withdrawInvite" : "mobile.provider.revoke";
    const affectedRole = action === "revoke" ? member?.roles.find((grant) => grant.grantId === grantId)?.role : invitation?.role ?? role;
    confirmAction(router, { title: label, actionLabel: label, actionLabelKey: key, item: `${data.business.publicName} · ${member?.displayName ?? invitation?.email ?? email.trim()} · ${affectedRole ? labels.role(affectedRole) : ""}`, actor, role: t("mobile.provider.admin"), effects: [action === "revoke" ? t("mobile.provider.revokeEffect") : t("mobile.provider.inviteContext")], destructive: action === "revoke" || action === "withdraw", onReview: () => { void remote.refresh(); }, onConfirm: async () => {
      const result = action === "invite" ? await invite.run({ params: { b: businessId }, body: { payload: { email: email.trim(), role } } })
        : action === "reissue" && invitation ? await reissue.run({ params: { id: invitation.id }, body: { payload: {} } })
        : action === "withdraw" && invitation ? await withdraw.run({ params: { id: invitation.id }, body: { payload: {} } })
        : action === "revoke" && member && grantId ? await revoke.run({ params: { member: member.id }, body: { payload: { roleGrantId: grantId } } }) : null;
      if (result?.ok) { setCompleted(true); void remote.refresh(); return "confirmed"; }
      return result && "delivery" in result.error && result.error.delivery === "unknown" ? "uncertain" : "invalidated";
    } });
  }
  const close = () => router.back();
  return <><Stack.Screen options={{ presentation: "transparentModal", animation: "none", contentStyle: { backgroundColor: "transparent" } }} /><Sheet visible title={kind === "new" ? t("mobile.provider.invite") : t("mobile.provider.people")} closeLabel={t("mobile.provider.close")} onClose={close}
    dock={kind === "new" ? <Dock context={t("mobile.provider.inviteContext")} primary={{ label: t("mobile.provider.sendInvite"), disabled: !data?.canInvite || !valid || busy || completed, onPress: () => act("invite") }} /> : undefined}>
    <ReadState status={remote.status} retry={() => { void remote.refresh(); }} />
    {data && <><Copy variant="sectionTitle">{data.business.publicName}</Copy><Copy>{actor} · {t("mobile.provider.admin")}</Copy>
      {kind === "new" && <><TextField label={t("mobile.provider.email")} value={email} onChangeText={setEmail} autoCapitalize="none" inputMode="email" /><SegmentedControl label={t("mobile.provider.role")} value={role} onChange={setRole} options={[{ value: "worker", label: t("mobile.provider.worker") }, { value: "foreman", label: t("mobile.provider.foremanRole") }]} /><Copy>{t("mobile.provider.adminLocked")}</Copy></>}
      {invitation && <><Copy variant="sectionTitle">{invitation.email}</Copy><Copy>{labels.role(invitation.role)}</Copy><Copy>{t("mobile.provider.expires", { time: format.siteTime(invitation.expiresAt, invitation.siteZone ?? data.business.siteZone) })}</Copy>{invitation.reissue.status === "wait" && <Copy>{t("mobile.provider.waitUntil", { time: format.siteTime(invitation.reissue.retryAt, invitation.siteZone ?? data.business.siteZone) })}</Copy>}<Button label={t("mobile.provider.reissue")} disabled={invitation.reissue.status !== "available" || busy || completed} onPress={() => act("reissue")} /><Button variant="destructive" label={t("mobile.provider.withdrawInvite")} disabled={!invitation.canWithdraw || busy || completed} onPress={() => act("withdraw")} /></>}
      {member && <><Copy variant="sectionTitle">{member.displayName}</Copy>{member.roles.map((grant) => <Button key={grant.grantId} variant="destructive" label={`${t("mobile.provider.revoke")} · ${labels.role(grant.role)}`} disabled={busy || completed} disabledReason={member.isViewer && grant.role === "provider_admin" ? t("mobile.provider.roleUnavailable") : grant.removal.status === "last_admin" ? t("mobile.provider.lastAdmin") : grant.removal.status === "accountable_foreman" ? t("mobile.provider.accountableJobs", { count: grant.removal.affectedJobCount }) : grant.removal.status === "unavailable" ? t("mobile.provider.roleUnavailable") : undefined} onPress={() => act("revoke", grant.grantId)} />)}</>}
      {completed && <><Copy accessibilityLiveRegion="polite">{t("mobile.provider.inviteSent")}</Copy><Button label={t("mobile.provider.close")} onPress={close} /></>}
      {[invite.state, reissue.state, withdraw.state, revoke.state].includes("checking") && <Copy>{t("mobile.provider.checking")}</Copy>}
    </>}
  </Sheet></>;
}
