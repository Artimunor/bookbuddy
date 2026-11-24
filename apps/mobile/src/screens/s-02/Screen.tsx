import { emailStartRoute } from "@bookbuddy/api-contract";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { SymbolView } from "expo-symbols";
import { View } from "react-native";
import { useLocale, useT } from "../../i18n";
import { Button, Dock, Screen, StatusBanner, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { authFlow, emailDevice, newAttemptId, openAuthHelp, useAuthClient, useDeadline, useOffline, viewerTime, type EmailDevice } from "./flow";

type State = "new" | "invalid" | "rate-limited" | "offline" | "uncertain" | "not-requested" | "unavailable";

export default function SignInScreen() {
  const router = useRouter();
  const auth = useAuthClient();
  const offline = useOffline();
  const [email, setEmail] = useState(authFlow.email);
  const [state, setState] = useState<State>("new");
  const [retryAt, setRetryAt] = useState(0);
  const remaining = useDeadline(retryAt);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const unresolved = useRef<{ attemptId: string; device: EmailDevice } | null>(null);
  const generation = useRef(0);
  const effectiveState = offline ? "offline" : remaining > 0 ? "rate-limited"
    : unresolved.current ? "uncertain" : state === "rate-limited" ? "new" : state;

  function changeEmail(next: string) {
    authFlow.email = next;
    setEmail(next);
    if (state === "invalid" || state === "not-requested") setState("new");
  }

  async function send() {
    if (offline || remaining > 0 || inFlight.current) return;
    if (!auth) { setState("unavailable"); return; }
    const checking = unresolved.current;
    const run = generation.current;
    inFlight.current = true;
    setBusy(true);
    try {
      if (checking) {
        const result = await auth.status(checking.attemptId);
        if (run !== generation.current) return;
        if (result.ok) {
          unresolved.current = null;
          if (result.data.state === "invalidated" || result.data.state === "consumed") { setState("not-requested"); return; }
          authFlow.verify(checking.device, result.data, result.meta.serverTime);
          router.push("/verify");
        } else if (result.error.code === "NOT_FOUND") {
          unresolved.current = null;
          setState("not-requested");
        }
        return;
      }
      const input = emailStartRoute.input.shape.body.shape.email.safeParse(email);
      if (!input.success) { setState("invalid"); return; }
      const [device, attemptId] = [await emailDevice(input.data), newAttemptId()];
      if (run !== generation.current) return;
      const result = await auth.start({ ...device, attemptId });
      if (run !== generation.current) return;
      if (result.ok) {
        setState("new");
        authFlow.verify(device, result.data, result.meta.serverTime);
        router.push("/verify");
      } else if ("delivery" in result.error && result.error.delivery === "unknown" || result.error.code === "INTERNAL_ERROR") {
        unresolved.current = { attemptId, device };
        setState("uncertain");
      } else if (result.error.code === "RATE_LIMITED" && result.error.retryAt) {
        setRetryAt(result.error.retryAt);
        setState("rate-limited");
      } else if (result.error.code === "VALIDATION_FAILED") setState("invalid");
      else setState("unavailable");
    } catch { setState("unavailable"); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <SignInView email={email} state={effectiveState} retryAt={retryAt} busy={busy} readOnly={!!unresolved.current}
    onChangeEmail={changeEmail} onSend={() => { void send(); }} onHelp={() => openAuthHelp(router)}
    onBack={() => { generation.current += 1; if (router.canGoBack()) router.back(); else router.replace("/welcome"); }} />;
}

export function SignInView({ email, state, retryAt, busy, readOnly, onChangeEmail, onSend, onHelp, onBack }: {
  email: string; state: State; retryAt?: number; busy?: boolean; readOnly?: boolean;
  onChangeEmail: (value: string) => void; onSend: () => void; onHelp: () => void; onBack: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { color, radius, space } = useBeaconTheme();
  const blocked = state === "offline" || state === "rate-limited";
  const context = state === "offline" ? t("mobile.auth.email.offline")
    : state === "rate-limited" && retryAt ? t("mobile.auth.email.rate", { time: viewerTime(locale, retryAt) })
      : t("mobile.auth.email.next");
  const issue = state === "uncertain" ? t("mobile.auth.email.uncertain")
    : state === "unavailable" ? t("mobile.auth.common.unavailable")
      : state === "not-requested" ? t("mobile.auth.email.notRequested") : null;

  return (
    <Screen title={t("mobile.auth.email.title")} subtitle={t("mobile.auth.email.roles")} navigation={{ kind: "back", label: t("shared.action.back"), onPress: onBack }}
      dock={<Dock context={context} primary={{ label: state === "uncertain" ? t("mobile.auth.common.check") : t("mobile.auth.email.send"),
        onPress: onSend, disabled: blocked, busy }} />}>
      <View style={{ gap: space.grid[2] }}>
        <Copy variant="pageTitle" accessibilityRole="header">{t("mobile.auth.email.question")}</Copy>
        <Copy>{t("mobile.auth.email.intro")}</Copy>
      </View>
      <TextField label={t("mobile.auth.email.label")} value={email} onChangeText={onChangeEmail}
        error={state === "invalid" ? t("mobile.auth.email.invalid") : undefined} helper={t("mobile.auth.email.helper")}
        autoComplete="email" inputMode="email" returnKeyType="go" autoCapitalize="none" autoCorrect={false}
        writingDirection="ltr" maxLength={254} readOnly={busy || readOnly} onSubmitEditing={onSend} />
      {issue && <StatusBanner state={state === "not-requested" ? "last-confirmed" : "not-sent"} label={issue} />}
      <View style={{ flexDirection: "row", gap: space.grid[3], backgroundColor: color.subtle, padding: space.grid[4], borderRadius: radius.card, alignItems: "flex-start" }}>
        <View style={{ backgroundColor: color.surface, borderRadius: radius.smallTile, padding: space.grid[2] }} aria-hidden>
          <SymbolView name={{ ios: "person", android: "person", web: "person" }} tintColor={color.ink} size={20} />
        </View>
        <View style={{ flex: 1, gap: space.grid[1] }}>
          <Copy variant="label">{t("mobile.auth.email.roles")}</Copy>
          <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.auth.email.rolesDetail")}</Copy>
        </View>
      </View>
      <View style={{ alignSelf: "flex-start", marginStart: -space.grid[4] }}><Button label={t("mobile.auth.email.trouble")} variant="quiet" onPress={onHelp} /></View>
    </Screen>
  );
}
