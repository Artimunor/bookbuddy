import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import config from "../locales.json";

export const surfaces = ["shared", "mobile", "web", "push"] as const;
export type Surface = (typeof surfaces)[number];
export const english = "en";
export const locales = Object.keys(config.enabledLocales).sort();
export type TextCatalog = Record<string, string>;
export type SourceCatalogs = Record<string, Record<Surface, TextCatalog>>;
type CatalogSources = { catalogs: SourceCatalogs; context: TextCatalog };
type Contribution = { surface: Surface; key: string; messages: TextCatalog; context: string; replace: boolean };

function fail(at: string, message: string): never {
  throw new Error(`${at}: ${message}`);
}

function object(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(at, "expected an object");
  return value as Record<string, unknown>;
}

function text(value: unknown, at: string): string {
  if (typeof value !== "string" || !value.trim()) fail(at, "expected a non-empty string");
  return value;
}

async function readJson(path: string): Promise<unknown> {
  const input = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    fail(path, String(error));
  }
  // JSON.parse discards duplicate properties before a reviver could see them.
  const source = ts.parseJsonText(path, input);
  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node)) {
      const seen = new Set<string>();
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.name)) {
          if (seen.has(prop.name.text)) fail(path, `duplicate property ${JSON.stringify(prop.name.text)}`);
          seen.add(prop.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return parsed;
}

function verifyKey(key: string, surface: Surface, at: string): void {
  if (!key.startsWith(`${surface}.`) || !/^[a-z][a-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/.test(key)) {
    fail(at, `expected a namespaced ${surface} key, got ${JSON.stringify(key)}`);
  }
}

function verifyKeys(expected: readonly string[], actual: readonly string[], at: string): void {
  const missing = expected.filter((key) => !actual.includes(key));
  const extra = actual.filter((key) => !expected.includes(key));
  if (missing.length || extra.length) {
    fail(at, [missing.length ? `missing: ${missing.join(", ")}` : "", extra.length ? `extra: ${extra.join(", ")}` : ""].filter(Boolean).join("; "));
  }
}

async function readTextCatalog(path: string, surface?: Surface): Promise<TextCatalog> {
  return Object.fromEntries(Object.entries(object(await readJson(path), path)).map(([key, value]) => {
    if (surface) verifyKey(key, surface, path);
    return [key, text(value, `${path} → ${key}`)];
  }));
}

export function englishKeys(catalogs: SourceCatalogs): string[] {
  return surfaces.flatMap((surface) => Object.keys(catalogs[english]![surface]));
}

export async function readCanonical(root: string): Promise<CatalogSources> {
  if (!locales.includes(english)) fail("locales.json", "source locale en must be enabled");
  const catalogDir = join(root, "catalogs");
  const catalogs = Object.fromEntries(await Promise.all(locales.map(async (locale) => [
    locale,
    Object.fromEntries(await Promise.all(surfaces.map(async (surface) => [
      surface, await readTextCatalog(join(catalogDir, locale, `${surface}.json`), surface),
    ]))) as Record<Surface, TextCatalog>,
  ])));
  const context = await readTextCatalog(join(catalogDir, "context.json"));
  for (const surface of surfaces) {
    const source = Object.keys(catalogs[english]![surface]);
    for (const locale of locales) {
      if (locale !== english) verifyKeys(source, Object.keys(catalogs[locale]![surface]), `${locale}/${surface}.json`);
    }
  }
  verifyKeys(englishKeys(catalogs), Object.keys(context), "catalogs/context.json");
  return { catalogs, context };
}

export async function readContributions(root: string): Promise<{ files: string[]; entries: Contribution[] }> {
  const dir = join(root, "contributions");
  const names = await readdir(dir).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const files = names.filter((name) => name.endsWith(".json")).sort().map((name) => join(dir, name));
  const batches = await Promise.all(files.map(async (file) => {
    const data = await readJson(file);
    if (!Array.isArray(data) || !data.length) fail(file, "expected a non-empty array of contributions");
    return data.map((value: unknown, index): Contribution => {
      const at = `${file}[${index}]`;
      const entry = object(value, at);
      const replace = Object.hasOwn(entry, "replace");
      verifyKeys(["surface", "key", "messages", "context", ...(replace ? ["replace"] : [])], Object.keys(entry), at);
      if (replace && entry.replace !== true) fail(at, "replace must be true when provided");
      const surface = entry.surface as Surface;
      if (!surfaces.includes(surface)) fail(at, `unknown surface ${JSON.stringify(surface)}`);
      const key = text(entry.key, at);
      verifyKey(key, surface, at);
      const messages = object(entry.messages, `${at}.messages`);
      verifyKeys(locales, Object.keys(messages), `${at}.messages`);
      return {
        surface, key, replace,
        messages: Object.fromEntries(locales.map((locale) => [locale, text(messages[locale], `${at}.messages.${locale}`)])),
        context: text(entry.context, `${at}.context`),
      };
    });
  }));
  return { files, entries: batches.flat() };
}

export function applyContributions({ catalogs, context }: CatalogSources, entries: readonly Contribution[]): void {
  const seen = new Set<string>();
  for (const { surface, key, messages, context: note, replace } of entries) {
    if (seen.has(key)) fail("contributions", `key already exists: ${key}`);
    const exists = Object.hasOwn(context, key);
    if (exists && !replace) fail("contributions", `key already exists: ${key}`);
    if (!exists && replace) fail("contributions", `cannot replace missing key: ${key}`);
    seen.add(key);
    for (const locale of locales) catalogs[locale]![surface][key] = messages[locale]!;
    context[key] = note;
  }
}

function sortedJson(input: TextCatalog): string {
  return `${JSON.stringify(Object.fromEntries(Object.keys(input).sort().map((key) => [key, input[key]])), null, 2)}\n`;
}

export async function writeIfChanged(path: string, value: string): Promise<void> {
  const existing = Bun.file(path);
  if (!(await existing.exists()) || await existing.text() !== value) await writeFile(path, value);
}

export async function writeCanonical(root: string, { catalogs, context }: CatalogSources, entries: readonly Contribution[]): Promise<void> {
  const dir = join(root, "catalogs");
  const affected = new Set(entries.map((entry) => entry.surface));
  await Promise.all([
    writeIfChanged(join(dir, "context.json"), sortedJson(context)),
    ...locales.flatMap((locale) => [...affected].map((surface) =>
      writeIfChanged(join(dir, locale, `${surface}.json`), sortedJson(catalogs[locale]![surface])),
    )),
  ]);
}

export async function removeContributions(files: readonly string[]): Promise<void> {
  await Promise.all(files.map((file) => unlink(file)));
}
