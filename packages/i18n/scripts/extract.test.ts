import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractKeys } from "./extract";

test("typed key prop values count without counting other matching string literals", async () => {
  const apps = await mkdtemp(join(tmpdir(), "bookbuddy-extract-"));
  try {
    await writeFile(join(apps, "screen.tsx"), `
      const action = { actionLabelKey: active ? "mobile.action.stop" : ("mobile.action.start" as const) };
      const header = <Header titleKey="mobile.header.title" labelKey={"mobile.header.label"} />;
      const unrelated = <Item label="mobile.unused.label" labelKey="unrelated" />;
    `);
    expect(await extractKeys(apps, new Set([
      "mobile.action.stop", "mobile.action.start", "mobile.header.title", "mobile.header.label", "mobile.unused.label",
    ]))).toEqual({ errors: [], unused: ["mobile.unused.label"] });
  } finally {
    await rm(apps, { recursive: true, force: true });
  }
});
