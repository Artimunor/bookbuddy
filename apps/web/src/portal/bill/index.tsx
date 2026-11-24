import { getJobBillRoute, type BillProjection, type LinkOpening } from "@bookbuddy/api-contract";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { Badge, Button, Card, Dock, Stamp } from "../../ui";
import { jobTitle, Frame, money, PortalClock, usePortalViewerZone } from "../now/common";
import { takeCheckedOpening } from "../notifications/handoff";
import { useCloseout, useScopeKey } from "../completion/common";

type CustomerBill = Extract<BillProjection, { audience: "customer" }>;
export function Bill() { const { id = "" } = useParams(); const scope = useScopeKey(); return <BillPage key={`${scope}:${id}`} id={id} />; }
function BillPage({ id }: { id: string }) {
  const { api, t, locale, bootstrap, activeContext } = useCloseout(); const location = useLocation(); const opening = useRef<{ key: string; state: unknown; value: LinkOpening | null } | null>(null); const [data, setData] = useState<CustomerBill | null>(null); const [error, setError] = useState(false); const [generation, setGeneration] = useState(0); const [copied, setCopied] = useState(false);
  const viewerZone = usePortalViewerZone();
  useEffect(() => { const controller = new AbortController(); setData(null); setError(false); const key = `${bootstrap?.sessionId ?? ""}:${activeContext?.contextId ?? ""}:${id}:${locale}`; if (!opening.current || opening.current.key !== key || opening.current.state !== location.state) opening.current = { key, state: location.state, value: takeCheckedOpening(location.state, bootstrap?.sessionId, activeContext?.contextId ?? null) }; const checked = opening.current.value; if (generation === 0 && checked?.kind === "bill" && checked.bill.audience === "customer" && checked.bill.job.jobId === id) { setData(checked.bill); return () => controller.abort(); } void api.request(getJobBillRoute, { params: { j: id } }, { signal: controller.signal }).then(result => { if (controller.signal.aborted) return; if (result.ok && result.data.audience === "customer" && result.data.job.jobId === id) setData(result.data); else setError(true); }); return () => controller.abort(); }, [api, id, locale, generation, location.state, bootstrap?.sessionId, activeContext?.contextId]);
  async function fresh(action: "copy" | "open") { if (!data?.bill || !navigator.onLine) return; const result = await api.request(getJobBillRoute, { params: { j: id } }); if (!result.ok || result.data.audience !== "customer" || result.data.bill?.id !== data.bill.id) { setError(true); setData(null); return; } const bill = result.data.bill; setData(result.data); if (action === "copy" && bill.outcome.status === "due" && bill.paymentInstructions) { try { await navigator.clipboard.writeText(bill.paymentInstructions.reference); setCopied(true); } catch { setCopied(false); } } if (action === "open" && bill.documentUrl) window.open(bill.documentUrl, "_blank", "noopener,noreferrer"); }
  const bill = data?.bill;
  const askBill = bill ? { to: `/portal/jobs/${encodeURIComponent(id)}/cases/new?category=bill&billId=${encodeURIComponent(bill.id)}`, label: t("web.portal.closeout.askBill") } : null;
  return <Frame><Link to={`/portal/jobs/${encodeURIComponent(id)}`}>{t("web.portal.closeout.back")}</Link><h1 className="text-page-title">{t("web.portal.closeout.bill")}</h1>{!data && (error ? <><p role="alert">{t("web.portal.closeout.unavailable")}</p><Button onClick={() => setGeneration(n => n + 1)}>{t("web.portal.closeout.retry")}</Button></> : <p role="status">{t("web.portal.closeout.loading")}</p>)}
  {data && <><p className="text-supporting text-muted" dir="auto">{[data.job.reference,jobTitle(t,data.job.title,data.job.reference),data.job.placeAlias].filter(Boolean).join(" · ")}</p>
  {!bill ? <Card>{t("web.portal.closeout.noBill", { provider: data.job.providerDisplayName })}</Card> : <>
  <Card><div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-label" dir="auto">{data.job.providerDisplayName}</p><Badge tone={bill.outcome.status === "paid" ? "success" : bill.outcome.status === "checking" ? "attention" : "neutral"} label={bill.outcome.status === "paid" ? t("web.portal.closeout.paid") : bill.outcome.status === "checking" ? t("web.portal.closeout.transfer") : t("web.portal.closeout.due")} /></div>
    <p className="text-display tabular-nums"><bdi>{money(locale, bill.totalMinor, bill.currency)}</bdi></p>
    <p className="text-supporting text-muted"><bdi>{bill.number}</bdi></p>
    <dl className="bb-inset-list">
      <div className="bb-detail-row"><dt>{t("web.portal.closeout.billIssued")}</dt><dd><PortalClock at={bill.issuedAt} zone={data.job.siteZone} locale={locale} viewerZone={viewerZone} /></dd></div>
      <div className="bb-detail-row"><dt>{t("web.portal.closeout.billDueDate")}</dt><dd><PortalClock at={bill.dueAt} zone={data.job.siteZone} locale={locale} viewerZone={viewerZone} /></dd></div>
    </dl>
    {bill.matchesApprovedScope && <p className="text-supporting text-muted">{t("web.portal.closeout.matches")}</p>}
    {bill.openCases.map(item => <p key={item.id}><Link to={`/portal/jobs/${encodeURIComponent(id)}/cases/${encodeURIComponent(item.id)}`}>{t("web.portal.closeout.caseOpen", { reference: item.reference })}</Link></p>)}
  </div></Card>
  <Card title={t("web.portal.closeout.lines")}><ul className="bb-inset-list">{bill.lines.map(line => <li key={line.lineNo}>
    <p className="bb-detail-row"><span dir="auto">{line.labelReading?.status === "ready" ? line.labelReading.text : line.originalLabel}</span><bdi className="text-label tabular-nums">{money(locale, line.netMinor + line.taxMinor, bill.currency)}</bdi></p>
    {line.labelReading?.status === "ready" && <div className="bb-twin-original mt-2 rounded-xl"><p className="text-supporting text-muted">{t("web.portal.closeout.original", { language: line.originalLanguage })}</p><p lang={line.originalLanguage} dir="auto">{line.originalLabel}</p></div>}
  </li>)}</ul></Card>
  {bill.outcome.status === "due" && bill.paymentInstructions && <Card title={t("web.portal.closeout.payDirect", { provider: data.job.providerDisplayName })}><p lang={bill.paymentInstructions.instructions.language} dir="auto">{bill.paymentInstructions.instructions.text}</p><p>{t("web.portal.closeout.reference", { reference: bill.paymentInstructions.reference })}</p><Button variant="text" onClick={() => void fresh("copy")}>{t("web.portal.closeout.copy")}</Button>{copied && <p role="status">{t("web.portal.closeout.copied")}</p>}</Card>}{bill.outcome.status === "checking" && <Card>{t("web.portal.closeout.transfer")}</Card>}{bill.outcome.status === "paid" && <Card title={t("web.portal.closeout.jobComplete")}><p>{t("web.portal.closeout.providerStatement")}</p></Card>}
  {bill.outcome.status === "due" && bill.state === "issued" && !bill.paymentInstructions && !bill.activeDeferral &&
    <Card title={t("web.portal.closeout.payDirect", { provider: data.job.providerDisplayName })}>
      <p>{t("web.portal.closeout.payUsingBill", { reference: bill.number })}</p>
    </Card>}
  {bill.history.length > 0 && <Card title={t("web.portal.closeout.paymentRecord")}><ol className="bb-moments">{bill.history.map(stamp => {
    const title = stamp.kind === "matched" ? t("web.portal.closeout.markedPaid") : stamp.kind === "no_funds_received" ? t("web.portal.closeout.noFunds") : stamp.kind === "refund_recorded" ? t("web.portal.closeout.refund") : t("web.portal.closeout.transfer");
    return <li key={stamp.id}><Stamp kind="decision"
      title={stamp.kind === "matched" && stamp.corrected ? `${title} · ${t("web.portal.closeout.corrected")}` : title}
      actor={{ name: stamp.actorDisplayName, role: t("web.portal.closeout.providerAdmin") }}
      time={<PortalClock at={stamp.at} zone={data.job.siteZone} locale={locale} viewerZone={viewerZone} />} />
      {"reason" in stamp && stamp.reason && <p dir="auto">{stamp.reason}</p>}
    </li>;
  })}</ol></Card>}
  </>}{data.priorBills.map(prior => <p key={prior.id}>{t("web.portal.closeout.replaced", { number: prior.number })}</p>)}
  {askBill && <Dock primary={bill?.documentUrl ? { label: t("web.portal.closeout.openBill"), onClick: () => void fresh("open") } : askBill} secondary={bill?.documentUrl ? askBill : undefined} />}
  </>}
  </Frame>;
}
