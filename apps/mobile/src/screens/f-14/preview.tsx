import { foremanCompletionSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { fixturePhoto } from "../c-02/attachment-fixtures";
import { WrapUpView } from "./Screen";
const original = (text: string) => ({ original: { language: "es", text }, reading: null });
const lines = ["Ajustar la puerta de la terraza", "Sustituir los rodillos"].map((text, i) => ({ ref: { kind: "quote", quoteVersionId: "quote", lineNo: i + 1 }, label: original(text), evidenceRule: "Fotografía" }));
const base = { audience: "foreman", job: { jobId: "job", reference: "BB-1042", title: "Terrace door repair", placeAlias: "Villa Mar", siteZone: "Europe/Madrid", providerDisplayName: "Reformas Ruiz" }, approvedScope: { quoteVersionId: "quote", version: 1, termsHash: "terms", totalMinor: 24000, currency: "EUR", scope: original("Ajustar la puerta y sustituir los rodillos"), exclusions: null, lines }, namedApproverDisplayName: "Claire Martin", history: [], signOff: null, openCases: [], submission: null, work: { finishedAt: 1795515120000, crewCheckedOutAt: null }, correction: null, actions: { submit: true, messageApprover: false } };
const noop = () => {};
const draft = { billReference: "RR-0412", billAmount: "240.00", items: { "q:quote:1": { outcome: "done", note: "Desliza y cierra con llave", alternative: "" }, "q:quote:2": { outcome: "done", note: "2 rodillos nuevos colocados", alternative: "" } } };
export const previews: ScreenPreview[] = ["draft", "waiting-for-photo", "submitted", "returned"].map(state => ({ id: "F-14", state, render: () => {
  const posted = state === "submitted" || state === "returned";
  const submission = posted ? { id: "completion", version: 1, state: state === "returned" ? "returned" : "submitted", submitted: { at: 1795515300000, actorDisplayName: "Mateo Ruiz" }, finishedAt: 1795515120000, billReference: "RR-0412", billAmountMinor: 24000,
    items: lines.map((line, index) => ({ id: `item_${index}`, scope: line.ref, outcome: "done", result: original(index ? "2 rodillos nuevos colocados" : "Desliza y cierra con llave"), evidenceAlternative: null, photos: [{ attachmentId: `evidence-${index}`, availability: "available", capturedAt: 1795515120000, caption: null }] })) } : null;
  const data = foremanCompletionSchema.parse({ ...base, submission, actions: { ...base.actions, submit: state !== "submitted" }, correction: state === "returned" ? { at: 1795515320000, actorDisplayName: "Claire Martin", caseId: "case", reason: original("La puerta sigue atascada") } : null });
  const pending = state === "waiting-for-photo";
  return <WrapUpView data={data} status="ready" draft={draft} change={noop} saved saveFailed={false} offline={false} busy={false} failed={false} photos={posted ? undefined : { "q:quote:1": [fixturePhoto], "q:quote:2": [{ ...fixturePhoto, state: pending ? "uploading" : "ready" }] }} photoCount={posted ? 0 : 2} waitingPhotos={pending} onAddPhoto={noop} onOpenDraft={noop} onOpenPhoto={noop} onBack={noop} onRetry={noop} onSubmit={noop} onJob={noop} />;
} }));
