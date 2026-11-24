import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { runBuild } from "../scripts/build";
import { pseudolocalize } from "../scripts/compiler";
import { extractKeys } from "../scripts/extract";
import { createTranslator, directionOf, resolveLocale } from "../src";
import { createTranslator as createDevTranslator } from "../src/dev";
import { createMobileTranslator } from "../src/mobile";
import { bindTranslator, createNamespace } from "../src/translator";

test("resolveLocale uses ordered exact, parent and configured language defaults", () => {
  expect(resolveLocale(["pt-PT"])).toBe("pt-PT");
  expect(resolveLocale(["invalid_tag", "es", " pT-Br ", "en"])).toBe("pt-PT");
  expect(resolveLocale(["pt"])).toBe("pt-PT");
  expect(resolveLocale(["en-GB", "pt-PT"])).toBe("en");
  expect(resolveLocale(["es", "ar-XB"])).toBe("en");
});

test("surface selection is cached and pt-PT formats zero as other", () => {
  const { t } = createTranslator("mobile", "pt-BR");
  expect(t("shared.action.save")).toBe("Guardar");
  expect(t("shared.status.pendingChanges", { count: 1 })).toBe("1 alteração pendente");
  expect(t("shared.status.pendingChanges", { count: 0 })).toBe("0 alterações pendentes");
  expect(createTranslator("mobile", "pt-PT")).toBe(createMobileTranslator("pt-PT"));
  expect(createTranslator("web", "pt-PT")).not.toBe(createMobileTranslator("pt-PT"));
});

test("a missing localized AST uses bundled English with English ordinal rules", () => {
  const namespace = createNamespace({
    en: { "shared.status.pendingChanges": parse("{count, selectordinal, two {#nd} other {#th}}") },
    "pt-PT": { "shared.action.save": parse("Guardar") },
  });
  const { t } = bindTranslator<"shared">(namespace)("pt-PT");
  expect(t("shared.action.save")).toBe("Guardar");
  expect(t("shared.status.pendingChanges", { count: 2 })).toBe("2nd");
});

test("pseudo changes literals without altering nested argument names, selectors or offsets", () => {
  const template = parse("{role, select, owner {{count, plural, offset:1 =0 {No guests} one {# guest for {name}} other {# guests for {name}}}} other {Hi {name}}}");
  function withoutLiterals(elements: MessageFormatElement[]): MessageFormatElement[] {
    return elements.map((element) => {
      if (element.type === TYPE.literal) return { ...element, value: "" };
      if (element.type !== TYPE.select && element.type !== TYPE.plural) return element;
      return { ...element, options: Object.fromEntries(Object.entries(element.options).map(([key, option]) => [
        key, { value: withoutLiterals(option.value) },
      ])) };
    });
  }
  for (const locale of ["en-XA", "ar-XB"] as const) {
    const pseudo = pseudolocalize(template, locale);
    expect(pseudo).not.toEqual(template);
    expect(withoutLiterals(pseudo)).toEqual(withoutLiterals(template));
    expect(createDevTranslator("mobile", locale).t("shared.status.lastConfirmed", { time: "15:37" })).toContain("15:37");
  }
  expect(createDevTranslator("mobile", "en-XA").t("shared.status.offline")).toHaveLength(10);
  expect(createDevTranslator("mobile", "ar-XB").t("shared.status.offline")).toMatch(/^\u202e.*\u202c$/);
  expect(directionOf("ar-XB")).toBe("rtl");
  expect(createTranslator("mobile", "ar-XB").t("shared.status.offline")).toBe("Offline");
});

test("contribution keys pass extraction before merge and merge updates both catalogs, context and types", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "bookbuddy-locale-"));
  try {
    const root = join(workspace, "packages", "i18n");
    await mkdir(join(root, "contributions"), { recursive: true });
    await cp(join(import.meta.dir, "../catalogs"), join(root, "catalogs"), { recursive: true });
    await runBuild(root, "build");
    const key = "mobile.place.welcome";
    const contribution = join(root, "contributions", "places.json");
    const context = "Greet by given name after adding a place.";
    const messages = { en: "Welcome, {name}.", "pt-PT": "Olá, {name}." };
    await writeFile(contribution, JSON.stringify([{ surface: "mobile", key, messages, context }]));
    const apps = join(workspace, "apps");
    await mkdir(join(apps, "mobile"), { recursive: true });
    const screen = join(apps, "mobile", "screen.tsx");
    await writeFile(screen, 'const copy = <Text>{translator.t("mobile.place.welcome", { name: "Ana" })}</Text>;');
    await runBuild(root, "check");
    await runBuild(root, "merge");
    expect(await Bun.file(contribution).exists()).toBe(false);
    for (const [locale, value] of Object.entries(messages)) {
      expect((await Bun.file(join(root, "catalogs", locale, "mobile.json")).json())[key]).toBe(value);
    }
    expect((await Bun.file(join(root, "catalogs", "context.json")).json())[key]).toBe(context);
    expect(await Bun.file(join(root, "src", "generated", "types.ts")).text()).toContain(`"${key}": { readonly "name":`);
    await runBuild(root, "check");
    await writeFile(screen, 't("mobile.unknown"); translator.t(key);');
    const { errors, unused } = await extractKeys(apps, new Set([key]));
    expect(errors).toEqual([
      'mobile/screen.tsx:1:3: unknown message key "mobile.unknown"',
      "mobile/screen.tsx:1:35: t() requires a literal message key",
    ]);
    expect(unused).toEqual([key]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
