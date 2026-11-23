# Open-question suggestions: product and platform

These are recommendations, not legal advice. Numbers are proposed pilot thresholds or operating defaults, not measured results. Screen IDs refer to the [screen inventory](../../../design/screens/inventory.md). The [consolidated design questions](../2026-11-23-design-review-flows.md#consolidated-open-design-questions), [architecture questions](../../architecture/mobile-tech-stack.md#open-questions) and [business questions](../2026-11-21-builders-company-idea.md#open-questions) are the sources. Commercial and workforce policy, including briefing and attendance rules, are covered separately; this report deals with their product and platform boundaries.

## Access, identity and local data

### 1. Email challenge and lost-mailbox recovery

**Question:** When do verification codes expire, when may users resend or try again, and how can support recover a lost account? [S-01–S-09 specs, SA1](../../../design/screens/shared/S-01_S-09-specs.md#open-design-questions); S-02, S-03, S-16; S-05 invitation reissue.

**Suggested answer:** Use a random six-digit, single-use code, valid for **10 minutes** and bound to the email and sign-in attempt. Allow resend after **60 seconds**, with **three sends total in 30 minutes** per address and separate device/source throttles. A successful reissue invalidates the previous code without resetting failures. After **five failed checks** in that window, pause checking and reissue for **15 minutes**, with a neutral message and a retry time in the viewer’s zone. Store no plaintext codes or challenge values in logs. Treat email as low-assurance sign-in. Before activating admin or other high-impact grant powers, require a recent passkey check where proven or route the operation through independently verified local operations. For loss of mailbox access, accept a previously enrolled passkey plus verification of the new address; otherwise do not transfer the account. An authorised sender can withdraw and reissue a *pending invite* to a newly verified address. For existing business/property responsibilities, use the verified transfer paths below, not a recovery shortcut. Never accept a forwarded invite, a name, an address, a screenshot or a call from a new number as recovery proof. Audit verified address changes, notify the old address and revoke old sessions.

**Why:** A short code with bounded attempts fits the proposed sign-in UI without making a support conversation a way to take over a business or property. Recovery and an invitation reissue change different things.

**Alternatives:** Passkey-first for all accounts; more assurance, but test cross-device onboarding and keep a supported accessibility/recovery path.

**Evidence:** [Identity and onboarding rules](../../../design/foundation/information-architecture.md#onboarding-sign-in-and-language); [NIST SP 800-63B-4, §3.1.3 (July 2025)](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/#out-of-band): email is not an acceptable out-of-band authenticator in that standard; address validation is distinct. The recommendation does not claim a NIST assurance level.

**Confirm with:** Security reviewer; support lead; an end-to-end sign-in and recovery check on the oldest supported phones and owner web. **Confidence:** Medium.

### 2. Provider grants and protected responsibility

**Question:** Which grants can a provider admin issue alone, and what protects the last admin or only accountable foreman? [Provider specs, P1](../../../design/screens/shared/P-01_P-05-specs.md#open-design-questions); P-02, P-03, P-05, S-05, S-17.

**Suggested answer:** An approved admin may invite a Worker or a verified Foreman into that business, give the foreman responsibility for named jobs through P-02, and grant Job chat on those jobs only when needed. Accepting membership never grants task eligibility, a paid decision, Crew-only chat, another business, quote publication or another person’s sign-off. Local operations verifies every new admin, any delegated publishing authority, and any emergency transfer. Require the incoming admin to accept and be verified before ordinary removal of the last admin; require a currently eligible foreman to accept each open job before ordinary removal of the sole accountable foreman. For a safety or security suspension, remove access immediately and put the responsibility into an explicit local-service exception; pause the affected commitments until replacement is confirmed. Always show the blocked responsibilities before ordinary revocation; audit grant changes. No self-escalation or self-approval by switching roles.

**Why:** Businesses should manage ordinary memberships without a local-service queue. Handing out control of the business or leaving a live job without a named accountable person is a different decision.

**Alternatives:** Local operations approves every grant; reasonable during the first week of the pilot, too slow as the default.

**Evidence:** [Role permissions and separation of duties](../../../design/foundation/personas-and-roles.md#mobile-roles-and-guardrails); [P-05 invitation/edit contract](../../../design/screens/shared/P-01_P-05-specs.md#p-05--invite-or-edit-membership-sheet); [GDPR, 27 April 2016, arts. 5, 25 and 32](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng).

**Confirm with:** Local operations and security reviewer; test attempted self-escalation, parallel removal and suspension without replacement. **Confidence:** High.

### 3. Property validation, invitations and transfers

**Question:** Which address checks and invite limits apply? Who can archive or transfer the property’s last manager? [Customer follow-up specs, CB3](../../../design/screens/customer/C-09_C-17-specs.md#open-design-questions); C-03, C-13, C-14, S-05, S-17.

**Suggested answer:** Validate a normalised service address and an owner-confirmed map pin against the catchment online on creation or change; store the result, and send rural, ambiguous or conflicting addresses to local operations. Geocoding checks serviceability, not ownership; a duplicate must not reveal another account. Before delegating control, accept an existing verified owner or have operations verify a redacted authority document through the secure back-office route. Start with **five outstanding invites per property**, **one pending invite per email per property**, **48 hours** per link, and **two reissues per recipient in seven days**, no sooner than **15 minutes** apart. A reissue withdraws the old link. Default to view-only without historical job access; grant request, approval, sign-off, payment and delegation separately, and only within the inviter’s authority. Only the verified owner or verified successor with equivalent authority may archive, only when no live jobs or unresolved cases remain; authorised archive history is read-only. The current owner confirms a successor who verifies and accepts before the last manager grant is removed. If the last manager cannot act, operations verifies authority independently before transfer or leaves the record restricted.

**Why:** An address pin and a verified email solve logistics and delivery, not the right to act on someone else’s property. Explicit handover protects absentee owners without making every ordinary invite a manual review.

**Alternatives:** One property manager per property and no self-serve delegation until the pilot proves the ownership checks.

**Evidence:** [Customer property capabilities](../../../design/foundation/personas-and-roles.md#mobile-roles-and-guardrails); [verified invitation flow](../../../design/screens/shared/S-01_S-09-specs.md#s-05--accept-an-invitation); [architecture: stored address and pin](../../architecture/mobile-tech-stack.md#sources-of-truth).

**Confirm with:** Local operations and Spanish privacy counsel define accepted proof and deletion; exercise ambiguous addresses, simultaneous invites and last-manager handoff. **Confidence:** Medium.

### 4. Offline switching, safe drafts and device retention

**Question:** Which contexts may switch offline, what survives on a personal or shared device, and what happens on expiry or revocation? [Consolidated questions, CA2/SA2/SB3](../2026-11-23-design-review-flows.md#access-identity-and-local-data) and [mobile architecture](../../architecture/mobile-tech-stack.md#open-questions); S-06/S-07, C-02–C-04/C-14, W-04/W-06/W-09, S-14/S-15.

**Suggested answer:** **No offline role/business switches at launch.** On a locked, individually assigned native device, retain a minimum read-only copy for the *already active* context for **72 hours from its last successful authorisation sync**: job/shift reference, task, safe arrival note, site time, scoped assignment/contact route, and last-confirmed briefing/hold state. Stale data never clears a hold. A Customer draft may keep description, property reference or manually entered address pending validation, safe handoff note, contact choice by reference, captions and permitted files. Drafts not submitted for sync expire after **14 days without edits**, with expiry visible and warnings from day **11**; preview/download cache for received media is session-only. Exclude door/keybox codes, alarm details, identity and eligibility documents, full archived threads and payment credentials. No persistent customer job/attachment cache on shared browsers or multi-user phones. Give field workers who must operate offline their own provider-issued device or an approved manual route rather than sharing an account. Allow only one named account per offline session; protect data with OS-backed keys and exclude it from device backups. Use the native staged-file/SQLite outbox; retain pending attendance, submitted uploads and uncertain sends separately from discardable drafts until acknowledged or resolved. Surface unresolved items to the author at **seven days**; require an approved reconciliation disposition by **30 days**, not silent deletion of the only record. When access expires unseen offline, stop showing the snapshot; on reconnect, apply revocations and remove affected copies before display, and do not retry unauthorised uploads. Sign-out guards unsent work; no automatic send or silent discard.

**Why:** An offline phone cannot prove a grant has not changed. A short clock on cached reads and a separate durable outbox protect privacy without treating queued evidence as expendable.

**Alternatives:** Online-only app sessions on every device; simpler, but unusable for key field work in dead zones.

**Evidence:** [Offline sync and media architecture](../../architecture/mobile-tech-stack.md#critical-data-paths-and-call-budgets); [foundation offline rules](../../../design/foundation/core-flows.md#shared-state-and-offline-rules); [GDPR arts. 5, 25 and 32 (27 April 2016)](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng).

**Confirm with:** Privacy/security reviewer and crew leads; cold-start and reconnect under revocation on the signed builds, including a pending attendance event on a device with no signal. **Confidence:** Medium.

### 5. Restricted property access instructions

**Question:** Where may the service collect and show restricted entry information? [Customer intake, CA2](../../../design/screens/customer/C-01_C-08-specs.md#open-design-questions) and [shared media/help, SB3](../../../design/screens/shared/S-11_S-17-specs.md#open-design-questions); C-03/C-14, W-04/W-09, S-10/S-14/S-15/S-16.

**Suggested answer:** Prefer a named person meeting the confirmed crew; permit only non-secret notes such as “meet at the gate” in the product. If a secret is indispensable, use a scheduled live handoff by the verified owner, property manager or foreman to a verified, currently assigned recipient shortly before entry. Record **who arranged the handoff and when**, not the secret. No access codes in forms, voice notes, images, chat, translation, notifications or cache; prompt strongly at capture and give a secure removal/escalation route if someone sends one accidentally. If contact cannot be verified, hold entry rather than do an offline override. Reuse the workforce-approved contact channel without exposing personal numbers.

**Why:** Keeping secrets out of the pilot avoids storing reusable credentials in records that outlive the visit. A human handoff is workable at five providers and supplies evidence about whether a vault is actually needed.

**Alternatives:** A separate online-only vault with expiring, per-shift grants and immutable access logs, after a privacy/security review.

**Evidence:** [Foundation time and sensitive-data rules](../../../design/foundation/core-flows.md#shared-state-and-offline-rules); [notification contract](../../../design/foundation/information-architecture.md#notification-and-deep-link-contract); [GDPR arts. 5 and 25 (27 April 2016)](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng).

**Confirm with:** Property managers, provider leads and security/privacy review; test an absentee-owner visit with the worker offline and no safe entry method. **Confidence:** High.

### 6. Read state across devices and accepted alerts

**Question:** When is something read, how does that propagate, and where does an accepted-membership alert lead? [Shared access specs, SA3](../../../design/screens/shared/S-01_S-09-specs.md#open-design-questions); S-05, S-08–S-10, P-03.

**Suggested answer:** Keep a server high-water message position per person and authorised thread audience within role/business. Advance to the highest contiguous message presented or explicitly marked read; fetching, previews and opening an inbox do not count. Keep event IDs for individually read alerts; mark an alert only when its checked target is presented. Merge offline reads monotonically in the normal sync batch when still authorised, using the existing foreground change hints for active clients. Do not poll, send a write per bubble, or let a read mark count as acknowledgement. Accepted-membership alerts open **current access status**: S-05 read-only status for the recipient (S-16 if restricted) or the scoped member in P-03 for an authorised admin. Include the dated acceptance as history only if still permitted. After revocation, show a generic access-unavailable state and clear stale inbox detail; neither path accepts again.

**Why:** Access can change long after the original invitation. A current status answers “what can I do now?” while keeping the history and unread behaviour consistent across devices.

**Alternatives:** Read-only invitation receipt as the destination; useful for audit but it must not imply current access.

**Evidence:** [Inbox and alert targets](../../../design/screens/shared/S-01_S-09-specs.md#s-09--notifications); [authorised link contract](../../../design/foundation/information-architecture.md#notification-and-deep-link-contract); [architecture’s sync and hint budgets](../../architecture/mobile-tech-stack.md#critical-data-paths-and-call-budgets).

**Confirm with:** Product and two-device UX/security checks for offline reading, a cold link and parallel revocation. **Confidence:** High.

## Intake, language and display

### 7. Minimum useful repair request

**Question:** Does a text or original voice description have to accompany the request? If photo-only is later useful, what else is needed? [Customer intake specs, CA1](../../../design/screens/customer/C-01_C-08-specs.md#open-design-questions); C-02, C-03, C-04, F-03.

**Suggested answer:** Require a non-blank description in any language or one successfully received original voice note. Prompt for **what is wrong, where on the property, and whether access/use is affected**; keep trade/category optional, with “Not sure.” Also require a verified in-area property and a declared arrival arrangement (including “to be arranged”). Photos are optional; retained attachments must be ready or explicitly removed before online submission. No transcription or translation is required to send, and no assessment, booking or priority is inferred from the description. If **at least five of the first 30 intake attempts** stall on description entry, trial a photo-first path with an explicit room/item, a symptom choice plus “Not sure,” access/urgency prompt and the same property/contact checks. Send photo-first work to human triage, not an instant quote. Route likely emergencies to the appropriate local route, not the pilot queue.

**Why:** A picture rarely shows when a fault occurs or how to arrange the first visit; a short recorded explanation is less burdensome than making everyone pick the right trade. F-03 can ask a focused clarification without guessing scope.

**Alternatives:** Guided form with mandatory category and symptom on every request; use only if it demonstrably reduces clarification without excluding people who cannot name the fault.

**Evidence:** [C-02 and C-04 send criteria](../../../design/screens/customer/C-01_C-08-specs.md#c-02-describe-the-job); [customer request flow](../../../design/foundation/core-flows.md#1-customer-request-booking-and-completion). Photo-only viability [unverified].

**Confirm with:** Intake foremen and customer usability observations; compare first-contact scoping and accessibility with typed, dictated and voice-only requests. **Confidence:** High.

### 8. Launch languages and fallback

**Question:** Which UI and reading languages launch, what happens on an unsupported device locale, and who reviews terminology? [Consolidated SA2/SB1/W4](../2026-11-23-design-review-flows.md#language-safety-attendance-and-media) and [architecture](../../architecture/mobile-tech-stack.md#open-questions); S-01, S-04, S-06, S-10, S-12, S-13, W-01 RTL and owner web.

**Suggested answer:** Ship complete, human-reviewed **Spanish and English UI** across native and owner web; use **English** on an unsupported first-run device, with an immediately visible Español/English selector, and preserve an explicit choice. Offer **Spanish, English, German, Romanian and Arabic** for reading in validated pairs, plus **Original only**. This is not a promise of five full UI catalogs or certified support for Moroccan Darija. Preserve original text and audio in any language. Keep preference, UI direction, actual source and declared work/briefing languages separate. Use German as the first owner UI candidate, and Romanian and Arabic as the first crew UI candidates, conditional on observed demand and a bilingual reviewer. Run the Arabic RTL/accessibility spike even before shipping an Arabic UI catalog. A bilingual local foreman and a native reviewer per enabled reading language sign off field terms; record spoken and written preferences separately, including Valencian, French, Dutch or Darija when requested, not guesses based on nationality.

**Why:** Spain’s 2024 national buyer evidence includes British and German buyers, as well as Moroccan and Romanian buyers; national affiliate origins make Romanian and Arabic/Darija plausible crew needs. Neither is a local language census. Two complete interfaces plus additional reviewed reading pairs is a better first commitment than several incomplete interfaces.

**Alternatives:** Add German owner UI and Romanian/Arabic worker UI before launch only if recruitment identifies a critical path people cannot complete otherwise and review coverage is ready.

**Evidence:** [Market research: buyer origins and crew-language caveats](../../../research/markets/markets.md#42-languages-design-for-the-actual-crew-not-a-nationality-stereotype); [Registradores 2024 national annual report](https://www.registradores.org/documents/33383/148210/ERI%2BAnuario%2B2024.pdf) (2025; nationality summary from indexed evidence); [Spanish Social Security release, 17 June 2024](https://inclusion.gob.es/w/la-seguridad-social-registra-2.790.263-afiliados-extranjeros-en-mayo-el-13-2-del-conjunto-de-trabajadores) (national foreign-affiliate origins across sectors, not local crew speech); [design localisation rules](../../../design/system/design-system.md#localisation-and-original-content). Exact catchment language mix and dialect support [unverified].

**Confirm with:** Recruited owners, foremen and workers; bilingual term reviewers, accessibility QA and local operations. Qualified human briefing coverage is a separate Workforce decision. **Confidence:** Medium.

### 9. Two-zone display and original/translation preference

**Question:** Does local time appear by default, and is “Original only” account-wide or per thread? [Shared access SA2](../../../design/screens/shared/S-01_S-09-specs.md#open-design-questions) and [shared settings SB1](../../../design/screens/shared/S-11_S-17-specs.md#open-design-questions); S-04, S-06, S-10, S-12/S-13; C-08/C-09, F-06, W-03/W-04, L-02–L-05.

**Suggested answer:** Default to **site time only**, with a named zone. Offer `Show your time as well` during setup and at the first scheduled decision where zones differ. If enabled, show device-zone time second, including the date if different; site time controls the actual decision and timer. The sign-in lockout is not a site deadline; show that in viewer time. Use one account-wide “Original only” reading preference and no thread override; S-13 links back to S-12. Otherwise label translation first, with the exact labelled original immediately below; same language appears once, and stale/pending/unavailable translation never hides the original. Audio remains playable even without a transcript. Keep changes to account settings pending until saved, not falsely applied across devices.

**Why:** One clock remains definitive and only people who need a second see it. One reading rule per account keeps the setting predictable and preserves exact wording for decisions.

**Alternatives:** Two-zone on by default for customers; or a separately labelled per-thread display override after measured demand.

**Evidence:** [Site-time and language foundation](../../../design/foundation/information-architecture.md#onboarding-sign-in-and-language); [multilingual chat rules](../../../design/foundation/core-flows.md#5-multilingual-chat-and-safety-critical-confirmation); [localisation and exact content](../../../design/system/design-system.md#localisation-and-original-content).

**Confirm with:** Owner preference and a scheduling task with UK, German and North American owners, including DST and a date rollover; verify settings stay discoverable with a screen reader. **Confidence:** High.

### 10. Translation provider and what leaves BookBuddy

**Question:** Which provider should translate, which content is eligible, and how are corrections and originals treated? [Architecture questions](../../architecture/mobile-tech-stack.md#open-questions) and [business questions](../2026-11-21-builders-company-idea.md#open-questions); C-02/C-04/C-06/C-15, F-03, S-10–S-13, S-15, W-09.

**Suggested answer:** Trial **Google Cloud Translation Advanced, pre-trained NMT at the EU multi-regional endpoint**, through the server adapter, subject to processor/security sign-off. Start with Spanish↔English and Spanish↔German/Romanian/Arabic, not every combination. Test **50 de-identified field snippets per direction** with a bilingual foreman and a native reviewer; require **≥90% usable without correction and zero critical meaning changes in the sample** (wrong negation, time, quantity or action). Disable a failing direction; check Darija separately instead of silently relabelling it Standard Arabic. Send ordinary, authorised text only, with names, access details, payment IDs and unnecessary identifiers removed; do not send audio, images, coordinates, restricted notes or safety-critical originals to the machine service at launch. Translate issued quotes/changes only as labelled reading aids after provider review, not as alternate approved terms. In S-11 use the Workforce-approved human briefing/translation record, never machine consent or acknowledgement. Store immutable originals and linked corrections; store the result with source/target, provider/model and source revision. Batch one missing authorised translation per revision and target, skip same-language/Original only, and never translate on open, blindly repeat an ambiguous paid request or infer authorisation from a cached result. If terms, quality or processing fail, show original plus the status and offer human clarification.

**Why:** A single bounded text service is testable and leaves durable history across web/mobile even when the vendor fails. A supported language code does not establish dialect quality or safe interpretation on site.

**Alternatives:** Trial DeepL for failing/non-sensitive pairs once terms and data location are confirmed; otherwise keep originals and ask for human clarification rather than calling two vendors routinely.

**Evidence:** [Stored translation and call budget](../../architecture/mobile-tech-stack.md#4-chat-and-stored-translation); [Google supported languages](https://docs.cloud.google.com/translate/docs/languages), [EU endpoints](https://docs.cloud.google.com/translate/docs/advanced/endpoints) and [data usage](https://docs.cloud.google.com/translate/data-usage) (living documentation checked 23 November 2026); [GDPR art. 28 (27 April 2016)](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng). Signed terms, field accuracy and Darija quality [unverified].

**Confirm with:** Privacy/security reviewer, bilingual reviewers, operations and the owner for running cost; test quality on consented/de-identified real phrasing before sending production text. **Confidence:** Medium.

## Devices, media and retention

### 11. Expo floors and devices to prove

**Question:** Which phones and OS versions should the first crews actually be able to use? [Mobile architecture](../../architecture/mobile-tech-stack.md#open-questions) and [attendance device research](../../../research/tech-stack/live-activities-and-geofenced-attendance.md#product-design-and-real-device-gates); W-01–W-09, F-01/F-03/F-10–F-16, S-02/S-03/S-09/S-14/S-15 and owner web.

**Suggested answer:** Keep SDK 58’s minimum install targets: **iOS 16.4+ and Android 7.0+ (API 24)**. These are SDK floors, not a claim that every plugin or unpatched handset is fit for customer data. Start field support with personally assigned or provider-issued, security-maintained handsets. Inventory the five providers’ OS, patch, OEM, storage and connection conditions before recruitment closes. On signed builds prove the install floor where available and include four field classes: the oldest supported small iPhone without Dynamic Island, a current Dynamic Island iPhone, a modest Samsung/Motorola-class Android (target **3–4 GB RAM**), and a current Pixel. Explicitly cover API 24 without assuming newer notification or transfer primitives; mark that floor unproven until exercised. Use file-backed iOS transfers and Android deferred WorkManager, plus the eligible user-initiated transfer API only on Android 14+ if useful. Where a plugin raises a floor or a cohort’s actual phones cannot pass core push, upload, sync and permissions, switch the adapter, supply a suitable handset or use the documented manual workflow; do not promise web-only crew dispatch. Owners can use the responsive browser portal without installing the app.

**Why:** A narrow Android fleet or simulator-only result would miss the lifecycle and storage problems the architecture is designed around. Check availability and security separately from SDK compatibility.

**Alternatives:** Publish a higher supported production floor only if signed tests, security maintenance or the actual provider fleet justifies it; publish the reason and replacement route.

**Evidence:** [Expo SDK 58 support table](https://docs.expo.dev/versions/v58.0.0/#support-for-android-and-ios-versions) (checked 23 November 2026; Android compile SDK 37 and target 36 are not device floors); [Android user-initiated data transfers](https://developer.android.com/develop/background-work/background-tasks/uidt) (checked 23 November 2026); [existing signed-build readiness criteria](../../architecture/mobile-tech-stack.md#validation-milestones). BookBuddy compatibility on real devices [unverified].

**Confirm with:** Release owner and the five providers; run the architecture’s four bounded readiness spikes and record exact plugin, OS and model. **Confidence:** Medium on the fleet and compatibility recommendation; the SDK floors are documented.

### 12. Optional lock-screen status and push readiness

**Question:** Does lock-screen shift status ship, and what proof is required for push, teardown and older OS fallback? [Live Activities and attendance research](../../../research/tech-stack/live-activities-and-geofenced-attendance.md#product-design-and-real-device-gates) and [architecture push spike](../../architecture/mobile-tech-stack.md#validation-milestones); W-04/W-06, S-09, F-13, S-11.

**Suggested answer:** Run the pilot with deliberate in-app attendance and generic ordinary alerts. Do **not** ship remote ActivityKit starts, Android 16 promotion, lock-screen mutations or background geofence reminders as part of this pilot. Offer local opt-in iOS Live Activity and ordinary Android ongoing status only if proven on signed test devices: start after deliberate check-in, display a safe alias and “Since check-in” or clearly pending sync, expire stale data, and link to the authenticated W-06 to check out. No elapsed-tick network traffic, personal detail, safety clearance or inference of payroll time. Keep the architecture’s **two-working-day push spike**: **19/20 unique alerts within 15 seconds per OS** on connected permission-enabled phones, a race/replay check and a check of the Expo path for Live Activity updates. Test optional status against the same device matrix for denied, dismissed and locked states, expiry and an iOS shift past eight hours. Require **zero** inadvertent mutations, false confirmations or false safety clearances. If remote updates are unproven but local status passes, keep it local; if local status does not pass, launch without it. Attendance and support still work.

**Why:** A status surface can reduce taps, but its expiry, OS settings and push delivery are not evidence of a state change. This keeps it off the critical path for the first crews.

**Alternatives:** In-app status only during pilot, then an opt-in field trial; background proximity only under the distinct Workforce/privacy/store gates.

**Evidence:** [Apple ActivityKit lifecycle and time limits](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities) and [Android notification permission](https://developer.android.com/develop/ui/views/notifications/notification-permission) (living docs cited in the 23 November 2026 research); [repo matrix and fallbacks](../../../research/tech-stack/live-activities-and-geofenced-attendance.md#product-design-and-real-device-gates). BookBuddy delivery and device behaviour [unverified].

**Confirm with:** Release owner and field leads; apply the signed-build criteria above. A decision on location boundaries, raw evidence and timekeeping remains with Workforce/privacy. **Confidence:** High.

### 13. Media capture limits by audience

**Question:** Which files, sizes and durations should each flow accept, and what may each audience see? [Consolidated media, CA2/SB3/W3](../2026-11-23-design-review-flows.md#language-safety-attendance-and-media), [caller matrix](../../../design/screens/shared/S-11_S-17-specs.md#s-14-attach-a-photo-or-record-audio-sheet) and [architecture upload spike](../../architecture/mobile-tech-stack.md#validation-milestones); C-02/C-16, W-07, F-03/F-04/F-13–F-15, S-10/S-14/S-15.

**Suggested answer:** Start with the following caller limits, enforced before upload. Cap pending media at **100 MiB per signed-in account on a device**, subject to available storage.

| Caller | Pilot cap | Audience after receipt |
| --- | --- | --- |
| C-02 request | **5 photos + 1 original voice note** | Authorised intake/assigned provider and the submitting customer scope, only after request submission. |
| S-10 chat | **3 photos or 1 voice note per message** | Only the exact Job, Crew or (later) Session audience; no upload from a read-only role. |
| W-07 progress | **6 photos per shift** | Named foreman on receipt; customer sees only an authorised separate share. |
| F-04/F-15 quote/change | **5 photos + 1 voice note per version** | Business review first; customer gets only what is included on the issued version. |
| F-14 completion | **8 photos per submission** | Draft stays private; only received, deliberately selected evidence goes to customer review. |
| C-16 case | **5 photos + 1 voice note per report/update** | Scoped case audience, never a chat or public review. |

Use **≤5 MiB per photo** (default JPEG, **2,048 px** long edge for new captures; let the user check legibility), and **≤2 MiB / 90 seconds** for original voice. Strip location metadata from shared photos; do not silently degrade a file needed for proof. If a detail needs higher fidelity, use a scoped case intake route rather than increasing the cap for everyone. No customer-facing video at launch: use **one 720p, 20-second, ≤20 MiB** clip in the architecture’s upload spike so the adapter proves a near-term target. Keep capture in app-owned files, stage the attachment ID and outbox transaction before saying “Saved,” transfer directly to private R2 through native file APIs, and show received only after server acknowledgement. On low storage, offer a clear keep/remove/shorter-file choice; never evict unresolved work to make room. Portal attachments use the same server caps but do not imply native offline durability on web.

**Why:** Photos and voice cover the drawn workflows, and small files are kinder to weak signal. Different callers need different audience rules, not a common public gallery.

**Alternatives:** Photo/voice only with a single five-photo cap; relax per-caller counts after recording rejected or insufficient submissions by workflow.

**Evidence:** [Media source/preview scope](../../../design/screens/shared/S-11_S-17-specs.md#s-15-media-and-original-audio-preview-modal); [durable transfer architecture](../../architecture/mobile-tech-stack.md#2-durable-media-transfer). Upload recovery, legibility and actual device storage [unverified].

**Confirm with:** Foremen, local operations and signed real-device upload spike at the limits, including interruption, force-quit recovery and no false received state. Case/completion sufficiency is a separate Commercial decision. **Confidence:** Medium.

### 14. Server retention for chat, media, exact terms and permissions

**Question:** How long are originals, stored translations, linked corrections, ordinary and evidentiary media, scope confirmations and role permissions retained? [Business open questions](../2026-11-21-builders-company-idea.md#open-questions) and [architecture](../../architecture/mobile-tech-stack.md#open-questions); S-05, S-10–S-15, C-02/C-04/C-06/C-10/C-15/C-16, W-07, F-13–F-15, P-03/P-05.

**Suggested answer:** Start a written schedule by **purpose**, not by screen. Expire abandoned, unlinked uploads after **seven days**; locally staged uploads with a pending outcome may obtain a new grant on reconciliation if still authorised. Set ordinary unselected internal progress media to **90 days after job close**; ordinary received chat, originals, translations, linked non-evidentiary corrections and attachments to **180 days after job close**. Delete derivative copies with the source unless a specific approved record needs them. At issuance or case attachment identify the minimal **record of decision**: exact original scope/change, amendments, who approved it under which grant, version/time, translation actually shown where relied on, and only the evidence selected for that decision. Preserve it under the documented contract/claims or case schedule, not the ordinary chat purge. Active grants live while valid; revoke authority immediately, retain a minimal restricted grant audit for **12 months after role end** unless a recognised record requires it longer. Before launch, approve the separate statutory, complaint/claim and safety records schedules (including backup deletion and narrow holds); apply exceptions per relevant record, not per whole chat or account. Never preserve raw location with a media or attendance record by default. Expired media shows an accurate unavailable status rather than a broken thumbnail or fake completion.

**Why:** Received evidence can outlive a local draft, but most conversation and working media need not outlive the job indefinitely. A versioned decision record preserves what people approved without turning every upload into an archive.

**Alternatives:** Use a 90-day default for all routine closed-job content if review shows that useful case evidence is reliably selected before purge.

**Evidence:** [D1, SQLite and private R2 responsibilities](../../architecture/mobile-tech-stack.md#sources-of-truth); [chat correction and audience rules](../../../design/foundation/core-flows.md#5-multilingual-chat-and-safety-critical-confirmation); [GDPR art. 5 (27 April 2016)](https://eur-lex.europa.eu/eli/reg/2016/679/art_5/oj/eng); [Spanish Civil Code art. 1964](https://www.boe.es/buscar/act.php?id=BOE-A-1889-4763#a1964) (BOE consolidated text; example of a distinct claim clock, not a blanket retention requirement).

**Confirm with:** Spanish privacy and contract counsel, Workforce counsel for statutory timekeeping/safety records, and operations for expiry/restore drills. Final production periods [unverified]. **Confidence:** Medium.

## Where to pilot and what to learn

### 15. One catchment and an eight-week go/no-go test

**Question:** Which contiguous catchment is first, and when would better local access justify a different one? [Business open questions](../2026-11-21-builders-company-idea.md#open-questions); C-01–C-09, F-01–F-07, P-01/P-02, W-01–W-07. The service area itself is a back-office decision.

**Suggested answer:** Start in the **north Torrevieja–south Guardamar del Segura corridor**, based around the La Mata side of Torrevieja. Include only addresses within a **30-minute normal one-way drive** from the local operating base and served by two approved providers for each offered scope; verify the polygon using **10 representative addresses** at proposed arrival times, not a circle or an entire province. Limit the pilot to non-emergency home maintenance and small, non-structural repair jobs within verified provider scope. No same-day cover promise. Recruit **five independent, checked provider businesses/crews**, each with a named foreman, and **25 buying accounts: 20 owner households and five property managers**, through at least **two independent referral channels**. Include remote and in-person customers. Require one accountable local lead and a named backup; apply the legally approved delivery model before taking paid jobs.

| Timebox | Work and exit criteria |
| --- | --- |
| **Weeks 1–2: readiness** | Meet the lead and five providers; confirm availability and at least two eligible providers for each offered scope; obtain commitments from at least **two repeat-customer referral partners** and **15 of the 25 buyers**, including **10 with near-term jobs**. Validate routes and on-device gates. If not met, pre-screen **Dénia–Xàbia** under the same rules. Prefer a compact **Costa del Sol** or **Mallorca** catchment only if it meets all gates and Costa Blanca cannot, or has materially better *verified* capacity (e.g. **three deployable providers per offered scope vs two** and comparable buyer commitments/drive times). No concurrent market launch. |
| **Weeks 3–6: live intake** | Aim for **30 in-scope requests**, **≥18 accepted, paid-service bookings** and **≥15 fulfilled jobs by week 8**. Among in-scope requests, **≥80%** receive a named owner and usable next step within **one business day**; among due booked visits, **≥90%** arrive within the agreed window or have a customer-approved revision **before** the window starts (report misses and revisions separately). Achieve **zero** serious safeguarding/privacy incidents, unauthorised starts, false confirmations or unapproved substitutions. Distinguish approved internal-cover attempts, pass/fail/no-route, and actual arrival; never count drills as real fills. |
| **Weeks 7–8: readout** | Target **≥4/5 providers** still actively managing jobs, and a second paid-service booking from **≥3 of the first 10** buying accounts with a full **30-day** follow-up, separating genuinely new needs from previously planned second jobs. Report numerator and denominator; if the window has not matured, mark repeat demand unproven and defer expansion. Record travel minutes, referral cost, outreach time, booked value, provider costs, coordination time, support/correction costs and founder interventions per completed job and by source. Seek **median ≤30 minutes of operator coordination per routine completed job** in the final two weeks. Never count a free platform pilot as proof of willingness to pay a platform fee. |

**Why:** Guardamar and Torrevieja have direct local seasonal-housing proxies, while Alicante leads the verified provincial foreign-purchase comparison. Recruitable supply, actual routes and repeat demand decide the launch; the statistics do not choose the neighbourhood or prove a viable margin.

**Alternatives:** Start Dénia–Xàbia if its operator/network is readier; shrink to one municipality rather than widen a catchment whose drive times fail.

**Evidence:** [Markets: housing stock and beachhead order](../../../research/markets/markets.md#11-beachhead-and-expansion-sequence); [INE 2021 census dwelling-use release, 30 June 2023](https://ine.es/en/prensa/censo_2021_jun_en.pdf) (main residence: Guardamar **26.7%**, Torrevieja **30.0%**; other uses are not all second homes or foreign-owned); [Registradores 2024 figures, published 23 April 2025](https://www.registradores.org/inicio/-/asset_publisher/bgheTCCXRtfo/content/estadistica-registral-inmobiliaria-anuario-2024) (Alicante **43.8%** foreign-national purchases, Málaga **32.4%**, all Balearics **32.6%**, not local conversion); [brief: initial provider group](../2026-11-21-builders-company-idea.md#getting-started). Actual travel, availability and local buyer mix [unverified].

**Confirm with:** Local lead, approved providers, property managers, pilot measurements and counsel-approved commercial/workforce terms. **Confidence:** Medium.

### 16. Find the repair workflow that actually hurts

**Question:** Which repair and small-renovation handoffs cause the most pain, and where does accountability get lost as staff change? [Business open questions](../2026-11-21-builders-company-idea.md#open-questions); C-02–C-10, C-15/C-16, P-02, F-03–F-06, F-10–F-16, W-03–W-07.

**Suggested answer:** Use week 1 to reconstruct the **last two comparable jobs at each of five providers** from anonymised timelines and interview **eight buyers**. Follow the 30 live requests through intake → site access/scoping → quote → schedule → change/cover → closure. For each blocked handoff log waiting time, clarification loops, operator minutes, who owned the next action and whether information had to be repeated. Start by prioritising **remote intake to one named foreman, then the approved scope and capacity-backed arrival window**; elevate change/turnover friction only if the field logs show it costs more. Use at least **three comparable incidents across two providers** before reprioritising on frequency, without waiting to fix serious incidents. Keep a named provider and accountable foreman attached to each job through transfers. Approval/charge/dispute authority follows the separate Commercial and Workforce decisions, never whichever operator is in the chat.

**Why:** Request-to-booked is the earliest point where language, access and accountability can lose customers. Measuring the whole chain gives late changes and no-cover failures a fair comparison without building the most dramatic anecdote first.

**Alternatives:** Begin with one high-volume trade only if the interviews and lead pipeline show it can supply at least half the eligible pilot requests.

**Evidence:** [Customer and provider handoffs](../../../design/foundation/core-flows.md#1-customer-request-booking-and-completion); [named roles](../../../design/foundation/personas-and-roles.md); [competitor hypothesis, not a field result](../../../research/competitors/competitors.md#9-gap-analysis). Pain ranking [unverified].

**Confirm with:** Owners, property managers and crews at week 2 and in the pilot readout. **Confidence:** Medium.

### 17. Measure actual language friction and the value of reliability

**Question:** What do people actually prefer to speak/read, how often does language break the job, and is translation itself what they value? [Business open questions](../2026-11-21-builders-company-idea.md#open-questions); S-01/S-04/S-10–S-13, C-02/C-06/C-08/C-09/C-15, F-03, W-01/W-09.

**Suggested answer:** Ask all 25 buying accounts, five named foremen and every participating worker for preferred UI/reading language and optional spoken language or dialect; ask crew separately for languages they can use for work without treating self-report as verified briefing ability. Log where language caused a clarification, failure to hire, later correction or work pause, and distinguish unavailable provider, unexplained delay and unclear accountability. In **12 exit interviews** (eight owners, two managers, two foremen), show matched examples of reliability/updates versus preferred-language assistance, then ask which they would choose at the same price and why. Record actual paid bookings separately and put any commitment-based platform-price trial under the Commercial owner. Prioritise the next locale at **five recruited active users** who need it or **three documented blocked critical tasks** in the same language, subject to qualified review; flag individual accessibility/briefing blockers immediately rather than waiting for those counts.

**Why:** National-origin proxies are useful for recruitment, not a measure of local communication failures. Observed delays, trades actually hired, and paid choices are better evidence than asking whether translation sounds useful.

**Alternatives:** Test separate landing-page pitches for reliable completion and preferred language; measure qualified requests, not clicks, with the same price and delivery on both.

**Evidence:** [Markets: language evidence limits](../../../research/markets/markets.md#6-language-skills-evidence-for-the-mismatch-with-an-important-definition-trap); [European Commission Eurobarometer 540 press release, 21 May 2024](https://ec.europa.eu/commission/presscorner/api/files/document/print/fen/ip_24_2686/IP_24_2686_EN.pdf) (general-population self-report, not a trade-language test); [product hypotheses](../2026-11-21-builders-company-idea.md#where-the-disconnect-is-most-plausible). Local rates and willingness to pay [unverified].

**Confirm with:** Pilot participants, field logs, exit interviews and the Commercial owner before interpreting willingness-to-pay. **Confidence:** Medium.

### 18. Competitor trials: role parity versus local fulfilment

**Question:** What do competitor products actually do on web/mobile and by role, and what can they deliver in this catchment? [Business open questions](../2026-11-21-builders-company-idea.md#open-questions); adjacent to C-02/C-06–C-09, F-03/F-05/F-07/F-10–F-12, W-03/W-05, S-10, L-01–L-06.

**Suggested answer:** During weeks 1–2 run a **five-working-day** scripted comparison. Use **Cronoshare and Habitissimo** for Spanish trade discovery, **Jobber and Connecteam** for team operations, and a consented local trade business using phone/chat as the baseline. Use vendor trials or consented demo roles, with no fictitious booked work or engineered cancellations. Exercise customer/provider web and mobile; for scheduling separately use manager/worker views on iOS/Android and supported web. Repeat the same legitimate scenarios: request and clarify a door repair, approve a revised scope, assign an employee, handle an unavailable assignee, and read original/translated messages with Spanish and English settings. Record observed result, plan/country/login constraints, permissions, time, support response and screenshots with no personal data. For local offer depth, compare the two Spanish services on **three matched real repairs** where the customer intends to buy. Record qualified replies after **one and two business days**, real windows, provider-confirmed language, attendance and whether a cover promise is written; follow through on the genuine booking and withdraw unused inquiries. Ask approved supply partners for actual catchment/trade coverage and historical fulfilment counts with denominator; report unavailable data as [unverified]. Compare Airbnb for later categories only if it affects that decision.

**Why:** Jobber’s booking/assignment and Connecteam’s internal messaging/cover are documented overlaps. Neither a feature matrix nor a regional storefront answers whether a customer gets a dependable repair or an eligible replacement in Guardamar.

**Alternatives:** Provider-led guided demos if trial accounts cannot represent legitimate roles; label demo results separately from independently observed behaviour.

**Evidence:** [Competitor evidence gaps](../../../research/competitors/competitors.md#10-evidence-gaps-and-limits); [role-specific player profiles](../../../research/competitors/player-profiles.md#025-connecteam); [Jobber Spanish FAQ](https://help.getjobber.com/en/articles/spanish-language-in-jobber-faq/) (undated, retained November 2026) and [Connecteam chat translation help](https://help.connecteam.com/en/articles/15013840-translating-messages-in-the-chat) (19 July 2026). Local liquidity, country/tier parity and fill rates [unverified].

**Confirm with:** Named trial owners for both sides of each workflow; local provider references and written support/cover terms. **Confidence:** High on the trial design; no trial outcomes are yet verified.

### 19. Replicate the owner operation or test employer software separately

**Question:** Can a second market run without founders, and which business should scale? [Business open questions and scaling](../2026-11-21-builders-company-idea.md#scaling); no new screens initially; P-01–P-04, F-01–F-16, C-01–C-17, W-01–W-09 are the repeatable operating flow.

**Suggested answer:** Require the first catchment to meet the pilot gates and finish **four consecutive weeks** with the local lead/backup resolving **≥90% of jobs without founder intervention** (count every escalation), and show credible positive contribution per routine job after local support, travel, provider costs and acquisition under Commercial-approved terms. Then repeat the same scorecard in **one compact Costa del Sol catchment** with its own local lead and a documented runbook; require the same no-founder target and independently recruited suppliers/buyers. Consider **one** island only after a mainland replication; test Algarve only with a Portuguese lead, local acquisition and approved local contracts. If owners rarely repeat but foremen use the scheduling/coordination tools weekly and **three compliant employer/provider businesses** agree to a paid, **six-week** software-only trial, test that product separately with no pooled dispatch or payment commingling. Measure foreman time saved and repeated weekly use before pursuing a German/Benelux operation. If neither case earns a decision, stay in one catchment rather than add categories or countries.

**Why:** A repeatable operation is one a trained local team can deliver and pay for. Employer-side demand cannot justify geographic expansion of the owner service if the users, rules and acquisition are different.

**Alternatives:** Clone to a second Costa Blanca cluster first if the operator transfer or regulatory cost of Costa del Sol makes the first replication too noisy.

**Evidence:** [Markets: expansion gates](../../../research/markets/markets.md#11-beachhead-and-expansion-sequence); [business scaling thesis](../2026-11-21-builders-company-idea.md#scaling); [Spain Ministry of Labour REA guidance](https://expinterweb.mites.gob.es/rea/pub/preguntasdetalle.htm) and [Portuguese IMPIC guidance](https://www.impic.pt/impic/faqswww/popup_construcao_ii.php) (public sources retained November 2026). No measured positive margin or second operator yet [unverified].

**Confirm with:** Pilot P&L, local lead/backup, Commercial and Workforce owners, and relevant national counsel before each new market. **Confidence:** Medium.

### 20. Later category with a reusable acquisition channel

**Question:** Which category shares customers and operations, and which qualifications, safeguarding and economics make it distinct? [Business open questions](../2026-11-21-builders-company-idea.md#open-questions) and [later-category specs](../../../design/screens/shared/L-01_L-06-specs.md#open-design-questions); C-01 and L-01–L-06. Holds, charges and listing obligations remain Commercial decisions.

**Suggested answer:** After a passing repair pilot, test **turnover cleaning** through **two property-manager partners already recruited in the catchment**, not a new consumer marketplace. Run **four weeks with two approved cleaning businesses and 15 paid turnovers**; require **≥90% on time**, no improper property entry and willingness from both partners to book again, at non-subsidised provider rates. Track acquisition, travel, supplies, re-clean/support and on-site labour separately. For the first actual L-series booking category choose **adults-only, fixed-venue small-group Pilates** once paid partner referrals are evidenced: two approved studios, **four weeks and 20 paid places** from the existing channels, no guaranteed named host or external staffing dependency. Assess contribution after studio, instruction, acquisition and support costs, and record host cancellations before adding solo massage, high-risk coaching or tours. Approve the instructor’s applicable credentials, professional liability cover, venue/accessibility and emergency/safeguarding route; do not collect medical histories for ordinary bookings. Test the Spanish/Valencian classification of fitness, any health/massage claims, tour-guide/active-tour permissions and insurance separately before offering those categories. Keep minors, care and treatment out of this pilot.

**Why:** Cleaning best reuses property acquisition, travel and access coordination; Pilates tests genuine session capacity and language at a known venue without housing-access complexity. Tourism nights, wellness expenditure and gym memberships are not evidence of local bookings for either.

**Alternatives:** Keep only repair and turnover until referrals demonstrate paid sessions; consider adults-only studio coaching instead if it has demonstrably better local supply and channel overlap.

**Evidence:** [Markets: extension economics and limits](../../../research/markets/markets.md#8-extension-categories-where-the-same-geography-helps-and-where-it-does-not); [Airbnb comparison](../../../research/competitors/player-profiles.md#055-airbnb-services--experiences); [Valencian sports professions Law 2/2022 (22 July 2022), consolidated 1 January 2024](https://dogv.gva.es/datos/consolidacion/2022/L_2022_02_ca_L_2023_07.pdf); [Generalitat sports census](https://www.gva.es/es/inicio/procedimientos?id_proc=G105482) and [tour-guide process](https://sede.gva.es/es/detall-tramit?id_proc=G105301) (living pages located November 2026). Exact pilot scope and uptake [unverified].

**Confirm with:** Property managers, licensed/insured providers, accessibility check and Spanish/Valencian sector counsel. **Confidence:** Medium.

### 21. Comparable foreign-homebuyer and second-home evidence

**Question:** What could justify Italy, Greece, Croatia, Malta or an Alpine catchment, and what denominator works for Cyprus? [Business open questions](../2026-11-21-builders-company-idea.md#open-questions); no individual screen until regional service area and localisation are chosen (C-01/C-03/C-14, L-01).

**Suggested answer:** Spend at most **five analyst days** before an expansion decision. Choose **one candidate region in each** of Italy, Greece, Croatia and Malta and one named Alpine resort jurisdiction, not the whole Alps. Request tables from land/tax registries and census authorities for **three comparable years of completed dwelling purchases** by region and buyer nationality **or** residence (keep them separate), and a separate stock table of second/occasional dwellings with a foreign-owner cross-tab. Record data year, boundaries, asset type, unit, buyer definition and coverage; publish gaps rather than rank incomparable inputs. Start with Italy OMI’s regional residential transactions, Malta NSO final deeds (not promises), Greek/Croatian land/tax authorities and resort-country registers and censuses. For Cyprus, use DLS. Its 2024 series reports **15,797 registered sale contracts** across all buyers and its foreign table sums to **6,228 properties with registered contracts of sale**. Both are closer than dividing by property transfers, but the labels use different units. Ask DLS whether one property equals one registered contract in these tables, or request distinct foreign contracts under the same scope. Until then leave the share [unverified]; if DLS confirms identical records, the ratio is **39.4%**, a registered **property contract** measure, not Spanish-style completed *dwelling* purchases or non-resident ownership stock. Keep no-data markets unranked on this measure.

**Why:** A plausible denominator is only useful if it counts the same events as the numerator. Ownership stock, foreign purchase flow and tourist traffic describe different acquisition opportunities.

**Alternatives:** Use local verified referral volumes and a small paid demand test for a candidate with no comparable registry cross-tab; explicitly state that the registry ranking remains unknown.

**Evidence:** [Market evidence gaps](../../../research/markets/markets.md#12-remaining-evidence-gaps-and-confidence); [Italy Agenzia delle Entrate OMI 2026 residential report](https://www.agenziaentrate.gov.it/portale/documents/20143/263076/RI2026_Residenziale20260521.pdf), [Malta NSO final deeds series, October 2026](https://nso.gov.mt/residential-property-transactions-october-2026/); DLS [foreign series, full-year 2024](https://portal.dls.moi.gov.cy/wp-content/uploads/2024/02/Foreign-Buyers-Sales-and-Contract-of-Sale-2024.pdf) and [all-buyer series, 2 January 2026, p. 6](https://portal.dls.moi.gov.cy/wp-content/uploads/2025/02/Contracts-of-Sale-2024-2025.pdf).

**Confirm with:** Registry analysts or written data dictionaries and a local market operator; verify property-versus-contract units with DLS. **Confidence:** Medium; the comparability rule is clear, but data availability is uncertain.

### 22. Workforce denominators and bookable service spend

**Question:** What comparable country/sector workforce and local repair/tours/coaching/massage spend can be established without proxy inflation? [Business open questions](../2026-11-21-builders-company-idea.md#open-questions); no directly affected screens; informs P-04/F-11 availability hypotheses and whether to open L-01/L-06.

**Suggested answer:** Timebox a **five-day data inventory**. For workforce context request the same year and NACE activity bands from EU-LFS or national agencies; separate citizenship and birthplace, use total employed people in the same country/sector as denominator and mark unreliable or suppressed cells. Do not merge postings, permit flows or broader household-system counts into worker shares. For the pilot collect actual paid, delivered-job values and counts net of refunds, split service from materials and label VAT treatment; supplement with **12 months of aggregate, anonymised data from five local providers per proposed category** when available, excluding club dues, accommodation and package components outside scope. Report median value, jobs per provider-month, observed seasonality, lead conversion and cost to fulfil, not “market share.” For later categories track independently bookable seats/sessions, occupancy and amount actually paid; triangulate sample coverage with local business counts but do not rank markets by extrapolated GMV from five providers. Record channels and non-response; missing exact-market spend is a result.

**Why:** Harmonised per-person denominators can describe labour composition, not ready-to-deploy local supply. Transactions and provider diaries are noisy but much nearer to bookable demand than totals for tourism or construction.

**Alternatives:** Commission a bounded representative survey after the pilot if the decision needs a defensible total market and providers cannot share comparable data.

**Evidence:** [Market measurement caveats and gaps](../../../research/markets/markets.md#12-remaining-evidence-gaps-and-confidence); [Eurostat EU-LFS research microdata](https://ec.europa.eu/eurostat/web/microdata/collections-research/european-union-labour-force-survey) and [detailed NACE business statistics, updated 30 September 2026](https://ec.europa.eu/eurostat/databrowser/view/sbs_ovw_act/default/table?lang=en) (business turnover context, not service-booking GMV). Local comparable spend and complete cross-tabs [unverified].

**Confirm with:** Market analyst, local providers and Commercial owner for comparable receipt/category definitions; no single source establishes local demand. **Confidence:** Medium; the measurement design is clear, but cross-country coverage is uncertain.

## Decide first

1. Approve the north Torrevieja–south Guardamar catchment, five-provider/25-buyer recruitment and eight-week go/no-go scorecard.
2. Approve account recovery and property/business transfer boundaries, including who can grant privileged access.
3. Approve Spanish/English UI plus the five reading languages, human reviewers and the EU text-only translation trial.
4. Approve the retention schedule, no offline role switching, no stored access secrets and caller-specific media caps.
5. Confirm SDK 58 floors and named real-device readiness lanes; ship deliberate attendance independently of optional lock-screen status.
