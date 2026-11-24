// Generated from src/beacon.ts by scripts/build.ts. Do not edit.
import {
  colors, componentMetrics, elevation, ergonomics, focus, hitTargets, icons,
  liveCapsule, logicalDirections, motion, radii, spacing, typography,
} from "./beacon";

const fontVariant: (typeof typography.numericFontVariant)[] = [typography.numericFontVariant];

export const native = {
  colors,
  // The palette stores opaque scrim ink. Use this precomposed color for the overlay.
  scrim: { light: "rgba(21, 23, 28, 0.4)", dark: "rgba(0, 0, 0, 0.4)" },
  typography: {
    display: { fontSize: 40, lineHeight: 44, fontWeight: "800" },
    pageTitle: { fontSize: 28, lineHeight: 34, fontWeight: "800" },
    sectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
    label: { fontSize: 17, lineHeight: 22, fontWeight: "700" },
    body: { fontSize: 16, lineHeight: 24, fontWeight: "400" },
    supporting: { fontSize: 14, lineHeight: 20, fontWeight: "500" },
    caption: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
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
    light: {
      standard: {
        surface: {
          backgroundColor: colors.light.night,
          borderColor: colors.light.outline,
          borderWidth: liveCapsule.borderWidth.standard.light,
        },
        text: { color: colors.light.onNight },
        supportingText: { color: colors.light.nightMuted },
        accent: colors.light.live,
        focusRing: colors.light.live,
      },
      field: {
        surface: {
          backgroundColor: colors.light.live,
          borderColor: colors.light.onLive,
          borderWidth: liveCapsule.borderWidth.field,
        },
        text: { color: colors.light.onLive },
        supportingText: { color: colors.light.onLive },
        accent: colors.light.onLive,
        focusRing: colors.light.onLive,
      },
    },
    dark: {
      standard: {
        surface: {
          backgroundColor: colors.dark.night,
          borderColor: colors.dark.outline,
          borderWidth: liveCapsule.borderWidth.standard.dark,
        },
        text: { color: colors.dark.onNight },
        supportingText: { color: colors.dark.nightMuted },
        accent: colors.dark.live,
        focusRing: colors.dark.live,
      },
      field: {
        surface: {
          backgroundColor: colors.dark.live,
          borderColor: colors.dark.onLive,
          borderWidth: liveCapsule.borderWidth.field,
        },
        text: { color: colors.dark.onLive },
        supportingText: { color: colors.dark.onLive },
        accent: colors.dark.onLive,
        focusRing: colors.dark.onLive,
      },
    },
  },
  jobLineColors: {
    light: {
      neutral: {
        rail: colors.light.subtle,
        progress: colors.light.ink,
        done: colors.light.ink,
        doneGlyph: colors.light.onBrand,
        current: colors.light.live,
        currentRing: colors.light.onLive,
        nextRing: colors.light.outline,
        label: colors.light.muted,
      },
      capsule: {
        rail: colors.light.nightLine,
        progress: colors.light.live,
        done: colors.light.live,
        doneGlyph: colors.light.onLive,
        current: colors.light.live,
        currentRing: colors.light.live,
        nextRing: colors.light.nightMuted,
        label: colors.light.onNight,
      },
      fieldCapsule: {
        rail: colors.light.livePressed,
        progress: colors.light.onLive,
        done: colors.light.onLive,
        doneGlyph: colors.light.live,
        current: colors.light.onLive,
        currentRing: colors.light.onLive,
        nextRing: colors.light.onLive,
        label: colors.light.onLive,
      },
    },
    dark: {
      neutral: {
        rail: colors.dark.subtle,
        progress: colors.dark.ink,
        done: colors.dark.ink,
        doneGlyph: colors.dark.onBrand,
        current: colors.dark.live,
        currentRing: colors.dark.onLive,
        nextRing: colors.dark.outline,
        label: colors.dark.muted,
      },
      capsule: {
        rail: colors.dark.nightLine,
        progress: colors.dark.live,
        done: colors.dark.live,
        doneGlyph: colors.dark.onLive,
        current: colors.dark.live,
        currentRing: colors.dark.live,
        nextRing: colors.dark.nightMuted,
        label: colors.dark.onNight,
      },
      fieldCapsule: {
        rail: colors.dark.livePressed,
        progress: colors.dark.onLive,
        done: colors.dark.onLive,
        doneGlyph: colors.dark.live,
        current: colors.dark.onLive,
        currentRing: colors.dark.onLive,
        nextRing: colors.dark.onLive,
        label: colors.dark.onLive,
      },
    },
  },
  componentColors: {
    light: {
      crewStatusRing: {
        confirmed: colors.light.outline,
        onTheWay: colors.light.live,
        onSite: colors.light.live,
        hold: colors.light.attentionInk,
        gap: colors.light.criticalInk,
      },
      dock: {
        fill: colors.light.surface,
        border: colors.light.separator,
        primaryFill: colors.light.brand,
        primaryText: colors.light.onBrand,
        liveFill: colors.light.live,
        liveText: colors.light.onLive,
        liveBorder: colors.light.onLive,
      },
      offerClock: {
        fieldTrack: colors.light.livePressed,
        fieldProgress: colors.light.onLive,
      },
    },
    dark: {
      crewStatusRing: {
        confirmed: colors.dark.outline,
        onTheWay: colors.dark.live,
        onSite: colors.dark.live,
        hold: colors.dark.attentionInk,
        gap: colors.dark.criticalInk,
      },
      dock: {
        fill: colors.dark.surface,
        border: colors.dark.separator,
        primaryFill: colors.dark.brand,
        primaryText: colors.dark.onBrand,
        liveFill: colors.dark.live,
        liveText: colors.dark.onLive,
        liveBorder: colors.dark.onLive,
      },
      offerClock: {
        fieldTrack: colors.dark.livePressed,
        fieldProgress: colors.dark.onLive,
      },
    },
  },
} as const;
