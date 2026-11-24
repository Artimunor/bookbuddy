# BookBuddy Fable (Beacon): overnight delivery

## Summary

The overnight build implemented the owner-approved [Fable design](../../design-fable/screens/inventory.md) across the Hono API, four Expo role shells and the customer web portal, following the [binding implementation plan](../architecture/fable-implementation-plan.md) and [accepted stack](../architecture/mobile-tech-stack.md).
The build represents 73 construction surfaces and eight Later surfaces, counting OS surfaces separately from screen folders. Later is not a launch capability.
Three BB-1042 browser journeys proved exact-version quote approval, provider issuance through customer approval, and approved quote through provider-recorded payment, on the committed snapshots in the [E2E report](2026-11-24-e2e.md).
That proof covers the app and SQL on Bun/SQLite. It does not cover signed devices, deployed Cloudflare bindings or external delivery.
**Release status: HOLD.** The independent re-review at `645d7fc` found eight open defects, including two Highs. Push can still reach a phone after same-device re-login and successful sign-out.
**Decision needed:** disable push for launch, authorize one more targeted push correction, or stop here. The evaluator recommends disabling push, then fixing the other seven defects before release.

## What was built

**Build range:** 155 commits in `45d3b27..645d7fc`. Milestones: Worker and D1 foundation `c0053cb`, typed transport `bbfa20b`, Expo shell `2d1f185`, construction role flows `833f064`, complete portal journey routes `cbb025b`, Later customer and hosting flows `329621e` and `7ac9f0a`, release security work `ccd7d6e`, `8823b31` and `9939b09`, portal polish `781a6b5`, and role-screen polish `645d7fc`.

- **API:** [Hono modules](../../apps/api/src/modules/) cover OTP and sessions, membership and place authority, scoped links and notifications, jobs and handoffs, quotes/changes/contract notices, scheduling, own-crew staffing and cover, field attendance and safety, aftercare and billing, chat, media, sync, realtime and Later Sessions. [Twelve handwritten SQL migrations](../../apps/api/migrations/) (`0001_identity.sql`–`0012_sessions.sql`) cover identity, access, transport, jobs, commercial, schedule, staffing, field, aftercare, conversations, evidence and Sessions. [Worker configuration](../../apps/api/wrangler.jsonc) declares D1 (`DB`), private R2 evidence (`EVIDENCE`), the WebSocket `LiveTopic` Durable Object (`LIVE`), the effect queue (`EFFECTS`) and a scheduled sweep. The [effect consumer](../../apps/api/src/effects/) and [adapters](../../apps/api/src/providers/) implement asynchronous delivery paths; configuration and code are not deployment evidence.
- **Mobile:** [Expo Router](../../apps/mobile/src/app/) uses `c` (customer), `f` (foreman), `w` (worker) and `p` (provider admin) shells, plus shared signed-in and onboarding screens. The [repository](../../apps/mobile/src/repository/) implements scoped projections, draft and outbox reconciliation, and encrypted persistence for eligible devices; the [media path](../../apps/mobile/src/media/) stages files and reconciles uploads. The construction path uses named approvers, own-crew cover, human teach-back and attendance without location, as required by the [owner decisions](../decisions/2026-11-23-open-questions.md).
- **Web:** [Registered portal pages](../../apps/web/src/entry/routes.tsx) cover sign-in/code/setup, invitations, Now, bookings, request describe/place/review, places and permissions, settings, notifications and opaque links, messages/threads, and job home with quote, windows, live visit, change, cancellation, withdrawal, completion/sign-off, bill, rating and cases. Localized public entry pages are prerendered separately. The bill shows payment directions and records the provider’s result; there is no in-app checkout ([bill page](../../apps/web/src/portal/bill/); [owner decisions](../decisions/2026-11-23-open-questions.md)). The registered portal Help route is still empty ([route body](../../apps/web/src/portal/_pending/route.tsx)).
- **Shared packages:** [Design tokens](../../packages/design-tokens/), [domain rules](../../packages/domain/), [wire contracts](../../packages/api-contract/), [typed client](../../packages/api-client/) and [typed ICU catalogs](../../packages/i18n/catalogs/) are shared rather than the UI. English (`en`) and European Portuguese (`pt-PT`) are bundled for UI copy; authored text and its stored translations are separate (`6e5cc15`, `91fb83d`, `bbfa20b`, `3178f64`, `1e9c822`).
- **Later and status cards:** L-01–L-06 cover session browse, detail, slot hold, booking, booking management and hosting/roster. L-05 has booking chat and feedback; workers can reply to host offers (`47fafcb`, `a4509eb`). Sessions routes and entry points check rollout and capability (`e2e5ebe`, `949b0a5`, `8823b31`); L-07’s optional card has its own device opt-in. F-11 is a preview and guarded route only, with no external-worker dispatch backend ([F-11 source](../../apps/mobile/src/screens/f-11/Screen.tsx)). [Local iOS and Android cards](../../apps/mobile/plugins/with-live-activities/README.md) default off; remote starts/updates and migration `0013` are absent by design (`061b9d3`). Ordinary push (S-19) is separate.

### Inventory mapping

[Beacon inventory](../../design-fable/screens/inventory.md) → [mobile screen folders](../../apps/mobile/src/screens/): **75 folders for 81 IDs**. Folder names are the lowercase IDs; the count is not a claim that all states or commands were exercised.

| Slice | IDs with folders | Count |
| --- | --- | ---: |
| Customer | C-01–C-18 | 18 |
| Foreman | F-01–F-18 except F-18; F-11 is Later | 17 |
| Worker | W-01–W-10 | 10 |
| Shared | S-01–S-18 | 18 |
| Provider admin | P-01–P-05 | 5 |
| Sessions | L-01–L-07; L-07 is system-card UI and preview | 7 |

| ID without a folder | Where it lives |
| --- | --- |
| C-19 | iOS visit Live Activity. Opt-in starts from [C-09](../../apps/mobile/src/screens/c-09/Screen.tsx); rendering uses the [status widget plugin](../../apps/mobile/plugins/with-live-activities/). |
| C-20 | Android visit notification. Same C-09 opt-in and [status-card host](../../apps/mobile/src/system/status-cards/); rendered by the [Android module](../../apps/mobile/modules/status-cards/android/). |
| F-18 | Cover-search OS card. Starts from [F-10](../../apps/mobile/src/screens/f-10/Screen.tsx) through the shared [status-card host](../../apps/mobile/src/system/status-cards/), with native renderers. |
| W-11 | iOS shift Live Activity. Started by opted-in check-in in [W-06](../../apps/mobile/src/screens/w-06/Screen.tsx), through the status host and widget. |
| W-12 | Android shift notification. Same W-06 opt-in, through the status host and Android module. |
| S-19 | OS push banners from the [API dispatch path](../../apps/api/src/effects/push.ts) and [mobile push registration and tap handling](../../apps/mobile/src/system/push/), not an in-app screen. S-09 is the in-app inbox. |

## Proof

**Automated and build evidence, by snapshot.** The [integration ledger](2026-11-24-security-review/resolution.md#integration-evidence-and-limits) records 343 Bun tests across 53 files at `ff688c2` (342 passed; one bad Later fixture), then 26/26 affected auth/booking tests after `40c601c`; TypeScript was green in all eight workspaces across the original and targeted checks. Locale validation, Vite/prerender (14 documents after repair) and both Expo exports passed. Later targeted evidence: `8823b31` recorded 157 initial API passes and all 16 affected failures passing after fixes, plus API/domain/contract typechecks; `9939b09` passed 51 affected mobile tests and mobile TypeScript; `ae2d251` passed five portal session tests and web/i18n typechecks. The polish snapshots `781a6b5` and `645d7fc` passed the relevant web/mobile typechecks, `i18n:check` and their web build/Expo web exports. These are scoped checks, not one cumulative pass count; locale checks have reported unused keys. The independent [D1 review](2026-11-24-security-review/d1-schema.md#checked-and-ok) separately records 32 local tests across eight files and 114 Drizzle tables compared at its baseline.

| Browser journey | Observed result |
| --- | --- |
| [Portal approval](2026-11-24-e2e.md#portal-quote-approval-bb-1042) · `813f85e` | Named approver approved issued v1 at €240; the [approved state survived reload](2026-11-24-e2e/03-approved-after-reload.png). SQLite tied the decision to the exact version, grant and terms hash. |
| [Provider issues, customer approves](2026-11-24-e2e.md#provider-issues-then-customer-approves) · `e266d94` | From a finished assessment with no quote, the foreman entered two lines and [confirmed issuance](2026-11-24-e2e-issue/02-provider-issue-confirmation.png) in the Expo web export. The portal approving customer saw [the same v1 after reload](2026-11-24-e2e-issue/06-customer-approved-after-reload.png). |
| [Approved quote to paid](2026-11-24-e2e.md#approved-quote-to-paid-bill) · `cd260bf` | Confirmed the first work window and ordinary named assignment, recorded teach-back and the worker’s acknowledgement, checked in with no location and saw [Crew on site](2026-11-24-e2e-paid/05-customer-on-site.png). Finished and checked out; customer [signed off](2026-11-24-e2e-paid/08-customer-signoff.png). Provider admin recorded the synthetic €240 payment, and [bill RR-0412 showed Paid after reload](2026-11-24-e2e-paid/10-customer-paid-after-reload.png). SQLite linked all those records to BB-1042. |

**[Final regression](2026-11-24-e2e.md#final-regression): passed** on `645d7fc`, recorded in `9bdec8241a`. Both journeys reran without source fixes: [Expo quote issuance](2026-11-24-e2e-final/01-provider-issue.png) through [portal approval after reload](2026-11-24-e2e-final/03-approved-after-reload.png), and approved quote through window, crew acceptance, briefing, no-location attendance, completion, sign-off and [Paid on RR-0412 after reload](2026-11-24-e2e-final/09-paid-after-reload.png). SQLite reconfirmed the linked records. [Portal sign-out](2026-11-24-e2e-final/10-signed-out.png) revoked the session: a protected page returned 401 on the session read and redirected to sign-in.

Final checks: **364 Bun tests passed across 56 files; 8/8 workspace typechecks passed**. The portal build and both Expo iOS and web exports passed; `i18n:check` passed with 58 unused-key warnings. The root `typecheck` alias references a missing helper, so each workspace was checked directly.

Visual samples, not workflow proof: [polished mobile live visit](2026-11-24-polish/C-09.png), [polished portal quote](2026-11-24-polish/web-C-06.png), [offline progress-photo preview](2026-11-24-screens/W-07-queued-offline.png), [vetted-pool fixture](2026-11-24-screens/F-11-matches.png), [mobile live UI kit](2026-11-24-ui-kit/mobile-live.png) and [web UI kit](2026-11-24-ui-kit/web-gallery.png).

**Not verified:** No native iOS or Android binary or device run. This machine had no full Xcode/simulator, Android SDK or Java; Metro exports do not compile or exercise the native app. No successful Wrangler/workerd application run: Wrangler needs Node, and the Wrangler-under-Bun attempt failed before Hono. E2E used the [Bun-native dev server](../../apps/api/dev/) with real Hono routes and Bun SQLite, which proves application logic and local SQL, not Workers/D1 bindings. No deployed D1, R2, Durable Objects or Cloudflare Queue delivery was exercised. No real push, Postmark email, Google Cloud Translation or Live Activity delivery was exercised; no money moved. The named-assignment walkthrough is not proof of replacement cover, native offline recovery or the Later journeys. Sources: [plan readiness](../architecture/fable-implementation-plan.md#7-verification-and-readiness), [E2E coverage](2026-11-24-e2e.md), [review limits](2026-11-24-security-review/resolution.md#integration-evidence-and-limits), [device gate](../../apps/mobile/plugins/with-live-activities/README.md).

## Independent review

**65 initial numbered findings → 13 after the first re-review → 8 remaining at `645d7fc380b4be220481b9fcd31ec7b17771a178` (2 High, 6 Medium).** The four independent baselines cover [auth/session](2026-11-24-security-review/auth-session.md), [authorization](2026-11-24-security-review/authorization.md), [client privacy](2026-11-24-security-review/client-privacy.md) and [D1 schema](2026-11-24-security-review/d1-schema.md). The [resolution ledger](2026-11-24-security-review/resolution.md) records dispositions through the second correction. The table below supersedes earlier ledger closures where the final static re-review found a remaining path; it does not imply runtime proof.

| Severity | Remaining defect at `645d7fc` | Source |
| --- | --- | --- |
| High | **Push can continue after successful sign-out.** A same-device replacement session can skip registration for the existing account/token; it cannot revoke the old owner’s row, and dispatch does not require a live owning session. | [`mobile/system/push/index.ts:45–55`](../../apps/mobile/src/system/push/index.ts), [`api/effects/push.ts:22–29`](../../apps/api/src/effects/push.ts) |
| High | **Cold restore can bypass unlock after device enrollment is lost.** An ineligible device receives a memory store and the saved bearer can be rebound online without the required unlock. | [`mobile/repository/open-policy.ts:24–30`](../../apps/mobile/src/repository/open-policy.ts), [`mobile/session/provider.tsx:101–108,194–201,235–242`](../../apps/mobile/src/session/provider.tsx) |
| Medium | **Chat photos and voice previews are unavailable.** S-10 uses the thread ID for grants and the S-15 handoff; authorization requires the entry ID. | [`mobile/screens/s-10/Screen.tsx:70–74,142`](../../apps/mobile/src/screens/s-10/Screen.tsx), [`api/media/policy.ts:131–134`](../../apps/api/src/modules/media/policy.ts) |
| Medium | **A revoked shift card can survive successful sync.** The last snapshot page can report more work only because deltas are pending, so neither it nor the next delta journals the stop. | [`api/sync/read.ts:242–251`](../../apps/api/src/modules/sync/read.ts), [`mobile/repository/repository.ts:942–949`](../../apps/mobile/src/repository/repository.ts) |
| Medium | **Signed-out browser support is blocked.** A retained revoked cookie selects authenticated intake instead of explicit anonymous intake. | [`api/jobs/routes.commands.ts:79–93`](../../apps/api/src/modules/jobs/routes.commands.ts) |
| Medium | **Customers cannot open voice evidence on a quote.** C-06 renders an opener only with a photo URL, and the thumbnail batch excludes voice grants. | [`mobile/screens/c-06/Screen.tsx:46–50,97–101`](../../apps/mobile/src/screens/c-06/Screen.tsx), [`mobile/media/read-batch.ts:122–129`](../../apps/mobile/src/media/read-batch.ts) |
| Medium | **An unusable billing hint still reserves its invoice number.** Reservation accepts a historical grant even when the issuer can no longer issue the invoice. | [`api/aftercare/invoice.ts:46–51`](../../apps/api/src/modules/aftercare/invoice.ts), [`api/aftercare/bills.ts:175–179`](../../apps/api/src/modules/aftercare/bills.ts) |
| Medium | **Stored request fingerprints disclose predictable private input.** The browser’s stored digest can confirm guesses about short request text; persist only opaque retry state and compare payloads server-side. | [`web/portal/session/pending-request.ts:5–17`](../../apps/web/src/portal/session/pending-request.ts), [`pending-storage.ts:89–113,125–129`](../../apps/web/src/portal/session/pending-storage.ts) |

### Other open product and rollout gaps

- **Navigation and recovery:** Scoped chat, job-update, visit and cover links landed, but the [access registrations](../../apps/api/src/modules/access/links.ts) have no generic direct shift-link resolver. Portal Help is empty. In the [final regression](2026-11-24-e2e.md#final-regression), Job Home had no pending-window link and Now did not show the job's live card, so the protected window and live pages were opened directly. The foreman role switch required reopening the job from Jobs. The [earlier paid walkthrough](2026-11-24-e2e.md#approved-quote-to-paid-bill) also recorded an unmatched Foreman Jobs profile shortcut.
- **Polish and proof:** The portal’s Now/Jobs two-clock path landed, and role/shared polish covered priority screens; visual parity, two-clock placement and batched attachments still need an inventory-wide pass, not a claim from the sampled [polish](2026-11-24-polish/) and [screen evidence](2026-11-24-screens/). The two observed attachment failures are in the table above.
- **Pilot constraints:** The shared 128-socket LiveTopic pool still lacks tenant isolation and the documented edge rate limit needs provisioning ([ledger](2026-11-24-security-review/resolution.md#auth-and-session-review), [pilot topic](../../apps/api/src/realtime/topics.ts)). Media settlement does not attest coded type/duration, free-text filters cannot guarantee arbitrary secrets are never stored, and a shared passcode is not proof of individually controlled storage ([ledger](2026-11-24-security-review/resolution.md)). The custom native transfer recovery path specified in the [plan](../architecture/fable-implementation-plan.md#mobile-navigation-and-persistence) is not evidenced: the current [native file adapter](../../apps/mobile/src/media/files.native.ts) uses Expo file upload tasks.

## Why work stopped

The evaluator stopped work before a third correction to the same push-ownership design. Two rounds changed ownership recording and revocation (`828010c`, `ccd7d6e`, `8823b31`), but the original acceptance condition still fails in the static review at `645d7fc`: same-device re-login followed by successful sign-out can leave an installation eligible to receive push. The issue is the repeated failure of that condition, not the overall decline in findings. The evaluator’s simpler alternative is to disable push delivery for the first release. That contains the push exposure; it does not close the cold-restore bypass or the six Mediums.

## Decision for the owner

| Option | Cost and what remains open |
| --- | --- |
| **A — Disable push for launch (recommended by the evaluator).** | Verify the delivery gate blocks sends, including queued work; accept no background push prompts and validate foreground inbox and human escalation instead. Then fix cold-restore unlock and all six Mediums. Push ownership stays open for any future re-enable. |
| **B — Authorize one more targeted push fix.** | Put the session ID in the mobile registration key and require a live owning session at dispatch, as the reviewer proposed. This adds implementation, independent review and same-device lifecycle/delivery proof before launch; if it fails, the push gate remains necessary. Cold restore, the six Mediums and platform readiness still need work. |
| **C — Stop here.** | No more implementation or validation. Keep the branch as a locally evidenced build, not a release candidate; all eight findings, delivery gaps and platform readiness remain open. |

For A and B alike, keep the release on hold until the remaining fixes are reviewed and the applicable [readiness gates](../architecture/fable-implementation-plan.md#7-verification-and-readiness) pass. Neither option turns a browser run into native or deployment evidence.

## Assumptions and decisions made overnight

- A quote expires after seven calendar days in the site zone ([deadlines](../../apps/api/src/modules/commercial/deadlines.ts)).
- The verified mailbox digest uses `accounts.email_key` for invitation matching (`2331cbe`; [identity migration](../../apps/api/migrations/0001_identity.sql)).
- Chat history is online-only; pending authored sends are not a cached history ([offline repository](../../apps/mobile/src/repository/README.md); `86354d6`).
- W-09 caches only safety content; the arrival plan is online-only. Never store access codes by policy; recognized credentials are rejected, but arbitrary free text cannot give that guarantee ([offline repository](../../apps/mobile/src/repository/README.md); [D1 finding 8](2026-11-24-security-review/resolution.md#d1-schema-review)).
- The C-09 customer live detail is online-only ([screen](../../apps/mobile/src/screens/c-09/Screen.tsx)).
- Provider overview, people and eligibility remain online-only with an explicit offline state ([P-01](../../apps/mobile/src/screens/p-01/), [P-03](../../apps/mobile/src/screens/p-03/), [P-04](../../apps/mobile/src/screens/p-04/)).
- Notification timestamps use the device zone; opened records use site time ([S-09](../../apps/mobile/src/screens/s-09/Screen.tsx); `b39cf7f`).
- Added nullable `display_zone` for the opt-in two-clock display (`828010c`, `541920f`).
- The case steward comes from `CASE_STEWARD_ACCOUNT_ID` and still needs live internal authority ([case policy](../../apps/api/src/modules/aftercare/case-policy.ts); `589f584`).
- Sign-off issues a bill only if the submitter’s hint names a live same-business billing grant; otherwise an authorized provider admin issues it in P-02 ([completion command](../../apps/api/src/modules/aftercare/completion.ts); `589f584`, `8823b31`).
- Sign-out and subsequent 401 do not clear the browser cookie; server revocation invalidates it without risking deletion of a newer login (`8823b31`; [ledger](2026-11-24-security-review/resolution.md#auth-and-session-review)).
- The pilot uses one fixed `LiveTopic` object, capped at 128 sockets; edge rate limiting is required provisioning ([realtime code](../../apps/api/src/realtime/); [ledger](2026-11-24-security-review/resolution.md#auth-and-session-review)).
- Voice notes are capped at 800 kB (800,000 bytes), not trusted stream-duration validation (`b0fabdf`; [ledger](2026-11-24-security-review/resolution.md#authorization-review)).
- L-01–L-07 and F-11 ship as gated Later surfaces, not launch navigation: Sessions uses the `sessions` flag and bootstrap capability; L-07 also needs device opt-in, while F-11 uses separate capability and legal-clearance switches and remains preview-only (`e2e5ebe`, `7ac9f0a`; [F-11](../../apps/mobile/src/screens/f-11/Screen.tsx)).
- Edited the 12 prerelease migrations in place because none is deployed; use additive migrations after deployment ([ledger](2026-11-24-security-review/resolution.md#integration-evidence-and-limits); [migration convention](../architecture/fable-implementation-plan.md#conventions)).

## Next steps after the decision

1. For **A**, prove push disabled at dispatch and check the foreground inbox and duty-line workflow. For **B**, prove ownership transfer and dispatch eligibility through expiry, same-device re-login, sign-out and queued work. For **C**, leave HOLD in place and do not deploy.
2. For A or B, fix cold restore and the six Mediums; get an independent review on the integrated changes and run the smallest affected regressions. Reconcile support and other [open product gaps](#other-open-product-and-rollout-gaps) before inviting pilot users.
3. Run targeted Wrangler/workerd binding checks and provision the pilot’s D1, private R2, Durable Object, queue, edge controls and approved provider settings. Verify deployed headers and verified links, not just the checked-in configuration ([Worker config](../../apps/api/wrangler.jsonc), [review ledger](2026-11-24-security-review/resolution.md), [readiness plan](../architecture/fable-implementation-plan.md#7-verification-and-readiness)).
4. Prove signed iOS/Android unlock and offline/revocation, attendance, transfer recovery, accessibility and localization. Run the signed push spike only if push is proposed for release; keep local status cards and Later unavailable unless their own gate passes. Set pilot coverage, duty contacts, processor approvals and supported devices before rollout ([platform milestones](../architecture/mobile-tech-stack.md#validation-milestones), [owner decisions](../decisions/2026-11-23-open-questions.md)).
