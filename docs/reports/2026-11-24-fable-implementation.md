# BookBuddy Fable (Beacon): overnight delivery

## Summary

BookBuddy now implements the owner-approved [Fable design](../../design-fable/screens/inventory.md) across the Hono API, four Expo role shells and the customer portal, following the [implementation plan](../architecture/fable-implementation-plan.md) and [accepted stack](../architecture/mobile-tech-stack.md). The inventory covers 73 construction and eight gated Later surfaces, including OS surfaces.
Both BB-1042 journeys passed in [round 5](2026-11-24-e2e.md#final-regression-round-5): exact-version quote issuance and approval, and approved quote through attendance, sign-off and provider-recorded payment.
The final independent review at `1cb2d65` found **no open High or Medium defects**. One Low remains in P-02’s deadline display.
**Pilot readiness is not yet proven.** The browser evidence covers the app and SQL on Bun/SQLite, not signed devices, deployed Cloudflare bindings or external delivery. See [remaining limits](#remaining-limits) and [pilot verification](#before-a-pilot).

## What was built

**Build and integration range:** 205 commits in `45d3b27..1cb2d65`. Milestones include Worker/D1 foundation `c0053cb`, typed transport `bbfa20b`, Expo shell `2d1f185`, construction flows `833f064`, portal routes `cbb025b`, and Later customer and hosting flows `329621e` and `7ac9f0a`.

- **API:** [Hono modules](../../apps/api/src/modules/) cover OTP and sessions, membership and place authority, scoped links and notifications, jobs and handoffs, quotes/changes/contract notices, scheduling, own-crew staffing and cover, field attendance and safety, aftercare and billing, chat, media, sync, realtime and Later Sessions. [Twelve handwritten SQL migrations](../../apps/api/migrations/) (`0001_identity.sql`–`0012_sessions.sql`) cover identity, access, transport, jobs, commercial, schedule, staffing, field, aftercare, conversations, evidence and Sessions. [Worker configuration](../../apps/api/wrangler.jsonc) declares D1 (`DB`), private R2 evidence (`EVIDENCE`), the WebSocket `LiveTopic` Durable Object (`LIVE`), the effect queue (`EFFECTS`) and a scheduled sweep. The [effect consumer](../../apps/api/src/effects/) and [adapters](../../apps/api/src/providers/) implement asynchronous delivery paths; configuration and code are not deployment evidence.
- **Mobile:** [Expo Router](../../apps/mobile/src/app/) uses `c` (customer), `f` (foreman), `w` (worker) and `p` (provider admin) shells, plus shared signed-in and onboarding screens. The [repository](../../apps/mobile/src/repository/) implements scoped projections, draft and outbox reconciliation, and encrypted persistence for eligible devices; the [media path](../../apps/mobile/src/media/) stages files and reconciles uploads. The construction path uses named approvers, own-crew cover, human teach-back and attendance without location, as required by the [owner decisions](../decisions/2026-11-23-open-questions.md).
- **Web:** [Portal routes](../../apps/web/src/entry/routes.tsx) cover sign-in, setup, invitations, Help, Now, bookings, requests, places, settings, notifications, messages, and job home with quote, windows, live visit, change, cancellation, withdrawal, completion/sign-off, bill, rating and cases. Public entry pages are prerendered by locale. The bill shows how to pay the provider and records the provider’s result; there is no in-app checkout ([owner decisions](../decisions/2026-11-23-open-questions.md)).
- **Shared packages:** [Design tokens](../../packages/design-tokens/), [domain rules](../../packages/domain/), [wire contracts](../../packages/api-contract/), [typed client](../../packages/api-client/) and [typed ICU catalogs](../../packages/i18n/catalogs/) are shared rather than the UI. English (`en`) and European Portuguese (`pt-PT`) are bundled for UI copy; authored text and its stored translations are separate (`6e5cc15`, `91fb83d`, `bbfa20b`, `3178f64`, `1e9c822`).
- **Later and status cards:** L-01–L-06 cover session browse, detail, slot hold, booking, booking management and hosting/roster. L-05 has booking chat and feedback; workers can reply to host offers (`47fafcb`, `a4509eb`). Sessions routes and entry points check rollout and capability (`e2e5ebe`, `949b0a5`, `8823b31`); L-07’s optional card has its own device opt-in. F-11 is a preview and guarded route only, with no external-worker dispatch backend ([F-11 source](../../apps/mobile/src/screens/f-11/Screen.tsx)). [Local iOS and Android cards](../../apps/mobile/plugins/with-live-activities/README.md) default off; remote starts/updates and migration `0013` are absent by design (`061b9d3`). Ordinary push (S-19) is separate.

### Product and visual follow-through

- Scoped shift links open the right role, and LiveTopic caps sockets per session and per business/customer bucket (`4f837d8`, `754289a`). Role switching keeps the current job, and the Foreman Jobs profile shortcut now works (`6135b88`).
- Portal Help supports signed-in and anonymous intake (`6969c0d`, `098e717`). Job Home shows a whole-job visit summary and **Choose a time** for a pending window; Now opens the exact displayed visit (`3954a99`, `4386c00`, `28ac496`). Without an explicit place, `/home` prioritizes an authorized current or upcoming booked visit (`f992238`).
- P-02 offers and reoffers handoffs, including Urgent after confirmation of the duty-line call; the displayed issued deadline comes from the command receipt (`675bfec`, `4db8d53`, `15c06a4`). P-05 atomically rejects stale role reviews (`1554599`). Customer time-zone sharing is separate from the two-clock preference and defaults off (`754289a`, `0a24c1f`, `437e9db`).
- The parity pass compared and adjusted the remaining mobile screens, labelled the tab bars in all four roles and added the two-clock pill (`6a44a7a`, `6d57720`, `ae098a0`). [Polish captures](2026-11-24-polish/): [customer bookings](2026-11-24-polish/C-18.png), [foreman cover](2026-11-24-polish/F-10.png), [provider handoff](2026-11-24-polish/P-02.png) and [worker briefing](2026-11-24-polish/W-09.png). These and the [progress-photo](2026-11-24-screens/W-07-queued-offline.png) and [UI kit](2026-11-24-ui-kit/mobile-live.png) captures prove preview appearance, not native workflow behavior.

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

### Browser journeys

[Round 5](2026-11-24-e2e.md#final-regression-round-5) passed both BB-1042 journeys: the issue/approval baseline was `151a560`; the full approved-to-paid replay used `f992238` with unchanged client bundles. Isolated Chromium used the real role UIs and [Bun dev API](../../apps/api/dev/) with SQLite.

| Journey | Observed result |
| --- | --- |
| A — Issue → approve | The foreman issued the first €240 quote in Expo; the named approver approved the exact version in the portal. [Approval survived reload](2026-11-24-e2e-final/round5-01-approved-after-reload.png); SQLite tied it to that version and terms hash. |
| B — Approved → paid | The customer used [Job Home → Choose a time](2026-11-24-e2e-final/round5-02-job-home-pending-window.png). The worker accepted the named offer, acknowledged the briefing after teach-back and checked in without location. The Now card opened the exact [Crew on site](2026-11-24-e2e-final/round5-04-customer-on-site.png) visit. Checkout, completion and sign-off followed. The foreman switched to provider admin without losing the job, recorded synthetic payment, and the customer saw [Paid on RR-0412 after reload](2026-11-24-e2e-final/round5-05-paid-after-reload.png). SQLite linked the visit, attendance, sign-off, bill and payment. |
| Sign-out and Help | After sign-out, a protected session read returned 401 and [redirected to sign-in](2026-11-24-e2e-final/round5-06-signed-out.png). [Anonymous Help](2026-11-24-e2e-final/round5-07-anonymous-help.png) created one unattributed case; [round 3](2026-11-24-e2e.md#final-regression-round-3) also verified signed-in Help. |

[Round 7](2026-11-24-e2e.md#final-checks-round-7) separately verified that [Now opened and reloaded the exact visit](2026-11-24-e2e-final/round7-01-now-exact-visit.png) when another same-day booking existed. The browser pass did not establish the socket fallback’s cause or production call count, and did not rerun both journeys.

### Automated checks

**Final checks:** At `1cb2d65645`, 421 Bun tests across 68 files passed with zero failures. All eight workspace typechecks, the portal build, and Expo iOS and web exports passed; `i18n:check` passed with 63 unused-key warnings. No code fixes were needed, and the browser journeys were not rerun ([round 9 evidence](2026-11-24-e2e.md#final-checks-round-7), recorded in `7095eb43fa`).

[Round 7](2026-11-24-e2e.md#final-checks-round-7) had passed 414 tests across 67 files with the same check categories at `a2a4191`. The [review ledger](2026-11-24-security-review/resolution.md#integration-evidence-and-limits) records scoped follow-up checks. The independent [D1 baseline review](2026-11-24-security-review/d1-schema.md#checked-and-ok) applied all 12 migrations locally and compared 114 Drizzle tables.

## Review history and stop rule

The owner authorized work to continue after the evaluator stop. The four independent baseline reviews ([auth/session](2026-11-24-security-review/auth-session.md), [authorization](2026-11-24-security-review/authorization.md), [client privacy](2026-11-24-security-review/client-privacy.md), [D1 schema](2026-11-24-security-review/d1-schema.md)) counted 65 findings. Counts through the re-reviews were **65 → 13 → 8 → 6 → 6 → 6 → 4 → 5 → 1 → 0**. Fixing stopped when review of `1cb2d65` found no High or Medium. The [resolution ledger](2026-11-24-security-review/resolution.md) traces the fixes, including live-session push ownership (`2b734e2`, `7273a7a`), enrollment-loss revocation (`1a200c1`), and live history continuity (`1cb2d65`). The last review was static.

**Open Low:** In P-02, a 401 hides the confirmed handoff deadline, but retrying clears that error before reauthorization. The deadline can reappear while the retry is in flight and persist if it fails transiently ([`requests.ts:133–138`](../../apps/mobile/src/api/requests.ts#L133-L138)).

## Remaining limits

- **No native binary or device proof.** Full Xcode/simulator, Android SDK and Java were unavailable. Metro exports do not exercise native code. The F-18 cover card still uses segmented bars rather than dots and has no terminal snapshot. It was left unchanged because the [native card code](../../apps/mobile/modules/status-cards/) could not be compiled here.
- **No production binding or delivery proof.** Wrangler/workerd did not serve the tested app; Wrangler needs Node, and the Bun attempt failed before Hono. The local API and SQLite prove app and SQL behavior, not deployed D1, R2, Durable Objects or Queues. No real push, outbound email, Google Cloud Translation, Live Activity delivery or payment was exercised ([E2E scope](2026-11-24-e2e.md#final-regression-round-5), [readiness plan](../architecture/fable-implementation-plan.md#7-verification-and-readiness)).
- **Deployment controls remain.** Provision the LiveTopic edge rate limit and verify the deployed portal headers. Media settlement does not attest coded type or duration; free-text filters cannot guarantee no secrets, and a shared passcode is not proof of individually controlled storage ([review ledger](2026-11-24-security-review/resolution.md)). The browser walkthrough proves ordinary assignment, not replacement cover, native offline recovery or the Later journeys.

## Assumptions and decisions made overnight

- A quote expires after seven calendar days in the site zone ([deadlines](../../apps/api/src/modules/commercial/deadlines.ts)).
- The verified mailbox digest uses `accounts.email_key` for invitation matching (`2331cbe`; [identity migration](../../apps/api/migrations/0001_identity.sql)).
- Chat history is online-only; pending authored sends are not a cached history ([offline repository](../../apps/mobile/src/repository/README.md); `86354d6`).
- W-09 caches only safety content; the arrival plan is online-only. Never store access codes by policy; recognized credentials are rejected, but arbitrary free text cannot give that guarantee ([offline repository](../../apps/mobile/src/repository/README.md); [D1 finding 8](2026-11-24-security-review/resolution.md#d1-schema-review)).
- The C-09 customer live detail is online-only ([screen](../../apps/mobile/src/screens/c-09/Screen.tsx)).
- Provider overview, people and eligibility remain online-only with an explicit offline state ([P-01](../../apps/mobile/src/screens/p-01/), [P-03](../../apps/mobile/src/screens/p-03/), [P-04](../../apps/mobile/src/screens/p-04/)).
- Notification timestamps use the device zone; opened records use site time ([S-09](../../apps/mobile/src/screens/s-09/Screen.tsx); `b39cf7f`).
- Nullable `display_zone` supports the opt-in two-clock display. Sharing the customer zone with authorized foremen requires a separate, default-off preference as well (`828010c`, `541920f`, `754289a`, `0a24c1f`, `437e9db`).
- The case steward comes from `CASE_STEWARD_ACCOUNT_ID` and still needs live internal authority ([case policy](../../apps/api/src/modules/aftercare/case-policy.ts); `589f584`).
- Sign-off issues a bill only if the submitter’s hint names a live same-business billing grant; otherwise an authorized provider admin issues it in P-02 ([completion command](../../apps/api/src/modules/aftercare/completion.ts); `589f584`, `8823b31`).
- Sign-out and subsequent 401 do not clear the browser cookie; server revocation invalidates it without risking deletion of a newer login (`8823b31`; [ledger](2026-11-24-security-review/resolution.md#auth-and-session-review)).
- The pilot uses one fixed `LiveTopic` object, capped at 128 sockets with additional per-session and business/customer caps. The edge rate limit is required provisioning (`4f837d8`, `754289a`; [ledger](2026-11-24-security-review/resolution.md#auth-and-session-review)).
- Voice notes are capped at 800 kB (800,000 bytes), not trusted stream-duration validation (`b0fabdf`; [ledger](2026-11-24-security-review/resolution.md#authorization-review)).
- L-01–L-07 and F-11 ship as gated Later surfaces, not launch navigation: Sessions uses the `sessions` flag and bootstrap capability; L-07 also needs device opt-in, while F-11 uses separate capability and legal-clearance switches and remains preview-only (`e2e5ebe`, `7ac9f0a`; [F-11](../../apps/mobile/src/screens/f-11/Screen.tsx)).
- Edited the 12 prerelease migrations in place because none is deployed; use additive migrations after deployment ([ledger](2026-11-24-security-review/resolution.md#integration-evidence-and-limits); [migration convention](../architecture/fable-implementation-plan.md#conventions)).
- Native background uploads use Expo file tasks and reconcile on launch instead of the plan’s custom native recovery path ([file adapter](../../apps/mobile/src/media/files.native.ts), [transfer plan](../architecture/fable-implementation-plan.md#mobile-navigation-and-persistence)).
- Anonymous Help replay matches the operation ID and server-side input hash. The browser retains the ID, not the message body (`098e717`, `754289a`; [ledger](2026-11-24-security-review/resolution.md#auth-and-session-review)).
- A stale request can be abandoned only after definitive rejection, not while delivery is uncertain (`ccb75cf`; [ledger](2026-11-24-security-review/resolution.md#auth-and-session-review)).
- P-05 sends the reviewed grant IDs and backup state; the write batch rejects a stale review before any changes (`1554599`; [ledger](2026-11-24-security-review/resolution.md#authorization-review)).

## Before a pilot

1. Run targeted Wrangler/workerd checks; provision and verify D1, private R2, Durable Objects, Queues, ingress rate limiting, portal headers, verified links and approved provider settings ([Worker config](../../apps/api/wrangler.jsonc), [readiness plan](../architecture/fable-implementation-plan.md#7-verification-and-readiness)).
2. On signed iOS and Android builds, exercise unlock and revocation, offline attendance, transfer recovery, push ownership and delivery, accessibility and localization. Leave optional status cards and Later off unless their own gates pass ([platform milestones](../architecture/mobile-tech-stack.md#validation-milestones), [card gate](../../apps/mobile/plugins/with-live-activities/README.md)).
3. Confirm pilot coverage, duty contacts, processor approvals and supported devices before rollout ([owner decisions](../decisions/2026-11-23-open-questions.md), [plan](../architecture/fable-implementation-plan.md#8-assumptions-and-decisions-still-required)).
