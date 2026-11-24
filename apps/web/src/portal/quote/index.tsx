import type { QuoteVersion, QuoteVersionList } from "@bookbuddy/api-contract";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ActionLink, Badge, Button, Card, Dialog, Dock, QuoteTable, StatusBanner, TwinCard } from "../../ui";
import { jobTitle, Frame, money, usePortal } from "../now/common";
import { usePendingOperation } from "../session/pending-operation";
import { PendingReceiptNotice } from "../session/pending-receipt";
import { formatPortalTime } from "../time";

type QuoteData = Extract<QuoteVersion, { audience: "customer" }>;
type List = Extract<QuoteVersionList, { audience: "customer" }>;
type Pending = { operationId: string; action: "approve" | "decline"; termsHash: string; readingArtifactRef?: string };
export function Quote() {
  const { id = "", version = "" } = useParams();
  return <QuoteView key={`${id}:${version}`} id={id} version={version} />;
}
function QuoteView({ id, version }: { id: string; version: string }) {
  const { commercial, locale, bootstrap, activeContext, preferences, t } = usePortal();
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [versions, setVersions] = useState<List | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [dialog, setDialog] = useState<"approve" | "decline" | null>(null);
  const [changed, setChanged] = useState(false);
  const command = usePendingOperation<Pending, QuoteData>(
    `quote:${id}:${version}`, input => `POST /quote-versions/:id/${input.action}`,
    input => {
      const { operationId, termsHash, readingArtifactRef } = input;
      const body = { operationId, payload: { termsHash, ...(readingArtifactRef ? { readingArtifactRef } : {}) } };
      return input.action === "approve" ? commercial.approveQuoteVersion(version, body) : commercial.declineQuoteVersion(version, body);
    },
    value => { setQuote(value); setDialog(null); },
    code => setChanged(code === "CONFLICT" || code === "STALE_REVISION"),
    { onCommitted: () => {
      setQuote(null); setDialog(null);
      void commercial.getQuoteVersion(id, version).then(result => {
        if (result.ok && result.data.audience === "customer") setQuote(result.data); else setLoadFailed(true);
      });
    } },
  );
  const outcome = changed ? "changed" : command.state === "sending" ? "processing" : command.state;
  useEffect(() => { if (outcome === "checking" || outcome === "failed" || outcome === "changed") setDialog(null); }, [outcome]);
  useEffect(() => {
    const controller = new AbortController();
    setQuote(null); setVersions(null); setLoadFailed(false); setDialog(null);
    setChanged(false);
    void Promise.all([commercial.listQuoteVersions(id, {}, { signal: controller.signal }), commercial.getQuoteVersion(id, version, { signal: controller.signal })]).then(([list, detail]) => {
      if (controller.signal.aborted) return;
      if (list.ok && list.data.audience === "customer" && detail.ok && detail.data.audience === "customer") {
        setVersions(list.data); setQuote(detail.data);
      } else setLoadFailed(true);
    });
    return () => controller.abort();
  }, [id, version, bootstrap?.sessionId, activeContext?.contextId, commercial, generation]);
  function decide(action: Pending["action"]) {
    if (!quote?.actions[action]) return;
    command.start({ operationId: crypto.randomUUID(), action, termsHash: quote.terms.hash,
      ...(quote.readingAid.status === "ready" ? { readingArtifactRef: quote.readingAid.ref } : {}) });
  }
  const amount = quote ? money(locale, quote.totalMinor, quote.currency) : "";
  const reading = quote?.readingAid;
  const status = quote?.state === "approved" ? t("web.portal.work.approved") : quote?.state === "declined" ? t("web.portal.work.declined") : quote?.state === "expired" ? t("web.portal.work.expired") : quote?.state === "superseded" ? t("web.portal.work.replaced") : quote?.state === "withdrawn" ? t("web.portal.work.withdrawn") : t("web.portal.work.current");
  const blocked = outcome === "processing" || outcome === "checking" || outcome === "changed";
  const viewerZone = preferences?.twoClock ? preferences.displayZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const sentClock = quote ? formatPortalTime(quote.issuedAt, quote.job.siteZone, locale, viewerZone) : null;
  const expiryClock = quote ? formatPortalTime(quote.expiresAt, quote.job.siteZone, locale, viewerZone) : null;
  const decisionClock = quote?.decision ? formatPortalTime(quote.decision.at, quote.job.siteZone, locale, viewerZone) : null;
  return <Frame><Link to={`/portal/jobs/${encodeURIComponent(id)}`}>{t("web.portal.closeout.back")}</Link>
    {!quote && !loadFailed && <p role="status">{t("web.portal.work.loading")}</p>}
    {loadFailed && <StatusBanner title={t("web.portal.work.failed")} tone="critical" action={<Button onClick={() => setGeneration((n) => n + 1)}>{t("web.portal.work.retry")}</Button>} />}
      {outcome === "processing" && <StatusBanner title={t("web.portal.work.processing")} announce="polite" />}
      {outcome === "checking" && <StatusBanner title={t("web.portal.work.checking")} tone="attention" announce="polite" action={<Button onClick={command.check}>{t("web.portal.work.checkAgain")}</Button>} />}
      {outcome === "changed" && <StatusBanner title={t("web.portal.work.changed")} tone="attention" announce="polite" />}
      {outcome === "failed" && <StatusBanner title={t("web.portal.work.notRecorded")} tone="critical" announce="assertive" />}
      <PendingReceiptNotice state={command.state} />
    {quote && <><header className="space-y-1"><h1 className="text-page-title">{t("web.portal.work.quote")}</h1><p className="text-supporting text-muted" dir="auto">{[jobTitle(t,quote.job.jobTitle,quote.job.reference),quote.job.reference,quote.job.placeAlias].filter(Boolean).join(" · ")}</p></header>
      {!quote.viewerIsNamedApprover && <StatusBanner title={t("web.portal.work.notApprover")} />}
      <Card><div className="space-y-3"><p>{quote.job.providerDisplayName}</p><Badge label={`${t("web.portal.work.version", { version: quote.no })} · ${status}`} tone={quote.state === "approved" ? "success" : "neutral"} /><p className="text-page-title"><bdi>{amount}</bdi></p><p>{t("web.portal.work.sent", { name: quote.publisherDisplayName, date: sentClock?.site ?? "" })}{sentClock?.viewer && <><br />{sentClock.viewer}</>}</p><p>{t("web.portal.work.expiry", { date: expiryClock?.site ?? "" })}{expiryClock?.viewer && <><br />{expiryClock.viewer}</>}</p>{quote.decision && <p>{t("web.portal.work.decision", { decision: quote.decision.decision === "approve" ? t("web.portal.work.approved") : t("web.portal.work.declined"), name: quote.decision.actorDisplayName, date: decisionClock?.site ?? "" })}{decisionClock?.viewer && <><br />{decisionClock.viewer}</>}</p>}</div></Card>
      <QuoteTable caption={t("web.portal.work.items")} labels={{ item: t("web.portal.work.item"), quantity: t("web.portal.work.quantity"), amount: t("web.portal.work.amount"), missing: "—" }} lines={quote.items.map((item) => { const translated = reading?.status === "ready" ? reading.items.find((entry) => entry.lineNo === item.lineNo)?.label : undefined; return { id: String(item.lineNo), label: translated ?? item.originalLabel, ...(translated ? { description: { text: item.originalLabel, lang: quote.originalLocale } } : {}), current: { quantity: String(item.quantity), amount: money(locale, item.netMinor + item.taxMinor, quote.currency) } }; })} totals={[{ id: "total", label: t("web.portal.work.total"), current: amount, emphasis: true }]} />
      <TwinCard title={t("web.portal.work.scope")} original={{ text: quote.scope, lang: quote.originalLocale }} reading={reading?.status === "ready" ? { state: "translated", passage: { text: reading.scope, lang: reading.locale }, originalLabel: t("web.portal.work.original"), translationLabel: t("web.portal.work.translation") } : reading?.status === "pending" || reading?.status === "unavailable" ? { state: reading.status, label: t("web.portal.work.translationPending") } : { state: "original" }} />
      {quote.exclusions && <TwinCard title={t("web.portal.work.exclusions")} original={{ text: quote.exclusions, lang: quote.originalLocale }} reading={reading?.status === "ready" && reading.exclusions ? { state: "translated", passage: { text: reading.exclusions, lang: reading.locale }, originalLabel: t("web.portal.work.original"), translationLabel: t("web.portal.work.translation") } : { state: "original" }} />}
      <Card title={t("web.portal.work.terms")}><p lang={quote.terms.contractLocale} dir="auto">{quote.terms.originalText}</p></Card>
      {versions && versions.versions.length > 1 && <Card title={t("web.portal.work.versions")}><ul>{versions.versions.map((item) => <li key={item.id}><Link to={`/portal/jobs/${encodeURIComponent(id)}/quote/${encodeURIComponent(item.id)}`}>{t("web.portal.work.version", { version: item.no })}</Link></li>)}</ul></Card>}
      {quote.replacedBy && <ActionLink variant={quote.actions.approve ? "secondary" : "primary"} to={`/portal/jobs/${encodeURIComponent(id)}/quote/${encodeURIComponent(quote.replacedBy.id)}`}>{t("web.portal.work.viewCurrent")}</ActionLink>}
      {(quote.actions.approve || (!quote.viewerIsNamedApprover && quote.state === "issued")) ? <Dock
        context={!quote.viewerIsNamedApprover ? t("web.portal.work.notApprover") : undefined}
        primary={{ label:t("web.portal.work.reviewApprove"), onClick:()=>setDialog("approve"), disabled:blocked || !quote.actions.approve }}
        secondary={quote.actions.decline && !blocked ? { label:t("web.portal.work.decline"), onClick:()=>setDialog("decline") } : undefined} />
        : quote.actions.decline && !blocked && <Button variant="text" onClick={()=>setDialog("decline")}>{t("web.portal.work.decline")}</Button>}
      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }} title={dialog === "decline" ? t("web.portal.work.declineTitle") : t("web.portal.work.approveTitle")} closeLabel={t("web.portal.work.close")} footer={dialog && <Button disabled={blocked || !quote.actions[dialog] || (typeof navigator !== "undefined" && !navigator.onLine)} pending={outcome === "processing"} onClick={() => void decide(dialog)}>{dialog === "approve" ? t("web.portal.work.approveAmount", { amount }) : t("web.portal.work.decline")}</Button>}>
        <div className="space-y-3"><p>{quote.job.reference} · {jobTitle(t,quote.job.jobTitle,quote.job.reference)} · {quote.job.placeAlias}</p><p>{t("web.portal.work.approver", { name: quote.job.namedApproverDisplayName })}</p><p>{t("web.portal.work.version", { version: quote.no })} · {quote.job.providerDisplayName} · <bdi>{amount}</bdi></p><p>{dialog === "decline" ? t("web.portal.work.declineEffect") : t("web.portal.work.effect")}</p>{dialog === "approve" && <p lang={quote.terms.contractLocale} dir="auto">{quote.terms.consentText}</p>}</div>
      </Dialog>
    </>}
  </Frame>;
}
