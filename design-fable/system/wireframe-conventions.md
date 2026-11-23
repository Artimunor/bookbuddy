# Screen SVG conventions and sample data

Start from [`wireframe-template.svg`](wireframe-template.svg) for chrome, type and drawing style. Compare every reused component with the lead-drawn reference screens listed below. The [design system](design-system.md), [navigation](../foundation/information-architecture.md) and [inventory](../screens/inventory.md) define the behaviour behind each drawing. The mockups are fixtures, not UI code.

## Files and artboard

1. Save to `design-fable/screens/<folder>/<ID>-<slug>.svg`; a state is `<ID>-<slug>--<state>.svg`. Folders: `customer` (C), `foreman` (F), `worker` (W), `shared` (S, P, L). Lowercase English slugs. One state per file, never a collage. System surfaces go in the folder of the role that sees them.
2. Root is exactly `width="390" height="844" viewBox="0 0 390 844"` with `xmlns`, `role="img"`, `aria-labelledby`, a `title` naming the screen and state and a `desc` that says who is looking, when, and what the screen states. No bezel and nothing outside the artboard.
3. Self-contained XML. `font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"`. No external fonts, images, links, CSS, scripts, `foreignObject`, filters or gradients. Text stays as `text`; wrap by hand. Draw thumbnails with paths and palette fills.
4. Colours: only hex values from the [design system](design-system.md#colour-tokens), plus `none`. Opacity only for the scrim (40%). `#000000` is used only for the Dynamic Island and dark-mode `night`.
5. Type: only the sizes in the scale (40, 28, 20, 17, 16, 14, 12) and weights 400, 500, 600, 700, 800. A Lock Screen clock may use 96.
6. The default fixture is light, English, iOS-shaped. Draw Portuguese, Arabic RTL, dark or large-text variants only where the inventory names them.

## Rendering in Quick Look and Chromium

Every SVG must look the same in both. Rules learned from the reference reviews:

- Right-align RTL text with `text-anchor="end"` at the right edge of its column. Never use `direction` or `unicode-bidi`. Draw the two ends of a time range, and any Latin name inside Arabic text, as separate `text` elements at explicit positions.
- Keep text inside its container with at least 12 units of clearance. Budget about 0.56 × font size per Latin character at weight 600 to 700 and check the render; do not trust the estimate for the last few units.
- Do not rely on `tspan` positioning, `textLength`, `dominant-baseline` or `letter-spacing`. Set `x`, `y` and `text-anchor` on each `text`.
- Draw strokes on half-unit coordinates for 1-unit lines so they stay crisp.
- Check before handoff. Quick Look: `qlmanage -t -s 844 -o <tmp> <svg>` renders the top of a portrait artboard; to see the whole artboard, wrap a copy in an 844 × 844 SVG in the temp folder and render that. Chromium: the Playwright headless shell with `--headless --disable-gpu --user-data-dir=<tmp> --window-size=390,844 --screenshot=<png> file://<abs svg>`. Never use the user's Chrome. Delete the temp files.

## Chrome and alignment

| Region | Convention |
| --- | --- |
| Status bar | `y=0–44`. Time at x=20, baseline 29, 15/700. Signal, Wi-Fi and battery at the right, as in the template. Live artboards show the viewer's local time at that point of the story; other artboards show `9:41`. |
| Root header | `y=44–108`. Identity chip: 40-unit avatar centred at (40, 76), name at x=72 y=72 in 17/700, role, business or place at y=92 in 14/500. Bell in a 48-unit circle at x=322, y=52. |
| Root title | Page title at x=20, baseline 148; date or context line at baseline 172 in 14/500. |
| Pushed header | Back chevron in a 48-unit hit region at x=12–60; title at x=64, baseline 72, 20/700; context at baseline 94, 14/500. One trailing action at most. |
| Content | x=20 to 370. Cards: radius 24, padding 20 (text starts at x=40 inside a full-width card), 1-unit `separator` edge. Capsule: radius 32, `night`, padding 20. Clip what does not fit; do not shrink. |
| Tab bar | Roots only: `y=746–810`, `surface`, `separator` top edge. Three tabs centred at x=65, 195, 325; four at x=49, 146, 244, 341. Icon at y=757–781, label baseline 798 in 12/600, selected in `ink` 700 with a 2-radius dot at y=806. |
| Dock | Pushed screens: `y=724–810`, `surface`, `separator` top edge, button at y=738, 56 high, x=20–370, full pill. Field mode: button 62 to 64 high. On a root, the dock sits above the tab bar at `y=646–746`. |
| Live pill | Roots only: `y=682–738`, x=20–370, `night`, radius 28. |
| Home indicator | `x=128 y=831`, 134 × 5, radius 2.5, on every artboard. |
| Sheets | Real parent screen, full-frame scrim, sheet on `raised` with 32-radius top corners, handle, title and Close, dock inside the sheet. |
| System surfaces | Lock Screen card: x=10, 370 × 160, radius 28, `night`. Island compact: x=95, y=11, 200 × 37, radius 18.5, `#000000`. Island expanded: x=10, y=11, 370 × 170, radius 44. Android notification: x=8, 374 wide, radius 28, `surface` on a `subtle` shade. Draw a neutral wallpaper from palette fills; no app names or real icons. |

Primary buttons are `brand` with `on-brand` text. A lime button with a 2-unit `ink` border is used only for an action that changes what others see live. Never show an unavailable action as an active primary; show it disabled with the reason in the dock's context line.

## Lead-drawn reference screens

| File | What it fixes for everyone |
| --- | --- |
| [`wireframe-template.svg`](wireframe-template.svg) | Root chrome: identity chip, bell, page title, ask bar, capsule (card size), stamps card, three-tab bar. |
| [`C-09-live-visit.svg`](../screens/customer/C-09-live-visit.svg) | Pushed chrome, the Today and Whole job switch, the hero capsule with arrival band, day line, crew dots and provenance, Follow live strip, Moments, single-action dock. |
| [`C-19-visit-live-activity.svg`](../screens/customer/C-19-visit-live-activity.svg) | Lock Screen card layout and the wallpaper style for system surfaces. |
| [`C-19-…--island-compact.svg`](../screens/customer/C-19-visit-live-activity--island-compact.svg), [`--island-expanded.svg`](../screens/customer/C-19-visit-live-activity--island-expanded.svg) | Dynamic Island geometry, glyph and countdown placement, the one Open visit link. |
| [`W-01-now.svg`](../screens/worker/W-01-now.svg) | Field mode: lime capsule with ink border, offer clock, 62-unit dock buttons above the tab bar, lime broadcast action. |
| [`S-10-job-chat.svg`](../screens/shared/S-10-job-chat.svg) | Language line, twin bubble, sent receipt naming the reader's language, inline stamps, composer. |

Notes for the owning slices:

- **C-09.** The capsule is the only dark object. The band is the hero (Display). The countdown chip is secondary and time-based. On site: the hero becomes "Crew on site" with "Since 09:14 Spain time"; working: "Working" with the latest photo stamp first in Moments; finished: the dock becomes **Review and sign off**. Cover being arranged: state in `on-night`, no band, "Mateo will update you by 08:45", bead 1 as a ring. Follow live disappears once on.
- **C-19.** Lead with the viewer's time on system surfaces. Trailing island text is at most six characters. The expanded island has one link and no state-changing control.
- **W-01.** Viewer is Diego Torres at 08:36. After acceptance the capsule reads "Accepted · waiting for Mateo" with "Do not travel yet"; the dock becomes a quiet **Withdraw**. Shift today uses the same capsule with the day line and a lime **On my way**.
- **S-10.** Viewer is Claire. Same-language messages are single bubbles. The stamp pills are system events, not messages, and appear only if customer-visible.

## Shared sample data

Fictional content only: no real addresses, access codes, phone numbers or photos. The minute-by-minute story is in the [inventory](../screens/inventory.md#story-and-clock).

| Field | Sample |
| --- | --- |
| Job and place | `BB-1042 · Terrace door repair`, `Villa Mar · Xàbia` |
| Customer | `Claire Martin`: owner and named approver, lives in the UK (one hour behind Spain), reads and writes English |
| Provider | `Reformas Ruiz`, Xàbia. It issues the quote and the bill. `BookBuddy` is the platform; `Costa Blanca` the region |
| Foreman | `Mateo Ruiz`: Foreman and Provider admin, writes Español |
| Crew | `Nadia Benali` (original assignee, drops out Tue 08:32), `Diego Torres` (own crew, covers), `Lucía Ortega` (own crew, offer closes as filled) |
| Visit | `Tue, 24 Nov · 09:00–10:00` Spain time (`Europe/Madrid`); `08:00–09:00 your time` for Claire |
| Arrival band | `09:10–09:20` Spain time, shared by Mateo at 08:52; `08:10–08:20 your time` |
| Quote and bill | Quote v1 `€240.00`, approved Mon 23 Nov 08:20. A separate proposed change can show `+€40.00`, new total `€280.00`. Bill from Reformas Ruiz `€240.00`, paid to the provider directly |
| Approved scope, original | `Ajustar la puerta de la terraza y sustituir los rodillos. No incluye la sustitución del vidrio.` Never altered. |
| Safety instruction | v1 issued to Nadia; v2 issued to Diego. "Do not use the terrace door until Mateo clears it." Human briefing with teach-back |
| Avatars | `CM` person-a, `MR` person-b, `NB` person-c, `DT` person-d |
| Later session | `Mat Pilates · Estudi Mar Pilates, Xàbia`, Sat 28 Nov 10:00–10:45, `€16.00` per person, booking `BB-S1042`, coordinator Marina Serra, host Elena Costa or substitute Lucía Vidal |

Keep each drawing's stage consistent with its time on the story. For example, do not show the crew's names on an unconfirmed offer, a paid stamp before the provider records it, or a band before 08:52.
