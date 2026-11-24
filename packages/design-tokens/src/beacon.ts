type HexColor = `#${string}`;

// Beacon palette and pairing rules: design-fable/system/design-system.md.
// Separator and nightLine are decorative. Use outline for control boundaries.
// Lime belongs to live state/actions. Never use it as text on a light neutral;
// on a neutral surface give lime fills a 2-unit dark ink border.
const light = {
  canvas: "#F6F3EC",
  surface: "#FFFFFF",
  raised: "#FFFFFF",
  subtle: "#ECE8DE",
  ink: "#15171C",
  muted: "#555A66",
  separator: "#DED8CB",
  outline: "#747986",
  brand: "#15171C",
  onBrand: "#FFFFFF",
  brandPressed: "#343842",
  brandSoft: "#E4E9FF",
  brandInk: "#2438B5",
  live: "#D6F33C",
  onLive: "#15171C",
  livePressed: "#BFDC22",
  night: "#15171C",
  onNight: "#F6F3EC",
  nightMuted: "#B1B5C0",
  nightLine: "#3B404B",
  infoSoft: "#E3EEFB",
  infoInk: "#1E4A7D",
  successSoft: "#E1F3E4",
  successInk: "#1E5A32",
  attentionSoft: "#FFEFCF",
  attentionInk: "#6E4300",
  criticalSoft: "#FCE6E3",
  criticalInk: "#8A2F28",
  personA: "#FFE3D3",
  personB: "#DDEBFF",
  personC: "#E7E1FF",
  personD: "#DDF3E4",
  scrim: "#15171C",
} as const satisfies Record<string, HexColor>;

const dark = {
  canvas: "#0F1115",
  surface: "#1A1D23",
  raised: "#23272F",
  subtle: "#2A2E37",
  ink: "#F4F1EA",
  muted: "#B5B9C4",
  separator: "#353A45",
  outline: "#8A90A0",
  brand: "#F4F1EA",
  onBrand: "#15171C",
  brandPressed: "#D4D1C8",
  brandSoft: "#262E52",
  brandInk: "#B7C3FF",
  live: light.live,
  onLive: light.onLive,
  livePressed: light.livePressed,
  night: "#000000",
  onNight: "#F4F1EA",
  nightMuted: "#B5B9C4",
  nightLine: "#353A45",
  infoSoft: "#1B3147",
  infoInk: "#B5D8FF",
  successSoft: "#1D3626",
  successInk: "#A9E0B3",
  attentionSoft: "#40300F",
  attentionInk: "#FFD98A",
  criticalSoft: "#44231F",
  criticalInk: "#FFC1BA",
  personA: "#5A3828",
  personB: "#27405F",
  personC: "#3B3463",
  personD: "#234A33",
  scrim: "#000000",
} as const satisfies Record<keyof typeof light, HexColor>;

export const colors = { light, dark } as const;
export type ColorScheme = keyof typeof colors;
export type ColorToken = keyof typeof light;

export const scrimOpacity = 0.4;

export const typography = {
  systemFontStack: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  numericFontVariant: "tabular-nums",
  styles: {
    display: { fontSize: 40, lineHeight: 44, fontWeight: 800 },
    pageTitle: { fontSize: 28, lineHeight: 34, fontWeight: 800 },
    sectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: 700 },
    label: { fontSize: 17, lineHeight: 22, fontWeight: 700 },
    body: { fontSize: 16, lineHeight: 24, fontWeight: 400 },
    supporting: { fontSize: 14, lineHeight: 20, fontWeight: 500 },
    caption: { fontSize: 12, lineHeight: 16, fontWeight: 600 },
  },
} as const;

const grid = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;
export const spacing = {
  grid,
  contentInset: grid[5],
  cardPadding: grid[5],
  controlGap: grid[3],
} as const;

export const radii = {
  smallTile: 12,
  input: 16,
  card: 24,
  capsule: 32,
  sheetTop: 32,
  pill: 9999,
} as const;

export const icons = { size: 24, strokeWidth: 2, strokeCap: "round", strokeJoin: "round" } as const;

export const focus = { ringWidth: 2, ringGap: 2, onNeutral: "brandInk" } as const;
export const hitTargets = { iosMinSize: 44, androidMinSize: 48, destructiveActionGap: 16 } as const;

// Flat levels use tone and edges, never a shadow.
export const elevation = {
  canvas: { background: "canvas" },
  card: { background: "surface", border: "separator" },
  sheet: { background: "raised", scrim: "scrim" },
} as const;

const crossFadeDurationMs = 200;
export const motion = {
  livePulse: { durationMs: 2000, easing: "ease-in-out", fromOpacity: 1, toOpacity: 0 },
  arrivalRail: { easing: "linear" },
  stageChange: { crossFadeDurationMs, springDurationMs: 350 },
  stampEnter: { durationMs: crossFadeDurationMs, riseDistance: grid[2] },
  dockActionChange: { crossFadeDurationMs },
  reduced: { currentBead: "static-double-ring", pulse: false, spring: false, stampRise: false },
} as const;

const primaryActionMinHeight = 56;
export const ergonomics = {
  standard: { primaryActionMinHeight, rowMinHeight: 56, controlGap: spacing.controlGap, controlBorderWidth: 1 },
  field: { primaryActionMinHeight: 64, rowMinHeight: 64, controlGap: grid[4], controlBorderWidth: 2 },
} as const;
export type ErgonomicsMode = keyof typeof ergonomics;

// The capsule dimensions are design references, not fixed layout constraints.
export const componentMetrics = {
  liveCapsule: {
    radius: radii.capsule,
    padding: spacing.cardPadding,
    referenceWidth: 350,
    heroMinHeight: 260,
    heroMaxHeight: 300,
    cardMinHeight: 150,
    cardMaxHeight: 190,
    pillMinHeight: 56,
    pillRadius: 28,
  },
  jobLine: { railThickness: 6, railRadius: 3, beadSize: 20, currentRingSize: 30, limeBorderWidth: 2 },
  crewDots: { avatarSize: 40, statusRingWidth: 3, stateGlyphSize: 16, overlap: grid[2], visibleCount: 3 },
  stamp: { glyphTileSize: 32, photoThumbnailSize: 64 },
  dock: { inset: spacing.contentInset, primaryRadius: radii.pill, secondaryIconSize: 56, liveBorderWidth: 2 },
  twinBubble: { radius: radii.card },
  offerClock: { size: 64, ringWidth: 6 },
  askBar: { minHeight: 64, radius: radii.pill },
  chip: { height: 40, hitRegion: 48, radius: radii.pill },
  tabBar: { selectedDotSize: 4, selectedLabelWeight: 700 },
  lockScreenCard: { referenceWidth: 370, referenceHeight: 160, radius: 28, padding: grid[4] },
} as const;

export const logicalDirections = {
  liveCapsuleReferenceAlignment: "end",
  liveCapsuleTimeAlignment: "end",
  jobLineProgressOrigin: "start",
  jobLineLastLabelAlignment: "end",
  crewDotGlyphInlineEdge: "end",
  crewDotGlyphBlockEdge: "end",
  askBarActionsInlineEdge: "end",
  identityChipInlineEdge: "start",
} as const;

const capsuleFieldInk = "onLive"; // Dark ink in both themes, unlike the main `ink` token.
const capsulePolarity = {
  standard: {
    fill: "night", text: "onNight", supportingText: "nightMuted", accent: "live", border: "outline", focusRing: "live",
  },
  field: {
    fill: "live", text: capsuleFieldInk, supportingText: capsuleFieldInk,
    accent: capsuleFieldInk, border: capsuleFieldInk, focusRing: capsuleFieldInk,
  },
} as const satisfies Record<ErgonomicsMode, Record<string, ColorToken>>;

export const liveCapsule = {
  colors: capsulePolarity,
  borderWidth: { standard: { light: 0, dark: 1 }, field: 2 },
} as const;

export const jobLineColors = {
  neutral: {
    rail: "subtle", progress: "ink", done: "ink", doneGlyph: "onBrand", current: "live", currentRing: "onLive",
    nextRing: "outline", label: "muted",
  },
  capsule: {
    rail: "nightLine", progress: "live", done: "live", doneGlyph: "onLive", current: "live", currentRing: "live",
    nextRing: "nightMuted", label: "onNight",
  },
  fieldCapsule: {
    rail: "livePressed", progress: capsuleFieldInk, done: capsuleFieldInk, doneGlyph: "live", current: capsuleFieldInk,
    currentRing: capsuleFieldInk, nextRing: capsuleFieldInk, label: capsuleFieldInk,
  },
} as const satisfies Record<string, Record<string, ColorToken>>;

export const componentColors = {
  crewStatusRing: { confirmed: "outline", onTheWay: "live", onSite: "live", hold: "attentionInk", gap: "criticalInk" },
  dock: {
    fill: "surface", border: "separator", primaryFill: "brand", primaryText: "onBrand", liveFill: "live",
    liveText: "onLive", liveBorder: "onLive",
  },
  offerClock: { fieldTrack: "livePressed", fieldProgress: capsuleFieldInk },
} as const satisfies Record<string, Record<string, ColorToken>>;
