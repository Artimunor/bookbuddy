import { staffQuoteVersionSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { emptyQuote, QuoteView } from "./Screen";

export const quote = staffQuoteVersionSchema.parse({ audience: "foreman", id: "quote_v1", quoteId: "quote", no: 1, state: "draft", totalMinor: 24000, currency: "EUR", publisherDisplayName: null, issuedAt: null, expiresAt: null, job: { jobId: "job", reference: "BB-1042", jobTitle: "Terrace door repair", placeAlias: "Villa Mar", siteZone: "Europe/Madrid", providerDisplayName: "Reformas Ruiz", namedApproverDisplayName: "Claire Martin" }, authorDisplayName: "Mateo Ruiz", reviewRouting: { reviewerDisplayName: "Inés Vidal", backupDisplayName: "Luis García" }, review: null, actions: { createRevision: false, submitReview: true, return: false, issue: false }, decision: null, replacedBy: null, originalLocale: "es", scope: "Ajustar la puerta de la terraza y sustituir los rodillos.", exclusions: "No incluye la sustitución del vidrio.", netMinor: 24000, taxMinor: 0, items: [{ lineNo: 1, originalLabel: "Mano de obra", quantity: 1, evidenceRule: "Foto", netMinor: 16000, taxMinor: 0 }, { lineNo: 2, originalLabel: "Rodillos", quantity: 1, evidenceRule: "Foto", netMinor: 8000, taxMinor: 0 }], readingAid: { status: "ready", ref: "translation", locale: "en", scope: "Adjust the terrace door and replace the rollers.", exclusions: "Glass replacement is not included.", items: [{ lineNo: 1, label: "Labour" }, { lineNo: 2, label: "Rollers" }], termsText: null }, terms: { id: "terms", version: 1, providerLegalSnapshot: "Reformas Ruiz", originalText: "Terms for the agreed work.", contractLocale: "en", consentText: "I agree to the scope and price.", hash: "terms_hash" }, evidence: [] });
const noop = () => {};
const pending = staffQuoteVersionSchema.parse({ ...quote, state: "in_review", actions: { ...quote.actions, submitReview: false }, review: { id: "review", state: "pending", reviewerDisplayName: "Inés Vidal", backupDisplayName: "Luis García", submittedAt: 1795421580000, dueAt: 1795507980000 } });
const issued = staffQuoteVersionSchema.parse({ ...quote, state: "issued", publisherDisplayName: "Mateo Ruiz", issuedAt: 1795421640000, expiresAt: 1796036400000, actions: { ...quote.actions, submitReview: false } });
const approved = staffQuoteVersionSchema.parse({ ...issued, state: "approved", decision: { id: "decision", decision: "approve", termsHash: "terms_hash", actorDisplayName: "Claire Martin", at: 1795422000000 } });
export const previews: ScreenPreview[] = [{ state: "draft", data: null }, { state: "pending-review", data: pending }, { state: "sent", data: issued }, { state: "approved", data: approved }].map(({ state, data }) => ({
  id: "F-04", state, render: () => <QuoteView data={data}
    draft={state === "draft" ? { scope: quote.scope, exclusions: quote.exclusions, locale: "es", lines: [
      { label: "Mano de obra", amount: "160", evidence: "Foto", evidenceAlternative: "Prueba de cierre con la cliente" },
      { label: "Rodillos", amount: "80", evidence: "Foto" },
    ] } : emptyQuote}
    change={noop} editable={state === "draft"} saved saveFailed={false} status="ready" offline={false} busy={false} checking={false} failed={false} hasTerms
    draftMedia={state === "draft" ? { attachments: [], ready: true, onAttach: noop, onOpen: noop, onExclude: noop, onRetry: noop } : undefined}
    onBack={noop} onJob={noop} onRetry={noop} onSend={noop} onRevision={noop} onChange={noop} />,
}));
