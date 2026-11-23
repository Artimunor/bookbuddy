# Commercial decisions for the Spain pilot

These are operating suggestions, not legal advice. Provider and store documentation was consulted on 23 November 2026. The prices, cutoffs and response targets below are proposed pilot defaults, not measured results or service guarantees.

**Start with one accountable local service business per job.** The customer buys from that business and pays it directly. BookBuddy coordinates the booking and helps resolve exceptions; it does not collect job proceeds or pay crews. Add integrated checkout only after the provider, payment and tax responsibilities agree in the contracts, on every customer-facing screen and in the payment provider’s configuration.

## Contracting, payment and invoicing

### 1. The customer’s counterparty and merchant of record

**Question:** Who contracts with the owner, takes the payment and stays accountable when the team changes? [Mobile architecture](../../architecture/mobile-tech-stack.md#open-questions) and [company brief](../2026-11-21-builders-company-idea.md#open-questions); C-05–C-11, C-15–C-17, F-03–F-06, P-02, L-02–L-06.

**Suggested answer:** Launch as a disclosed booking intermediary. The named Spanish trade business sets the quote, issues it through its authorised publisher, contracts with the customer, acts as the merchant for card payments, invoices, fulfils the job and provides remedies. BookBuddy supplies the coordination and a human case contact under its own terms. It does not bind either party, claim to be the repair contractor, sell labour or guarantee a payout. Show “Service provided and billed by [provider]; booking coordinated by BookBuddy” consistently from quote to receipt. Changing the foreman or crew does not change the contract. Replacing the contracting business requires resolving the old agreement and a fresh, explicit agreement with the new business.

| If BookBuddy later takes on… | Consequence |
| --- | --- |
| **A provider-side commercial agency mandate** | BookBuddy could negotiate or conclude bookings in the named provider’s name within a written mandate. The provider remains the seller; the mandate is not permission to hold or move the provider’s funds. |
| **Selling in its own name as principal and merchant of record** | BookBuddy quotes, contracts, charges and invoices the customer; it owns performance, complaints, refunds and chargeback exposure. The subcontracting business invoices BookBuddy, which pays its supplier bill. Price for rectification, insurance, legal compliance and working capital before choosing this route. |

**Why:** Customers abroad need one accountable business and an accessible contact; neither requires BookBuddy to become the contractor. The commercial arrangement must match what the customer actually sees and what each party does, not just the label or card-processing setting.

**Alternatives:** A provider-side agency mandate with PSP settlement; own-name sale only where margins, insurance and delivery control justify becoming principal.

**Evidence:** [Core flows](../../../design/foundation/core-flows.md#1-customer-request-booking-and-completion); [role boundaries](../../../design/foundation/personas-and-roles.md#mobile-roles-and-guardrails); [Spanish Agency Contracts Law 12/1992, art. 1 (27 May 1992)](https://www.boe.es/eli/es/l/1992/05/27/12/con#a1); [Spanish consumer law, art. 97 bis (2021 amendment)](https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555#a9-2) on marketplace disclosures and division of obligations; [Stripe’s merchant-of-record guidance](https://docs.stripe.com/connect/merchant-of-record) on checkout and statement identity. Merchant of record is a payments role; it does not by itself decide the contract, VAT supplier or staffing role.

**Confirm with:** Spanish commercial/consumer and construction counsel, the provider and its insurer. Review actual customer and provider terms, marketing claims, who approves a price and who takes a complaint. BookBuddy’s legal classification and liabilities are [unverified].

**Confidence:** Medium.

### 2. Marketplace payments in Spain and the limits of agency

**Question:** Which payment service provider (PSP) should sit behind checkout, and what would BookBuddy be doing under PSD2? [Mobile architecture](../../architecture/mobile-tech-stack.md#open-questions); C-11, C-16, P-04, L-04–L-06.

**Suggested answer:** In the free pilot, use each provider’s own hosted payment link or agreed direct bank transfer. If integrated payment is warranted, shortlist **Stripe Connect direct charges** first: one verified provider account, one EUR bill and one hosted card checkout. Require the account configuration and statement descriptor to identify that provider as merchant. The PSP handles provider identity/business verification, payment processing, applicable strong customer authentication (SCA, e.g. 3-D Secure) and payout to the provider’s verified bank account; BookBuddy displays the verified outcome. No platform wallet, pooled bank account, manual onward payments or promised escrow. Charge any BookBuddy fee separately to the provider at first.

| Option | Spain evidence and operating implication |
| --- | --- |
| **Stripe Connect** | [Connect country list](https://docs.stripe.com/connect/how-connect-works#availability) includes Spain; [hosted direct charges](https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted) put the charge on the connected account. Prefer a provider-managed account and liability terms that do not make BookBuddy cover its deficits. [Connect disputes](https://docs.stripe.com/connect/disputes) explains why a direct charge alone does not guarantee this. Indirect charges with `on_behalf_of` can identify the provider as merchant in Stripe’s model but still debit the platform balance for refunds/disputes. |
| **Adyen for Platforms** | [Hosted onboarding](https://docs.adyen.com/marketplaces/onboard-users#supported-countries-and-regions) includes Spanish businesses and supports sole proprietorships. Adyen books payments, fees and refunds to [provider and platform balance accounts](https://docs.adyen.com/marketplaces/split-transactions); it can debit the platform’s liable account. Confirm split defaults, chargeback allocation and pricing before committing to this more involved setup. |
| **Mangopay** | Its [EEA payment terms (30 June 2026)](https://mangopay.com/terms-and-conditions) identify a Luxembourg-authorised electronic money institution; [country restrictions](https://docs.mangopay.com/guides/users/country-restrictions) list Spain without country restrictions. Verified provider users can [receive bank payouts from Mangopay wallets](https://docs.mangopay.com/guides/payouts), subject to the programme and payout rail. Consider only if a real wallet or multi-party requirement emerges; verify who owns the balances, who can instruct transfers and whether BookBuddy would have a regulated agent or e-money distribution role. |

**Why:** PSD2’s commercial-agent exclusion is narrow: the agent needs actual agreement-based authority to negotiate **or** conclude the underlying sale for **only** the payer or **only** the payee. Calling the platform an agent, or saying payment to it discharges the customer’s debt, is not sufficient. A regulated PSP providing the payment service is a different arrangement from BookBuddy becoming that PSP’s agent, which may require formal appointment, registration and controls; a PSP contract does not confer a licence on BookBuddy.

**Alternatives:** Continue direct provider billing indefinitely; use Adyen for a proven split-settlement need or Mangopay for a justified wallet model.

**Evidence:** [PSD2, Directive (EU) 2015/2366 (25 November 2015), recital 11 and arts. 3(b), 19 and 97](https://eur-lex.europa.eu/eli/dir/2015/2366/oj/eng); [Spain’s RDL 19/2018 (23 November 2018), arts. 4(b), 23 and 68](https://www.boe.es/eli/es/rdl/2018/11/23/19/con#ar-4); Commission answers published by the EBA in [Q&A 5355 (6 December 2021)](https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2020_5355) and [Q&A 5354 (3 December 2021)](https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2020_5354); [architecture: verified payment outcomes](../../architecture/mobile-tech-stack.md#sources-of-truth).

**Confirm with:** Spanish payments counsel and the chosen PSP’s underwriting team. Give them the actual funds-flow diagram, contracting entity and refund/chargeback waterfall. Check provider and sole-trader eligibility, category/transaction limits, payout timing, minimum fees, reserves, chargeback/negative-balance exposure, SCA and the exact entity’s permissions in the [Banco de España register](https://www.bde.es/wbe/es/punto-informacion/contenidos/registros/registros-entidades). BookBuddy’s approval and contractual terms with all three are [unverified].

**Confidence:** Medium.

### 3. VAT invoice versus payment receipt

**Question:** Who issues the tax invoice and any correction? [Mobile architecture](../../architecture/mobile-tech-stack.md#open-questions) and [customer payment spec](../../../design/screens/customer/C-09_C-17-specs.md#c-11--payment-and-receipt); C-06, C-07, C-11, C-15, C-16, F-04, L-02, L-04, L-05.

**Suggested answer:** The provider invoices the customer for the full service amount, including any applicable IVA. BookBuddy displays the provider’s invoice and labels a PSP payment receipt separately; it invoices the provider only for its own coordination fee. Have providers use their own compliant invoicing process initially. If BookBuddy later prepares invoices on their behalf, obtain an explicit arrangement and use the provider’s issuer details and invoice series; responsibility stays with the provider. Keep the final tax-inclusive EUR total visible before commitment; do not assign VAT based on the buyer’s language or residence or silently infer a reduced rate. When a refund changes the taxable amount, the issuer makes the applicable corrective invoice. If BookBuddy sells the work in its own name, it invoices the customer for that supply, not merely the margin; the supplier accounts for its separate supply to BookBuddy.

**Why:** Settlement net of PSP fees is not the customer’s price, and a card receipt does not by itself meet invoice requirements. Spanish VAT law treats an own-name intermediary in a supply of services as having received and supplied the service itself.

**Alternatives:** Provider invoices delivered through C-11 by default; delegated invoice generation only if providers need it; separate purchaser and supplier invoices under an own-name model.

**Evidence:** [VAT Law 37/1992, arts. 11.Dos.15 and 164 (28 December 1992)](https://www.boe.es/eli/es/l/1992/12/28/37/con#a11); [Invoicing Regulation RD 1619/2012, arts. 5, 6 and 15 (30 November 2012)](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696#a5); [AEAT’s dwelling-repair guidance](https://sede.agenciatributaria.gob.es/Sede/iva/iva-operaciones-inmobiliarias/que-tipo-se-aplica-obras-viviendas/obras-renovacion-reparacion.html) (21% general rate; 10% only if conditions are met); [RD 238/2026 on B2B e-invoicing (25 March 2026)](https://www.boe.es/buscar/act.php?id=BOE-A-2026-7295); [AEAT, DAC7/Modelo 238](https://sede.agenciatributaria.gob.es/Sede/procedimientos/GI52.shtml).

**Confirm with:** A Spanish tax adviser and pilot provider accountants. Review B2C versus business customers, timing of invoicing and any future advances, rates/exemptions, cancellation adjustments, applicable invoicing-system/e-invoicing deadlines, and whether BookBuddy is a reportable platform under DAC7 even without handling payment. Applicability to the proposed flow is [unverified].

**Confidence:** High on the supplier/receipt distinction; medium on the pilot recommendation pending tax review.

### 4. Charge timing, refunds and provider settlement

**Question:** When is a job payable, who refunds it and how is payment reconciled? [Mobile architecture](../../architecture/mobile-tech-stack.md#open-questions) and [case and billing questions](../../../design/screens/customer/C-09_C-17-specs.md#open-design-questions); C-05, C-07, C-10, C-11, C-16, C-17, F-05, F-14, L-04, L-05.

**Suggested answer:** For pilot jobs the provider can afford to deliver without a deposit, propose one final bill, due **7 calendar days after delivery of the authorised bill**, normally after explicit sign-off. Quote approval, booking and sign-off do not initiate a charge. Keep deposit/milestone jobs out of this policy until they have separate approved terms; a billing due date does not set the statutory invoice/tax timing. C-11 shows the named biller, exact amount and currency; only a current, authorised bill can offer the provider’s checkout. One live payment attempt per bill. Mark paid only on a verified PSP outcome or matched receipt from the provider’s bank/PSP reconciliation; a customer screenshot, browser return or dismissal does not prove it. An unknown result stays in “Checking payment” with no second charge until reconciled.

The provider authorises refunds under its terms and applicable law, uses the original payment rail by default and records the amount, reason and outcome; target initiation by the **next business day** after entitlement is established, sooner if required. BookBuddy coordinates and displays `Refund pending` until confirmed. For a card dispute, the provider supplies the PSP response by its deadline and checks for an open chargeback before also issuing a refund. The PSP settles to the provider on the account’s agreed schedule. Treat captured, refunded and paid out as distinct events; neither sign-off nor a case releases a payout.

**Why:** “Customer owes,” “the card was charged,” and “the provider’s bank was credited” answer different questions. Keeping them separate prevents duplicate debits and gives the customer a clear route to resolve a discrepancy.

**Alternatives:** Provider-issued staged bills against explicitly agreed milestones for larger work; no booking deposits or saved-card late fees in the repair pilot.

**Evidence:** [Payment and receipt spec](../../../design/screens/customer/C-09_C-17-specs.md#c-11--payment-and-receipt); [core flows: sign-off and payment](../../../design/foundation/core-flows.md#1-customer-request-booking-and-completion); [Stripe direct-charge events and refunds](https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted); [Spanish consumer law, art. 107](https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555#a107), as amended in 2014, for statutory withdrawal refunds where applicable.

**Confirm with:** Provider finance and PSP onboarding. Before switching on integrated checkout, prove SCA interruption, a replayed payment event, a lost return, partial refund after payout and chargeback handling; confirm who funds each outcome. Actual readiness and payout terms are [unverified].

**Confidence:** Medium.

### 5. Why store billing does not apply

**Question:** Is paying for a booked physical service an app-store in-app purchase? [Mobile architecture](../../architecture/mobile-tech-stack.md#open-questions); C-11, L-04, L-05.

**Suggested answer:** No. For a repair, in-person massage, studio class, on-site coaching or a live local tour, use the provider’s card/hosted checkout (Apple Pay or Google Pay if enabled), bank transfer or payment at the venue as permitted. Apple §3.1.3(e) requires a method other than In-App Purchase for physical goods/services consumed outside the app; Google Play Payments §3 says Play Billing must not be used for physical services. A booking, payment receipt or QR pass displayed in the app does not turn the underlying service into digital content. Keep any future paid in-app software features or digitally delivered classes on a separate policy review; do not bundle them into the physical-service charge.

**Why:** Store policy follows what is being bought, not where the Book or Pay button appears. It does not decide who sells the service, owes VAT or can process its payments.

**Alternatives:** Hosted card checkout or pay on site; not StoreKit or Play Billing for the physical transaction.

**Evidence:** [Apple App Review Guidelines §§3.1.1 and 3.1.3(e)](https://developer.apple.com/app-store/review/guidelines/#other-purchase-methods); [Google Play Payments §§2–3](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en); [architecture trade-offs](../../architecture/mobile-tech-stack.md#risks-and-accepted-trade-offs).

**Confirm with:** Release owner. Explain the physical fulfilment and hosted payment in review notes and show the complete flow. Approval of this specific app and any later digital offering is [unverified].

**Confidence:** High.

## Quotes, bookings and aftercare

### 6. Quote review, issue and expiry

**Question:** Who reviews/publishes business quotes, where do they go, and what must be on the issued version? [Flow review, CA3/FA1/FB3](../2026-11-23-design-review-flows.md#intake-commercial-decisions-and-aftercare); F-03–F-05, F-15, C-06, C-07, C-15, P-02.

**Suggested answer:** The assigned foreman scopes; the provider names a commercial reviewer and backup. Give the reviewer a `Needs commercial review` item in the provider’s P-02 job queue. Target **one business day** to publish or return with a reason; F-04/F-05 sees `In review`, `Returned for changes` or `Issued` and the actual outcome. The draft snapshot is locked while in review and never reaches the customer on timeout. Only an explicitly authorised provider publisher may issue it. Allow owner-operators or a delegated foreman to publish directly under an explicit grant, not by taking intake or being an admin.

Issue a written, versioned fixed-price offer for the pilot: provider’s legal name and contact, property/site, scoped deliverables and exclusions, line items and applicable IVA with final EUR total, separately priced assessment if any, schedule assumptions, payment/withdrawal/cancellation/complaint terms and selected received evidence. Require the original terms and expiry **7 calendar days from issue**, showing the exact site-zone deadline. Provide consumer disclosures in Spanish and the required contracting language; label translations and do not silently substitute machine output for approved terms. Make the binding action unambiguous about the payment obligation if it creates one, even if no money moves now. Give the accepted version and terms on a durable medium, such as a PDF delivered by email. Expiry blocks new acceptance, not an already agreed job.

**Why:** Intake acceptance assigns responsibility, not a price or authority; the provider must be answerable for the offer. A durable, exact version makes a remote approval usable when the team or schedule changes.

**Alternatives:** All quotes reviewed by the provider’s commercial owner, or a bounded publisher grant for standard jobs only.

**Evidence:** [Foreman quote spec, FA1](../../../design/screens/foreman/F-01_F-07-specs.md#open-design-questions); [customer quote and approval specs](../../../design/screens/customer/C-01_C-08-specs.md#c-06-quote-and-scope); [provider’s P-02 queue](../../../design/screens/shared/P-01_P-05-specs.md#p-02--jobs-and-handoffs); [Spanish consumer law arts. 97–98](https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555#a97), current distance-contract provisions as amended in 2021.

**Confirm with:** The first provider’s authorised signatories, the owner and Spanish consumer counsel; verify C-07 wording against exactly when the contract is formed and use only agreed response targets.

**Confidence:** Medium.

### 7. Scope and change approval

**Question:** Who may publish and approve a change, what does its version contain, and what happens if it expires? [Flow review, CA3/FB3](../2026-11-23-design-review-flows.md#intake-commercial-decisions-and-aftercare) and [company brief](../2026-11-21-builders-company-idea.md#open-questions); F-04, F-05, F-13, F-15, C-05–C-08, C-15, S-17.

**Suggested answer:** Use the same provider publishing grant and review queue as for quotes, without a blanket foreman bypass. Show the approved original and exactly what is proposed: affected line items, signed price delta and new tax-inclusive total, proposed timing, which work is stopped and which can continue, selected evidence and the response deadline. Default to **72 hours**, capped at any earlier start of the affected work; if no valid reply in time, retain the old terms and replan the affected work. Only the current authorised customer approver can agree online; no self-approval, chat consent, silence or price change from a translation. If timing changes, confirm the revised capacity-backed window separately. If something is unsafe, stop the affected work immediately; that is not permission to start or charge for the change.

**Why:** This gives both parties a clean record of what the customer approved without making every unexpected work item grounds to cancel the entire job.

**Alternatives:** One commercial owner publishes every change; if the parties cannot agree, proceed only with deliverable original scope or use the contractual case/cancellation route.

**Evidence:** [F-15 and FB3](../../../design/screens/foreman/F-08_F-16-specs.md#f-15--propose-job-change); [C-15](../../../design/screens/customer/C-09_C-17-specs.md#c-15--review-a-job-change); [change flow](../../../design/foundation/core-flows.md#7-changes-cancellations-and-disputes); [Spanish consumer law art. 60 bis on additional payments](https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555#a60bis), added in 2014.

**Confirm with:** Provider commercial owner and Spanish consumer counsel. Pilot the response deadline with absent owners and confirm who can approve on a managed property.

**Confidence:** Medium.

### 8. Repair cancellations and revised visits

**Question:** When can the customer cancel or confirm a new window directly, and what terms, fees and response windows apply? [Flow review, CA3/CB1](../2026-11-23-design-review-flows.md#intake-commercial-decisions-and-aftercare); F-06, C-05, C-08, C-17, C-11, C-16.

**Suggested answer:** For pilot jobs without deposits or special-order material terms, allow **fee-free self-service cancellation before the visit starts** if no work has already been performed. At least **24 hours** before the visit, the customer can directly confirm a current provider-authorised alternative with unchanged scope and price. Inside 24 hours, or if capacity or terms differ, request provider agreement; target a reply **within four staffed hours**, or before the visit if sooner and staffed. The original window stands until a new one is confirmed; if an offer expires, show that rather than automatically cancelling. For started work, route ordinary termination to the provider/case and itemise any supported payment for work already performed. A provider cancellation carries no customer fee; offer a reschedule or refund sums paid for undelivered work as required. Do not collect late fees in the pilot.

Treat **statutory withdrawal** separately from appointment management. In-scope consumer distance service contracts generally have **14 calendar days from conclusion**; required longer periods and exceptions take precedence. Give a direct withdrawal action and durable receipt where applicable, not a provider-permission step. Work within the period needs the applicable express early-start request and acknowledgement; full performance, not merely starting, is the ordinary service exception when its conditions are met. The specific urgent-repair exception is for a visit expressly requested for urgent work, not unrelated extras.

**Why:** A simple pre-start policy makes C-17 intelligible and avoids tying up two windows. Customers should not lose a statutory right because a visit is booked, nearby or already started.

**Alternatives:** Provider-confirmed timing changes for all repairs; add a separately agreed policy for nonrecoverable costs only after legal review and pilot evidence.

**Evidence:** [C-08 and CA3](../../../design/screens/customer/C-01_C-08-specs.md#c-08-schedule-a-visit); [C-17 and CB1](../../../design/screens/customer/C-09_C-17-specs.md#open-design-questions); [Spanish consumer law arts. 98.8, 102–108](https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555#a102), as amended in 2021; [Directive (EU) 2023/2673 (22 November 2023), adding the online withdrawal function](https://eur-lex.europa.eu/eli/dir/2023/2673/oj/eng); [ECC Spain guidance (8 May 2026)](https://portal-cec.consumo.gob.es/en/comunicacion/noticias/2026/new-consumer-rights-guaranteed-redress-and-easier-cancellation-online).

**Confirm with:** Spanish consumer counsel and local operations. Exact national implementation of the EU withdrawal function, eligible early-start disclosures and treatment of the pilot’s contract types are [unverified].

**Confidence:** Medium.

### 9. Later-session cancellations and material substitutions

**Question:** What happens on a late cancellation, no-show or provider-proposed material change? [Flow review, L1/L2 and FL-24](../2026-11-23-design-review-flows.md#later-bookings-and-publication); L-02–L-06, C-17, S-17.

**Suggested answer:** For the first pay-at-venue category, allow direct, **€0** cancellation up to start, with no card-on-file charge for lateness or no-show. Allow self-serve moves at least **24 hours** ahead into an available like-for-like slot, same party/price/terms; inside 24 hours or for other changes, request the provider’s decision, with the same **four staffed-hour** target. Show the prior booking until a move succeeds. If the provider changes time, venue, advertised spoken language or a guaranteed host, the booker accepts or declines that exact proposal in L-05. If declined or unanswered, deliver the original terms if possible; otherwise record provider cancellation, offer a fee-free rebook or return any prepayment in full. No provider may treat refusal as a late customer cancellation. An equivalent substitute where the host was not guaranteed is a disclosed update, not a new sale.

If online prepayment is later authorised, start with full returns for customer cancellations at least 24 hours ahead and no extra debit below that cutoff. Do not retain any amount in the first online cohort; only consider a separately disclosed, proportionate retention after no-show losses are measured and terms are approved. A set-date leisure exception can apply to statutory withdrawal; do not assign it to every class, massage or tour just because there is a calendar entry.

**Why:** The service can learn no-show rates without storing mandates. Keeping provider changes distinct from customer cancellations prevents a customer paying for a materially different session they never agreed to.

**Alternatives:** Fee-free rescheduling up to start where capacity allows; a later prepay retention rule limited to demonstrable loss and approved category terms.

**Evidence:** [Later booking and roster spec](../../../design/screens/shared/L-01_L-06-specs.md#open-design-questions); [FL-24 material-change decision](../2026-11-23-design-review-flows.md#designlater); [Spanish consumer law art. 103(l)](https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555#a103) for specified-date leisure and [arts. 82–87](https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555#a82) for unfair terms.

**Confirm with:** Consumer counsel for the exact category and local providers for fill and no-show data. Specific exception, provider response coverage and willingness to accept fee-free terms are [unverified].

**Confidence:** Medium.

### 10. Completion evidence and sign-off

**Question:** What evidence is required per scope, and what counts as acceptance? [Flow review, FB3/W3/CB4](../2026-11-23-design-review-flows.md#intake-commercial-decisions-and-aftercare); W-07, F-13, F-14, C-10, C-11, C-16, S-17.

**Suggested answer:** Put the evidence requirement on the quote. For every completed line require the foreman’s item-level confirmation and a short result/test note. For observable repairs add **one relevant after photo per affected area** where safe to capture; use a before image when the defect would otherwise be impossible to compare. For concealed work specify a before-cover image or agreed test/certificate instead; where photography is intrusive or unsuitable, agree the alternative before work. W-07 goes to the foreman first. Only received, selected, customer-appropriate evidence can count in F-14; no raw attendance, crew discussion or bystander images. Customer compares the published submission to the approved scope and signs off online as authorised approver, or raises an issue. One reminder after **3 calendar days**, and human follow-up after **7**; no deemed sign-off, charge or waiver of remedies by silence. If the customer stays silent, surface any further billing determination separately under agreed terms, never as customer acceptance.

**Why:** A customer abroad needs proof of what was done, not simply proof that a worker arrived. Requiring evidence proportionate to each work item avoids unnecessary images of private places.

**Alternatives:** Require before/after pairs for every visual repair, or use a provider walkthrough/test sheet for scopes where photographs establish little.

**Evidence:** [Site evidence and sharing flow](../../../design/foundation/core-flows.md#6-site-attendance-and-progress-photos); [worker W3](../../../design/screens/worker/W-01_W-09-specs.md#open-design-questions); [F-14 completion](../../../design/screens/foreman/F-08_F-16-specs.md#f-14--submit-completion); [C-10 sign-off](../../../design/screens/customer/C-09_C-17-specs.md#c-10--completion-and-sign-off); [attendance research](../../../research/tech-stack/live-activities-and-geofenced-attendance.md#spain-and-eu-an-arrival-signal-is-not-the-working-time-register) separates a location signal from the attendance record itself.

**Confirm with:** Pilot foremen, remote owners and privacy/legal reviewers. Compare two or three representative scopes for what customers can actually judge from the evidence.

**Confidence:** Medium.

### 11. Cases, correction and billing holds

**Question:** Who sees evidence, what is the response target, who can send completion back, and who can hold or release payment? [Flow review, FB3/W3/CB4](../2026-11-23-design-review-flows.md#intake-commercial-decisions-and-aftercare); C-10, C-11, C-16, F-13, F-14, L-05, S-15, S-16.

**Suggested answer:** Give a durable case receipt and reference immediately on confirmed submission. BookBuddy’s named local case owner acknowledges within **one business day** and gives a substantive first update within **two business days**, then updates every **two business days** while waiting for a plan; these are targets, not a resolution promise. The provider remains responsible for its complaint and remedy. Show the reporter their own submitted material, agreed job records and shared responses. Give the assigned case handler the necessary material, and the provider’s named billing or rectification lead only the packet needed for that item; disclose who can see what before sending. No default crew/chat access, other customers or access secrets. The case owner can record a request for correction and alert the provider. The authorised foreman submits a new completion version with the correction; the approver sees the old version and decides on the new one. A complaint after sign-off opens remediation, not a rewrite of the historical sign-off.

One separate decision by the **provider’s named billing authority**, not the case handler, may defer collection of the disputed **unpaid** amount where the terms or law allow it. Record the amount, basis, affected items, decision maker and next review date within **two business days**. Do not present an already captured amount as held. Release a deferral only after an authorised outcome (resume collection of the amount agreed, correct the invoice, or instruct a refund if already paid). Case status alone never changes the balance, payout or acceptance; show only verified effects. Escalate unresolved consumer complaints to the appropriate regional/ADR information route without cutting off the provider’s own complaints channel.

**Why:** A human owns the next action, but the customer is not misled into thinking BookBuddy can impound the provider’s money. Preserving both versions makes it possible to establish what was rejected, what was corrected and what was agreed.

**Alternatives:** For the pilot show disputed items without any collection-deferral control unless the provider can operate it; no PSP reserve or escrow feature.

**Evidence:** [Core changes and disputes](../../../design/foundation/core-flows.md#7-changes-cancellations-and-disputes); [C-16 case spec](../../../design/screens/customer/C-09_C-17-specs.md#c-16--report-an-issue-or-follow-a-case); [Spanish consumer law art. 21](https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555#a21), as amended by [Law 10/2025 (26 December 2025)](https://www.boe.es/buscar/act.php?id=BOE-A-2025-26698#df-3), specifies a maximum 15-day complaint response and proof of receipt; [Law 7/2017 art. 41 (2 November 2017)](https://www.boe.es/buscar/act.php?id=BOE-A-2017-12659#a41) and [Generalitat Valenciana complaints procedure](https://www.gva.es/es/inicio/procedimientos?id_proc=316).

**Confirm with:** Named operations and provider finance owners, privacy counsel and Spanish consumer counsel. Confirm actual coverage, applicable deadlines, ADR route, sharing grounds and authority to defer an invoice; the operating arrangement is [unverified].

**Confidence:** Medium.

### 12. Review eligibility, audience and edits

**Question:** Who can review, who can see ratings/comments, and can the customer amend them? [Flow review, CB2/L3](../2026-11-23-design-review-flows.md#intake-commercial-decisions-and-aftercare); C-05, C-12, L-05, L-06.

**Suggested answer:** One optional private **1–5 rating and comment** from the eligible customer per delivered, verified closed repair or provider-confirmed attended session booking. Invite within **30 calendar days of actual service**; neither a past start time, a paid invoice alone, nor a cancelled/no-show booking qualifies. A refund of work actually delivered is not by itself disqualifying. Show the audience before Send: the author, BookBuddy’s named feedback team and the provider’s designated feedback lead, not crew, other customers or the public. Do not promise anonymity to the business that handled the job. No self-serve edits after submission in the pilot; allow correction or withdrawal through support and a provider response in the same channel as applicable. Never use rating, correction or withdrawal to change payment or case outcomes.

**Why:** Verified private feedback gives providers something they can act on without creating a public rating market on day one. A separate eligibility record avoids rating a booking that merely came and went.

**Alternatives:** Private feedback only to BookBuddy; verified public reviews later with stated verification, a right to respond and moderation that does not suppress negative ratings.

**Evidence:** [C-12 design and CB2](../../../design/screens/customer/C-09_C-17-specs.md#c-12--leave-a-review-sheet); [later attendance and review question, L3](../../../design/screens/shared/L-01_L-06-specs.md#open-design-questions); [Spanish consumer law art. 20.4](https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555#a20), updated by [Law 10/2025 (26 December 2025)](https://www.boe.es/buscar/act.php?id=BOE-A-2025-26698#df-3), covers verification disclosure, the 30-day purchase/use window and trader response for reviews in the covered practice.

**Confirm with:** Owner, provider and privacy/consumer counsel, especially whether the private workflow is covered and how corrections and replies will be delivered. Public reviews are not a pilot promise.

**Confidence:** Medium.

## Later inventory and the paid business model

### 13. Session holds and payment reconciliation

**Question:** How long is a hold, which payment modes are supported and what happens if capacity or payment becomes uncertain? [Flow review, L1](../2026-11-23-design-review-flows.md#later-bookings-and-publication); L-03–L-05, C-17.

**Suggested answer:** Start the first session category with **pay at venue**, no saved cards or deposits, and a **10-minute server hold** for the exact slot and party size. Selection alone costs and reserves nothing. Commit seats and the booked terms together; an expired hold never books. On a conflict show verified remaining capacity, including “1 place left; you requested 2,” not generic “Sold out.” A failed move leaves the original booking and reference intact. Release abandoned holds without a charge.

Before enabling **prepaid EUR cards** later, prove a single attempt tied to the exact hold/provider/amount/terms. Start checkout before hold expiry and allow at most **5 extra minutes** once for authorisation. Capture only once the server has converted still-valid held places into an exclusive pending reservation. Confirm the new booking or swap only on verified capture; preserve the prior booking during a move. If the deadline passes without an eligible authorisation and seat claim, release the hold, expire the open checkout and void a late authorisation; if funds nevertheless captured without a valid booking, refund them and notify the booker. If capture was requested against seats already claimed but the outcome is unknown, keep the claim pending, escalate at the deadline and reconcile before releasing it or allowing a second attempt. Do not equate a PSP checkout timer with a seat hold: Stripe’s configurable hosted-session expiry has a **30-minute minimum**; expiring an open session is a separate operation.

**Why:** Venue payment proves slot and attendance operations without coupling them to uncertain card outcomes. A short seat hold and a distinct payment state prevent overselling, double pay and the disappearance of a valid booking during a move.

**Alternatives:** No hold for staff-confirmed appointments; add prepay only after race, expiry and failure handling is proven with the contracted PSP.

**Evidence:** [Later session flow](../../../design/foundation/core-flows.md#8-later-category-book-a-pilates-class-or-massage); [L-03–L-05 spec](../../../design/screens/shared/L-01_L-06-specs.md#l-03--choose-a-slot-sheet); [Stripe expiry field](https://docs.stripe.com/api/checkout/sessions/create#create_checkout_session-expires_at), [explicit expiry](https://docs.stripe.com/api/checkout/sessions/expire) and [separate authorisation/capture](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method).

**Confirm with:** Session operators for checkout duration and conflict rates; payment and operations owners for expiry, duplicate and late events, cost of stuck inventory and the exact PSP capabilities. These flows have not been proven for BookBuddy [unverified].

**Confidence:** Medium.

### 14. Publication and attendee records

**Question:** What must a later-category listing publish, whose names are needed, and who records attendance for review? [Flow review, L3](../2026-11-23-design-review-flows.md#later-bookings-and-publication); L-01–L-06, C-12.

**Suggested answer:** The authorised provider admin publishes only an approved venue and category. Require legal provider identity, complaint contact and actual role; format and duration, local time/zone, capacity unit, actual spoken language, whether the host is guaranteed, exact venue or meeting directions, concrete access facts (e.g. step-free route, stairs, accessible toilet if verified), age or physical restrictions, price basis and tax-inclusive total, payment mode, and original versioned cancellation, withdrawal and substitution terms. Require a tour meeting point and weather policy, a studio room/arrival instructions, and for private/off-site visits show the meeting location only to the entitled booker where it is private. Label unknown access features; do not equate missing details with accessibility. Give legally required marketplace and ranking disclosures where applicable.

Start with booker name plus party size, no named-guest roster unless a category documents a necessity such as named admission or an insurer’s condition. One designated coordinator with an attendance grant (the solo provider or a named substitute where granted) records actual redeemed places, including zero, at the session and confirms attendance; permit an audited correction with actor, reason and time. Feed only a confirmed attended booking into C-12 eligibility. Time passing or a staffing update does not count; no public attendee list.

**Why:** Accurate access and delivery terms let the customer decide before giving details or committing. Counting places rather than named guests handles groups without collecting information the provider does not need.

**Alternatives:** Named admission only for documented categories; add a booker check-in code if manual attendance proves unreliable.

**Evidence:** [L-01–L-06 spec, L3](../../../design/screens/shared/L-01_L-06-specs.md#open-design-questions); [later-category core flow](../../../design/foundation/core-flows.md#8-later-category-book-a-pilates-class-or-massage); [Spanish consumer law arts. 20 and 97 bis](https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555#a9-2) on offer and marketplace information; [GDPR art. 5 (27 April 2016)](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng) on data minimisation.

**Confirm with:** The category operator, accessibility reviewer and local consumer/privacy counsel. Category-specific roster requirements, commercial and access disclosures, and accessibility claims are [unverified].

**Confidence:** Medium.

### 15. Who pays after the free start

**Question:** What do we charge, who pays and what pilot evidence would justify it? [Company brief](../2026-11-21-builders-company-idea.md#open-questions); C-06, C-11, P-01, P-02. The platform fee is a separate provider invoice, not a consumer checkout line.

**Suggested answer:** Make the first **30 completed paid jobs** with about **five providers** free of BookBuddy fees; customers still pay the provider’s approved price. Then offer a paid trial at **€25 plus applicable VAT**, billed monthly to the provider per BookBuddy-sourced, signed-off and paid managed job with an agreed service price of at least **€150 before VAT**. Bill no leads, cancelled or fully refunded jobs, or work sourced by the provider. Charge only for new jobs under accepted terms; credit the fee on a later full refund. No customer surcharge or fee for a worker. The fee buys qualified intake, scope handoff and bilingual coordination through completion, not staffing guarantees or software access alone.

Track paid conversion, 60-day repeat demand, acquisition cost on both sides, support/translation minutes, PSP and refund losses and contribution per completed managed job. Continue the paid trial only if **at least three of the first five providers** choose to pay and there is positive contribution after measured direct handling costs. The tariff, thresholds and unit economics are a hypothesis [unverified], not a quote to reuse across Spain.

**Why:** Paying only once a real booking is delivered is easier to defend than charging for a lead or requiring a subscription before there is volume. Separate invoicing tests whether providers will pay for the coordination without adding money movement to the pilot.

**Alternatives:** An explicitly priced owner/property-manager coordination retainer if demand proves buyer-side, or a separate provider SaaS subscription if the crew tool earns its own case.

**Evidence:** [Company brief: free start](../2026-11-21-builders-company-idea.md#getting-started); [market evidence gaps](../../../research/markets/markets.md#12-remaining-evidence-gaps-and-confidence); [competitor research: paid introductions versus bookings](../../../research/competitors/competitors.md#1-home-services-and-trades-marketplaces); [Jobber and other player profiles](../../../research/competitors/player-profiles.md#026-jobber); [MyBuilder’s shortlist terms](https://www.mybuilder.com/terms-conditions) and [Jobber’s SaaS plans](https://www.getjobber.com/pricing/) show mechanisms, not a Costa Blanca price benchmark.

**Confirm with:** The owner, the first provider cohort and the tax adviser. Check who benefits in repeat jobs, how providers compare the charge with other acquisition costs and whether measured contribution funds reliable follow-through before expanding.

**Confidence:** Low.

## Decide first

1. **Name the seller and biller.** Approve one provider-as-seller model, its customer terms and what BookBuddy can promise or decide.
2. **Approve the money path.** Start with provider billing; agree invoice, refund and reconciliation ownership before any PSP integration. Shortlist Connect direct charges, not platform custody.
3. **Name the quote and change publisher.** Approve the original terms template, expiry and consent wording, and the same queue for changes.
4. **Agree repair withdrawal, cancellation and rescheduling terms.** Use no pilot late fees; preserve the booked visit until a move succeeds and keep statutory withdrawal separate.
5. **Define completion and remedies.** Agree the evidence and sign-off threshold, named case owner and who alone can defer a disputed unpaid bill or issue a refund.
