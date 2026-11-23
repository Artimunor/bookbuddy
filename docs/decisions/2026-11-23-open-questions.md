# Decisions on the open questions

Status: decided by the owner on 23 November 2026. The options are described in [the suggestions overview](../reports/2026-11-23-open-question-suggestions.md) and its three theme files.

## Decided

| # | Topic | Decision |
| ---: | --- | --- |
| 1 | Operating model | **Accepted.** Local providers contract with and bill the customer directly. BookBuddy coordinates and does not supply labour. |
| 2 | Pilot scope | **Not decided.** The pilot location, size and duration stay open. The Torrevieja–Guardamar plan, the five-provider and 25-account targets and the eight-week timebox are not adopted. |
| 3 | Payments | **Accepted.** Customers pay the provider directly at first. VAT invoicing, refunds and reconciliation are settled before a marketplace payment provider such as Stripe Connect is integrated. |
| 4 | Quotes and changes | **Accepted.** A named approver, plus agreed terms and consent wording. |
| 5 | Cancellation and completion | **Accepted.** Fee-free cancellation and rescheduling, kept separate from the statutory right of withdrawal. Completion evidence, sign-off and dispute rules as suggested. |
| 6 | Safety and attendance | **Accepted.** Human safety briefings with verified teach-back in a language each worker understands. Attendance without location, kept separate from the employer's statutory working-time register. |
| 7 | Languages | **Changed.** The UI ships in **English (main)** and **Portuguese (second)**. Internationalisation must make adding a language a catalog and review task, not a code change; see the architecture document. Message translation keeps the suggested approach: the original is shown next to the translation, and each reading language is enabled after its quality is reviewed. |
| 8 | Access, data and devices | **Accepted.** Account recovery, privileged grants and property transfer rules; offline-retention and media limits; gate and alarm codes never stored in the app; Expo SDK 58 device floors with real-device readiness checks; the Lock Screen status card optional. |

## Everything else

All other suggestions in [commercial.md](../reports/2026-11-23-open-question-suggestions/commercial.md), [workforce.md](../reports/2026-11-23-open-question-suggestions/workforce.md) and [product-and-platform.md](../reports/2026-11-23-open-question-suggestions/product-and-platform.md) are accepted as written. That includes the two that change the idea:

- **Replacement at launch comes from the provider's own crew only.** Offers to individual workers outside that crew (the vetted pool) stay off until a lawyer confirms a compliant route. If own-team cover fails, the provider proposes a revised visit, or BookBuddy introduces another verified local business under a new agreement.
- **Pricing is a per-job provider fee, tested as a hypothesis.** The first 30 completed paid jobs carry no BookBuddy fee. After that, a paid trial charges €25 plus VAT per BookBuddy-sourced, signed-off, paid job of at least €150 before VAT, billed monthly to the provider.

Suggestions that depend on the pilot plan apply once a pilot is defined (item 2). This covers continuing the paid trial "if at least three of the first five providers choose to pay".

## Follow-ups

- Add the internationalisation section to [the architecture document](../architecture/mobile-tech-stack.md).
- Spanish is not a launch UI language. Local providers and crews in Spain may need it, and with the internationalisation design it becomes a catalog to add and review.
