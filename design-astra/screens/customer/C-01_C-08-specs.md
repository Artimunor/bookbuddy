# Customer: request a repair, review a quote and book a visit

Claire Martin requests a terrace door repair at Villa Mar in Xàbia. The eight screens cover the sequence from an unsent draft to a booked work visit. C-01 and C-05 show the booked job; C-06 to C-08 show the decisions that came before it. C-08 illustrates the optional two-zone view; the Jobs and job detail artboards show site time only. The variant artboards are alternate states, not additional routes. The service address, line-item split, voice duration and earlier timeline times are fictional fixture details.

## Rules for this slice

- **Context and navigation.** This is the Customer shell. Job, property, thread and action grants are independent. Check the intended role and record on entry, refresh and before each consequential action. An authorised but non-approving customer can read a quote; someone who loses record access sees S-16 without restricted details. On a deep link, restore the permitted parent stack. A notification opens a record, never approves or books it. Only C-01 has the tab bar. Use stacked Back on iOS and toolbar Up/system Back on Android. Dismiss an active keyboard or transient surface before popping. Back preserves eligible draft fields, attachment state and scroll position. Warn before discarding; the S-06 sign-out flow handles unsent drafts separately.
- **Offline and uncertain outcomes.** Safe draft content can be saved on this device for the current account; never cache access secrets. Cached server records show the last confirmed time and which actions need a connection. Reconnection can resume authorised media uploads and refresh records, never submit a request, approve or agree a time without an explicit tap. During a mutation, preserve its labelled action and prevent duplicate taps. If the outcome is uncertain after a timeout or app restart, check the original attempt before exposing Retry. An empty cache is not an empty list. Do not relabel an item as sent, approved or booked on tap alone.
- **Accessibility and feedback.** Use the [design system](../../system/design-system.md): 48-unit common targets, visible focus, selected state not conveyed by colour alone, and status copy outside colour/icon encoding. Announce durable transitions politely; announce blocking errors with their recovery. Haptics are optional and platform-controlled, only where noted for deliberate selection or confirmed completion. No feedback depends on haptics or motion. At large type let titles, cards, bars and actions grow or stack, keeping a scroll path to the next action. Respect Reduce Motion. In the focus sequences below, omit decorative icons, initials, separators, indicators and skeletons.
- **Language and times.** App copy follows UI locale; original prose and audio follow their source; translations follow the reading preference. Present a translation above its labelled original, not in place of it. If same language, show the source once; if pending or unavailable, keep the original readable/playable. Wrap rather than shrink for long labels or addresses. In RTL, mirror navigation, controls and row alignment; isolate job IDs, names, prices and times, and apply each original paragraph's own direction. Dates and EUR formatting follow locale without changing values. Appointments use the site date and Spain time (`Europe/Madrid`), with a full local date and time where the zone differs and the preference is enabled. Do not compute an offset from the device clock alone.

## C-01 Jobs home

![C-01 Jobs home](C-01-jobs-home.svg)

**Purpose and routes.** Customer root on launch or Jobs tab. Reopen a job, resume an unsent draft or start a repair request. Tabs open C-13 Properties, S-08 Messages and S-06 Account; the bell opens S-09 in Customer context.

**Layout and data.** Brand/region header with notification icon; page title and Filter button; brand-soft request panel; a draft section when present, then actionable jobs ahead of Upcoming; latest authorised update; Past jobs row; fixed tab bar. Use Job cards with title or draft description, property, exact stage, next step or time, job reference if issued and named foreman if assigned. Fixture: BB-1042, Terrace door repair, Villa Mar · Xàbia, Booked, Tue, 24 Nov · 09:00–10:00 Spain time, Mateo Ruiz. The latest update links to the relevant confirmed job event.

**Interactions.** Request a job opens C-02 without replacing an existing draft. A draft card returns to the latest incomplete step (or the saved review if complete). Tap a server job card anywhere to push C-05; the latest update opens its event in the authorised destination. Filter opens a Bottom sheet with property and status chips; select, Clear, or Apply to commit the filter, or Close without applying changes. Keep selected context visible after applying; preserve it and scroll on return from a job. Past jobs expands the archive list in this tab and scrolls to its heading; the row toggles back to Upcoming. Pull to refresh when online; pagination failure offers retry at the end without dropping loaded rows. Tabs preserve their allowed stacks; reselecting Jobs returns to the root. Do not trigger refresh or a haptic on tab reselection.

**States and edges.** First job shows the request panel and a short explanation rather than empty Upcoming and Latest update cards. Filtered-empty explains the active filter and offers Clear filters. An unsent draft sits separately from jobs, labelled `Draft · Not sent` or `Saved on this device`; never use an issued job ID until accepted. Decision-due cards show the exact next action the viewer can take. Upcoming contains future confirmed visits and identifies work vs assessment when needed; history uses Closed or Cancelled only from confirmed records. Cached cards show the last update, do not imply a cached next action is available, and do not reintroduce a revoked job in the latest-update card. First load preserves the section layout and announces loading; no-results copy waits for a successful result.

**Platform, access and localisation.** iOS uses native tab/sheet presentation; Android uses bottom navigation, Material modal sheet and system Back, which dismisses the filter before leaving the root. Focus: Notifications (unread count if any), title, Filter, request CTA, draft and job cards in section order, update, Past jobs, tabs. Each card is one target with stage and next step read together, not a collection of separately focusable chevrons. At large type the Filter drops below the title and card dates/zones wrap; mirror card chevrons and tab order in RTL.

## C-02 Describe the job

![C-02 Describe the job](C-02-describe-the-job.svg)

![C-02 Uploading media](C-02-describe-the-job--uploading-media.svg)

**Purpose and routes.** First step from C-01, a resumed draft, or the description Edit link on C-04. Continue to C-03 in the normal flow; when editing from Review, return to C-04 after a valid edit. Back to Jobs leaves a draft if there is content worth saving.

**Layout and data.** Stack title, step indicator (`Step 1 of 3`), Description multiline input and source label, Photos and voice section with privacy hint and attachment tray, Add photo or voice secondary button, draft/status feedback, pinned Continue. Claire writes `La porte de la terrasse coince quand je la ferme.` Photo: Terrace door photo, labelled `Added to draft` once ready; that does not mean the request was sent. Voice: 0:18, original French. The illustrated photo tile is a synthetic preview, not completion evidence.

**Interactions.** Tap the input to type or dictate in any language; the app does not change the original. Add opens S-14, which leads to the native camera/photo library or the in-app record/review controls. Permission is asked at use, not on entry. In the tray, tap a thumbnail or voice title for S-15, or Play to hear the original inline. Play becomes Pause; no autoplay. Each Remove control is named for the item. For an incomplete upload, removing the item cancels that attachment; during review this is an explicit action, never an automatic omission. If discarding the only original voice description, warn that a description will still be needed. Continue requires non-whitespace text or a valid recorded voice description; a photo alone is supplemental. If invalid, show an inline error, scroll to and focus Description, and explain the voice alternative. A captured original can advance with upload pending, but C-04 cannot send it until the upload is complete or intentionally removed.

**States and edges.** Empty: preserve space for entry, no fake attachments. Draft: show saved status only when actually saved. Mixed media: independent photo and audio states. Uploading: percentage when known; if not known, use labelled progress. Failed: keep preview and Retry/Remove. Offline: show `Saved on this device · pending sync` for queued media where permitted, and keep the request unsent. Denied camera: offer Photo Library or text; denied mic: offer text or OS settings, not repeated prompts. Picker cancel changes nothing. Transcript pending/unavailable and translation pending/unavailable do not block readiness of an uploaded original. If an attachment cannot be read after returning from the OS picker, explain and allow replacement without losing other inputs. Warn before capturing identifiable people or unrelated documents; do not solicit access codes.

**Platform, access and localisation.** Use iOS and Android system photo pickers and native permission UI. iOS edge Back or Android Back dismisses the keyboard/surface in the platform order and restores the insertion point on return. Focus: Back, step and title, Description with helper/error, attachment rows in insertion order (Preview, Play/Pause when present, Remove), Add, live draft/upload status, Continue. Quiet progress announcements at meaningful milestones, not each percentage point. Grow the editor and tray at large type; scroll the focused input above the keyboard. Read French text with its source language, keep mixed-direction captions legible, and format duration independently of writing direction.

## C-03 Property and access

![C-03 Property and access](C-03-property-and-access.svg)

**Purpose and routes.** Attach the request to the correct service address and explain safe arrival. Entry from C-02 or C-04 Edit. Continue to C-04; Back returns to C-02 or to Review as appropriate, retaining edits. Property selection links to C-13; authorised add/edit goes to C-14 and returns with the selected record, rechecked for eligibility.

**Layout and data.** Stack title and step; labelled property picker; saved address card with permitted Edit; access notes field and safe-entry hint; labelled on-site contact picker; pinned Review request. Fixture: Villa Mar · Xàbia, 12 Carrer de la Porta Verda, 03730 Xàbia, Spain (fictional); `Please meet me at the gate.`; Claire Martin · Me. The contact is for arrival planning, not a grant for that person to view the job.

**Interactions.** Open the property picker to view allowed sites and choose one or take the Add property route. For a new property, C-14 collects a name and locale-appropriate address (street, number or equivalent, locality, postal code, country; extra address lines when needed); return only after choosing the saved property. If a property change leaves previous access or contact details referring to another site, preview the change and confirm clearing those fields first. A permitted user can edit the shared property in C-14; ordinary request edits do not silently change its saved record. The contact picker supports Me, a permitted existing contact, or No one on site / To be arranged. If no one is on site, prompt for a safe handoff note or arranging access with the named contact later. Do not enter or display keys, gate codes or passwords here. Continue checks a selected, complete address and clearly identified on-site arrangement; highlight each required missing value before continuing.

**States and edges.** Known verified property uses the saved summary. New/incomplete property exposes missing fields in C-14 and doesn't present a ready address. Delegated read-only: omit shared Edit and explain the role, but allow valid request-specific notes when the request grant permits; otherwise offer S-16. Outside service area: show `This address is outside our service area` with Change property and local-service/S-16 route; no request acceptance or booking. Offline: allow review of an eligible draft using an authorised cached property, labelled `Can’t verify this address offline`; C-04 cannot send until checked. Keep unsaved input on verification errors. If address/grant changes at Review, return to this step with an explanation; do not silently send to a different site.

**Platform, access and localisation.** Use iOS sheet presentation or Android Material sheet for bounded pickers; push C-13/C-14 for longer records. Use native address/text keyboards, not a numeric-only postal keyboard. Focus: Back, title/step, Property, address and Edit if permitted, notes and hint/error, contact and helper, Review request. Expose selected property and contact states to VoiceOver/TalkBack; at large type place Edit on its own row, not on top of the address. Preserve accents, address punctuation and authored note direction; localise address order and postcode rules without rewriting the saved address.

## C-04 Review and send request

![C-04 Review and send request](C-04-review-and-send-request.svg)

![C-04 Draft saved offline, request not sent](C-04-review-and-send-request--offline-unsent.svg)

**Purpose and routes.** Last step from C-03 or a saved review. Check the details and explicitly submit a request, not a booking. Repair Edit returns to C-02; Property and access Edit returns to C-03; each returns to this review after its local checks. Back keeps the draft. A confirmed receipt replaces the request stack with C-05 and makes C-01 the parent.

**Layout and data.** Step header; clear request-not-booking statement or offline banner; The repair card with translation then matching original and media readiness/count; Property and access card with address, notes and contact; data-sharing info banner; pinned Send request. The scoped provider handling the request receives the supplied information and ready attachments; it is not publicly shared. When shown, an offline banner says `Request not sent` as well as `Draft saved on this device`.

**Interactions.** Tap the named Edit controls to change the relevant group; restore focus to that group on return. Pending/failed media gets a row with status and Review attachments, which goes to C-02 for retry or intentional removal. Finish all checks before enabling Send: valid description, current authorised and serviceable property, explicit on-site arrangement, every retained attachment ready, and verified connectivity. On tap, keep the request summary, disable repeat sends and show `Sending request…`; no second dialog is needed on this deliberate review step. Announce receipt only on server confirmation, with optional completion haptic; C-05 shows `Request sent · Not booked`.

**States and edges.** Complete online draft is ready. Incomplete sections show a specific correction link; unuploaded media is not counted as attached. Missing translation/transcript is not a request error. Offline: reason for disabled Send remains visible (not queued, no automatic send), and eligible fields remain editable. Definitive failure: `Request not sent`, persistent explanation, inputs intact, retry only when relevant; uncertain failure: `Checking whether your request was received`, no fresh send until reconciled. For a scope/address conflict, require a new review before send. If media was removed and it supplied the only valid initial description, return to C-02 instead of treating the request as complete.

**Platform, access and localisation.** Pinned action respects iOS home inset or Android gesture/button inset; the scroll region ends above it. Focus: Back, title/step, readiness or offline status, repair translation and original then media and Edit repair, property/address/notes and Edit property and access, sharing note, Send. Blocking reasons are readable even where native disabled controls are skipped. Move focus to the job stage on transition; keep edit rows and privacy copy fully readable at large text and in RTL, with address and original prose isolated.

## C-05 Job detail and timeline

![C-05 Job detail and timeline](C-05-job-detail-and-timeline.svg)

**Purpose and routes.** Authoritative stage, next action and named contact. Entry from C-01, C-14 related jobs, C-04 after receipt, or S-09/deep link after grant checks. Back returns to the actual permitted parent; a cold link can use C-01. Property link opens C-14. The foreman card opens S-10 Job conversation; it never reveals private contacts or Crew only.

**Layout and data.** Stack header with reference/property and More; job title, property link and Status badge; next-action card with context-specific recap; foreman/provider card; Timeline with event, actor when relevant and site time; related actions (quote, manage booking, change, completion, payment, review, issue) only where meaningful. Booked fixture: Mateo Ruiz · Foreman, Reformas Ruiz; next action Visit details; Tue, 24 Nov · 09:00–10:00 Spain time. Timeline newest first: visit booked at 08:36; Claire approves V1 at 08:20; request sent at 08:05, all on Mon, 23 Nov in Spain time. The timeline preserves decisions even when a later stage replaces the primary action.

**Interactions and states.** A next-action card is one target; link rows and the More menu use explicit labels. Scroll to earlier events; pull to refresh when online. Tap a linked timeline event to open its authorised record/version; events without a destination are passive. More offers Report an issue to C-16 and eligible secondary actions not already visible. Use the following transitions after authoritative updates:

| Current stage or flag | What to show and where to go |
| --- | --- |
| Request sent | `Not booked`; receipt and who will respond if known. No foreman name or chat route before the assignment/thread grant exists. |
| Scoping | Named foreman when assigned; messages/clarification, or `Review assessment time` → C-08. A confirmed assessment remains an assessment. |
| Quote ready | `Review quote` → C-06. Flag `Approval needed` only when the actor can approve; otherwise read-only quote or approver status. |
| Scheduling | `Choose a visit time` → C-08 when proposals exist; otherwise `Waiting for visit times`, with chat if available. Approved quote remains readable. |
| Booked | `Visit details` → C-09; confirmed site window, optional local time; `Cancel or reschedule` → C-17 if eligible. |
| In progress | Current progress and shared evidence only; C-09 for job-day details; `Review a change` → C-15 if issued. A crew-cover flag does not show candidate names or cancel a visit. |
| Awaiting sign-off | `Review completed work` → C-10, with issue alternative; C-11 only when the authorised bill stage permits it. |
| Signed off | Recorded sign-off; C-11 shows payment/receipt or hold only as recorded. Do not imply payment from sign-off. |
| Closed | Read-only history; optional C-12 review if eligible and not already recorded; authorised receipt link remains. |
| Cancelled | Confirmed cancellation event, affected visit and related authoritative fees/status; no booking CTA. A pending request never replaces the current stage. |
| Issue open / change or payment hold | Separate flag with affected work, payment or timing and link to C-16, C-15 or C-11 as appropriate. Do not obscure unaffected work or rewrite the previous approval. |

**Recovery and edges.** Stale data shows `Last confirmed` plus timestamp; linked cached read-only records remain discoverable if permitted. Retry missing timeline pages separately with current stage intact; initially empty timelines explain what will appear. If an old notification points to a now-superseded authorised record, show the relevant read-only explanation. On revoked or unknown access, clear the detail and use S-16; present no provider-only assignment or location-tracking data.

**Platform, access and localisation.** Native toolbar and overflow menu on each platform; system Back dismisses the menu or returns to the permitted parent and restores scroll. Focus: Back, title/reference, More, job/stage, property, next action, foreman chat, timeline events in displayed order, secondary actions. Announce true stage changes politely without jumping focus mid-scroll. At large text move badges below the title and put date plus zone on their own lines. Mirror the timeline rail and chevrons, not time ranges or job IDs.

## C-06 Quote and scope

![C-06 Quote and scope](C-06-quote-and-scope.svg)

![C-06 Superseded quote](C-06-quote-and-scope--superseded.svg)

**Purpose and routes.** Inspect a versioned offer from C-05 or an authorised quote link. When opened from the live S-09 inbox, Back restores that inbox’s filter, scroll position and focus on the triggering notification. When entered from the job or opened on cold launch, C-05 is the parent. `Review approval` opens C-07 for this exact version; Cancel restores the same quote version, position and trigger. `Ask Mateo` opens S-10 in the Job conversation and returns to the same version and scroll position. Only a fresh, authorised confirmation in C-07 records approval.

**Layout and data.** Stack header with job/property; quote card with provider, named foreman, version and total; price breakdown; Translation / Original scope and exclusions; attachment rows; approval and booking terms, Decline and Version history; pinned clarification and approval buttons. Use the cost rows and customer-visible attachments of the issued version, not the latest draft or job gallery. Show each translated cost description above its exact original where different, and the amount only once. Fixture: Reformas Ruiz, Mateo Ruiz, version 1; Labour / `Mano de obra` €160.00 and Rollers / `Rodillos` €80.00, total €240.00 EUR. Adjust the terrace door and replace the rollers; excludes glass replacement. Exact Spanish original: `Ajustar la puerta de la terraza y sustituir los rodillos.` `No incluye la sustitución del vidrio.` The fixture includes `Terrace door photo`, explicitly shared with version 1. Display issued terms and expiry when recorded, in their original language with a labelled translation; do not invent tax, expiry or cancellation terms. Approval does not take payment or book a visit.

**Interactions.** Review approval requires a fresh current, valid quote and approval grant for the property (not the quote author's own account). If the view is old, offer `View current quote`, which opens that version at its title; no direct approval from a stale link. Version history opens a bounded list of authorised versions and dispositions; selecting a version closes that list and displays the immutable record. For a long list, use a full-height sheet. `Ask Mateo` makes no commercial decision; a chat reply cannot amend a quote. `Decline quote` opens S-17 with version, property, actor and effect; submit only against the current quote online. Definitive decline shows the recorded outcome and may return the job to Scoping; a failed or uncertain decline leaves it unchanged until reconciled.

Tap an issued attachment row to open S-15 in read-only mode for that exact quote version, including when a prior version remains readable. Closing S-15 returns to the same version and scroll position and restores focus to the originating row. The viewer cannot edit, remove or replace issued evidence. The customer version includes only evidence explicitly shared in F-04; private or unreceived evidence never appears here. If issued evidence is temporarily unavailable, keep its row with an explanation and a retry or reconnect path rather than silently omitting it; if access is revoked, stop showing restricted content.

**States and edges.** Current/approvable: both clarification and approval available. Current/read-only: show `You can view this quote, but can’t approve it`; no decline/approve if the decision grant is absent; show scoped approver information only if permitted. Clarification: original and financial terms remain unchanged while the conversation is open. Superseded: read-only older total and scope, explicit replaced-by version and CTA to review it; no old decline or approve. Expired: explicit expiry in Spain time, `Ask Mateo for an updated quote`; do not relabel an expired quote as superseded unless a successor exists. Declined: show action time and actor where permitted, no repeated decline. Approved: show exact approved record, clear decision controls, point back to C-05 for scheduling; any later proposed change uses C-15. Cached/offline: show current-as-of time and disable all consequential actions until rechecked; translation unavailable keeps the original readable. If required scope, version or commercial terms cannot be retrieved, treat it as incomplete rather than asking the viewer to approve partial details.

**Platform, access and localisation.** Use native stack navigation and native/Material sheet for version history. Focus: Back, title/context, live version warning if present, quote version and total, line items, scope translation then original, issued attachment rows, terms, version actions, Ask Mateo and Review approval (or View current quote). Pair each cost description and original with the single amount for screen readers; announce the attachment name, quote version and preview action. Use tabular figures, never abbreviate the total, and stack the footer at larger sizes. Preserve precise EUR values, source/legal language and scope exclusions in both directions; numbers and currency are bidi-isolated.

## C-07 Approve current quote

![C-07 Approve current quote](C-07-approve-current-quote.svg)

**Purpose and routes.** Record explicit, authorised approval of the reviewed quote. Only C-06 opens this modal. Cancel restores the same C-06 version, scroll position and trigger. Approval success closes to C-06 with a confirmed receipt and a route to C-05 for scheduling; it does not skip to a booked screen or change where Back returns.

**Layout and data.** Confirmation dialog over a dimmed C-06, with a title, job/reference and property, version and EUR total, provider, actor/role, effects, Cancel, and the explicit `Approve €240.00` primary button. Fixture: BB-1042, Villa Mar · Xàbia; Reformas Ruiz V1; Claire Martin · Customer. Copy states that this agrees to the documented scope and price without booking a visit or taking payment.

**Interactions.** Open with focus on the title (or safer Cancel where native defaults require it). No backdrop dismissal or swipe that could accidentally confirm. Cancel/Close, Android Back and the accessibility escape gesture dismiss before submission without any change. At confirm, check actor, property authority, current version, expiry and exact terms online; submit that reviewed record, not whatever version happens to be latest. Show processing and suppress repeat taps. If the user leaves while a request is unresolved, C-06 continues to show a checking status; leaving is not undo. On an authoritative approval, announce version and amount on C-06 and optionally play a completion haptic once. Do not offer approval again for that version.

**States and edges.** Ready as shown. Changed since review: cancel the proposed decision, replace the confirmation content with a reason and `View current quote`; close to the appropriate C-06 first, where the new terms must be read before confirming. No authority: if still entitled to view, close to read-only C-06 with a reason; if record access is revoked, clear parent details and route to S-16. Network/expiry failure: say `Quote not approved` if definitive, retaining Cancel and safe retry only when the same version remains valid. For unknown outcome communicate checking, do not send again until reconciled. Offline never shows an enabled confirmation.

**Platform, access and localisation.** Use an accessible iOS confirmation presentation or Android modal dialog with predictive Back where supported; no nested dialog. Move focus inside, hide underlying controls from the accessibility tree, and restore focus to the trigger or the confirmed/invalidated status on return. Reading order: title, job/property, provider/version/total, actor, consequences, Cancel, Approve. With large type, grow toward a full-height modal, scroll the details and stack actions without truncating Cancel, the decision verb, the amount or the role. Localise the full action string, not a verb concatenated with a currency; keep amounts, job ID and source name isolated in RTL.

## C-08 Schedule a visit

![C-08 Schedule a visit](C-08-schedule-a-visit.svg)

![C-08 Proposed window no longer available](C-08-schedule-a-visit--window-changed.svg)

**Purpose and routes.** Choose or confirm a provider-proposed assessment or work window from C-05, an authorised S-09 link or a reschedule flow in C-17. Back returns to that permitted parent without changing a booking. Message Mateo opens S-10; return preserves any still-current selection. On authoritative agreement, return to C-05 with the accurate visit type/status and show C-09 only for applicable confirmed job-day details. A confirmed booking can open C-17 to manage terms or request a reschedule; dismiss that sheet before pushing C-08 again.

**Layout and data.** Stack header/ref; visit type, task/property, approved-quote badge for work; grouped local-date agenda; window cards with selected indicator, proposal status and site/local time; consequence banner; named foreman/contact; pinned confirmation. Fixture: Work visit after V1 approval, Tue, 24 Nov, 09:00–10:00 Spain time and 08:00–09:00 your time (UK). Confirm window, not an exact arrival minute or any individual worker assignment. For rescheduling, show the current confirmed window separately from candidates and mark which request, if any, is pending.

**Interactions.** Group windows by site date. A date or agenda jump scrolls to its group; with optional compact day/calendar view for many dates, keep the equivalent agenda available. A single current proposal can be preselected without acceptance; multiple choices require selection, optional restrained selection haptic and accessible radio state. No auto-book when a window is selected. Confirm validates the exact proposal, visit type, capacity and grant online; a work visit also requires the current approved scope and accountable provider. The primary label matches the effect: `Confirm assessment`, `Confirm work visit` or `Request new time` when provider agreement is still required. Before the tap state the chosen site window and whether the old time remains. `Ask about another time` is chat, not scheduling; an alternate becomes selectable only when formally proposed.

**States and edges.** Assessment only: explain that this visit scopes the repair and does not book work or imply an approved quote. Work proposal as drawn. No windows: `No visit times yet` with a named contact if available; do not enable arbitrary slot selection. Changed/expired: retire the old selection, show its former time and `Refresh windows`; if new proposals are available show them without silently selecting a replacement. Pending request or outcome check: preserve the selected window and status, disable another send, reconcile before retry. Definitive success: a confirmation persistent on C-05, plus optional completion haptic. Reschedule requested: current confirmed window stays in force until changed authoritatively (show both); cancellation needs C-17 and its own outcome. Offline cached: last-confirmed time, read-only proposals, no agreement. If time changed while submitting, explain specifically, preserve an existing confirmed booking, and require a new selection/review. If the site date differs from the viewer's, show both full dates and zones; handle DST using each visit's actual date. Do not expose coverage or pending worker details.

**Platform, access and localisation.** iOS may use native date navigation for a larger agenda; Android uses equivalent date navigation with readable agenda/text alternative, respecting system Back and bottom inset. Focus: Back, title/type/property, quote or conflict status, date headings, window choices with proposed/selected state and both time labels, consequences, Message Mateo, primary action. At large text stack the two zone lines and date controls; keep time ranges intact where possible and repeat the full accessible time context on each choice. In RTL mirror selection/radio layout, not the clock icon or internal order of dates, job IDs and time ranges.

## Open design questions

- **What counts as a sufficient initial request?** These screens accept text or a recorded voice description, with photos as supplemental evidence. Validate this with intake operations before deciding whether photo-only requests need their own route or additional metadata.
- **What draft retention and contact fields can the service support?** The flow saves draft prose and permitted media on the signed-in device and records site arrangements without storing access secrets. Confirm storage limits, retention, and the approved channel for any restricted access information before launch.
- **Which quote terms and expiry rules are mandatory, and when does rescheduling require provider agreement?** Use only issued terms and allowed transitions. The default work proposal is directly confirmable; the reschedule path shows Request new time when the issued terms or proposal state require agreement. The screen never promises an unissued new time or a fee waiver.

## Navigation

```mermaid
flowchart TD
    Jobs["C-01 Jobs home"] -->|New request / resume| Describe["C-02 Describe the job"]
    Jobs -->|Resume saved later step| Address["C-03 Property and access"]
    Jobs -->|Resume saved review| Send["C-04 Review and send request"]
    Jobs -->|Job card or update| Job["C-05 Job detail and timeline"]
    Jobs --> Properties["C-13 Properties"] & Inbox["S-08 Messages"] & Account["S-06 Account"] & Bell["S-09 Notifications"]
    Describe <-->|Attach / return| Attach["S-14 Attach"]
    Describe <-->|Preview / close| Media["S-15 Media preview"]
    Attach <-->|Review recording / return| Media
    Describe --> Address --> Send
    Send -->|Edit repair / return| Describe
    Send -->|Edit site / return| Address
    Address <--> Properties
    Address <-->|Add or edit / return| Site["C-14 Property detail"]
    Properties --> Site
    Site <--> Job
    Send -->|Confirmed request receipt| Job
    Bell --> Job & Visit["C-08 Schedule a visit"]
    Bell <-->|Warm open / Back to saved filter and position| Quote["C-06 Quote and scope"]
    Job -->|Job entry or cold-link parent| Quote
    Job --> Visit
    Inbox --> Chat["S-10 Job chat"]
    Job --> Chat
    Quote <-->|Ask / return| Chat
    Quote <-->|Issued attachment / Close to same version| Media
    Visit <-->|Ask / return| Chat
    Quote <-->|Review approval / cancel or receipt| Approve["C-07 Approve current quote"]
    Quote <-->|Decline / outcome| Decline["S-17 Confirmation"]
    Quote -->|Back after job entry or cold launch| Job
    Visit -->|Confirmed or request recorded| Job
    Job --> Day["C-09 Job day"] & Signoff["C-10 Completion"] & Payment["C-11 Payment"] & Review["C-12 Review"] & Change["C-15 Job change"] & Issue["C-16 Issue or case"] & Manage["C-17 Cancel or reschedule"]
    Change -->|Timing affected| Visit
    Manage -->|Choose another time| Visit
    Visit -->|Manage existing booking| Manage
    Address -->|Out of area / access help| Help["S-16 Help and access status"]
    Job -->|Inaccessible link| Help
```
