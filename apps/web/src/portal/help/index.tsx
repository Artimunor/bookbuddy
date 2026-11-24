import { createJobsClient } from "@bookbuddy/api-client";
import { submitSupportRoute } from "@bookbuddy/api-contract";
import { createWebTranslator } from "@bookbuddy/i18n/web";
import { useMemo, useState, type FormEvent } from "react";
import { ActionLink, Button, Card, Dialog, TextField } from "../../ui";
import "../auth/styles.css";
import { useSession } from "../session";
import { usePendingOperation } from "../session/pending-operation";
import { supportIntent } from "../session/pending-storage";

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
  const [invalid, setInvalid] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const { submitSupport } = useMemo(() => createJobsClient(api), [api]);
  const command = usePendingOperation(supportIntent, submitSupport, receipt => {
    setMessage("");
    setEmail("");
    setReference(receipt.reference);
  }, undefined, { replay: true, allowAnonymous: true });
  const busy = command.state === "sending";
  const locked = busy || command.replacement !== null;
  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    const replyEmail = email.trim();
    const parsed = submitSupportRoute.input.safeParse({ body: {
      operationId: command.pending?.operationId ?? crypto.randomUUID(),
      payload: { kind: "access", message, ...(replyEmail ? { replyEmail } : {}) },
    } });
    setInvalid(!parsed.success);
    if (!parsed.success) return;
    if (command.canResend) command.resend(parsed.data.body);
    else command.start(parsed.data.body);
  }

  return <section aria-labelledby="help-contact" className="space-y-2">
    <h2 id="help-contact" className="text-section-title">{t("web.portal.help.contact")}</h2>
    {reference ? <Card><div role="status">
      <p>{t("web.portal.help.sent")}</p>
      <p>{t("web.portal.help.reference")}: <bdi dir="ltr">{reference}</bdi></p>
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
            onChange={event => { setMessage(event.target.value); setInvalid(false); }} />
        </label>
        <TextField label={t("web.portal.help.email")} type="email" autoComplete="email" dir="ltr" value={email} readOnly={locked}
          onChange={event => { setEmail(event.target.value); setInvalid(false); }} />
        {invalid && <p role="alert">{t("web.portal.help.invalid")}</p>}
        {!invalid && command.state === "failed" && <p role="alert">{t("web.portal.help.unavailable")}</p>}
        {command.canResend && !busy && <p role="status">{t("web.portal.help.uncertain")}</p>}
        <Button type="submit" pending={busy} disabled={locked || !message.trim()}>
          {command.canResend ? t("web.portal.help.sendAgain") : t("web.portal.help.send")}
        </Button>
      </form>
    </Card>}
    <Dialog open={command.replacement !== null} onOpenChange={open => { if (!open) command.replacement?.dismiss(); }}
      title={t("web.portal.help.sendChanged")} description={t("web.portal.help.sendChangedDetail")} closeLabel={t("web.portal.work.close")}
      footer={<Button onClick={command.replacement?.confirm}>{t("web.portal.ps.confirm")}</Button>}>{null}</Dialog>
  </section>;
}
