import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import config from "../locales.json";
import { english, locales, surfaces, type SourceCatalogs, type Surface, type TextCatalog } from "./catalogs";

export type PseudoLocale = keyof typeof config.pseudoLocales;
type Ast = MessageFormatElement[];
type CompiledCatalog = Record<string, Ast>;
type Compiled = Record<Surface, Record<string, CompiledCatalog>>;
type Placeholder = { formats: Set<string>; types: string[] };
const primitive = ["string", "number", "boolean"];
const tagType = "(chunks: string[]) => string";
const pluralCategories: Record<string, true> = { zero: true, one: true, two: true, few: true, many: true, other: true };

function contract(ast: Ast): Map<string, Placeholder> {
  const result = new Map<string, Placeholder>();

  function argument(name: string, format: string | undefined, types: string[]): void {
    const previous = result.get(name);
    if (!previous) {
      result.set(name, { formats: new Set(format ? [format] : []), types });
      return;
    }
    if (format) previous.formats.add(format);
    previous.types = previous.types.filter((type) => types.includes(type));
    if (!previous.types.length) throw new Error(`incompatible uses of {${name}}`);
  }

  function visit(elements: Ast): void {
    for (const element of elements) {
      switch (element.type) {
        case TYPE.literal:
        case TYPE.pound:
          break;
        case TYPE.argument:
          argument(element.value, undefined, primitive);
          break;
        case TYPE.number:
          argument(element.value, "number", ["number"]);
          break;
        case TYPE.date:
        case TYPE.time:
          argument(element.value, TYPE[element.type], ["number", "Date"]);
          break;
        case TYPE.tag:
          argument(element.value, "tag", [tagType]);
          visit(element.children);
          break;
        case TYPE.select:
        case TYPE.plural: {
          const selectors = Object.keys(element.options).sort();
          if (element.type === TYPE.select) {
            argument(element.value, `select ${JSON.stringify(selectors)}`, ["string"]);
          } else {
            const exact = selectors.filter((selector) => selector.startsWith("="));
            const invalid = selectors.find((selector) => !selector.startsWith("=") && !Object.hasOwn(pluralCategories, selector));
            if (invalid) throw new Error(`invalid plural selector ${JSON.stringify(invalid)}`);
            // CLDR categories can differ across locales; explicit numeric branches and offsets cannot.
            argument(element.value, `${element.pluralType} offset:${element.offset} ${JSON.stringify(exact)}`, ["number"]);
          }
          for (const option of Object.values(element.options)) visit(option.value);
          break;
        }
      }
    }
  }

  visit(ast);
  return result;
}

function equalContracts(expected: Map<string, Placeholder>, actual: Map<string, Placeholder>): boolean {
  if (expected.size !== actual.size) return false;
  for (const [name, { formats, types }] of expected) {
    const value = actual.get(name);
    if (!value || formats.size !== value.formats.size || types.length !== value.types.length
      || [...formats].some((format) => !value.formats.has(format)) || types.some((type) => !value.types.includes(type))) return false;
  }
  return true;
}

export function compileTranslations(key: string, input: TextCatalog): { messages: Record<string, Ast>; args: Map<string, Placeholder> } {
  function compile(locale: string) {
    try {
      const ast = parse(input[locale]!);
      return { ast, args: contract(ast) };
    } catch (error) {
      throw new Error(`${locale} → ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const source = compile(english);
  const messages: Record<string, Ast> = { [english]: source.ast };
  for (const locale of locales) {
    if (locale === english) continue;
    const target = compile(locale);
    if (!equalContracts(source.args, target.args)) {
      throw new Error(`${locale} → ${key}: incompatible placeholders vs ${english}`);
    }
    messages[locale] = target.ast;
  }
  return { messages, args: source.args };
}

const lower = "áƀçďëƒğħïĵķľṁñôþɋřšţüṽŵẋÿž";
const upper = lower.toUpperCase();

function pseudoLiteral(value: string, locale: PseudoLocale): string {
  if (!value.trim()) return value;
  switch (locale) {
    case "en-XA": {
      const accented = value.replace(/[A-Za-z]/g, (char) => {
        const code = char.charCodeAt(0);
        return code >= 97 ? lower[code - 97]! : upper[code - 65]!;
      });
      const length = [...value.trim()].length;
      return accented.replace(/\s*$/, (whitespace) => `${"~".repeat(Math.round(length * 0.4))}${whitespace}`);
    }
    case "ar-XB":
      // Close the RTL override before any interpolated element, leaving its own bidi behavior intact.
      return value.replace(/^(\s*)(.*?)(\s*)$/s, "$1\u202e$2\u202c$3");
  }
}

export function pseudolocalize(ast: Ast, locale: PseudoLocale): Ast {
  return ast.map((element) => {
    switch (element.type) {
      case TYPE.literal:
        return { ...element, value: pseudoLiteral(element.value, locale) };
      case TYPE.select:
      case TYPE.plural:
        return { ...element, options: Object.fromEntries(Object.entries(element.options).map(([selector, { value }]) => [
          selector, { value: pseudolocalize(value, locale) },
        ])) };
      case TYPE.tag:
        return { ...element, children: pseudolocalize(element.children, locale) };
      default:
        return element;
    }
  });
}

const generated = "// Generated by packages/i18n/scripts/build.ts. Do not edit.\n";
const pseudoLocales = Object.keys(config.pseudoLocales).sort() as PseudoLocale[];

function renderCatalogs(byLocale: Record<string, CompiledCatalog>): string {
  const lines = [generated.trimEnd(), 'import type { Catalogs } from "../translator";', "", "export default {"];
  for (const [locale, messages] of Object.entries(byLocale)) {
    lines.push(`  ${JSON.stringify(locale)}: {`);
    for (const [key, ast] of Object.entries(messages)) {
      const serialized = JSON.stringify(ast).replace(/[\u202c\u202e]/g, (char) => `\\u${char.charCodeAt(0).toString(16)}`);
      lines.push(`    ${JSON.stringify(key)}: ${serialized},`);
    }
    lines.push("  },");
  }
  return `${lines.join("\n")}\n} satisfies Catalogs;\n`;
}

export function generateArtifacts(source: SourceCatalogs): ReadonlyMap<string, string> {
  const compiled = Object.fromEntries(surfaces.map((surface) => [
    surface, Object.fromEntries(locales.map((locale) => [locale, {}])),
  ])) as Compiled;
  const namespaces: string[] = [];
  const contracts: string[] = [];
  for (const surface of surfaces) {
    const keys = Object.keys(source[english]![surface]).sort();
    namespaces.push(`  ${surface}: ${keys.map((key) => JSON.stringify(key)).join(" | ") || "never"};`);
    for (const key of keys) {
      const { messages, args } = compileTranslations(key, Object.fromEntries(locales.map((locale) => [
        locale, source[locale]![surface][key]!,
      ])));
      for (const [locale, ast] of Object.entries(messages)) compiled[surface][locale]![key] = ast;
      const fields = [...args.keys()].sort().map((arg) =>
        `readonly ${JSON.stringify(arg)}: ${args.get(arg)!.types.join(" | ")};`,
      );
      contracts.push(`  ${JSON.stringify(key)}: ${fields.length ? `{ ${fields.join(" ")} }` : "undefined"};`);
    }
  }

  const files = new Map<string, string>();
  for (const surface of surfaces) {
    files.set(`${surface}.ts`, renderCatalogs(compiled[surface]));
    const sourceAst = Object.entries(compiled[surface][english]!);
    files.set(`${surface}.pseudo.ts`, renderCatalogs(Object.fromEntries(pseudoLocales.map((locale) => [
      locale, Object.fromEntries(sourceAst.map(([key, ast]) => [key, pseudolocalize(ast, locale)])),
    ]))));
  }
  files.set("types.ts", `${generated}
interface KeysByNamespace {
${namespaces.join("\n")}
}

interface ValuesByKey {
${contracts.join("\n")}
}

export type Surface = keyof KeysByNamespace;
export type MessageKey<S extends Surface> = KeysByNamespace["shared" | S];
export type MessageValues<K extends MessageKey<Surface>> = ValuesByKey[K];
`);
  return files;
}
