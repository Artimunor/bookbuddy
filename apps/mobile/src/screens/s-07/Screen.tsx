import { linkTokenSchema, openLinkRoute, sessionContextRoute, type SessionBootstrap } from "@bookbuddy/api-contract";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useApiAccess } from "../../api/provider";
import { useT } from "../../i18n";
import { usePendingDrafts } from "../../repository/hooks";
import { useSession } from "../../session";
import { Button, Dock, Sheet, StatusBanner } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { businessLabel, isolated, roleLabel, roleRoots, useAccountDetails, type RoleChoice } from "../s-06/account";
import { ChoiceRadio } from "../s-12/ChoiceRadio";

type SwitchState = "switching" | "checking" | "failed" | "local";
const sheetPresentation = { presentation: "transparentModal", animation: "none", gestureEnabled: false,
  contentStyle: { backgroundColor: "transparent" } } as const;

export default function SwitchRoleScreen() {
  const router = useRouter();
  const { opaque: link } = useLocalSearchParams<{ opaque?: string }>();
  const parsed = linkTokenSchema.safeParse(link);
  const opaque = parsed.success ? parsed.data : undefined;
  const t = useT();
  const { session, bootstrap, offline, loading, canRetry, retry } = useAccountDetails(!link);
  const { status, acceptBootstrap } = useSession();
  const { isOffline } = useApiAccess();
  const command = useCommand(sessionContextRoute);
  const opening = useRemote(openLinkRoute, { params: { opaque: opaque! } }, { enabled: !!session && !!opaque && !offline });
  const [selection, setSelection] = useState<RoleChoice["contextId"]>();
  const [state, setState] = useState<SwitchState>();
  const inFlight = useRef(false);
  const confirmed = useRef<SessionBootstrap | null>(null);
  const drafts = usePendingDrafts() ?? 0;
  const active = bootstrap?.activeContext ?? session?.activeContext ?? undefined;
  const linked = opening.data?.kind === "switch_context" ? opening.data : undefined;
  const choices: readonly RoleChoice[] = link
    ? linked?.choices.map(({ scope, businessName }) => scope.role === "customer" ? scope : { ...scope, businessName: businessName ?? undefined }) ?? []
    : bootstrap?.contexts ?? [];
  const selected = choices.find(({ contextId }) => contextId === (selection ?? active?.contextId));
  const waiting = link ? !!opaque && !offline && (opening.status === "loading" || opening.status === "idle") : loading;
  const reload = link && opening.status === "error" ? () => { void opening.refresh(); } : !link && canRetry ? retry : undefined;

  function close() {
    if (inFlight.current) return;
    if (router.canGoBack()) router.back();
    else router.replace(active ? roleRoots[active.role] : "/help");
  }

  async function switchTo(choice: RoleChoice) {
    if (!session || choice.contextId === active?.contextId || !choices.includes(choice)
      || inFlight.current || (isOffline() && !confirmed.current)) return;
    inFlight.current = true;
    setState("switching");
    try {
      if (!confirmed.current) {
        const result = await command.run({ body: { payload: { contextId: choice.contextId } } });
        if (!result.ok) {
          const unknown = ("delivery" in result.error && result.error.delivery === "unknown") || result.error.code === "INTERNAL_ERROR";
          setState(unknown ? "checking" : "failed");
          return;
        }
        if (result.data.activeContext?.contextId !== choice.contextId) { setState("failed"); return; }
        confirmed.current = result.data;
      }
      await acceptBootstrap(confirmed.current);
      if (router.canDismiss()) router.dismissAll();
      if (opaque) router.replace({ pathname: "/l/[opaque]", params: { opaque } });
      else router.replace(roleRoots[choice.role]);
    } catch { setState(confirmed.current ? "local" : "checking"); }
    finally { inFlight.current = false; }
  }

  if (!session && status !== "loading") return <Redirect href="/welcome" />;
  return <>
    <Stack.Screen options={sheetPresentation} />
    <SwitchRoleView choices={choices} active={active} selected={selected} name={bootstrap?.account.displayName ?? undefined}
      drafts={drafts} offline={offline} waiting={waiting} state={state} link={!!link} onRetry={reload}
      onClose={close} onSelect={(choice) => { setSelection(choice.contextId); setState(undefined); }}
      onSwitch={(choice) => { void switchTo(choice); }} />
  </>;
}

export function SwitchRoleView({ name, active, choices, selected, drafts = 0, offline, waiting, state, link,
  onSelect, onSwitch, onClose, onRetry }: {
  name?: string;
  active?: RoleChoice;
  choices: readonly RoleChoice[];
  selected?: RoleChoice;
  drafts?: number;
  offline?: boolean;
  waiting?: boolean;
  state?: SwitchState;
  link?: boolean;
  onClose: () => void;
  onSelect: (choice: RoleChoice) => void;
  onSwitch: (choice: RoleChoice) => void;
  onRetry?: () => void;
}) {
  const t = useT();
  const { color, space, radius } = useBeaconTheme();
  const title = t("mobile.switchRole.title");
  const pending = drafts && active ? t("mobile.switchRole.drafts", { count: drafts, role: roleLabel(t, active.role) })
    : t("mobile.switchRole.keepDrafts");
  const action = selected && selected.contextId !== active?.contextId
    ? t("mobile.switchRole.action", { role: roleLabel(t, selected.role) }) : title;
  const status = state === "checking" ? t("mobile.switchRole.checking") : state === "failed" ? t("mobile.switchRole.failed")
    : state === "local" ? t("mobile.switchRole.local") : undefined;
  const blocked = state === "switching" || state === "checking" || state === "local";
  return <Sheet visible title={title} closeLabel={t("shared.action.close")} onClose={onClose}
    dock={<Dock context={offline && state !== "local" ? t("mobile.switchRole.offline") : pending} primary={{
      label: action, busy: state === "switching", disabled: !selected || selected.contextId === active?.contextId || (offline && state !== "local"),
      onPress: () => { if (selected) onSwitch(selected); },
    }} />}>
    <View style={{ gap: space.grid[1] }}>
      {name && <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.switchRole.identity", { name: isolated(name) })}</Copy>}
      <Copy variant="supporting" style={{ color: color.muted }}>{link ? t("mobile.switchRole.link") : t("mobile.switchRole.change")}</Copy>
    </View>
    {choices.length > 0 && <View accessibilityRole="radiogroup" accessibilityLabel={title} style={{ gap: space.grid[2] }}>
      {choices.map((choice) => {
        const current = active?.contextId === choice.contextId;
        const role = roleLabel(t, choice.role);
        const business = businessLabel(t, choice, choices);
        const label = current ? t("mobile.switchRole.currentLabel", { role }) : role;
        return <ChoiceRadio key={choice.contextId} label={role} description={business} disabled={blocked}
          accessibilityLabel={[label, business].filter(Boolean).join(", ")} marker={current ? t("mobile.switchRole.current") : undefined}
          selected={selected?.contextId === choice.contextId} onPress={() => onSelect(choice)} />;
      })}
    </View>}
    {choices.length === 0 && <Copy accessibilityLiveRegion="polite">{waiting ? t("mobile.you.loading") : t("mobile.switchRole.noChoices")}</Copy>}
    {onRetry && <Button variant="quiet" label={t("mobile.you.retry")} onPress={onRetry} />}
    {status && <StatusBanner state="not-sent" label={status} />}
    {offline && drafts > 0 && <Copy variant="supporting" style={{ color: color.muted }}>{pending}</Copy>}
    <View style={{ backgroundColor: color.subtle, borderRadius: radius.input, padding: space.grid[3], gap: space.grid[1] }}>
      <Copy variant="supporting">{t("mobile.switchRole.stillLive")}</Copy>
      <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.switchRole.alerts")}</Copy>
    </View>
  </Sheet>;
}
