import { getBusinessPeopleRoute, inviteBusinessMemberRoute, patchBusinessMemberRolesRoute, reissueInvitationRoute, revokeBusinessMemberRoute, withdrawInvitationRoute, type BusinessMemberRolesPatch, type businessMemberSchema, type RouteResponse } from "@bookbuddy/api-contract";
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useFormat as useClockFormat, useT } from "../../i18n";
import { Button, Card, Dock, ListRow, Sheet, SwitchRow, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ReadState, useProvider, useProviderFormat as useFormat, useProviderLabels } from "../p-01/shared";
import { useOffline } from "../s-02/flow";
import { confirmAction } from "../s-17/confirmAction";
import { ChoiceRadio } from "../s-12/ChoiceRadio";
import { useBeaconTheme } from "../../ui/theme";

type Action = "invite" | "reissue" | "withdraw" | "revoke";
type Member = RouteResponse<typeof businessMemberSchema>;
type Roles = NonNullable<BusinessMemberRolesPatch["roles"]>;
type MemberDraft = { roles: Roles; backupForeman: boolean };
const membershipRoles = ["worker", "foreman", "provider_admin"] as const;

export function MemberRoleFields({ member, draft, canManage, disabled, onChange }: {
  member: Member; draft: MemberDraft; canManage: boolean; disabled: boolean; onChange: (draft: MemberDraft) => void;
}) {
  const t = useT();
  const labels = useProviderLabels();
  return <>
    <Copy variant="sectionTitle">{member.displayName}</Copy>
    {membershipRoles.map(role => {
      const grant = member.roles.find(value => value.role === role);
      const value = draft.roles.includes(role);
      const removal = grant?.removal;
      const description = removal?.status === "last_admin" ? t("mobile.provider.lastAdmin")
        : removal?.status === "accountable_foreman" ? t("mobile.provider.accountableJobs", { count: removal.affectedJobCount })
        : removal?.status === "unavailable" ? (role === "foreman" && canManage ? t("mobile.provider.accountableForemanLocked") : t("mobile.provider.roleUnavailable"))
        : !grant && role === "provider_admin" ? t("mobile.provider.adminLocked")
        : !grant && role === "foreman" ? t("mobile.provider.foremanVerification") : undefined;
      const locked = grant ? removal?.status !== "allowed" || (member.isViewer && role === "provider_admin") : role === "provider_admin" || member.isViewer;
      return <SwitchRow key={role} label={labels.role(role)} description={description} value={value} disabled={!canManage || disabled || locked}
        onValueChange={enabled => onChange({
          roles: enabled ? [...draft.roles, role] : draft.roles.filter(value => value !== role),
          backupForeman: role === "foreman" && !enabled ? false : draft.backupForeman,
        })} />;
    })}
    <SwitchRow label={t("mobile.provider.backupForeman")} description={t("mobile.provider.backupForemanEffect")}
      value={draft.backupForeman} disabled={!canManage || disabled || !draft.roles.includes("foreman") || (member.isViewer && !draft.backupForeman)}
      onValueChange={backupForeman => onChange({ ...draft, backupForeman })} />
  </>;
}

export function InviteFields({ business, email, role, disabled, onEmail, onRole }: {
  business: string; email: string; role: "worker" | "foreman"; disabled?: boolean; onEmail: (email: string) => void; onRole: (role: "worker" | "foreman") => void;
}) {
  const t = useT(); const { space } = useBeaconTheme();
  const label = t("mobile.provider.inviteRole", { business });
  return <>
    <TextField label={t("mobile.provider.email")} helper={t("mobile.provider.inviteEmailHint")} value={email} onChangeText={onEmail}
      readOnly={disabled} inputMode="email" autoCapitalize="none" autoComplete="email" autoCorrect={false} writingDirection="ltr" />
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: space.grid[2] }}>
      <Copy variant="label">{label}</Copy>
      <ChoiceRadio label={t("mobile.provider.worker")} description={t("mobile.invitation.workerShifts")} selected={role === "worker"} disabled={disabled} onPress={() => onRole("worker")} />
      <ChoiceRadio label={t("mobile.provider.foremanRole")} description={t("mobile.provider.foremanVerification")} selected={role === "foreman"} disabled={disabled} onPress={() => onRole("foreman")} />
      <ChoiceRadio label={t("mobile.provider.admin")} description={t("mobile.provider.inviteAdminHint")} selected={false} disabled onPress={() => {}} />
    </View>
    <Card dense><ListRow glyph="◷" label={t("mobile.provider.inviteLifetime")} description={t("mobile.provider.inviteContext")} /></Card>
  </>;
}

export default function ProviderMemberSheet() {
  const { kind, id, cursor } = useLocalSearchParams<{ kind?: string; id?: string; cursor?: string }>();
  const { businessId, actor } = useProvider(); const router = useRouter(); const t = useT(); const format = useFormat(); const clock = useClockFormat(); const labels = useProviderLabels();
  const [email, setEmail] = useState(""); const [role, setRole] = useState<"worker" | "foreman">("worker"); const [completed, setCompleted] = useState(false);
  const [memberDraft, setMemberDraft] = useState<{ source: Member; value: MemberDraft } | null>(null);
  const [editFailed, setEditFailed] = useState(false);
  const offline = useOffline();
  const view = kind === "invitation" ? "invited" : "active";
  const remote = useRemote(getBusinessPeopleRoute, { params: { b: businessId }, query: { view, ...(cursor && kind !== "new" ? { cursor } : {}) } }, { enabled: !!businessId });
  const invite = useCommand(inviteBusinessMemberRoute); const reissue = useCommand(reissueInvitationRoute); const withdraw = useCommand(withdrawInvitationRoute); const revoke = useCommand(revokeBusinessMemberRoute);
  const patch = useCommand(patchBusinessMemberRolesRoute, { resourceId: businessId && id ? [businessId, id] : undefined });
  const data = remote.data?.audience === "provider_admin" ? remote.data : null;
  const member = data?.view === "active" ? data.members.find((value) => value.id === id) : undefined;
  const liveMember = useRef<Member | undefined>(member);
  liveMember.current = member;
  const originalRoles = member?.roles.map(grant => grant.role) ?? [];
  const draft = memberDraft && memberDraft.source === member ? memberDraft.value : { roles: originalRoles, backupForeman: member?.backupForeman ?? false };
  const rolesChanged = originalRoles.length !== draft.roles.length || originalRoles.some(role => !draft.roles.includes(role));
  const backupChanged = !!member && draft.backupForeman !== member.backupForeman;
  const invitation = data?.view === "invited" ? data.invitations.find((value) => value.id === id) : undefined;
  const states = [invite.state, reissue.state, withdraw.state, revoke.state, patch.state];
  const busy = states.includes("sending") || states.includes("checking");
  const readOnly = !data?.canInvite || busy || completed || offline;
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
  function saveRoles() {
    if (readOnly || !member || !data || (!rolesChanged && !backupChanged)) return;
    const label = t("mobile.provider.saveRoles");
    const removed = originalRoles.filter(role => !draft.roles.includes(role));
    const effects = [
      ...draft.roles.filter(role => !originalRoles.includes(role)).map(role => t("mobile.provider.roleAdded", { role: labels.role(role) })),
      ...removed.map(role => t("mobile.provider.roleRemoved", { role: labels.role(role) })),
    ];
    if (backupChanged) effects.push(draft.backupForeman ? t("mobile.provider.backupEnabled") : t("mobile.provider.backupDisabled"));
    const reviewedRoleGrantIds = member.roles.map(({ grantId }) => grantId);
    confirmAction(router, {
      title: label, actionLabel: label, actionLabelKey: "mobile.provider.saveRoles",
      item: `${data.business.publicName} · ${member.displayName}`, actor, role: t("mobile.provider.admin"),
      effects, destructive: removed.length > 0, offline, onReview: () => { setMemberDraft(null); setEditFailed(false); },
      onConfirm: async () => {
        if (liveMember.current !== member) return "invalidated";
        const result = await patch.run({
          params: { b: businessId, m: member.id },
          body: { payload: {
            reviewedRoleGrantIds, reviewedBackupForeman: member.backupForeman,
            ...(rolesChanged ? { roles: draft.roles } : {}), ...(backupChanged ? { backupForeman: draft.backupForeman } : {}),
          } },
        });
        if (result.ok) { setCompleted(true); setEditFailed(false); void remote.refresh(); return "confirmed"; }
        if ("delivery" in result.error && result.error.delivery === "unknown" || result.error.code === "INTERNAL_ERROR") return "uncertain";
        setEditFailed(true);
        void remote.refresh();
        return "invalidated";
      },
    });
  }
  const close = () => router.back();
  const focused = useIsFocused();
  return <><Stack.Screen options={{ presentation: "transparentModal", animation: "none", contentStyle: { backgroundColor: "transparent" } }} /><Sheet visible={focused} title={kind === "new" ? t("mobile.provider.invite") : kind === "invitation" ? t("mobile.provider.people") : t("mobile.provider.editRoles")} closeLabel={t("mobile.provider.close")} onClose={close}
    dock={kind === "new" ? <Dock context={t("mobile.provider.inviteContext")} primary={{ label: t("mobile.provider.sendInvite"), disabled: readOnly || !valid, onPress: () => act("invite") }} />
      : member && !completed ? <Dock primary={{ label: t("mobile.provider.saveRoles"), disabled: readOnly || (!rolesChanged && !backupChanged), onPress: saveRoles }} /> : undefined}>
    <ReadState status={remote.status} retry={() => { void remote.refresh(); }} />
    {data && <><Copy variant="supporting">{data.business.publicName} · {actor} · {t("mobile.provider.admin")}</Copy>
      {kind === "new" && <InviteFields business={data.business.publicName} email={email} role={role} disabled={readOnly} onEmail={setEmail} onRole={setRole} />}
      {invitation && <>
        <Card dense>
          <Copy variant="sectionTitle">{invitation.email}</Copy>
          <Copy variant="supporting">{labels.role(invitation.role)}</Copy>
          <Copy variant="supporting">{t("mobile.provider.expires", { time: clock.lines(invitation.expiresAt, invitation.siteZone ?? data.business.siteZone)?.site ?? t("mobile.provider.unavailable") })}</Copy>
          {invitation.reissue.status === "wait" && <Copy variant="supporting">{t("mobile.provider.waitUntil", { time: clock.lines(invitation.reissue.retryAt, invitation.siteZone ?? data.business.siteZone)?.site ?? t("mobile.provider.unavailable") })}</Copy>}
        </Card>
        <Button label={t("mobile.provider.reissue")} disabled={invitation.reissue.status !== "available" || busy || completed} onPress={() => act("reissue")} />
        <Button variant="destructive" label={t("mobile.provider.withdrawInvite")} disabled={!invitation.canWithdraw || busy || completed} onPress={() => act("withdraw")} />
      </>}
      {member && !completed && <>
        <MemberRoleFields member={member} draft={draft} canManage={data.canInvite} disabled={readOnly} onChange={value => { setEditFailed(false); setMemberDraft({ source: member, value }); }} />
        {member.roles.map(grant => grant.removal.status === "allowed" && !(member.isViewer && grant.role === "provider_admin") &&
          <Button key={grant.grantId} variant="destructive" label={`${t("mobile.provider.revoke")} · ${labels.role(grant.role)}`} disabled={readOnly} onPress={() => act("revoke", grant.grantId)} />)}
      </>}
      {editFailed && <Copy accessibilityLiveRegion="polite">{t("mobile.provider.roleChangeRefused")}</Copy>}
      {completed && <><Copy accessibilityLiveRegion="polite">{t("mobile.provider.inviteSent")}</Copy><Button label={t("mobile.provider.close")} onPress={close} /></>}
      {states.includes("checking") && <Copy>{t("mobile.provider.checking")}</Copy>}
    </>}
  </Sheet></>;
}
