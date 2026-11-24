const paths = {
  back: "M19 12H5m7 7-7-7 7-7",
  next: "M5 12h14m-7-7 7 7-7 7",
  chevron: "m9 18 6-6-6-6",
  check: "m5 12 4 4L19 6",
  pin: "M20 10c0 5-8 11-8 11s-8-6-8-11a8 8 0 1 1 16 0ZM14 10a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z",
  van: "M2 6h13v10H2Zm13 4h4l3 3v3h-7M7 18a2 2 0 1 0-4 0 2 2 0 0 0 4 0Zm13 0a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2",
  pause: "M9 5v14m6-14v14",
  alert: "M12 3 2 20h20Zm0 6v4m0 3v.1",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v5m0-8v.1",
  photo: "M3 4h18v16H3Zm2 13 5-5 3 3 2-2 4 4m-3-8v.1",
  decision: "M6 3h9l3 3v15H6Zm4 10 2 2 4-4",
  crew: "M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m18 0v-2a4 4 0 0 0-3-4m-5-6a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Zm4-3a3.5 3.5 0 0 1 0 6",
  replace: "M4 8h15m-4-4 4 4-4 4m5 4H5m4-4-4 4 4 4",
  cancel: "m6 6 12 12M18 6 6 18",
  home: "m3 10 9-7 9 7v11H3Zm6 11v-7h6v7",
  calendar: "M3 6h18v15H3Zm0 5h18M7 3v6m10-6v6",
  message: "M3 4h18v13H8l-5 4Z",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2m6.4-15.4L17 7m-10 10-1.4 1.4M21 12h-2M5 12H3m15.4 6.4L17 17M7 7 5.6 5.6",
} as const;

export type GlyphName = keyof typeof paths;

export function Glyph({ name, className = "" }: { name: GlyphName; className?: string }) {
  const directional = name === "back" || name === "next" || name === "chevron";
  return (
    <svg className={`bb-glyph ${directional ? "bb-glyph--directional" : ""} ${className}`} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}
