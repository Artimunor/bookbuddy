import type { QuoteVersion, QuoteVersionList } from "@bookbuddy/api-contract";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ActionLink, Badge, Button, Card, Dialog, Dock, QuoteTable, StatusBanner, TwinCard } from "../../ui";
import { Frame, money, usePortal } from "../now/common";
import { formatPortalTime } from "../time";

type QuoteData = Extract<QuoteVersion, { audience: "customer" }>;
type List = Extract<QuoteVersionList, { audience: "customer" }>;
type Pending = { operationId: string; action: "approve" | "decline"; termsHash: string; readingArtifactRef?: string };
type Outcome = "idle" | "processing" | "checking" | "failed" | "changed";
function pendingKey(account: string, job: string, version: string) { return `bookbuddy.quote-decision.v1:${account}:${job}:${version}`; }
function readPending(key: string): Pending | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (typeof item.operationId !== "string" || !/^[A-Za-z0-9_-]+$/.test(item.operationId) || (item.action !== "approve" && item.action !== "decline") || typeof item.termsHash !== "string" || (item.readingArtifactRef !== undefined && typeof item.readingArtifactRef !== "string")) return null;
    return { operationId: item.operationId, action: item.action, termsHash: item.termsHash, ...(typeof item.readingArtifactRef === "string" ? { readingArtifactRef: item.readingArtifactRef } : {}) };
  } catch { return null; }
}
function savePending(key: string, value: Pending | null) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
    return true;
  } catch { return false; }
}
export function Quote() {
  const { id = "", version = "" } = useParams();
  return <QuoteView key={`${id}:${version}`} id={id} version={version} />;
}
function QuoteView({ id, version }: { id: string; version: string }) {
  const { jobs, commercial, locale, account, preferences, t } = usePortal();
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [versions, setVersions] = useState<List | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [dialog, setDialog] = useState<"approve" | "decline" | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const pending = useRef<Pending | null>(null);
  const busy = useRef(false);
  const key = pendingKey(account?.id ?? "", id, version);
  const currentKey = useRef(key);
  currentKey.current = key;
  useEffect(() => {
    const controller = new AbortController();
    setQuote(null); setVersions(null); setLoadFailed(false); setDialog(null);
    pending.current = readPending(key); setOutcome(pending.current ? "checking" : "idle");
    void Promise.all([commercial.listQuoteVersions(id, {}, { signal: controller.signal }), commercial.getQuoteVersion(id, version, { signal: controller.signal })]).then(([list, detail]) => {
      if (controller.signal.aborted) return;
      if (list.ok && list.data.audience === "customer" && detail.ok && detail.data.audience === "customer") {
        setVersions(list.data); setQuote(detail.data);
        if (pending.current && detail.data.decision && ((pending.current.action === "approve" && detail.data.decision.decision === "approve") || (pending.current.action === "decline" && detail.data.decision.decision === "decline"))) {
          pending.current = null; savePending(key, null); setOutcome("idle");
        }
      } else setLoadFailed(true);
    });
    return () => controller.abort();
  }, [id, version, key, commercial, generation]);
  async function decide(action: "approve" | "decline") {
    if (!quote || busy.current || pending.current || !quote.actions[action]) return;
    const operation: Pending = { operationId: crypto.randomUUID(), action, termsHash: quote.terms.hash,
      ...(quote.readingAid.status === "ready" ? { readingArtifactRef: quote.readingAid.ref } : {}) };
    if (!savePending(key, operation)) { setOutcome("failed"); return; }
    pending.current = operation; busy.current = true; setOutcome("processing");
    const body = { operationId: operation.operationId, payload: { termsHash: operation.termsHash, ...(operation.readingArtifactRef ? { readingArtifactRef: operation.readingArtifactRef } : {}) } };
    const result = action === "approve" ? await commercial.approveQuoteVersion(version, body) : await commercial.declineQuoteVersion(version, body);
    busy.current = false;
    if (currentKey.current !== key) {
      if (result.ok || !("delivery" in result.error && result.error.delivery === "unknown") && result.error.code !== "INTERNAL_ERROR") savePending(key, null);
      return;
    }
    if (result.ok) { setQuote(result.data); pending.current = null; savePending(key, null); setOutcome("idle"); setDialog(null); }
    else if (("delivery" in result.error && result.error.delivery === "unknown") || result.error.code === "INTERNAL_ERROR") setOutcome("checking");
    else { pending.current = null; savePending(key, null); setOutcome(result.error.code === "CONFLICT" || result.error.code === "STALE_REVISION" ? "changed" : "failed"); }
  }
  async function check() {
    const operation = pending.current;
    if (!operation || busy.current) return;
    busy.current = true; setOutcome("processing");
    const receipt = await jobs.getOperation(operation.operationId);
    if (currentKey.current !== key) { busy.current = false; return; }
    if (receipt.ok) {
      const detail = await commercial.getQuoteVersion(id, version);
      if (currentKey.current !== key) { busy.current = false; return; }
      if (detail.ok && detail.data.audience === "customer" && detail.data.decision?.decision === operation.action) {
        setQuote(detail.data); pending.current = null; savePending(key, null); setOutcome("idle");
      } else setOutcome("checking");
    } else setOutcome("checking");
    busy.current = false;
  }
  const amount = quote ? money(locale, quote.totalMinor, quote.currency) : "";
  const reading = quote?.readingAid;
  const status = quote?.state === "approved" ? t("web.portal.work.approved") : quote?.state === "declined" ? t("web.portal.work.declined") : quote?.state === "expired" ? t("web.portal.work.expired") : quote?.state === "superseded" ? t("web.portal.work.replaced") : quote?.state === "withdrawn" ? t("web.portal.work.withdrawn") : t("web.portal.work.current");
  const blocked = outcome === "processing" || outcome === "checking" || outcome === "changed";
  const viewerZone = preferences?.twoClock ? preferences.displayZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const sentClock = quote ? formatPortalTime(quote.issuedAt, quote.job.siteZone, locale, viewerZone) : null;
  const expiryClock = quote ? formatPortalTime(quote.expiresAt, quote.job.siteZone, locale, viewerZone) : null;
  const decisionClock = quote?.decision ? formatPortalTime(quote.decision.at, quote.job.siteZone, locale, viewerZone) : null;
  return <Frame><Link to={`/portal/jobs/${encodeURIComponent(id)}`}>{t("web.portal.work.untitled")}</Link>
    {!quote && !loadFailed && <p role="status">{t("web.portal.work.loading")}</p>}
    {loadFailed && <StatusBanner title={t("web.portal.work.failed")} tone="critical" action={<Button onClick={() => setGeneration((n) => n + 1)}>{t("web.portal.work.retry")}</Button>} />}
    {quote && <><header><h1 className="text-page-title">{t("web.portal.work.quote")}</h1><p>{quote.job.jobTitle} · {quote.job.reference} · {quote.job.placeAlias}</p></header>
      {outcome === "processing" && <StatusBanner title={t("web.portal.work.processing")} announce="polite" />}
      {outcome === "checking" && <StatusBanner title={t("web.portal.work.checking")} tone="attention" announce="polite" action={<Button onClick={check}>{t("web.portal.work.checkAgain")}</Button>} />}
      {outcome === "changed" && <StatusBanner title={t("web.portal.work.changed")} tone="attention" announce="polite" />}
      {outcome === "failed" && <StatusBanner title={t("web.portal.work.notRecorded")} tone="critical" announce="assertive" />}
      {!quote.viewerIsNamedApprover && <StatusBanner title={t("web.portal.work.notApprover")} />}
      <Card><div className="space-y-3"><p>{quote.job.providerDisplayName}</p><Badge label={`${t("web.portal.work.version", { version: quote.no })} · ${status}`} tone={quote.state === "approved" ? "success" : "neutral"} /><p className="text-page-title"><bdi>{amount}</bdi></p><p>{t("web.portal.work.sent", { name: quote.publisherDisplayName, date: sentClock?.site ?? "" })}{sentClock?.viewer && <><br />{sentClock.viewer}</>}</p><p>{t("web.portal.work.expiry", { date: expiryClock?.site ?? "" })}{expiryClock?.viewer && <><br />{expiryClock.viewer}</>}</p>{quote.decision && <p>{t("web.portal.work.decision", { decision: quote.decision.decision === "approve" ? t("web.portal.work.approved") : t("web.portal.work.declined"), name: quote.decision.actorDisplayName, date: decisionClock?.site ?? "" })}{decisionClock?.viewer && <><br />{decisionClock.viewer}</>}</p>}</div></Card>
      <QuoteTable caption={t("web.portal.work.items")} labels={{ item: t("web.portal.work.item"), quantity: t("web.portal.work.quantity"), amount: t("web.portal.work.amount"), missing: "—" }} lines={quote.items.map((item) => { const translated = reading?.status === "ready" ? reading.items.find((entry) => entry.lineNo === item.lineNo)?.label : undefined; return { id: String(item.lineNo), label: translated ?? item.originalLabel, ...(translated ? { description: { text: item.originalLabel, lang: quote.originalLocale } } : {}), current: { quantity: String(item.quantity), amount: money(locale, item.netMinor + item.taxMinor, quote.currency) } }; })} totals={[{ id: "total", label: t("web.portal.work.total"), current: amount, emphasis: true }]} />
      <TwinCard title={t("web.portal.work.scope")} original={{ text: quote.scope, lang: quote.originalLocale }} reading={reading?.status === "ready" ? { state: "translated", passage: { text: reading.scope, lang: reading.locale }, originalLabel: t("web.portal.work.original"), translationLabel: t("web.portal.work.translation") } : reading?.status === "pending" || reading?.status === "unavailable" ? { state: reading.status, label: t("web.portal.work.translationPending") } : { state: "original" }} />
      {quote.exclusions && <TwinCard title={t("web.portal.work.exclusions")} original={{ text: quote.exclusions, lang: quote.originalLocale }} reading={reading?.status === "ready" && reading.exclusions ? { state: "translated", passage: { text: reading.exclusions, lang: reading.locale }, originalLabel: t("web.portal.work.original"), translationLabel: t("web.portal.work.translation") } : { state: "original" }} />}
      <Card title={t("web.portal.work.terms")}><p lang={quote.terms.contractLocale} dir="auto">{quote.terms.originalText}</p></Card>
      {versions && versions.versions.length > 1 && <Card title={t("web.portal.work.versions")}><ul>{versions.versions.map((item) => <li key={item.id}><Link to={`/portal/jobs/${encodeURIComponent(id)}/quote/${encodeURIComponent(item.id)}`}>{t("web.portal.work.version", { version: item.no })}</Link></li>)}</ul></Card>}
      {quote.replacedBy && <ActionLink to={`/portal/jobs/${encodeURIComponent(id)}/quote/${encodeURIComponent(quote.replacedBy.id)}`}>{t("web.portal.work.viewCurrent")}</ActionLink>}
      {quote.actions.decline && !blocked && <Button variant="text" onClick={() => setDialog("decline")}>{t("web.portal.work.decline")}</Button>}
      {(quote.actions.approve || (!quote.viewerIsNamedApprover && quote.state === "issued")) && <Dock context={!quote.viewerIsNamedApprover ? t("web.portal.work.notApprover") : undefined} primary={{ label: t("web.portal.work.reviewApprove"), onClick: () => setDialog("approve"), disabled: blocked || !quote.actions.approve }} />}
      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }} title={dialog === "decline" ? t("web.portal.work.declineTitle") : t("web.portal.work.approveTitle")} closeLabel={t("web.portal.work.close")} footer={dialog && <Button disabled={blocked || !quote.actions[dialog] || (typeof navigator !== "undefined" && !navigator.onLine)} pending={outcome === "processing"} onClick={() => void decide(dialog)}>{dialog === "approve" ? t("web.portal.work.approveAmount", { amount }) : t("web.portal.work.decline")}</Button>}>
        <div className="space-y-3"><p>{quote.job.reference} · {quote.job.jobTitle} · {quote.job.placeAlias}</p><p>{t("web.portal.work.approver", { name: quote.job.namedApproverDisplayName })}</p><p>{t("web.portal.work.version", { version: quote.no })} · {quote.job.providerDisplayName} · <bdi>{amount}</bdi></p><p>{dialog === "decline" ? t("web.portal.work.declineEffect") : t("web.portal.work.effect")}</p>{dialog === "approve" && <p lang={quote.terms.contractLocale} dir="auto">{quote.terms.consentText}</p>}</div>
      </Dialog>
    </>}
  </Frame>;
}
