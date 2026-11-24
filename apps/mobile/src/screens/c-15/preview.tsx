import { customerChangeVersionSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { quote } from "../c-06/preview";
import { ChangeView } from "./Screen";
const approval = { id: "decision", decision: "approve", termsHash: "terms_hash", actorDisplayName: "Claire Martin", at: 1795422000000 };
const change = customerChangeVersionSchema.parse({ audience: "customer", id: "change_v1", proposalId: "change", baseQuoteVersionId: "quote_v1", no: 1, state: "issued", deltaMinor: 4000, totalMinor: 28000, currency: "EUR", publisherDisplayName: "Mateo Ruiz", issuedAt: quote.issuedAt, expiresAt: quote.expiresAt, job: quote.job, viewerIsNamedApprover: true, actions: { approve: true, decline: true }, decision: null, replacedBy: null, approvedBase: { ...quote, state: "approved", approval }, originalLocale: "es", originalText: "Sustituir también la guía.", timing: "No change to the visit.", affectedItems: "La guía está en espera.", items: [{ lineNo: 1, originalLabel: "Guía", quantity: 1, evidenceRule: "Photo", netMinor: 4000, taxMinor: 0 }], readingAid: { status: "ready", ref: "change_translation", locale: "en", text: "Also replace the track.", timing: "No change to the visit.", affectedItems: "The track replacement is on hold.", items: [{ lineNo: 1, label: "Track" }], termsText: null }, terms: quote.terms, evidence: [] });
const empty = () => {};
const states = [
  { state: "open", data: change },
  { state: "checking", data: change },
  { state: "approved", data: { ...change, state: "approved" as const, actions: { approve: false, decline: false } } },
  { state: "rejected", data: { ...change, state: "rejected" as const, actions: { approve: false, decline: false } } },
  { state: "superseded", data: { ...change, state: "superseded" as const, actions: { approve: false, decline: false }, replacedBy: { id: change.id, no: 2, issuedAt: change.issuedAt } } },
];
export const previews: ScreenPreview[] = states.map(({ state, data }) => ({ id: "C-15", state, render: () => <ChangeView data={data} status="ready" twoClock busy={state === "checking"} checking={state === "checking"} failed={false} onBack={empty} onRetry={empty} onApprove={empty} onReject={empty} onOpen={empty} onJob={empty} /> }));
