import { type EmailAttempt, type SessionBootstrap } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { TextInput, View } from "react-native";
import { useLocale, useT } from "../../i18n";
import { useSession } from "../../session";
import { Button, Card, CodeField, Dock, Screen, StatusBanner } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { afterAuthentication, authFlow, openAuthHelp, useAuthClient, useDeadline, useOffline, viewerTime } from "../s-02/flow";

type Variant = "waiting" | "wrong" | "expired" | "locked" | "superseded";
type Issue = "unavailable" | "resend-uncertain" | "verify-uncertain" | "local-save";
type Pending = { kind: "verify"; operationId: string; code: string }
  | { kind: "resend" }
  | { kind: "local-save"; session: SessionBootstrap; credential?: string };

export default function VerifyScreen() {
  const router = useRouter();
  const auth = useAuthClient();
  const offline = useOffline();
  const { acceptBootstrap } = useSession();
  const [flow] = useState(() => authFlow.challenge);
  const [attempt, setAttempt] = useState(flow?.attempt);
  const [offset, setOffset] = useState(flow?.offset ?? 0);
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState<number | null>(null);
  const [issue, setIssue] = useState<Issue>();
  const [busy, setBusy] = useState(false);
  const [focusRequest, requestFocus] = useState(0);
  const field = useRef<ComponentRef<typeof TextInput>>(null);
  const pending = useRef<Pending | null>(null);
  const inFlight = useRef(false);
  const left = useDeadline(attempt?.resendAt ?? 0, offset, attempt?.state !== "locked");
  const lockLeft = useDeadline(attempt?.retryAt ?? 0, offset);
  const expires = useDeadline(attempt?.expiresAt ?? 0, offset);
  const variant: Variant = !attempt || attempt.state === "invalidated" || attempt.state === "consumed" ? "superseded"
    : attempt.state === "locked" ? "locked"
      : !expires || attempt.state === "expired" ? "expired" : wrong === null ? "waiting" : "wrong";
  useEffect(() => { if (focusRequest) field.current?.focus(); }, [focusRequest]);

  function changeEmail() {
    authFlow.leaveChallenge();
    if (router.canGoBack()) router.back();
    else router.replace("/sign-in");
  }

  function adopt(next: EmailAttempt, serverTime: number) {
    setAttempt(next);
    setOffset(serverTime - Date.now());
    if (flow) authFlow.verify(flow.device, next, serverTime);
  }

  async function secureSession(next: Extract<Pending, { kind: "local-save" }>) {
    pending.current = next;
    try {
      await acceptBootstrap(next.session, next.credential);
      pending.current = null;
      afterAuthentication(router, next.session);
    } catch { setIssue("local-save"); }
  }

  async function run(action: "verify" | "resend" | "check") {
    if (inFlight.current || !flow || !attempt) return;
    const unknown = pending.current;
    if (offline && unknown?.kind !== "local-save") return;
    if (!auth && unknown?.kind !== "local-save") { setIssue("unavailable"); return; }
    if (action === "check" && !unknown || action !== "check" && unknown) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (unknown?.kind === "local-save") { await secureSession(unknown); return; }
      if (!auth) return;
      if (unknown?.kind === "resend") {
        const result = await auth.status(attempt.attemptId);
        if (result.ok) {
          pending.current = null;
          adopt(result.data, result.meta.serverTime);
          if (result.data.generation !== attempt.generation) { setCode(""); setWrong(null); }
          setIssue(undefined);
        } else if (result.error.code === "NOT_FOUND") {
          pending.current = null;
          setAttempt({ ...attempt, state: "invalidated" });
          setIssue(undefined);
        }
        return;
      }
      if (action === "resend") {
        if (left > 0 || lockLeft > 0 || variant === "superseded") return;
        const result = await auth.resend(attempt.attemptId, { operationId: uuid.v4(), expectedRevision: attempt.generation, payload: flow.device });
        if (result.ok) {
          adopt(result.data, result.meta.serverTime);
          setCode("");
          setWrong(null);
          setIssue(undefined);
        } else if (result.error.code === "RATE_LIMITED" && result.error.retryAt) {
          setAttempt({ ...attempt, resendAt: result.error.retryAt });
        } else if (result.error.code === "CONFLICT" || result.error.code === "INTERNAL_ERROR"
          || "delivery" in result.error && result.error.delivery === "unknown") {
          pending.current = { kind: "resend" };
          setIssue("resend-uncertain");
        } else if (result.error.code === "NOT_FOUND") setAttempt({ ...attempt, state: "invalidated" });
        else setIssue("unavailable");
        return;
      }
      const check = unknown?.kind === "verify" ? unknown : null;
      if (!check && ((variant !== "waiting" && variant !== "wrong") || !/^\d{6}$/.test(code))) return;
      const proof = check ?? { kind: "verify" as const, operationId: uuid.v4(), code };
      const result = await auth.verify(attempt.attemptId, { operationId: proof.operationId, payload: { ...flow.device, code: proof.code } });
      pending.current = null;
      setIssue(undefined);
      if (result.ok) {
        switch (result.data.status) {
          case "verified": await secureSession({ kind: "local-save", session: result.data.session, credential: result.data.credential }); break;
          case "wrong_code": setWrong(result.data.triesLeft); setCode(""); requestFocus((n) => n + 1); break;
          case "expired": setCode(""); setAttempt({ ...attempt, state: "expired" }); break;
        }
      } else if (result.error.code === "RATE_LIMITED" && result.error.retryAt) {
        setCode("");
        setAttempt({ ...attempt, state: "locked", retryAt: result.error.retryAt });
      } else if ("delivery" in result.error && result.error.delivery === "unknown" || result.error.code === "INTERNAL_ERROR") {
        pending.current = proof;
        setIssue("verify-uncertain");
      } else if (result.error.code === "NOT_FOUND" || result.error.code === "CONFLICT") {
        setCode("");
        setAttempt({ ...attempt, state: "invalidated" });
      } else if (check && (result.error.code === "UNAVAILABLE" || "delivery" in result.error)) {
        pending.current = check;
        setIssue("verify-uncertain");
      } else setIssue("unavailable");
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <VerifyView email={flow?.device.email ?? ""} code={code} variant={variant} triesLeft={wrong ?? undefined}
    resendSeconds={Math.ceil(left / 1000)} retryAt={attempt?.retryAt ?? undefined} lockMinutes={Math.ceil(lockLeft / 60_000)}
    delivery={attempt?.delivery} issue={issue} offline={offline} busy={busy} fieldRef={field}
    onCode={(value) => { setCode(value); if (wrong !== null) setWrong(null); }}
    onVerify={() => { void run("verify"); }} onResend={() => { void run("resend"); }} onCheck={() => { void run("check"); }}
    onBack={changeEmail} onHelp={() => openAuthHelp(router)} />;
}

type ViewProps = {
  email: string; code: string; variant: Variant; triesLeft?: number; resendSeconds?: number;
  retryAt?: number; lockMinutes?: number; delivery?: EmailAttempt["delivery"]; issue?: Issue; offline?: boolean; busy?: boolean;
  fieldRef?: React.Ref<ComponentRef<typeof TextInput>>;
  onCode: (code: string) => void; onVerify: () => void; onResend: () => void; onCheck: () => void;
  onBack: () => void; onHelp: () => void;
};

export function VerifyView({ email, code, variant, triesLeft, resendSeconds = 0, retryAt, lockMinutes = 0,
  delivery, issue, offline, busy, fieldRef, onCode, onVerify, onResend, onCheck, onBack, onHelp }: ViewProps) {
  const t = useT();
  const { locale } = useLocale();
  const { space, color, radius } = useBeaconTheme();
  const locked = variant === "locked";
  const expired = variant === "expired";
  const superseded = variant === "superseded";
  const wrong = variant === "wrong";
  const verifying = !locked && !expired && !superseded;
  const canResend = !offline && !busy && !issue?.endsWith("uncertain") && issue !== "local-save" && resendSeconds === 0 && lockMinutes === 0;
  const time = retryAt === undefined ? null : viewerTime(locale, retryAt);
  const checking = issue === "verify-uncertain" || issue === "resend-uncertain" || issue === "local-save";
  const message = issue === "verify-uncertain" ? t("mobile.auth.verify.verifyUncertain")
    : issue === "resend-uncertain" ? t("mobile.auth.verify.sendUncertain")
      : issue === "local-save" ? t("mobile.auth.verify.storeFailed")
        : issue === "unavailable" ? t("mobile.auth.common.unavailable")
          : !locked && delivery === "failed" ? t("mobile.auth.verify.deliveryFailed")
            : !locked && delivery === "unknown" ? t("mobile.auth.verify.deliveryUnknown") : null;
  const context = offline && issue !== "local-save" ? t("mobile.auth.common.offline")
    : checking || superseded ? undefined
      : locked && lockMinutes > 0 && time ? t("mobile.auth.verify.whenAllowed", { time })
        : locked ? t("mobile.auth.verify.lockFinished")
          : expired ? t("mobile.auth.verify.expired")
            : code.length === 6 ? undefined : wrong ? t("mobile.auth.verify.tryAgain") : t("mobile.auth.verify.waiting");
  const primary = checking ? { label: issue === "local-save" ? t("mobile.auth.verify.saveSession") : t("mobile.auth.common.check"),
    onPress: onCheck, disabled: offline && issue !== "local-save" }
    : superseded ? { label: t("mobile.auth.verify.changeEmail"), onPress: onBack }
      : locked || expired ? { label: t("mobile.auth.verify.resend"), onPress: onResend, disabled: !canResend }
        : { label: t("mobile.auth.verify.action"), onPress: onVerify, disabled: offline || code.length !== 6 };
  return (
    <Screen title={t("mobile.auth.verify.title")} navigation={{ kind: "back", label: t("shared.action.back"), onPress: onBack }}
      dock={<Dock context={context} primary={{ ...primary, busy }} />}>
      <View style={{ gap: space.grid[2] }}>
        <Copy variant="pageTitle" accessibilityRole="header">
          {locked ? t("mobile.auth.verify.paused") : t("mobile.auth.verify.heading")}
        </Copy>
        {superseded ? <Copy>{t("mobile.auth.verify.superseded")}</Copy> : <>
          <Copy>{locked ? t("mobile.auth.verify.pausedFor") : t("mobile.auth.verify.sent")}</Copy>
          <Copy variant="label">{`\u2066${email}\u2069`}</Copy>
        </>}
      </View>
      {verifying && <CodeField ref={fieldRef} label={t("mobile.auth.verify.label")} value={code} onChangeText={onCode}
        error={wrong ? t("mobile.auth.verify.wrong") : undefined} readOnly={busy || checking} />}
      {wrong && triesLeft !== undefined && <View style={{ gap: space.grid[1] }}>
        <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.auth.verify.newest")}</Copy>
        <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.auth.verify.tries", { count: triesLeft })}</Copy>
      </View>}
      {locked && <>
        <View style={{ backgroundColor: color.criticalSoft, borderRadius: radius.card, gap: space.grid[2], padding: space.cardPadding }}>
          {time && lockMinutes > 0 ? <>
            <Copy variant="sectionTitle" style={{ color: color.criticalInk }}>{t("mobile.auth.verify.unlock", { time })}</Copy>
            <Copy variant="supporting" style={{ color: color.criticalInk }}>{t("mobile.auth.verify.lockMinutes", { count: lockMinutes })}</Copy>
          </> : <Copy variant="label" style={{ color: color.criticalInk }}>{t("mobile.auth.verify.lockFinished")}</Copy>}
          <Copy variant="supporting" style={{ color: color.criticalInk }}>{t("mobile.auth.verify.lockDetail")}</Copy>
        </View>
        <Card>
          <Copy variant="label">{t("mobile.auth.verify.unaffected")}</Copy>
          <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.auth.verify.unaffectedDetail")}</Copy>
        </Card>
      </>}
      {(verifying || expired) && !checking && <View style={{ gap: space.grid[1] }}>
        {resendSeconds > 0 && <Copy variant="supporting" style={{ color: color.muted }}>
          {t("mobile.auth.verify.resendCountdown", { count: resendSeconds })}
        </Copy>}
        <Copy variant="supporting" accessibilityLiveRegion="polite" aria-live="polite" style={{ color: color.muted }}>
          {resendSeconds === 0 && !wrong ? t("mobile.auth.verify.resendReady") : ""}
        </Copy>
        {verifying && !wrong && <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.auth.common.emailHint")}</Copy>}
      </View>}
      {message && <StatusBanner state="not-sent" label={message} />}
      <View style={{ alignItems: "flex-start" }}>
        {verifying && !checking && <Button label={t("mobile.auth.verify.resend")} onPress={onResend} variant="quiet" disabled={!canResend} />}
        {!superseded && <Button label={locked ? t("mobile.auth.verify.differentEmail") : t("mobile.auth.verify.changeEmail")}
          onPress={onBack} variant="quiet" disabled={busy || checking} />}
        <Button label={t("mobile.auth.common.help")} onPress={onHelp} variant="quiet" />
      </View>
    </Screen>
  );
}
