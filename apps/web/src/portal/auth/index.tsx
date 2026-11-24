import { emailStartRoute, type AccountSettingsPatch, type EmailAttempt, type RouteRequest, type SessionBootstrap } from "@bookbuddy/api-contract";
import { createWebTranslator } from "@bookbuddy/i18n/web";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { Button, Card, CodeField, SwitchRow, TextField } from "../../ui";
import { authClient, useSession } from "../session";
import "./styles.css";

type Device = Omit<RouteRequest<typeof emailStartRoute.input>["body"], "attemptId">;
type Challenge = { device: Device; attempt: EmailAttempt; offset: number };
let challenge: Challenge | null = null;
let emailDraft = "";
const deviceId = (() => {
  const fresh = crypto.randomUUID();
  try {
    const stored = localStorage.getItem("bookbuddy.otp-device-id.v1");
    if (stored && /^[a-z0-9-]{36}$/i.test(stored)) return stored;
    localStorage.setItem("bookbuddy.otp-device-id.v1", fresh);
  } catch { /* Storage may be unavailable; the ID is not a credential. */ }
  return fresh;
})();
function attemptToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function target(value: string | null) {
  return value && /^\/portal\/(?!sign-in(?:[/?#]|$)|verify(?:[/?#]|$)|setup(?:[/?#]|$))[^\\]*$/.test(value) ? value : "/portal/now";
}
function useDestination() {
  const [params] = useSearchParams();
  const next = target(params.get("next"));
  return { next, query: `?next=${encodeURIComponent(next)}` };
}
function useClock(deadline: number, offset = 0) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (deadline <= Date.now() + offset) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current + offset >= deadline) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadline, offset]);
  return Math.max(0, deadline - now - offset);
}
function useOffline() {
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return offline;
}
function Frame({ children }: { children: ReactNode }) {
  return <main className="auth-page"><div className="auth-brand">BookBuddy</div><div className="auth-panel">{children}</div></main>;
}
function viewerTime(locale: string, at: number) { return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(at); }
function unknown(error: { code: string; delivery?: string }) {
  return error.delivery === "unknown" || error.code === "INTERNAL_ERROR";
}

export function SignIn() {
  const { locale, status } = useSession();
  const offline = useOffline();
  const { t } = createWebTranslator(locale);
  const navigate = useNavigate();
  const { query } = useDestination();
  const [email, setEmail] = useState(emailDraft);
  const [error, setError] = useState<"invalid" | "uncertain" | "unavailable" | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const remaining = useClock(retryAt);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ attemptId: string; device: Device } | null>(null);
  const inFlight = useRef(false);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || remaining || offline || status === "loading") return;
    inFlight.current = true; setBusy(true);
    try {
      if (pending.current) {
        const result = await authClient.status(pending.current.attemptId);
        if (result.ok && result.data.state !== "invalidated" && result.data.state !== "consumed") {
          challenge = { device: pending.current.device, attempt: result.data, offset: result.meta.serverTime - Date.now() };
          pending.current = null; navigate(`/portal/verify${query}`);
        } else if (!result.ok && result.error.code === "NOT_FOUND" || result.ok) { pending.current = null; setError("unavailable"); }
        return;
      }
      const parsed = emailStartRoute.input.shape.body.shape.email.safeParse(email);
      if (!parsed.success) { setError("invalid"); return; }
      const device: Device = { email: parsed.data, deviceId, transport: "web" };
      const attemptId = attemptToken();
      const result = await authClient.start({ ...device, attemptId });
      if (result.ok) {
        challenge = { device, attempt: result.data, offset: result.meta.serverTime - Date.now() };
        emailDraft = email; navigate(`/portal/verify${query}`);
      } else if (unknown(result.error)) { pending.current = { device, attemptId }; setError("uncertain"); }
      else if (result.error.code === "RATE_LIMITED" && result.error.retryAt) { setRetryAt(result.error.retryAt); setError(null); }
      else if (result.error.code === "VALIDATION_FAILED") setError("invalid");
      else setError("unavailable");
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <Frame><h1>{t("web.portal.auth.emailTitle")}</h1><form onSubmit={send} noValidate>
    <TextField label={t("web.portal.auth.email")} hint={t("web.portal.auth.emailHint")} error={error === "invalid" ? t("web.portal.auth.invalidEmail") : undefined}
      type="email" autoComplete="email" dir="ltr" value={email} readOnly={!!pending.current} onChange={(event) => { setEmail(event.target.value); emailDraft = event.target.value; setError(null); }} />
    <Card>{t("web.portal.auth.roles")}</Card>
    {offline && <p role="status">{t("web.portal.auth.offline")}</p>}
    {remaining > 0 && <p role="status">{t("web.portal.auth.rate", { time: viewerTime(locale, retryAt) })}</p>}
    {error === "uncertain" && <p role="alert">{t("web.portal.auth.uncertain")}</p>}
    {error === "unavailable" && <p role="alert">{t("web.portal.auth.unavailable")}</p>}
    <Button type="submit" disabled={busy || offline || remaining > 0 || status === "loading"}>{pending.current ? t("web.portal.auth.check") : t("web.portal.auth.send")}</Button>
    <Link to={`/portal/help${query}`}>{t("web.portal.auth.help")}</Link>
  </form></Frame>;
}

type Pending = { kind: "verify"; operationId: string; code: string } | { kind: "resend" };
export function Verify() {
  const { locale, acceptBootstrap } = useSession();
  const offline = useOffline();
  const { t } = createWebTranslator(locale);
  const navigate = useNavigate();
  const { next, query } = useDestination();
  const [flow, setFlow] = useState(challenge);
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState<number | null>(null);
  const [issue, setIssue] = useState<"uncertain" | "unavailable" | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<Pending | null>(null);
  const inFlight = useRef(false);
  const field = useRef<HTMLDivElement>(null);
  const left = useClock(flow?.attempt.resendAt ?? 0, flow?.offset);
  const lockLeft = useClock(flow?.attempt.retryAt ?? 0, flow?.offset);
  const expires = useClock(flow?.attempt.expiresAt ?? 0, flow?.offset);
  useEffect(() => {
    if (wrong !== null && !busy) field.current?.querySelector("input")?.focus();
  }, [wrong, busy]);
  if (!flow) return <Navigate replace to={`/portal/sign-in${query}`} />;
  const current = flow;
  const locked = current.attempt.state === "locked" && lockLeft > 0;
  const expired = !expires || current.attempt.state === "expired";
  function adopt(attempt: EmailAttempt, serverTime: number) {
    const nextFlow = { ...current, attempt, offset: serverTime - Date.now() };
    challenge = nextFlow; setFlow(nextFlow);
  }
  async function run(action: "verify" | "resend" | "check") {
    if (inFlight.current || offline || action !== "check" && pending.current || action === "check" && !pending.current) return;
    inFlight.current = true; setBusy(true);
    try {
      if (pending.current?.kind === "resend" || action === "resend" && current.attempt.state === "locked" && !lockLeft) {
        const result = await authClient.status(current.attempt.attemptId);
        if (result.ok) { pending.current = null; adopt(result.data, result.meta.serverTime); setIssue(null); setCode(""); setWrong(null); }
        else setIssue("uncertain");
        return;
      }
      if (action === "resend") {
        if (left || locked) return;
        const result = await authClient.resend(current.attempt.attemptId, { operationId: crypto.randomUUID(), expectedRevision: current.attempt.generation, payload: current.device });
        if (result.ok) { adopt(result.data, result.meta.serverTime); setCode(""); setWrong(null); setIssue(null); }
        else if (result.error.code === "RATE_LIMITED" && result.error.retryAt) adopt({ ...current.attempt, resendAt: result.error.retryAt }, Date.now() + current.offset);
        else if (unknown(result.error) || result.error.code === "CONFLICT") { pending.current = { kind: "resend" }; setIssue("uncertain"); }
        else setIssue("unavailable");
        return;
      }
      const proof = pending.current?.kind === "verify" ? pending.current : { kind: "verify" as const, operationId: crypto.randomUUID(), code };
      if (!/^\d{6}$/.test(proof.code) || (!pending.current && (locked || expired))) return;
      const result = await authClient.verify(current.attempt.attemptId, { operationId: proof.operationId, payload: { ...current.device, code: proof.code } });
      if (result.ok) {
        pending.current = null; setIssue(null);
        if (result.data.status === "verified") {
          challenge = null; acceptBootstrap(result.data.session);
          navigate(result.data.session.setup === "required" ? `/portal/setup${query}` : next, { replace: true });
        } else if (result.data.status === "wrong_code") { setCode(""); setWrong(result.data.triesLeft); }
        else { setCode(""); adopt({ ...current.attempt, state: "expired" }, Date.now() + current.offset); }
      } else if (result.error.code === "RATE_LIMITED" && result.error.retryAt) {
        pending.current = null; setCode(""); adopt({ ...current.attempt, state: "locked", retryAt: result.error.retryAt }, Date.now() + current.offset);
      } else if (unknown(result.error) || pending.current && result.error.code === "UNAVAILABLE") { pending.current = proof; setIssue("uncertain"); }
      else { pending.current = null; setIssue("unavailable"); }
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <Frame><h1>{t("web.portal.auth.verifyTitle")}</h1><p>{t("web.portal.auth.sentTo", { email: current.device.email })}</p>
    {locked ? <><div className="auth-critical" role="alert">{t("web.portal.auth.locked", { time: viewerTime(locale, current.attempt.retryAt!) })}</div><Card>{t("web.portal.auth.unchanged")}</Card></> : <>
      <div ref={field} aria-live="polite"><CodeField label={t("web.portal.auth.code")} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
        error={wrong !== null ? t("web.portal.auth.wrong", { count: wrong }) : expired ? t("web.portal.auth.expired") : undefined} disabled={busy || !!pending.current || expired} /></div>
      <p>{left > 0 ? t("web.portal.auth.resendIn", { seconds: Math.ceil(left / 1000) }) : t("web.portal.auth.spam")}</p>
      <button className="auth-link" type="button" disabled={busy || offline || left > 0 || !!pending.current} onClick={() => void run("resend")}>{t("web.portal.auth.resend")}</button>
    </>}
    {issue && <p role="alert">{issue === "uncertain" ? t("web.portal.auth.uncertain") : t("web.portal.auth.unavailable")}</p>}
    {offline && <p role="status">{t("web.portal.auth.offline")}</p>}
    <Link to={`/portal/sign-in${query}`} onClick={() => { challenge = null; }}>{t("web.portal.auth.changeEmail")}</Link>
    <Link to={`/portal/help${query}`}>{t("web.portal.auth.help")}</Link>
    {pending.current ? <Button disabled={busy || offline} onClick={() => void run("check")}>{t("web.portal.auth.check")}</Button>
      : locked || current.attempt.state === "locked" ? <Button disabled={busy || offline || locked} onClick={() => void run("resend")}>{t("web.portal.auth.resend")}</Button>
        : <><p className="auth-context">{code.length !== 6 && !expired ? t("web.portal.auth.enterSix") : ""}</p><Button disabled={busy || offline || expired || code.length !== 6} onClick={() => void run("verify")}>{t("web.portal.auth.verify")}</Button></>}
  </Frame>;
}

const readingLanguages = ["en", "es", "de", "ro", "ar", "pt-PT"] as const;
export function Setup() {
  const { bootstrap, status, locale, acceptBootstrap, reload } = useSession();
  const { t } = createWebTranslator(locale);
  const { next, query } = useDestination();
  if (status === "loading") return <Frame><p role="status">{t("web.portal.auth.loading")}</p></Frame>;
  if (status === "error") return <Frame><p role="alert">{t("web.portal.auth.unavailable")}</p><Button onClick={reload}>{t("web.portal.auth.retry")}</Button></Frame>;
  if (!bootstrap) return <Navigate replace to={`/portal/sign-in${query}`} />;
  if (bootstrap.setup === "complete") return <Navigate replace to={next} />;
  return <SetupForm key={bootstrap.account.id} session={bootstrap} next={next} accept={acceptBootstrap} locale={locale} />;
}
function SetupForm({ session, next, accept, locale }: { session: SessionBootstrap; next: string; accept: (value: SessionBootstrap) => void; locale: "en" | "pt-PT" }) {
  const { t } = createWebTranslator(locale);
  const navigate = useNavigate();
  const offline = useOffline();
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const initialLanguage = typeof navigator === "undefined" ? "" : navigator.language;
  const matched = readingLanguages.find((tag) => tag.toLowerCase() === initialLanguage.toLowerCase() || tag.split("-")[0] === initialLanguage.split("-")[0]);
  const [name, setName] = useState(session.account.displayName ?? "");
  const [reading, setReading] = useState(session.preferences.readingLocale ?? matched ?? "");
  const [twoClock, setTwoClock] = useState(viewerZone !== "Europe/Madrid");
  const [issue, setIssue] = useState<"uncertain" | "unavailable" | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ operationId: string; expectedRevision: number; payload: AccountSettingsPatch } | null>(null);
  const inFlight = useRef(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || offline || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const command = pending.current ?? { operationId: crypto.randomUUID(), expectedRevision: session.preferences.revision,
        payload: { displayName: name.trim(), readingLocale: reading || null, twoClock } };
      const result = await authClient.patchSettings(command);
      if (result.ok) { pending.current = null; accept(result.data); navigate(next, { replace: true }); }
      else if (unknown(result.error) || pending.current && result.error.code === "UNAVAILABLE") { pending.current = command; setIssue("uncertain"); }
      else { pending.current = null; setIssue("unavailable"); }
    } finally { inFlight.current = false; setBusy(false); }
  }
  const time = (zone: string) => {
    const formatter = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: zone });
    return `${formatter.format(new Date(Date.UTC(2026, 10, 24, 8)))}–${formatter.format(new Date(Date.UTC(2026, 10, 24, 9)))}`;
  };
  const names = new Intl.DisplayNames([locale], { type: "language" });
  return <Frame><h1>{t("web.portal.auth.setupTitle")}</h1><form onSubmit={save}>
    <TextField label={t("web.portal.auth.name")} hint={t("web.portal.auth.nameHint")} value={name} maxLength={100} readOnly={!!pending.current} onChange={(event) => setName(event.target.value)} />
    <label className="auth-select">{t("web.portal.auth.reading")}<select value={reading} disabled={!!pending.current} onChange={(event) => setReading(event.target.value)}><option value="">{t("web.portal.auth.original")}</option>{readingLanguages.map((tag) => <option key={tag} value={tag}>{names.of(tag)}</option>)}</select></label>
    <p>{t("web.portal.auth.originalHint")}</p><Card><SwitchRow label={t("web.portal.auth.twoClock")} checked={twoClock} disabled={!!pending.current} onCheckedChange={setTwoClock} /><p>{t("web.portal.auth.example", { site: time("Europe/Madrid") })}</p>{twoClock && <p>{t("web.portal.auth.yourTime", { time: time(viewerZone) })}</p>}</Card>
    <p>{t("web.portal.auth.permissions")}</p>{offline && <p role="status">{t("web.portal.auth.offline")}</p>}{issue && <p role="alert">{issue === "uncertain" ? t("web.portal.auth.uncertain") : t("web.portal.auth.notSaved")}</p>}
    <Button type="submit" disabled={busy || offline || !name.trim()}>{pending.current ? t("web.portal.auth.check") : t("web.portal.auth.continue")}</Button>
  </form></Frame>;
}
