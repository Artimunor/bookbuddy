# Chromium rendering check for design mockups

Chromium exposed one visible defect: the Evidence button border crosses the status text on F-15.

## Findings by owner

| Owner | Screens | SVGs inspected | Defects |
| --- | --- | ---: | ---: |
| DesignCustomerA | C-01–C-08 | 12 | 0 |
| DesignCustomerB | C-09–C-17 | 13 | 0 |
| DesignForemanA | F-01–F-07 | 12 | 0 |
| DesignForemanB | F-08–F-16 | 13 | 1 |
| DesignSharedA | S-01–S-09 | 13 | 0 |
| DesignSharedB | S-10–S-17 | 12 | 0 |
| DesignProvider | P-01–P-05 | 9 | 0 |
| DesignLater | L-01–L-06 | 11 | 0 |
| System template (no owner assigned) | — | 1 | 0 |
| **Total** | | **96** | **1** |

### DesignForemanB

- [F-15-propose-job-change.svg](../../design/screens/foreman/F-15-propose-job-change.svg#L29-L32): The Evidence button’s rounded lower-left border crosses the final `d` in “Worn latch plate · Selected to send.” The 13 px status text starts at `x=36` with baseline `y=185` and reaches about `x=250` in Chromium. The button is drawn after the text, starts at `x=239.5`, and ends at `y=179.5`, putting its border over the top of the last letter. The likely cause is the fixed placement of the unwrapped label and button in the same card without enough separation.

## Coverage and limits

Rendered 98 local files in headless Chromium (Chrome for Testing 153.0.8010.12) at 390 × 844 with GPU disabled and isolated temporary profiles. This covered all 95 non-worker screen SVGs, including state variants, and the only SVG in `design/system/`, `wireframe-template.svg`. The two other system files, `design-system.md` and `wireframe-conventions.md`, were captured as plain text; they are not artboards and are excluded from the defect counts.

Inspected every PNG and checked Chromium’s SVG bounds for possible overlap or viewport clipping. No other unintended clipping, overlaps, text anchoring problems, missing glyphs, or off-canvas artwork were visible. Expected background occlusion under dialogs and sheet fills that extend below the canvas to keep the bottom corners square were not counted. No Arabic RTL artboard was present in the reviewed set; `design/screens/worker/` was excluded. This was a Chromium-only check, so it does not establish whether F-15 also renders this way in Quick Look.
