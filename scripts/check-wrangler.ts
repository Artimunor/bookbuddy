import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const placeholder = /^<[^<>]+>$/u;

function checkPlaceholders(value: unknown, path: string, problems: string[]): void {
  if (typeof value === "string" && placeholder.test(value.trim())) {
    problems.push(`${path}: replace the deployment placeholder`);
  } else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) checkPlaceholders(item, `${path}[${index}]`, problems);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) checkPlaceholders(item, `${path}.${key}`, problems);
  }
}

async function run(args: string[]): Promise<void> {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--deploy")) {
    console.error("Usage: bun run check:wrangler [--deploy]");
    process.exitCode = 1;
    return;
  }
  const deploy = args[0] === "--deploy";
  const paths = Array.from(new Bun.Glob("apps/*/wrangler.jsonc").scanSync({ cwd: root })).sort();
  if (existsSync(join(root, "wrangler.jsonc"))) paths.unshift("wrangler.jsonc");
  const problems: string[] = [];
  if (paths.length === 0) problems.push("No Wrangler configs found");

  let accountId: string | undefined;
  let compatibilityDate: string | undefined;
  for (const path of paths) {
    let config: unknown;
    try {
      config = Bun.JSONC.parse(await Bun.file(join(root, path)).text());
    } catch {
      problems.push(`${path}: unable to read a valid JSONC config`);
      continue;
    }
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      problems.push(`${path}: expected a config object`);
      continue;
    }

    const account_id = "account_id" in config ? config.account_id : undefined;
    const compatibility_date = "compatibility_date" in config ? config.compatibility_date : undefined;
    if (typeof account_id !== "string" || !account_id.trim()) {
      problems.push(`${path}: missing account_id`);
    } else if (accountId !== undefined && accountId !== account_id) {
      problems.push(`${path}: account_id differs from the other Workers`);
    } else {
      accountId = account_id;
    }
    if (typeof compatibility_date !== "string" || !datePattern.test(compatibility_date)) {
      problems.push(`${path}: compatibility_date must use YYYY-MM-DD`);
    } else if (compatibilityDate !== undefined && compatibilityDate !== compatibility_date) {
      problems.push(`${path}: compatibility_date differs from the other Workers`);
    } else {
      compatibilityDate = compatibility_date;
    }
    if (deploy) checkPlaceholders(config, path, problems);
  }

  if (problems.length) {
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
  } else {
    console.log(`${paths.length} Wrangler configs share one account and one compatibility date.`);
  }
}

await run(process.argv.slice(2));
