import {
  colors, componentColors, componentMetrics, ergonomics, focus, hitTargets, icons,
  jobLineColors, liveCapsule, logicalDirections, motion, radii, scrimOpacity, spacing, typography,
} from "../src/beacon";
import type { ColorScheme, ColorToken, ErgonomicsMode } from "../src/beacon";
import { contrastFailures } from "./contrast";

const generatedFrom = "Generated from src/beacon.ts by scripts/build.ts. Do not edit.";
const schemes = ["light", "dark"] as const;
const modes = ["standard", "field"] as const;

function scrim(scheme: ColorScheme): string {
  const hex = colors[scheme].scrim;
  const rgb = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  return `rgba(${rgb.join(", ")}, ${scrimOpacity})`;
}

type ColorRoles = Readonly<Record<string, Readonly<Record<string, ColorToken>>>>;

function nativeRoleReferences(groups: ColorRoles): string {
  return schemes.map((scheme) => `    ${scheme}: {\n${Object.entries(groups).map(([name, roles]) =>
    `      ${name}: {\n${Object.entries(roles).map(([role, token]) => `        ${role}: colors.${scheme}.${token},`).join("\n")}\n      },`,
  ).join("\n")}\n    },`).join("\n");
}

function nativeCapsuleStyle(scheme: ColorScheme, mode: ErgonomicsMode): string {
  const roles = liveCapsule.colors[mode];
  const borderWidth = mode === "field" ? "field" : `standard.${scheme}`;
  return `      ${mode}: {
        surface: {
          backgroundColor: colors.${scheme}.${roles.fill},
          borderColor: colors.${scheme}.${roles.border},
          borderWidth: liveCapsule.borderWidth.${borderWidth},
        },
        text: { color: colors.${scheme}.${roles.text} },
        supportingText: { color: colors.${scheme}.${roles.supportingText} },
        accent: colors.${scheme}.${roles.accent},
        focusRing: colors.${scheme}.${roles.focusRing},
      },`;
}

function renderNative(): string {
  const textStyles = Object.entries(typography.styles).map(([name, { fontSize, lineHeight, fontWeight }]) =>
    `    ${name}: { fontSize: ${fontSize}, lineHeight: ${lineHeight}, fontWeight: "${fontWeight}" },`,
  );
  const capsules = schemes.map((scheme) =>
    `    ${scheme}: {\n${modes.map((mode) => nativeCapsuleStyle(scheme, mode)).join("\n")}\n    },`,
  );
  return `// ${generatedFrom}
import {
  colors, componentMetrics, elevation, ergonomics, focus, hitTargets, icons,
  liveCapsule, logicalDirections, motion, radii, spacing, typography,
} from "./beacon";

const fontVariant: (typeof typography.numericFontVariant)[] = [typography.numericFontVariant];

export const native = {
  colors,
  // The palette stores opaque scrim ink. Use this precomposed color for the overlay.
  scrim: { light: "${scrim("light")}", dark: "${scrim("dark")}" },
  typography: {
${textStyles.join("\n")}
  },
  tabularNumbers: { fontVariant },
  spacing,
  radii,
  icons,
  focus,
  hitTargets,
  elevation,
  motion,
  ergonomics,
  componentMetrics,
  logicalDirections,
  liveCapsule: {
${capsules.join("\n")}
  },
  jobLineColors: {
${nativeRoleReferences(jobLineColors)}
  },
  componentColors: {
${nativeRoleReferences(componentColors)}
  },
} as const;
`;
}

type Declaration = readonly [name: string, value: string | number];
const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const px = (value: number) => `${value}px`;
const rem = (value: number) => `${value / 16}rem`;
const ms = (value: number) => `${value}ms`;
const cssVar = (name: string) => `var(--beacon-${name})`;

function cssBlock(selector: string, declarations: readonly Declaration[]): string {
  return `${selector} {\n${declarations.map(([name, value]) => `  ${name}: ${value};`).join("\n")}\n}`;
}

function cssMedia(feature: string, block: string): string {
  return `@media (${feature}) {\n${block.split("\n").map((line) => `  ${line}`).join("\n")}\n}`;
}

function cssPalette(scheme: ColorScheme): Declaration[] {
  return [
    ["color-scheme", scheme],
    ...Object.entries(colors[scheme]).map(([key, value]): Declaration =>
      [`--beacon-color-${kebab(key)}`, key === "scrim" ? scrim(scheme) : value]),
    ["--beacon-live-capsule-standard-border-width", px(liveCapsule.borderWidth.standard[scheme])],
  ];
}

function cssColorRoles(groups: ColorRoles): Declaration[] {
  return Object.entries(groups).flatMap(([name, roles]) => Object.entries(roles).map(([role, token]): Declaration =>
    [`--beacon-color-${kebab(name)}-${kebab(role)}`, cssVar(`color-${kebab(token)}`)],
  ));
}

function cssErgonomics(mode: ErgonomicsMode): Declaration[] {
  return Object.entries(ergonomics[mode]).map(([key, value]) => [`--beacon-${kebab(key)}`, px(value)]);
}

function renderCss(): string {
  const standardColors = cssColorRoles({
    liveCapsule: liveCapsule.colors.standard,
    jobLineCapsule: jobLineColors.capsule,
    jobLineNeutral: jobLineColors.neutral,
    ...componentColors,
  });
  const fieldColors = cssColorRoles({ liveCapsule: liveCapsule.colors.field, jobLineCapsule: jobLineColors.fieldCapsule });

  const text: Declaration[] = Object.entries(typography.styles).flatMap(([key, style]): Declaration[] => {
    const name = `--text-${kebab(key)}`;
    return [
      [name, rem(style.fontSize)],
      [`${name}--line-height`, rem(style.lineHeight)],
      [`${name}--font-weight`, style.fontWeight],
    ];
  });
  const metrics: Declaration[] = Object.entries(componentMetrics).flatMap(([component, values]) =>
    Object.entries(values).map(([name, value]): Declaration => [
      `--beacon-${kebab(component)}-${kebab(name)}`,
      name === "visibleCount" || name === "selectedLabelWeight" ? value : px(value),
    ]),
  );

  return [
    `/* ${generatedFrom}\n   Set data-theme=light|dark|system and data-field-mode=true on the root.\n   Raw colors are --beacon-color-*; Tailwind utilities also follow the active theme.\n   separator and night-line are decorative, not control borders. */`,
    cssBlock(':root, [data-theme="light"], [data-theme="system"]', cssPalette("light")),
    cssBlock('[data-theme="dark"]', cssPalette("dark")),
    cssMedia("prefers-color-scheme: dark", cssBlock(':root:not([data-theme]), [data-theme="system"]', cssPalette("dark"))),
    cssBlock(':where(:root, [data-theme])', [
      ...standardColors,
      ...cssErgonomics("standard"),
      ["--beacon-live-capsule-border-width", cssVar("live-capsule-standard-border-width")],
      ["--beacon-focus-ring-width", px(focus.ringWidth)],
      ["--beacon-focus-ring-gap", px(focus.ringGap)],
      ["--beacon-color-focus-ring", cssVar(`color-${kebab(focus.onNeutral)}`)],
    ]),
    cssBlock(':root', [
      ...metrics,
      ...Object.entries(logicalDirections).map(([key, value]): Declaration => [`--beacon-${kebab(key)}`, value]),
      ["--beacon-icon-size", px(icons.size)],
      ["--beacon-icon-stroke-width", px(icons.strokeWidth)],
      ["--beacon-icon-stroke-cap", icons.strokeCap],
      ["--beacon-icon-stroke-join", icons.strokeJoin],
      ["--beacon-ios-min-target-size", px(hitTargets.iosMinSize)],
      ["--beacon-android-min-target-size", px(hitTargets.androidMinSize)],
      ["--beacon-destructive-action-gap", px(hitTargets.destructiveActionGap)],
      ["--beacon-motion-live-pulse-duration", ms(motion.livePulse.durationMs)],
      ["--beacon-motion-live-pulse-from-opacity", motion.livePulse.fromOpacity],
      ["--beacon-motion-live-pulse-to-opacity", motion.livePulse.toOpacity],
      ["--beacon-motion-stage-cross-fade-duration", ms(motion.stageChange.crossFadeDurationMs)],
      ["--beacon-motion-stage-spring-duration", ms(motion.stageChange.springDurationMs)],
      ["--beacon-motion-stamp-enter-duration", ms(motion.stampEnter.durationMs)],
      ["--beacon-motion-stamp-rise-distance", px(motion.stampEnter.riseDistance)],
      ["--beacon-motion-dock-cross-fade-duration", ms(motion.dockActionChange.crossFadeDurationMs)],
    ]),
    cssBlock('[data-field-mode="true"]', [
      ...fieldColors,
      ...cssErgonomics("field"),
      ["--beacon-live-capsule-border-width", px(liveCapsule.borderWidth.field)],
    ]),
    cssMedia("prefers-reduced-motion: reduce", cssBlock(":root", [
      ["--beacon-motion-live-pulse-duration", "0ms"],
      ["--beacon-motion-stage-spring-duration", "0ms"],
      ["--beacon-motion-stamp-rise-distance", "0px"],
    ])),
    cssBlock("@theme inline", [
      ...Object.keys(colors.light).map((key): Declaration => [`--color-${kebab(key)}`, cssVar(`color-${kebab(key)}`)]),
      ...standardColors.map(([name]): Declaration => [name.replace("--beacon-", "--"), `var(${name})`]),
      ["--color-focus-ring", cssVar("color-focus-ring")],
      ["--font-system", typography.systemFontStack],
      ...text,
      ["--spacing", px(spacing.grid[1])],
      ["--spacing-content-inset", px(spacing.contentInset)],
      ["--spacing-card-padding", px(spacing.cardPadding)],
      ["--spacing-control-gap", cssVar("control-gap")],
      ["--spacing-primary-action-min-height", cssVar("primary-action-min-height")],
      ["--spacing-row-min-height", cssVar("row-min-height")],
      ...Object.entries(radii).map(([key, value]): Declaration => [`--radius-${kebab(key)}`, px(value)]),
      ["--ease-live-pulse", motion.livePulse.easing],
      ["--ease-arrival-rail", motion.arrivalRail.easing],
    ]),
  ].join("\n\n") + "\n";
}

const outputs = [
  ["src/native.ts", renderNative()],
  ["src/beacon.css", renderCss()],
] as const;
const check = process.argv.includes("--check");
const failures = check ? contrastFailures() : [];

await Promise.all(outputs.map(async ([path, content]) => {
  const target = new URL(`../${path}`, import.meta.url);
  if (!check) {
    await Bun.write(target, content);
    return;
  }
  const file = Bun.file(target);
  if (!(await file.exists()) || await file.text() !== content) {
    failures.push(`${path} is missing or stale; run bun packages/design-tokens/scripts/build.ts`);
  }
}));

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
