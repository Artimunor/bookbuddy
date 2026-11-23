# Screen SVG conventions

Use the [template](wireframe-template.svg) for shell geometry, [C-18](../screens/customer/C-18-follow-live.svg) for a visit ticket and public ledger, [W-01](../screens/worker/W-01-today.svg) for field hierarchy, and [S-18](../screens/shared/S-18-live-activity.svg) for privacy outside the app. Keep [S-10](../screens/shared/S-10-job-chat.svg) as the original/translation reference. These are reviewable fixtures, not executable controls. Behaviour lives in the [design system](design-system.md), [navigation map](../foundation/information-architecture.md) and [inventory](../screens/inventory.md).

## Files and artboard

1. Save a primary artboard at `design-astra/screens/<slice>/<ID>-<slug>.svg`. Directories: `customer` (C), `foreman` (F), `worker` (W) and `shared` (S, P, L). Keep zero-padded IDs and lowercase English slugs. State variants use a **double hyphen** (`S-18-live-activity--compact.svg`); one state per 390 × 844 artboard, no device collage. Do not rename the spec bundles when extending their ranges. Embed the new primary and variants in their `## <ID> <Name>` section before Open design questions, and connect actual entries/exits in the Mermaid navigation diagram.
2. Root geometry is exactly `width="390" height="844" viewBox="0 0 390 844"` with `xmlns="http://www.w3.org/2000/svg"`. No device bezel or labels outside it. Provide `role="img"`, `aria-labelledby`, an SVG `title` naming the route and a `desc` explaining role/state/meaningful details. Keep text as SVG `text`/`tspan`; manually wrap to intended widths. Use layer groups such as `status-bar`, `header`, `content`, `tab-bar`, `composer`, `home-indicator`. Mark decorative groups `aria-hidden="true"` as useful; the SVG is not an interactive prototype.
3. Files are self-contained XML. Use `font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"`. No external fonts/images, external links, raster assets, CSS imports, scripts or `foreignObject`. Draw needed thumbnails/illustrations with SVG paths and palette fills; use sample labels or a deliberate no-photo state rather than fake evidence. Use only exact hex values from the design system, `none` for no fill or stroke, and 40% opacity only for the `scrim`. Internal reuse via groups/defs is fine. Escape `&` and `<` in text.
4. Default review fixture is light, English and iOS-shaped. Show `pt-PT` where a language selection is being demonstrated. Dark, RTL and large-text variants test a specific state; Arabic UI is a stress fixture, not a launch option. Right-align Arabic at its actual right inset with `text-anchor="end"`; never set `direction` or `unicode-bidi`. Position embedded IDs/times in separate text elements. Do not use horizontal squeezing, clipped text or an ellipsis in place of a critical action. The artboard is not the runtime Android layout.

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

For a visit ticket use `paper` behind one 350-wide `ticket` panel, radius 20. Set the context at x=40, lead with a 28/34 phase, and allow a plain source/time line before the rail. Use `ticket-mark` for recorded milestones and `ticket-track` for inactive strokes; distinguish them by shape too. One current diamond, no bouncing dots. Start the following section at least 24 units below. The ledger is one list, not a stack of duplicate cards. Apply the vocabulary elsewhere without making an ordinary form, safety warning or held offer look live.

S-18/S-19 are exceptions to app chrome: draw the OS-hosted surface at its plausible inset and scale, against a non-identifying system background, with no tab bar or fake application footer. S-18 compact/minimal/expanded are separate **states of the same ID**. Leave the camera area clear. Minimal hosts just the glyph; the spec and SVG description carry its accessible meaning. S-19 uses the Android shade’s actual information hierarchy; do not copy the iOS capsule. No client name, location, amount, chat, alarm code or safety all-clear on either.

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
| Live visit example | Tue, 24 Nov · Spain time. Booked Mon, 23 Nov 08:36; Mateo reports On the way at 08:48 and On site at 09:12 Tue. The 09:00–10:00 agreed window is unchanged. W-01 shows Nadia’s **separate** deliberate check-in at 09:14, with a hold still active. S-18 shows only “Service visit”, On site and 09:12, no people, site or worker event. These are sample reports, not predicted times. |

Keep surrounding state consistent: no site access from an offer, paid badge on a customer report, public evidence from a queued file, or safety clearance from check-in. Label F-11 and all individual pool offers later and keep them off launch navigation. Keep Xàbia as a fictional fixture context, not a pilot decision.

**Render handoff.** Render each changed SVG both ways. Quick Look’s direct thumbnail may crop a portrait at the top square. For a full comparison, additionally place the original, unscaled 390 × 844 SVG at x=227 inside a temporary 844 × 844 SVG; run the same Quick Look command on that wrapper and inspect its central 390 × 844 strip beside Chromium’s full frame. This changes only the preview viewport. Check glyph placement, end alignment, line wraps, insets and controls against their actual container. Use a temporary directory and isolated Chromium profile; remove both after inspection. Do not use a personal browser session.

```sh
qlmanage -t -s 844 -o "$tmp" "$svg"
timeout 60 "$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell" --headless --disable-gpu --user-data-dir="$tmp/profile" --window-size=390,844 --screenshot="$tmp/chromium.png" "file://$absolute_svg"
```
