# Suggestions for the open questions

**Status:** the owner decided on these suggestions on 23 November 2026; see [the decision record](../decisions/2026-11-23-open-questions.md).

Suggested defaults for every open question in the idea document, the architecture document, the design specs and the Live Activities research. Each answer gives a concrete default, the reasoning, alternatives, evidence, who must confirm it and a confidence level. Legal and tax points are suggestions, not legal advice.

| Theme | Questions | File |
| --- | ---: | --- |
| Commercial: payments, quotes, cancellations, completion, disputes, reviews, pricing | 15 | [commercial.md](2026-11-23-open-question-suggestions/commercial.md) |
| Workforce: legal role, replacement, eligibility, support, safety, attendance | 19 | [workforce.md](2026-11-23-open-question-suggestions/workforce.md) |
| Product and platform: access, intake, languages, media, devices, pilot | 22 | [product-and-platform.md](2026-11-23-open-question-suggestions/product-and-platform.md) |

## Decide first

1. **Operating model.** Local providers contract with and bill the customer directly. BookBuddy coordinates and does not supply labour. This keeps the pilot clear of staffing-agency and employer obligations.
2. **Pilot scope.** Eight weeks in Torrevieja–Guardamar, with five vetted providers, about 25 customer accounts and a narrow list of repair types.
3. **Payments.** Customers pay the provider directly at first. Settle VAT invoicing, refunds and reconciliation before integrating a marketplace payment provider such as Stripe Connect.
4. **Replacement.** Own-team cover only during the pilot, with capped cover windows and staffed duty lines. Offers to workers outside the provider's own team stay off until the legal route for external cover is confirmed.
5. **Quotes and changes.** Name who approves quotes and changes, and agree the terms and consent wording.
6. **Cancellation and completion.** Fee-free cancellation and rescheduling during the pilot, kept separate from the statutory right of withdrawal. Agree completion evidence, sign-off and dispute rules, including who may defer payment or issue refunds.
7. **Safety and attendance.** Human safety briefings with verified teach-back in a language each worker understands. Attendance without location, kept separate from the employer's statutory working-time register.
8. **Languages.** The app's own text in Spanish and English at launch. Message translation into five more reading languages, each enabled after its translation quality is reviewed.
9. **Access and data.** Rules for account recovery, privileged role grants and property transfer. Approved offline-retention and media limits. Gate and alarm codes are never stored in the app.
10. **Devices.** Expo SDK 58 device floors and real-device readiness checks. The Lock Screen status card stays optional.

## Points that change the idea

- **The vetted replacement pool is the core differentiator, but the workforce suggestion keeps it off for the pilot.** Offering work to individual workers outside a provider's own crew raises labour-intermediation and agency-work questions in Spain. The pilot therefore proves own-team cover first. If that fails, the provider proposes a revised visit, or BookBuddy introduces another verified local business under a new agreement. External cover follows once a lawyer has confirmed a compliant route.
- **BookBuddy earns no payment margin in the pilot.** The commercial suggestion is a per-job provider fee instead: the first 30 completed paid jobs are free. After that, a paid trial charges €25 plus VAT per BookBuddy-sourced, signed-off, paid job of at least €150 before VAT, billed monthly to the provider. The trial continues only if at least three of the first five providers choose to pay. These figures are a hypothesis to test, not a validated price.
- **Location-based attendance stays out of the pilot,** in line with the [Live Activities research](../../research/tech-stack/live-activities-and-geofenced-attendance.md). The live shift card after a deliberate check-in remains.
