import type { ContractNotice, ContractNoticeReceipt, QuoteVersion } from "@bookbuddy/api-contract";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Button, Card, Dialog, StatusBanner } from "../../ui";
import { Frame, usePortal } from "../now/common";
import { formatPortalTime } from "../time";
import { usePendingOperation } from "../session/pending-operation";
import { PendingReceiptNotice } from "../session/pending-receipt";
import { useWindows } from "../windows/common";

export function Withdrawal() {
  const { id = "" } = useParams(); const { t, locale, account, commercial, bootstrap, activeContext } = usePortal(); const { data, failed, refresh } = useWindows(id);
  const [quote,setQuote] = useState<Extract<QuoteVersion,{audience:"customer"}> | null>(null); const [quoteFailed,setQuoteFailed] = useState(false); const [dialog,setDialog] = useState(false);
  const [receipt,setReceipt] = useState<ContractNoticeReceipt | null>(null);
  const [sentNotice,setSentNotice] = useState<{ text: string; locale: string } | null>(null);
  const [notices,setNotices] = useState<ContractNotice[] | null>(null); const [noticesFailed,setNoticesFailed] = useState(false); const [noticeGeneration,setNoticeGeneration] = useState(0);
  useEffect(()=>{const controller=new AbortController();setNotices(null);setNoticesFailed(false);void commercial.listContractNotices(id,{signal:controller.signal}).then(r=>{if(controller.signal.aborted)return;if(r.ok)setNotices(r.data.notices);else setNoticesFailed(true);});return()=>controller.abort();},[commercial,id,noticeGeneration,bootstrap?.sessionId,activeContext?.contextId]);
  useEffect(()=>{setReceipt(null);setSentNotice(null);},[id, bootstrap?.sessionId, activeContext?.contextId]);
  useEffect(()=>{ if (!data?.withdrawalQuoteVersionId) { setQuote(null); return; } const controller=new AbortController(); setQuote(null); setQuoteFailed(false); void commercial.getQuoteVersion(id,data.withdrawalQuoteVersionId,{signal:controller.signal}).then(r=>{if(controller.signal.aborted)return; if(r.ok && r.data.audience === "customer") setQuote(r.data); else setQuoteFailed(true);}); return ()=>controller.abort(); },[id,data?.withdrawalQuoteVersionId,commercial]);
  const command=usePendingOperation(`withdrawal:${id}`, "POST /jobs/:j/contract/withdrawal", (p:{operationId:string;quoteVersionId:string;termsHash:string;noticeText:string;noticeLocale:string})=>commercial.withdrawContract(id,{operationId:p.operationId,payload:{quoteVersionId:p.quoteVersionId,termsHash:p.termsHash,noticeText:p.noticeText,noticeLocale:p.noticeLocale}}), (value, input)=>{setReceipt(value);setSentNotice({text:input.noticeText,locale:input.noticeLocale});setDialog(false);setNoticeGeneration(n=>n+1);}, undefined, {
    resourceIds: input => [input.quoteVersionId],
    onCommitted: () => { setNotices(null); setDialog(false); setNoticeGeneration(n => n + 1); },
  });
  useEffect(() => { if (command.state === "checking" || command.state === "failed") setDialog(false); }, [command.state]);
  const busy=command.state === "checking" || command.state === "sending";
  const noticeText=t("web.portal.schedule.noticeStatement");
  const viewerZone=bootstrap?.preferences.twoClock ? bootstrap.preferences.displayZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const withdrawalNotices=notices?.filter(n=>n.kind==="withdrawal") ?? [];
  const receipts: ContractNoticeReceipt[] = receipt && !withdrawalNotices.some(n=>n.id===receipt.id) ? [receipt,...withdrawalNotices] : withdrawalNotices;
  return <Frame><Link to={`/portal/jobs/${encodeURIComponent(id)}/cancel`}>{t("web.portal.schedule.manage")}</Link><h1 className="text-page-title">{t("web.portal.schedule.withdrawal")}</h1><p>{t("web.portal.schedule.withdrawalExplain")}</p>
    {failed && <StatusBanner title={t("web.portal.work.failed")} action={<Button onClick={()=>void refresh()}>{t("web.portal.work.retry")}</Button>}/>} {!data && !failed && <p role="status">{t("web.portal.work.loading")}</p>}
      {command.state === "checking" && <StatusBanner title={t("web.portal.work.checking")} action={<Button onClick={command.check}>{t("web.portal.work.checkAgain")}</Button>}/>} {command.state === "failed" && <p role="alert">{t("web.portal.work.notRecorded")}</p>}
    <PendingReceiptNotice state={command.state} />
    {data && <><p>{data.job.title} · {data.job.reference}</p>{receipts.length ? receipts.map(item=>{const storedNotice=withdrawalNotices.find(n=>n.id===item.id); const receiptTime=formatPortalTime(item.at,data.siteZone,locale,viewerZone); const notice=storedNotice?.noticeText ? {text:storedNotice.noticeText,locale:storedNotice.noticeLocale} : item.id===receipt?.id ? sentNotice : null; return <Card key={item.id} title={t("web.portal.schedule.received")}><p>{t("web.portal.schedule.receipt",{contract:item.quoteVersionId,notice:item.id})}</p>{quote && quote.id===item.quoteVersionId && <p>{t("web.portal.work.version",{version:quote.no})}</p>}<p>{t("web.portal.schedule.termsHash",{hash:item.termsHash})}</p><p>{item.actorDisplayName} · {receiptTime?.site}</p>{receiptTime?.viewer && <p>{receiptTime.viewer}</p>}{notice && <><p>{t("web.portal.schedule.noticeLabel")}</p><p lang={notice.locale ?? undefined} dir="auto">{notice.text}</p></>}{storedNotice?.termsText && <><p>{t("web.portal.work.terms")}</p><p lang={storedNotice.termsLocale} dir="auto">{storedNotice.termsText}</p></>}<p>{storedNotice?.deliveryState==="delivered" ? t("web.portal.schedule.emailDelivered") : !storedNotice && receipt || storedNotice?.deliveryState==="pending" || storedNotice?.deliveryState==="claimed" ? t("web.portal.schedule.emailCopy") : t("web.portal.schedule.emailUnknown")}</p></Card>;}) : <>
      {noticesFailed && <StatusBanner title={t("web.portal.schedule.receiptsUnavailable")} action={<Button onClick={()=>setNoticeGeneration(n=>n+1)}>{t("web.portal.work.retry")}</Button>}/>}
      {(!data.withdrawalQuoteVersionId || quoteFailed) && <p>{t("web.portal.schedule.unavailableNotice")}</p>}
      {quote && notices && <><Card title={t("web.portal.schedule.withdrawal")}><p>{quote.job.providerDisplayName} · {quote.job.namedApproverDisplayName}</p><p>{t("web.portal.work.version",{version:quote.no})} · {quote.id}</p><p lang={quote.terms.contractLocale} dir="auto">{quote.terms.providerLegalSnapshot}</p><p>{t("web.portal.schedule.noticeLabel")}</p><p lang={locale}>{noticeText}</p></Card><Button disabled={busy} onClick={()=>setDialog(true)}>{t("web.portal.schedule.submitNotice")}</Button><Dialog open={dialog} onOpenChange={setDialog} title={t("web.portal.schedule.withdrawal")} closeLabel={t("web.portal.work.close")} footer={<Button disabled={busy} onClick={()=>command.start({operationId:crypto.randomUUID(),quoteVersionId:quote.id,termsHash:quote.terms.hash,noticeText,noticeLocale:locale})}>{t("web.portal.schedule.submitNotice")}</Button>}><p>{data.job.reference} · {quote.job.providerDisplayName} · {account?.displayName}</p><p>{t("web.portal.schedule.noticeLabel")}</p><p lang={locale}>{noticeText}</p><p>{t("web.portal.schedule.withdrawalExplain")}</p></Dialog></>}
    </>}</>}
  </Frame>;
}
