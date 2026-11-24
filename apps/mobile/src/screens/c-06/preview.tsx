import { customerQuoteVersionSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { QuoteView } from "./Screen";

export const quote = customerQuoteVersionSchema.parse({ audience: "customer", id: "quote_v1", quoteId: "quote", no: 1, state: "issued", totalMinor: 24000, currency: "EUR", publisherDisplayName: "Mateo Ruiz", issuedAt: 1795421640000, expiresAt: 1796036400000, job: { jobId: "job", reference: "BB-1042", jobTitle: "Terrace door repair", placeAlias: "Villa Mar", siteZone: "Europe/Madrid", providerDisplayName: "Reformas Ruiz", namedApproverDisplayName: "Claire Martin" }, viewerIsNamedApprover: true, actions: { approve: true, decline: true }, decision: null, replacedBy: null, hasProposedWindows: false, originalLocale: "es", scope: "Ajustar la puerta de la terraza y sustituir los rodillos. No incluye la sustitución del vidrio.", exclusions: "No incluye la sustitución del vidrio.", netMinor: 24000, taxMinor: 0, items: [{ lineNo: 1, originalLabel: "Mano de obra", quantity: 1, evidenceRule: "Photo", netMinor: 16000, taxMinor: 0 }, { lineNo: 2, originalLabel: "Rodillos", quantity: 1, evidenceRule: "Photo", netMinor: 8000, taxMinor: 0 }], readingAid: { status: "ready", ref: "translation", locale: "en", scope: "Adjust the terrace door and replace the rollers. Glass replacement is not included.", exclusions: "Glass replacement is not included.", items: [{ lineNo: 1, label: "Labour" }, { lineNo: 2, label: "Rollers" }], termsText: null }, terms: { id: "terms", version: 1, providerLegalSnapshot: "Reformas Ruiz", originalText: "Terms for the agreed work.", contractLocale: "en", consentText: "I agree to the scope and price.", hash: "terms_hash" }, evidence: [] });
const empty = () => {};
const variants = [
  { state: "current", data: quote },
  { state: "superseded", data: { ...quote, state: "superseded" as const, actions: { approve: false, decline: false }, replacedBy: { id: quote.id, no: 2, issuedAt: quote.issuedAt } } },
  { state: "expired", data: { ...quote, state: "expired" as const, actions: { approve: false, decline: false } } },
  { state: "declined", data: { ...quote, state: "declined" as const, actions: { approve: false, decline: false } } },
  { state: "read-only", data: { ...quote, viewerIsNamedApprover: false, actions: { approve: false, decline: false } } },
];
export const previews: ScreenPreview[] = variants.map(({ state, data }) => ({ id: "C-06", state, render: () => <QuoteView data={data} status="ready" onBack={empty} onRetry={empty} onOpen={empty} onReview={empty} /> }));
