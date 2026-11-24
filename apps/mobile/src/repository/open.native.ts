import { uuid } from "expo";
import { Directory, File, Paths } from "expo-file-system";
import { authenticateAsync, getEnrolledLevelAsync, SecurityLevel } from "expo-local-authentication";
import { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, getItemAsync, setItemAsync } from "expo-secure-store";
import { openDatabaseAsync } from "expo-sqlite";
import { Platform } from "react-native";
import { clearEphemeralStagedFiles, eraseStagedFile, listStagedFiles } from "../media/files.native";
import { createMemoryExecutor } from "./memory";
import { createRepositoryAccess } from "./open-policy";
import { MobileRepository } from "./repository";
import { createSqliteExecutor } from "./sqlite";

const databaseName = "bookbuddy.sqlite";
const keyName = "bookbuddy.sqlite-key.v1";
let opening: Promise<MobileRepository> | undefined;
let memory: MobileRepository | undefined;

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
    const repository = new MobileRepository(executor, uuid.v4, Date.now, eraseStagedFile, true);
    await repository.reconcileStagedFiles(listStagedFiles, removeStagedFiles);
    return repository;
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
}

function openPersistentRepository(): Promise<MobileRepository> {
  return opening ??= open().catch((error: unknown) => { opening = undefined; throw error; });
}

function openMemoryRepository(): MobileRepository {
  if (!memory) {
    memory = new MobileRepository(createMemoryExecutor(), uuid.v4, Date.now, eraseStagedFile);
  }
  return memory;
}

const access = createRepositoryAccess({
  eligible: async () => await getEnrolledLevelAsync() !== SecurityLevel.NONE,
  existing: () => new File(new Directory(Paths.document, "BookBuddyOffline"), databaseName).exists,
  authenticate: async (promptMessage) => (await authenticateAsync({ promptMessage, disableDeviceFallback: false })).success,
  sweepEphemeral: clearEphemeralStagedFiles,
  persistent: openPersistentRepository,
  memory: openMemoryRepository,
});
export const openMobileRepository = access.open;
export const lockMobileRepository = access.lock;
export const openSignOutRepository = access.openForSignOut;

export async function removeStagedFiles(uris: readonly string[]) {
  for (const uri of uris) await eraseStagedFile(uri);
}
