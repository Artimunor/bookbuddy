# Concept and principles

This is the second, independent design for BookBuddy. Its working name is **Beacon**. It serves the same product as the [reference design](../../design/README.md): managed repairs and small renovations, an accountable handoff from customer to foreman and crew, multilingual communication and last-minute replacement. The example repair takes place in Xàbia on the Costa Blanca; it does not establish launch coverage. See the [product brief](../../docs/reports/2026-11-21-builders-company-idea.md), the [accepted stack](../../docs/architecture/mobile-tech-stack.md) and the [Live Activities and attendance research](../../research/tech-stack/live-activities-and-geofenced-attendance.md).

## Direction

**Beacon treats every booking as one live object that looks the same in the app, on the Lock Screen, in the Dynamic Island and in the Android notification shade.** An owner in London and a worker at a gate in Xàbia read the same shape: a dark capsule, a lime progress line, the crew, one time and one next step.

Three things make it feel different from the reference and from most field-service apps:

- **A calm page with one lit thing.** The app is warm paper, ink type and white cards. Only what is live right now wears the hi-vis lime, borrowed from a site vest. Lime is never decoration, so a glance at any screen answers "is something happening?".
- **Moments, not maps.** Uber shows a car on a map. BookBuddy must not track workers, so the live view is built from deliberate human acts: "On my way", a check-in, a shared photo, a sign-off. Each one is a stamp with a name and a time. The result is live without surveillance, and it is honest when nothing new is known.
- **One next step.** Every screen has one primary action in a fixed dock at the bottom. The dock changes as the booking moves on. People do not hunt through a record to find what is expected of them.

The mood is Mediterranean daylight and site kit: warm, plain, high-contrast, rounded, a little bold. It should feel like a service that is awake, not a filing cabinet.

## The "Uber for service work" model

| Element | What it does | Where it appears |
| --- | --- | --- |
| **Live capsule** | The single live object for a booking, shift or cover search: state, time, job line, crew, provenance. | Now tabs, C-09, W-04, F-05, F-10 |
| **Job line** | A bead rail showing where the booking is. Two zooms: the journey (request to paid) and the day (confirmed to finished). | Capsule, Live Activity, Android progress, C-05 |
| **Crew dots** | Avatars with a status ring. Customers see crew-level state and confirmed names; foremen see each worker's state. | C-09, F-01, F-05, F-16 |
| **Arrival band** | A declared arrival estimate shown as a band with who shared it and when. Never a position. | C-09, C-19, C-20, W-10, F-17 |
| **Stamps** | The feed of confirmed moments: who did what, when, in site time. Shared photos are stamps too. | C-09, C-05, F-13, S-10 |
| **Next-step dock** | One primary action. A lime button means "this changes what others see live". | Every pushed screen |
| **Live pill** | A mini capsule above the tab bar when something is live and you are elsewhere in the app. | Tab roots |
| **System surfaces** | The capsule outside the app: iOS Live Activity and Dynamic Island, Android ongoing notification. They open a record; they never perform an action. | C-19, C-20, W-11, W-12, F-18, L-07 |

Live state comes from Durable Object change hints while the app is open, and from push when it is not. A capsule always shows the last confirmed stamp and its time. When the app cannot confirm freshness, the capsule goes quiet: the pulse stops and the text says "Last confirmed 08:52".

## Principles

1. **Live means confirmed by a person.** Every status the customer sees maps to a deliberate act by the crew or foreman, or a server-confirmed record. Nothing is inferred from a geofence, a clock or a chat message. Check-in stays a deliberate action.
2. **One booking, one object, every surface.** The capsule has one anatomy at every size. Learn it once in the app and you can read it on the Lock Screen at arm's length.
3. **One next step.** One primary action per screen, in the dock. Secondary actions are quiet. A notification or system surface opens the record and never accepts, checks in, approves or acknowledges.
4. **Say who and when.** Each status carries its source and site time, with the viewer's time alongside when it differs. Stale is shown as stale. "Saved on this device" is never shown as "sent".
5. **Crew-level outside, person-level inside.** Customers see the crew's state and the names of confirmed crew. Individual positions, routes, attendance times and dropout reasons stay inside the provider. No map, no coordinates, no continuous tracking.
6. **Your words stay yours.** Everyone writes in their own language. The reader's language comes first and the original sits directly beneath it, always visible. Approved quote text is never altered; a change is a new version.
7. **Built for a gate at noon.** Large type, 56-unit controls, solid fills, ink on lime in Field mode, no swipe-only actions, and everything critical readable with gloves, glare and one hand.

## What changes from the reference, and why

| Reference | Beacon | Why |
| --- | --- | --- |
| [C-09 Job day](../../design/screens/customer/C-09-job-day.svg) is a static card: "Visit confirmed. Reported delays will appear here." | **C-09 Live visit**: capsule with day line, arrival band, crew dots, stamps feed and one dock action. | The brief asks for live, glanceable status. A booked window alone does not answer "are they coming?". |
| [C-01 Jobs home](../../design/screens/customer/C-01-jobs-home.svg) mixes a list, a promo panel and updates. | **C-01 Now** shows the live capsule or the "What needs doing?" bar, then decisions that need you. The list moves to **C-18 Bookings**. | The first screen should answer "what is happening and what do I do?" in one glance. |
| [C-05 Job detail](../../design/screens/customer/C-05-job-detail-and-timeline.svg) is a record with a text timeline. | **C-05 Job home** leads with the journey line and the dock. On the visit day the same booking opens on C-09. | Progress should be visible as shape, not read as a list. |
| No system surfaces. Push only. | **C-19, C-20, W-11, W-12, F-18, L-07**: Live Activity, Dynamic Island and Android ongoing notifications, with platform limits designed in. | On visit day, **Follow live** puts the current stage on the customer's Lock Screen without needing to reopen the app for each update. The card opens the visit; it never changes it. |
| [W-01 Today](../../design/screens/worker/W-01-today.svg) lists a notice, a card and an update. | **W-01 Now** is one capsule and one dock action: accept, set off, check in, check out. Offers show an offer clock with the absolute deadline. | A worker with gloves at a gate needs one large target, not three cards. |
| "On the way" does not exist; the customer sees only a window. | **W-10 On my way** and **F-17 Share an update**: a deliberate, declared status with an arrival band. No tracking. | Gives the Uber feeling legally: the crew chooses to tell the customer. |
| [F-10 Fill shift](../../design/screens/foreman/F-10-fill-shift.svg) is a checklist form. | **F-10 Find cover** is a live search: a cover ladder (own crew first; if nobody can cover, propose a new visit), offer clocks and a capsule that also runs as **F-18** on the Lock Screen. | Replacement is the most time-critical flow. It should feel like a dispatch in progress. |
| [S-10 Job chat](../../design/screens/shared/S-10-job-chat.svg) stacks labelled translation and original. | **Twin bubble**: reader's language on top, original in an attached tinted strip, plus a language line under the header and stamps inline in the thread. | Same rule, faster to scan, and the chat shows what happened as well as what was said. |
| Four tabs per role, Account as a tab for customers. | Three or four tabs starting with **Now**; an identity chip in every root header opens You (S-06) and the role switch. | Fewer destinations, and the active role and business are always visible. |
| Green and grey, 48-unit controls, 16-radius cards. | Paper, ink and lime; 56-unit controls; 24 to 32 radii; a night capsule that flips to lime in Field mode. | A distinct, sunlight-first look. See the [design system](../system/design-system.md). |

## What we keep from the reference

These were settled by the reference reviews and are not reopened:

- **First valid acceptance reserves the slot; the foreman's confirmation assigns the worker.** A provisional acceptance is not permission to travel. (Reference [core flow 4](../../design/foundation/core-flows.md#4-last-minute-replacement-own-team-then-vetted-pool), F-10 to F-12, W-03.)
- **The safety hold lasts until the foreman verifies understanding and the worker acknowledges that version online.** Attendance can be recorded during a hold; work cannot start. (S-11, W-09.)
- **An approved quote's original text is never altered.** Changes are new versions compared side by side. (C-06, C-15, F-15.)
- One app scoped by role; the foreman is the customer's named contact; no customer-to-worker direct messages.
- Open a record, not an action, from any notification; generic lock-screen copy; opaque links.
- Site time first, viewer's time alongside; EUR stays EUR; originals stay readable.
- Consequential actions need an online confirmation; drafts, chat, media and attendance can queue offline and are labelled as pending.
- The same IDs for the same purpose. Screens that exist in both designs keep their reference ID so the two can be compared screen by screen. New surfaces take the next free number.
- The fixture story: Claire Martin, Mateo Ruiz, Reformas Ruiz, BB-1042 Terrace door repair, Villa Mar · Xàbia, quote v1 €240.00.

## Limits this design respects

- At launch, only the customer's **Follow live** tap on C-09 starts the visit card, in the foreground, for that visit on that phone. The locked preview is generic unless the customer separately enables details. iOS 17.2+ supports push-to-start, but Beacon does not use it at launch. Neither a push nor a geofence callback starts the card. An iOS Live Activity lasts at most 8 hours active and is not chained.
- Attendance records no location. Check-in is a deliberate tap by the assigned worker; the live shift card starts only after it. Location-based reminders are not part of this design.
- Android uses an ongoing notification. A promoted Live Update on Android 16 is optional and never assumed.
- Lawful basis, notice and proportionality for worker data are [unverified] operating decisions. S-18 is the notice surface; the design does not assume consent.

## Owner decisions applied

- **Operating model.** The local provider contracts with and bills the customer; BookBuddy coordinates. At launch the customer pays the provider directly. C-11 shows the provider's bill and its paid status; there is no in-app checkout.
- **Replacement at launch.** Cover comes only from the provider's own crew and is confirmed by the authorised foreman. If nobody in the crew can cover, the provider proposes a revised visit. The vetted pool (F-11) is designed as a later rung of the cover ladder and has no launch navigation.
- **Languages.** The UI ships in English (default) and Portuguese. Layouts tolerate 30 to 40% text expansion and RTL so further languages can be added. Translated messages always show the original beneath the translation.
- **Unchanged.** A named approver approves the quote. Cancelling and rescheduling are free. The safety briefing is given by a person and verified by teach-back. Attendance needs no location.
