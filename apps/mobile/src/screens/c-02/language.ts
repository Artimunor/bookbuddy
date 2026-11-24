export function originalLanguageName(language: string, uiLocale: string): string | undefined {
  if (!language.trim() || typeof Intl.DisplayNames !== "function") return;
  try {
    return new Intl.DisplayNames(uiLocale, { type: "language", fallback: "none" }).of(language.trim());
  } catch {
    return undefined;
  }
}
