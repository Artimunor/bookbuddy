# Design system

## Brand direction

Beacon is **warm paper, ink and one hi-vis lime**: a calm page where only what is live is lit. It should feel awake, plain-spoken and a little bold, like good site kit in Mediterranean daylight. Use big times, named people and real photos instead of badges. Avoid gradients, gloss, shadows as decoration, lime used for anything that is not live, and status shown by colour alone. See [Concept and principles](../foundation/concept-and-principles.md).

## Colour tokens

Use semantic names in handoffs. Default follows system appearance; S-12 can override. SVGs use these exact hex values.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `canvas` | `#F6F3EC` | `#0F1115` | App background (paper) |
| `surface` | `#FFFFFF` | `#1A1D23` | Cards, fields, bars |
| `raised` | `#FFFFFF` | `#23272F` | Sheets, dialogs |
| `subtle` | `#ECE8DE` | `#2A2E37` | Neutral tint, original-text strip, disabled fill |
| `ink` | `#15171C` | `#F4F1EA` | Titles, body, icons |
| `muted` | `#555A66` | `#B5B9C4` | Supporting text, secondary icons |
| `separator` | `#DED8CB` | `#353A45` | Decorative rules only |
| `outline` | `#747986` | `#8A90A0` | Control boundaries |
| `brand` | `#15171C` | `#F4F1EA` | Primary action fill, selected chip |
| `on-brand` | `#FFFFFF` | `#15171C` | Text on `brand` |
| `brand-pressed` | `#343842` | `#D4D1C8` | Pressed primary action |
| `brand-soft` | `#E4E9FF` | `#262E52` | Sent messages, selected row tint |
| `brand-ink` | `#2438B5` | `#B7C3FF` | Links (also underlined), text on `brand-soft`, focus ring on light |
| `live` | `#D6F33C` | `#D6F33C` | Live state, and actions that change what others see live |
| `on-live` | `#15171C` | `#15171C` | Text and icons on `live` |
| `live-pressed` | `#BFDC22` | `#BFDC22` | Pressed live action |
| `night` | `#15171C` | `#000000` | Live capsule, system-surface cards |
| `on-night` | `#F6F3EC` | `#F4F1EA` | Text on `night` |
| `night-muted` | `#B1B5C0` | `#B5B9C4` | Supporting text on `night` |
| `night-line` | `#3B404B` | `#353A45` | Unfilled rail and rules on `night` (decorative) |
| `info-soft` / `info-ink` | `#E3EEFB` / `#1E4A7D` | `#1B3147` / `#B5D8FF` | Information, proposed, translation status |
| `success-soft` / `success-ink` | `#E1F3E4` / `#1E5A32` | `#1D3626` / `#A9E0B3` | Confirmed, received by server, paid |
| `attention-soft` / `attention-ink` | `#FFEFCF` / `#6E4300` | `#40300F` / `#FFD98A` | Action due, pending sync, safety hold |
| `critical-soft` / `critical-ink` | `#FCE6E3` / `#8A2F28` | `#44231F` / `#FFC1BA` | Blocking errors, crew gap, destructive |
| `person-a` / `-b` / `-c` / `-d` | `#FFE3D3` / `#DDEBFF` / `#E7E1FF` / `#DDF3E4` | `#5A3828` / `#27405F` / `#3B3463` / `#234A33` | Avatar fills, with `ink` initials |
| `scrim` | `#15171C` | `#000000` | Modal scrim at 40% opacity; no text on it |

**WCAG 2.2 AA contrast.** Ratios computed from the tokens with the [WCAG 2.2 formula](https://www.w3.org/TR/2024/REC-WCAG22-20241212/#contrast-minimum). All text pairings exceed 4.5:1; control boundaries exceed 3:1. This checks tokens, not a running app. Light and dark in that order.

| Pairing | Light | Dark |
| --- | ---: | ---: |
| `ink` on `canvas` / `surface` / `subtle` / `brand-soft` | 16.18 / 17.93 / 14.65 / 14.86 | 16.75 / 14.97 / 12.05 / 11.67 |
| `muted` on the same | 6.23 / 6.91 / 5.64 / 5.72 | 9.63 / 8.60 / 6.93 / 6.71 |
| `outline` on `canvas` / `surface` / `subtle` | 3.93 / 4.36 / 3.56 | 5.92 / 5.29 / 4.26 |
| `on-brand` on `brand` / `brand-pressed` | 17.93 / 11.73 | 15.90 / 11.74 |
| `brand-ink` on `brand-soft`; on neutrals (minimum) | 7.54; 7.44 | 7.69; 7.94 |
| `on-live` on `live` / `live-pressed` | 14.30 / 11.51 | 14.30 / 11.51 |
| `live` on `night` | 14.30 | 16.74 |
| `on-night` / `night-muted` on `night` | 16.18 / 8.74 | 18.62 / 10.70 |
| `info-ink` on `info-soft` | 7.67 | 9.02 |
| `success-ink` on `success-soft` | 7.08 | 8.71 |
| `attention-ink` on `attention-soft` | 7.50 | 9.43 |
| `critical-ink` on `critical-soft` | 6.98 | 9.02 |
| `ink` on `person-a` to `-d` (minimum) | 14.18 | 8.87 |

Rules that follow from the numbers:

- `live` on a light neutral is about 1.1:1. On light surfaces a lime fill always carries a 2-unit `ink` border, or it sits on `night`. Never set text in `live` on a light surface.
- `night-line` is decorative (1.7:1). The filled part of a rail and every bead that carries meaning use `live` or `on-night`.
- In dark mode `night` is close to `canvas`. Give the capsule a 1-unit `outline` border.
- Focus ring: 2-unit `brand-ink` with a 2-unit gap on light surfaces; `live` on `night`.
- Do not use opacity on text, borders or selected states.

## Foundations

System font on both platforms. Sizes are nominal units (pt on iOS, sp on Android) and scale with the user's settings. Times, prices and counts use tabular figures. Never shrink type to fit.

| Style | Size / line height | Weight and use |
| --- | --- | --- |
| Display | 40 / 44 | 800, the one hero time or state on a live surface |
| Page title | 28 / 34 | 800, tab root title |
| Section title | 20 / 26 | 700, cards and pushed-screen titles |
| Label / button | 17 / 22 | 700, controls and key values |
| Body | 16 / 24 | 400, descriptions and chat |
| Supporting | 14 / 20 | 500, secondary text and timestamps |
| Caption | 12 / 16 | 600, badges and tab labels; never the only copy for critical work |

- **Spacing:** 4-unit grid: `4, 8, 12, 16, 20, 24, 32, 40, 48`. Content inset 20. Card padding 20. At least 12 between controls.
- **Radii:** 12 small tiles and badges, 16 inputs, 24 cards and bubbles, 32 capsule and sheet top corners, full pill for buttons and chips.
- **Elevation:** flat. Level 0 canvas; level 1 card with a `separator` edge; level 2 sheet on `raised` with scrim. The capsule's depth comes from `night`, not from a shadow. Mockups use tone and edges only.
- **Icons:** 24 × 24, 2-unit stroke, rounded caps and joins. Pair icons with text. Mirror directional arrows in RTL; never mirror clocks, cameras, numerals or the job line's meaning.
- **Motion:** purposeful and short. Live pulse on the current bead: 2 s ease-in-out, ring 100% to 0% opacity. Rail fill toward an arrival band is timer-driven and linear. Stage change: capsule content cross-fades in 200 ms and the bead springs forward in 350 ms. A new stamp fades and rises 8 units in 200 ms. Dock action change: 200 ms cross-fade. With Reduce Motion: no pulse (static double ring), no spring, cross-fades only. Haptics follow a server-confirmed result, never a tap.

## Signature components

| Component | Anatomy | Rules |
| --- | --- | --- |
| **Live capsule** | `night` surface, radius 32, padding 20. Top row: source glyph and label (provider or job), reference at the trailing edge. Hero: state in Display or Section title, time at the trailing edge. Job line. Footer: provenance ("Shared by Mateo · 08:52 Spain time"). Sizes: hero (350 × 260 to 300), card (350 × 150 to 190), pill (350 × 56, radius 28). | One per booking or shift. One tap target, opens the live screen. Quiet state when stale: no pulse, current bead becomes a ring, footer reads "Last confirmed …". Field mode flips polarity: `live` fill, `on-live` text, 2-unit `ink` border. |
| **Job line** | Horizontal rail, 6 units thick, radius 3, with 20-unit beads. Done: `live` fill with ink check, no label. Current: `live` bead with a pulsing 30-unit ring. Next: `night-muted` ring. Labels in Caption beneath the current and later beads; the last label is end-aligned to the rail. Day line: Confirmed, On the way, On site, Working, Finished. Journey line: Requested, Quoted, Booked, Visit, Signed off, Paid. | The current stage is always also written as text. On light surfaces the rail is `subtle`, done is `ink`, current is `live` with an `ink` border. The fill between "On the way" and "On site" is time-based toward the arrival band and is labelled as an estimate. Glance surfaces may drop the labels when the state is written beside the line. |
| **Crew dots** | 40-unit avatars (`person-*` fill, ink initials) with a 3-unit status ring and a 16-unit state glyph at the lower trailing corner. Overlap by 8 in a stack; "+2" chip after three. Name and role beside or beneath. | Ring: `outline` confirmed, `live` on the way or on site (with glyph), `attention-ink` hold, `critical-ink` gap. Customers see confirmed crew and crew-level state only. Per-worker state is foreman-only. State is always also text. |
| **Arrival band** | Label ("Arriving"), band in Display ("09:10–09:20"), zone line ("Spain time · 08:10–08:20 your time"), provenance. | States: window (booked, nothing declared), on the way (declared band), due now, no update since (band passed, no check-in), arrived (replaced by the check-in stamp). Never a map or a distance. A countdown may accompany the band, never replace it in the app. |
| **Stamp** | 32-unit glyph tile, title, actor and role, time with zone label once per feed. Photo stamps add a 64-unit thumbnail. | Kinds: crew status, attendance (crew-level for customers), shared photo, decision, system. Pending sync is a dashed tile with "Saved on this device · pending sync". A stamp is never edited; corrections are new stamps. |
| **Next-step dock** | Fixed bar, `surface`, `separator` top edge, 20 inset. One primary button, 56 high (64 in Field mode), full pill. Optional quiet secondary as a text button or a 56-unit icon button. Optional one-line context above the button in Supporting. | Ink button for ordinary actions. Lime button with a 2-unit ink border only when the action changes what others see live (On my way, Check in, Send offers, Confirm cover, Share update, Accept offer). Disabled shows the reason in the context line. Never two primaries. |
| **Live pill** | Capsule pill above the tab bar: pulsing bead, state, time, chevron. | Shown on tab roots other than the one that already shows the capsule. One pill; the most time-critical live object wins. |
| **Twin bubble** | Radius 24. Top: translation in the reader's language on `surface` (incoming) or `brand-soft` (sent). Attached strip beneath on `subtle`: "Original · Español" in Caption, then the exact original. Author, role and time outside the bubble. | Same language: one bubble, no strip. Pending or unavailable translation: original on top with the status in the strip position. RTL originals are right-aligned inside the strip regardless of UI direction. |
| **Offer clock** | 64-unit ring that drains toward the reply deadline, minutes inside, and the absolute deadline in text beside it ("Reply by 08:42 Spain time"). | The absolute deadline is always visible. The ring is not announced continuously to screen readers. Expired and filled states replace the ring with a static glyph. |
| **Cover ladder** | Rungs in order. At launch: **Own crew**, then **Propose a new visit**. Later: a **Vetted pool** rung between them. Each rung has its state, an offer clock when offers are out, and candidate rows. | A rung unlocks only when the one above is exhausted or its reply deadline passes. First valid acceptance reserves the slot; only the foreman's confirmation assigns. The pool rung is not drawn in launch screens. |
| **Two-clock time** | Site time in the primary style with "Spain time"; viewer's time beneath in Supporting with "your time". | Shown when the zones differ and the user has not turned it off. System surfaces lead with the viewer's time because the Lock Screen clock is the viewer's. |
| **Ask bar** | 64-high pill on `surface` with an `outline` border: "What needs doing?", mic and camera icons at the trailing edge. | Customer Now only. Opens C-02 with the chosen input mode. |
| **Hold banner** | `attention-soft` card with a hand glyph: "Safety hold", what is blocked and who must act. | Stays until the foreman has verified understanding and the worker has acknowledged the same version online. Never appears as cleared on a system surface. |

## Component inventory

| Component | Anatomy and behaviour | Required states |
| --- | --- | --- |
| Live capsule | See signature components. | Live, quiet (stale), paused, finished, Field-mode polarity, dark mode. |
| Job line | See signature components. | Each stage current; delayed; cover being arranged; cancelled. |
| Crew dots | See signature components. | Confirmed, on the way, on site, hold, gap, replaced, customer view, foreman view. |
| Arrival band | See signature components. | Window, on the way, due now, no update since, arrived. |
| Stamp | See signature components. | Confirmed, pending sync, rejected, photo, decision. |
| Next-step dock | See signature components. | Default, live action, processing (label kept), disabled with reason, offline. |
| Live pill | See signature components. | Live, quiet, hidden. |
| Twin bubble | See signature components. | Translated, same language, pending, unavailable, correction, queued, failed, RTL original. |
| Offer clock | See signature components. | Running, under two minutes, expired, filled, accepted awaiting confirmation. |
| Cover ladder | See signature components. | Gap, crew offers out, accepted, confirmed, no cover (propose a new visit); later: pool rung. |
| Two-clock time | See signature components. | Same zone, different zone, different date. |
| Ask bar | See signature components. | Rest, pressed, draft to resume. |
| Hold banner | See signature components. | Briefing required, verified awaiting acknowledgement, cleared (in app only), superseded. |
| Buttons | Full-pill. Primary `brand`, live `live` with ink border, secondary `outline` border, text button underlined in `brand-ink`, destructive label in `critical-ink`. Height 56; 64 in Field mode. | Default, pressed, focused, disabled with reason, processing, failed with recovery. |
| Inputs and composer | Persistent label above, radius 16, `outline` border, helper or error beneath. Composer keeps Attach and Send as separate labelled controls. | Empty, focused, filled, invalid, read-only, uploading, offline draft, keyboard open. |
| Chips | Pill, 40 high inside a 48 hit region. Selected: `brand` fill, `on-brand` text and a check. | Rest, selected, pressed, focused, disabled. |
| Booking card | Title, place, stage as text, mini job line, next step or confirmed time. One hit area. | Draft, sent, decision due, booked, live, finished, cancelled, stale. |
| Worker card | Crew dot, name, working languages, skills, availability, coarse eligibility with date. | Eligible, unavailable, pending review, not eligible, offered, accepted, selected. |
| Shift card | Time and site zone, task, coarse area or site, assignment state, next step. | Offered, accepted awaiting confirmation, confirmed, on the way, checked in, gap, cancelled. |
| Lists | Section title, rows of at least 56, `separator` rules, meaningful empty text. | Default, pressed, unread, empty, loading, paging error, cached. |
| Bottom sheet | Radius 32 top corners, handle, title and Close, scrolling content, dock at the bottom. Never swipe-only. | Peek, expanded, keyboard, processing, discard warning. |
| Tab bar | Three or four labelled destinations. Selected: `ink` icon and 700 label with a 4-unit `ink` dot beneath the label. Unread: count badge. | Selected, unselected, focused, unread, with live pill above. |
| Identity chip | 40-unit avatar plus name and role or business, top leading on every root. Opens S-06. | Single role, multiple roles, pending work, offline. |
| Status badge | Pill, Caption, icon plus exact stage text. | Neutral, info, success, attention, critical, queued, archived. |
| Language badge | "Original · Español", "Translation · English"; language names in full. | Known, corrected, unknown, pending, unavailable. |
| Calendar and day view | Localised date heading, agenda alternative, site time, state names in text. | Today, chosen, unavailable, conflict, proposed, confirmed, empty, cached. |
| Empty, loading, error and offline | Empty states say the next step. Loading keeps layout. Errors keep input. Offline banner shows last confirmed time and pending count. | First use, filtered empty, partial, network or access failure, offline draft, cached read-only, reconciling. |
| Toast | Short, non-critical, announced politely. Never the only route to undo. | Saved on this device, confirmed, failure with persistent recovery elsewhere. |
| Confirmation dialog | Item, action, acting role and context, effect, Cancel and a named action. | Ready, processing, invalidated, failed. |

## iOS and Android adaptations

Decisions, hierarchy and wording are the same on both platforms. Chrome, safe areas, permissions and pickers follow the platform. The app is built with Expo and React Native; see the [accepted stack](../../docs/architecture/mobile-tech-stack.md).

| Area | iOS | Android |
| --- | --- | --- |
| Back | Navigation bar Back and edge swipe; Close on sheets and modals. | Up in the app bar and system or predictive Back: keyboard, then sheet, then one route. Never switch role on Back. |
| Bars | Tab bar and dock respect the home indicator. | Bottom navigation and dock respect gesture or button navigation insets. |
| Sheets and permissions | Native detents; OS photo, camera and share surfaces. | Material modal sheet; system photo picker and share. Never draw a fake OS permission dialog. |
| Live surface | Live Activity on the Lock Screen and in the Dynamic Island (C-19, W-11, F-18, L-07). | Ongoing notification (C-20, W-12, and the Android variants of F-18 and L-07); promoted Live Update on Android 16 only where the system grants it. |
| Haptics and motion | One completion haptic after a confirmed result. Respect Reduce Motion. | Equivalent feedback; respect animation and vibration settings. |
| Date and time | Native pickers; windows and both zones also as text. | Native pickers with typed input; same text. |

## Live surfaces

All system surfaces follow three rules: they **open a record and never perform an action**; they show **no address, access detail, price, message text or worker position**; and missing permission, dismissal or expiry **never blocks or changes** a booking, a shift or attendance. Limits are from the [Live Activities research](../../research/tech-stack/live-activities-and-geofenced-attendance.md).

At launch, an ordinary push can open the record after unlock, and a status push can update a running card. Neither starts a visit card. iOS supports push-to-start from 17.2; Beacon does not use it at launch. On this phone, **Hide details** in S-18 starts on: a followed visit shows “BookBuddy visit · On the way”, without names, reference, arrival time or photos. An ordinary locked notification says “BookBuddy · You have an update”. Following and allowing more detail are separate choices; the OS may still hide the preview.

| Surface | Starts | Ends | Updates |
| --- | --- | --- | --- |
| Customer visit (C-19, C-20) | Only when the customer taps **Follow live** in C-09 in the foreground, for this visit on this phone. Opening C-09 is not enough. | On **Stop following** or Finished; an iOS Live Activity also ends at the 8-hour cap. Its final snapshot may remain visible up to 4 more hours. Never chained. | Stage changes only. Where the customer allows details, the OS renders the countdown from the shared estimate. The card becomes stale at the end of the arrival band. |
| Worker shift (W-11, W-12) | Locally, in the foreground, after a deliberate check-in, if the worker opted in. Never from a geofence. | At check-out, or at 8 hours with "Open the app to check out". | Local. Timer "Since check-in" rendered by the OS. Never shows a safety all-clear. |
| Foreman cover search (F-18) | In the foreground when the foreman sends offers, if the foreman has opted in to the cover card. | When cover is confirmed, the search is closed, or no cover is found. | Push on acceptance, decline or expiry. Countdown to the reply deadline is OS-rendered. Confirmation happens in F-12, never on the Lock Screen. |
| Session (L-07, later) | Not at launch. In the later flow, the customer chooses to follow the session in L-05. | At the session's end time. | Stage changes only. |

**Detailed previews:** the layouts below show the fields available after the user permits detail. Keep the generic preview on any locked surface while **Hide details** is on, including the Dynamic Island and Android notification.

**Lock Screen layout** (370 × 160, radius 28, `night`, padding 16):

1. Row 1: source glyph, provider or job label, reference at the trailing edge (Caption, `night-muted`).
2. Row 2: state in Section title (`on-night`); trailing countdown in Section title (`live`).
3. Row 3: job line, full width, with the current bead pulsing only if the system allows.
4. Row 4: arrival band in the viewer's time with "your time", then site time. Supporting, `night-muted`.

**Dynamic Island** (always black, system-drawn shape):

| Presentation | Leading | Trailing | Notes |
| --- | --- | --- | --- |
| Compact | Stage glyph in `live` (van, pin, wrench, check). | Countdown or short state: "14 min", "On site", "Done". | About 246 × 37 at the top centre. At most six characters trailing. |
| Minimal | Stage glyph only. | — | Used when another activity shares the island. |
| Expanded | Top row: provider and state. Centre: job line. Bottom: arrival band and one link, **Open visit**. | Countdown in `live`. | About 370 × 160, radius 44. The link opens C-09 after unlock. No buttons that change state. |

**Android ongoing notification:**

| Layout | Content |
| --- | --- |
| Collapsed | Small icon (stage glyph), "BookBuddy", time. Title: "Crew on the way · about 14 min". Text: "Terrace door repair · arriving 09:10–09:20". Determinate progress. |
| Expanded | Adds the crew line ("Mateo Ruiz and 1 more · Reformas Ruiz"), provenance and two actions that open the app: **Open visit**, **Message Mateo**. |
| Android 16 Live Update | `ProgressStyle` with the five day-line points and a tracker; status chip text "14 min". Requested only for user-initiated, time-sensitive phases. Falls back to the standard notification. |
| Worker shift | Chronometer "Since check-in 09:14", site alias, "Safety hold — open app" when relevant, one action **Check out** that opens W-06. |

Users can swipe most ongoing notifications away on Android 14 and later. Dismissal is not unfollow and not check-out; do not repost immediately.

## Accessibility and field ergonomics

- **Targets:** minimum 44 × 44 pt on iOS and 48 × 48 dp on Android. Beacon's default control is 56 high. **Field mode** (default on for Worker, optional for Foreman, in S-12) raises primary actions to 64, row height to 64, and spacing between targets to 16.
- **Gloves:** no swipe-only, long-press-only or drag actions. Destructive and primary actions sit at least 16 apart. Deliberate actions (check-in, accept, confirm cover) take two taps: the dock button, then a sheet that names the event. No hold-to-confirm.
- **Sunlight:** solid fills, full-opacity ink, 2-unit borders on controls. In Field mode the capsule flips to ink on lime, the brightest pairing in the system (14.3:1). No text on photos. No thin grey text for anything that matters.
- **Text scaling:** honour Dynamic Type and Android font scale to the largest sizes. Rows and docks grow, actions stack, sheets scroll. Times, prices, deadlines and consent text are never truncated.
- **Screen readers:** the capsule reads as one sentence: state, time with zone, who shared it and when. The job line is announced as "Step 2 of 5, On the way". Pulses, rings and avatars are decorative. Status changes are announced politely without moving focus. Countdowns are not announced on every tick.
- **Colour:** every state is also text and a glyph. Lime is paired with the word for the state.
- **Privacy on glance surfaces:** in S-18, **Hide details** is on by default. Turning it off allows a detailed preview; it does not start a card or override OS privacy settings.

## Localisation and original content

- Budget 30 to 40% expansion; wrap rather than shrink. Keep strings whole with placeholders. No text baked into images.
- **RTL:** mirror layout, tab order and directional arrows. The job line runs right to left in RTL, with the same stage order in reading direction. Times, job IDs, prices and Latin names are isolated and never reversed. In SVG mockups right-align RTL text with `text-anchor="end"`; do not use `direction` or `unicode-bidi`; draw the two ends of a time range as separate `text` elements.
- **Original plus translation:** UI language, reading language, working languages and a message's actual language are four separate things. When the reading language differs from the source, show the translation first and the original directly beneath it in the twin bubble or a twin card (quotes, briefings, changes). Both are readable without a tap. Same language: show once. No translation yet: show the original with the status.
- Approved quote text, issued safety instructions and receipts are never rewritten by a language change. Machine translation is never consent, acknowledgement or proof of understanding.
- Dates, numerals, plurals and currency follow the UI locale. EUR stays EUR. Operational times use the site's time zone first, with the viewer's time alongside when it differs; name the zone ("Spain time"), not only a countdown.
- The UI ships in **English (default) and Portuguese**. Draw fixtures in English; draw a Portuguese variant where the inventory asks, to prove expansion, and an Arabic RTL variant where it asks, to prove mirroring. Arabic is a tolerance test, not a launch language. Message languages are not limited to UI languages.
