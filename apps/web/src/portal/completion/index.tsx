import { getJobCompletionRoute, signOffCompletionRoute, type CompletionProjection, type LinkOpening } from "@bookbuddy/api-contract";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ActionLink, Badge, Button, Card, Dialog, Dock } from "../../ui";
import { jobTitle, Frame, money } from "../now/common";
import { takeCheckedOpening } from "../notifications/handoff";
import { Authored, CommandState, useCloseout, useScopeKey } from "./common";
import { AttachmentThumb } from "../media";
import { usePendingOperation } from "../session/pending-operation";

type Completion = Extract<CompletionProjection, { audience: "customer" }>;
type Sign = { operationId: string; payload: { id: string; termsHash: string }; completionId: string };
export function Completion() { const { id = "" } = useParams(); const scope = useScopeKey(); return <CompletionPage key={`${scope}:${id}`} id={id} />; }
function CompletionPage({ id }: { id: string }) {
  const { api, locale, t, time, bootstrap, activeContext } = useCloseout();
  const location = useLocation();
  const opening = useRef<{ key: string; state: unknown; value: LinkOpening | null } | null>(null);
  const [data, setData] = useState<Completion | null>(null); const [error, setError] = useState(false); const [generation, setGeneration] = useState(0); const [open, setOpen] = useState(false);
  useEffect(() => { const controller = new AbortController(); setData(null); setError(false); const key = `${bootstrap?.sessionId ?? ""}:${activeContext?.contextId ?? ""}:${id}:${locale}`; if (!opening.current || opening.current.key !== key || opening.current.state !== location.state) opening.current = { key, state: location.state, value: takeCheckedOpening(location.state, bootstrap?.sessionId, activeContext?.contextId ?? null) }; const checked = opening.current.value; if (generation === 0 && checked?.kind === "completion" && checked.completion.audience === "customer" && checked.completion.job.jobId === id) { setData(checked.completion); return () => controller.abort(); } void api.request(getJobCompletionRoute, { params: { j: id } }, { signal: controller.signal }).then(result => { if (controller.signal.aborted) return; if (result.ok && result.data.audience === "customer" && result.data.job.jobId === id) setData(result.data); else setError(true); }); return () => controller.abort(); }, [api, id, locale, generation, location.state, bootstrap?.sessionId, activeContext?.contextId]);
  const command = usePendingOperation(`sign-off:${id}`, (op: Sign) => api.request(signOffCompletionRoute, { params: { id: op.completionId }, body: { operationId: op.operationId, payload: op.payload } }), value => { setData(value); setOpen(false); }, undefined, {
    onCommitted: () => { setData(null); setOpen(false); setGeneration(n => n + 1); },
  });
  useEffect(() => { if (command.state === "checking" || command.state === "failed") setOpen(false); }, [command.state]);
  const busy = command.state === "sending" || command.state === "checking";
  function sign() { if (!data?.submission || !data.actions.signOff || busy) return; command.start({ operationId: crypto.randomUUID(), completionId: data.submission.id, payload: { id: crypto.randomUUID(), termsHash: data.approvedScope.termsHash } }); }
  return <Frame><Link to={`/portal/jobs/${encodeURIComponent(id)}`}>{t("web.portal.closeout.back")}</Link><h1 className="text-page-title">{t("web.portal.closeout.review")}</h1>{!data && (error ? <><p role="alert">{t("web.portal.closeout.unavailable")}</p><Button onClick={() => setGeneration(n => n + 1)}>{t("web.portal.closeout.retry")}</Button></> : <p role="status">{t("web.portal.closeout.loading")}</p>)}
    <CommandState status={command.state} check={command.check} />
    {data && <><p className="text-supporting text-muted" dir="auto">{[data.job.reference,jobTitle(t,data.job.title,data.job.reference),data.job.placeAlias].filter(Boolean).join(" · ")}</p>
    {(data.signOff || data.submission) && <Card>{data.signOff
      ? <Badge tone="success" label={t("web.portal.closeout.signedBy", { name:data.signOff.actorDisplayName, time:time(data.signOff.at,data.job.siteZone) })} />
      : data.submission && <><Badge tone="attention" label={t("web.portal.closeout.waiting")} /><p className="mt-2 text-supporting text-muted">{t("web.portal.closeout.submittedBy", { name:data.submission.submitted.actorDisplayName, time:time(data.submission.submitted.at,data.job.siteZone) })}</p></>}
    </Card>}
    <Card title={t("web.portal.closeout.scope", { version: data.approvedScope.version, amount: money(locale, data.approvedScope.totalMinor, data.approvedScope.currency) })}><Authored value={data.approvedScope.scope} /><ul className="space-y-4">{data.approvedScope.lines.map((line, index) => { const item = data.submission?.items.find(entry => JSON.stringify(entry.scope) === JSON.stringify(line.ref)); return <li key={index}><Authored value={line.label} />{item && <><Badge label={item.outcome === "done" ? t("web.portal.closeout.done") : t("web.portal.closeout.notDone")} /><Authored value={item.outcome === "done" ? item.result : item.reason} />{item.outcome === "done" && item.evidenceAlternative && <Authored value={item.evidenceAlternative} />}{item.photos.length ? <AttachmentThumb caller="completion" parentScopeId={item.id} attachments={item.photos.map(photo => ({ attachmentId: photo.attachmentId, available: photo.availability === "available", photo: true, caption: photo.caption?.original.text }))} /> : <p>{t("web.portal.closeout.noPhoto")}</p>}</>}</li>; })}</ul>{data.approvedScope.exclusions && <><h3>{t("web.portal.closeout.exclusions")}</h3><Authored value={data.approvedScope.exclusions} /></>}</Card>
    {data.openCases.map(item => <p key={item.id}><Link to={`/portal/jobs/${encodeURIComponent(id)}/cases/${encodeURIComponent(item.id)}`}>{t("web.portal.closeout.caseOpen", { reference:item.reference })}</Link></p>)}
    {data.actions.reportProblem && <ActionLink variant="text" to={`/portal/jobs/${encodeURIComponent(id)}/cases/new`}>{t("web.portal.closeout.problem")}</ActionLink>}
    {data.signOff ? data.actions.seeBill && <Dock primary={{ to:`/portal/jobs/${encodeURIComponent(id)}/bill`, label:t("web.portal.closeout.seeBill") }} />
      : data.submission && <Dock context={data.actions.signOff ? t("web.portal.closeout.signEffect") : t("web.portal.closeout.approver", { name:data.namedApproverDisplayName, place:data.job.placeAlias })}
        primary={{ label:t("web.portal.closeout.sign"), disabled:!data.actions.signOff || busy, onClick:()=>setOpen(true) }} />}
    <Dialog open={open} onOpenChange={setOpen} title={t("web.portal.closeout.sign")} closeLabel={t("web.portal.closeout.close")} footer={<Button disabled={busy} onClick={sign}>{t("web.portal.closeout.confirm")}</Button>}><p>{data.job.reference} · {jobTitle(t,data.job.title,data.job.reference)}</p><p>{t("web.portal.closeout.approver", { name: data.namedApproverDisplayName, place: data.job.placeAlias })}</p><p>{t("web.portal.closeout.signEffect")}</p></Dialog></>}
  </Frame>;
}
