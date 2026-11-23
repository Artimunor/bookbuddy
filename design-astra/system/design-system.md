# Design system

## Brand direction

Keep Sol’s calm local-service green, readable forms and named foreman. Give a visit one recognisable shape: a **visit ticket** with a deep green face and a short, notched progress rail. The large line answers “What’s happening?”; the next line says who reported it and when. This is a service record, not a tracking map. A quote, a safety hold or a failed upload deserves a different, plainer layout. No gloss, gradients, text on photographs or colour-only status.

## Colour tokens

Use semantic names, not visual colour names, in design handoffs. The default follows system appearance; Light/Dark override is in S-12. SVGs use these exact hex values. Neutrals carry most of the interface; reserve semantic fills for labels, state changes and notices.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `canvas` | `#F4F7F6` | `#101A18` | App background |
| `surface` | `#FFFFFF` | `#182622` | Cards, fields and bars |
| `raised` | `#FFFFFF` | `#21332E` | Dialogs, sheets and floating panels |
| `subtle` | `#EBF2EF` | `#253833` | Neutral tint, secondary pane, disabled fill |
| `ink` | `#152C26` | `#F0F7F4` | Titles, body and primary icons |
| `muted` | `#425B52` | `#B9CCC4` | Supporting text, placeholders and secondary icons |
| `separator` | `#D4E1DB` | `#374D45` | Decorative rules only; not a control boundary |
| `outline` | `#70877D` | `#819C91` | Functional boundaries, unselected controls |
| `brand` | `#0B6250` | `#8EE0C5` | Primary action and focus ring |
| `on-brand` | `#FFFFFF` | `#102820` | Text and icons on solid action |
| `brand-pressed` | `#084638` | `#68C8A7` | Pressed primary action |
| `brand-soft` | `#DCF2EA` | `#203C33` | Selected tab/chip, sent messages, brand panel |
| `brand-ink` | `#0B5747` | `#A1EBD4` | Text on `brand-soft`, links on neutrals |
| `info-soft` / `info-ink` | `#E5F0FA` / `#234C78` | `#1E3549` / `#B8DBFF` | Information, proposed/scheduled for review, translation label on matching tint |
| `success-soft` / `success-ink` | `#E7F4E8` / `#245936` | `#23392A` / `#AFDEB2` | Confirmed booking, saved on server, paid |
| `attention-soft` / `attention-ink` | `#FFF1D5` / `#704500` | `#422F16` / `#FFDA91` | Action due, pending sync, briefing required |
| `critical-soft` / `critical-ink` | `#FCE9E8` / `#853531` | `#462828` / `#FFC3BE` | Blocking errors or destructive confirmations |
| `scrim` | `#101A18` | `#101A18` | Modal scrim at 40% opacity, no text over scrim |
| `ticket` / `on-ticket` | `#123C33` / `#FFFFFF` | `#203C33` / `#FFFFFF` | One focal panel for the current visit, shift or booking |
| `ticket-mark` / `ticket-track` | `#C9F2CC` / `#7AA99B` | `#C9F2CC` / `#7AA99B` | Milestone mark or key figure / unfilled track outline on `ticket` |
| `paper` | `#FAF7EF` | `#182622` | Warm neutral canvas on focused visit views; normal `ink` and `muted` text |

**WCAG 2.2 AA contrast.** Verified design-token ratios below use [WCAG 2.2 relative luminance and contrast (12 Dec 2024)](https://www.w3.org/TR/2024/REC-WCAG22-20241212/#contrast-minimum). Aim for at least 4.5:1 for all text, even when WCAG allows 3:1 for large text; affordances and meaningful graphics aim for at least 3:1. This checks token pairings, not runtime accessibility. Use only the pairings below for text and control boundaries; light/dark values are shown in that order.

| Intended pairing | Light | Dark |
| --- | ---: | ---: |
| `ink` on `canvas` / `surface` / `raised` / `subtle` / `brand-soft` | 13.72 / 14.79 / 14.79 / 13.01 / 12.63 | 16.33 / 14.42 / 12.24 / 11.41 / 11.00 |
| `muted` on the same backgrounds | 6.84 / 7.37 / 7.37 / 6.48 / 6.29 | 10.56 / 9.33 / 7.92 / 7.39 / 7.12 |
| `outline` boundary on `canvas` / `surface` / `raised` / `subtle` | 3.57 / 3.85 / 3.85 / 3.39 | 6.00 / 5.30 / 4.50 / 4.19 |
| `brand` focus on `canvas` / `surface` / `raised` / `subtle` / `brand-soft` | 6.77 / 7.30 / 7.30 / 6.42 / 6.23 | 11.51 / 10.17 / 8.63 / 8.05 / 7.76 |
| `on-brand` on `brand` / `brand-pressed` | 7.30 / 10.81 | 10.11 / 7.73 |
| `brand-ink` on `brand-soft` | 7.26 | 8.74 |
| `brand-ink` link on any of the four neutral backgrounds (minimum) | 7.49 | 9.07 |
| `info-ink` on `info-soft` | 7.65 | 8.80 |
| `success-ink` on `success-soft` | 7.24 | 8.23 |
| `attention-ink` on `attention-soft` | 7.40 | 9.51 |
| `critical-ink` on `critical-soft`; on neutrals (minimum) | 7.04; 7.24 | 8.66; 8.16 |
| `on-ticket`, `ticket-mark`, `ticket-track` on `ticket` | 12.21 / 9.92 / 4.64 | 11.96 / 9.72 / 4.54 |
| `ink`, `muted` on `paper` | 13.81 / 6.88 | 14.42 / 9.33 |

Use both icon and text for semantic banners and focus with a 2-unit `brand` ring and 2-unit neutral gap. If a tint does not distinguish a selection, add the checked state and an `outline` against a neutral boundary. Do not add opacity to text, outlines or selected states to approximate a new colour.

## Foundations

Use the platform system font. Sizes below are nominal design units (pt in iOS, sp for Android text); scale with platform settings. Use the semibold weight for key decisions and tabular figures where adjacent time or currency values need comparison. Do not reduce type to squeeze in longer copy.

| Style | Size / line height | Weight and use |
| --- | --- | --- |
| Display | 32 / 40 | 700, rare welcome/overview hero |
| Page title | 28 / 34 | 700, tab root title |
| Section or stack title | 20 / 26 | 650, cards and navigation |
| Label / button | 16 / 22 | 650, controls and important labels |
| Body | 15 / 22 | 400, descriptions and chat |
| Supporting | 13 / 18 | 450, less prominent text, timestamps |
| Caption | 12 / 16 | 550, badges and tab labels; never the only copy for critical work |

- **Spacing:** 4-unit grid; use `4, 8, 12, 16, 20, 24, 32, 40, 48`. Content inset 20, card padding 16, gaps between controls 8 or more. Dense visual marks may be smaller than their hit regions.
- **Radii:** 8 for compact inputs/tiles, 12 for standard controls, 16 for cards and chat bubbles, 24 top corners for sheets, fully rounded pills. Keep clipping away from focus rings and larger text.
- **Elevation:** Level 0 flat canvas; 1 card on canvas with a `separator` edge; 2 bars with a rule and sheets/dialogs on `raised` with scrim. In native UI use platform surface/tone changes rather than stacking shadows; mockups use edges and tone only.
- **Icons:** 24 × 24 view, consistent rounded caps/joins, nominal 1.75–2 strokes. Use 16 for non-interactive inline status icons. Pair task/status icons with text; give icon-only actions accessible names. Mirror directional navigation arrows in RTL, not clocks, cameras, brand marks or numerals.
- **Ticket typography:** a 13/18 semibold context line, 28/34 bold statement and 15/22 source line. Use 32/40 tabular type for a decisive time or amount. Keep metadata sentence case; a short section stamp may be capitals, never a whole instruction. Use a flat list for related rows; do not give every line its own card.
- **Motion:** on a newly confirmed milestone, reveal only the changed notch and label together (180 ms ease-out, once). The following row stays anchored; announce the new state politely without moving focus. Reduce Motion/data: swap text and mark immediately. No pulse loop, shimmering timeline, moving pin, confetti or manufactured progress.

## Component inventory

| Component | Anatomy and behaviour | Required states |
| --- | --- | --- |
| Buttons | Solid primary, bordered secondary, text tertiary, destructive label on `critical-soft`, icon-only with accessible name. Default height 48; use leading icon only when helpful. One primary action per decision. | Default, pressed, focused, disabled with reason, processing with label preserved, success on parent surface, failure with recovery. |
| Inputs and composer | Persistent label, value and helper/error. Native keyboard as appropriate. Multiline expands; composer keeps attach and send separate, labeled controls. | Empty, focused, filled, invalid, disabled/read-only, uploading, offline draft, keyboard open. |
| Chips | Labeled filter/toggle with selected check or equivalent; passive labels are not taps. Allow wrapping, never horizontal scrolling as the only way to see essential filters. | Rest, selected, pressed, focus, disabled. |
| Job card | Title, property/venue, exact lifecycle status, next action or confirmed time and context. One row-level hit area; no competing nested controls. | Draft, request sent, decision due, booked, in progress, closed/cancelled, stale. |
| Worker card | Name, working languages, skills and availability; coarse eligibility with timestamp when relevant. No raw documents or nationality-based matching. | Eligible, unavailable/conflict, pending review, not eligible, stale, selected for offer. |
| Shift card | Time window/site zone, role/task, property or coarse area, assignment status and next action. | Offered, accepted pending confirmation, confirmed, expired/filled, gap/dropout, synced/queued attendance. |
| Lists | Clear section headings, labeled rows and dividers; meaningful empty text and search/filter context. | Default, pressed/focused, unread, empty, loading, paging error, partial/cached. |
| Bottom sheet | 24-radius top, handle as visual cue, accessible title + Close, content scroll and pinned action if needed; expand for text/keyboard. Never require a swipe. | Peek/expanded as useful, keyboard, processing, abandon draft warning (replace presentation, don't stack sheets). |
| Tab bar | Fixed role destinations with icon + label, `brand-soft` marker plus `brand-ink` label for selected tab. Navigation state remains clear without colour. | Selected, unselected, focused, unread with accessible count; hidden on the pushed/full-screen views defined in IA. |
| Status badge | Passive label plus icon when practical. Neutral draft/history, info proposed, success confirmed, attention action due/pending, critical blocked. Use the precise stage, not only the colour. | Current, changed/expired, queued versus server-confirmed, muted archive. |
| Language badge | Label source as `Original · Español` or target as `Translation · English`; spell language names out. Label uncertainty in text, not a flag. | Known, manually corrected source label, unknown source, pending or unavailable translation. |
| Translation bubble | Author/role and time outside bubble. If different, stack translated text first, separator, original language and exact source; same-language message is shown once. Use `surface` incoming and `brand-soft` sent. | Original-only, translated, processing, unavailable, correction, draft/queued/failed send, read-only. |
| Timeline | Label event, actor/role if meaningful, time + zone label and related action. Keep system events visually distinct from evidence/comments. | Upcoming, done, changed, pending sync, issue/hold, no events. |
| Calendar and day view | Localised date heading, agenda alternative, site time and clear state names. Limited capacity or conflicts also appear in text. | Today, chosen, unavailable, conflict, held/proposed, confirmed, empty, cached. |
| Empty, loading, error and offline | Empty explains next step; loading preserves layout and announces long waits; error keeps inputs and offers targeted recovery. Offline banner shows last confirmed time and pending count where useful. | First use vs filtered empty; partial loading; inline/network/access failure; offline editable draft vs cached read-only; reconciling or conflict. |
| Toast | Short noncritical confirmation with spoken polite announcement. No critical info or only route to undo in a timed element; use persistent inline feedback instead. | Saved locally, server-confirmed informational event, fail only with persistent recovery on the surface. |
| Confirmation dialog | Item, action, actor/context, downstream effect, cancel + explicitly named action. Focus the title or safer action first and return focus to trigger. | Ready, processing, changed/invalidated, failure; show definitive outcome on the parent. |

### Visit ticket and live components

| Component | What to draw | Behaviour |
| --- | --- | --- |
| Visit ticket | 20-unit radius, 16–20 inset, one deep-green panel per view. Group role/visit, phase, then one source and site time. A next step sits below a ruled edge. | Use on an active visit or shift; before booking use a neutral next-action card. An active safety hold or unresolved delivery risk comes before routine actions. |
| Notched rail | Four short segments for **Booked · On the way · On site · In review**. Complete = solid with tick, current = outlined diamond or ring on a solid line, later = outlined/dashed. Name the current milestone in words; the full accessible label lists the states. | A record of observed milestones, not a required sequence. Skip unreported events without backfilling; a later true milestone can be current while an earlier one is unknown. Delay/cover/changed window are notices, not extra stages. Never calculate a percentage or ETA from time, distance or headcount. |
| Event ledger | Time aligned in a narrow column; a stroke and distinct nodes bind the verb and credited source in the other. State the site date/zone once per group; append an optional second zone. Below it give the next action or next update if actually promised. | Newest confirmed event first, stable event IDs; link superseding/correcting updates, don't erase the original. For a missed update show the actual last report and contact, not a rolling forecast. |
| Follow control | Before **Follow live**, label the example **Lock Screen preview** on iPhone or **Ongoing notification preview** on Android. Show the actual safe contents, e.g. “Service visit · Crew on site · Reported 09:12 Spain time”, and say “No names or address”. Once on, show **Stop following**. | Opening the ledger does not subscribe. Only choosing Follow in the foreground starts this device’s display for this visit. The ledger works without permission. Duplicate taps reuse one display; ending or losing scope cannot alter the job or expose the prior scope. |
| Worker shift card | W-10 shows shift reference, deliberate arrival/departure event time, receipt state, hold separately, and an authenticated link to W-06. | Before arrival, no ticking clock. Confirmed arrival: “Since check-in”, not hours worked. Local-only arrival: “Saved on this device · pending sync”; no confirmed clock or customer event. Checkout stops the clock at event time; never use elapsed site time as payroll. |

### System status surfaces

S-18 and S-19 are OS presentations of the same permitted summary, not app tabs. Customer projection: generic visit alias, reported milestone, last report or stale label. Worker projection: generic shift alias, since check-in or pending sync, and “Safety hold · open app” when applicable. No worker location or route, address, client/worker name, safety all-clear, entry instructions, chat excerpt, money or private shift detail. Use a generic signed-out/redacted state when required.

| Presentation | Layout and destination |
| --- | --- |
| iOS Lock Screen | Leading ticket glyph and service label, large plain-language phase, small rail and site timestamp. Tap opens C-18 after unlock; worker checkout link opens W-06 for review, never commits. No Island required. |
| Dynamic Island | Compact: leading ticket glyph, trailing short phase. Minimal: one recognisable glyph with accessibility label. Expanded: short reference above phase, rail, source time and open-app affordance. No tiny duplicate timeline or text inside the camera cutout. All presentations use the same revision and deep link. |
| Android ongoing | Ordinary OS template and channel, small monochrome glyph, title = phase, one line for last report or confirmed since-check-in. Expanded notification can add a next step; tap opens the authorised app record. No custom island or guaranteed status chip. Respect Android 13+ notification permission and channel settings; on Android 14+ dismissal can be allowed. No immediate repost on dismissal. |

Start locally in the foreground after the customer's explicit follow, or an opted-in worker’s deliberate check-in. A widget/notification never creates an attendance event. iOS push-to-start requires iOS 17.2+ and a previously registered token; it is **not a launch path**. Updates and end may be pushed for an existing activity if supported and proven; use source timestamps, stale dates and changes only (under 4 KB on iOS). No background socket, polling, tick requests, Android foreground service or assumed push delivery. End promptly on completion, cancellation, checkout, unfollow or loss of scope. At **8 hours active** iOS ends the activity; the final snapshot can linger on the Lock Screen for **up to 4 more hours**, not as live status. No automatic restart. Freeze stale timers; if Android updates stop, time out the notification. With displays disabled, unavailable or expired, open C-18 or W-10/W-06 normally. Signed-device proof is required before offering these optional displays.

**Notification copy and order.** On Android the OS draws the app label, relative notification time, expand control and channel styling. Do not mistake that OS timestamp for the source event time. In the collapsed customer view place **Crew on site** in the title slot and **Service visit · Reported 09:12 Spain time** in the text slot; expanded content may add **Open visit updates**. For a worker, use **Shift status** with **Since check-in** and an OS-rendered duration only while confirmed and fresh. An active hold or pending receipt takes precedence over elapsed time. **Check out** opens W-06 after unlock; never add a direct notification mutation. Use the public/redacted version when previews are hidden, not a private payload with text merely obscured by the mockup.

On either OS, read the last event’s source instant and stale deadline from the permitted projection. After the deadline, replace any “live” or elapsed treatment with **Last reported [site time] · Open app**; a promised next update that has passed is overdue, not an automatically updated milestone. If the phase is unknown, say **No crew report yet**. A cached read, a screen repaint and a new minute do not change the source timestamp.

## iOS and Android adaptations

The decision, destination hierarchy and language labels remain the same. Platform navigation chrome, safe areas, permissions and input controls follow native conventions. These are product rules, informed by [Apple HIG Accessibility (accessed 23 Nov 2026)](https://developer.apple.com/design/human-interface-guidelines/accessibility) and [Android accessibility guidance (accessed 23 Nov 2026)](https://developer.android.com/guide/topics/ui/accessibility/apps#large-controls).

| Area | iOS | Android |
| --- | --- | --- |
| Back and navigation | Use navigation bar Back and native edge swipe in stacks. Close or Done dismisses modal presentations; do not fake a Back gesture for a flow with no ancestor. | Support system Back including predictive preview where available: IME first, then sheet/modal, then one route. Provide Up in the top app bar for pushed pages. At role root, hand Back to platform; never silently switch roles. |
| Top and bottom chrome | Native-aligned toolbar and tab bar respecting home safe area. Keep English SVG labels even if the OS shell renders them differently. | Top app bar and bottom navigation respect system insets and gesture or button navigation. Preserve destination order and labels. |
| System sheets and permissions | Use OS photo, camera and sharing presentation where appropriate; native sheet detents for simple choices. | Use system photo picker, camera and share surfaces; Material modal bottom sheet for product choices. No imitation OS permission dialogs. Neither app processes customer payments. |
| Haptics and motion | Use a restrained selection acknowledgement or explicit completion haptic after a real response, not for every tap. Respect device settings and Reduce Motion. | Use platform feedback for equivalent selection/completion, respecting vibration and animation settings; never depend on haptics to confirm an event. |
| Date/time | Use native date/time control within the product flow. Render booking windows and both zones as accessible text outside it. | Use platform date/time picker with typed input alternative where available. Keep the same separate site-time and local-time review. |

## Accessibility and field ergonomics

- Minimum hit region **44 × 44 pt on iOS, 48 × 48 dp on Android**. Default common designs use at least 48 × 48 nominal units. Large controls in field mode use at least 56 × 56, and 64-high primary site actions where space permits. Separate check-in, check-out and destructive controls; never rely on swipe-only actions or a touch point tiny enough to miss with gloves.
- Honour Dynamic Type and Android font scaling through the largest supported accessibility settings. Allow rows and bars to grow, stack actions and scroll sheet content; at large sizes preserve Back, Close, title, context and the next action without clipping. Keep dates, prices, quote deltas and consent text visible in full.
- Provide VoiceOver/TalkBack names for icons, state semantics for selection and status, chronological reading order in chat and a polite announcement for status changes. Skip decorative avatars, rules and skeletons. Move focus into a sheet and restore it on close; never jump focus to a newly arriving message. Provide playback controls and transcripts when available, editable captions and readable status text for attachments.
- In sunlight use solid fills, strong borders for controls, persistent action text and full-opacity ink. Field mode increases tap sizes and spacing and prioritises task/date, briefing and attendance; it does not bypass authorisation or claim gloves are compatible with every touchscreen. Avoid info on photos, thin grey text and colour-only badges. Keep privacy-sensitive content out of the lock-screen copy.

## Localisation and original content

- Budget **30–40%** expansion in labels and instructions; allow longer content to wrap beyond that. Test narrow widths and large text together. Keep strings whole, with placeholders for dates, quantities, names and amounts; handle plural forms, grammar and per-paragraph direction. Text in the app must never be baked into non-decorative images.
- Launch UI is LTR. Exercise Arabic authored text and a non-shipping RTL pseudo-locale: mirror leading/trailing navigation and alignment, not time, prices or embedded IDs. In apps use logical layout and isolate authored passages separately; in static SVG use positioned text and `text-anchor="end"` for right-aligned RTL runs, never `direction` or `unicode-bidi`.
- Format dates, numerals, grouping, plurals and currency with the selected locale. Preserve the actual transaction currency (EUR for sample construction work), no implicit conversion. Preserve valid phone numbers and addresses as entered. Show operational dates in the service location time zone; optionally show the user's time alongside and never call a localised display a changed booking. Prefer a named zone and date, not only a relative countdown.
- Ship `en` (source/default) and `pt-PT` (Português (Portugal)); adding a UI language means translating the shared/mobile/web/push ICU catalogs, native-language review and enabling metadata, not changing flows. Select before sign-in; explicit choice takes priority over device preference, unsupported choices fall back to English, and the saved account choice wins after sign-in. Keep both catalogs bundled so switching offline needs no fetch. Use complete messages, `Intl`, the site’s IANA zone, +40% expansion and the architecture’s pseudo-locale gates. See [Internationalisation](../../docs/architecture/mobile-tech-stack.md#internationalisation).
- UI locale, account reading preference (including **Original only**), declared working language and the language of a particular original are independent. Enable each translation pair only after review. Preserve authored text/audio in any language; label a stored translation first and the immutable original immediately below, or show the original once when appropriate. Unavailable translation does not hide it. Changing locale does not change a quote, instruction, EUR amount or visit instant; machine output is neither consent nor teach-back.
