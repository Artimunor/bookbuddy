import { accountSettingsRoute } from "@bookbuddy/api-contract";
import type { Translator } from "@bookbuddy/i18n";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState, type ComponentRef, type RefObject } from "react";
import { AccessibilityInfo, Platform, View } from "react-native";
import { useCommand } from "../../api";
import { useLocale, useT } from "../../i18n";
import { usePendingDrafts, usePendingSends, useStagedMediaCount } from "../../repository/hooks";
import { useSession } from "../../session";
import { Button, Card, Dock, ListRow, Screen, Sheet, StatusBanner, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { appLanguageLabel, readingLanguageLabel } from "../s-12/language";
import { confirmAction } from "../s-17/confirmAction";
import { businessLabel, initials, isolated, roleLabel, roleRoots, useAccountDetails, type RoleChoice } from "./account";

type PendingWork = { drafts?: number; waiting?: number; checking?: number; media?: number };
type AccountIdentity = { displayName: string | null; email: string };

export default function YouScreen() {
  const router = useRouter();
  const t = useT();
  const { session, bootstrap, offline, loading, canRetry, retry } = useAccountDetails();
  const { preferences, status, signOut } = useSession();
  const [editing, setEditing] = useState(false);
  const signOutTrigger = useRef<ComponentRef<typeof View>>(null);
  const editTrigger = useRef<ComponentRef<typeof View>>(null);
  const switchTrigger = useRef<ComponentRef<typeof View>>(null);
  const openedSwitch = useRef(false);
  const account = bootstrap?.account;
  const active = bootstrap?.activeContext ?? session?.activeContext ?? undefined;
  const drafts = usePendingDrafts(true);
  const sends = usePendingSends();
  const media = useStagedMediaCount();
  const pending = { drafts: drafts ?? undefined, waiting: sends?.waiting, checking: sends?.checking, media: media ?? undefined };

  useFocusEffect(useCallback(() => {
    if (!session && status !== "loading") {
      if (router.canDismiss()) router.dismissAll();
      router.replace("/welcome");
    } else if (openedSwitch.current) {
      openedSwitch.current = false;
      if (Platform.OS !== "web" && switchTrigger.current) AccessibilityInfo.sendAccessibilityEvent(switchTrigger.current, "focus");
    }
  }, [router, session, status]));

  function openSignOut() {
    if (!session) return;
    const confirmation = [t("mobile.you.confirmOtherDevices"), t("mobile.you.confirmWipe"), ...pendingLines(t, pending)];
    if (confirmation.length > 2) confirmation.push(t("mobile.you.confirmUnknown"));
    confirmAction(router, {
      title: t("mobile.you.confirmTitle"), actionLabel: t("mobile.you.confirmAction"), actionLabelKey: "mobile.you.confirmAction",
      item: t("mobile.you.confirmItem"), actor: isolated(account?.displayName || account?.email || t("mobile.you.title")),
      role: active ? roleLabel(t, active.role) : t("mobile.you.device"), effects: confirmation,
      onConfirm: async () => { await signOut(); return "confirmed"; }, onReview: () => setEditing(false),
      serverAction: false, destructive: true, returnFocusRef: signOutTrigger,
    });
  }

  if (!session) return null;
  return <>
    <YouView account={account} active={active ?? undefined} contexts={bootstrap?.contexts} readingLocale={preferences?.readingLocale}
      pending={pending} loading={loading} canEdit={!!account && !offline} signOutTrigger={signOutTrigger} editTrigger={editTrigger} switchTrigger={switchTrigger}
      onRetry={canRetry ? retry : undefined} onSignOut={openSignOut} onEdit={() => setEditing(true)}
      onPlaces={() => router.push("/c/places" as Href)} onDisplay={() => router.push("/display")}
      onPrivacy={() => router.push("/live-privacy" as Href)} onHelp={() => router.push("/help")}
      onSwitch={() => { openedSwitch.current = true; router.push("/switch-role"); }} onBack={() => {
        if (router.canGoBack()) router.back();
        else router.replace(active ? roleRoots[active.role] : "/help");
      }} />
    {account && <EditName account={account} visible={editing} returnFocusRef={editTrigger} onClose={() => setEditing(false)} />}
  </>;
}

export function YouView({ account, active, contexts, readingLocale, place, namedApprover, pending, loading, canEdit,
  signOutTrigger, editTrigger, switchTrigger, onBack, onEdit, onSwitch, onPlaces, onDisplay, onPrivacy, onHelp, onSignOut, onRetry }: {
  account?: AccountIdentity;
  active?: RoleChoice;
  contexts?: readonly RoleChoice[];
  readingLocale?: string | null;
  place?: string;
  namedApprover?: boolean;
  pending?: PendingWork;
  loading?: boolean;
  canEdit?: boolean;
  signOutTrigger?: RefObject<ComponentRef<typeof View> | null>;
  editTrigger?: RefObject<ComponentRef<typeof View> | null>;
  switchTrigger?: RefObject<ComponentRef<typeof View> | null>;
  onBack: () => void;
  onEdit: () => void;
  onSwitch: () => void;
  onPlaces: () => void;
  onDisplay: () => void;
  onPrivacy: () => void;
  onHelp: () => void;
  onSignOut: () => void;
  onRetry?: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { color, radius, space } = useBeaconTheme();
  const roles = contexts ?? [];
  const others = roles.filter(({ contextId }) => contextId !== active?.contextId);
  const activeDetails = active && (roles.find(({ contextId }) => contextId === active.contextId) ?? active);
  const business = activeDetails && businessLabel(t, activeDetails, roles);
  const name = account?.displayName || account?.email;
  const label = appLanguageLabel(t, locale);
  const languageSummary = readingLocale
    ? t("mobile.you.languageSummary", { app: label, reading: isolated(readingLanguageLabel(t, readingLocale)) })
    : t("mobile.you.languageOriginals", { app: label });
  const lines = pending ? pendingLines(t, pending) : [];
  const back = { kind: "back", label: t("shared.action.back"), iconOnly: true, onPress: onBack } as const;
  const muted = { color: color.muted };

  return <Screen title={t("mobile.you.title")} navigation={back}>
    <Copy variant="supporting" style={muted}>{t("mobile.you.device")}</Copy>
    {account && name ? (
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.grid[3], rowGap: space.grid[2] }}>
        <View aria-hidden style={{ minWidth: 52, minHeight: 52, borderRadius: radius.pill,
          padding: space.grid[2], alignItems: "center", justifyContent: "center", backgroundColor: active?.role === "customer" ? color.personA : color.personB }}>
          <Copy variant="label">{initials(name)}</Copy>
        </View>
        <View style={{ flexGrow: 1, flexShrink: 1, minWidth: "45%", gap: space.grid[1] }}>
          <Copy variant="sectionTitle">{isolated(name)}</Copy>
          {!!account.displayName && <Copy variant="supporting" style={muted}>{`\u2066${account.email}\u2069`}</Copy>}
        </View>
        <Button ref={editTrigger} label={t("mobile.you.edit")} variant="quiet" onPress={onEdit} disabled={!canEdit} />
      </View>
    ) : <>
      <StatusBanner state={loading ? "last-confirmed" : "not-sent"}
        label={loading ? t("mobile.you.loading") : t("mobile.you.unavailable")} />
      {onRetry && <Button variant="quiet" label={t("mobile.you.retry")} onPress={onRetry} />}
    </>}
    {active && <Card>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: space.grid[3] }}>
        <View style={{ flexGrow: 1, flexShrink: 1, minWidth: "45%", gap: space.grid[1] }}>
          <Copy variant="caption" style={muted}>{t("mobile.you.role")}</Copy>
          <Copy variant="sectionTitle">{roleLabel(t, active.role)}</Copy>
          {(business || place) && <Copy variant="supporting" style={muted}>{business ?? isolated(place!)}</Copy>}
          {namedApprover && <Copy variant="supporting" style={muted}>{t("mobile.you.approves")}</Copy>}
        </View>
        {others.length > 0 && <Button ref={switchTrigger} label={t("mobile.you.switch")} variant="neutral" onPress={onSwitch} />}
      </View>
      {others.length > 0 ? <Copy variant="supporting" style={muted}>{t("mobile.you.otherRoles", {
        roles: new Intl.ListFormat(locale).format(others.map((other) => {
          const placeOrBusiness = businessLabel(t, other, roles);
          const role = roleLabel(t, other.role);
          return placeOrBusiness && other.businessId !== active.businessId ? t("mobile.you.businessRole", { role, business: placeOrBusiness }) : role;
        })),
      })}</Copy> : (contexts?.length === 1 && <Copy variant="supporting" style={muted}>{t("mobile.you.single")}</Copy>)}
    </Card>}
    <Card>
      {active?.role === "customer" && <ListRow glyph="⌖" label={t("mobile.you.places")}
        description={place ? isolated(place) : t("mobile.you.placesHint")} onPress={onPlaces} />}
      <ListRow glyph="◎" label={t("mobile.display.title")} description={languageSummary} onPress={onDisplay} />
      <ListRow glyph="◉" label={t("mobile.you.privacy")} description={t("mobile.you.privacyHint")} onPress={onPrivacy} />
      <ListRow glyph="?" label={t("mobile.you.help")} description={t("mobile.you.helpHint")} onPress={onHelp} />
    </Card>
    {lines.length > 0 && <Card>
      <Copy variant="label" style={{ color: color.attentionInk }}>{t("mobile.you.pending")}</Copy>
      {lines.map((line) => <Copy key={line} variant="supporting">{line}</Copy>)}
      <Copy variant="supporting" style={muted}>{t("mobile.you.confirmWipe")}</Copy>
    </Card>}
    <View style={{ gap: space.grid[2], paddingTop: space.grid[2] }}>
      <Button ref={signOutTrigger} label={t("mobile.you.signOut")} variant="destructive" onPress={onSignOut} />
      <Copy variant="supporting" style={{ color: color.muted, textAlign: "center" }}>{t("mobile.you.signOutHint")}</Copy>
    </View>
  </Screen>;
}

function pendingLines(t: Translator<"mobile">["t"], { drafts, waiting, checking, media }: PendingWork) {
  return [
    drafts ? t("mobile.you.drafts", { count: drafts }) : null,
    waiting ? t("mobile.you.waiting", { count: waiting }) : null,
    checking ? t("mobile.you.checking", { count: checking }) : null,
    media ? t("mobile.you.media", { count: media }) : null,
  ].filter((line) => line !== null);
}

function EditName({ account, visible, returnFocusRef, onClose }: {
  account: AccountIdentity;
  visible: boolean;
  returnFocusRef: RefObject<ComponentRef<typeof View> | null>;
  onClose: () => void;
}) {
  const t = useT();
  const { bootstrap, offline } = useAccountDetails(false);
  const { acceptBootstrap } = useSession();
  const command = useCommand(accountSettingsRoute);
  const [name, setName] = useState(account.displayName ?? "");
  const [state, setState] = useState<"saving" | "checking" | "failed" | "local">();
  const inFlight = useRef(false);
  const confirmed = useRef<typeof bootstrap>(null);
  const value = name.trim();
  const disabled = !bootstrap || (offline && !confirmed.current) || !value || value === account.displayName;
  async function save() {
    if (inFlight.current || disabled || !bootstrap) return;
    inFlight.current = true;
    setState("saving");
    try {
      if (!confirmed.current) {
        const result = await command.run({ body: { expectedRevision: bootstrap.preferences.revision, payload: { displayName: value } } });
        if (!result.ok) {
          setState(("delivery" in result.error && result.error.delivery === "unknown") || result.error.code === "INTERNAL_ERROR" ? "checking" : "failed");
          return;
        }
        confirmed.current = result.data;
      }
      await acceptBootstrap(confirmed.current);
      setName(confirmed.current.account.displayName ?? "");
      setState(undefined);
      confirmed.current = null;
      onClose();
    } catch { setState(confirmed.current ? "local" : "failed"); }
    finally { inFlight.current = false; }
  }
  const context = state === "checking" ? t("mobile.display.checking")
    : state === "failed" || state === "local" ? t("mobile.display.unsaved") : offline ? t("mobile.display.offline") : undefined;
  function close() {
    if (inFlight.current) return;
    if (state !== "checking" && state !== "local") {
      setName(account.displayName ?? "");
      setState(undefined);
    }
    onClose();
  }
  return <Sheet visible={visible} title={t("mobile.you.editTitle")} closeLabel={t("shared.action.close")} onClose={close} returnFocusRef={returnFocusRef}
    dock={<Dock context={context} primary={{ label: t("mobile.you.save"), disabled, busy: state === "saving", onPress: () => { void save(); } }} />}>
    <TextField label={t("mobile.auth.setup.name")} helper={t("mobile.auth.setup.nameHint")} value={name} onChangeText={setName}
      maxLength={100} autoCapitalize="words" autoComplete="name" readOnly={state === "saving" || state === "checking" || state === "local"} />
  </Sheet>;
}
