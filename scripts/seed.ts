import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { castSql } from "../apps/api/seed/cast";
import { checkpoints, constructionSql, type Checkpoint } from "../apps/api/seed/construction";

const root = resolve(import.meta.dir, "..");
const api = join(root, "apps/api");
const state = join(api, ".wrangler/state");
const args = process.argv.slice(2);
let scenario: string | undefined, until: string | undefined, reset = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--scenario" && !scenario) scenario = args[++i];
  else if (arg === "--until" && !until) until = args[++i];
  else if (arg === "--reset" && !reset) reset = true;
  else throw new Error(`Unknown or duplicate argument: ${arg}`);
}
if (scenario !== "construction" || !until || !checkpoints.includes(until as Checkpoint)) {
  throw new Error(`Usage: bun scripts/seed.ts --scenario construction --until <${checkpoints.join("|")}> [--reset]`);
}
const domain = process.env.SEED_EMAIL_DOMAIN?.trim().toLowerCase();
if (!domain || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:test|invalid)$/.test(domain)) {
  throw new Error("SEED_EMAIL_DOMAIN must be a reserved .test or .invalid domain");
}
let vars: string;
try { vars = await readFile(join(api, ".dev.vars"), "utf8"); }
catch { throw new Error("Create apps/api/.dev.vars from .dev.vars.example before seeding"); }
const match = vars.match(/^\s*OTP_HMAC_KEY\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s#]+))\s*(?:#.*)?$/m);
const secret = match?.[1] ?? match?.[2] ?? match?.[3];
if (!secret) throw new Error("Set OTP_HMAC_KEY in apps/api/.dev.vars");
const cast = await castSql(domain, secret);
await mkdir(state, { recursive: true });
if (reset) await rm(join(state, "v3/d1"), { recursive: true, force: true });
async function run(command: string[]) {
  const proc = Bun.spawn(command, { cwd: api, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${command.join(" ")} failed with exit code ${code}`);
}
await run(["bun", "run", "db:migrate:local"]);
const temp = await mkdtemp(join(tmpdir(), "bookbuddy-seed-"));
try {
  const file = join(temp, "construction.sql");
  await Bun.write(file, `${cast.sql}\n${constructionSql(until as Checkpoint)}\n`);
  await run(["bunx", "--bun", "--no-install", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", state, "--file", file]);
} finally { await rm(temp, { recursive: true, force: true }); }
console.log(`Seeded construction through ${until}:`);
for (const account of cast.accounts) console.log(`  ${account.email} — ${account.display}: ${account.roles}`);
