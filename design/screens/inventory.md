# Screen inventory

**70 surfaces:** 64 for the construction release, six category-extension surfaces for later. IDs are stable. Each row is one reviewable SVG and includes its states; do not mint IDs for state changes, platform pickers, the keyboard, payment-provider steps or local variations of the same route. **[Sheet]** means a bottom sheet, expandable or full height when needed. **[Modal]** means a separate dialog or full-screen modal. Untagged rows are tab roots, pushed screens or onboarding steps. See the [navigation contract](../foundation/information-architecture.md) and [SVG standard](../system/wireframe-conventions.md).

Design the normal state plus the states named in the row. Apply shared loading, connectivity, permissions, accessibility and recovery patterns where relevant. Use different text for a draft, an operation underway, a server-confirmed outcome and a stale view. Role abbreviations: **C** Customer, **F** Foreman, **W** Worker, **P** Provider admin, **All** authorised mobile roles. Local operations has no mobile slice.

## Customer — `design/screens/customer/` (17)

| ID | Name | Role | Purpose | Entry points | Key components | States to design |
| --- | --- | --- | --- | --- | --- | --- |
| C-01 | Jobs home | C | Resume work or start a request | Jobs tab; initial launch; post-action return | Next-action job card, filters, new-request CTA, latest update | First job, draft to resume, action due, upcoming, history, cached |
| C-02 | Describe the job | C | Capture the problem in any language | C-01 request or draft | Step header, text, photo/voice tray via S-14, S-15 preview | Empty/draft, mixed media, upload pending, saved offline, denied capture, transcript pending |
| C-03 | Property and access | C | Confirm the service address and safe access arrangements | C-02 next; C-04 edit | Property picker, address form, access notes, who is on site | Known/new property, delegated read-only, incomplete, outside service area, can't verify offline |
| C-04 | Review and send request | C | Send a request without representing it as a booking | C-03 next | Summary, edit links, data-sharing note, send CTA | Draft, required data/media pending, sending, request sent, failed/not sent |
| C-05 | Job detail and timeline | C | Show current status, next action and named contact | C-01, S-09, deep link, C-04 on receipt | Stage, timeline, actions, property, job chat link | Requested, scoping, decision due, booked, in progress, awaiting sign-off, signed off, closed, cancelled, issue open |
| C-06 | Quote and scope | C | Inspect scope, exclusions, total and terms | C-05, S-09 quote | Version badge, line items, totals, inclusions/exclusions, original plus translation, ask/approve | Current, superseded, expired, clarification, declined, authorised read-only/approvable |
| C-07 | Approve current quote [Modal] | C | Record a versioned, authorised approval | C-06 approve | Current total and version, what changes, confirm/cancel | Ready, changed since review, processing, approved, failed, no authority |
| C-08 | Schedule a visit | C | Choose or confirm a provider-proposed window | C-05, C-17 reschedule, S-09 | Visit-type label, dates/day view, arrival window and zone(s), agreement CTA | Scoping vs work visit, no windows, proposed, changed/expired, pending, confirmed, reschedule requested |
| C-09 | Job day | C | Know who is coming, when and who to contact | C-05 booked visit, S-09 day or crew update | Arrival window, confirmed foreman and arrival roster, update/status card, contact | Scheduled, delayed, cover being arranged, confirmed crew change, on site, completed |
| C-10 | Completion and sign-off | C | Inspect evidence and approve completed scope or report a problem | C-05, S-09 completion | Approved-scope checklist, photos, notes, sign-off via S-17, issue link | Awaiting review, evidence unavailable, accepted, issue opened, unauthorised |
| C-11 | Payment and receipt | C | Show the amount due and an authorised route to pay | C-05, C-10, S-09 payment | Bill summary, payment CTA, processor handoff, receipt and support | No amount due yet, due, processing, failed, paid, receipt pending, amount on hold, adjusted/refunded when confirmed |
| C-12 | Leave a review [Sheet] | C | Collect feedback after service closure | C-05 closed, completion prompt, L-05 later | Labelled rating control, optional text, send | Unrated, draft, submitting, submitted, retry, ineligible |
| C-13 | Properties | C | Find the right site across owned and managed properties | Properties tab; property shortcut in C-03 | Search/filter, property cards, add property | Empty, one/many, delegated, archived filter, offline |
| C-14 | Property detail and people | C | Maintain a site, list its jobs and manage permitted delegation | C-13, C-03 add/edit, C-05 site | Address/contact, site access notes, job list, people and permission controls | New/edit, delegated read-only, invite pending/accepted/revoked, unsaved edits, archived |
| C-15 | Review a job change | C | Compare proposed scope, cost and timing with what was approved | C-05, S-09 change | Before/after, version, original/translation, approve via S-17, reject/clarify | Open, superseded, approved, rejected, offline/read-only, issue on hold |
| C-16 | Report an issue or follow a case | C | Attach evidence and reach the local service | C-05, C-09, C-10, C-11, C-15, S-16 | Issue category, impacted item, evidence, status/history, service contact | Draft, submitted, acknowledged, awaiting response, resolved, cannot submit offline |
| C-17 | Cancel or reschedule [Sheet] | C | Show current terms and request a booking change | C-05, C-08, L-05 later | Current time/terms, consequence summary, confirm request, choose another time | Eligible, subject to provider confirmation, fee/terms changed, unavailable, requested, confirmed cancelled |

## Foreman — `design/screens/foreman/` (16)

| ID | Name | Role | Purpose | Entry points | Key components | States to design |
| --- | --- | --- | --- | --- | --- | --- |
| F-01 | Today | F | Triage the day and active coverage gaps | Today tab; launch | Day agenda, urgent cards, shift health, notification bell | No work, upcoming, conflict, gap urgent, offline/stale |
| F-02 | Jobs | F | Find incoming, active and past work | Jobs tab | Segmented job list, filters, job cards | Incoming, active, archived, no results, stale |
| F-03 | Job intake | F | Accept accountability, decline or ask for clarification | F-01, F-02, S-09, P-02 handoff | Request and evidence, property summary, accept/decline, authority cue | New, clarification needed, accepted for scoping, declined, reassigned/expired, authority missing |
| F-04 | Scope and quote editor | F | Define the work, exclusions and cost and send for approval | F-03 accepted, F-05, customer clarification | Work and cost lines, source text/translation, version, evidence, preview and publish | Draft, scoping visit needed, pending business review, sending, awaiting customer, revision superseded/approved |
| F-05 | Job control | F | Run the booking, track crew/evidence and contact the customer | F-02, F-01, S-09, deep link | Job timeline, schedule, crew, message and next-action actions | Scoping, quote out, scheduling, booked, in progress, change pending, awaiting sign-off, issue open, closed |
| F-06 | Schedule and availability | F | Propose a visit, inspect crew capacity and manage timing changes | F-04 visit needed, F-05, F-01 conflict | Calendar/day view, time-window editor, label for visit type, send proposal | Capacity known/unknown, tentative, proposal pending, agreed, unavailable/expired, reschedule needed |
| F-07 | Assign crew [Sheet] | F | Send named assignments to eligible team members | F-05, F-16 | Worker cards, skills/language filters, role/shift checklist, send offers | Eligible candidates, none, already assigned, offers pending, expired, refresh required |
| F-08 | Team roster | F | Find crew, skills, working languages and availability | Team tab; F-07 roster link | Worker cards, filters, verification summary | Active, unavailable, eligibility pending/expired, empty, filtered, offline |
| F-09 | Worker profile and availability | F | Check fit for an assignment without seeing raw credentials | F-08, F-07, F-10 | Skills, working languages, availability, approved status/valid-until | Available, conflicting, stale, restricted, not eligible |
| F-10 | Fill shift | F | Track a gap; offer to own team first, then escalate or use vetted pool | F-01, F-05, F-16, S-09 | Gap urgency, internal candidates, offer status, pool gate, support action | Gap, internal offers open, exhausted/time cutoff, external search allowed/blocked, no cover, covered |
| F-11 | Vetted pool | F | Find cover through eligible local providers only | F-10 after internal attempt/recorded cutoff | Required skills, working language and eligibility filters, available candidates, offer expiry | Eligible results, none, eligibility pending/changed, offer open/declined/expired/accepted, offline blocked |
| F-12 | Confirm replacement [Sheet] | F | Finalise exactly one accepted replacement | F-10, F-11, S-09 acceptance | Candidate/provider, eligibility and availability summary, change impact, confirm | Awaiting confirmation, no longer eligible/available, confirming, confirmed, returned to gap |
| F-13 | Site log | F | Reconcile attendance, progress photos and publication | F-05, F-16 | Time entries, evidence gallery, share-to-customer control, safety status | No entries, latest confirmed, pending/rejected, reconcile conflict, private or shared |
| F-14 | Submit completion | F | Hand finished scope and required evidence to the customer | F-05, F-13 | Scope checklist, photos, notes, review/send | Draft, evidence still uploading, change unresolved, submitting, awaiting sign-off, returned for correction |
| F-15 | Propose job change | F | Version scope, cost and timing and obtain customer approval | F-05, F-13 | Before/after comparison, responsibility, evidence, publish | Draft, sent, awaiting approval, withdrawn, rejected, approved, affected work on hold |
| F-16 | Shift detail | F | See assigned/confirmed staff, gaps and delivery events | F-01, F-05, F-13, S-09 | Shift card, task/skill, assignments, briefing status, assign/fill actions | Unassigned, offered, confirmed, dropped, checked in/out, covered, cancelled, stale |

## Worker — `design/screens/worker/` (9)

| ID | Name | Role | Purpose | Entry points | Key components | States to design |
| --- | --- | --- | --- | --- | --- | --- |
| W-01 | Today | W | See the next shift, offer or action that needs attention | Today tab; launch | Next shift card, pending offer/safety/action, sync notice | Nothing scheduled, offer, confirmed shift, needs briefing, on site, offline |
| W-02 | My shifts | W | Find upcoming and past work | My shifts tab | Agenda/day view, status filters, shift cards | Offered, accepted pending confirmation, confirmed, past, changed, cancelled, cached |
| W-03 | Offer details | W | Review and accept or decline an assignment or cover offer | W-01, W-02, S-09, offer deep link | Job area, clock and expiry, work/skills, working language, provider and contact | Initial/cover, open, accepted pending confirmation, expired, filled, ineligible, unable to act offline |
| W-04 | Shift detail | W | See confirmed site access and next action | W-01, W-02, S-09, W-03 after confirmation | When/where, named foreman, briefing action, check-in/out, progress, dropout | Confirmed, briefing required, checked in, check-out due, dropped/cancelled, cached details |
| W-05 | Decline or drop out [Sheet] | W | Respond to an offer or flag inability to attend confirmed work | W-03 decline, W-04 can't attend | Clear scope, reason, consequence, confirm | Decline vs dropout, sending, foreman notified, expired/changed, not sent offline |
| W-06 | Check in or out [Sheet] | W | Deliberately record personal site attendance | W-04, W-01 action | Event type/time/site, status, confirm, retry/help | Ready, saved on device, synced, duplicate/conflict, outside schedule, attendance only while briefing outstanding |
| W-07 | Add progress photos | W | Capture and caption work evidence for the foreman | W-04, W-06 after event, S-14 camera return | Capture/picker, selected photos, captions, privacy prompt, upload | No photo, denied permission, preview, queued, uploading, synced, retryable failure |
| W-08 | Availability | W | See or edit availability and acknowledge schedule conflicts | Availability tab, W-03 conflict | Week/day view, unavailable slots, changes summary | Read-only policy, available, unavailable, conflict, save pending/failed |
| W-09 | Site briefing | W | Read the approved arrival and briefing context; ask the foreman | W-04, W-01 safety prompt | Original/translation, named contact, site access, S-11 link | Readable, pending/changed briefing, clarification requested, unavailable offline |

## Shared + provider + later — `design/screens/shared/` (28)

### Shared (17)

| ID | Name | Role | Purpose | Entry points | Key components | States to design |
| --- | --- | --- | --- | --- | --- | --- |
| S-01 | Welcome and app language | All | Make the app understandable before sign-in | First launch, signed-out return | Welcome, device language hint, language choice, continue | Supported/unsupported device language, chosen language, invite detected |
| S-02 | Sign in or create account | All | Verify one identity for every role | S-01, deep link continuation, session expired | Email input, code request, account/help links | New/returning, invalid input, rate-limited, offline, sending |
| S-03 | Verify code and recover access | All | Complete verification or help the user regain access | S-02, verified email path | Code field with paste/autofill, resend/change email, help | Waiting, invalid/expired, request again, slow/no delivery, verified, retained return destination |
| S-04 | Initial setup | All | Set name and communication preferences | S-03 first account, S-05 if incomplete | Name, reading language, site/time preference, continue | Defaults, profile incomplete, optional settings skipped, setup saved |
| S-05 | Accept an invitation | All | Confirm an organisation, crew or property delegation | Verified link, onboarding return, P-05/C-14 invite | Inviter, business/property, granted role, accept/decline | Signed out, valid, wrong account, expired/revoked, accepted, pending eligibility |
| S-06 | Account and preferences | All | Manage identity, role context and app preferences | Account tab or avatar | Active context, preferences, notification settings, help, sign-out | Single/multi-role, notification permission off, offline, sign-out with pending work |
| S-07 | Switch role or business [Sheet] | All | Hand off safely to an already granted context | S-06, authorised deep-link mismatch | Role and business list, active check, destination summary | Single/multiple, selected, pending draft, revoked, cancelled switch |
| S-08 | Messages | C, F, W | Find authorised conversations in the active context | Messages tab | Job search, role-filtered threads, unread markers | Empty, unread, active, archived/read-only, cached |
| S-09 | Notifications | All | Find and resume booked work, offers or decisions | Header bell, role dashboard; OS notification fallback | Grouped event list, read status, safe deep link | Unread/read, empty, expired offer, revoked/changed item, filtered to active role |
| S-10 | Job chat | C, F, W; P by grant | Chat across languages and audiences with the named foreman | Job/shift detail, S-08, S-09, message link | Audience switch for entitled viewers, role labels, translation bubbles, briefing cue, composer | Job/Crew only, varied source languages, pending/unavailable translation, queued/failed send, read-only, worker briefing needed |
| S-11 | Safety instruction and acknowledgement | F, assigned W | Issue or review a versioned instruction and confirm actual understanding | S-10 pinned cue, W-09, F-13 | Original/translation pair, named recipient, version, clarification and confirmation | Draft, ready, needs clarification/briefing, acknowledged, superseded, offline blocked |
| S-12 | Language and display | All | Choose UI and reading language and field display settings | S-01 language chooser, S-04, S-06, S-13 | Language pickers, preview, theme, text/large controls, two-zone display preference | Pre-auth language only, supported/unsupported translation, RTL, large text, system/light/dark |
| S-13 | Chat details [Sheet] | Authorised chat viewers | Explain audience, read language and participant visibility | S-10 header overflow | Thread label, named foreman, allowed participants, language/help links | Job/Crew audience, assigned or removed, read-only thread, restricted members |
| S-14 | Attach a photo or record audio [Sheet] | C, F, W by surface | Choose source, record/review voice and attach safely | C-02, S-10, W-07, F-14, C-16 | Camera/library, recording controls, playback, upload states | Not permitted by audience, permission denied, recording/cancelled, preview, pending, failed |
| S-15 | Media and original audio preview [Modal] | Authorised viewers | Examine an attachment without losing the parent screen | C-02, C-10, S-10, S-14, F-13, W-07 | Photo zoom, caption, audio/transcript, remove/retry if owner | Preview, upload incomplete, unsupported/no transcript, restricted, read-only |
| S-16 | Help and access status | All | Recover from stale/forbidden links or get local support | S-03, S-06, gated links, F-10 no cover | Reason-safe message, return path, contact, optional job reference | Expired, removed, unknown/inaccessible, pending eligibility, no connection, contact ready |
| S-17 | Confirm consequential action [Modal] | All by capability | Confirm action in the correct role on the correct item | C-10 sign-off, C-15 approve, P-02 handoff, P-05 revoke, S-06 sign-out | Named action/consequence, item and role, cancel, confirm | Ready, blocked, processing, invalidated by newer state, failed; outcome on parent screen |

### Provider business admin (5)

| ID | Name | Role | Purpose | Entry points | Key components | States to design |
| --- | --- | --- | --- | --- | --- | --- |
| P-01 | Business overview | P | See active handoffs and readiness at a glance | Overview tab; launch; S-07 switch | Business label, summary cards, exceptions, eligibility link | Onboarding, active, action needed, restricted, cached |
| P-02 | Jobs and handoffs | P | Assign or reassign accountable foremen and review business status | Jobs tab, P-01, S-09 | Business job list, job/foreman summary, handoff action, S-17 confirmation | Unassigned, offered, accepted, reassign/declined, authority missing, no eligible lead |
| P-03 | People and access | P | Inspect memberships, invitations and permitted role grants | People tab, P-01 prompt | Member/invite list, role labels, expiry status, add/edit action | Active, pending, revoked, empty, limited access |
| P-04 | Business and eligibility | P | Understand what is approved, expiring or needs ops review | P-01, P-03, S-09 | Verification summary, validity and capability restrictions, secure support handoff | Pending, approved for scope, expired, suspended, needs evidence, no access |
| P-05 | Invite or edit membership [Sheet] | Authorised P | Manage team membership and role permissions | P-03 add/edit | Invite recipient, scoped roles, expiry, send or update | Invite pending/resend, editing, duplicate, removed, cannot grant, saved/failed |

### Later categories (6; no first-release navigation)

| ID | Name | Role | Purpose | Entry points | Key components | States to design |
| --- | --- | --- | --- | --- | --- | --- |
| L-01 | Browse sessions | C | Find sessions, classes, coaching and tours in an active market | Later entry in C-01 | Category/location filters, session cards, language and accessible venue cues | No local supply, results, filtered, closed category, stale |
| L-02 | Session detail | C | Match time, location, language and service to need | L-01, valid session link | Host/service, duration, language, capacity, price and terms, book CTA | Class/private/group, full, unpublished/cancelled, times available |
| L-03 | Choose a slot [Sheet] | C | Pick a time and, where relevant, group size | L-02, L-05 reschedule | Date/day view, slot/capacity, venue zone, hold expiry | Available, sold out, hold, expired/conflict, no connection |
| L-04 | Review and book | C | Confirm a held slot, terms and any required payment | L-03 | Slot and venue, total, terms, checkout/confirm, provider payment UI if required | Held, processing, confirmation received, capacity changed, payment pending/failed, cancelled |
| L-05 | Session booking | C | Find attendance details or manage the booking | C-01, L-04, S-09 | Booking pass/details, directions, host contact, eligible reschedule/cancel, review | Upcoming, host/time changed, reschedule pending, cancelled, attended, review eligible |
| L-06 | Session setup and roster | P; designated F for roster | Publish sessions and organise staff/capacity | Later entry in P-01; F-01 for assigned sessions | Service/slot editor, language, capacity, roster, eligible cover link | Draft, needs approval, published, full, cancelled, roster change, cover unavailable |
