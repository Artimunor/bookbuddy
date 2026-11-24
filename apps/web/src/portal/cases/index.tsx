import { appendCaseEventRoute, getJobCompletionRoute, getProblemCaseRoute, listJobCasesRoute, submitProblemCaseRoute, type CompletionProjection, type LinkOpening, type ProblemCaseProjection, type RouteRequest } from "@bookbuddy/api-contract";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ActionLink, Badge, Button, Card, Dock, SegmentedControl, Select, SwitchRow } from "../../ui";
import { jobTitle, Frame } from "../now/common";
import { takeCheckedOpening } from "../notifications/handoff";
import { Authored, CommandState, useCloseout, useScopeKey } from "../completion/common";
import { AttachmentThumb, MediaPicker, type SelectedMedia } from "../media";
import { usePendingOperation } from "../session/pending-operation";

type Category = "quality" | "damage" | "bill" | "timing" | "other";
type NewBody = RouteRequest<typeof submitProblemCaseRoute.input>["body"];
type UpdateBody = RouteRequest<typeof appendCaseEventRoute.input>["body"];
type Participant = Extract<ProblemCaseProjection, { audience: "reporter" | "case_owner" }>;
type Scope = Extract<CompletionProjection, { audience: "customer" }>;
export function Cases() { const { id = "", caseId = "" } = useParams(); const scope = useScopeKey(); return caseId === "new" ? <NewCase key={`${scope}:${id}`} id={id} /> : <CasePage key={`${scope}:${id}:${caseId}`} id={id} caseId={caseId} />; }
function NewCase({ id }: { id: string }) {
  const { api, t, locale } = useCloseout(); const navigate = useNavigate(); const [search] = useSearchParams(); const [category, setCategory] = useState<Category | "">(search.get("category") === "bill" ? "bill" : ""); const [description, setDescription] = useState(""); const [preview, setPreview] = useState<{ businessId: string; providerName: string } | null>(null); const [previewReady, setPreviewReady] = useState(false); const [error, setError] = useState(false); const [share, setShare] = useState(false); const [scope, setScope] = useState<Scope | null>(null); const [affected, setAffected] = useState("");
  const [media, setMedia] = useState<SelectedMedia[]>([]); const [stageId] = useState(() => crypto.randomUUID()); const [mediaBusy, setMediaBusy] = useState(false);
  useEffect(() => { const controller = new AbortController(); void api.request(getJobCompletionRoute, { params: { j: id } }, { signal: controller.signal }).then(result => { if (!controller.signal.aborted && result.ok && result.data.audience === "customer") setScope(result.data); }); return () => controller.abort(); }, [api, id]);
  useEffect(() => { const controller = new AbortController(); setPreview(null); setPreviewReady(false); setShare(false); setError(false); if (category) void api.request(listJobCasesRoute, { params: { j: id }, query: { category } }, { signal: controller.signal }).then(result => { if (controller.signal.aborted) return; if (result.ok) { setPreview(result.data.newCaseAudience); setShare(!!result.data.newCaseAudience); setPreviewReady(true); } else setError(true); }); return () => controller.abort(); }, [api, id, category]);
  const open = (caseId: string) => navigate(`/portal/jobs/${encodeURIComponent(id)}/cases/${encodeURIComponent(caseId)}`, { replace: true });
  const command = usePendingOperation(`report-case:${id}`, (body: NewBody) => api.request(submitProblemCaseRoute, { params: { j: id }, body }), value => open(value.receipt.id), undefined, {
    includeResource: true,
    onCommitted: status => { if (status.resource?.kind === "case") open(status.resource.id); },
  });
  const busy = command.state === "sending" || command.state === "checking" || command.state === "committed";
  function send() { if (!category || !description.trim() || !previewReady || busy || mediaBusy) return; const selected = affected ? scope?.approvedScope.lines[Number(affected) - 1]?.ref : undefined; const billId = category === "bill" ? search.get("billId") : null; const audience = share && preview ? category === "bill" ? "provider_billing" : category === "quality" || category === "damage" ? "provider_rectification" : null : null; command.start({ operationId: crypto.randomUUID(), payload: { id: crypto.randomUUID(), reportEventId: crypto.randomUUID(), category, description: { language: locale, text: description }, evidence: media.map(item => item.id), expectedProviderAudience: audience, ...(selected ? { affectedItem: selected } : {}), ...(billId ? { billId } : {}) } }); }
  return <Frame><Link to={`/portal/jobs/${encodeURIComponent(id)}`}>{t("web.portal.closeout.back")}</Link>
    <h1 className="text-page-title">{t("web.portal.closeout.problem")}</h1>
    <Card><fieldset className="space-y-4" disabled={busy}>
      <SegmentedControl label={t("web.portal.closeout.category")} value={category} onValueChange={setCategory}
        options={[
          {value:"quality",label:t("web.portal.closeout.quality")}, {value:"damage",label:t("web.portal.closeout.damage")},
          {value:"bill",label:t("web.portal.closeout.bill")}, {value:"timing",label:t("web.portal.closeout.timing")},
          {value:"other",label:t("web.portal.closeout.other")},
        ]} />
      {scope && <Select label={t("web.portal.closeout.affected")} value={affected} onChange={event => setAffected(event.target.value)}>
        <option value="">{t("web.portal.closeout.none")}</option>
        {scope.approvedScope.lines.map((line, index) => <option value={index + 1} key={index}>{line.label.reading?.status === "ready" ? line.label.reading.text : line.label.original.text}</option>)}
      </Select>}
      <label className="bb-field"><span className="text-label">{t("web.portal.closeout.description")}</span><textarea className="bb-input" rows={5} dir="auto" maxLength={4000} value={description} onChange={event => setDescription(event.target.value)} /></label>
      {previewReady && preview && <SwitchRow label={t("web.portal.media.whoSees", { name: preview.providerName })} checked={share} onCheckedChange={setShare} />}
      {previewReady && !preview && <p className="text-supporting text-muted">{t("web.portal.closeout.noProvider")}</p>}
      <p className="text-supporting text-muted">{t("web.portal.closeout.reportAudience")}</p>
    </fieldset></Card>
    <MediaPicker caller="case" parentScopeId={id} stageId={stageId} value={media} onChange={setMedia} onBusyChange={setMediaBusy} disabled={busy} />
    {error && <p role="alert">{t("web.portal.closeout.unavailable")}</p>}
    <CommandState status={command.state} check={command.check} />
    <Dock primary={{ label:t("web.portal.closeout.sendReport"), disabled:!category || !description.trim() || !previewReady || busy || mediaBusy, onClick:send }} />
  </Frame>;
}
function CasePage({ id, caseId }: { id: string; caseId: string }) {
  const { api, t, locale, time, bootstrap, activeContext } = useCloseout(); const location = useLocation(); const opening = useRef<{ key: string; state: unknown; value: LinkOpening | null } | null>(null); const [data, setData] = useState<Participant | null>(null); const [error, setError] = useState(false); const [generation, setGeneration] = useState(0); const [description, setDescription] = useState(""); const [loading, setLoading] = useState(false);
  const [media, setMedia] = useState<SelectedMedia[]>([]); const [stageId, setStageId] = useState(() => crypto.randomUUID()); const [mediaBusy, setMediaBusy] = useState(false);
  useEffect(() => { const controller = new AbortController(); setData(null); setError(false); const key = `${bootstrap?.sessionId ?? ""}:${activeContext?.contextId ?? ""}:${id}:${caseId}:${locale}`; if (!opening.current || opening.current.key !== key || opening.current.state !== location.state) opening.current = { key, state: location.state, value: takeCheckedOpening(location.state, bootstrap?.sessionId, activeContext?.contextId ?? null) }; const checked = opening.current.value; if (generation === 0 && checked?.kind === "problem_case" && (checked.case.audience === "reporter" || checked.case.audience === "case_owner") && checked.case.job.jobId === id && checked.case.receipt.id === caseId) { setData(checked.case); return () => controller.abort(); } void api.request(getProblemCaseRoute, { params: { id: caseId } }, { signal: controller.signal }).then(result => { if (controller.signal.aborted) return; if (result.ok && (result.data.audience === "reporter" || result.data.audience === "case_owner") && result.data.job.jobId === id && result.data.receipt.id === caseId) setData(result.data); else setError(true); }); return () => controller.abort(); }, [api, caseId, id, locale, generation, location.state, bootstrap?.sessionId, activeContext?.contextId]);
  const command = usePendingOperation(`case-update:${caseId}`, async (body: UpdateBody) => {
    const result = await api.request(appendCaseEventRoute, { params: { id: caseId }, body });
    if (!result.ok) return result;
    const data = result.data;
    if ((data.audience === "reporter" || data.audience === "case_owner") && data.job.jobId === id) return { ok: true as const, data };
    return { ok: false as const, error: { code: "INVALID_RESPONSE", delivery: "unknown" } };
  }, value => { setData(value); setDescription(""); setMedia([]); setStageId(crypto.randomUUID()); }, undefined, {
    onCommitted: () => { setData(null); setDescription(""); setMedia([]); setStageId(crypto.randomUUID()); setGeneration(n => n + 1); },
  });
  const busy = command.state === "sending" || command.state === "checking";
  function send() { if (!data?.actions.appendReport || !description.trim() || busy || mediaBusy) return; command.start({ operationId: crypto.randomUUID(), payload: { id: crypto.randomUUID(), kind: "reporter_update", content: { language: locale, text: description }, evidence: media.map(item => item.id) } }); }
  async function more() { if (!data?.page.cursor || loading) return; setLoading(true); const result = await api.request(getProblemCaseRoute, { params: { id: caseId }, query: { cursor: data.page.cursor } }); if (result.ok && (result.data.audience === "reporter" || result.data.audience === "case_owner") && result.data.job.jobId === id) setData(previous => previous ? { ...result.data as Participant, history: [...previous.history, ...(result.data as Participant).history] } : previous); else setError(true); setLoading(false); }
  return <Frame>
    <Link to={`/portal/jobs/${encodeURIComponent(id)}`}>{t("web.portal.closeout.back")}</Link>
    <h1 className="text-page-title">{t("web.portal.closeout.problem")}</h1>
    <CommandState status={command.state} check={command.check} />
    {!data && (error ? <><p role="alert">{t("web.portal.closeout.unavailable")}</p><Button onClick={() => setGeneration(n => n + 1)}>{t("web.portal.closeout.retry")}</Button></> : <p role="status">{t("web.portal.closeout.loading")}</p>)}
    {data && <>
      <p className="text-supporting text-muted" dir="auto">{[data.job.reference,jobTitle(t,data.job.title,data.job.reference),data.job.placeAlias].filter(Boolean).join(" · ")}</p>
      <Card><Badge tone={data.receipt.state === "closed" || data.receipt.state === "resolved" ? "success" : "attention"} label={data.receipt.state === "closed" || data.receipt.state === "resolved" ? t("web.portal.closeout.caseClosed") : t("web.portal.closeout.caseOpen", { reference: data.receipt.reference })} /><p>{t("web.portal.closeout.targets", { ack: time(data.receipt.acknowledgeBy, data.job.siteZone), update: time(data.receipt.firstUpdateBy, data.job.siteZone) })}</p>{data.receipt.nextUpdateAt && <p>{t("web.portal.closeout.nextUpdate", { time: time(data.receipt.nextUpdateAt, data.job.siteZone) })}</p>}{data.signOff && <p>{t("web.portal.closeout.signedBy", { name: data.signOff.actorDisplayName, time: time(data.signOff.at, data.job.siteZone) })}</p>}</Card>
      <Card title={t("web.portal.closeout.reported")}><p>{data.report.actorDisplayName} · {time(data.report.at, data.job.siteZone)}</p><Authored value={data.report.content} /><AttachmentThumb caller="case" parentScopeId={data.report.id} attachments={data.report.evidence.map(item => ({ attachmentId: item.attachmentId, available: item.availability === "available", photo: item.kind === "photo" }))} /></Card>
      <Card title={t("web.portal.closeout.caseHistory")}><ol>{data.history.map(event => <li key={event.id}><strong>{t("web.portal.closeout.caseUpdate")}</strong><p>{event.actorDisplayName} · {time(event.at, data.job.siteZone)}</p>{event.content && <Authored value={event.content} />}<AttachmentThumb caller="case" parentScopeId={event.id} attachments={event.evidence.map(item => ({ attachmentId: item.attachmentId, available: item.availability === "available", photo: item.kind === "photo" }))} /></li>)}</ol>{data.page.cursor && <Button disabled={loading} onClick={() => void more()}>{t("web.portal.closeout.more")}</Button>}</Card>
      {data.actions.reviewCompletion && <ActionLink variant="text" to={`/portal/jobs/${encodeURIComponent(id)}/completion`}>{t("web.portal.closeout.review")}</ActionLink>}
      {data.actions.appendReport && <>
        <Card><label className="bb-field"><span className="text-label">{t("web.portal.closeout.addition")}</span><textarea className="bb-input" rows={4} dir="auto" maxLength={4000} value={description} disabled={busy} onChange={event => setDescription(event.target.value)} /></label></Card>
        <MediaPicker key={stageId} caller="case" parentScopeId={caseId} stageId={stageId} value={media} onChange={setMedia} onBusyChange={setMediaBusy} disabled={busy} />
        <Dock primary={{ label:t("web.portal.closeout.addCase"), disabled:!description.trim() || busy || mediaBusy, onClick:send }} />
      </>}
    </>}
  </Frame>;
}
