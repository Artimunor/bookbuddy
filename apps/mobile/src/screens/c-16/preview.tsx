import { problemCaseProjectionSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { fixturePhoto } from "../c-02/attachment-fixtures";
import { AttachmentTiles } from "../c-02/attachments";
import { completion, job } from "../c-10/preview";
import { CaseView, DraftView } from "./Screen";

const at = Date.parse("2026-11-24T09:38:00Z");
const content = (text: string) => ({ original: { language: "en", text }, reading: null });
const receipt = { id: "case-1", reference: "BB-CASE1", state: "open", category: "quality", openedAt: at, caseOwnerDisplayName: "BookBuddy local service", acknowledgeBy: at + 86400000, firstUpdateBy: at + 172800000, nextUpdateAt: null };
const open = problemCaseProjectionSchema.parse({ audience: "reporter", job, receipt, disclosedProviderAudience: "provider_rectification", affectedItem: completion.approvedScope.lines[0], bill: null, signOff: null, report: { id: "event-1", kind: "reported", at, actorDisplayName: "Claire Martin", content: content("The door still catches halfway when it slides. Sophie tried it at 10:30."), evidence: [{ kind: "photo", attachmentId: "case-photo", availability: "available", capturedAt: at, caption: null }] }, history: [{ id: "event-2", kind: "acknowledged", at: at + 60000, actorDisplayName: "BookBuddy local service", content: null, evidence: [] }], page: { cursor: null, hasMore: false }, actions: { appendReport: true, reviewCompletion: false } });
if (open.audience !== "reporter" && open.audience !== "case_owner") throw new Error("Invalid preview audience");
const resolved = problemCaseProjectionSchema.parse({ ...open, receipt: { ...receipt, state: "resolved" }, history: [...open.history, { id: "event-3", kind: "resolved", at: at + 86400000, actorDisplayName: "BookBuddy local service", content: content("The provider will adjust the door."), evidence: [] }], actions: { appendReport: false, reviewCompletion: true } });
if (resolved.audience !== "reporter" && resolved.audience !== "case_owner") throw new Error("Invalid preview audience");
const noop = () => {};
const caseProps = { status: "ready" as const, editing: false, message: "", checking: false, busy: false, failed: false, offline: false, onMessage: noop, onBack: noop, onRetry: noop, onAdd: noop, onSend: noop, onReview: noop };
const draft = { category: "quality", item: "", billId: "", description: "The door still catches halfway when it slides.", share: true, pending: null };
const draftProps = { draft, selectedItem: "", scope: completion, existing: [], provider: "Reformas Ruiz", status: "ready" as const, onRetry: noop, saved: true, failed: false, sendFailed: false, checking: false, busy: false, onChange: noop, onBack: noop, onSend: noop, onOpen: noop };
export const previews: ScreenPreview[] = [
  { id: "C-16", state: "draft", render: () => <DraftView {...draftProps} offline={false} canSend attachments={<AttachmentTiles items={[fixturePhoto]} onOpen={noop} onRemove={noop} />} /> },
  { id: "C-16", state: "offline", render: () => <DraftView {...draftProps} offline canSend={false} waitingMedia attachments={<AttachmentTiles offline items={[{ ...fixturePhoto, state: "queued" }]} onOpen={noop} onRemove={noop} />} /> },
  { id: "C-16", state: "case-open", render: () => <CaseView {...caseProps} data={open} onEvidence={noop} /> },
  { id: "C-16", state: "resolved", render: () => <CaseView {...caseProps} data={resolved} /> },
];
