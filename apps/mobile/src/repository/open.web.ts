import { uuid } from "expo";
import { transferFiles } from "../media/files";
import { createMemoryExecutor } from "./memory.web";
import { MobileRepository } from "./repository";

let repository: MobileRepository | undefined;

export async function openMobileRepository(): Promise<MobileRepository> {
  return repository ??= new MobileRepository(createMemoryExecutor(), uuid.v4);
}

// The preview has a memory-only file adapter and no private native directory.
export function stagedMediaDirectory(): string | null { return null; }
export async function removeStagedFiles(uris: readonly string[]) {
  await Promise.all(uris.map(transferFiles.erase));
}
