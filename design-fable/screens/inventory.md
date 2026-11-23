# Screen inventory

**81 surfaces:** 73 for the construction release (20 customer, 17 foreman, 12 worker, 19 shared, 5 provider admin) and 8 later surfaces (the vetted pool, F-11, and seven session surfaces, L-01 to L-07). IDs are stable. A surface that exists in both designs keeps its [reference ID](../../design/screens/inventory.md) so the two can be compared; new surfaces take the next free number. **[Sheet]** is a bottom sheet, **[Modal]** a dialog or full-screen modal, **[System]** a surface the OS draws outside the app (Live Activity, Dynamic Island, ongoing notification, push banner), **[Later]** a capability with no launch navigation. Each row is one primary SVG plus the named states; do not mint IDs for states.

Read first: [Concept and principles](../foundation/concept-and-principles.md), [Design system](../system/design-system.md), [Wireframe conventions and sample data](../system/wireframe-conventions.md) and the [template](../system/wireframe-template.svg).

## Slices

| Owner | IDs | Screens | Folder | Spec file |
| --- | --- | ---: | --- | --- |
| `FableCustomerA` | C-01–C-08 | 8 | `screens/customer/` | `C-01_C-08-specs.md` |
| `FableCustomerB` | C-09–C-20 | 12 | `screens/customer/` | `C-09_C-20-specs.md` |
| `FableForemanA` | F-01–F-09 | 9 | `screens/foreman/` | `F-01_F-09-specs.md` |
| `FableForemanB` | F-10–F-18 | 9 | `screens/foreman/` | `F-10_F-18-specs.md` |
| `FableWorker` | W-01–W-12 | 12 | `screens/worker/` | `W-01_W-12-specs.md` |
| `FableSharedA` | S-01–S-09 | 9 | `screens/shared/` | `S-01_S-09-specs.md` |
| `FableSharedB` | S-10–S-19 | 10 | `screens/shared/` | `S-10_S-19-specs.md` |
| `FablePlatform` | P-01–P-05, L-01–L-07 | 12 | `screens/shared/` | `P-01_P-05-specs.md`, `L-01_L-07-specs.md` |

Rules for every slice:

- File names: `<ID>-<slug>.svg` for the primary and `<ID>-<slug>--<state>.svg` for a state. One app state per file.
- Spec file: one `## <ID> <Name>` section per screen, in the structure of the reference specs: **Purpose and routes**, **Layout and data**, **Interactions and states**, **Platform, accessibility and RTL**, then an **Open design questions** section and one mermaid navigation diagram for the slice.
- **Lead-drawn reference screens** are marked ★. Do not redraw their primary. The owning slice writes their spec section and draws the remaining states to match.
- Draw the primary plus at least the states in bold. Other states are specified in text.
- Owner decisions that every slice applies: the provider bills the customer and there is no in-app payment; cover comes only from the provider's own crew; cancelling and rescheduling are free; a named approver approves the quote; the safety briefing is human, with teach-back; attendance records no location; the UI is English and Portuguese.

## Customer — `screens/customer/` (20)

| ID | Name | Role | Purpose | Entry points | Key components | States to design |
| --- | --- | --- | --- | --- | --- | --- |
| C-01 | Now | C | See what is live and what needs you; start a request | Now tab; launch | Identity chip, ask bar, live capsule (card), needs-you cards, booking card | **First use**, draft to resume, **decision due**, upcoming, **live visit**, cached |
| C-02 | Describe the job | C | Say what is wrong in your own words | Ask bar; draft | Text, voice and photo input, language line, S-14, S-15 | Empty, **voice recorded**, uploading, saved offline, capture denied |
| C-03 | Place and access | C | Confirm where and how the crew gets in | C-02; C-04 edit | Place picker, access notes, who is on site | Known place, new place, outside service area, offline |
| C-04 | Review and send | C | Send a request that is clearly not yet a booking | C-03 | Summary, edit links, dock | Ready, media pending, sending, **sent**, **not sent (offline)** |
| C-05 | Job home | C | The whole job: stage, next step, quote, visit, people, history | C-01, C-18, S-09, link | Journey line, dock, quote row, visit row, crew dots, stamps | Requested, **quote ready**, booked, signed off, closed, cancelled, problem open |
| C-06 | Quote and scope | C | Read the provider's scope, exclusions and total, original beneath translation | C-05, S-09 | Twin card, line items, version badge, dock | Current, **superseded**, expired, declined, read-only |
| C-07 | Approve quote [Sheet] | C | Record the named approver's approval of the exact current version | C-06 | Approver name, version, total, effect, dock | Ready, changed since review, processing, approved, failed, **not the named approver** |
| C-08 | Pick a visit window | C | Choose or confirm a proposed window | C-05, C-17, S-09, revised visit after no cover | Day view, two-clock time, dock | Proposed, **revised visit proposed**, none available, confirmed |
| C-09 ★ | Live visit | C | Follow the visit as it happens; reach the foreman | C-01 capsule, C-05 on the day, C-19, C-20, S-09 | Live capsule (hero), day line, arrival band, crew dots, stamps, dock, Follow live | Crew confirmed, **on the way** (★ primary), **on site**, working, **cover being arranged**, **crew changed**, no update since, finished, quiet (stale) |
| C-10 | Review and sign off | C | Compare the finished work with the approved scope | C-09 finished, C-05, S-09 | Scope checklist, photo stamps, dock, problem link | Awaiting review, evidence unavailable, signed off, problem opened |
| C-11 | Bill and payment record | C | See the provider's bill, how to pay the provider directly, and when the provider records it paid | C-10, C-05, S-09 | Bill summary from the provider, pay-the-provider details, paid stamp | No bill yet, **bill due**, **marked paid by provider**, query raised. No in-app payment. |
| C-12 | Rate the job [Sheet] | C | Optional feedback after closure | C-05 closed, L-05 | Rating, text, dock | Unrated, submitting, submitted |
| C-13 | Places | C | Find a property among owned and managed ones | You (S-06), place switcher | Search, place cards | One, many, delegated, empty |
| C-14 | Place and people | C | Maintain a place, its named approver and who else may act | C-13, C-03 | Address, access notes, people and grants, booking cards | Edit, delegated read-only, invite pending |
| C-15 | Review a change | C | Compare a proposed change with what was approved | C-05, S-09 | Before and after twin cards, delta, what is on hold, dock | Open, approved, rejected, superseded |
| C-16 | Report a problem | C | Send evidence to the local service and follow the case | C-05, C-09, C-10, C-11 | Category, affected item, evidence, case stamps | Draft, **case open**, resolved, offline |
| C-17 | Cancel or reschedule [Sheet] | C | Ask for a change; it is free | C-05, C-08, L-05 | Current window, "No fee" line, dock | Reschedule, cancel, needs provider to agree a window, requested, cancelled |
| C-18 | Bookings | C | Find any booking, past or future | Bookings tab | Segments, place filter, booking cards with mini job line | Active, **past**, filtered empty, cached |
| C-19 ★ | Visit Live Activity [System · iOS] | C | Follow the visit from the Lock Screen and Dynamic Island | Follow live on C-09; push-to-start | Lock Screen card, island compact, minimal, expanded | **Lock Screen on the way** (★ primary), **island compact** (★), **island expanded** (★), island minimal, on site, cover being arranged, finished, stale, ended at 8 hours |
| C-20 | Visit ongoing notification [System · Android] | C | The same on Android | Follow live on C-09; push | Collapsed, expanded, Live Update chip | **Collapsed**, **expanded**, Android 16 Live Update, finished, dismissed |

## Foreman — `screens/foreman/` (18; F-11 is later)

| ID | Name | Role | Purpose | Entry points | Key components | States to design |
| --- | --- | --- | --- | --- | --- | --- |
| F-01 | Now | F | Today's visits live, gaps first | Now tab; launch | Capsules with crew dots, gap card, needs-you cards | Quiet day, **visit live**, **crew gap**, offline |
| F-02 | Jobs | F | The pipeline from intake to closed | Jobs tab | Stage segments, booking cards | Incoming, active, past, empty |
| F-03 | New job | F | Accept accountability, decline or ask | F-01, F-02, S-09, P-02 | Request in twin card, media, dock | New, accepted, **reassignment**, authority missing |
| F-04 | Scope and quote | F | Write the provider's scope and price; publish a version | F-03, F-05 | Line editor, original and preview, version | Draft, **pending business review**, sent, approved |
| F-05 | Job control | F | Run the booking: line, crew, updates, stamps | F-01, F-02, S-09 | Journey and day line, crew dots (per worker), share row, dock | Booked, **live**, change pending, awaiting sign-off, bill sent, paid recorded |
| F-06 | Schedule | F | Propose windows against crew capacity; propose a revised visit | F-04, F-05, F-10 no cover | Day view, window editor, dock | Proposal, **conflict**, **revised visit after no cover**, agreed |
| F-07 | Assign crew [Sheet] | F | Send named assignments to eligible own-crew workers | F-05, F-16 | Worker cards, filters, dock | Eligible, **ineligible**, offers out |
| F-08 | Crew | F | Roster with skills, languages, availability | Crew tab | Search, worker cards, filters | Active, unavailable, review pending |
| F-09 | Crew member | F | Check fit without raw documents | F-08, F-07, F-10 | Skills, languages, availability, eligibility | Available, conflict, not eligible |
| F-10 | Find cover | F | Run a live cover search within the provider's own crew | F-01 gap, F-16, S-09, F-18 | Capsule, cover ladder (own crew, then propose a new visit), offer clocks, dock | **Gap**, **crew offers out**, **accepted (confirm)**, **no cover: propose a new visit** |
| F-11 | Vetted pool [Later] | F | Later: choose eligible cover from approved providers outside the crew | Later rung on F-10; no launch navigation | Filters, worker cards, offer clock | Matches, no match, offers out. One primary only; mark it Later. |
| F-12 | Confirm cover [Sheet] | F | Assign exactly one accepted own-crew candidate | F-10, S-09, F-18 | Candidate, rechecks, customer effect, dock | Ready, **already filled**, no longer eligible, confirmed |
| F-13 | Site log | F | Attendance, photos and what the customer sees | F-05, F-16 | Stamps (per worker), share control, hold status | Empty, confirmed, pending sync, conflict |
| F-14 | Wrap up | F | Submit completion and evidence; send the provider's bill reference | F-05, F-13 | Scope checklist, photo stamps, dock | Draft, uploading, submitted, returned |
| F-15 | Propose a change | F | Version scope, cost and timing | F-05, F-13 | Locked approved text, addition, delta, dock | Draft, sent, approved, rejected |
| F-16 | Shift detail | F | One shift: who, state, briefing | F-01, F-05, F-13 | Shift card, crew dots, hold status | Unassigned, confirmed, dropped, covered |
| F-17 | Share an update [Sheet] | F | Tell the customer: on the way, running late, paused, photo | F-05, F-01, F-13 | Update type, arrival band editor, customer preview, dock | **On the way**, running late, photo, sent |
| F-18 | Cover search live card [System] | F | Watch a cover search from the Lock Screen | Sending offers on F-10 | Lock Screen card, island, Android notification | **Offers out**, **accepted, open to confirm**, confirmed, no cover |

## Worker — `screens/worker/` (12)

| ID | Name | Role | Purpose | Entry points | Key components | States to design |
| --- | --- | --- | --- | --- | --- | --- |
| W-01 ★ | Now | W | The one thing to do next | Now tab; launch | Capsule or offer card with offer clock, hold banner, dock | **Cover offer** (★ primary), **shift today**, **on site**, nothing scheduled, **Portuguese**, **RTL Arabic (tolerance test)**, offline |
| W-02 | Shifts | W | Upcoming and past work | Shifts tab | Segments, shift cards | Upcoming, offers, past, cached |
| W-03 | Offer | W | Read an offer and accept or decline | W-01, W-02, S-09 | Offer clock, task, briefing language, coarse area, dock | Open, **awaiting confirmation**, **filled elsewhere**, expired, offline |
| W-04 | Live shift | W | Run the shift: brief, set off, check in, work, check out | W-01, W-02, W-11, W-12 | Capsule (Field polarity), day line, hold banner, dock | Confirmed, **hold**, on the way, **checked in**, check-out due, cancelled |
| W-05 | Decline or can't make it [Sheet] | W | Decline, withdraw, or report a dropout | W-03, W-04 | Scope, effect, reason, dock | Decline, withdraw, **dropout**, not sent (offline) |
| W-06 | Check in or out [Sheet] | W | Deliberately record attendance, without location | W-04 dock, W-01 dock, W-11, W-12 | Event, time, site, live-card opt-in, dock | Ready, **large text**, saved on device, recorded, attendance only during hold |
| W-07 | Progress photos | W | Send photos to the foreman | W-04 | Capture, captions, upload queue, dock | Review, **queued offline**, sent |
| W-08 | Availability | W | Say when you can work and when you are open to cover | Shifts, W-01, W-03 conflict | Week view, open-to-cover switch | Available, unavailable, conflict |
| W-09 | Site briefing | W | Arrival plan and briefing, original beneath translation | W-04, W-01 | Twin card, hold banner, S-11 link | Readable, changed, offline |
| W-10 | On my way [Sheet] | W | Declare departure and an arrival estimate, without location | W-04 dock, W-01 dock | Arrival chips, what the customer sees, "No location is used" line, dock | **Ready**, sent, late update, offline |
| W-11 | Shift Live Activity [System · iOS] | W | Shift status on the Lock Screen after check-in | Opt-in on W-06 | Lock Screen card, island | **Since check-in**, **safety hold**, ended at 8 hours |
| W-12 | Shift ongoing notification [System · Android] | W | The same on Android | Opt-in on W-06 | Collapsed, expanded | **Collapsed**, expanded, hold |

## Shared — `screens/shared/` (19)

| ID | Name | Role | Purpose | Entry points | Key components | States to design |
| --- | --- | --- | --- | --- | --- | --- |
| S-01 | Welcome and app language | All | Understand the app before sign-in | First launch | English and Portuguese choice, dock | English, **Portuguese**, other device language, invite detected |
| S-02 | Sign in or create account | All | One identity for every role | S-01, link | Email input, dock | New, invalid, rate-limited, offline |
| S-03 | Verify code | All | Finish verification or recover | S-02 | Code field, resend, help | Waiting, **wrong code**, **locked out** |
| S-04 | First setup | All | Name, reading language, time display | S-03 | Inputs, two-clock preview | Defaults, saved |
| S-05 | Accept an invitation | All | Confirm a crew, business or place grant | Link, P-05, C-14 | Inviter, role and limits, dock | Valid, wrong account, **expired** |
| S-06 | You | All | Identity, role, places, settings, help | Identity chip | Role card, settings rows | Single role, multi-role, pending work |
| S-07 | Switch role [Sheet] | All | Move to another granted role or business | S-06, link mismatch | Role and business list | Multiple, pending draft |
| S-08 | Messages | C, F, W | Find conversations | Messages tab | Thread rows with language line | Empty, unread, cached |
| S-09 | Notifications | All | Resume from an event | Bell | Grouped stamps | Unread, **cover offer**, expired |
| S-10 ★ | Job chat | C, F, W; P by grant | Talk across languages with the named foreman | C-05, C-09, F-05, W-04, S-08 | Language line, twin bubbles, inline stamps, composer | **Translated** (★ primary, customer view), **translation unavailable**, crew only, **RTL original**, queued, read-only |
| S-11 | Safety instruction | F, assigned W | Issue a versioned instruction, verify by teach-back, acknowledge | S-10 cue, W-09, F-13 | Twin card, hold banner, teach-back record, dock | Ready, **acknowledgement pending**, acknowledged, superseded |
| S-12 | Language and display | All | UI language (English, Portuguese), reading language, theme, Field mode, two clocks | S-01, S-06 | Pickers, preview | Pre-auth, Portuguese, Field mode on |
| S-13 | Chat details [Sheet] | Chat viewers | Who can read this, in which languages | S-10 | Audience, participants | Job, crew only |
| S-14 | Attach or record [Sheet] | C, F, W | Photo or voice, safely | C-02, S-10, W-07, F-14, C-16 | Source, recorder, upload state | Ready, **recording**, denied |
| S-15 | Media preview [Modal] | Viewers | Look closely without losing place | Any media | Zoom, caption, audio and transcript | Preview, **transcript unavailable** |
| S-16 | Help and access | All | Recover from a stale or forbidden link; reach support | Gated links, S-06 | Reason-safe text, contact | Expired, removed, pending eligibility |
| S-17 | Confirm action [Modal] | All | Confirm a consequential action in the right role | Sign-off, change, handoff, revoke | Item, effect, named action | Ready, processing, invalidated |
| S-18 | Live updates and privacy | All | Choose live surfaces; read what is shared with whom | S-06, Follow live on C-09, W-06 opt-in | Switches, "what others see" preview, "No location is collected" notice | **Customer**, **worker**, notifications off |
| S-19 | Push notifications [System] | All | Banners that open a record | OS | Lock Screen banners per role | **Customer**, **worker offer**, foreman gap |

## Provider admin — `screens/shared/` (5)

| ID | Name | Role | Purpose | Entry points | Key components | States to design |
| --- | --- | --- | --- | --- | --- | --- |
| P-01 | Business now | P | Handoffs, readiness and unpaid bills at a glance | Now tab | Summary cards, exceptions | Active, action needed |
| P-02 | Jobs and handoffs | P | Offer or move a job to a named foreman; record a bill as paid | Jobs tab, P-01 | Booking cards, handoff dock | Unassigned, offered, **handoff stuck**, paid recorded |
| P-03 | People and access | P | Memberships, invitations, grants | People tab | Member rows | Active, pending, **revoked** |
| P-04 | Business and eligibility | P | What is approved, expiring or under review | P-01, P-03 | Status rows, support handoff | Approved, **expiring**, suspended |
| P-05 | Invite or edit member [Sheet] | P | Manage a membership | P-03 | Recipient, roles, dock | New, **invite pending**, cannot grant |

## Later categories — `screens/shared/` (7; no first-release navigation)

| ID | Name | Role | Purpose | Entry points | Key components | States to design |
| --- | --- | --- | --- | --- | --- | --- |
| L-01 | Browse sessions | C | Find classes, sessions, coaching, tours | Later entry on C-01 | Filters, session cards with price basis | Results, none nearby |
| L-02 | Session detail | C | Time, place, language, price, terms | L-01 | Host, capacity, dock | Open, **fully booked** |
| L-03 | Choose a slot [Sheet] | C | Pick a time and party size | L-02, L-05 | Day view, hold timer | Available, **slot just taken** |
| L-04 | Review and book | C | Confirm a held slot; payment is made to the provider | L-03 | Summary, "Pay the provider" line, terms, dock | Held, processing, booked, not booked |
| L-05 | Session booking | C | The pass, and live on the day | C-01, C-18, L-04, L-07 | Capsule (session line), two-clock time, dock | Upcoming, **today**, **substitute host**, **pending change** |
| L-06 | Session setup and roster | P; F for roster | Publish sessions, staff them, find cover in the own team | P-01, F-01 | Slot editor, roster, cover ladder | Published, **cover unavailable** |
| L-07 | Session live card [System] | C | Countdown to a session on the Lock Screen | Opt-in on L-05 | Lock Screen card, island, Android notification | **Starts in**, host changed, ended |

## Story and clock

All artboards are snapshots of one timeline. Times are Spain time (`Europe/Madrid`); Claire is in the UK, one hour behind. Live artboards set the status-bar clock to the viewer's local time at that moment instead of 9:41. Cast and values are in the [sample data](../system/wireframe-conventions.md#shared-sample-data).

| Spain time | Event | Shows on |
| --- | --- | --- |
| Mon 23 Nov 08:05 | Claire sends the request | C-04, F-03 |
| Mon 08:20 | Claire, the named approver, approves quote v1, €240.00 | C-06, C-07, F-04 |
| Mon 08:36 | Visit booked: Tue 24 Nov, 09:00–10:00 | C-05, C-08, F-06 |
| Mon 08:38 | Nadia Benali confirms the shift | W-03, F-16 |
| Tue 08:32 | Nadia reports she can't make it | W-05, F-01 gap |
| Tue 08:33 | Mateo sends own-crew offers to Diego Torres and Lucía Ortega; reply by 08:42 | F-10, F-18, W-01 ★ (Diego, 08:36) |
| Tue 08:38 | Diego accepts: slot reserved, not assigned | W-03, F-12, F-18 |
| Tue 08:40 | Mateo confirms Diego; Lucía's offer closes as filled; customer sees "Crew updated" | F-12, C-09, W-04 |
| Tue 08:52 | Mateo shares "On the way", arriving 09:10–09:20 | F-17, C-09 ★ (07:58 UK), C-19 ★, S-10 ★ |
| Tue 09:14 | Diego checks in, no location; customer sees "Crew on site" | W-06, W-11, C-09, F-13 |
| Tue 09:16–09:17 | Briefing with teach-back; Mateo verifies; Diego acknowledges v2; hold cleared | S-11, W-04 |
| Tue 09:18 | Work starts | C-09, F-05 |
| Tue 09:36 | Mateo shares a photo: "Old rollers out" | F-17, C-09, S-10 |
| Tue 10:12 | Work finished; Diego checks out 10:14 | W-06, F-13 |
| Tue 10:15 | Mateo submits completion with "After adjustment" | F-14, C-10 |
| Tue 10:40 | Claire signs off (09:40 UK) | C-10 |
| Tue 10:42 | Reformas Ruiz's bill for €240.00 appears; Claire pays the provider directly | C-11, F-05 |
| Wed 25 Nov 09:05 | Reformas Ruiz records the bill as paid | C-11, P-02 |
| Alternative branch | Nobody in the crew accepts by 08:42: Mateo proposes Wed 25 Nov, 09:00–10:00 | F-10 no cover, F-06, C-08, C-09 |
