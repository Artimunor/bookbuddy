import { colors, jobLineColors, liveCapsule } from "../src/beacon";
import type { ColorScheme, ColorToken } from "../src/beacon";

type Palettes = Record<ColorScheme, Record<ColorToken, string>>;
type Ratios = readonly [light: number, dark: number];
type Pairing = readonly [foreground: ColorToken, background: ColorToken, published: Ratios, minimum?: number];

const textMinimum = 4.5;
const boundaryMinimum = 3;
const neutrals = ["canvas", "surface", "subtle", "raised"] as const;
const avatarFills = ["personA", "personB", "personC", "personD"] as const;
const { standard, field } = liveCapsule.colors;
const limeInkContrast = [14.30, 14.30] as const;

// Published values are rounded to two decimals. AA minima use the unrounded ratio.
// The design compares the weakest link/avatar pairing; every possible fill is checked.
const publishedPairings: readonly Pairing[] = [
  ["ink", "canvas", [16.18, 16.75]],
  ["ink", "surface", [17.93, 14.97]],
  ["ink", "subtle", [14.65, 12.05]],
  ["ink", "brandSoft", [14.86, 11.67]],
  ["muted", "canvas", [6.23, 9.63]],
  ["muted", "surface", [6.91, 8.60]],
  ["muted", "subtle", [5.64, 6.93]],
  ["muted", "brandSoft", [5.72, 6.71]],
  ["outline", "canvas", [3.93, 5.92], boundaryMinimum],
  ["outline", "surface", [4.36, 5.29], boundaryMinimum],
  ["outline", "subtle", [3.56, 4.26], boundaryMinimum],
  ["onBrand", "brand", [17.93, 15.90]],
  ["onBrand", "brandPressed", [11.73, 11.74]],
  ["brandInk", "brandSoft", [7.54, 7.69]],
  ...neutrals.map((bg): Pairing => ["brandInk", bg, [7.44, 7.94]]),
  ["onLive", "live", limeInkContrast],
  ["onLive", "livePressed", [11.51, 11.51]],
  [standard.accent, standard.fill, [14.30, 16.74]],
  [standard.text, standard.fill, [16.18, 18.62]],
  [standard.supportingText, standard.fill, [8.74, 10.70]],
  ["infoInk", "infoSoft", [7.67, 9.02]],
  ["successInk", "successSoft", [7.08, 8.71]],
  ["attentionInk", "attentionSoft", [7.50, 9.43]],
  ["criticalInk", "criticalSoft", [6.98, 9.02]],
  ...avatarFills.map((bg): Pairing => ["ink", bg, [14.18, 8.87]]),
];

function luminance(hex: string): number {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Expected an opaque six-digit hex color, got ${hex}`);
  const linear = (from: number) => {
    const channel = Number.parseInt(hex.slice(from, from + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
}

/** WCAG 2.2 relative-luminance contrast for two opaque sRGB colors. */
export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function contrastFailures(palettes: Palettes = colors): string[] {
  const failures: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    const check = (foreground: ColorToken, background: ColorToken, minimum: number, published?: number, role?: string) => {
      const ratio = contrastRatio(palettes[scheme][foreground], palettes[scheme][background]);
      const shown = ratio.toFixed(2);
      if (ratio < minimum || (published !== undefined && Number(shown) < published)) {
        const expected = published === undefined ? minimum : Math.max(published, minimum);
        failures.push(`${scheme} ${role ? `${role}: ` : ""}${foreground} on ${background}: ${shown}:1, expected ≥${expected}:1`);
      }
    };

    for (const [foreground, background, published, minimum = textMinimum] of publishedPairings) {
      check(foreground, background, minimum, published[scheme === "light" ? 0 : 1]);
    }

    check(standard.focusRing, standard.fill, boundaryMinimum, undefined, "capsule focus ring");
    const fieldRatio = limeInkContrast[scheme === "light" ? 0 : 1];
    check(field.text, field.fill, textMinimum, fieldRatio, "Field capsule text");
    check(field.supportingText, field.fill, textMinimum, fieldRatio, "Field capsule supporting text");
    check(field.border, field.fill, boundaryMinimum, undefined, "Field capsule border");
    check(field.focusRing, field.fill, boundaryMinimum, undefined, "Field capsule focus ring");
    if (scheme === "dark") {
      check(standard.border, "canvas", boundaryMinimum, undefined, "dark capsule border");
      check(standard.border, standard.fill, boundaryMinimum, undefined, "dark capsule border");
    }

    for (const [line, background] of [
      [jobLineColors.capsule, standard.fill],
      [jobLineColors.fieldCapsule, field.fill],
      [jobLineColors.neutral, "surface"],
    ] as const) {
      check(line.progress, line.rail, boundaryMinimum, undefined, "job line progress against unfilled rail");
      check(line.doneGlyph, line.done, textMinimum, undefined, "job line done glyph");
      check(line.nextRing, background, boundaryMinimum, undefined, "job line next bead");
      check(line.label, background, textMinimum, undefined, "job line label");
    }
  }
  return failures;
}
