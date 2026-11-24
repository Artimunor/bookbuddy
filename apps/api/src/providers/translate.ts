import { looksLikeAccessCode } from "@bookbuddy/domain";

export interface TranslationBindings {
  /** JSON array of [source locale, target locale]; absent means originals only. */
  CHAT_TRANSLATION_PAIRS?: string;
  // Production uses the EU Advanced endpoint with a provisioned bearer token.
  // v2 is an explicit Basic API-key mode for isolated demonstrations.
  GOOGLE_TRANSLATION_MODE?: "v3" | "v2";
  GOOGLE_TRANSLATION_PROJECT?: string;
  GOOGLE_TRANSLATION_CREDENTIAL?: string;
}

export type LanguagePair = readonly [source: string, target: string];
export type TranslationFetch = typeof fetch;
export const translationProvider = "google";
export const translationModel = "nmt";
export const language = (locale: string) => locale.split("-", 1)[0]!.toLowerCase();
export const languageSql = (value: string) => `lower(substr(${value}, 1, instr(${value} || '-', '-') - 1))`;

export function enabledTranslationPairs(config: TranslationBindings): LanguagePair[] {
  if (!config.CHAT_TRANSLATION_PAIRS) return [];
  try {
    const input: unknown = JSON.parse(config.CHAT_TRANSLATION_PAIRS);
    if (!Array.isArray(input) || input.length > 32) return [];
    const pairs = new Map<string, LanguagePair>();
    for (const pair of input) {
      if (!Array.isArray(pair) || pair.length !== 2 || pair.some((tag) => typeof tag !== "string" || tag.length > 255)) return [];
      const source = Intl.getCanonicalLocales(pair[0])[0], target = Intl.getCanonicalLocales(pair[1])[0];
      if (!source || !target) return [];
      if (language(source) !== language(target)) pairs.set(`${source}:${target}`, [source, target]);
    }
    return [...pairs.values()];
  } catch {
    return [];
  }
}

// Pair opt-in also requires processor/content-policy approval. This filter
// screens known hazards, not arbitrary prose: it cannot prove text is safe.
const restricted = /(?:https?:|www\.|[@\p{N}\p{Cf}]|\b(?:iban|swift|bank|billing|payment|pay|transfer|card|passport|email|phone|address|telefone|morada|correo|direcci[oó]n|tel[eé]fono|pago|pagar|pagamento|seguridad|seguran[cç]a|safety|emergency|emergencia|ppe|hazard|danger|riesgo|perigo|risco|electric|eletric|gas|asbestos|amianto|password|access|gate|keypad|pin|alarm)\b)/iu;
export const unsupportedMessageControls = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u;
export function translationText(original: string, names: readonly string[] = []): string | null {
  let text = original.normalize("NFKC");
  if (looksLikeAccessCode(text) || restricted.test(text) || unsupportedMessageControls.test(text)) return null;
  if (names.length) {
    const words = new Set(names.flatMap((name) => name.normalize("NFKC").toLocaleLowerCase("und").match(/[\p{L}\p{M}]+/gu) ?? []));
    text = text.replace(/[\p{L}\p{M}]+/gu, (word) => words.has(word.toLocaleLowerCase("und")) ? "…" : word);
  }
  return /\p{L}/u.test(text) ? text.trim() : null;
}

// Safely under Basic's 100 KB/128-element request limits and Advanced's
// 30,000 Unicode code point hard limit. The JSON bound accounts for escaping.
export const translationMaxCharacters = 30_000;
export const translationMaxBytes = 90_000;
export const translationMaxTexts = 128;
const encoder = new TextEncoder();
export const translationTextBytes = (text: string) => encoder.encode(JSON.stringify(text)).byteLength + 1;

export type TranslationOutcome = { state: "ready"; texts: string[] } | { state: "uncharged" | "unknown" };
export interface TranslationProvider {
  translate(pair: LanguagePair, texts: readonly string[], credential: string): Promise<TranslationOutcome>;
}

export function createGoogleTranslation(config: TranslationBindings, fetcher: TranslationFetch = fetch): TranslationProvider | null {
  const basic = config.GOOGLE_TRANSLATION_MODE === "v2";
  const project = config.GOOGLE_TRANSLATION_PROJECT;
  if (!basic && (!project || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(project))) return null;
  const endpoint = basic ? "https://translation.googleapis.com/language/translate/v2"
    : `https://translate-eu.googleapis.com/v3/projects/${project}/locations/eu:translateText`;
  const signal = AbortSignal.timeout(20_000);
  return { async translate([source, target], texts, credential) {
    if (signal.aborted) return { state: "uncharged" };
    const body = basic ? { q: texts, source, target, format: "text", model: "nmt" }
      : { contents: texts, sourceLanguageCode: source, targetLanguageCode: target, mimeType: "text/plain" };
    try {
      const response = await fetcher(endpoint, {
        method: "POST", redirect: "error", signal,
        headers: { "Content-Type": "application/json", ...(basic ? { "X-Goog-Api-Key": credential } : { Authorization: `Bearer ${credential}` }) },
        body: JSON.stringify(body),
      });
      // Only authentication/authorization rejection is known not to have
      // translated any characters. Treat server/transport/shape errors as unknown.
      if (!response.ok) {
        await response.body?.cancel();
        return { state: response.status === 401 || response.status === 403 ? "uncharged" : "unknown" };
      }
      const payload = await response.json() as { translations?: unknown; data?: { translations?: unknown } };
      const results = basic ? payload?.data?.translations : payload?.translations;
      if (!Array.isArray(results) || results.length !== texts.length) return { state: "unknown" };
      const translated = results.map((result: { translatedText?: unknown } | null) => result?.translatedText);
      if (!translated.every((text): text is string => typeof text === "string" && Boolean(text.trim()))) return { state: "unknown" };
      const plain = basic ? translated.map(plainBasicText) : translated;
      if (plain.some((text) => !text.trim() || unsupportedMessageControls.test(text) || translationTextBytes(text) > 48_000)) {
        return { state: "unknown" };
      }
      return { state: "ready", texts: plain };
    } catch {
      return { state: "unknown" };
    }
  } };
}

// Basic may HTML-escape output even for a plain text input. Decode one layer.
function plainBasicText(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d{1,7}|#x[\da-f]{1,6});/gi, (entity, content: string) => {
    const path = content.toLowerCase();
    if (path[0] !== "#") return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[path] ?? entity;
    const code = path[1] === "x" ? Number.parseInt(path.slice(2), 16) : Number(path.slice(1));
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : entity;
  });
}
