# Screen SVG conventions

Use [`wireframe-template.svg`](wireframe-template.svg) for the shared chrome, type, spacing and drawing style. Use [`S-10-job-chat.svg`](../screens/shared/S-10-job-chat.svg) for an example of a pushed surface with translated content and a fixed composer. These are mid/high-fidelity fixtures, not UI code. The [design system](design-system.md), [navigation map](../foundation/information-architecture.md) and [inventory](../screens/inventory.md) define the behaviour behind the drawing.

## Files and artboard

1. Save a primary artboard at `design/screens/<slice>/<ID>-<slug>.svg`. Allowed slice directories: `customer` (C), `foreman` (F), `worker` (W) and `shared` (S, P, L). Keep the zero-padded inventory ID and use lowercase, hyphen-separated English slugs. Example: `design/screens/shared/S-10-job-chat.svg`. A requested state variant appends its state to the slug (`S-10-job-chat-offline.svg`), not a new ID. Each file shows one app state, not a collage of canvases.
2. Root geometry is exactly `width="390" height="844" viewBox="0 0 390 844"` with `xmlns="http://www.w3.org/2000/svg"`. No device bezel or labels outside it. Provide `role="img"`, `aria-labelledby`, an SVG `title` naming the route and a `desc` explaining role/state/meaningful details. Keep text as SVG `text`/`tspan`; manually wrap to intended widths. Use layer groups such as `status-bar`, `header`, `content`, `tab-bar`, `composer`, `home-indicator`. Mark decorative groups `aria-hidden="true"` as useful; the SVG is not an interactive prototype.
3. Files are self-contained XML. Use `font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"`. No external fonts/images, external links, raster assets, CSS imports, scripts or `foreignObject`. Draw needed thumbnails/illustrations with SVG paths and palette fills; use sample labels or a deliberate no-photo state rather than fake evidence. Use only exact hex values from the design system, `none` for no fill or stroke, and 40% opacity only for the `scrim`. Internal reuse via groups/defs is fine. Escape `&` and `<` in text.
4. Default review fixture is light, English and iOS-shaped. Show a dark, Arabic RTL or large-text variant when that is the state under review; same dimensions, no device frame. Do not use the iOS artboard dimensions to set the runtime Android layout. See the design system for actual platform adaptation.

## Chrome and alignment

| Region | Fixed drawing convention |
| --- | --- |
| Status bar | `y=0–44`, time `9:41` baseline 29, left at x=20; signal, Wi-Fi and battery at right with 20-unit inset. Match its fill to the adjacent header. |
| Header | `y=44–108`. Place primary text at x=20 for roots and x=64 after Back on a pushed screen; use 48-unit icon hit regions. Root header can show service/business context; use 20/26 title in pushed screens and place secondary context beneath it. |
| Content | Usable width `350` from x=20 to x=370. Use 4-unit grid and 16-unit card padding. Fixed context/tabs go above the scrollable contents; preserve bottom clearance for bars. A scroll clip should hide nonvisible content instead of shrinking it. |
| Tab bar | Root only: `y=746–810`, full width, surface fill and separator. Four equal cells; centres x≈49, 146, 244, 341. Use 24-unit icons, a 48 × 30 soft selected indicator and 12-unit labels. Selected label is `brand-ink`, others `muted`. |
| Pushed screen footer | No tab bar in a pushed screen. A fixed action or composer may use `y=744–810`, surface fill, separator and an explicit 48-unit control height. Otherwise content can scroll to the home safe area. |
| Home safe area | `y=810–844`, fill continuous with the adjoining bar or sheet. Draw the centred `ink` home indicator at `x=128 y=831`, `134 × 5`, `rx=2.5`. Draw it on every artboard, even over a modal. |
| Sheets and dialogs | Use a realistic underlying parent screen, a full-frame `scrim` above it and a readable sheet/dialog surface above that. Sheet top corners 24; include explicit Close and show the home indicator in the sheet's bottom safe area. Use full-height treatment if a choice would otherwise hide context or actions. |

For root/pushed chrome use the same status bar and home indicator as the references. Match the treatment for repeated components across slices: 48-unit buttons and icon hit regions, 12-radius controls, 16-radius cards/bubbles, 1-unit separators and rounded outline icons. Cards show real title, status, next step and time instead of placeholder bars; borders for inputs and controls use `outline`, not `separator`. Show persistent pending/blocked text where it matters. Never represent an unavailable action with an active primary button.

## Shared fixture and state handoff

Use fictional sample content; do not use real addresses, access codes, phone numbers or personal photos. Use these values for the same repair across roles:

| Field | Sample |
| --- | --- |
| Job and property | `BB-1042 · Terrace door repair`, `Villa Mar · Xàbia` |
| Customer and provider crew | `Claire Martin` (Customer), `Mateo Ruiz` (Foreman and Provider admin), `Nadia Benali` (Worker) |
| Provider, app and region | `Reformas Ruiz` is Mateo’s business in Xàbia. Use that name for business labels, invitations, quotes and receipts. `BookBuddy` is the platform brand; `Costa Blanca` is the region. |
| Timing | Job day `Tue, 24 Nov · 09:00–10:00` Spain time (`Europe/Madrid`); an abroad view can also show `08:00–09:00 your time` if using UK time. The chat reference is the preceding day. |
| Quote | Version 1, `€240.00` in the English fixture; a separate proposed change can show `+€40.00`, `€280.00` new total. These are sample amounts, not rate guidance. |
| Chat | Worker viewer, English reading preference, in Job conversation. Claire writes in French, Mateo in Spanish; both translations and labelled originals are visible. The worker-only briefing cue opens S-11. |

Choose the row's most useful review state and keep the surrounding job stage consistent with it. For example, don't show exact site access on a pending external offer or a paid badge in an unresolved checkout. Use separate state variants when the meaningful interaction changes; name them per §1 and do not imply that later-category paths are in the launch shell. Before handoff, parse XML, check palette and canvas, and review the visible hierarchy, safe areas, intended wrapping, tap sizes and state text. Compare any reused component with the master pair rather than drawing a new style.
