import { getJobRatingEligibilityRoute, submitRatingRoute, type RatingEligibility, type RatingReceipt } from "@bookbuddy/api-contract";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Button, Card, Dock, SegmentedControl } from "../../ui";
import { jobTitle, Frame } from "../now/common";
import { CommandState, useCloseout, useScopeKey } from "../completion/common";
import { usePendingOperation } from "../session/pending-operation";

type RatingOperation = { operationId: string; payload: { id: string; stars: number; comment?: { language: string; text: string } } };
export function Rating() { const { id = "" } = useParams(); const scope = useScopeKey(); return <RatingPage key={`${scope}:${id}`} id={id} />; }
function RatingPage({ id }: { id: string }) {
  const { api, t, locale, time } = useCloseout(); const [data, setData] = useState<RatingEligibility | null>(null); const [receipt, setReceipt] = useState<RatingReceipt | null>(null); const [error, setError] = useState(false); const [generation, setGeneration] = useState(0); const [stars, setStars] = useState(0); const [comment, setComment] = useState("");
  useEffect(() => { const controller = new AbortController(); setError(false); setData(null); void api.request(getJobRatingEligibilityRoute, { params: { j: id } }, { signal: controller.signal }).then(result => { if (controller.signal.aborted) return; if (result.ok) setData(result.data); else setError(true); }); return () => controller.abort(); }, [api, id, generation]);
  const command = usePendingOperation(`rating:${id}`, (body: RatingOperation) => api.request(submitRatingRoute, { params: { j: id }, body }), setReceipt, undefined, {
    onCommitted: () => { setData(null); setGeneration(n => n + 1); },
  });
  const sent = receipt ?? (data?.status === "submitted" ? data.rating : null); const busy = command.state === "sending" || command.state === "checking";
  function send() { if (data?.status !== "eligible" || !stars || busy) return; command.start({ operationId: crypto.randomUUID(), payload: { id: crypto.randomUUID(), stars, ...(comment.trim() ? { comment: { language: locale, text: comment } } : {}) } }); }
  return <Frame><Link to={`/portal/jobs/${encodeURIComponent(id)}`}>{t("web.portal.closeout.back")}</Link>
    <h1 className="text-page-title">{t("web.portal.closeout.rating")}</h1>
    <CommandState status={command.state} check={command.check} />
    {!data && (error ? <><p role="alert">{t("web.portal.closeout.unavailable")}</p><Button onClick={() => setGeneration(n => n + 1)}>{t("web.portal.closeout.retry")}</Button></> : <p role="status">{t("web.portal.closeout.loading")}</p>)}
    {data && <>
      <p className="text-supporting text-muted" dir="auto">{[data.job.reference, jobTitle(t,data.job.title,data.job.reference), data.job.providerDisplayName].filter(Boolean).join(" · ")}</p>
      {sent ? <Card><p className="text-label" role="status">{t("web.portal.closeout.sentRating", { count: sent.stars, time: time(sent.submittedAt, data.job.siteZone) })}</p><p className="mt-2 text-supporting text-muted">{t("web.portal.closeout.private")}</p></Card>
        : data.status === "unavailable" ? <Card>{t("web.portal.closeout.ratingUnavailable")}</Card> : <>
          <Card><div className="space-y-4">
            <SegmentedControl label={t("web.portal.closeout.choose")} value={String(stars)} disabled={busy}
              options={[1,2,3,4,5].map(n => ({value:String(n),label:`★ ${t("web.portal.closeout.stars", {count:n})}`}))}
              onValueChange={value=>setStars(Number(value))} />
            <label className="bb-field"><span className="text-label">{t("web.portal.closeout.comment")}</span><textarea className="bb-input" dir="auto" maxLength={4000} value={comment} disabled={busy} rows={4} onChange={event => setComment(event.target.value)} /></label>
            <p className="text-supporting text-muted">{t("web.portal.closeout.private")}</p>
          </div></Card>
          <Dock context={t("web.portal.closeout.optional")} primary={{ label:t("web.portal.closeout.sendRating"), disabled:!stars || busy, onClick:send }} />
        </>}
    </>}
  </Frame>;
}
