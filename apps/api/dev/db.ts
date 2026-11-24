import { Database } from "bun:sqlite";
import { link, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const directory = resolve(import.meta.dir, "../.wrangler/bun-dev");
const migrations = new URL("../migrations/", import.meta.url);

function databasePath(target: string): string {
  const path = resolve(target);
  if (dirname(path) !== directory || !/^[\w-]+\.sqlite$/.test(basename(path))) {
    throw new Error("Bun demo database must be a .sqlite file in apps/api/.wrangler/bun-dev");
  }
  return path;
}

async function requireDevDirectory(): Promise<void> {
  if (await realpath(directory) !== directory) throw new Error("Bun demo database directory must not be a symlink");
}

export async function openBunDatabase(target: string): Promise<Database> {
  const path = databasePath(target);
  await requireDevDirectory();
  if (!(await lstat(path)).isFile()) throw new Error("Bun demo database must be a regular file");
  const sqlite = new Database(path, { create: false, strict: true });
  try {
    sqlite.run("PRAGMA foreign_keys = ON");
    if (!sqlite.query("SELECT 1 FROM bun_dev_migrations LIMIT 1").get()) throw new Error("Database has no applied migrations");
    return sqlite;
  } catch (error) {
    sqlite.close();
    throw new Error("Use scripts/seed.ts --target bun-sqlite to create the demo database", { cause: error });
  }
}

export async function seedBunDatabase(target: string, seed: string, reset: boolean): Promise<void> {
  const path = databasePath(target);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await requireDevDirectory();
  const existing = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (existing) {
    if (!reset) throw new Error("Bun demo database already exists; stop the API and pass --reset to replace it");
    (await openBunDatabase(path)).close();
  }

  const temp = await mkdtemp(join(directory, ".seed-"));
  try {
    const staging = join(temp, "snapshot.sqlite");
    const sqlite = new Database(staging, { strict: true });
    try {
      sqlite.run("PRAGMA foreign_keys = ON; CREATE TABLE bun_dev_migrations (name TEXT PRIMARY KEY NOT NULL)");
      const record = sqlite.query("INSERT INTO bun_dev_migrations (name) VALUES (?)");
      const files = await readdir(migrations, { withFileTypes: true });
      const names = files.filter((file) => file.isFile() && file.name.endsWith(".sql")).map((file) => file.name).sort();
      for (const name of names) {
        const sql = await Bun.file(new URL(name, migrations)).text();
        sqlite.transaction(() => { sqlite.run(sql); record.run(name); })();
      }
      sqlite.transaction(() => sqlite.run(seed))();
    } finally {
      sqlite.close();
    }
    if (existing) await rename(staging, path);
    else await link(staging, path); // Do not overwrite a database created while seeding.
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
