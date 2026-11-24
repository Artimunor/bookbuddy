import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  applyContributions, englishKeys, readCanonical, readContributions, removeContributions, writeCanonical, writeIfChanged,
} from "./catalogs";
import { compileTranslations, generateArtifacts } from "./compiler";
import { extractKeys } from "./extract";

type Mode = "build" | "check" | "merge";

export async function runBuild(root: string, mode: Mode): Promise<void> {
  const source = await readCanonical(root);
  const pending = mode === "build" ? undefined : await readContributions(root);
  let artifacts: ReadonlyMap<string, string>;
  if (mode === "check") {
    artifacts = generateArtifacts(source.catalogs);
    applyContributions(source, pending!.entries);
    for (const entry of pending!.entries) compileTranslations(entry.key, entry.messages);
  } else {
    if (pending) applyContributions(source, pending.entries);
    artifacts = generateArtifacts(source.catalogs);
  }

  const generated = join(root, "src", "generated");
  if (mode === "check") {
    const stale: string[] = [];
    for (const [name, contents] of artifacts) {
      const file = Bun.file(join(generated, name));
      if (!(await file.exists()) || await file.text() !== contents) stale.push(name);
    }
    const { errors, unused } = await extractKeys(resolve(root, "../../apps"), new Set(englishKeys(source.catalogs)));
    if (unused.length) console.warn(`Unused message keys (${unused.length}): ${unused.join(", ")}`);
    if (stale.length) errors.push(`Stale generated catalogs (${stale.join(", ")}); run bun run i18n:build`);
    if (errors.length) throw new Error(errors.join("\n"));
    return;
  }

  if (pending?.files.length) await writeCanonical(root, source, pending.entries);
  await mkdir(generated, { recursive: true });
  await Promise.all([...artifacts].map(([name, contents]) => writeIfChanged(join(generated, name), contents)));
  if (pending?.files.length) {
    await removeContributions(pending.files);
    console.log(`Merged ${pending.entries.length} keys from ${pending.files.length} contribution files.`);
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const mode = !args.length ? "build" : args.length === 1 && args[0] === "--check" ? "check"
      : args.length === 1 && args[0] === "merge" ? "merge" : undefined;
    if (!mode) throw new Error("Usage: bun packages/i18n/scripts/build.ts [--check | merge]");
    await runBuild(resolve(import.meta.dir, ".."), mode);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
