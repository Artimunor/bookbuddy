export const publicPaths = [
  "/",
  "/services",
  "/services/repairs",
  "/book",
  "/help",
  "/privacy",
  "/terms",
] as const;

type PublicPath = (typeof publicPaths)[number];

export function localizedPath(locale: string, path: PublicPath): string {
  return `/${locale}${path}`;
}

export function matchPublicEntry(pathname: string): PublicPath | undefined {
  const path = pathname === "/" ? pathname : pathname.replace(/\/$/, "");
  return publicPaths.find((entry) => entry === path);
}
