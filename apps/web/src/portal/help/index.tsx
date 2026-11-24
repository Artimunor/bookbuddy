import { createJobsClient } from "@bookbuddy/api-client";
import { submitSupportRoute } from "@bookbuddy/api-contract";
import { createWebTranslator } from "@bookbuddy/i18n/web";
import { useRef, useState, type FormEvent } from "react";
import { ActionLink, Button, Card, TextField } from "../../ui";
import "../auth/styles.css";
import { useSession } from "../session";

type Submission = { state: "editing" | "sending" | "invalid" | "unavailable" | "uncertain" } |
  { state: "sent"; reference: string };

export function Help() {
  const { bootstrap, locale, reload, status } = useSession();
  const { t } = createWebTranslator(locale);
  return <main id="main" className="auth-page">
    <div className="auth-brand">BookBuddy</div>
    <div className="auth-panel">
      <h1>{t("web.portal.help.title")}</h1>
      <Card title={t("web.portal.help.account")}><p>{t("web.portal.help.accountDetail")}</p></Card>
      <section aria-labelledby="help-options" className="space-y-2">
        <h2 id="help-options" className="text-section-title">{t("web.portal.help.options")}</h2>
        <Card title={t("web.portal.help.newLink")}><p>{t("web.portal.help.newLinkDetail")}</p></Card>
      </section>
      {status === "loading" ? <p role="status">{t("web.portal.auth.loading")}</p> : status === "error" ? <>
        <p role="alert">{t("web.portal.auth.unavailable")}</p>
        <Button variant="secondary" onClick={reload}>{t("web.portal.auth.retry")}</Button>
      </> : <SupportForm key={bootstrap ? `${bootstrap.sessionId}:${bootstrap.activeContext?.contextId ?? ""}` : "anonymous"} />}
      <ActionLink variant="text" to={bootstrap ? "/portal/now" : "/portal/sign-in"}>
        {bootstrap ? t("web.portal.help.backNow") : t("web.portal.help.backSignIn")}
      </ActionLink>
    </div>
  </main>;
}

function SupportForm() {
  const { api, bootstrap, locale } = useSession();
  const { t } = createWebTranslator(locale);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [submission, setSubmission] = useState<Submission>({ state: "editing" });
  const inFlight = useRef(false);
  const { state } = submission;
  const locked = state === "sending" || state === "uncertain" || state === "sent";

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || locked) return;
    const replyEmail = email.trim();
    const body = { operationId: crypto.randomUUID(), payload: { kind: "access" as const, message,
      ...(replyEmail ? { replyEmail } : {}) } };
    if (!submitSupportRoute.input.safeParse({ body }).success) { setSubmission({ state: "invalid" }); return; }
    inFlight.current = true;
    setSubmission({ state: "sending" });
    try {
      const result = await createJobsClient(api).submitSupport(body);
      if (result.ok) {
        setMessage(""); setEmail("");
        setSubmission({ state: "sent", reference: result.data.reference });
      } else {
        setSubmission({ state: result.error.code === "INTERNAL_ERROR" ||
          ("delivery" in result.error && result.error.delivery === "unknown") ? "uncertain" : "unavailable" });
      }
    } catch { setSubmission({ state: "uncertain" }); }
    finally { inFlight.current = false; }
  }

  return <section aria-labelledby="help-contact" className="space-y-2">
    <h2 id="help-contact" className="text-section-title">{t("web.portal.help.contact")}</h2>
    {submission.state === "sent" ? <Card><div role="status">
      <p>{t("web.portal.help.sent")}</p>
      <p>{t("web.portal.help.reference")}: <bdi dir="ltr">{submission.reference}</bdi></p>
    </div></Card> : <Card>
      <form onSubmit={send} noValidate>
        <div className="space-y-2">
          <p>{t("web.portal.help.formDetail")}</p>
          {bootstrap && <p>{t("web.portal.help.identity")}</p>}
          <p className="text-supporting text-muted">{t("web.portal.help.kind")}</p>
        </div>
        <label className="bb-field">
          <span className="text-label">{t("web.portal.help.message")}</span>
          <textarea className="bb-input" dir="auto" rows={4} maxLength={2000} value={message} readOnly={locked}
            onChange={event => { setMessage(event.target.value); setSubmission({ state: "editing" }); }} />
        </label>
        <TextField label={t("web.portal.help.email")} type="email" autoComplete="email" dir="ltr" value={email} readOnly={locked}
          onChange={event => { setEmail(event.target.value); setSubmission({ state: "editing" }); }} />
        {state === "invalid" && <p role="alert">{t("web.portal.help.invalid")}</p>}
        {state === "unavailable" && <p role="alert">{t("web.portal.help.unavailable")}</p>}
        {state === "uncertain" && <p role="alert">{t("web.portal.help.uncertain")}</p>}
        <Button type="submit" pending={state === "sending"} disabled={locked || !message.trim()}>{t("web.portal.help.send")}</Button>
      </form>
    </Card>}
  </section>;
}
