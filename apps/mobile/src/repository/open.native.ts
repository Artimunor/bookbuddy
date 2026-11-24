import { uuid } from "expo";
import { Directory, File, Paths } from "expo-file-system";
import { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, getItemAsync, setItemAsync } from "expo-secure-store";
import { openDatabaseAsync } from "expo-sqlite";
import { Platform } from "react-native";
import { MobileRepository } from "./repository";
import { createSqliteExecutor } from "./sqlite";

const databaseName = "bookbuddy.sqlite";
const keyName = "bookbuddy.sqlite-key.v1";
let opening: Promise<MobileRepository> | undefined;

export function stagedMediaDirectory(): string {
  return new Directory(Paths.document, "BookBuddyOffline", "staged-media").uri;
}

async function open() {
  const directory = new Directory(Paths.document, "BookBuddyOffline");
  if (Platform.OS === "ios" && !new File(directory, ".no-backup").exists) throw new Error("Offline storage is not excluded from backup");
  const keychain = { keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
  let key = await getItemAsync(keyName, keychain);
  if (key === null) {
    if (new File(directory, databaseName).exists) throw new Error("Offline storage key is unavailable");
    // Use only variable nibbles from three platform-CSPRNG UUIDs (no version or variant bits).
    const randomHex = [uuid.v4(), uuid.v4(), uuid.v4()].map((id) => id.replaceAll("-", ""))
      .map((hex) => hex.slice(0, 12) + hex.slice(13, 16) + hex.slice(17)).join("");
    key = randomHex.slice(0, 64);
    await setItemAsync(keyName, key, keychain);
  }
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("Invalid offline storage key");
  const db = await openDatabaseAsync(databaseName, { useNewConnection: true }, decodeURIComponent(new URL(directory.uri).pathname));
  try {
    const cipher = await db.getFirstAsync<{ cipher_version: string }>("PRAGMA cipher_version");
    if (!cipher?.cipher_version) throw new Error("Offline storage requires a SQLCipher native build");
    await db.execAsync(`PRAGMA key = "x'${key}'"; PRAGMA secure_delete = ON; PRAGMA temp_store = MEMORY;`);
    const executor = await createSqliteExecutor({
      exec: (sql) => db.execAsync(sql),
      run: async (sql, values) => { await db.runAsync(sql, values); },
      all: (sql, values) => db.getAllAsync(sql, values),
    });
    return new MobileRepository(executor, uuid.v4);
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
}

export function openMobileRepository(): Promise<MobileRepository> {
  return opening ??= open().catch((error: unknown) => { opening = undefined; throw error; });
}

export async function removeStagedFiles(uris: readonly string[]) {
  const root = new URL(stagedMediaDirectory());
  const directory = root.pathname.replace(/\/?$/, "/");
  for (const uri of uris) {
    const path = new URL(uri);
    if (path.protocol !== "file:" || path.host !== root.host || !path.pathname.startsWith(directory) || /%2[ef]|%5c/i.test(path.pathname)) {
      throw new Error("Staged file is outside the app's private staging directory");
    }
    const file = new File(path.href);
    if (file.exists) file.delete();
  }
}
